import type { GameState } from "./state";
import { gain } from "./state";
import { effectOf } from "./upgrades";

export const OFFLINE_CAP_SECONDS = 8 * 3600;

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
  const applied = Math.max(0, Math.min(elapsed, OFFLINE_CAP_SECONDS));
  const earned = effectOf(state).idleRate * applied * rate;
  return { applied, earned, state: gain(state, earned) };
}
