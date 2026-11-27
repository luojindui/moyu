import type { GameState } from "./state";

/**
 * 摸鱼站（批次 4）：3 个 30 秒小游戏，每天限 3 次。
 * 纯逻辑在引擎层（可单测），UI 只负责渲染与计时。
 */

export type GameId = "coffee" | "findboss" | "rhythm";

export interface GameDef {
  id: GameId;
  name: string;
  desc: string;
  /** 单次时长（秒） */
  duration: number;
  /** 每日次数上限 */
  dailyLimit: number;
}

export const GAMES: GameDef[] = [
  { id: "coffee", name: "接咖啡", desc: "咖啡掉下来时点住它——掉地上就没了", duration: 30, dailyLimit: 3 },
  { id: "findboss", name: "找老板", desc: "在一堆同事脸里找出王总，越快越好", duration: 30, dailyLimit: 3 },
  { id: "rhythm", name: "节奏点击", desc: "跟着节拍点屏幕，越准分越高", duration: 30, dailyLimit: 3 },
];

/** 每天总共能玩几次（跨游戏共享） */
export const ARCADE_DAILY_LIMIT = 3;

export interface ArcadeState {
  date: string;
  /** 今天已玩次数 */
  played: number;
  /** 最高分（各游戏） */
  best: Partial<Record<GameId, number>>;
}

export function emptyArcade(date = ""): ArcadeState {
  return { date, played: 0, best: {} };
}

/** 跨日重置（幂等） */
export function ensureArcade(state: GameState, today: string): GameState {
  if (state.arcade.date === today) return state;
  return { ...state, arcade: { date: today, played: 0, best: state.arcade.best } };
}

export function arcadeLeft(state: GameState): number {
  return Math.max(0, ARCADE_DAILY_LIMIT - state.arcade.played);
}

/** 记录一局：返回新状态与奖励（奖励 = 分数 × 系数 × 当前挂机收益/秒） */
export function finishGame(
  state: GameState,
  game: GameId,
  score: number,
  idleRate: number,
): { state: GameState; reward: number } | null {
  if (arcadeLeft(state) <= 0) return null;
  if (!Number.isFinite(score) || score <= 0) {
    // 0 分也消耗次数（防止反复重开刷次数）
    return { state: { ...state, arcade: { ...state.arcade, played: state.arcade.played + 1 } }, reward: 0 };
  }
  const capped = Math.min(score, 9999);
  // 奖励：分数 × 0.6 秒挂机收益（30 秒小游戏 ≈ 18 秒挂机收益，不喧宾夺主）
  const reward = Math.floor((idleRate * 0.6 + 20) * (capped / 100));
  const best = Math.max(state.arcade.best[game] ?? 0, capped);
  return {
    reward,
    state: {
      ...state,
      moyu: state.moyu + reward,
      totalEarned: state.totalEarned + reward,
      lifetimeEarned: state.lifetimeEarned + reward,
      arcade: {
        date: state.arcade.date,
        played: state.arcade.played + 1,
        best: { ...state.arcade.best, [game]: best },
      },
    },
  };
}

/* ===================== 小游戏 1：接咖啡 ===================== */

export interface Drop {
  id: number;
  /** 掉落时间（秒，从开始算） */
  at: number;
  /** 横向位置 0-1 */
  x: number;
}

/** 生成一局的咖啡掉落序列（固定种子可复现） */
export function genDrops(duration: number, rng: () => number): Drop[] {
  const drops: Drop[] = [];
  let t = 0.8;
  let id = 0;
  while (t < duration - 0.5) {
    drops.push({ id: id++, at: Number(t.toFixed(2)), x: Number((0.12 + rng() * 0.76).toFixed(2)) });
    t += 0.55 + rng() * 0.5;
  }
  return drops;
}

/** 判定一次点击是否接住（时间窗 ±0.32s，横向 ±0.13） */
export function judgeCatch(drops: Drop[], tapAt: number, tapX: number): { hit: Drop | null } {
  let best: Drop | null = null;
  let bestD = Infinity;
  for (const d of drops) {
    const dt = Math.abs(d.at - tapAt);
    const dx = Math.abs(d.x - tapX);
    if (dt <= 0.32 && dx <= 0.13 && dt < bestD) {
      best = d;
      bestD = dt;
    }
  }
  return { hit: best };
}

/** 接咖啡的分数：接住 +10，连续接住有 combo 加成（顶部 ×2） */
export function coffeeScore(caught: number, missed: number, maxCombo: number): number {
  const base = caught * 10;
  const comboBonus = Math.min(2, 1 + maxCombo * 0.05);
  return Math.floor(base * comboBonus - missed * 2);
}

/* ===================== 小游戏 2：找老板 ===================== */

export interface FindRound {
  /** 同事脸的位置（0-8 的格子），老板在第几个 */
  bossAt: number;
  /** 网格尺寸 */
  size: number;
}

export function genFindRounds(count: number, size: number, rng: () => number): FindRound[] {
  const out: FindRound[] = [];
  for (let i = 0; i < count; i++) out.push({ bossAt: Math.floor(rng() * size * size), size });
  return out;
}

/** 找老板得分：正确 +50，越快额外加分（每剩 0.1s +1），错误 -20 */
export function findScore(correct: number, wrong: number, totalLeftSec: number): number {
  return Math.max(0, correct * 50 - wrong * 20 + Math.floor(totalLeftSec * 10));
}

/* ===================== 小游戏 3：节奏点击 ===================== */

/** 生成节拍（BPM + 偏移，返回每个节拍的时间点秒） */
export function genBeats(duration: number, bpm: number, offset: number): number[] {
  const interval = 60 / bpm;
  const out: number[] = [];
  for (let t = offset; t < duration; t += interval) out.push(Number(t.toFixed(3)));
  return out;
}

/** 判定一次点击：返回 perfect/good/miss 与得分 */
export function judgeBeat(beats: number[], tapAt: number, used: Set<number>): { kind: "perfect" | "good" | "miss"; index: number; score: number } {
  let bestIdx = -1;
  let bestD = Infinity;
  for (let i = 0; i < beats.length; i++) {
    if (used.has(i)) continue;
    const d = Math.abs(beats[i]! - tapAt);
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return { kind: "miss", index: -1, score: 0 };
  if (bestD <= 0.08) return { kind: "perfect", index: bestIdx, score: 20 };
  if (bestD <= 0.16) return { kind: "good", index: bestIdx, score: 10 };
  return { kind: "miss", index: -1, score: 0 };
}
