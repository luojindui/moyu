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
  /** 当日第几个时段（0..3，每 6 小时一换）：让 4-6 次/天的碎片回访都有事可做 */
  window: number;
  /** 当日已领取次数 */
  claimsToday: number;
}

/** 每 6 小时一个时段（4 段/天） */
export const DAILY_WINDOWS_PER_DAY = 4;

export interface GoalTemplate {
  id: string;
  desc: string;
  kind: "click" | "meme" | "buy" | "survive" | "visit" | "idle";
  target: number;
}

export const DAILY_GOAL_TEMPLATES: GoalTemplate[] = [
  { id: "click_100", desc: "戳 100 下", kind: "click", target: 100 },
  { id: "meme_1", desc: "点掉 1 个同事丢来的梗", kind: "meme", target: 1 },
  { id: "buy_3", desc: "买 3 次升级", kind: "buy", target: 3 },
  { id: "survive_2", desc: "老板巡逻时忍住不点，1 次", kind: "survive", target: 1 },
  // R9 佛系：两个"零操作可完成"目标（开页/挂机自动达成），保证不点屏幕也能推进日报
  { id: "visit_1", desc: "今天上线看一眼", kind: "visit", target: 1 },
  { id: "idle_earn", desc: "什么都不点，等摸鱼值自己涨", kind: "idle", target: 1 },
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
  const win = typeof d.window === "number" && Number.isInteger(d.window) && d.window >= 0 ? d.window : 0;
  const claimsToday =
    typeof d.claimsToday === "number" && Number.isInteger(d.claimsToday) && d.claimsToday >= 0 ? d.claimsToday : 0;
  return { date: d.date, goals, streak: streakRaw, lastCompleteDate, claimed: d.claimed, window: win, claimsToday };
}

/** 掷出当日目标（3 个不重复，继承 streak 基础） */
export function rollDaily(date: string, rng: () => number, prevStreak = 0): DailyState {
  // 固定两个"自动完成"目标（上线/挂机到账），保证离线/零操作玩家也能 3/3 领奖
  const auto = DAILY_GOAL_TEMPLATES.filter((t) => t.kind === "visit" || t.kind === "idle");
  const pool = DAILY_GOAL_TEMPLATES.filter((t) => !auto.includes(t));
  const goals: DailyGoal[] = auto.map((t) => ({ id: t.id, target: t.target, progress: 0, done: false }));
  while (goals.length < 3 && pool.length > 0) {
    const i = Math.floor(rng() * pool.length);
    const t = pool.splice(i, 1)[0]!;
    goals.push({ id: t.id, target: t.target, progress: 0, done: false });
  }
  return { date, goals, streak: prevStreak, lastCompleteDate: null, claimed: false, window: 0, claimsToday: 0 };
}

/** 保证当日日报存在：同日幂等；跨日重掷（streak 由 lastCompleteDate 推导保留） */
export function ensureDaily(state: GameState, date: string, rng: () => number, window = 0): GameState {
  const d = state.daily;
  if (d && d.date === date) {
    // 同日但跨时段：重掷目标，但保留同 id 目标已达成的进度（佛系：避免重掷清零）
    if ((d.window ?? 0) !== window) {
      const rerolled = rollDaily(date, rng, d.streak);
      const progressById = new Map(d.goals.map((g) => [g.id, g]));
      rerolled.goals = rerolled.goals.map((g) => {
        const old = progressById.get(g.id);
        if (!old) return g;
        const progress = Math.min(g.target, old.progress);
        return { ...g, progress, done: progress >= g.target };
      });
      return {
        ...state,
        daily: {
          ...rerolled,
          window,
          claimsToday: d.claimsToday,
          lastCompleteDate: d.lastCompleteDate,
          streak: d.streak,
        },
      };
    }
    return state;
  }
  // 跨日：streak 保留（昨天全完成过），当日领取次数清零；保留 lastCompleteDate 供连续判定
  const prev = state.daily;
  const keptStreak = prev?.lastCompleteDate === yesterdayOf(date) ? prev.streak : 0;
  const rolled = rollDaily(date, rng, keptStreak);
  return {
    ...state,
    daily: { ...rolled, window, lastCompleteDate: prev?.lastCompleteDate ?? null, claimsToday: 0 },
  };
}

/** 行为计数：kind ∈ click/meme/buy/survive */
export function dailyTrack(
  daily: DailyState,
  kind: "click" | "meme" | "buy" | "survive" | "visit" | "idle",
  amount = 1,
): DailyState {
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
  // streak 只在当天第一次领取时 +1（多时段可多领，但连续天数按天算）
  const firstOfDay = d.lastCompleteDate !== date;
  const streak = firstOfDay ? (d.lastCompleteDate === yesterdayOf(date) ? d.streak + 1 : Math.max(1, d.streak ? d.streak : 1)) : d.streak;
  const next: GameState = gain(state, reward);
  return {
    state: {
      ...next,
      daily: { ...d, claimed: true, streak, lastCompleteDate: date, claimsToday: (d.claimsToday ?? 0) + 1 },
    },
    claimedReward: reward,
  };
}
