/**
 * R9 佛系零操作玩家探针（只读 src/，不改 src/）。
 *
 * 画像：纯挂机党，每天只开 2 次页面（各 30 秒），只买东西、不点击。
 * 用真实引擎函数（offline/resume/tick/daily/collection/prestige + main.ts 的 boot 顺序）复现 14 天：
 *   开页 = ensureVisits → settleReturn(离线, 8h 封顶 × 效率) → syncFlavorCollection → ensureDaily(6h 时段)
 *        → 买东西 → 在线 30s 挂机 → 再买东西 → 存盘
 * 产出：playtest/r9-zen-report.json + 控制台 markdown。
 *
 * 运行：PATH 切换 node22 后 `node_modules/.bin/vite-node playtest/probe-r9-zen.ts`
 */
import { initialState, type GameState } from "../src/engine/state";
import { advance } from "../src/engine/tick";
import { effectOf, costOf, marginalEffect, valueScoreOf, UPGRADES } from "../src/engine/upgrades";
import { buyUpgrade } from "../src/engine/actions";
import { offlineEarn, OFFLINE_CAP_SECONDS } from "../src/engine/offline";
import { ensureVisits, offlineEfficiency, FIRST_DAY_MS } from "../src/engine/progression";
import { syncFlavorCollection, collectionCount, TOTAL_ITEMS } from "../src/engine/collection";
import {
  ensureDaily,
  dailyTrack,
  dailyAllDone,
  formatLocalDate,
  DAILY_WINDOWS_PER_DAY,
  DAILY_GOAL_TEMPLATES,
  type DailyGoal,
} from "../src/engine/daily";
import { rankFor } from "../src/engine/titles";
import { canPrestige, prestigeGain, prestigeThreshold, prestigeMultiplier, doPrestige } from "../src/engine/prestige";
import {
  BOSS_INTERVAL_MIN,
  BOSS_INTERVAL_MAX,
  BOSS_DURATION,
  MEME_INTERVAL_MIN,
  MEME_INTERVAL_MAX,
  BOSS_TYPE_TARGET,
  BOSS_BLITZ_TARGET,
} from "../src/engine/events";
import { writeFileSync } from "node:fs";

// ---------------- 基础设施 ----------------
type BuyPolicy = "idleBest" | "idleCheapest" | "anyCheapest" | "none";
const IDLE_IDS = UPGRADES.filter((u) => u.idleRate).map((u) => u.id);
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dateStr = (ms: number): string => formatLocalDate(new Date(ms));
const windowOf = (ms: number): number => Math.floor(new Date(ms).getHours() / (24 / DAILY_WINDOWS_PER_DAY));

interface GoalSnap {
  id: string;
  desc: string;
  done: boolean;
  progress: number;
  target: number;
}

function goalSnap(goals: DailyGoal[]): GoalSnap[] {
  return goals.map((g) => ({
    id: g.id,
    desc: DAILY_GOAL_TEMPLATES.find((t) => t.id === g.id)?.desc ?? g.id,
    done: g.done,
    progress: g.progress,
    target: g.target,
  }));
}

/** 买买买：按策略反复购买直到买不起 */
function buyLoop(state: GameState, policy: BuyPolicy, maxBuys = Infinity): { state: GameState; buys: number; spent: number } {
  if (policy === "none") return { state, buys: 0, spent: 0 };
  let buys = 0;
  let spent = 0;
  while (buys < maxBuys) {
    const candidates = UPGRADES.filter((u) => state.moyu >= costOf(u.id, state.levels[u.id] ?? 0)).map((u) => ({
      id: u.id,
      cost: costOf(u.id, state.levels[u.id] ?? 0),
      idle: u.idleRate ? valueScoreOf(u.id, state.levels[u.id] ?? 0).idle : -1,
      click: u.clickPower ? valueScoreOf(u.id, state.levels[u.id] ?? 0).click : -1,
    }));
    if (candidates.length === 0) break;
    let pick: (typeof candidates)[number] | null = null;
    if (policy === "idleBest") {
      const idle = candidates.filter((c) => c.idle >= 0).sort((a, b) => b.idle - a.idle);
      pick = idle[0] ?? null;
    } else if (policy === "idleCheapest") {
      const idle = candidates.filter((c) => c.idle >= 0).sort((a, b) => a.cost - b.cost);
      pick = idle[0] ?? null;
    } else {
      // anyCheapest：像不看标签的玩家一样，从最便宜的开始点
      pick = candidates.slice().sort((a, b) => a.cost - b.cost)[0] ?? null;
    }
    if (!pick) break;
    const next = buyUpgrade(state, pick.id);
    if (!next) break;
    spent += pick.cost;
    buys++;
    state = syncFlavorCollection(next); // 复刻 shop 回调
    if (state.daily) state = { ...state, daily: dailyTrack(state.daily, "buy") };
  }
  return { state, buys, spent };
}

// ---------------- 单次运行时事件检查（解释为什么零操作看不到巡逻/梗） ----------------
function firstEventTiming(): { firstBossMin: number; firstBossMax: number; firstMemeMin: number; firstMemeMax: number } {
  return {
    firstBossMin: BOSS_INTERVAL_MIN,
    firstBossMax: BOSS_INTERVAL_MAX,
    firstMemeMin: MEME_INTERVAL_MIN,
    firstMemeMax: MEME_INTERVAL_MAX + 0,
  };
}

// ---------------- 主模拟 ----------------
export interface ZenOpts {
  days: number;
  openHours: number[]; // 每天开页的时刻（本地小时）
  sessionSeconds: number;
  buyPolicy: BuyPolicy;
  seed: number;
  /** 模拟起点：Day1 00:00 本地 */
  baseDayMs: number;
  /** 是否在每次开页时（若可转生）自动转生：量化"佛系党不知道转生"的代价 */
  prestigeAuto: boolean;
  /** 每次开页最多点几次购买卡（佛系党"懒得买"的敏感度，默认不限） */
  maxBuysPerSession?: number;
  /** 建档时间相对首次开页的偏移（真实存档 createdAt = 首次自动存盘 ≈ 首开 +10s） */
  createdAtOffsetSec?: number;
}

interface DayRow {
  day: number;
  idleRate: number;
  rank: string;
  rankNext: string | null;
  rankProgress: number;
  collection: number;
  goalsDone: number;
  goalsTotal: number;
  claimable: boolean;
  dailyGoalIds: string[];
  dailyIncome: number;
  lifetimeEarned: number;
  levels: Record<string, number>;
  canPrestige: boolean;
  prestigeThreshold: number;
  prestigeGainIfAny: number;
  /** 当日离线结算实况 */
  offlineAppliedHours: number;
  offlineRates: number[];
  buys: number;
  /** 当日有效挂机秒数（离线×效率 + 在线）占 24h 比例 */
  coverage: number;
}

interface SessionRow {
  day: number;
  open: number;
  date: string;
  window: number;
  gapHours: number;
  offlineRate: number;
  offlineAppliedHours: number;
  offlineEarned: number;
  liveEarned: number;
  buys: number;
  idleRateAfter: number;
  goals: GoalSnap[];
  allDone: boolean;
  clicks: number;
  memes: number;
  patrols: number;
}

export interface ZenResult {
  opts: ZenOpts;
  days: DayRow[];
  sessions: SessionRow[];
  totals: {
    earned: number;
    offlineEarned: number;
    liveEarned: number;
    buys: number;
    clicks: number;
    memes: number;
    patrols: number;
    goalsCompleted: number;
    goalsTotal: number;
    claims: number;
    collection: number;
    endIdleRate: number;
    endLifetimeEarned: number;
    endRank: string;
    prestigeUnlockedDay: number | null;
    prestiges: number;
    prestigePoints: number;
    idleLevels: Record<string, number>;
    clickLevels: Record<string, number>;
  };
}

export function simulateZen(o: ZenOpts): ZenResult {
  const rng = mulberry32(o.seed);
  let state = initialState();
  let lastSaveMs = o.baseDayMs + o.openHours[0]! * HOUR_MS;
  const createdAt = lastSaveMs + (o.createdAtOffsetSec ?? 0) * 1000;
  const days: DayRow[] = [];
  const sessions: SessionRow[] = [];

  const totals = {
    earned: 0,
    offlineEarned: 0,
    liveEarned: 0,
    buys: 0,
    clicks: 0,
    memes: 0,
    patrols: 0,
    goalsCompleted: 0,
    goalsTotal: 0,
    claims: 0,
    collection: 0,
    endIdleRate: 0,
    endLifetimeEarned: 0,
    endRank: "",
    prestigeUnlockedDay: null as number | null,
    prestiges: 0,
    prestigePoints: 0,
    idleLevels: {} as Record<string, number>,
    clickLevels: {} as Record<string, number>,
  };

  for (let d = 1; d <= o.days; d++) {
    const dayStartEarned = state.totalEarned;
    const dayStartLifetime = state.lifetimeEarned;
    let lastGoals: GoalSnap[] = [];
    let lastAllDone = false;
    let dayBuys = 0;
    let offHours = 0;
    let effIdleSeconds = 0;
    const offRates: number[] = [];

    for (let i = 0; i < o.openHours.length; i++) {
      const nowMs = o.baseDayMs + (d - 1) * DAY_MS + o.openHours[i]! * HOUR_MS;
      const gapSeconds = Math.max(0, (nowMs - lastSaveMs) / 1000);
      // 1) 回访计数（main.ts boot 第一步）
      state = ensureVisits(state, nowMs);
      // 2) 离线结算（8h 封顶 × 效率）
      const rate = offlineEfficiency(state, createdAt, nowMs);
      const off = offlineEarn(state, gapSeconds, rate);
      state = off.state;
      state = syncFlavorCollection(state);
      // 3) 日报：同日跨时段会重掷目标（进度清零）
      state = ensureDaily(state, dateStr(nowMs), rng, windowOf(nowMs));
      const liveBefore = state.totalEarned;
      // 4) 买买买（离线钱到账后）
      const b1 = buyLoop(state, o.buyPolicy, o.maxBuysPerSession ?? Infinity);
      state = b1.state;
      // 5) 在线 30 秒纯挂机（不点）
      state = advance(state, o.sessionSeconds);
      const b2 = buyLoop(state, o.buyPolicy, o.maxBuysPerSession ?? Infinity);
      state = b2.state;
      // 6) 佛系党不会点开的「离职再就业」：这里做对照变体，量化错过的倍率
      if (o.prestigeAuto && canPrestige(state)) {
        const pr = doPrestige(state);
        if (pr) {
          state = pr.state;
          totals.prestiges += 1;
          totals.prestigePoints += pr.gained;
        }
      }
      const buys = b1.buys + b2.buys;
      dayBuys += buys;
      totals.buys += buys;
      totals.offlineEarned += off.earned;
      totals.liveEarned += state.totalEarned - liveBefore;
      totals.earned = state.totalEarned;
      offHours += off.applied / 3600;
      effIdleSeconds += off.applied * rate + o.sessionSeconds;
      offRates.push(rate);
      lastSaveMs = nowMs + o.sessionSeconds * 1000;

      const snap = goalSnap(state.daily?.goals ?? []);
      lastGoals = snap;
      lastAllDone = state.daily ? dailyAllDone(state.daily) : false;
      totals.goalsTotal += snap.length;
      totals.goalsCompleted += snap.filter((g) => g.done).length;
      sessions.push({
        day: d,
        open: i + 1,
        date: dateStr(nowMs),
        window: windowOf(nowMs),
        gapHours: gapSeconds / 3600,
        offlineRate: rate,
        offlineAppliedHours: off.applied / 3600,
        offlineEarned: off.earned,
        liveEarned: state.totalEarned - liveBefore,
        buys,
        idleRateAfter: effectOf(state).idleRate,
        goals: snap,
        allDone: lastAllDone,
        clicks: 0,
        memes: 0,
        patrols: 0,
      });
    }

    const rank = rankFor(state.lifetimeEarned);
    const collection = collectionCount(state);
    const idleLevels: Record<string, number> = {};
    const clickLevels: Record<string, number> = {};
    for (const u of UPGRADES) (u.idleRate ? idleLevels : clickLevels)[u.id] = state.levels[u.id] ?? 0;
    days.push({
      day: d,
      idleRate: effectOf(state).idleRate,
      rank: rank.current,
      rankNext: rank.next?.name ?? null,
      rankProgress: rank.progress,
      collection,
      goalsDone: lastGoals.filter((g) => g.done).length,
      goalsTotal: lastGoals.length,
      claimable: lastAllDone,
      dailyGoalIds: lastGoals.map((g) => g.id),
      dailyIncome: state.lifetimeEarned - dayStartLifetime,
      lifetimeEarned: state.lifetimeEarned,
      levels: { ...state.levels },
      canPrestige: canPrestige(state),
      prestigeThreshold: prestigeThreshold(state),
      prestigeGainIfAny: prestigeGain(state),
      offlineAppliedHours: offHours,
      offlineRates: offRates,
      buys: dayBuys,
      coverage: effIdleSeconds / 86400,
    });
    if (totals.prestigeUnlockedDay === null && canPrestige(state)) totals.prestigeUnlockedDay = d;
    void dayStartEarned;
    totals.collection = collection;
    totals.endIdleRate = effectOf(state).idleRate;
    totals.endLifetimeEarned = state.lifetimeEarned;
    totals.endRank = rank.current;
  }

  // 终局点击/挂机等级拆解
  for (const u of UPGRADES) {
    if (u.idleRate) totals.idleLevels[u.id] = state.levels[u.id] ?? 0;
    else totals.clickLevels[u.id] = state.levels[u.id] ?? 0;
  }
  totals.claims = 0;
  totals.clicks = 0;
  totals.memes = 0;
  totals.patrols = 0;
  return { opts: o, days, sessions, totals };
}

// ---------------- 分析 ----------------
function short(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  const a = Math.abs(n);
  if (a >= 1e8) return `${(n / 1e8).toFixed(2)}e8`;
  if (a >= 1e4) return `${(n / 1e4).toFixed(2)}w`;
  if (a >= 100) return n.toFixed(0);
  if (a >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

const BASE_DAY = new Date(2026, 0, 5, 0, 0, 0, 0).getTime(); // 2026-01-05 周一 00:00 本地
void BASE_DAY;

// ---------------- 主流程 ----------------
const twoOpens: ZenOpts = {
  days: 14,
  openHours: [9, 21],
  sessionSeconds: 30,
  buyPolicy: "idleBest",
  seed: 20260105,
  baseDayMs: new Date(2026, 0, 5, 0, 0, 0, 0).getTime(),
  prestigeAuto: false,
};

const main = simulateZen(twoOpens);
const threeOpens = simulateZen({ ...twoOpens, openHours: [9, 13, 21], seed: 20260106, prestigeAuto: false });
const noBuy = simulateZen({ ...twoOpens, buyPolicy: "none", seed: 20260107, prestigeAuto: false });
const naiveBuy = simulateZen({ ...twoOpens, buyPolicy: "anyCheapest", seed: 20260108, prestigeAuto: false });
const autoPrestige = simulateZen({ ...twoOpens, seed: 20260109, prestigeAuto: true });
const buy1 = simulateZen({ ...twoOpens, seed: 20260110, maxBuysPerSession: 1 });
const buy3 = simulateZen({ ...twoOpens, seed: 20260111, maxBuysPerSession: 3 });
const buy5 = simulateZen({ ...twoOpens, seed: 20260112, maxBuysPerSession: 5 });
// 真实存档 createdAt 是首次 10s 自动存盘时刻（≈ 首开 +10s），会顺延"首日全额"边界到 D2 首次结算
const realCreatedAt = simulateZen({ ...twoOpens, seed: 20260113, createdAtOffsetSec: 10 });

// —— 纯挂机图鉴上限（理论）——
const idleUpgradeCount = UPGRADES.filter((u) => u.idleRate).length;
const clickUpgradeCount = UPGRADES.filter((u) => u.clickPower).length;
const quoteCount = TOTAL_ITEMS - UPGRADES.length * 5;
const theoreticalIdleCap = idleUpgradeCount * 5; // 30
const mustClickHard = clickUpgradeCount * 5; // 15（累计点击阈值）
const mustClickSoft = quoteCount; // 10（点掉梗才掉语录）

// —— 巡逻/丢梗能否出现在 30s 会话里 ——
const ev = firstEventTiming();
const patrolVisible = ev.firstBossMin <= 30;
const memeVisible = ev.firstMemeMin <= 30;

// —— 每日图鉴收集上限达标日 ——
function firstDayAtLeast(rows: { collection: number }[], v: number): number | null {
  const r = rows.find((x) => x.collection >= v);
  return r ? (r as unknown as { day: number }).day : null;
}
const capReachedDay = (() => {
  const d = main.days.find((x) => x.collection >= theoreticalIdleCap);
  return d ? d.day : null;
})();

// —— 各挂机升级达到 Lv50（第 5 档彩蛋）的日期 ——
const lv50Day: Record<string, number | null> = {};
for (const u of UPGRADES) {
  if (!u.idleRate) continue;
  const row = main.days.find((x) => (x.levels[u.id] ?? 0) >= 50);
  lv50Day[u.id] = row ? row.day : null;
}

// —— 日报目标逐个统计（每次开页 = 一个新时段 3 目标）——
const goalStats: Record<string, { drawn: number; done: number }> = {};
for (const t of DAILY_GOAL_TEMPLATES) goalStats[t.id] = { drawn: 0, done: 0 };
for (const ss of main.sessions) for (const g of ss.goals) {
  goalStats[g.id]!.drawn += 1;
  if (g.done) goalStats[g.id]!.done += 1;
}
const goalClaimRate = main.sessions.filter((s) => s.allDone).length / main.sessions.length;

// —— 巡逻公平性数值：hold 白送 vs type/blitz 不可完成 ——
const day14 = main.days[main.days.length - 1]!;
const idleRate14 = day14.idleRate;
const holdRewardBase = Math.max(50, 4 * idleRate14); // BOSS_REWARD_IDLE_SECONDS = 4
const holdRewardCap = holdRewardBase * 1.5; // 连胜 ×1.5（5 连安然）
const dailyIdleSeconds = 16 * 3600 * 0.9; // 每天约 16h 计入 ×0.9 效率
const dailyIncomeEq = idleRate14 * dailyIdleSeconds;
const holdShare = holdRewardCap / dailyIncomeEq;
/** hold 在 8s 巡逻窗口里：+4s~6s 挂机收入，即窗口内挂机收益的 0.5~0.75 倍——零操作自动完成 */
const holdVsWindowIncome = (holdRewardCap / (8 * idleRate14)) ;

// —— 日报目标池：零操作党能完成的期望 ——
const goalPool = DAILY_GOAL_TEMPLATES.map((t) => t.id);
const zenCompletable = ["buy_3"];
const expectedZenGoalsPerWindow = 3 * (zenCompletable.length / goalPool.length); // 每个目标 3/4 概率入池
const claimProb = 0; // 必含至少 2 个操作类目标

// —— 对照：每日领取奖励 vs 日收入（零操作党拿不到的部分占比）——
const dailyRewardEq = Math.max(500, 600 * idleRate14);
const rewardShare = dailyRewardEq / dailyIncomeEq;

// —— 挂机覆盖率（有效到账/24h）——
const avgCoverage = main.days.reduce((a, d) => a + d.coverage, 0) / main.days.length;

// —— 零操作永远拿不到清单（数据支撑）——
const never = {
  collectionGap: TOTAL_ITEMS - theoreticalIdleCap,
  clickLineFlavors: mustClickHard,
  quotes: mustClickSoft,
  dailyClaims: main.totals.claims,
  dailyRewardEq,
  rewardShare,
  holdFreePerPatrol: holdRewardBase,
  holdShare,
  collectionBonus: 1.2,
  prestigeReachable: main.totals.prestigeUnlockedDay !== null,
  prestigeDay: main.totals.prestigeUnlockedDay,
};

const report = {
  generatedAt: new Date().toISOString(),
  head: "500359b",
  profiles: {
    main: { opts: main.opts, days: main.days, totals: main.totals, sessions: main.sessions },
    threeOpens: { opts: threeOpens.opts, days: threeOpens.days, totals: threeOpens.totals },
    noBuy: { opts: noBuy.opts, days: noBuy.days, totals: noBuy.totals },
    naiveBuy: { opts: naiveBuy.opts, days: naiveBuy.days, totals: naiveBuy.totals },
    autoPrestige: { opts: autoPrestige.opts, days: autoPrestige.days, totals: autoPrestige.totals },
    realCreatedAt: { opts: realCreatedAt.opts, days: realCreatedAt.days, totals: realCreatedAt.totals },
    lazyBuy: {
      onePerSession: { opts: buy1.opts, days: buy1.days, totals: buy1.totals },
      threePerSession: { opts: buy3.opts, days: buy3.days, totals: buy3.totals },
      fivePerSession: { opts: buy5.opts, days: buy5.days, totals: buy5.totals },
    },
  },
  analysis: {
    theoreticalIdleCap,
    mustClickHard,
    mustClickSoft,
    totalItems: TOTAL_ITEMS,
    capReachedDay,
    lv50Day,
    goalStats,
    goalClaimRate,
    patrolVisibleIn30s: patrolVisible,
    memeVisibleIn30s: memeVisible,
    firstBossWindow: [ev.firstBossMin, ev.firstBossMax],
    firstMemeWindow: [ev.firstMemeMin, ev.firstMemeMax],
    patrolDuration: BOSS_DURATION,
    typeTarget: BOSS_TYPE_TARGET,
    blitzTarget: BOSS_BLITZ_TARGET,
    expectedZenGoalsPerWindow,
    claimProb,
    dailyRewardEq,
    dailyIncomeEq,
    rewardShare,
    holdRewardBase,
    holdRewardCap,
    holdShare,
    holdVsWindowIncome,
    avgCoverage,
    never,
    offlineCapHours: OFFLINE_CAP_SECONDS / 3600,
    firstDayMs: FIRST_DAY_MS,
  },
};

writeFileSync(new URL("./r9-zen-report.json", import.meta.url), JSON.stringify(report, null, 2));

// ---------------- 控制台 markdown ----------------
console.log("\n===== R9 零操作 14 天（2 开/天，各 30s，买 ★挂机最优）=====");
console.log("天 | 挂机率/s | 段位 | 图鉴 | 日报(时段完成/可领) | 日收入 | 有效覆盖");
for (const r of main.days) {
  console.log(
    `${String(r.day).padStart(2)} | ${short(r.idleRate).padStart(10)} | ${r.rank} | ${r.collection}/${TOTAL_ITEMS} | ${r.goalsDone}/${r.goalsTotal} 可领=${r.claimable ? "是" : "否"} | ${short(r.dailyIncome)} | ${pct(r.coverage)}`,
  );
}
console.log(
  `\ntotals: lifetime=${short(main.totals.endLifetimeEarned)} idle=${short(main.totals.endIdleRate)}/s rank=${main.totals.endRank} coll=${main.totals.collection} goalsDone=${main.totals.goalsCompleted}/${main.totals.goalsTotal} claims=${main.totals.claims} cov=${pct(avgCoverage)}`,
);
console.log("idleLevels", JSON.stringify(main.totals.idleLevels));
console.log("clickLevels", JSON.stringify(main.totals.clickLevels));
console.log("goalStats", JSON.stringify(goalStats), "claimRate", goalClaimRate);
console.log("capReachedDay", capReachedDay, "lv50Day", JSON.stringify(lv50Day));
console.log("prestigeUnlockedDay", main.totals.prestigeUnlockedDay, "threshold", day14.prestigeThreshold, "gain", day14.prestigeGainIfAny);
console.log("patrolVisibleIn30s", patrolVisible, "memeVisibleIn30s", memeVisible, "firstBoss", ev.firstBossMin + "-" + ev.firstBossMax, "firstMeme", ev.firstMemeMin + "-" + ev.firstMemeMax);
console.log(
  `holdReward@D14=${holdRewardBase.toFixed(1)} cap(${holdRewardCap.toFixed(1)}) = ${pct(holdShare)} of daily income, vs 8s窗口收入 ${pct(holdVsWindowIncome)}; dailyReward=${dailyRewardEq.toFixed(1)} = ${pct(rewardShare)} of daily income`,
);
console.log(
  `theoretical idle collection cap=${theoreticalIdleCap}/${TOTAL_ITEMS} (idle upgrades ${idleUpgradeCount}×5), hard-click ${mustClickHard}, quotes ${mustClickSoft}, 实际 D14=${main.totals.collection}`,
);
console.log("\n-- 敏感性（D14 lifetimeEarned / idleRate / 段位 / 图鉴）--");
for (const [name, r] of Object.entries({ threeOpens, noBuy, naiveBuy, autoPrestige })) {
  console.log(
    name,
    "lifetime=" + short(r.totals.endLifetimeEarned),
    "idle=" + short(r.totals.endIdleRate) + "/s",
    "rank=" + r.totals.endRank,
    "coll=" + r.totals.collection,
    r.opts.prestigeAuto ? `prestiges=${r.totals.prestiges} pts=${r.totals.prestigePoints}` : "",
  );
}
console.log("\n-- 懒买敏感度（每次开页点 N 次购买卡，idleBest）--");
for (const [name, r] of Object.entries({ buy1, buy3, buy5 })) {
  console.log(
    name,
    "lifetime=" + short(r.totals.endLifetimeEarned),
    "idle=" + short(r.totals.endIdleRate) + "/s",
    "rank=" + r.totals.endRank,
    "coll=" + r.totals.collection,
    "buys=" + r.totals.buys,
  );
}
console.log("D14 存档时间偏移(+10s)对照: lifetime", short(realCreatedAt.totals.endLifetimeEarned), "idle", short(realCreatedAt.totals.endIdleRate), "coll", realCreatedAt.totals.collection, "D2rate", JSON.stringify(realCreatedAt.days[1]!.offlineRates));
console.log("sessions goal ids per day:", main.days.map((d) => d.dailyGoalIds.join(",")).slice(0, 4).join(" | "));
console.log("session buys sample:", main.sessions.slice(0, 6).map((s) => `${s.day}-${s.open}:${s.buys}`).join(" "));
