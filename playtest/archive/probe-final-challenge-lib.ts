/**
 * probe-final-challenge-lib.ts — 终验（挑战/刺激党）公共库，只读 src/，只在 playtest/ 内使用。
 *
 * 验收对象（HEAD d2b5876）：
 *   ① 偷点 onBossTap：0.8s 宽限 / 每击 0.5×idleRate 罚款 / 单巡逻封顶 6×idleRate / 与余额脱钩
 *   ② 安然连胜 surviveStreak：×(1+0.1N) 封顶 ×2，被抓清零，入存档
 *   ③ 连击链 doClick/stepCombo：<0.4s 累积、1.5s 断点、封顶 12（×1.24）
 *   ④ 巡逻三变体 hold/type/blitz
 *   ⑤ 事件经济占比
 *
 * 所有场景取自 playtest/report.json 实跑检查点 levels（4 画像 × 8 时点），金额由引擎实算。
 * 决定性随机：LCG(seed)，便于复跑。
 */
import { readFileSync } from "node:fs";
import type { GameState } from "../src/engine/state";
import { initialState } from "../src/engine/state";
import { effectOf } from "../src/engine/upgrades";
import {
  COMBO_BREAK_S,
  COMBO_MAX,
  COMBO_WINDOW_S,
  comboMultiplier,
  clickPowerOf,
} from "../src/engine/actions";
import {
  BOSS_BLITZ_REWARD_MULT,
  BOSS_BLITZ_TARGET,
  BOSS_DURATION,
  BOSS_GRACE_SECONDS,
  BOSS_PENALTY_MIN,
  BOSS_REWARD_IDLE_SECONDS,
  BOSS_REWARD_MIN,
  BOSS_STEAL_CAP_IDLE_SECONDS,
  BOSS_STEAL_PENALTY_IDLE_SECONDS,
  BOSS_TYPE_TARGET,
  BOSS_VARIANTS,
  bossSurviveReward,
  finishPatrol,
  newEventState,
  onBossTap,
  scheduleEvents,
  surviveStreakMult,
  type BossVariant,
  type EventState,
} from "../src/engine/events";

export const HOLD: BossVariant = "hold";

export type Levels = Record<string, number>;

export interface Report {
  generatedAt: string;
  engine: string;
  sessions: {
    persona: string;
    checkpoints: { minute: number; moyu: number; clickPower: number; idleRate: number; levels: Levels }[];
  }[];
}

let cachedReport: Report | null = null;

const sleepSync = (ms: number): void => {
  const sab = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(sab, 0, 0, ms);
};

/** 读 playtest/report.json（进程内缓存 + 重试，防其他探针/模拟并发写半截文件） */
export function loadReport(): Report {
  if (cachedReport) return cachedReport;
  let err: unknown = null;
  for (let i = 0; i < 10; i++) {
    try {
      const parsed = JSON.parse(readFileSync("playtest/report.json", "utf8")) as Report;
      if (!Array.isArray(parsed.sessions) || parsed.sessions.length < 4) throw new Error("report 结构不完整");
      cachedReport = parsed;
      return cachedReport;
    } catch (e) {
      err = e;
      sleepSync(60);
    }
  }
  throw err instanceof Error ? err : new Error("report.json 读取失败");
}

export interface Scene {
  persona: string;
  minute: number;
  moyu: number;
  levels: Levels;
  /** 引擎实算点击力 */
  cp: number;
  /** 引擎实算挂机率（含底薪 0.2） */
  ir: number;
  reportCp: number;
  reportIr: number;
}

export function stateFrom(levels: Levels, moyu: number): GameState {
  return { ...initialState(), levels: { ...levels }, moyu, totalEarned: Math.max(0, moyu) };
}

export function eff(state: GameState): { cp: number; ir: number } {
  const e = effectOf(state);
  return { cp: 1 + e.clickPower, ir: e.idleRate };
}

/** report.json 全部检查点（含 minute 0）→ 场景，cp/ir 由引擎重算 */
export function loadScenes(includeMinute0 = true): Scene[] {
  const rep = loadReport();
  const out: Scene[] = [];
  for (const s of rep.sessions) {
    for (const c of s.checkpoints) {
      if (!includeMinute0 && c.minute === 0) continue;
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

/** 中后期场景：idleRate ≥ 1000 且 minute ≥ 30（无脑连点治理的主战场） */
export function lateScenes(minIr = 1000, minMinute = 30): Scene[] {
  return loadScenes().filter((s) => s.ir >= minIr && s.minute >= minMinute);
}

/** 场景短名：clicker@30min */
export function sceneName(s: Scene): string {
  return `${s.persona.split("(")[0]}@${s.minute}min`;
}

/** +++++++++++++++++++++ 巡逻（hold）点击模拟 +++++++++++++++++++++ */

export interface PatrolClickResult {
  /** 窗口内总点击数 */
  taps: number;
  /** 宽限后（计收入/计罚）点击次数 */
  billableTaps: number;
  income: number;
  lost: number;
  /** 净收入 = income - lost */
  net: number;
  caught: boolean;
  /** 结束连击 */
  comboEnd: number;
  /** 平均连击倍率 */
  avgMult: number;
}

/** main.ts 连击状态机：间隔 <0.4s 累积、>1.5s 断点清零、否则保持；封顶 12 */
export function stepCombo(combo: number, gap: number): number {
  if (gap < COMBO_WINDOW_S) return Math.min(COMBO_MAX, combo + 1);
  if (gap > COMBO_BREAK_S) return 0;
  return combo;
}

/** 冷启动：以 cps 连点 warmupS 秒把连击链带到稳态 */
export function steadyCombo(cps: number, warmupS = 8): number {
  const n = Math.floor(warmupS * cps + 1e-9);
  let combo = 0;
  for (let i = 0; i < n; i++) combo = stepCombo(combo, 1 / cps);
  return combo;
}

/** 显式开一场 hold 巡逻（绝对时间 now 起 8s） */
export function openHold(es: EventState, now: number, streak = 0, variant: BossVariant = HOLD): void {
  es.nextBossAt = Infinity;
  es.nextMemeAt = Infinity;
  es.bossUntil = now + BOSS_DURATION;
  es.bossStartAt = now;
  es.bossCaught = false;
  es.surviveStreak = streak;
  es.bossVariant = variant;
  es.bossTaps = 0;
  es.bossPenaltyTotal = 0;
}

/**
 * 真实引擎跑一次巡逻内点击：cps 次/秒、从冷启动（或指定 initialCombo）开始。
 * 与 main.ts 一致：每次点击先推进连击链，再 onBossTap。
 */
export function simPatrolClicks(
  state: GameState,
  cps: number,
  opts: { initialCombo?: number; warmupS?: number; variant?: BossVariant; graceOnly?: boolean } = {},
): PatrolClickResult {
  const start = 1000;
  const variant = opts.variant ?? HOLD;
  const es = newEventState();
  openHold(es, start, 0, variant);
  let combo = opts.initialCombo ?? steadyCombo(cps, opts.warmupS ?? 8);
  let st = state;
  let income = 0;
  let lost = 0;
  let caught = false;
  let taps = 0;
  let billable = 0;
  let multSum = 0;
  const n = Math.floor(BOSS_DURATION * cps + 1e-9);
  for (let i = 0; i < n; i++) {
    const t = i / cps;
    combo = stepCombo(combo, 1 / cps);
    if (opts.graceOnly && t >= BOSS_GRACE_SECONDS) break;
    multSum += comboMultiplier(combo);
    const r = onBossTap(st, es, start + t, combo);
    st = r.state;
    income += r.income;
    lost += r.lost;
    caught = caught || r.caught;
    taps += 1;
    if (r.income > 0) billable += 1;
  }
  return {
    taps,
    billableTaps: billable,
    income,
    lost,
    net: income - lost,
    caught,
    comboEnd: combo,
    avgMult: taps > 0 ? multSum / taps : 1,
  };
}

/** 忍：不点击，直接拿安然奖励（hold 变体，含连胜乘数） */
export function softReward(state: GameState, streak = 0, variant: BossVariant = HOLD): number {
  const base = bossSurviveReward(state, { ...newEventState(), surviveStreak: streak });
  return variant === "blitz" ? base * BOSS_BLITZ_REWARD_MULT : base;
}

/** 硬刚 EV − 忍 EV（>0 = 硬刚占优，赌点成立） */
export function deltaEV(state: GameState, cps: number, streak = 0): number {
  return simPatrolClicks(state, cps).net - softReward(state, streak);
}

/** 单点罚款参数（用于表格） */
export function penaltyParams(state: GameState): { perTap: number; cap: number; idleRate: number } {
  const { ir } = eff(state);
  return {
    perTap: Math.max(BOSS_PENALTY_MIN, BOSS_STEAL_PENALTY_IDLE_SECONDS * ir),
    cap: Math.max(BOSS_PENALTY_MIN, BOSS_STEAL_CAP_IDLE_SECONDS * ir),
    idleRate: ir,
  };
}

/** +++++++++++++++++++++ 1h 事件经济模拟 +++++++++++++++++++++ */

export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface PatrolTick {
  index: number;
  start: number;
  variant: BossVariant;
  /** 巡逻开始时玩家已有的连胜 */
  streakBefore: number;
  /** 忍：本巡逻安然的奖励（含连胜乘数） */
  softReward: number;
  /** 硬刚：8s 全点（该 cps）的净收入（收入−罚款），与连胜无关 */
  hardNet: number;
  /** 硬刚 − 忍（该巡逻决策口径） */
  hardWins: boolean;
}

export interface HourResult {
  /** 巡逻次数 */
  patrols: PatrolTick[];
  /** 忍政策 1h 巡逻奖励总额（连胜滚雪球） */
  dodgeTotal: number;
  /** 硬刚政策 1h 巡逻净收入总额（每场都被抓 → 连胜恒 0） */
  hardTotal: number;
  /** 忍政策连胜终值 */
  streakEnd: number;
  /** 丢梗窗口数 / 丢梗收入（假设每次命中，5×点击力） */
  memeCount: number;
  memeReward: number;
  /** 同期挂机收入 = idleRate × 3600 */
  idleIncome: number;
  /** 逐巡逻胜率（含连胜滚雪球：hardNet > 当时连胜下的忍奖励） */
  winRate: number;
  /**
   * 单次决策口径胜率：硬刚政策下每场都被抓 → 连胜恒 0，
   * 机会成本 = 连胜 0 的安然奖励；逐巡逻 hardNet > base。
   * （=“赌一把 vs 老实忍”的即时胜负，与 1h 全周期滚雪球口径互为参照）
   */
  baseWinRate: number;
  /** 连胜 0 时单场安然奖励（baseWinRate 的对照基准） */
  baseSoft: number;
  /** 1h 政策总收益：忍 = Σ奖励，硬刚 = Σ净收入 */
  policy: { dodge: number; hard: number; winner: "忍" | "硬刚" | "平" };
}

/**
 * 1 小时真实调度（scheduleEvents，dt=0.1s）：
 *  - 忍政策跑完整 1h（连胜滚雪球：0→10→×2）；
 *  - 每场巡逻同时用 simPatrolClicks(cps) 算硬刚净收入，得到逐巡逻胜负；
 *  - 硬刚政策 1h 总额 = Σ hardNet（每场被逮 → 连胜恒 0）。
 * forceHold：只统计 hold 变体（赌点语义），经济统计可关。
 */
export function simHour(
  state: GameState,
  opts: { seed?: number; cps?: number; forceHold?: boolean } = {},
): HourResult {
  const seed = opts.seed ?? 7;
  const cps = opts.cps ?? 8;
  const rng = lcg(seed);
  const es = newEventState();
  const cp = clickPowerOf(state);
  const { ir } = eff(state);
  let st = state;
  const patrols: PatrolTick[] = [];
  let memeCount = 0;
  let prevBoss = false;
  let prevMeme = false;
  let current: { start: number; variant: BossVariant; streakBefore: number; soft: number } | null = null;
  for (let t = 0; t <= 3600 + 1e-9; t += 0.1) {
    scheduleEvents(es, t, rng);
    if (opts.forceHold) es.bossVariant = HOLD; // 巡逻进行中/开启后统一锁 hold
    const boss = es.bossUntil > t;
    const meme = es.memeUntil > t;
    if (boss && !prevBoss) {
      current = {
        start: t,
        variant: es.bossVariant,
        streakBefore: es.surviveStreak,
        soft: softReward(st, es.surviveStreak, es.bossVariant),
      };
    }
    if (!boss && prevBoss && current) {
      const hard = simPatrolClicks(st, cps).net;
      patrols.push({
        index: patrols.length,
        start: current.start,
        variant: current.variant,
        streakBefore: current.streakBefore,
        softReward: current.soft,
        hardNet: hard,
        hardWins: hard > current.soft,
      });
      // 经济模拟：type/blitz 假设玩家完成点击任务（忍政策以外的玩家行为），
      // 使奖励与连胜推进符合真实结算；forceHold 时恒为 hold，无需补计数。
      if (!opts.forceHold) {
        if (es.bossVariant === "type") es.bossTaps = Math.max(es.bossTaps, BOSS_TYPE_TARGET);
        if (es.bossVariant === "blitz") es.bossTaps = Math.max(es.bossTaps, BOSS_BLITZ_TARGET);
      }
      st = finishPatrol(st, es).state;
      current = null;
    }
    if (meme && !prevMeme) {
      memeCount += 1; // 命中一次即收梗（5×点击力），不影响巡逻
    }
    prevBoss = boss;
    prevMeme = meme;
  }
  const dodgeTotal = patrols.reduce((a, p) => a + p.softReward, 0);
  const hardTotal = patrols.reduce((a, p) => a + p.hardNet, 0);
  const winRate = patrols.length ? patrols.filter((p) => p.hardWins).length / patrols.length : 0;
  const baseSoft = softReward(state, 0);
  const baseWinRate = patrols.length ? patrols.filter((p) => p.hardNet > baseSoft).length / patrols.length : 0;
  return {
    patrols,
    dodgeTotal,
    hardTotal,
    streakEnd: es.surviveStreak,
    memeCount,
    memeReward: memeCount * 5 * cp,
    idleIncome: ir * 3600,
    winRate,
    baseWinRate,
    baseSoft,
    policy: {
      dodge: dodgeTotal,
      hard: hardTotal,
      winner: Math.abs(hardTotal - dodgeTotal) < 1e-9 ? "平" : hardTotal > dodgeTotal ? "硬刚" : "忍",
    },
  };
}

/** 数字格式 */
export const r0 = (n: number): number => Math.round(n);
export const r1 = (n: number): number => +n.toFixed(1);
export const r2 = (n: number): number => +n.toFixed(2);
export const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

export {
  BOSS_BLITZ_REWARD_MULT,
  BOSS_BLITZ_TARGET,
  BOSS_DURATION,
  BOSS_GRACE_SECONDS,
  BOSS_PENALTY_MIN,
  BOSS_REWARD_IDLE_SECONDS,
  BOSS_REWARD_MIN,
  BOSS_STEAL_CAP_IDLE_SECONDS,
  BOSS_STEAL_PENALTY_IDLE_SECONDS,
  BOSS_TYPE_TARGET,
  BOSS_VARIANTS,
  COMBO_BREAK_S,
  COMBO_MAX,
  COMBO_WINDOW_S,
  comboMultiplier,
  clickPowerOf,
  surviveStreakMult,
  type BossVariant,
};
