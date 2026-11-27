/**
 * probe-opt-lib.ts — 数值党探针公共库（只在 playtest/ 内使用，不改 src/）。
 * 批次3 适配：引擎 effectOf 已含 底薪0.2/s + 里程碑×2/20；
 * cfEffect(M) 镜像同一结构（M=null 线性、含底薪），cfCost(1.15) 与 costOf 逐级相等。
 * 与引擎语义的等价性断言见 probe-r2-opt-curve.test.ts sanity 段。
 */
import { initialState } from "../src/engine/state";
import type { GameState } from "../src/engine/state";
import { doClick, buyUpgrade, BASE_CLICK_POWER } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { UPGRADES, costOf, effectOf, BASE_IDLE_RATE, MILESTONE_LEVELS } from "../src/engine/upgrades";

export type Tps = number | ((t: number) => number);
export type Levels = Record<string, number>;
export type Eff = { clickPower: number; idleRate: number };
export type CostFn = (id: string, level: number) => number;
export type EffFn = (levels: Levels) => Eff;
/** 购买优先级：返回按优先级排序的升级 id 列表，买到第一个买得起的为止 */
export type OrderFn = (
  state: GameState,
  t: number,
  tpsNow: number,
  income: number,
) => string[];

export const engineCost: CostFn = (id, lv) => costOf(id, lv);
export const engineEffect: EffFn = (levels) => effectOf({ moyu: 0, totalEarned: 0, levels });
export const BASE_SALARY = BASE_IDLE_RATE;

/** 反事实价格曲线：base × factor^level（factor=1.15 时与引擎逐级相等，见 sanity） */
export function cfCost(factor: number, baseScale = 1): CostFn {
  const base = new Map(UPGRADES.map((u) => [u.id, u.baseCost * baseScale]));
  return (id, lv) => {
    const b = base.get(id);
    return b === undefined ? 0 : Math.ceil(b * factor ** lv);
  };
}

/** 反事实效果曲线：镜像引擎结构（底薪 + 每 milestone 级全效果 ×2；null = 纯线性） */
export function cfEffect(milestone: number | null): EffFn {
  const m = milestone ?? MILESTONE_LEVELS; // null = 镜像引擎现行（M=20 + 错峰偏移 + 底薪）
  const offsets = new Map(UPGRADES.map((u, i) => [u.id, (i % 4) * 5]));
  return (levels) => {
    let clickPower = 0;
    let idleRate = BASE_SALARY;
    for (const u of UPGRADES) {
      const lv = levels[u.id] ?? 0;
      if (lv <= 0) continue;
      const mult = 2 ** Math.floor((lv + (offsets.get(u.id) ?? 0)) / m);
      clickPower += (u.clickPower ?? 0) * lv * mult;
      idleRate += (u.idleRate ?? 0) * lv * mult;
    }
    return { clickPower, idleRate };
  };
}

export interface BuyEvent {
  tMin: number;
  id: string;
  name: string;
  cost: number;
  incomeBefore: number;
  incomeAfter: number;
  relGain: number;
  waitSec: number;
}
export interface CurvePoint {
  tMin: number;
  moyu: number;
  totalEarned: number;
  cp: number;
  ir: number;
  income: number;
  levels: Levels;
}

export interface RunOpts {
  minutes: number;
  tps: Tps;
  dt?: number;
  orderFn: OrderFn;
  costFn?: CostFn;
  effectFn?: EffFn;
  /** 反事实额外底薪（仅当 effectFn 为不含底薪的自定义函数时使用；engineEffect/cfEffect 已含 0.2） */
  baselineIdle?: number;
  /** t=0 时先点这么多下（之后按 tps 点击） */
  initialTaps?: number;
  /** 从既有状态续跑（多日循环） */
  initial?: GameState;
  checkpointMinutes?: number[];
}

export interface RunResult {
  events: BuyEvent[];
  curve: CurvePoint[];
  purchases: number;
  firstBuyOf: Record<string, number>;
  endState: GameState;
  totalClickIncome: number;
  totalIdleIncome: number;
}

/** 当前"收入" = tps×点击力 + 挂机（effectFn 已含底薪）+ 额外反事实底薪（单位：摸鱼值/秒） */
export function incomeOf(
  levels: Levels,
  tpsNow: number,
  effectFn: EffFn,
  baseline: number,
): number {
  const eff = effectFn(levels);
  return tpsNow * (BASE_CLICK_POWER + eff.clickPower) + eff.idleRate + baseline;
}

/** 贪心：边际收益/价格 最大者优先。+1 点击力按 tpsNow 折算收入，+1 挂机按 1 折算。
 *  边际价值为 0 的项（挂机党的点击升级）直接跳过：买了纯浪费，会拖慢攒钱。
 *  里程碑跳变（lv19→20 等）通过 effectFn 差分自动计入价值。 */
export function makeGreedy(costFn: CostFn, effectFn: EffFn): OrderFn {
  return (state, _t, tpsNow) => {
    const cur = effectFn(state.levels);
    return [...UPGRADES]
      .map((u) => {
        const lv = state.levels[u.id] ?? 0;
        const nxt = effectFn({ ...state.levels, [u.id]: lv + 1 });
        const value =
          (nxt.clickPower - cur.clickPower) * tpsNow + (nxt.idleRate - cur.idleRate);
        return { id: u.id, eff: value / Math.max(costFn(u.id, lv), 1), value };
      })
      .filter((s) => s.value > 0)
      .sort((a, b) => b.eff - a.eff)
      .map((s) => s.id);
  };
}

/** 只买某类升级（click / idle）的贪心 */
export function makeGreedyFilter(
  costFn: CostFn,
  effectFn: EffFn,
  kind: "click" | "idle",
): OrderFn {
  const base = makeGreedy(costFn, effectFn);
  const allow = new Set(
    UPGRADES.filter((u) => (kind === "click" ? u.clickPower : u.idleRate)).map((u) => u.id),
  );
  return (state, t, tpsNow, income) => base(state, t, tpsNow, income).filter((id) => allow.has(id));
}

/** 屏蔽某一项升级（消融实验） */
export function ablate(order: OrderFn, bannedId: string): OrderFn {
  return (state, t, tpsNow, income) =>
    order(state, t, tpsNow, income).filter((id) => id !== bannedId);
}

/** 逐价排序（模仿 stock 模拟的 cheapest / most_expensive 画像） */
export function byPrice(costFn: CostFn, desc = false): OrderFn {
  return (state) =>
    [...UPGRADES]
      .map((u) => u.id)
      .sort((a, b) => {
        const ca = costFn(a, state.levels[a] ?? 0);
        const cb = costFn(b, state.levels[b] ?? 0);
        return desc ? cb - ca : ca - cb;
      });
}

export function runSim(opts: RunOpts): RunResult {
  const dt = opts.dt ?? 0.25;
  const costFn = opts.costFn ?? engineCost;
  const effectFn = opts.effectFn ?? engineEffect;
  // engineEffect/cfEffect 均已含底薪，额外 baseline 仅用于"无底薪自定义效果"的反事实
  const baseline = effectFn === engineEffect ? 0 : (opts.baselineIdle ?? 0);
  const vanilla = costFn === engineCost && effectFn === engineEffect;
  const tpsAt = (t: number) => (typeof opts.tps === "function" ? opts.tps(t) : opts.tps);

  let state = opts.initial
    ? { moyu: opts.initial.moyu, totalEarned: opts.initial.totalEarned ?? 0, levels: { ...opts.initial.levels } }
    : initialState();
  let purchases = 0;
  let lastBuyT = 0;
  let tapCredit = 0;
  let totalClickIncome = 0;
  let totalIdleIncome = 0;
  const events: BuyEvent[] = [];
  const curve: CurvePoint[] = [];
  const firstBuyOf: Record<string, number> = {};
  const pending = new Set(opts.checkpointMinutes ?? [0, 1, 3, 10, 30, 60, 90, 120, 150, 180]);
  const nameOf = (id: string) => UPGRADES.find((u) => u.id === id)?.name ?? id;

  const applyGain = (amount: number) => {
    state = { ...state, moyu: state.moyu + amount, totalEarned: state.totalEarned + amount };
  };

  const doTap = () => {
    if (vanilla) {
      const s2 = doClick(state);
      totalClickIncome += s2.moyu - state.moyu;
      state = s2;
    } else {
      const gain = BASE_CLICK_POWER + effectFn(state.levels).clickPower;
      applyGain(gain);
      totalClickIncome += gain;
    }
  };

  // t=0 的初始点击（点完就走的挂机党）
  for (let i = 0; i < (opts.initialTaps ?? 0); i++) doTap();

  const steps = Math.round((opts.minutes * 60) / dt);
  for (let i = 0; i <= steps; i++) {
    const t = i * dt;
    const tpsNow = tpsAt(t);

    // 点击（小数点击累计成整数再执行）
    tapCredit += tpsNow * dt;
    while (tapCredit >= 1) {
      tapCredit -= 1;
      doTap();
    }

    // 被动收益（effectFn 已含底薪）
    const ir = effectFn(state.levels).idleRate + baseline;
    if (ir > 0) {
      const gain = ir * dt;
      if (vanilla) {
        state = advance(state, dt);
      } else {
        applyGain(gain);
      }
      totalIdleIncome += gain;
    }

    // 购买循环：按 orderFn 优先级，买到无可买
    for (;;) {
      const income = incomeOf(state.levels, tpsNow, effectFn, baseline);
      const order = opts.orderFn(state, t, tpsNow, income);
      let bought = false;
      for (const id of order) {
        const price = costFn(id, state.levels[id] ?? 0);
        if (price > 0 && state.moyu >= price) {
          const incomeBefore = incomeOf(state.levels, tpsNow, effectFn, baseline);
          if (vanilla) {
            const s2 = buyUpgrade(state, id);
            if (!s2) continue;
            state = s2;
          } else {
            state = { ...state, moyu: state.moyu - price, levels: { ...state.levels, [id]: (state.levels[id] ?? 0) + 1 } };
          }
          const incomeAfter = incomeOf(state.levels, tpsNow, effectFn, baseline);
          purchases += 1;
          if (firstBuyOf[id] === undefined) firstBuyOf[id] = +(t / 60).toFixed(2);
          events.push({
            tMin: +(t / 60).toFixed(3),
            id,
            name: nameOf(id),
            cost: Math.round(price),
            incomeBefore,
            incomeAfter,
            relGain: incomeBefore > 0 ? (incomeAfter - incomeBefore) / incomeBefore : incomeAfter,
            waitSec: +(t - lastBuyT).toFixed(2),
          });
          lastBuyT = t;
          bought = true;
          break;
        }
      }
      if (!bought) break;
    }

    // 检查点（按步进对齐，避免浮点漂移）
    const tMin = t / 60;
    for (const m of [...pending]) {
      if (Math.abs(t - m * 60) <= dt / 2) {
        const eff = effectFn(state.levels);
        curve.push({
          tMin: m,
          moyu: Math.round(state.moyu),
          totalEarned: Math.round(state.totalEarned ?? 0),
          cp: Math.round(BASE_CLICK_POWER + eff.clickPower),
          ir: +(eff.idleRate + baseline).toFixed(2),
          income: +(tpsNow * (BASE_CLICK_POWER + eff.clickPower) + eff.idleRate + baseline).toFixed(2),
          levels: { ...state.levels },
        });
        pending.delete(m);
      }
    }
  }
  return {
    events,
    curve,
    purchases,
    firstBuyOf,
    endState: state,
    totalClickIncome: Math.round(totalClickIncome),
    totalIdleIncome: Math.round(totalIdleIncome),
  };
}

// ---------- 统计工具 ----------

export function quantile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)));
  return s[idx];
}
export const median = (xs: number[]): number => quantile(xs, 0.5);

/** 阶段统计：购买数 / 每次购买相对收益 / 购买间隔 */
export function phaseStats(run: RunResult, fromMin: number, toMin: number) {
  const ev = run.events.filter((e) => e.tMin >= fromMin && e.tMin < toMin);
  const relGains = ev.map((e) => e.relGain);
  const waits = ev.slice(1).map((e) => e.waitSec);
  return {
    purchases: ev.length,
    medianRelGain: +(median(relGains) * 100).toFixed(3),
    p90RelGain: +(quantile(relGains, 0.9) * 100).toFixed(3),
    maxRelGain: +(Math.max(0, ...relGains) * 100).toFixed(3),
    medianWaitSec: Math.round(median(waits)),
    maxWaitSec: Math.round(Math.max(0, ...waits)),
    waitsOver5min: waits.filter((w) => w > 300).length,
    waitsOver30min: waits.filter((w) => w > 1800).length,
  };
}

/** 按 bucket 分钟分桶的每桶购买相对收益 */
export function relGainByBucket(run: RunResult, bucketMin: number, untilMin: number) {
  const out: { bucket: string; purchases: number; medianRelGainPct: number; maxRelGainPct: number }[] = [];
  for (let b = 0; b < untilMin; b += bucketMin) {
    const ev = run.events.filter((e) => e.tMin >= b && e.tMin < b + bucketMin);
    if (ev.length === 0) continue;
    out.push({
      bucket: `${b}-${b + bucketMin}min`,
      purchases: ev.length,
      medianRelGainPct: +(median(ev.map((e) => e.relGain)) * 100).toFixed(3),
      maxRelGainPct: +(Math.max(...ev.map((e) => e.relGain)) * 100).toFixed(2),
    });
  }
  return out;
}
