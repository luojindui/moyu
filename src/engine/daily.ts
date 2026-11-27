import type { GameState } from "./state";
import { gain } from "./state";
import { effectOf } from "./upgrades";

/** 每日摸鱼日报：3 小目标 + streak（量级 = 会话 1/3，10 分钟可完成） */

export interface DailyGoal {
  id: string;
  target: number;
  progress: number;
  done: boolean;
}

export interface DailyState {
  /** 本地日期 YYYY-MM-DD */
  date: string;
  goals: DailyGoal[];
  streak: number;
  /** 上一次全完成的日期（判断连续） */
  lastCompleteDate: string | null;
  claimed: boolean;
}

export interface GoalTemplate {
  id: string;
  desc: string;
  kind: "click" | "meme" | "buy" | "survive";
  target: number;
}

export const DAILY_GOAL_TEMPLATES: GoalTemplate[] = [
  { id: "click_100", desc: "点 100 下", kind: "click", target: 100 },
  { id: "meme_1", desc: "收 1 个梗", kind: "meme", target: 1 },
  { id: "buy_3", desc: "买 3 次升级", kind: "buy", target: 3 },
  { id: "survive_2", desc: "应付 1 次巡逻（忍住或点满都算）", kind: "survive", target: 1 },
];

/** 奖励 = max(500, 600 × 挂机秒收益)：R7 上调 10×，让日报在后期仍有意义（原 60× 仅占日收入 0.14%） */
export function dailyReward(state: GameState): number {
  return Math.max(500, 600 * effectOf(state).idleRate);
}

/** 本地日期格式化（避免 toISOString 在非 UTC 时区跨日错位） */
export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 前一天的本地日期（YYYY-MM-DD） */
export function yesterdayLocal(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, (d ?? 1) - 1, 12, 0, 0);
  return formatLocalDate(dt);
}

export function yesterdayOf(date: string): string {
  return yesterdayLocal(date);
}

/** 存档净化：形状非法/目标数不为 3/数值非法 → null */
export function restoreDaily(raw: unknown): DailyState | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.date !== "string" || !Array.isArray(d.goals) || d.goals.length !== 3) return null;
  if (typeof d.claimed !== "boolean") return null;
  const goals: DailyGoal[] = [];
  for (const g of d.goals) {
    if (!g || typeof g !== "object") return null;
    const gg = g as Record<string, unknown>;
    if (typeof gg.id !== "string") return null;
    if (typeof gg.target !== "number" || !Number.isFinite(gg.target) || gg.target <= 0) return null;
    if (typeof gg.progress !== "number" || !Number.isFinite(gg.progress) || gg.progress < 0) return null;
    if (typeof gg.done !== "boolean") return null;
    const progress = Math.min(gg.progress, gg.target);
    // done 必须与进度一致（防 done:true/progress:0 直接白嫖）
    if (gg.done && progress < gg.target) return null;
    goals.push({ id: gg.id, target: gg.target, progress, done: gg.done });
  }
  // streak 必须是非负整数；非法即整档拒绝（不再静默收敛为 0）
  const streakRaw = d.streak;
  if (typeof streakRaw !== "number" || !Number.isInteger(streakRaw) || streakRaw < 0) return null;
  const lastCompleteDate = typeof d.lastCompleteDate === "string" ? d.lastCompleteDate : null;
  return { date: d.date, goals, streak: streakRaw, lastCompleteDate, claimed: d.claimed };
}

/** 掷出当日目标（3 个不重复，继承 streak 基础） */
export function rollDaily(date: string, rng: () => number, prevStreak = 0): DailyState {
  const pool = [...DAILY_GOAL_TEMPLATES];
  const goals: DailyGoal[] = [];
  while (goals.length < 3 && pool.length > 0) {
    const i = Math.floor(rng() * pool.length);
    const t = pool.splice(i, 1)[0]!;
    goals.push({ id: t.id, target: t.target, progress: 0, done: false });
  }
  return { date, goals, streak: prevStreak, lastCompleteDate: null, claimed: false };
}

/** 保证当日日报存在：同日幂等；跨日重掷（streak 由 lastCompleteDate 推导保留） */
export function ensureDaily(state: GameState, date: string, rng: () => number): GameState {
  if (state.daily && state.daily.date === date) return state;
  // streak 保留：昨天全完成过 → 保留次数；否则归零（领取时会再 +1）
  const keptStreak = state.daily?.lastCompleteDate === yesterdayOf(date) ? state.daily.streak : 0;
  return { ...state, daily: rollDaily(date, rng, keptStreak) };
}

/** 行为计数：kind ∈ click/meme/buy/survive */
export function dailyTrack(daily: DailyState, kind: "click" | "meme" | "buy" | "survive", amount = 1): DailyState {
  const goals = daily.goals.map((g) => {
    const tpl: GoalTemplate | undefined = DAILY_GOAL_TEMPLATES.find((t) => t.id === g.id);
    if (!tpl || tpl.kind !== kind || g.done) return g;
    const progress = Math.min(g.target, g.progress + amount);
    return { ...g, progress, done: progress >= g.target };
  });
  return { ...daily, goals };
}

export function dailyAllDone(daily: DailyState): boolean {
  return daily.goals.every((g) => g.done);
}

/** 领取：全完成且未领 → 发奖 + streak 推进；否则不发 */
export function claimDaily(state: GameState, date: string): { state: GameState; claimedReward: number | null } {
  const d = state.daily;
  if (!d || d.date !== date || d.claimed || !dailyAllDone(d)) {
    return { state, claimedReward: null };
  }
  const reward = dailyReward(state);
  const streak = d.streak + 1;
  const next: GameState = gain(state, reward);
  return {
    state: { ...next, daily: { ...d, claimed: true, streak, lastCompleteDate: date } },
    claimedReward: reward,
  };
}
