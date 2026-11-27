/**
 * probe-r4v-challenge-lib.ts — 挑战党验收探针公共库（只在 playtest/ 使用，不改 src/）。
 * 验收对象（batch5 / HEAD 109f093）：①偷点赌点 onBossTap ②安然连胜 surviveStreak ③连击链 combo。
 * 全部用真实引擎函数（onBossTap / finishPatrol / bossSurviveReward / comboMultiplier），
 * 状态取自 playtest/report.json 的实跑检查点 levels，确保"真实进度"而非手搓数值。
 *
 * 注意：工作区已合入 batch6「巡逻三变体」。本库把巡逻显式锁定为 hold 变体
 * （投点赌点/安然连胜语义只在 hold 下成立），避免随机变体污染验收数字。
 */
import { readFileSync } from "node:fs";
import type { GameState } from "../src/engine/state";
import { initialState } from "../src/engine/state";
import { effectOf } from "../src/engine/upgrades";
import { COMBO_BREAK_S, COMBO_MAX, COMBO_WINDOW_S, comboMultiplier } from "../src/engine/actions";
import {
  newEventState,
  onBossTap,
  bossSurviveReward,
  finishPatrol,
  scheduleEvents,
  BOSS_DURATION,
  BOSS_GRACE_SECONDS,
  SURVIVE_STREAK_CAP,
  type EventState,
} from "../src/engine/events";

export const HOLD = "hold";
export const STREAK_CAP = SURVIVE_STREAK_CAP;

export type Levels = Record<string, number>;

export interface Scene {
  persona: string;
  minute: number;
  /** 报告里的真实余额（囤积型） */
  moyu: number;
  levels: Levels;
  /** 引擎实算点击力（含底薪 0？点击力 = 1 + effect.clickPower） */
  cp: number;
  /** 引擎实算挂机率（含底薪 0.2） */
  ir: number;
  /** 报告自报 clickPower（用于 sanity 对照） */
  reportCp: number;
  reportIr: number;
}

/** 读 playtest/report.json：4 画像 × 8 检查点的真实进度 */
export function loadReport(): { generatedAt: string; engine: string; sessions: { persona: string; checkpoints: { minute: number; moyu: number; clickPower: number; idleRate: number; levels: Levels }[] }[] } {
  return JSON.parse(readFileSync("playtest/report.json", "utf8"));
}

export function stateFrom(levels: Levels, moyu: number): GameState {
  return { ...initialState(), levels: { ...levels }, moyu, totalEarned: Math.max(0, moyu) };
}

export function eff(state: GameState): { cp: number; ir: number } {
  const e = effectOf(state);
  return { cp: 1 + e.clickPower, ir: e.idleRate };
}

/** report.json 全部检查点 → 场景（cp/ir 由引擎重算） */
export function loadScenes(): Scene[] {
  const rep = loadReport();
  const out: Scene[] = [];
  for (const s of rep.sessions) {
    for (const c of s.checkpoints) {
      const st = stateFrom(c.levels, c.moyu);
      const e = eff(st);
      out.push({
        persona: s.persona,
        minute: c.minute,
        moyu: c.moyu,
        levels: { ...c.levels },
        cp: e.cp,
        ir: e.ir,
        reportCp: c.clickPower,
        reportIr: c.idleRate,
      });
    }
  }
  return out;
}

/** 显式开一场 hold 巡逻（绝对时间 now 起 8s） */
export function openHold(es: EventState, now: number): void {
  es.nextBossAt = Infinity;
  es.nextMemeAt = Infinity;
  es.bossUntil = now + BOSS_DURATION;
  es.bossStartAt = now;
  es.bossCaught = false;
  es.surviveStreak = es.surviveStreak ?? 0;
  // batch6 字段：显式锁 hold，防止随机变体干扰
  (es as unknown as Record<string, unknown>).bossVariant = HOLD;
  (es as unknown as Record<string, unknown>).bossTaps = 0;
}

/** main.ts 连击链状态机：<0.4s 累积、>3s 清零、封顶 12 */
export function stepCombo(combo: number, gap: number): number {
  if (gap < COMBO_WINDOW_S) return Math.min(COMBO_MAX, combo + 1);
  if (gap > COMBO_BREAK_S) return 0;
  return combo;
}

export interface ComboRun {
  clicks: number;
  income: number;
  baseline: number;
  /** 收入提升幅度（0.237 = +23.7%） */
  lift: number;
  avgMult: number;
  mults: number[];
  comboAtEnd: number;
  /** 达到封顶 12 连击所需时间（秒；冷启动） */
  timeToCap: number;
}

/** 持续点击 seconds 秒、cps 次/秒：按 main.ts 连击状态机累计收入 */
export function comboRun(cp: number, cps: number, seconds: number, opts: { initialCombo?: number; coldStart?: boolean } = {}): ComboRun {
  const n = Math.floor(seconds * cps + 1e-9);
  const hot = (opts.initialCombo ?? 0) > 0;
  let combo = opts.initialCombo ?? 0;
  let lastAt = hot ? -1 / cps : -1e9;
  let income = 0;
  let timeToCap = Infinity;
  const mults: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / cps;
    combo = stepCombo(combo, t - lastAt);
    lastAt = t;
    if (combo >= COMBO_MAX && timeToCap === Infinity) timeToCap = t;
    const m = comboMultiplier(combo);
    mults.push(m);
    income += cp * m;
  }
  const baseline = n * cp;
  return { clicks: n, income, baseline, lift: baseline > 0 ? income / baseline - 1 : 0, avgMult: baseline > 0 ? income / baseline : 1, mults, comboAtEnd: combo, timeToCap };
}

export interface PatrolSim {
  taps: number;
  income: number;
  lost: number;
  caught: boolean;
  /** 余额净变化 = 收入 - 罚款 */
  moyuDelta: number;
  comboAtEnd: number;
  /** 8s 窗口内点击收入 / 期间挂机收入（用于和奖励换算） */
  incomeIdleSeconds: number;
}

/**
 * 真实引擎跑一次巡逻点击窗口。
 * cps：每秒点击数；hot：进巡逻时是否已带满连击（活跃点击玩家 = true）。
 * graceOnly：只点宽限内（0.8s）然后收手 —— 用于检验宽限偷点。
 */
export function simPatrol(state: GameState, cps: number, opts: { hot?: boolean; graceOnly?: boolean } = {}): PatrolSim {
  const now = 1000;
  const es = newEventState();
  openHold(es, now);
  const hot = opts.hot ?? cps > 2.5;
  let combo = hot ? COMBO_MAX : 0;
  let lastAt = hot ? -1 / cps : -1e9;
  let st = state;
  let income = 0;
  let lost = 0;
  let caught = false;
  let taps = 0;
  for (let i = 0; ; i++) {
    const t = i / cps;
    if (t >= BOSS_DURATION) break;
    if (opts.graceOnly && t >= BOSS_GRACE_SECONDS) break;
    combo = stepCombo(combo, t - lastAt);
    lastAt = t;
    const r = onBossTap(st, es, now + t, combo);
    st = r.state;
    income += r.income;
    lost += r.lost;
    caught = caught || r.caught;
    taps += 1;
  }
  const ir = eff(state).ir;
  return { taps, income, lost, caught, moyuDelta: income - lost, comboAtEnd: combo, incomeIdleSeconds: income / ir };
}

/** 忍：不点，拿安然奖励（含连胜乘数） */
export function softEV(state: GameState, streak = 0): number {
  const es = newEventState();
  es.surviveStreak = streak;
  return bossSurviveReward(state, es);
}

export interface Decision {
  cp: number;
  ir: number;
  cps: number;
  soft: number;
  hard: number;
  /** >0 = 硬刚占优（真赌点） */
  delta: number;
  penalty: number;
  penaltyIdleSeconds: number;
  rewardIdleSeconds: number;
  caught: boolean;
}

/** 忍 EV vs 硬刚 EV（硬刚 = 巡逻 8s 全程照点，赌点决策口径） */
export function decision(state: GameState, cps: number, streak = 0, opts: { hot?: boolean } = {}): Decision {
  const e = eff(state);
  const soft = softEV(state, streak);
  const hard = simPatrol(state, cps, opts).moyuDelta;
  const p = simPatrol(state, cps, opts);
  return {
    cp: e.cp,
    ir: e.ir,
    cps,
    soft,
    hard,
    delta: hard - soft,
    penalty: p.lost,
    penaltyIdleSeconds: p.lost / e.ir,
    rewardIdleSeconds: soft / e.ir,
    caught: p.caught,
  };
}

/** 扫描 cps，返回硬刚首次占优的 cps（无则 null） */
export function flipCps(state: GameState, streak = 0, opts: { hot?: boolean; max?: number; step?: number } = {}): number | null {
  const max = opts.max ?? 12;
  const step = opts.step ?? 0.25;
  for (let cps = step; cps <= max + 1e-9; cps += step) {
    if (decision(state, cps, streak, opts).delta > 0) return +cps.toFixed(2);
  }
  return null;
}

/** 可复现 LCG */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface HourRun {
  patrols: number;
  rewards: number[];
  totalReward: number;
  idleIncome: number;
  streakEnd: number;
}

/**
 * 1 小时真实调度（scheduleEvents 驱动）且全程忍住：
 * 显式锁 hold 变体，统计巡逻次数 / 安然奖励总额 / 同期挂机收入。
 */
export function simulatePatrolHour(state: GameState, seed = 7): HourRun {
  const rng = lcg(seed);
  const es = newEventState();
  let st = state;
  let prevActive = false;
  let patrols = 0;
  const rewards: number[] = [];
  const idleIncome = eff(state).ir * 3600;
  for (let t = 0; t <= 3600 + 1e-9; t += 0.1) {
    scheduleEvents(es, t, rng);
    const active = es.bossUntil > t;
    if (active && !prevActive) {
      // 本轮只验收 hold 语义（batch6 变体不在本次范围）
      (es as unknown as Record<string, unknown>).bossVariant = HOLD;
      patrols += 1;
    }
    if (prevActive && !active) {
      const r = finishPatrol(st, es);
      st = r.state;
      rewards.push(r.reward);
    }
    prevActive = active;
  }
  return { patrols, rewards, totalReward: rewards.reduce((a, b) => a + b, 0), idleIncome, streakEnd: es.surviveStreak };
}

/** 数字取整（表格用） */
export const r0 = (n: number): number => Math.round(n);
export const r1 = (n: number): number => +n.toFixed(1);
export const r2 = (n: number): number => +n.toFixed(2);
export const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

export { BOSS_DURATION, BOSS_GRACE_SECONDS, SURVIVE_STREAK_CAP, comboMultiplier, COMBO_MAX, COMBO_WINDOW_S, COMBO_BREAK_S };
