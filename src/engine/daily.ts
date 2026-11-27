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
  { id: "survive_2", desc: "安然躲过 2 次巡逻", kind: "survive", target: 2 },
];

/** 奖励 = max(500, 60 × 挂机秒收益) */
export function dailyReward(state: GameState): number {
  return Math.max(500, 60 * effectOf(state).idleRate);
}

function yesterdayOf(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
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
