import type { GameState } from "./state";
import { gain } from "./state";
import { effectOf, stationIdleScaled } from "./upgrades";
import { decorEffects } from "./decor";
import { TEAM_OFFLINE_SHARE } from "./team";
import { talentEffects } from "./talents";

export const OFFLINE_CAP_SECONDS = 12 * 3600; // R11：8h→12h（每天开机一次也能拿满一天的大半）
export const OFFLINE_CAP_WEEK = 24 * 3600;
export const OFFLINE_CAP_MONTH = 48 * 3600;

/** 阶梯封顶（R10 回归补偿）：日常 12h；≥7 天 24h；≥30 天 48h */
export function capForElapsed(elapsed: number): number {
  if (elapsed >= 30 * 86400) return OFFLINE_CAP_MONTH;
  if (elapsed >= 7 * 86400) return OFFLINE_CAP_WEEK;
  return OFFLINE_CAP_SECONDS;
}

export interface OfflineResult {
  /** 实际结算的秒数（封顶后） */
  applied: number;
  /** 获得的摸鱼值 */
  earned: number;
  /** 新状态 */
  state: GameState;
}

/** 离线结算：elapsed 秒按 8h 封顶 × idleRate × rate（首日 1.0 / 之后 0.7） */
export function offlineEarn(state: GameState, elapsed: number, rate = 1): OfflineResult {
  // 天赋：挂机流「离线扩容」
  const cap = capForElapsed(elapsed) + talentEffects(state.talents).offlineCapBonusHours * 3600;
  const applied = Math.max(0, Math.min(elapsed, cap));
  // 离线收益：工位 100% + 同事固定部分 50%（同事 share 已按工位为基数，同样折半）
  const total = effectOf(state).idleRate;
  const station = stationIdleScaled(state);
  const teamPart = Math.max(0, total - station);
  // 家具「离线收益 +X%」在效率上限之后乘 → 不会被 95% 硬上限吃掉
  const incomeMult = decorEffects(state).offlineIncomeMult;
  const earned = (station + teamPart * TEAM_OFFLINE_SHARE) * applied * rate * incomeMult;
  return { applied, earned, state: gain(state, earned) };
}
