/**
 * R7 硬核放置老玩家探针公共库 —— 只读 src/，不改任何游戏文件。
 *
 * 画像：500+ 小时 Cookie Clicker / AdVenture Capitalist / Realm Grinder 玩家。
 * 会用计算器/表格自建 optimizer：按「边际收益 / 价格」贪心购买，会攒钱等里程碑，
 * 事件全勤（hold 忍、type 打满 5、blitz 打满 20）。
 *
 * 模型：
 *  - 页面长时间开着（在线挂机）。每 dt 秒复刻 src/main.ts 的 frame：
 *      scheduleEvents → 巡逻结算 finishPatrol → advance（挂机收入）
 *  - 点击按「平均 cps」折算成连续收入：点击收入/秒 = clickPowerOf(state) × cps × 平均连击 1.16。
 *    cps=0 即纯挂机；点击项购买估值同样用 clickValue = cps×1.16。
 *  - 看店频率 buyInterval 秒一次；购买策略见 buyTick()：全局最优 ROI 项优先，
 *    saveWatchSeconds>0 时若「全局最优项在 N 秒收入内可及」则攒钱等它。
 *  - 图鉴：购买后 syncFlavorCollection（与 main.ts 同）；事件窗口命中语录即 collectQuote。
 *  - 不含每日日报奖励（60 秒挂机收益，24h 内占比 <0.3%，不影响结论）。
 */

import { initialState, gain, type GameState } from "../src/engine/state";
import { buyUpgrade, clickPowerOf } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { UPGRADES, costOf, effectOf, marginalEffect, MILESTONE_LEVELS } from "../src/engine/upgrades";
import {
  newEventState,
  scheduleEvents,
  onBossTap,
  onMemeTap,
  finishPatrol,
  BOSS_TYPE_TARGET,
  BOSS_BLITZ_TARGET,
  type EventState,
} from "../src/engine/events";
import { collectQuote, syncFlavorCollection, collectionCount, TOTAL_ITEMS } from "../src/engine/collection";
import { MEME_QUOTES } from "../src/engine/flavor";
import { rankFor, RANKS } from "../src/engine/titles";
import { formatMoyu } from "../src/engine/format";

export { TOTAL_ITEMS, RANKS, formatMoyu, UPGRADES, costOf, effectOf, marginalEffect, MILESTONE_LEVELS, collectionCount, initialState };
export type { GameState };

export const HOUR = 3600;
/** 时间采样间隔（秒）：反推「达到任意累计收入所需时长」用 */
export const SAMPLE_SECONDS = 900;
export const BLOCK_HOURS = 6;
/**
 * 连击均值：连击窗口 0.4s。≥2.5cps 时稳定 12 连 → ×1.24；低于 2.5cps 会断链 → ×1.0。
 * （真实手速 3cps 才能维持满连）
 */
export function comboMultFor(cps: number): number {
  return cps >= 2.5 ? 1.24 : 1.0;
}

export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface HardConfig {
  seed: number;
  /** 模拟步长（秒）。0.5 = 与 main.ts rAF 同量级 */
  dt: number;
  /** 模拟时长（小时） */
  hours: number;
  /** 看店间隔（秒） */
  buyInterval: number;
  /** 平均点击速度（次/秒，含挂机空档）；0 = 纯挂机 */
  cps: number;
  /** 事件是否全勤（type 打满 / blitz 打满 / hold 忍） */
  doEvents: boolean;
  /** 攒钱窗口（秒）：全局最优项 ≤N 秒收入即可及时，等它；0 = 有就买 */
  saveWatchSeconds: number;
  /**
   * ROI 门槛（0..1）：可负担项 ROI ≥ 全局最优 ROI × 本值时立刻买；否则攒钱等全局最优。
   * 1 = 只买全局最优（硬核 optimizer 的"最优路线"）；0.85 = 留 15% 容差。
   */
  roiRatio?: number;
  /** 攒钱上限（秒）：若等全局最优要超过 N 秒，宁可先买可负担的次优项；0/未设 = 不封顶 */
  maxWaitSeconds?: number;
  /** 长跑近似：事件收益按 share 折算进挂机收入（省算力） */
  approxEventShare?: number;
  /** 额外快照小时点（默认 1h + 每 6h；最后一定补 hours） */
  snapshotHours?: number[];
}

export const DEFAULT_HARD_CFG: HardConfig = {
  seed: 20261127,
  dt: 0.5,
  hours: 72,
  buyInterval: 1,
  cps: 0,
  doEvents: true,
  saveWatchSeconds: 0,
};

export interface ItemSpend {
  id: string;
  name: string;
  isClick: boolean;
  level: number;
  cost: number;
  dIdle: number;
  dClick: number;
  /** 下一级 ROI：Δ挂机(/s) ÷ 价格 */
  idleRoi: number;
  /** 下一级 ROI：Δ点击(点) ÷ 价格 */
  clickRoi: number;
}

export interface Snapshot {
  hours: number;
  totalEarned: number;
  moyu: number;
  idleRate: number;
  clickPower: number;
  levels: Record<string, number>;
  totalLevels: number;
  unlocked: number;
  collection: number;
  quotes: number;
  flavors: number;
  totalClicks: number;
  rankIdx: number;
  rankName: string;
  rankProgress: number;
  toNextRank: number;
  /** 自上一快照以来的收入 */
  blockIncome: number;
  /** 相对上一快照的「每小时收入」倍数（首段 null） */
  blockGrowth: number | null;
  /** 自开局的收入构成 */
  income: { idle: number; click: number; event: number };
  purchases: Record<string, number>;
  bestIdleRoi: number;
  items: ItemSpend[];
}

export interface BlockRow {
  fromHours: number;
  toHours: number;
  income: number;
  growth: number | null;
  totalEarned: number;
  idleRate: number;
  rankName: string;
}

export interface RankCross {
  idx: number;
  name: string;
  atHours: number;
  totalEarned: number;
}

export interface HardSim {
  cfg: HardConfig;
  rng: () => number;
  state: GameState;
  es: EventState;
  t: number;
  combo: number;
  prevBossActive: boolean;
  purchases: Record<string, number>;
  income: { idle: number; click: number; event: number };
  quotesHit: number;
  memesSeen: number;
  patrols: number;
  rankCross: RankCross[];
  snapshots: Snapshot[];
  blocks: BlockRow[];
  at1e6: Snapshot | null;
  atRetireAffordable: Snapshot | null;
  firstBuys: { hours: number; id: string; cost: number }[];
  saveWaits: number;
  roiLog: { hours: number; id: string; roi: number; level: number }[];
  lastBlockStart: number;
  lastBlockIncome: number;
  /** 时间采样（用于反推任意收入阈值所需时长 / 转生设计验证） */
  samples: { hours: number; totalEarned: number; idleRate: number; rankIdx: number }[];
  /** 累计点击（点击线彩蛋门槛用；与引擎同：只有普通点击 doClick 计数） */
  totalClicks: number;
  clickDebt: number;
  lastFlavorSync?: number;
}

function emptyPurchases(): Record<string, number> {
  const r: Record<string, number> = {};
  for (const u of UPGRADES) r[u.id] = 0;
  return r;
}

/** 当前状态的有效收入（/s）：挂机 + 点击（按 clickValue 折算） */
export function incomeRateOf(state: GameState, clickValue: number): number {
  return effectOf(state).idleRate + clickPowerOf(state) * clickValue;
}

export function clickValueOf(cps: number): number {
  return cps * comboMultFor(cps);
}

/** 各项下一级的边际收益 / 价格 */
export function marginalTable(state: GameState, clickValue: number): ItemSpend[] {
  return UPGRADES.map((u) => {
    const lv = state.levels[u.id] ?? 0;
    const m = marginalEffect(u.id, lv);
    const cost = costOf(u.id, lv);
    return {
      id: u.id,
      name: u.name,
      isClick: !!u.clickPower,
      level: lv,
      cost,
      dIdle: m.idleRate,
      dClick: m.clickPower,
      idleRoi: m.idleRate / cost,
      clickRoi: m.clickPower / cost,
    };
  });
}

function bestPurchase(state: GameState, clickValue: number): { id: string; cost: number; roi: number } | null {
  let best: { id: string; cost: number; roi: number } | null = null;
  for (const u of UPGRADES) {
    const lv = state.levels[u.id] ?? 0;
    const m = marginalEffect(u.id, lv);
    const val = m.idleRate + m.clickPower * clickValue;
    if (val <= 0) continue;
    const c = costOf(u.id, lv);
    const roi = val / c;
    if (!best || roi > best.roi) best = { id: u.id, cost: c, roi };
  }
  return best;
}

function bestAffordable(state: GameState, clickValue: number): { id: string; cost: number; roi: number } | null {
  let best: { id: string; cost: number; roi: number } | null = null;
  for (const u of UPGRADES) {
    const lv = state.levels[u.id] ?? 0;
    const m = marginalEffect(u.id, lv);
    const val = m.idleRate + m.clickPower * clickValue;
    if (val <= 0) continue;
    const c = costOf(u.id, lv);
    if (c > state.moyu) continue;
    const roi = val / c;
    if (!best || roi > best.roi) best = { id: u.id, cost: c, roi };
  }
  return best;
}

function buyItem(sim: HardSim, id: string, roi: number): void {
  const next = buyUpgrade(sim.state, id);
  if (!next) return;
  sim.state = syncFlavorCollection(next);
  sim.purchases[id] = (sim.purchases[id] ?? 0) + 1;
  if (sim.firstBuys.length < 300) sim.firstBuys.push({ hours: +(sim.t / HOUR).toFixed(3), id, cost: costOf(id, (next.levels[id] ?? 1) - 1) });
  if (sim.roiLog.length < 5000) sim.roiLog.push({ hours: sim.t / HOUR, id, roi, level: next.levels[id] ?? 1 });
}

/**
 * 硬核购买策略：
 * 1) 全局最优 ROI 项买得起 → 买它；
 * 2) 否则 saveWatchSeconds>0 且攒到全局最优 ≤N 秒 → 攒钱不买；
 * 3) 否则买「可负担项里的最优 ROI」（钱不闲置）；循环直到无可买。
 */
export function buyTick(sim: HardSim): void {
  const cv = clickValueOf(sim.cfg.cps);
  for (let guard = 0; guard < 500; guard++) {
    const best = bestPurchase(sim.state, cv);
    if (!best) return;
    if (sim.state.moyu >= best.cost) {
      buyItem(sim, best.id, best.roi);
      continue;
    }
    const aff = bestAffordable(sim.state, cv);
    if (!aff) return;
    if (sim.cfg.roiRatio !== undefined) {
      if (aff.roi >= sim.cfg.roiRatio * best.roi) {
        buyItem(sim, aff.id, aff.roi);
        continue;
      }
      if (sim.cfg.maxWaitSeconds) {
        const rate = incomeRateOf(sim.state, cv);
        const wait = (best.cost - sim.state.moyu) / Math.max(1e-9, rate);
        if (wait > sim.cfg.maxWaitSeconds) {
          buyItem(sim, aff.id, aff.roi);
          continue;
        }
      }
      sim.saveWaits++;
      return; // 攒钱等全局最优
    }
    if (sim.cfg.saveWatchSeconds > 0) {
      const rate = incomeRateOf(sim.state, cv);
      const wait = (best.cost - sim.state.moyu) / Math.max(1e-9, rate);
      if (wait <= sim.cfg.saveWatchSeconds) {
        sim.saveWaits++;
        return;
      }
    }
    buyItem(sim, aff.id, aff.roi);
  }
}

export function createSim(cfg: HardConfig): HardSim {
  return {
    cfg,
    rng: makeRng(cfg.seed),
    state: initialState(),
    es: newEventState(),
    t: 0,
    combo: cfg.cps >= 2.5 ? 12 : 0,
    prevBossActive: false,
    purchases: emptyPurchases(),
    income: { idle: 0, click: 0, event: 0 },
    quotesHit: 0,
    memesSeen: 0,
    patrols: 0,
    rankCross: [],
    snapshots: [],
    blocks: [],
    at1e6: null,
    atRetireAffordable: null,
    firstBuys: [],
    saveWaits: 0,
    roiLog: [],
    lastBlockStart: 0,
    lastBlockIncome: 0,
    samples: [],
    totalClicks: 0,
    clickDebt: 0,
  };
}

export function snapshotOf(sim: HardSim): Snapshot {
  const s = sim.state;
  const r = rankFor(s.totalEarned);
  const rankIdx = RANKS.findIndex((x) => x.name === r.current);
  let totalLevels = 0;
  let unlocked = 0;
  for (const u of UPGRADES) {
    const lv = s.levels[u.id] ?? 0;
    totalLevels += lv;
    if (lv > 0) unlocked++;
  }
  const cv = clickValueOf(sim.cfg.cps);
  const best = bestPurchase(s, cv);
  return {
    hours: sim.t / HOUR,
    totalEarned: s.totalEarned,
    moyu: s.moyu,
    idleRate: effectOf(s).idleRate,
    clickPower: clickPowerOf(s),
    levels: { ...s.levels },
    totalLevels,
    unlocked,
    collection: collectionCount(s),
    quotes: s.collected.quotes.length,
    flavors: s.collected.flavors.length,
    totalClicks: s.totalClicks,
    rankIdx,
    rankName: r.current,
    rankProgress: r.progress,
    toNextRank: r.next ? r.next.at - s.totalEarned : 0,
    blockIncome: 0,
    blockGrowth: null,
    income: { ...sim.income },
    purchases: { ...sim.purchases },
    bestIdleRoi: best ? best.roi : 0,
    items: marginalTable(s, cv),
  };
}

/** 一步 dt：事件 → 巡逻结算 → 点击收入 → 挂机收入 */
export function step(sim: HardSim, dt: number): void {
  if (dt <= 0) return;
  sim.t += dt;
  const es = sim.es;

  if (!sim.cfg.approxEventShare) {
    scheduleEvents(es, sim.t, sim.rng);
    const bossActive = es.bossUntil > sim.t;
    if (bossActive && sim.cfg.doEvents && es.bossVariant !== "hold") {
      const target = es.bossVariant === "type" ? BOSS_TYPE_TARGET : BOSS_BLITZ_TARGET;
      if (es.bossTaps < target && sim.t >= es.bossStartAt + 0.8) {
        const r = onBossTap(sim.state, es, sim.t, sim.combo);
        sim.state = r.state;
      }
    }
    if (sim.prevBossActive && !bossActive) {
      const r = finishPatrol(sim.state, es);
      sim.state = r.state;
      sim.patrols++;
      sim.income.event += r.reward;
    }
    sim.prevBossActive = bossActive;

    if (es.memeUntil > sim.t) {
      const r = onMemeTap(sim.state, es);
      const qi = Math.floor(sim.rng() * MEME_QUOTES.length);
      const q = collectQuote(r.state, qi);
      sim.state = q.state;
      sim.memesSeen++;
      if (q.isNew) sim.quotesHit++;
    }
  }

  const cv = clickValueOf(sim.cfg.cps);
  if (cv > 0) {
    const clickIncome = clickPowerOf(sim.state) * cv * dt;
    sim.state = gain(sim.state, clickIncome);
    sim.income.click += clickIncome;
    // 普通点击计数（与 main.ts 一致：只有非事件点击会 doClick）
    sim.clickDebt += sim.cfg.cps * dt;
    const clicks = Math.floor(sim.clickDebt);
    if (clicks > 0) {
      sim.clickDebt -= clicks;
      sim.totalClicks += clicks;
      sim.state = { ...sim.state, totalClicks: sim.totalClicks };
      // 每 5s 同步一次图鉴（引擎在购买/读档时同步，这里按点击门槛补）
      if (sim.t - (sim.lastFlavorSync ?? 0) >= 5) {
        sim.lastFlavorSync = sim.t;
        sim.state = syncFlavorCollection(sim.state);
      }
    }
  }

  const idle = effectOf(sim.state).idleRate * dt;
  sim.state = advance(sim.state, dt);
  sim.income.idle += idle;

  if (sim.cfg.approxEventShare) {
    const ev = idle * sim.cfg.approxEventShare;
    sim.state = gain(sim.state, ev);
    sim.income.event += ev;
  }

  while (sim.rankCross.length + 1 < RANKS.length) {
    const next = RANKS[sim.rankCross.length + 1];
    if (!next) break;
    if (sim.state.totalEarned >= next.at) {
      sim.rankCross.push({ idx: sim.rankCross.length + 1, name: next.name, atHours: sim.t / HOUR, totalEarned: sim.state.totalEarned });
    } else break;
  }
  if (!sim.at1e6 && sim.state.totalEarned >= 1_000_000) sim.at1e6 = snapshotOf(sim);
  if (!sim.atRetireAffordable && sim.state.moyu >= 1_000_000) sim.atRetireAffordable = snapshotOf(sim);
}

/** 跑到 hours 小时 */
export function runSim(cfg: HardConfig): HardSim {
  const sim = createSim(cfg);
  const snapHours = new Set<number>(cfg.snapshotHours ?? []);
  snapHours.add(1);
  snapHours.add(cfg.hours);
  const sorted = [...snapHours].filter((h) => h > 0 && h <= cfg.hours).sort((a, b) => a - b);
  let snapIdx = 0;
  const blockMarks: number[] = [];
  for (let h = BLOCK_HOURS; h < cfg.hours; h += BLOCK_HOURS) blockMarks.push(h);
  blockMarks.push(cfg.hours);
  let blockIdx = 0;
  let nextBuy = cfg.buyInterval;
  let prevRate = 0;
  const steps = Math.round((cfg.hours * HOUR) / cfg.dt);
  for (let i = 0; i < steps; i++) {
    step(sim, cfg.dt);
    if (sim.t + 1e-9 >= nextBuy) {
      nextBuy += cfg.buyInterval;
      buyTick(sim);
    }
    while (snapIdx < sorted.length && sim.t / HOUR >= sorted[snapIdx]! - 1e-9) {
      const snap = snapshotOf(sim);
      const prev = sim.snapshots[sim.snapshots.length - 1];
      const period = prev ? snap.hours - prev.hours : snap.hours;
      snap.blockIncome = sim.state.totalEarned - (prev ? prev.totalEarned : 0);
      const curRate = snap.blockIncome / Math.max(1e-9, period);
      snap.blockGrowth = prevRate > 0 && curRate > 0 ? curRate / prevRate : null;
      if (curRate > 0) prevRate = curRate;
      sim.snapshots.push(snap);
      snapIdx++;
    }
    if (i % Math.max(1, Math.round(SAMPLE_SECONDS / cfg.dt)) === 0) {
      const rk = rankFor(sim.state.totalEarned).current;
      sim.samples.push({
        hours: sim.t / HOUR,
        totalEarned: sim.state.totalEarned,
        idleRate: effectOf(sim.state).idleRate,
        rankIdx: RANKS.findIndex((r) => r.name === rk),
      });
    }
    while (blockIdx < blockMarks.length && sim.t / HOUR >= blockMarks[blockIdx]! - 1e-9) {
      const income = sim.state.totalEarned - sim.lastBlockStart;
      const prev = sim.blocks[sim.blocks.length - 1];
      sim.blocks.push({
        fromHours: prev ? prev.toHours : 0,
        toHours: blockMarks[blockIdx]!,
        income,
        growth: prev && prev.income > 0 ? income / prev.income : null,
        totalEarned: sim.state.totalEarned,
        idleRate: effectOf(sim.state).idleRate,
        rankName: rankFor(sim.state.totalEarned).current,
      });
      sim.lastBlockStart = sim.state.totalEarned;
      sim.lastBlockIncome = income;
      blockIdx++;
    }
  }
  return sim;
}

/** 图鉴补齐：距 55/55 还差多少花费（按当前等级逐项买到 Lv.50） */
export function collectionGap(state: GameState): {
  missing: number;
  totalCost: number;
  byItem: { id: string; name: string; from: number; to: number; cost: number }[];
  retireShare: number;
} {
  const byItem: { id: string; name: string; from: number; to: number; cost: number }[] = [];
  let totalCost = 0;
  for (const u of UPGRADES) {
    const lv = state.levels[u.id] ?? 0;
    let cost = 0;
    for (let k = lv; k < 50; k++) cost += costOf(u.id, k);
    if (cost > 0) {
      byItem.push({ id: u.id, name: u.name, from: lv, to: 50, cost });
      totalCost += cost;
    }
  }
  const retire = byItem.find((b) => b.id === "retire");
  return {
    missing: TOTAL_ITEMS - collectionCount(state),
    totalCost,
    byItem: byItem.sort((a, b) => b.cost - a.cost),
    retireShare: retire ? retire.cost / Math.max(1, totalCost) : 0,
  };
}

/** 把预算全砸向单项（从当前 state 起，贪心买最高 ROI 单链）后的增量 */
export function budgetDump(
  state: GameState,
  budget: number,
): { id: string; name: string; isClick: boolean; levels: number; spent: number; dIdle: number; dClick: number; idleRoi: number; clickRoi: number }[] {
  return UPGRADES.map((u) => {
    let lv = state.levels[u.id] ?? 0;
    let spent = 0;
    let dIdle = 0;
    let dClick = 0;
    let guard = 0;
    while (guard++ < 2000) {
      const c = costOf(u.id, lv);
      if (spent + c > budget) break;
      const m = marginalEffect(u.id, lv);
      spent += c;
      dIdle += m.idleRate;
      dClick += m.clickPower;
      lv++;
    }
    return {
      id: u.id,
      name: u.name,
      isClick: !!u.clickPower,
      levels: lv - (state.levels[u.id] ?? 0),
      spent,
      dIdle,
      dClick,
      idleRoi: dIdle / Math.max(1, spent),
      clickRoi: dClick / Math.max(1, spent),
    };
  }).sort((a, b) => b.dIdle - a.dIdle);
}

/** 长跑：只要终档达成时刻与终态 */
export function longRun(maxHours: number, base: Partial<HardConfig> = {}): { sim: HardSim; rank7AtHours: number | null } {
  const cfg: HardConfig = {
    ...DEFAULT_HARD_CFG,
    ...base,
    hours: maxHours,
    snapshotHours: [24, 168, 720],
  };
  const sim = runSim(cfg);
  const hit = sim.rankCross.find((r) => r.idx === RANKS.length - 1);
  return { sim, rank7AtHours: hit ? hit.atHours : null };
}

/** 由时间采样曲线反推「累计收入达到 target 所需小时数」（线性插值，未达返回 null） */
export function makeInverse(samples: { hours: number; totalEarned: number }[]): (target: number) => number | null {
  return (target: number): number | null => {
    if (target <= 0) return 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]!;
      const b = samples[i]!;
      if (b.totalEarned >= target) {
        const denom = b.totalEarned - a.totalEarned;
        const f = denom > 0 ? (target - a.totalEarned) / denom : 1;
        return a.hours + f * (b.hours - a.hours);
      }
    }
    return null;
  };
}

export function levelLine(s: Snapshot): string {
  return UPGRADES.map((u) => `${u.id}:Lv${s.levels[u.id] ?? 0}`).join(" ");
}
