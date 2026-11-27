/**
 * R8 speedrun 模拟库（只读 src/，不改 src/）。
 * 用真实引擎函数（costOf / marginalEffect / effectOf / clickPowerOf / PRESTIGE_TUNING）
 * 精确模拟「自融资买升级 → 本局累计到阈值 → 转生（保留 80% 等级）」，测到终档 3.2e11 的时间。
 *
 * 两个转生模型：
 *  - CURRENT：当前 HEAD（线性 +75%/点、3×(x/1e8)^0.4 封顶 20、保留 80% 等级）
 *  - LEGACY ：任务简报 HEAD 06041a1（×1.08 复利、2×(x/1e8)^0.4 封顶 20、本局全重置）
 */
import { type GameState } from "../src/engine/state";
import { costOf, marginalEffect, effectOf } from "../src/engine/upgrades";
import { PRESTIGE_TUNING, PRESTIGE_UNLOCK, PRESTIGE_POINT_CAP } from "../src/engine/prestige";

export const TOTAL_TARGET = 3.2e11; // 终档「摸鱼宇宙尽头·终」lifetimeEarned
export const COMBO = 1.24; // 持续 ≥2.5cps 时连击上限
export const IDLE_IDS = ["phone", "toilet", "group", "meeting", "deep", "retire"];
export const CLICK_IDS = ["coffee", "water", "chair"];
const ALL_IDS = [...IDLE_IDS, ...CLICK_IDS];

export type Levels = Record<string, number>;

export interface PrestigeModel {
  name: string;
  mult: (points: number) => number;
  gain: (runTotal: number) => number;
  keepRatio: number;
}

export const CURRENT: PrestigeModel = {
  name: "current-882c7d0",
  mult: (p) => 1 + PRESTIGE_TUNING.perPoint * Math.max(0, p),
  gain: (x) => {
    if (!(x >= PRESTIGE_UNLOCK)) return 0;
    const raw = Math.floor(PRESTIGE_TUNING.gainA * Math.pow(x / PRESTIGE_UNLOCK, PRESTIGE_TUNING.gainB));
    return Math.max(1, Math.min(PRESTIGE_POINT_CAP, raw));
  },
  keepRatio: PRESTIGE_TUNING.keepLevelRatio,
};

export const LEGACY: PrestigeModel = {
  name: "legacy-06041a1",
  mult: (p) => Math.pow(1.08, Math.max(0, p)),
  gain: (x) => {
    if (!(x >= PRESTIGE_UNLOCK)) return 0;
    const raw = Math.floor(2 * Math.pow(x / PRESTIGE_UNLOCK, 0.4));
    return Math.max(1, Math.min(PRESTIGE_POINT_CAP, raw));
  },
  keepRatio: 0,
};

export interface RunOpts {
  model: PrestigeModel;
  prestige: number;
  levels0?: Levels;
  target: number;
  cps?: number;
  collectFull?: boolean;
  maxSeconds?: number;
  /** 每买一次后检查：满足即停（图鉴 Lv50 等用） */
  stopWhen?: (levels: Levels) => boolean;
  /** 记录本局累计跨过这些阈值的时间点 */
  checkpoints?: number[];
}

export interface RunResult {
  time: number;
  reached: boolean;
  earned: number;
  checkpointTimes?: number[];
  levels: Levels;
  idleRate: number;
  clickRate: number;
  spent: number;
  purchases: number;
}

const fullCollected = () => {
  const flavors: number[] = [];
  for (let i = 0; i < 45; i++) flavors.push(i);
  return { quotes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], flavors };
};

/** 从给定等级/转生点出发的单局模拟：自融资买升级到本局累计 target */
export function runFrom(o: RunOpts): RunResult {
  const cps = o.cps ?? 0;
  const collectFull = o.collectFull ?? false;
  const M = o.model.mult(o.prestige);
  const collMul = collectFull ? 1.2 : 1;
  const combo = cps >= 2.5 ? COMBO : 1;
  const items = IDLE_IDS.map((id) => ({ id, click: false }));
  if (cps > 0) for (const id of CLICK_IDS) items.push({ id, click: true });
  const levels: Levels = { ...(o.levels0 ?? {}) };
  const st: GameState = {
    moyu: 0,
    totalEarned: 0,
    levels,
    collected: collectFull ? fullCollected() : { quotes: [], flavors: [] },
    daily: null,
    surviveStreak: 0,
    totalClicks: 0,
    visits: { date: "", count: 0 },
    lifetimeEarned: 0,
    prestige: o.prestige,
  };
  const maxT = o.maxSeconds ?? 60 * 86400;
  let t = 0;
  let moyu = 0;
  let earned = 0;
  let spent = 0;
  let purchases = 0;
  const checkpointTimes: number[] = [];
  const cps_ = o.checkpoints ?? [];
  let cpIdx = 0;

  // 复用同一个 state 对象：effectOf 只读 levels/collected/prestige
  while (earned < o.target && t < maxT) {
    st.moyu = moyu;
    st.totalEarned = earned;
    const eff = effectOf(st);
    const cp = 1 * M + eff.clickPower;
    const clickRate = cps > 0 ? cps * cp * combo : 0;
    const rate = eff.idleRate + clickRate;
    const H = (o.target - earned) / Math.max(rate, 1e-12);

    const cands = items.map((it) => {
      const lv = levels[it.id] ?? 0;
      const c = costOf(it.id, lv);
      const m = marginalEffect(it.id, lv);
      const g = it.click ? m.clickPower * M * collMul * cps * combo : m.idleRate * M * collMul;
      return { ...it, c, g, p: g > 0 ? c / g : Infinity };
    });

    let choice: (typeof cands)[number] | null = null;
    const affordable = cands.filter((c) => c.c <= moyu);
    affordable.sort((a, b) => a.p - b.p);
    choice = affordable[0] ?? null;
    if (choice && choice.p > H) choice = null;
    if (!choice) {
      const worth = cands.filter((c) => c.p <= H);
      if (worth.length === 0) {
        t += H;
        earned = o.target;
        break;
      }
      let next = worth[0]!;
      for (const c of worth) if (c.c - moyu < next.c - moyu) next = c;
      const wait = Math.max(1e-9, (next.c - moyu) / rate);
      // 等待期间可能跨过 checkpoint
      let remainingWait = wait;
      while (cpIdx < cps_.length && earned + rate * remainingWait >= cps_[cpIdx]!) {
        const need = Math.max(0, (cps_[cpIdx]! - earned) / rate);
        checkpointTimes.push(t + need);
        cpIdx++;
      }
      t += wait;
      moyu += rate * wait;
      earned += rate * wait;
      continue;
    }
    moyu -= choice.c;
    spent += choice.c;
    levels[choice.id] = (levels[choice.id] ?? 0) + 1;
    purchases++;
    if (o.stopWhen && o.stopWhen(levels)) break;
  }

  st.moyu = moyu;
  st.totalEarned = earned;
  const eff = effectOf(st);
  const cp = 1 * M + eff.clickPower;
  while (cpIdx < cps_.length) {
    checkpointTimes.push(t);
    cpIdx++;
  }
  return {
    time: t,
    reached: earned >= o.target,
    earned,
    checkpointTimes,
    levels,
    idleRate: eff.idleRate,
    clickRate: cps > 0 ? cps * cp * combo : 0,
    spent,
    purchases,
  };
}

export function applyPrestige(levels: Levels, model: PrestigeModel): Levels {
  const next: Levels = {};
  for (const [k, v] of Object.entries(levels)) next[k] = Math.floor(v * model.keepRatio);
  return next;
}

export interface RunSnap {
  index: number;
  startPrestige: number;
  multiplier: number;
  target: number;
  time: number;
  pointsGained: number;
  endPrestige: number;
  lifetimeAfter: number;
  idleRate: number;
  clickRate: number;
  isFarm: boolean;
}

export interface RouteResult {
  model: string;
  cps: number;
  collectFull: boolean;
  theta: number;
  farmCycles: number;
  time: number;
  lifetime: number;
  prestige: number;
  runs: RunSnap[];
}

export interface RouteOpts {
  model: PrestigeModel;
  cps?: number;
  collectFull?: boolean;
  maxFarmCycles?: number;
}

/** 阈值阈值候选（本局累计 → 点数） */
export const THETAS = [1e8, 2e8, 3e8, 5e8, 7e8, 1e9, 1.5e9, 2e9, 3e9, 4e9, 5e9, 7e9, 1e10, 1.15e10];

/**
 * 搜索「先按阈值 θ 反复转生 n 次，再一口气打终档」的最短路线。
 * 返回全局最优 (θ, n)。
 */
export function searchRoute(o: RouteOpts): RouteResult {
  const cps = o.cps ?? 0;
  const collectFull = o.collectFull ?? false;
  const N = o.maxFarmCycles ?? 80;
  let best: RouteResult | null = null;
  for (const theta of THETAS) {
    // 前置：farm 快照
    let levels: Levels = {};
    let P = 0;
    let life = 0;
    let t = 0;
    const farmRuns: RunSnap[] = [];
    for (let n = 0; n <= N; n++) {
      const remaining = TOTAL_TARGET - life;
      if (remaining <= 0) break;
      const finalR = runFrom({ model: o.model, prestige: P, levels0: levels, target: remaining, cps, collectFull });
      const finalSnap: RunSnap = {
        index: farmRuns.length + 1,
        startPrestige: P,
        multiplier: o.model.mult(P),
        target: remaining,
        time: finalR.time,
        pointsGained: 0,
        endPrestige: P,
        lifetimeAfter: TOTAL_TARGET,
        idleRate: finalR.idleRate,
        clickRate: finalR.clickRate,
        isFarm: false,
      };
      const total = t + finalR.time;
      if (!best || total < best.time) {
        best = {
          model: o.model.name,
          cps,
          collectFull,
          theta,
          farmCycles: n,
          time: total,
          lifetime: TOTAL_TARGET,
          prestige: P,
          runs: [...farmRuns, finalSnap],
        };
      }
      if (remaining <= theta) break;
      // farm 一轮
      const r = runFrom({ model: o.model, prestige: P, levels0: levels, target: theta, cps, collectFull });
      const pts = o.model.gain(theta);
      const snap: RunSnap = {
        index: farmRuns.length + 1,
        startPrestige: P,
        multiplier: o.model.mult(P),
        target: theta,
        time: r.time,
        pointsGained: pts,
        endPrestige: P + pts,
        lifetimeAfter: life + theta,
        idleRate: r.idleRate,
        clickRate: r.clickRate,
        isFarm: true,
      };
      farmRuns.push(snap);
      life += theta;
      t += r.time;
      P += pts;
      levels = applyPrestige(r.levels, o.model);
    }
  }
  return best!;
}

/** 纯挂机不转生：本局直达终档 */
export function noPrestigeRoute(o: RouteOpts): RouteResult {
  const r = runFrom({ model: o.model, prestige: 0, target: TOTAL_TARGET, cps: o.cps ?? 0, collectFull: o.collectFull });
  return {
    model: o.model.name,
    cps: o.cps ?? 0,
    collectFull: o.collectFull ?? false,
    theta: Infinity,
    farmCycles: 0,
    time: r.time,
    lifetime: TOTAL_TARGET,
    prestige: 0,
    runs: [
      {
        index: 1,
        startPrestige: 0,
        multiplier: 1,
        target: TOTAL_TARGET,
        time: r.time,
        pointsGained: 0,
        endPrestige: 0,
        lifetimeAfter: TOTAL_TARGET,
        idleRate: r.idleRate,
        clickRate: r.clickRate,
        isFarm: false,
      },
    ],
  };
}

/** 累计到某 lifetime 节点的时间（用于关键节点表） */
export function timeToLifetime(route: RouteResult, lifetime: number): number | null {
  if (lifetime > route.lifetime) return null;
  let t = 0;
  for (const r of route.runs) {
    const prev = r.lifetimeAfter - r.target;
    if (lifetime <= r.lifetimeAfter) {
      const frac = r.target > 0 ? (lifetime - prev) / r.target : 1;
      return t + r.time * Math.min(1, Math.max(0, frac));
    }
    t += r.time;
  }
  return null;
}

/** 集满图鉴所需：6 个挂机项各 Lv.50 的累计成本 */
export function costToLevel(id: string, level: number): number {
  let c = 0;
  for (let l = 0; l < level; l++) c += costOf(id, l);
  return c;
}
export const COLLECTION_LEVEL = 50;
export function collectionIdleCost(): { per: Record<string, number>; total: number } {
  const per: Record<string, number> = {};
  let total = 0;
  for (const id of IDLE_IDS) {
    const c = costToLevel(id, COLLECTION_LEVEL);
    per[id] = c;
    total += c;
  }
  return { per, total };
}

export function comboOf(cps: number): number {
  return cps >= 2.5 ? COMBO : 1;
}

export { ALL_IDS };
