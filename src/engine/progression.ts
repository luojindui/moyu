import type { GameState } from "./state";
import { talentEffects } from "./talents";
import { cardEffects } from "./cards";
import { favorTier, teamTraits } from "./team";

/**
 * 长线进度辅助（R7）：
 * ① 回访把离线效率从 0.7 挣回 1.0（当日最多 3 次回访，每次 +0.1）；
 * ② 日报 streak 里程碑：每满 7 天 +0.05 离线效率（封顶 +0.15）；
 * ③ 首日（建档 24h 内）全额 1.0。
 */

export const FIRST_DAY_MS = 86_400_000;
export const VISIT_BONUS_STEP = 0.1;
export const VISIT_BONUS_MAX_VISITS = 3;
export const STREAK_BONUS_STEP = 0.05;
export const STREAK_BONUS_DAYS = 7;
export const STREAK_BONUS_MAX = 0.15;

/** 记录一次回访（同日累计，跨日重置为 1） */
export function ensureVisits(state: GameState, nowMs: number): GameState {
  const date = new Date(nowMs).toLocaleDateString("sv-SE");
  const v = state.visits;
  if (v.date === date) return { ...state, visits: { date, count: v.count + 1 } };
  return { ...state, visits: { date, count: 1 } };
}

/** 当前离线效率：首日 1.0；之后 0.7 + 回访加成 + streak 加成，封顶 1.0 */
export function offlineEfficiency(state: GameState, createdAtMs: number, nowMs: number): number {
  if (nowMs - createdAtMs < FIRST_DAY_MS) return 1;
  const visits = Math.min(state.visits.count, VISIT_BONUS_MAX_VISITS);
  const streakDays = state.daily?.streak ?? 0;
  const streakBonus = Math.min(STREAK_BONUS_MAX, STREAK_BONUS_STEP * Math.floor(streakDays / STREAK_BONUS_DAYS));
  const eff = talentEffects(state.talents);
  const talentBase = eff.offlineBaseBonus;
  const eventBonus = eff.offlineEfficiencyBonus;
  // 好感 40 里程碑：离线基础效率 +3%
  const favorBase = favorTier(state) >= 2 ? 0.03 : 0;
  // 小美被动：在队期间离线基础效率 +2%
  const ce = cardEffects(state, Date.now());
  const teamBase = teamTraits(state).offlineEfficiency + ce.offlineBonus - ce.riskPenalty;
  // idle_4：离线效率上限可超过 100%（上限随天赋 +talentBase 提高）
  // 上限随天赋一起抬高（event_5b 的离线 +20% 不会被 1.0 截断）
  return Math.min(
    1 + talentBase + eventBonus,
    0.7 + talentBase + eventBonus + favorBase + teamBase + visits * VISIT_BONUS_STEP + streakBonus,
  );
}
