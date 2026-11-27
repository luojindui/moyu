/**
 * R11 计算器党/Excel 玩家探针库（只读 src/，不修改任何游戏文件）。
 *
 * 画像：只离线玩，每天开 1 次（偶尔 2-3 次），每次 10 秒、只做购买、不点屏幕；
 *       目标是用表格算"怎么买，明天离线收益最大"。
 *
 * 每次开页严格复刻 src/main.ts boot 链路（HEAD 4610c76）：
 *   restore() → ensureVisits()（先记回访再算效率）→ offlineEfficiency()
 *   → settleReturn() → syncFlavorCollection() → ensureDaily()
 * 会话：trackDaily("visit") → advance(10s) → 按策略购买（每次买后 syncFlavorCollection + dailyTrack("buy")）
 *       → idleRate>0.5 记 idle 目标 → 满 3/3 领日报 → 可选转生 → serialize(关页时刻)
 * 每次只打开 10 秒，gameTime 不会到首次巡逻的 20s 下限，所以离线党天然遇不到巡逻/丢梗。
 */

import { initialState, type GameState } from "../src/engine/state";
import { buyUpgrade } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { UPGRADES, costOf, effectOf, marginalEffect, milestoneGap, valueScoreOf } from "../src/engine/upgrades";
import { syncFlavorCollection, collectionCount } from "../src/engine/collection";
import { ensureDaily, dailyTrack, dailyAllDone, claimDaily, dailyReward, formatLocalDate } from "../src/engine/daily";
import { serialize, restore, type SaveAdapter } from "../src/engine/save";
import { settleReturn } from "../src/engine/resume";
import { ensureVisits, offlineEfficiency } from "../src/engine/progression";
import { canPrestige, doPrestige, prestigeGain } from "../src/engine/prestige";
import { OFFLINE_CAP_SECONDS, OFFLINE_CAP_WEEK, capForElapsed } from "../src/engine/offline";
import { MAX_LEVEL } from "../src/engine/save";

export const DAY_MS = 86_400_000;
export const HOUR = 3600;
export const OFFLINE_CAP_H = OFFLINE_CAP_SECONDS / HOUR;
export const SESSION_SECONDS = 10;
/** Day1 = 2026-11-01 00:00 本地时间 */
export const EPOCH = new Date(2026, 10, 1, 0, 0, 0).getTime();

/** 挂机线 6 档（离线收益只吃 idleRate；点击线对离线收益 0 贡献） */
export const IDLE_IDS: string[] = UPGRADES.filter((u) => (u.idleRate ?? 0) > 0).map((u) => u.id);
export const BASE_IDLE = 0.2;

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

export function memSave(): SaveAdapter {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
}

export function localDate(ms: number): string {
  return formatLocalDate(new Date(ms));
}
export function dayWindowAt(ms: number): number {
  return Math.floor(new Date(ms).getHours() / 6);
}

/* ------------------------------------------------------------------ *
 *  购买策略：返回"本次打开按顺序要买的升级 id 列表"
 * ------------------------------------------------------------------ */

export type PolicyName = "greedy" | "balanced" | "hoard-big" | "phone-only" | "milestone-pack";

export const POLICY_LABEL: Record<PolicyName, string> = {
  greedy: "贪心（边际挂机/单价最高）",
  balanced: "均衡（等级最低的档轮流升）",
  "hoard-big": "攒钱（只买 ≥2.5 万的会议/深度/躺平）",
  "phone-only": "单卡（只升刷手机）",
  "milestone-pack": "攒里程碑（够整包就买到下次 ×2）",
};

const BASE_COST = new Map(UPGRADES.map((u) => [u.id, u.baseCost]));

/** 下一次里程碑整包：成本 / 收益 / 级数（到达 level+gap 的 ×2 跳变） */
export function milestonePackage(id: string, level: number): { cost: number; gain: number; levels: number } {
  const gap = milestoneGap(id, level);
  let cost = 0;
  let gain = 0;
  for (let i = 0; i < gap; i++) {
    cost += costOf(id, level + i);
    gain += marginalEffect(id, level + i).idle;
  }
  return { cost, gain, levels: gap };
}

/** 在内存副本上离线推演购买序列（与真实 buyUpgrade/扣钱同规则） */
export function planPurchases(state: GameState, policy: PolicyName): string[] {
  const lv: Record<string, number> = { ...state.levels };
  let money = state.moyu;
  const out: string[] = [];
  const levelOf = (id: string): number => lv[id] ?? 0;
  const priceOf = (id: string): number => costOf(id, levelOf(id));
  const afford = (id: string): boolean => levelOf(id) < MAX_LEVEL && money >= priceOf(id);

  for (let guard = 0; guard < 5000; guard++) {
    let pick: string | null = null;
    if (policy === "greedy") {
      let bestScore = -1;
      let bestPrice = Infinity;
      for (const id of IDLE_IDS) {
        if (!afford(id)) continue;
        const score = valueScoreOf(id, levelOf(id)).idle;
        const price = priceOf(id);
        if (score > bestScore + 1e-12 || (Math.abs(score - bestScore) <= 1e-12 && price < bestPrice)) {
          bestScore = score;
          bestPrice = price;
          pick = id;
        }
      }
    } else if (policy === "balanced") {
      // 等级最低的档优先，同等级买最便宜的（"每档都升一点"的均衡流）
      let bestLv = Infinity;
      let bestPrice = Infinity;
      for (const id of IDLE_IDS) {
        if (!afford(id)) continue;
        const l = levelOf(id);
        const p = priceOf(id);
        if (l < bestLv || (l === bestLv && p < bestPrice)) {
          bestLv = l;
          bestPrice = p;
          pick = id;
        }
      }
    } else if (policy === "hoard-big") {
      // 贵=好：只买 baseCost ≥ 25000 的高档，钱不够就全部存着
      let bestBase = -1;
      for (const id of IDLE_IDS) {
        if ((BASE_COST.get(id) ?? 0) < 25000) continue;
        if (!afford(id)) continue;
        const up = UPGRADES.find((u) => u.id === id)!;
        if ((up.idleRate ?? 0) > bestBase) {
          bestBase = up.idleRate ?? 0;
          pick = id;
        }
      }
    } else if (policy === "phone-only") {
      if (afford("phone")) pick = "phone";
    } else {
      // milestone-pack：只看"够买到下一次 ×2"的整包，谁收益/成本最高买谁；都买不起就攒
      let bestRatio = -1;
      for (const id of IDLE_IDS) {
        if (levelOf(id) >= MAX_LEVEL) continue;
        const pkg = milestonePackage(id, levelOf(id));
        if (money < pkg.cost || pkg.levels <= 0) continue;
        const ratio = pkg.gain / pkg.cost;
        if (ratio > bestRatio) {
          bestRatio = ratio;
          pick = id;
        }
      }
      if (pick) {
        const pkg = milestonePackage(pick, levelOf(pick));
        const n = pkg.levels;
        for (let i = 0; i < n; i++) {
          const price = costOf(pick, levelOf(pick));
          money -= price;
          lv[pick] = levelOf(pick) + 1;
          out.push(pick);
        }
        continue;
      }
    }
    if (!pick) break;
    money -= priceOf(pick);
    lv[pick] = levelOf(pick) + 1;
    out.push(pick);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  一次开页（10 秒）→ 一次结算
 * ------------------------------------------------------------------ */

export interface OpenLog {
  day: number;
  openInDay: number;
  at: number;
  /** restore 出来的距上次存档秒数 */
  offlineSeconds: number;
  /** 封顶后实际结算秒数 */
  applied: number;
  /** 本次结算用的离线效率 */
  rate: number;
  idleBefore: number;
  /** 离线进账 */
  earned: number;
  idleAfter: number;
  /** 关页时余额 */
  balance: number;
  purchases: Record<string, number>;
  purchaseCount: number;
  /** 日报领取额（null=没领成） */
  dailyClaimed: number | null;
  dailyGoals: string[];
  dailyRewardValue: number;
  prestiged: number;
  streak: number;
  collection: number;
  /** 本局累计（转生重置） */
  totalEarned: number;
  lifetimeEarned: number;
}

export interface DayLog {
  day: number;
  offlineEarned: number;
  activeEarned: number;
  appliedSeconds: number;
  rateFirst: number;
  idleEnd: number;
  balanceEnd: number;
  purchaseCount: number;
  purchases: Record<string, number>;
  dailyClaims: number;
  prestigePoints: number;
}

export interface SimOptions {
  days: number;
  /** 每天打开的时刻（分钟，0..1439），按顺序 */
  opens: number[];
  policy: PolicyName;
  /** 是否结算日报（纯离线收益对比时可关掉以隔离） */
  daily: boolean;
  /** 转生策略：never / on-threshold（达标即转） */
  prestige: "never" | "on-threshold";
  seed?: number;
  label?: string;
}

export interface SimResult {
  label: string;
  policy: PolicyName;
  opens: OpenLog[];
  days: DayLog[];
  totalOffline: number;
  totalActive: number;
  day7Idle: number;
  day7Balance: number;
  day7Lifetime: number;
  prestigePoints: number;
  /** 每天离线进账 */
  dailyOffline: number[];
}

function closeSave(state: GameState, mem: SaveAdapter, atMs: number): void {
  serialize(state, mem, atMs);
}

export function simulate(opts: SimOptions): SimResult {
  const rng = makeRng(opts.seed ?? 20261101);
  const mem = memSave();
  let state: GameState = initialState();
  let createdAt = EPOCH + opts.opens[0]! * 60_000;
  let fresh = true;
  const opens: OpenLog[] = [];
  const days: DayLog[] = [];
  let prestigePoints = 0;

  for (let day = 1; day <= opts.days; day++) {
    const dayLog: DayLog = {
      day,
      offlineEarned: 0,
      activeEarned: 0,
      appliedSeconds: 0,
      rateFirst: 0,
      idleEnd: 0,
      balanceEnd: 0,
      purchaseCount: 0,
      purchases: {},
      dailyClaims: 0,
      prestigePoints: 0,
    };
    for (let v = 0; v < opts.opens.length; v++) {
      const at = EPOCH + (day - 1) * DAY_MS + opts.opens[v]! * 60_000;
      // ---- boot 链路 ----
      const restored = restore(mem, at);
      state = fresh ? initialState() : restored.state;
      createdAt = restored.createdAt;
      const offSeconds = fresh ? 0 : restored.offlineSeconds;
      state = ensureVisits(state, at);
      const rate = offlineEfficiency(state, createdAt, at);
      const off = fresh ? { applied: 0, earned: 0, state } : settleReturn(state, at - offSeconds * 1000, at, rate);
      state = syncFlavorCollection(off.state);
      state = ensureDaily(state, localDate(at), rng, dayWindowAt(at));
      if (state.daily) state = { ...state, daily: dailyTrack(state.daily, "visit") };
      const goals = (state.daily?.goals ?? []).map((g) => g.id);
      const rewardValue = dailyReward(state);
      const idleBefore = effectOf(state).idleRate;
      const startTotal = state.totalEarned;
      if (!fresh) dayLog.rateFirst = dayLog.rateFirst || rate;
      dayLog.offlineEarned += off.earned;
      dayLog.appliedSeconds += off.applied;
      // ---- 10 秒会话：先吃 10 秒被动，再按策略购买 ----
      state = advance(state, SESSION_SECONDS);
      let purchaseCount = 0;
      const purchases: Record<string, number> = {};
      const plan = planPurchases(state, opts.policy);
      for (const id of plan) {
        const next = buyUpgrade(state, id);
        if (!next) break;
        state = syncFlavorCollection(next);
        if (state.daily) state = { ...state, daily: dailyTrack(state.daily, "buy") };
        purchases[id] = (purchases[id] ?? 0) + 1;
        purchaseCount += 1;
      }
      const idleAfter = effectOf(state).idleRate;
      // 挂机目标：HUD 节流里 idleRate>0.5 才记（离线党第一次买完就满足）
      if (state.daily && idleAfter > 0.5) state = { ...state, daily: dailyTrack(state.daily, "idle") };
      // ---- 日报领取 ----
      let claimed: number | null = null;
      if (opts.daily && state.daily && !state.daily.claimed && dailyAllDone(state.daily)) {
        const r = claimDaily(state, state.daily.date);
        if (r.claimedReward !== null) {
          state = r.state;
          claimed = r.claimedReward;
          dayLog.dailyClaims += 1;
        }
      }
      // ---- 转生（达标即转，放在购买之后；转生清余额） ----
      let gainedPts = 0;
      if (opts.prestige === "on-threshold" && canPrestige(state)) {
        const r = doPrestige(state);
        if (r) {
          state = r.state;
          gainedPts = r.gained;
          prestigePoints += r.gained;
          dayLog.prestigePoints += r.gained;
        }
      }
      const closeAt = at + SESSION_SECONDS * 1000;
      closeSave(state, mem, closeAt);
      fresh = false;
      const activeEarned = Math.max(0, state.totalEarned - startTotal);
      dayLog.activeEarned += activeEarned;
      dayLog.purchaseCount += purchaseCount;
      for (const [k, n] of Object.entries(purchases)) dayLog.purchases[k] = (dayLog.purchases[k] ?? 0) + n;
      opens.push({
        day,
        openInDay: v + 1,
        at,
        offlineSeconds: offSeconds,
        applied: off.applied,
        rate,
        idleBefore,
        earned: off.earned,
        idleAfter,
        balance: state.moyu,
        purchases,
        purchaseCount,
        dailyClaimed: claimed,
        dailyGoals: goals,
        dailyRewardValue: rewardValue,
        prestiged: gainedPts,
        streak: state.daily?.streak ?? 0,
        collection: collectionCount(state),
        totalEarned: state.totalEarned,
        lifetimeEarned: state.lifetimeEarned,
      });
    }
    dayLog.idleEnd = effectOf(state).idleRate;
    dayLog.balanceEnd = state.moyu;
    days.push(dayLog);
  }

  const totalOffline = opens.reduce((a, o) => a + o.earned, 0);
  const dailyOffline = days.map((d) => d.offlineEarned);
  return {
    label: opts.label ?? opts.policy,
    policy: opts.policy,
    opens,
    days,
    totalOffline,
    totalActive: days.reduce((a, d) => a + d.activeEarned, 0),
    day7Idle: days[days.length - 1]!.idleEnd,
    day7Balance: days[days.length - 1]!.balanceEnd,
    day7Lifetime: opens[opens.length - 1]!.lifetimeEarned,
    prestigePoints,
    dailyOffline,
  };
}

/* ------------------------------------------------------------------ *
 *  打开节律分析（1 次 vs 3 次；用引擎函数算效率与封顶）
 * ------------------------------------------------------------------ */

export interface ScheduleRow {
  label: string;
  opens: number[];
  /** 每次结算的等效"满速小时"（applied × rate / 3600） */
  perOpen: { gapHours: number; appliedHours: number; rate: number; effectiveHours: number }[];
  effectiveHoursPerDay: number;
  /** 相对每天 1 次（21:00）的倍率 */
  vsDaily: number;
  /** 占 24h 的比例 */
  coverage: number;
}

/** 稳态日：每天按同一组时刻打开。间隔 = 相邻打开时刻差（第一次打开跨零点），
 *  回访计数按本地日历日重置，效率 = min(1, 0.7 + 0.1×min(visits,3))。
 *  单次结算秒数走真实引擎的 capForElapsed（8h/24h/48h 阶梯）。 */
export function analyzeSchedule(opens: number[]): ScheduleRow {
  const sorted = [...opens].sort((a, b) => a - b);
  const n = sorted.length;
  const perOpen: ScheduleRow["perOpen"] = [];
  for (let i = 0; i < n; i++) {
    const m = sorted[i]!;
    const prev = i === 0 ? sorted[n - 1]! - 24 * 60 : sorted[i - 1]!;
    const gapMin = m - prev;
    const gapHours = gapMin / 60;
    const visits = i + 1; // 当天第几次打开（跨零点后的第一次=1）
    const rate = Math.min(1, 0.7 + Math.min(visits, 3) * 0.1);
    const appliedHours = capForElapsed(gapHours * 3600) / 3600;
    perOpen.push({ gapHours, appliedHours, rate, effectiveHours: appliedHours * rate });
  }
  const effectiveHoursPerDay = perOpen.reduce((a, x) => a + x.effectiveHours, 0);
  return {
    label: sorted.map((m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`).join(" / "),
    opens: sorted,
    perOpen,
    effectiveHoursPerDay,
    vsDaily: 0,
    coverage: effectiveHoursPerDay / 24,
  };
}

/** 用引擎 capForElapsed 求某次间隔实际结算秒数（供报告核对） */
export function appliedSecondsFor(gapHours: number): number {
  return capForElapsed(gapHours * 3600);
}

export { OFFLINE_CAP_WEEK, dailyReward, prestigeGain };
