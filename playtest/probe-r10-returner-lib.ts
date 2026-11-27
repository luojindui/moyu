/**
 * R10 回归老玩家探针库（只读 src/，不修改任何游戏文件）。
 *
 * 画像：回归老玩家 —— 玩过 3 天（每天 3 次 × 5 分钟），弃坑 30 天，回来开一次。
 *
 * 每次「开页」严格按 HEAD 999b0f4 的 src/main.ts boot 链路：
 *   restore() → ensureVisits() → offlineEfficiency() → settleReturn()
 *   → syncFlavorCollection() → ensureDaily()
 * 每次「游玩」按 pointerdown / frame 同序：tap(doClick / onBossTap / onMemeTap+collectQuote)
 *   + step(scheduleEvents → finishPatrol → 跨日 ensureDaily → advance) + 每 5s 买升级 + 日报领取。
 * 关页 = pagehide → serialize(state, mem, now)。
 */

import { initialState, type GameState } from "../src/engine/state";
import {
  doClick,
  buyUpgrade,
  clickPowerOf,
  COMBO_WINDOW_S,
  COMBO_BREAK_S,
  COMBO_MAX,
} from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { UPGRADES, costOf, effectOf, valueScoreOf, milestoneGap } from "../src/engine/upgrades";
import {
  newEventState,
  scheduleEvents,
  onBossTap,
  onMemeTap,
  finishPatrol,
  type EventState,
} from "../src/engine/events";
import { collectQuote, syncFlavorCollection, collectionCount, TOTAL_ITEMS } from "../src/engine/collection";
import { MEME_QUOTES } from "../src/engine/flavor";
import {
  ensureDaily,
  dailyTrack,
  dailyAllDone,
  claimDaily,
  dailyReward,
  formatLocalDate,
} from "../src/engine/daily";
import { rankFor, RANKS } from "../src/engine/titles";
import { serialize, restore, type SaveAdapter } from "../src/engine/save";
import { settleReturn } from "../src/engine/resume";
import { ensureVisits, offlineEfficiency } from "../src/engine/progression";
import { OFFLINE_CAP_SECONDS } from "../src/engine/offline";
import { canPrestige, prestigeThreshold } from "../src/engine/prestige";

export const DT = 0.1;
export const DAY_MS = 86_400_000;
/** 每次游玩 5 分钟（用户画像：每天 3 次 × 5 分钟） */
export const SESSION_SECONDS = 300;
/** 每天 3 次：09:00 / 13:00 / 20:00（本地时间） */
export const VISIT_MINUTES = [9 * 60, 13 * 60, 20 * 60];
/** Day1 = 2026-10-28 00:00（本地）；30 天后 = 2026-11-27，正好是今天 */
export const EPOCH_DAY1 = new Date(2026, 9, 28, 0, 0, 0).getTime();
/** 点击速度：回归老玩家边看边点 2cps */
export const CPS = 2;
/** 买升级节奏：每 5 秒看一眼商店 */
export const BUY_CADENCE = 5;

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

interface SessionCounters {
  clicks: number;
  patrols: number;
  patrolReward: number;
  memeHits: number;
  purchases: number;
  claimedReward: number | null;
  startTotal: number;
}

export interface OpenLog {
  /** 打开时刻（ms） */
  at: number;
  /** restore 出来的距上次存档秒数 */
  offlineSeconds: number;
  /** 本次结算实际秒数（8h 封顶后） */
  applied: number;
  /** 本次结算获得 */
  earned: number;
  /** 本次结算用的离线效率（HEAD 顺序：ensureVisits 之后算） */
  rate: number;
  /** 结算后的挂机率（离线收益基数） */
  idleRate: number;
  /** 是否弹欢迎面板（earned > 0） */
  welcome: boolean;
  /** 打开瞬间的日报状态（是否今日已领） */
  dailyClaimed: boolean;
  streakBefore: number;
  streakAfterDaily: number;
  /** ensureDaily 后今天的 3 个目标 id */
  todayGoals: string[];
  visitsCount: number;
  /** 打开瞬间是否能转生 */
  canPrestige: boolean;
  /** 打开瞬间是否已达 8h 封顶 */
  capped: boolean;
}

export interface VisitLog extends OpenLog {
  day: number;
  visit: number;
  /** 本次 300s 主动收入 */
  activeEarned: number;
  clicks: number;
  patrols: number;
  patrolReward: number;
  memeHits: number;
  purchases: number;
  claimedReward: number | null;
  /** 会话结束时的日报状态 */
  dailyDone: boolean;
  rankName: string;
  collection: number;
}

export interface Bot {
  rng: () => number;
  mem: SaveAdapter;
  now: number;
  createdAt: number;
  state: GameState;
  es: EventState;
  gameTime: number;
  combo: number;
  lastTapAt: number;
  prevBossActive: boolean;
  cur: SessionCounters;
  visits: VisitLog[];
  offlineEarnedToday: number;
  activeEarnedToday: number;
}

function emptyCounters(startTotal: number): SessionCounters {
  return {
    clicks: 0,
    patrols: 0,
    patrolReward: 0,
    memeHits: 0,
    purchases: 0,
    claimedReward: null,
    startTotal,
  };
}

export function createBot(seed: number): Bot {
  return {
    rng: makeRng(seed),
    mem: memSave(),
    now: EPOCH_DAY1 + VISIT_MINUTES[0]! * 60_000,
    createdAt: EPOCH_DAY1 + VISIT_MINUTES[0]! * 60_000,
    state: initialState(),
    es: newEventState(),
    gameTime: 0,
    combo: 0,
    lastTapAt: -99,
    prevBossActive: false,
    cur: emptyCounters(0),
    visits: [],
    offlineEarnedToday: 0,
    activeEarnedToday: 0,
  };
}

function trackDaily(bot: Bot, kind: "click" | "meme" | "buy" | "survive", n = 1): void {
  if (bot.state.daily) bot.state = { ...bot.state, daily: dailyTrack(bot.state.daily, kind, n) };
}

/** 与 src/main.ts pointerdown 同逻辑（丢梗按瞄准命中算） */
export function tap(bot: Bot): void {
  const es = bot.es;
  // 忍住型巡逻期间老玩家看横幅不点
  if (es.bossUntil > bot.gameTime && es.bossVariant === "hold") return;
  const nowMs = bot.gameTime * 1000;
  const gap = (nowMs - bot.lastTapAt) / 1000;
  bot.combo = gap < COMBO_WINDOW_S ? Math.min(COMBO_MAX, bot.combo + 1) : gap > COMBO_BREAK_S ? 0 : bot.combo;
  bot.lastTapAt = nowMs;
  bot.cur.clicks++;
  if (es.bossUntil > bot.gameTime) {
    const r = onBossTap(bot.state, es, bot.gameTime, bot.combo);
    bot.state = r.state;
    trackDaily(bot, "click");
    return;
  }
  if (es.memeUntil > bot.gameTime) {
    const r = onMemeTap(bot.state, es);
    let next = r.state;
    const qi = Math.floor(bot.rng() * MEME_QUOTES.length);
    next = collectQuote(next, qi).state;
    bot.state = next;
    bot.cur.memeHits++;
    trackDaily(bot, "meme");
    return;
  }
  bot.state = doClick(bot.state, bot.combo);
  trackDaily(bot, "click");
}

/** 与 src/main.ts frame 同序推进 dt */
export function step(bot: Bot, dt: number): void {
  bot.gameTime += dt;
  bot.now += dt * 1000;
  scheduleEvents(bot.es, bot.gameTime, bot.rng);
  const bossActive = bot.es.bossUntil > bot.gameTime;
  if (bot.prevBossActive && !bossActive) {
    const r = finishPatrol(bot.state, bot.es);
    bot.state = r.state;
    bot.cur.patrols++;
    if (r.reward > 0) {
      bot.cur.patrolReward += r.reward;
      trackDaily(bot, "survive");
    }
  }
  bot.prevBossActive = bossActive;
  const d = localDate(bot.now);
  if (bot.state.daily && bot.state.daily.date !== d) bot.state = ensureDaily(bot.state, d, bot.rng, dayWindowAt(bot.now));
  bot.state = advance(bot.state, dt);
}

/** 买升级：先解锁新卡（图鉴动机），之后买挂机向性价比最高 */
export function buyBest(bot: Bot): string | null {
  const s = bot.state;
  const affordable = UPGRADES.filter((u) => s.moyu >= costOf(u.id, s.levels[u.id] ?? 0));
  if (!affordable.length) return null;
  let target = affordable.find((u) => !(u.id in s.levels));
  if (!target) {
    let best = -1;
    for (const u of affordable) {
      if (!u.idleRate) continue;
      const score = valueScoreOf(u.id, s.levels[u.id] ?? 0).idle;
      if (score > best) {
        best = score;
        target = u;
      }
    }
  }
  if (!target) return null;
  const next = buyUpgrade(s, target.id);
  if (!next) return null;
  bot.state = syncFlavorCollection(next);
  trackDaily(bot, "buy");
  bot.cur.purchases++;
  return target.id;
}

function claimIfReady(bot: Bot): number | null {
  const d = bot.state.daily;
  if (!d || d.claimed || !dailyAllDone(d)) return null;
  const r = claimDaily(bot.state, d.date);
  if (r.claimedReward !== null) {
    bot.state = r.state;
    bot.cur.claimedReward = r.claimedReward;
  }
  return r.claimedReward;
}

/**
 * 开页：HEAD main.ts boot 完整链路。
 * `fresh` = 本次是全新玩家第一次打开（没有存档），不额外结算离线。
 */
export function openPage(bot: Bot, at: number, fresh = false): OpenLog {
  bot.now = at;
  const restored = restore(bot.mem, at);
  let state = restored.state;
  let createdAt = restored.createdAt;
  if (fresh) {
    state = initialState();
    createdAt = at;
    bot.mem = memSave();
  } else {
    bot.createdAt = createdAt;
  }
  // HEAD 顺序：先记一次回访，再算离线效率（本次打开会把 0.7 挣回 0.8）
  state = ensureVisits(state, at);
  const rate = offlineEfficiency(state, createdAt, at);
  const streakBefore = state.daily?.streak ?? 0;
  const off = fresh
    ? { applied: 0, earned: 0, state, showPanel: false }
    : settleReturn(state, at - restored.offlineSeconds * 1000, at, rate);
  state = syncFlavorCollection(off.state);
  state = ensureDaily(state, localDate(at), bot.rng, dayWindowAt(at));
  bot.state = state;
  bot.createdAt = createdAt;
  // 每次开页 = 新页面：事件从 0 重新排期
  bot.es = newEventState();
  bot.es.surviveStreak = state.surviveStreak;
  bot.gameTime = 0;
  bot.combo = 0;
  bot.lastTapAt = -99;
  bot.prevBossActive = false;
  bot.cur = emptyCounters(state.totalEarned);
  return {
    at,
    offlineSeconds: fresh ? 0 : restored.offlineSeconds,
    applied: off.applied,
    earned: off.earned,
    rate,
    idleRate: effectOf(off.state).idleRate,
    welcome: off.showPanel && off.earned > 0,
    dailyClaimed: !!state.daily?.claimed,
    streakBefore,
    streakAfterDaily: state.daily?.streak ?? 0,
    todayGoals: (state.daily?.goals ?? []).map((g) => g.id),
    visitsCount: state.visits.count,
    canPrestige: canPrestige(state),
    capped: off.applied < (fresh ? 0 : restored.offlineSeconds) - 1,
  };
}

/** 一次 300 秒主动游玩；关页时 serialize（savedAt = 关页时刻） */
export function playSession(bot: Bot): number {
  const startTotal = bot.state.totalEarned;
  let tapCredit = 0;
  let nextBuyAt = BUY_CADENCE;
  const steps = Math.round(SESSION_SECONDS / DT);
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    const inHold = bot.es.bossUntil > bot.gameTime && bot.es.bossVariant === "hold";
    const inBlitz = bot.es.bossUntil > bot.gameTime && bot.es.bossVariant === "blitz";
    const cps = inHold ? 0 : inBlitz ? 3.2 : CPS;
    tapCredit += cps * DT;
    while (tapCredit >= 1) {
      tap(bot);
      tapCredit -= 1;
    }
    step(bot, DT);
    // 日报 3/3 达成 → HUD 📔 亮角标 → 玩家打开面板领取
    if (bot.state.daily && !bot.state.daily.claimed && dailyAllDone(bot.state.daily)) claimIfReady(bot);
    if (t + DT >= nextBuyAt) {
      nextBuyAt += BUY_CADENCE;
      buyBest(bot);
    }
  }
  claimIfReady(bot);
  bot.state = syncFlavorCollection(bot.state);
  serialize(bot.state, bot.mem, bot.now);
  return bot.state.totalEarned - startTotal;
}

/** 跑 D1~Dn，每天 3 次 × 300s */
export function runDays(bot: Bot, endDay = 3, startDay = 1): VisitLog[] {
  for (let day = startDay; day <= endDay; day++) {
    bot.offlineEarnedToday = 0;
    bot.activeEarnedToday = 0;
    const dayStart = EPOCH_DAY1 + (day - 1) * DAY_MS;
    for (let v = 0; v < VISIT_MINUTES.length; v++) {
      const at = dayStart + VISIT_MINUTES[v]! * 60_000;
      const open = openPage(bot, at, day === 1 && v === 0);
      const active = playSession(bot);
      bot.offlineEarnedToday += open.earned;
      bot.activeEarnedToday += Math.max(0, active);
      const s = bot.state;
      bot.visits.push({
        ...open,
        day,
        visit: v + 1,
        activeEarned: Math.max(0, active),
        clicks: bot.cur.clicks,
        patrols: bot.cur.patrols,
        patrolReward: bot.cur.patrolReward,
        memeHits: bot.cur.memeHits,
        purchases: bot.cur.purchases,
        claimedReward: bot.cur.claimedReward,
        dailyDone: !!s.daily && dailyAllDone(s.daily),
        rankName: rankFor(s.lifetimeEarned).current,
        collection: collectionCount(s),
      });
    }
  }
  return bot.visits;
}

/** 一次「30 天后回来开一次」：只开页结算，不游玩 */
export function reopenAfterGap(bot: Bot, gapMs: number): OpenLog & { lastSavedAt: number } {
  const lastSavedAt = bot.now;
  return { ...openPage(bot, lastSavedAt + gapMs), lastSavedAt };
}

/** 快照（回归后首屏相关字段） */
export function snapshot(state: GameState) {
  const rank = rankFor(state.lifetimeEarned);
  const rankIdx = RANKS.findIndex((r) => r.name === rank.current);
  const d = state.daily;
  return {
    moyu: state.moyu,
    totalEarned: state.totalEarned,
    lifetimeEarned: state.lifetimeEarned,
    idleRate: effectOf(state).idleRate,
    clickPower: clickPowerOf(state),
    rankName: rank.current,
    rankIdx,
    rankProgress: rank.progress,
    nextRank: rank.next?.name ?? null,
    collection: collectionCount(state),
    collectionTotal: TOTAL_ITEMS,
    quotes: state.collected.quotes.length,
    flavors: state.collected.flavors.length,
    levels: { ...state.levels },
    unlocked: UPGRADES.filter((u) => (state.levels[u.id] ?? 0) > 0).length,
    totalLevels: UPGRADES.reduce((a, u) => a + (state.levels[u.id] ?? 0), 0),
    prestige: state.prestige,
    canPrestige: canPrestige(state),
    prestigeThreshold: prestigeThreshold(state),
    streak: d?.streak ?? 0,
    dailyDate: d?.date ?? null,
    dailyClaimed: d?.claimed ?? null,
    dailyDone: d ? dailyAllDone(d) : false,
    dailyGoals: (d?.goals ?? []).map((g) => ({ id: g.id, target: g.target, progress: g.progress, done: g.done })),
    dailyReward: d ? dailyReward(state) : 0,
    visits: { ...state.visits },
    surviveStreak: state.surviveStreak,
    totalClicks: state.totalClicks,
  };
}

export { TOTAL_ITEMS, RANKS, dailyReward, formatLocalDate, OFFLINE_CAP_SECONDS, milestoneGap };
export type { GameState };
