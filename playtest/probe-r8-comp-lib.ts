/**
 * R8 竞品流失玩家探针（24h/72h + 7 天外推）公共库 —— 只读 src/，不修改任何游戏文件。
 *
 * 画像：从《摸鱼大师》《我要当老板》《Idle Office Tycoon》《打工模拟器》流失的放置玩家，
 *       弃坑原因是「太肝 / 广告太多 / 数值崩」。本探针只回答：这个替代品在同一天/三天/七天
 *       的进度曲线上，相对竞品处在什么位置。
 *
 * 严格按 src/main.ts 的装配链路模拟「开页 → 玩 → 关页」：
 *   boot:  restore（sim 直接持有 state）→ ensureVisits → offlineEfficiency → settleReturn
 *          → syncFlavorCollection → ensureDaily
 *   play:  pointerdown 同序（onBossTap / onMemeTap + collectQuote / doClick + 连击）
 *          frame 同序（scheduleEvents → finishPatrol → 跨日 ensureDaily → advance）
 *          购买（buyUpgrade + syncFlavorCollection + 日报 buy）
 *          关页前领日报（claimDaily）
 *
 * 两种画像：
 *   idle   —— 纯挂机党：每天开 3 次、每次 40~90 秒，只看离线/花钱/关页，一次不点。
 *   active —— 活跃党：D1 开 4 次共 ~30 分钟，D2/D3 每天 3 次 × 8 分钟，之后每天 2 次 × 6 分钟；
 *             3cps 点击、按横幅规则应对三种巡逻、收梗、做日报、转生。
 */

import { initialState, type GameState } from "../src/engine/state";
import { doClick, buyUpgrade, clickPowerOf, COMBO_WINDOW_S, COMBO_BREAK_S, COMBO_MAX } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import {
  UPGRADES,
  costOf,
  effectOf,
  valueScoreOf,
} from "../src/engine/upgrades";
import {
  newEventState,
  scheduleEvents,
  onBossTap,
  onMemeTap,
  finishPatrol,
  BOSS_TYPE_TARGET,
  BOSS_BLITZ_TARGET,
  BOSS_DURATION,
  type EventState,
} from "../src/engine/events";
import {
  collectQuote,
  syncFlavorCollection,
  collectionCount,
} from "../src/engine/collection";
import { MEME_QUOTES } from "../src/engine/flavor";
import {
  ensureDaily,
  dailyTrack,
  dailyAllDone,
  claimDaily,
  formatLocalDate,
} from "../src/engine/daily";
import { rankFor, RANKS } from "../src/engine/titles";
import { settleReturn } from "../src/engine/resume";
import { ensureVisits, offlineEfficiency } from "../src/engine/progression";
import { doPrestige, canPrestige, prestigeGain, prestigeMultiplier } from "../src/engine/prestige";
import { formatMoyu } from "../src/engine/format";

export const DT = 0.1;
export const HOUR = 3_600_000;
export const DAY_MS = 86_400_000;
/** D1 00:00（本地时间，周一）。首次开页在 D1 09:00。 */
export const START_MS = new Date(2026, 10, 27, 0, 0, 0).getTime();

export type Profile = "active" | "idle";

export interface SessionDef {
  /** 开页时刻（绝对毫秒） */
  atMs: number;
  /** 本次停留秒数 */
  seconds: number;
}

function at(day: number, hour: number, minute: number): number {
  return START_MS + (day - 1) * DAY_MS + hour * HOUR + minute * 60_000;
}

/** 现实玩家的开页节奏（小时数刻意不完美对齐：9:00/12:00/18:00/22:00 之类） */
export function sessionsFor(profile: Profile, days = 7): SessionDef[] {
  const list: [number, number, number, number][] = [];
  if (profile === "active") {
    // D1 新鲜期 4 次、D2/D3 每天 3 次、D4+ 每天 2 次
    list.push([1, 9, 0, 720], [1, 12, 20, 480], [1, 18, 0, 600], [1, 22, 10, 360]);
    for (let d = 2; d <= 3; d++) list.push([d, 9, 0, 480], [d, 13, 0, 480], [d, 21, 0, 480]);
    for (let d = 4; d <= days; d++) list.push([d, 9, 0, 360], [d, 21, 0, 360]);
  } else {
    // 纯挂机：每天 3 次（D4+ 2 次），每次只花 40~90 秒查看离线+花钱
    list.push([1, 9, 0, 90], [1, 13, 20, 50], [1, 20, 0, 45]);
    for (let d = 2; d <= 3; d++) list.push([d, 9, 0, 45], [d, 13, 0, 40], [d, 21, 0, 40]);
    for (let d = 4; d <= days; d++) list.push([d, 9, 0, 40], [d, 21, 0, 40]);
  }
  return list.filter(([d]) => d <= days).map(([d, h, m, s]) => ({ atMs: at(d, h, m), seconds: s }));
}

/** mulberry32 可复现实数 */
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

export interface Snap {
  tHours: number;
  day: number;
  atMs: number;
  moyu: number;
  /** 本局累计（转生会清零） */
  runEarned: number;
  /** 历史累计（跨转生，段位以此为准） */
  lifetime: number;
  idleRate: number;
  clickPower: number;
  rank: string;
  rankIdx: number;
  rankProgress: number;
  collection: number;
  unlocked: number;
  totalLevels: number;
  prestige: number;
  prestigeMult: number;
  dailyStreak: number;
}

export interface ContentEvent {
  atMs: number;
  tHours: number;
  type: "firstBuy" | "unlock" | "milestone" | "rank" | "collection" | "prestige" | "dailyAllDone";
  detail: string;
}

export interface SessionLog {
  day: number;
  atMs: number;
  seconds: number;
  gapSeconds: number;
  rate: number;
  offlineEarned: number;
  activeEarned: number;
  clicks: number;
  patrols: number;
  patrolReward: number;
  caughtTaps: number;
  memeHits: number;
  purchases: number;
  claimedReward: number | null;
  prestigeGained: number;
  /** 本次会话内最长「没有新变化」的连续分钟数 */
  deadAirMinutes: number;
  endState: Snap;
}

export interface DaySummary {
  day: number;
  date: string;
  lifetimeEnd: number;
  dayIncome: number;
  idleRateEnd: number;
  rankEnd: string;
  collectionEnd: number;
  prestigeEnd: number;
  newEvents: string[];
  newContentCount: number;
  sessions: number;
  clicks: number;
  offlineRatio: number;
}

export interface RunResult {
  profile: Profile;
  prestigeRule: "early" | "cap" | "once" | "none";
  days: number;
  snaps: Snap[];
  events: ContentEvent[];
  sessions: SessionLog[];
  daily: DaySummary[];
  /** 首次关键里程碑的时刻（小时） */
  keyTimings: Record<string, number | null>;
  /** 最长「无任何新内容」连续时长（分钟，含离线墙钟口径） */
  maxNoContentMinutes: number;
  /** 会话内最长「没有任何新变化」时长（分钟）—— 真正的坐牢感指标 */
  maxSessionDeadAirMinutes: number;
  seed: number;
}

/** 当前已解锁卡数 */
function unlockedCount(levels: Record<string, number>): number {
  return UPGRADES.filter((u) => (levels[u.id] ?? 0) > 0).length;
}

/** 各项 ×2 里程碑总次数（与 upgrades.ts 的错峰偏移一致：(表序%4)×5） */
function milestoneTotal(levels: Record<string, number>): number {
  let n = 0;
  UPGRADES.forEach((u, i) => {
    const offset = (i % 4) * 5;
    const lv = levels[u.id] ?? 0;
    n += Math.floor((lv + offset) / 20);
  });
  return n;
}

function rankIdxOf(name: string): number {
  return RANKS.findIndex((r) => r.name === name);
}

/** 模拟 ensureVisits 之后的 visits 值（供关页区间插值使用） */
function visitsAfter(state: GameState, nowMs: number): { date: string; count: number } {
  const date = new Date(nowMs).toLocaleDateString("sv-SE");
  const v = state.visits;
  return v.date === date ? { date, count: v.count + 1 } : { date, count: 1 };
}

function snapOf(state: GameState, atMs: number): Snap {
  const eff = effectOf(state);
  const rank = rankFor(state.lifetimeEarned);
  return {
    tHours: +((atMs - START_MS) / HOUR).toFixed(3),
    day: Math.floor((atMs - START_MS) / DAY_MS) + 1,
    atMs,
    moyu: state.moyu,
    runEarned: state.totalEarned,
    lifetime: state.lifetimeEarned,
    idleRate: eff.idleRate,
    clickPower: clickPowerOf(state),
    rank: rank.current,
    rankIdx: rankIdxOf(rank.current),
    rankProgress: rank.progress,
    collection: collectionCount(state),
    unlocked: unlockedCount(state.levels),
    totalLevels: Object.values(state.levels).reduce((a, b) => a + b, 0),
    prestige: state.prestige,
    prestigeMult: prestigeMultiplier(state.prestige),
    dailyStreak: state.daily?.streak ?? 0,
  };
}

interface Seen {
  unlocked: Set<string>;
  milestones: number;
  rankIdx: number;
  collection: number;
  prestige: number;
}

/** 检测「玩家能看到的新内容」，返回需要 push 的事件 */
function detectChanges(state: GameState, atMs: number, seen: Seen, events: ContentEvent[]): void {
  const rank = rankFor(state.lifetimeEarned);
  const rIdx = rankIdxOf(rank.current);
  if (rIdx > seen.rankIdx) {
    for (let i = seen.rankIdx + 1; i <= rIdx; i++) {
      events.push({ atMs, tHours: +((atMs - START_MS) / HOUR).toFixed(3), type: "rank", detail: RANKS[i]!.name });
    }
    seen.rankIdx = rIdx;
  }
  const coll = collectionCount(state);
  if (coll > seen.collection) {
    events.push({
      atMs,
      tHours: +((atMs - START_MS) / HOUR).toFixed(3),
      type: "collection",
      detail: `图鉴 ${seen.collection}→${coll}/55`,
    });
    seen.collection = coll;
  }
  const ms = milestoneTotal(state.levels);
  if (ms > seen.milestones) {
    events.push({
      atMs,
      tHours: +((atMs - START_MS) / HOUR).toFixed(3),
      type: "milestone",
      detail: `×2 里程碑 +${ms - seen.milestones}（共 ${ms} 次）`,
    });
    seen.milestones = ms;
  }
  for (const u of UPGRADES) {
    if ((state.levels[u.id] ?? 0) > 0 && !seen.unlocked.has(u.id)) {
      seen.unlocked.add(u.id);
      events.push({
        atMs,
        tHours: +((atMs - START_MS) / HOUR).toFixed(3),
        type: seen.unlocked.size === 1 ? "firstBuy" : "unlock",
        detail: u.name,
      });
    }
  }
  if (state.prestige > seen.prestige) {
    events.push({
      atMs,
      tHours: +((atMs - START_MS) / HOUR).toFixed(3),
      type: "prestige",
      detail: `转生 +${state.prestige - seen.prestige} 点（×${prestigeMultiplier(state.prestige).toFixed(2)}）`,
    });
    seen.prestige = state.prestige;
  }
}

/** 购买策略：active=先解锁新卡再买加权价值最高；idle=只买挂机线里最划算的 */
function pickBuy(state: GameState, profile: Profile): string | null {
  const lv = (id: string): number => state.levels[id] ?? 0;
  const affordable = UPGRADES.filter((u) => state.moyu >= costOf(u.id, lv(u.id)));
  if (affordable.length === 0) return null;
  if (profile === "idle") {
    const idleOnly = affordable.filter((u) => u.idleRate);
    if (idleOnly.length === 0) return null;
    let best = idleOnly[0]!.id;
    let bestScore = -1;
    for (const u of idleOnly) {
      const s = valueScoreOf(u.id, lv(u.id)).idle;
      if (s > bestScore) {
        bestScore = s;
        best = u.id;
      }
    }
    return best;
  }
  const unowned = affordable.filter((u) => lv(u.id) === 0);
  if (unowned.length > 0) {
    unowned.sort((a, b) => costOf(a.id, 0) - costOf(b.id, 0));
    return unowned[0]!.id;
  }
  // 点击在活跃期有 3cps，折算成「每秒等效收益」比较
  let best = affordable[0]!.id;
  let bestScore = -1;
  for (const u of affordable) {
    const s = valueScoreOf(u.id, lv(u.id));
    const score = s.idle + s.click * 2; // 点击线权重 2（活跃期才点）
    if (score > bestScore) {
      bestScore = score;
      best = u.id;
    }
  }
  return bestScore > 0 ? best : null;
}

export function run(
  profile: Profile,
  opts: { days?: number; seed?: number; prestige?: "early" | "cap" | "once" | "none" } = {},
): RunResult {
  const days = opts.days ?? 7;
  const seed = opts.seed ?? 20261127;
  const prestigeRule = opts.prestige ?? "early";
  const rng = makeRng(seed);
  const sessions = sessionsFor(profile, days);
  const endMs = START_MS + days * DAY_MS;

  let state = initialState();
  const created = sessions[0]!.atMs; // 建档时间 = 第一次打开页面
  const snaps: Snap[] = [];
  const events: ContentEvent[] = [];
  const sessionLogs: SessionLog[] = [];
  const seen: Seen = { unlocked: new Set(), milestones: 0, rankIdx: 0, collection: 0, prestige: 0 };
  const keyTimings: Record<string, number | null> = {
    firstClick: null,
    firstBuy: null,
    rank2_1e4: null,
    rank3_1e5: null,
    rank4_1e6: null,
    rank5_1e8: null,
    prestigeUnlock: null,
    firstPrestige: null,
    allCards: null,
    milestone20: null,
    collection55: null,
  };
  let prevActiveMs = sessions[0]!.atMs;
  let nextHourBoundary = sessions[0]!.atMs + HOUR;
  let offlineTotal = 0;

  const noteKey = (atMs: number): void => {
    const h = +((atMs - START_MS) / HOUR).toFixed(3);
    if (state.totalClicks > 0 && keyTimings.firstClick === null) keyTimings.firstClick = h;
    if (unlockedCount(state.levels) > 0 && keyTimings.firstBuy === null) keyTimings.firstBuy = h;
    if (state.lifetimeEarned >= 1e4 && keyTimings.rank2_1e4 === null) keyTimings.rank2_1e4 = h;
    if (state.lifetimeEarned >= 1e5 && keyTimings.rank3_1e5 === null) keyTimings.rank3_1e5 = h;
    if (state.lifetimeEarned >= 1e6 && keyTimings.rank4_1e6 === null) keyTimings.rank4_1e6 = h;
    if (state.lifetimeEarned >= 1e8 && keyTimings.rank5_1e8 === null) keyTimings.rank5_1e8 = h;
    if (state.totalEarned >= 1e8 && keyTimings.prestigeUnlock === null) keyTimings.prestigeUnlock = h;
    if (state.prestige > 0 && keyTimings.firstPrestige === null) keyTimings.firstPrestige = h;
    if (unlockedCount(state.levels) >= 9 && keyTimings.allCards === null) keyTimings.allCards = h;
    if (milestoneTotal(state.levels) >= 20 && keyTimings.milestone20 === null) keyTimings.milestone20 = h;
    if (collectionCount(state) >= 55 && keyTimings.collection55 === null) keyTimings.collection55 = h;
  };

  const pushSnap = (atMs: number): void => {
    snaps.push(snapOf(state, atMs));
    noteKey(atMs);
  };

  const detect = (atMs: number): void => {
    detectChanges(state, atMs, seen, events);
    noteKey(atMs);
  };

  const sessionDeadAir = (startMsIn: number, endMsIn: number): number => {
    const pts = [startMsIn, ...events.filter((e) => e.atMs >= startMsIn && e.atMs <= endMsIn).map((e) => e.atMs), endMsIn];
    let m = 0;
    for (let i = 1; i < pts.length; i++) m = Math.max(m, pts[i]! - pts[i - 1]!);
    return m;
  };

  for (const ses of sessions) {
    // —— 关页期间：按小时打点（离线线性增长） ——
    // 注意：真实游戏在「开页时」才结算，且结算用的是 ensureVisits 之后的效率；
    // 插值必须用同一个效率，否则曲线会出现「历史累计回撤」的假象。
    const openVisits = visitsAfter(state, ses.atMs);
    const gapRate = offlineEfficiency({ ...state, visits: openVisits }, created, ses.atMs);
    while (nextHourBoundary < ses.atMs) {
      const elapsed = (nextHourBoundary - prevActiveMs) / 1000;
      if (elapsed > 0) {
        const r = settleReturn(state, prevActiveMs, nextHourBoundary, gapRate);
        const saved = state;
        state = r.state;
        pushSnap(nextHourBoundary);
        state = saved;
      }
      nextHourBoundary += HOUR;
    }

    // —— 开页（与 src/main.ts boot 同序） ——
    let s = ensureVisits(state, ses.atMs);
    const rate = offlineEfficiency(s, created, ses.atMs);
    const off = settleReturn(s, prevActiveMs, ses.atMs, rate);
    s = off.state;
    s = syncFlavorCollection(s);
    s = ensureDaily(s, formatLocalDate(new Date(ses.atMs)), rng);
    const gapSeconds = Math.max(0, (ses.atMs - prevActiveMs) / 1000);
    offlineTotal += off.earned;

    const before = s.totalEarned;
    const lifetimeBefore = s.lifetimeEarned;
    state = s;
    pushSnap(ses.atMs);
    detect(ses.atMs);

    // —— 游玩 ——
    const counters = {
      clicks: 0,
      patrols: 0,
      patrolReward: 0,
      caughtTaps: 0,
      memeHits: 0,
      purchases: 0,
      claimedReward: null as number | null,
      prestigeGained: 0,
    };
    const sessionStart = ses.atMs;
    // 用真实引擎跑会话（发出的事件以 session 起点 + 偏移换算）
    state = playSessionWithClock(state, profile, prestigeRule, ses.seconds, rng, sessionStart, nextHourBoundary, (st, atMs) => {
      const saved = state;
      state = st;
      pushSnap(atMs);
      state = saved;
    }, (st, atMs) => {
      const saved = state;
      state = st;
      detect(atMs);
      state = saved;
    }, counters, () => {});

    const endMs = ses.atMs + ses.seconds * 1000;
    pushSnap(endMs);
    sessionLogs.push({
      day: Math.floor((ses.atMs - START_MS) / DAY_MS) + 1,
      atMs: ses.atMs,
      seconds: ses.seconds,
      gapSeconds: Math.round(gapSeconds),
      rate,
      offlineEarned: off.earned,
      activeEarned: state.lifetimeEarned - lifetimeBefore,
      clicks: counters.clicks,
      patrols: counters.patrols,
      patrolReward: counters.patrolReward,
      caughtTaps: counters.caughtTaps,
      memeHits: counters.memeHits,
      purchases: counters.purchases,
      claimedReward: counters.claimedReward,
      prestigeGained: counters.prestigeGained,
      deadAirMinutes: Math.round(sessionDeadAir(ses.atMs, endMs) / 60_000),
      endState: snapOf(state, endMs),
    });
    prevActiveMs = endMs;
    while (nextHourBoundary <= endMs) nextHourBoundary += HOUR;
  }

  // —— 最后一段离线到统计终点 ——
  const gapRate = offlineEfficiency(state, created, endMs);
  while (nextHourBoundary <= endMs) {
    const elapsed = (nextHourBoundary - prevActiveMs) / 1000;
    if (elapsed > 0) {
      const r = settleReturn(state, prevActiveMs, nextHourBoundary, gapRate);
      const saved = state;
      state = r.state;
      pushSnap(nextHourBoundary);
      state = saved;
    }
    nextHourBoundary += HOUR;
  }
  const final = settleReturn(state, prevActiveMs, endMs, gapRate);
  const finalSaved = state;
  state = final.state;
  pushSnap(endMs);
  detect(endMs);
  state = finalSaved;

  // —— 日汇总 ——
  const daily: DaySummary[] = [];
  for (let d = 1; d <= days; d++) {
    const dayStart = START_MS + (d - 1) * DAY_MS;
    const dayEnd = START_MS + d * DAY_MS;
    let endSnap: Snap | null = null;
    let startLifetime = 0;
    for (const sn of snaps) {
      if (sn.atMs <= dayEnd) {
        if (sn.atMs >= dayStart) endSnap = sn;
        if (sn.atMs <= dayStart) startLifetime = sn.lifetime;
      }
    }
    const daySnaps = snaps.filter((sn) => sn.atMs >= dayStart && sn.atMs <= dayEnd);
    const daySessions = sessionLogs.filter((l) => l.day === d);
    const dayEvents = events.filter((e) => e.atMs >= dayStart && e.atMs < dayEnd);
    const endLifetime = endSnap ? endSnap.lifetime : daySnaps.at(-1)?.lifetime ?? startLifetime;
    const offEarned = daySessions.reduce((a, l) => a + l.offlineEarned, 0);
    daily.push({
      day: d,
      date: formatLocalDate(new Date(dayStart + 12 * HOUR)),
      lifetimeEnd: endLifetime,
      dayIncome: endLifetime - startLifetime,
      idleRateEnd: endSnap?.idleRate ?? 0,
      rankEnd: endSnap?.rank ?? "",
      collectionEnd: endSnap?.collection ?? 0,
      prestigeEnd: endSnap?.prestige ?? 0,
      newEvents: dayEvents.map((e) => {
        const tag: Record<ContentEvent["type"], string> = {
          firstBuy: "首购",
          unlock: "解锁",
          milestone: "×2",
          rank: "段位",
          collection: "图鉴",
          prestige: "转生",
          dailyAllDone: "日报",
        };
        return `${tag[e.type]}:${e.detail}`;
      }),
      newContentCount: dayEvents.length,
      sessions: daySessions.length,
      clicks: daySessions.reduce((a, l) => a + l.clicks, 0),
      offlineRatio: offEarned + (endLifetime - startLifetime) > 0 ? offEarned / (endLifetime - startLifetime) : 0,
    });
  }

  // 最大「无新内容」间隔（分钟）：离线期间无事件窗口，但归零点是玩家看到变化
  let maxGapMs = 0;
  const points = [sessions[0]!.atMs, ...events.map((e) => e.atMs), endMs];
  for (let i = 1; i < points.length; i++) maxGapMs = Math.max(maxGapMs, points[i]! - points[i - 1]!);
  // 会话内空转：开页后到下一次「看得到的新变化」之间的最长间隔
  let maxSessionGapMs = 0;
  for (const log of sessionLogs) {
    const end = log.atMs + log.seconds * 1000;
    const pts = [log.atMs, ...events.filter((e) => e.atMs >= log.atMs && e.atMs <= end).map((e) => e.atMs), end];
    for (let i = 1; i < pts.length; i++) maxSessionGapMs = Math.max(maxSessionGapMs, pts[i]! - pts[i - 1]!);
  }

  return {
    profile,
    prestigeRule,
    days,
    seed,
    snaps,
    events,
    sessions: sessionLogs,
    daily,
    keyTimings,
    maxNoContentMinutes: Math.round(maxGapMs / 60_000),
    maxSessionDeadAirMinutes: Math.round(maxSessionGapMs / 60_000),
  };
}

/* ------------------------------------------------------------------ */
/* 带真实时钟的会话执行：把 playSession 的事件偏移换算成绝对时间       */
/* ------------------------------------------------------------------ */

function atMsOf(sessionStart: number, offsetSeconds: number): number {
  return sessionStart + offsetSeconds * 1000;
}

function playSessionWithClock(
  state: GameState,
  profile: Profile,
  prestigeRule: "early" | "cap" | "once" | "none",
  seconds: number,
  rng: () => number,
  sessionStartMs: number,
  nextHourBoundaryIn: number,
  emitSnap: (s: GameState, atMs: number) => void,
  emitChange: (s: GameState, atMs: number) => void,
  counters: {
    clicks: number;
    patrols: number;
    patrolReward: number;
    caughtTaps: number;
    memeHits: number;
    purchases: number;
    claimedReward: number | null;
    prestigeGained: number;
  },
  _unused: () => void,
): GameState {
  void _unused;
  let nextHourBoundary = nextHourBoundaryIn;
  let s = state;
  const es: EventState = newEventState();
  es.surviveStreak = s.surviveStreak;
  let combo = 0;
  let lastClickT = -99;
  let tapCredit = 0;
  let prevBossActive = false;
  let memeHandledFor = -1;
  let lastBuyT = -1e9;
  const buyCadence = profile === "active" ? 5 : 2;
  let prestigeDone = false;

  const emitChangeAt = (st: GameState, gameT: number): void => {
    const saved = s;
    // 由外层闭包处理 state 替换；这里 state 与 s 同步，所以直接回调
    void saved;
    emitChange(st, atMsOf(sessionStartMs, gameT));
  };

  const doBuy = (gameT: number): void => {
    const wantPrestige =
      prestigeRule === "early"
        ? prestigeGain(s) >= 3
        : prestigeRule === "cap"
          ? prestigeGain(s) >= 20
          : prestigeRule === "once"
            ? s.prestige === 0 && prestigeGain(s) >= 3
            : false;
    if (wantPrestige && canPrestige(s) && !prestigeDone) {
      const r = doPrestige(s);
      if (r) {
        s = r.state;
        prestigeDone = true;
        counters.prestigeGained += r.gained;
        es.bossUntil = -1;
        es.memeUntil = -1;
        es.nextBossAt = Infinity;
        es.nextMemeAt = Infinity;
        es.bossCaught = false;
        es.bossPenaltyTotal = 0;
        prevBossActive = false;
        emitChangeAt(s, gameT);
      }
    }
    const id = pickBuy(s, profile);
    if (!id) return;
    const next = buyUpgrade(s, id);
    if (!next) return;
    s = syncFlavorCollection(next);
    s = { ...s, daily: s.daily ? dailyTrack(s.daily, "buy") : null };
    counters.purchases += 1;
    emitChangeAt(s, gameT);
  };

  for (let t = DT; t <= seconds + 1e-9; t += DT) {
    scheduleEvents(es, t, rng);

    if (profile === "active" && es.memeUntil > 0 && memeHandledFor !== es.memeUntil) {
      memeHandledFor = es.memeUntil;
      const r = onMemeTap(s, es);
      s = r.state;
      counters.memeHits += 1;
      const qi = Math.floor(rng() * MEME_QUOTES.length);
      s = collectQuote(s, qi).state;
      s = { ...s, daily: s.daily ? dailyTrack(s.daily, "meme") : null };
      emitChangeAt(s, t);
    }

    if (profile === "active") {
      const bossActive = es.bossUntil > t;
      let cps = 3;
      if (bossActive) {
        if (es.bossVariant === "hold") cps = 0;
        else if (es.bossVariant === "type") cps = es.bossTaps < BOSS_TYPE_TARGET ? 5 : 0;
        else cps = es.bossTaps < BOSS_BLITZ_TARGET ? 3.6 : 0;
      }
      tapCredit += cps * DT;
      while (tapCredit >= 1) {
        tapCredit -= 1;
        const gap = t - lastClickT;
        combo = gap < COMBO_WINDOW_S ? Math.min(COMBO_MAX, combo + 1) : gap > COMBO_BREAK_S ? 0 : combo;
        lastClickT = t;
        if (bossActive) {
          const r = onBossTap(s, es, t, combo);
          s = r.state;
          if (r.caught) counters.caughtTaps += 1;
        } else {
          s = doClick(s, combo);
        }
        counters.clicks += 1;
        s = { ...s, daily: s.daily ? dailyTrack(s.daily, "click") : null };
        if (s.totalClicks % 25 === 0) {
          s = syncFlavorCollection(s);
          emitChangeAt(s, t);
        }
      }
    }

    const bossActive = es.bossUntil > t;
    if (prevBossActive && !bossActive) {
      const r = finishPatrol(s, es);
      s = r.state;
      counters.patrols += 1;
      if (r.reward > 0) {
        counters.patrolReward += r.reward;
        s = { ...s, daily: s.daily ? dailyTrack(s.daily, "survive") : null };
      }
      emitChangeAt(s, t);
    }
    prevBossActive = bossActive;

    s = advance(s, DT);

    if (t - lastBuyT >= buyCadence) {
      lastBuyT = t;
      doBuy(t);
    }

    if (s.daily && dailyAllDone(s.daily) && !s.daily.claimed) {
      const r = claimDaily(s, s.daily.date);
      if (r.claimedReward !== null) {
        s = r.state;
        counters.claimedReward = r.claimedReward;
        emitChangeAt(s, t);
      }
    }

    // 小时打点（会话内）
    const abs = sessionStartMs + t * 1000;
    if (abs >= nextHourBoundary) {
      emitSnap(s, nextHourBoundary);
      nextHourBoundary += HOUR;
    }
  }
  return s;
}

export { formatMoyu, BOSS_DURATION };
