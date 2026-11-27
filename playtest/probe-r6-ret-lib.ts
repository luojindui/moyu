/**
 * R6 长线留存探针（14 天真实回访）公共库 —— 只读 src/，不修改任何游戏文件。
 *
 * 画像：长线留存型玩家（每天开 2-3 次、每次 3-8 分钟，会玩 2 周以上）。
 * 本库把「一次打开页面」严格按 src/main.ts 的装配链路跑：
 *   boot:  restore() → settleReturn() → syncFlavorCollection() → ensureDaily()
 *          + newEventState()（每次开页都是新页面，事件窗口从 0 重新排）
 *   play:  pointerdown 同序（onBossTap / onMemeTap+collectQuote / doClick + 连击链）
 *          frame 同序（scheduleEvents → finishPatrol 结算 → 跨日 ensureDaily → advance）
 *          买升级（buyUpgrade + syncFlavorCollection + 日报 buy 计数）
 *          关页前看一次日报（HUD 角标）→ claimDaily → serialize()
 *
 * 每日 3 次回访：09:00 / 12:30 / 20:00（本地时间），每次 180 秒主动游玩。
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
import {
  UPGRADES,
  costOf,
  effectOf,
  valueScoreOf,
  milestoneGap,
  type UpgradeDef,
} from "../src/engine/upgrades";
import {
  newEventState,
  scheduleEvents,
  onBossTap,
  onMemeTap,
  finishPatrol,
  surviveStreakMult,
  type EventState,
} from "../src/engine/events";
import {
  collectQuote,
  syncFlavorCollection,
  collectionCount,
  TOTAL_ITEMS,
} from "../src/engine/collection";
import { MEME_QUOTES } from "../src/engine/flavor";
import {
  ensureDaily,
  dailyTrack,
  dailyAllDone,
  claimDaily,
  dailyReward,
  formatLocalDate,
  type DailyState,
} from "../src/engine/daily";
import { rankFor, RANKS } from "../src/engine/titles";
import { serialize, restore, type SaveAdapter } from "../src/engine/save";
import { settleReturn } from "../src/engine/resume";
import { OFFLINE_CAP_SECONDS } from "../src/engine/offline";
import { formatMoyu } from "../src/engine/format";

export const DT = 0.1;
/** 彩蛋档解锁等级（与 collection.ts 的 TIER_LEVELS 一致） */
export const TIER_LEVELS = [1, 5, 10, 20, 50];
export const DAY_MS = 86_400_000;
export const SESSION_SECONDS = 180;
/** 每天 3 次回访：早 / 午 / 晚（本地时间，分钟） */
export const VISIT_MINUTES = [9 * 60, 12 * 60 + 30, 20 * 60];
/** Day1 的 00:00（本地） */
export const EPOCH_DAY1 = new Date(2026, 10, 27, 0, 0, 0).getTime();

/** 可复现实数（mulberry32） */
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

export interface BotConfig {
  seed: number;
  days: number;
  /** 平时点击速度（次/秒）。长线玩家 3 分钟后不狂点，2cps 是「边看边点」 */
  cps: number;
  /** blitz（摸鱼冲刺）变体努力点击速度：3.2cps × 8s ≈ 25 击 ≥ 20 达标 */
  blitzCps: number;
  /** 每隔几秒瞄一眼商店 */
  buyCadence: number;
  /**
   * 购买策略：
   *  - collector：先解锁新卡（图鉴动机），之后买挂机向性价比最高（理性长线玩家）
   *  - completionist：先解锁新卡，再优先买「下一次彩蛋档（Lv5/10/20/50）」的项，最后挂机性价比
   *  - cheapest：永远买最便宜（新手/不看性价比）
   */
  strategy: "collector" | "completionist" | "cheapest";
  /** 是否在 hold 巡逻期间忍住不点（老玩家看横幅照做） */
  dodgeHold: boolean;
  /** 每天 3 次回访的开始时刻（分钟，本地时间）；默认 09:00/12:30/20:00 */
  visitMinutes?: number[];
}

export const DEFAULT_CFG: BotConfig = {
  seed: 20261127,
  days: 14,
  cps: 2,
  blitzCps: 3.2,
  buyCadence: 5,
  strategy: "collector",
  dodgeHold: true,
};

export interface VisitLog {
  day: number;
  visit: number;
  at: number;
  gapSeconds: number;
  offlineSeconds: number;
  offlineApplied: number;
  offlineEarned: number;
  /** 本应速率（1.0 首日 / 0.7 之后） */
  rate: number;
  /** 结算时挂机率（离线收益基数） */
  idleRate: number;
  welcome: boolean;
  activeEarned: number;
  clicks: number;
  patrols: number;
  patrolReward: number;
  memeHits: number;
  purchases: number;
  claimedReward: number | null;
  dailyDoneAtEnd: boolean;
  rankName: string;
  collection: number;
}

export interface DayDaily {
  goals: string[];
  done: boolean;
  claimed: boolean;
  streak: number;
  reward: number;
  /** 当天第一次 3/3 是在第几次回访完成（1/2/3） */
  doneAtVisit: number | null;
  /** 当天第一次 3/3 的时间（当日 09:00 起算秒数） */
  doneAtSeconds: number | null;
}

export interface DayLog {
  day: number;
  date: string;
  totalEarned: number;
  moyu: number;
  idleRate: number;
  clickPower: number;
  rankIdx: number;
  rankName: string;
  rankProgress: number;
  /** 距离下一段位的还需累计值（无下一档为 0） */
  toNextRank: number;
  collection: number;
  quotes: number;
  flavors: number;
  /** 已解锁（买过至少 1 级）的升级卡数 0..9 */
  unlocked: number;
  levels: Record<string, number>;
  /** 各项 ×2 里程碑已达成次数（用于区分「弱变化」，不计入任务定义的新变化） */
  milestoneTotal: number;
  daily: DayDaily | null;
  offlineEarned: number;
  activeEarned: number;
  dayIncome: number;
  offlineRatio: number;
  dailyRewardRatio: number;
  /** 相对前一天结束的「确定新变化」：段位晋升 / 图鉴新增 / 新升级解锁 */
  newChanges: string[];
  /** 相对前一天的里程碑 ×2 次数 */
  newMilestones: number;
  /** 当天结束时距最近一次 ×2 还差几级（所有已购项最小值） */
  nextMilestoneGap: number | null;
  /** 存活 streak 报数 */
  surviveStreak: number;
  /** 当日三次回访合计 */
  clicks: number;
  purchases: number;
  patrols: number;
  memeHits: number;
  /** 全部升级等级合计（成长感的连续量，非离散新变化） */
  totalLevels: number;
}

interface SessionCounters {
  clicks: number;
  patrols: number;
  patrolReward: number;
  memeHits: number;
  purchases: number;
  claimedReward: number | null;
  doneAtVisit: number | null;
  doneAtSeconds: number | null;
  /** 本次会话内 3/3 达成的相对秒数（null = 未达成） */
  allDoneAt: number | null;
  startTotal: number;
}

export interface Bot {
  cfg: BotConfig;
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
  days: DayLog[];
  offlineEarnedToday: number;
  activeEarnedToday: number;
  /** 当天第一次完成 3/3 并领取时的回访序号与距首访秒数（跨 session 保留） */
  dayFirstClaim: { visit: number; secondsSinceFirstVisit: number } | null;
}

export function dateOf(ms: number): string {
  return formatLocalDate(new Date(ms));
}

export function createBot(cfg: BotConfig = DEFAULT_CFG): Bot {
  return {
    cfg,
    rng: makeRng(cfg.seed),
    mem: memSave(),
    now: 0,
    createdAt: 0,
    state: initialState(),
    es: newEventState(),
    gameTime: 0,
    combo: 0,
    lastTapAt: -99,
    prevBossActive: false,
    cur: emptyCounters(0),
    visits: [],
    days: [],
    offlineEarnedToday: 0,
    activeEarnedToday: 0,
    dayFirstClaim: null,
  };
}

function emptyCounters(startTotal: number): SessionCounters {
  return {
    clicks: 0,
    patrols: 0,
    patrolReward: 0,
    memeHits: 0,
    purchases: 0,
    claimedReward: null,
    doneAtVisit: null,
    doneAtSeconds: null,
    allDoneAt: null,
    startTotal,
  };
}

function trackDaily(bot: Bot, kind: "click" | "meme" | "buy" | "survive", n = 1): void {
  if (bot.state.daily) bot.state = { ...bot.state, daily: dailyTrack(bot.state.daily, kind, n) };
}

/** 与 src/main.ts pointerdown 同逻辑（丢梗视为玩家瞄准命中） */
export function tap(bot: Bot): void {
  const es = bot.es;
  // 忍住型：hold 巡逻期间玩家不点（老玩家看横幅照做）
  if (bot.cfg.dodgeHold && es.bossUntil > bot.gameTime && es.bossVariant === "hold") return;
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
  // 跨日重置日报（长时间挂机不刷新页面）
  const d = dateOf(bot.now);
  if (bot.state.daily && bot.state.daily.date !== d) {
    bot.state = ensureDaily(bot.state, d, bot.rng);
  }
  bot.state = advance(bot.state, dt);
}

/** 买升级：collector=先解锁新卡，之后买挂机向性价比最高（点击向在放置经济里是零头） */
export function buyBest(bot: Bot): string | null {
  const s = bot.state;
  const affordable = UPGRADES.filter((u) => s.moyu >= costOf(u.id, s.levels[u.id] ?? 0));
  if (!affordable.length) return null;
  let target: UpgradeDef | undefined;
  if (bot.cfg.strategy === "collector" || bot.cfg.strategy === "completionist") {
    target = affordable.find((u) => !(u.id in s.levels));
    if (!target && bot.cfg.strategy === "completionist") {
      // 图鉴党：优先补齐下一次彩蛋档（Lv5/10/20/50），跨档即解锁一条彩蛋
      target = affordable
        .filter((u) => {
          const lv = s.levels[u.id] ?? 0;
          return TIER_LEVELS.some((t) => t > lv);
        })
        .sort((a, b) => {
          const la = s.levels[a.id] ?? 0;
          const lb = s.levels[b.id] ?? 0;
          const ta = TIER_LEVELS.find((t) => t > la) ?? Infinity;
          const tb = TIER_LEVELS.find((t) => t > lb) ?? Infinity;
          return ta - la - (tb - lb) || costOf(a.id, la) - costOf(b.id, lb);
        })[0];
    }
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
  } else {
    target = [...affordable].sort(
      (a, b) => costOf(a.id, s.levels[a.id] ?? 0) - costOf(b.id, s.levels[b.id] ?? 0),
    )[0];
  }
  if (!target) return null;
  const next = buyUpgrade(s, target.id);
  if (!next) return null;
  bot.state = syncFlavorCollection(next);
  trackDaily(bot, "buy");
  bot.cur.purchases++;
  return target.id;
}

/** 开页：main.ts boot 链路（restore → settleReturn → 图鉴迁移 → 日报 → 新事件状态） */
export function openPage(bot: Bot, at: number): VisitLog {
  bot.now = at;
  const restored = restore(bot.mem, at);
  let state = restored.state ?? initialState();
  bot.createdAt = restored.createdAt;
  const rate = at - restored.createdAt < DAY_MS ? 1 : 0.7;
  const off = settleReturn(state, at - restored.offlineSeconds * 1000, at, rate);
  const idleRate = effectOf(off.state).idleRate;
  state = syncFlavorCollection(off.state);
  state = ensureDaily(state, dateOf(at), bot.rng);
  bot.state = state;
  // 每次开页都是新页面（main.ts boot）：事件从 0 排期
  bot.es = newEventState();
  bot.es.surviveStreak = state.surviveStreak;
  bot.gameTime = 0;
  bot.combo = 0;
  bot.lastTapAt = -99;
  bot.prevBossActive = false;
  bot.cur = emptyCounters(state.totalEarned);
  return {
    day: 0,
    visit: 0,
    at,
    gapSeconds: restored.offlineSeconds,
    offlineSeconds: restored.offlineSeconds,
    offlineApplied: off.applied,
    offlineEarned: off.earned,
    rate,
    idleRate,
    welcome: off.showPanel,
    activeEarned: 0,
    clicks: 0,
    patrols: 0,
    patrolReward: 0,
    memeHits: 0,
    purchases: 0,
    claimedReward: null,
    dailyDoneAtEnd: false,
    rankName: "",
    collection: 0,
  };
}

/** 关页前看一次日报（HUD 角标提示可领）并领取 */
function claimIfReady(bot: Bot): number | null {
  const d = bot.state.daily;
  if (!d || d.claimed || !dailyAllDone(d)) return null;
  if (bot.dayFirstClaim === null) {
    // 当天第一次 3/3 的时间：距当天首访（09:00）的秒数 + 回访序号
    const dayStart = EPOCH_DAY1 + Math.floor((bot.now - EPOCH_DAY1) / DAY_MS) * DAY_MS;
    const sinceFirst = Math.round((bot.now - (dayStart + VISIT_MINUTES[0]! * 60_000)) / 1000);
    let visit = 1;
    for (let v = 0; v < VISIT_MINUTES.length; v++) {
      if (bot.now - (dayStart + VISIT_MINUTES[v]! * 60_000) >= 0) visit = v + 1;
    }
    bot.dayFirstClaim = { visit, secondsSinceFirstVisit: sinceFirst };
  }
  const r = claimDaily(bot.state, d.date);
  if (r.claimedReward !== null) {
    bot.state = r.state;
    bot.cur.claimedReward = r.claimedReward;
  }
  return r.claimedReward;
}

/** 一次 180 秒主动游玩；返回本次主动收入（不含开页离线结算） */
export function playSession(bot: Bot): number {
  let tapCredit = 0;
  let nextBuyAt = bot.cfg.buyCadence;
  const steps = Math.round(SESSION_SECONDS / DT);
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    const inHold = bot.es.bossUntil > bot.gameTime && bot.es.bossVariant === "hold";
    const inBlitz = bot.es.bossUntil > bot.gameTime && bot.es.bossVariant === "blitz";
    const cps = inHold ? 0 : inBlitz ? bot.cfg.blitzCps : bot.cfg.cps;
    tapCredit += cps * DT;
    while (tapCredit >= 1) {
      tap(bot);
      tapCredit -= 1;
    }
    step(bot, DT);
    if (t + DT >= nextBuyAt) {
      nextBuyAt += bot.cfg.buyCadence;
      buyBest(bot);
    }
    // 日报 3/3 达成的瞬间：HUD 可领角标亮 → 玩家打开面板领取
    if (bot.cur.allDoneAt === null && bot.state.daily && dailyAllDone(bot.state.daily)) {
      bot.cur.allDoneAt = +(t + DT).toFixed(1);
      claimIfReady(bot);
    }
  }
  // 关页前再兜底看一眼
  claimIfReady(bot);
  bot.state = syncFlavorCollection(bot.state);
  // pagehide → serialize（savedAt = 关页时刻）
  serialize(bot.state, bot.mem, bot.now);
  return bot.state.totalEarned - bot.cur.startTotal;
}

/** 升级里程碑偏移（upgrades.ts 内部量，用 milestoneGap 反推：off = 20 - gap(lv0)） */
export function milestoneOffset(id: string): number {
  return (20 - milestoneGap(id, 0)) % 20;
}

/** 某升级已达成的 ×2 次数 */
export function milestoneCount(id: string, level: number): number {
  return Math.floor((level + milestoneOffset(id)) / 20);
}

function sumMilestones(levels: Record<string, number>): number {
  let n = 0;
  for (const u of UPGRADES) n += milestoneCount(u.id, levels[u.id] ?? 0);
  return n;
}

function dailySnapshot(d: DailyState | null): DayDaily | null {
  if (!d) return null;
  return {
    goals: d.goals.map((g) => g.id),
    done: dailyAllDone(d),
    claimed: d.claimed,
    streak: d.streak,
    reward: 0,
    doneAtVisit: null,
    doneAtSeconds: null,
  };
}

/** 当天结束快照 + 与前一天的「确定新变化」对比 */
export function snapshotDay(bot: Bot, day: number, prev: DayLog | null): DayLog {
  const s = bot.state;
  const r = rankFor(s.totalEarned);
  const rankIdx = RANKS.findIndex((x) => x.name === r.current);
  const collection = collectionCount(s);
  const milestones = sumMilestones(s.levels);
  const unlocked = UPGRADES.filter((u) => (s.levels[u.id] ?? 0) > 0).length;
  const dayIncome = bot.offlineEarnedToday + bot.activeEarnedToday;
  const dayVisits = bot.visits.filter((v) => v.day === day);
  let totalLevels = 0;
  for (const u of UPGRADES) totalLevels += s.levels[u.id] ?? 0;
  const d = s.daily;
  const daily: DayDaily | null = dailySnapshot(d);
  if (daily) {
    daily.reward = dailyReward(s);
    daily.doneAtVisit = bot.dayFirstClaim?.visit ?? null;
    daily.doneAtSeconds = bot.dayFirstClaim?.secondsSinceFirstVisit ?? null;
  }
  let nextMilestoneGap: number | null = null;
  for (const u of UPGRADES) {
    const lv = s.levels[u.id] ?? 0;
    if (lv <= 0) continue;
    const gap = milestoneGap(u.id, lv);
    nextMilestoneGap = nextMilestoneGap === null ? gap : Math.min(nextMilestoneGap, gap);
  }
  const prevRank = prev ? prev.rankIdx : -1;
  const prevCollection = prev ? prev.collection : collection;
  const prevUnlocked = prev ? prev.unlocked : unlocked;
  const newChanges: string[] = [];
  if (rankIdx > prevRank) newChanges.push(`段位→${r.current}`);
  if (collection > prevCollection) newChanges.push(`图鉴+${collection - prevCollection}`);
  if (unlocked > prevUnlocked) newChanges.push(`新升级+${unlocked - prevUnlocked}`);
  return {
    day,
    date: dateOf(bot.now),
    totalEarned: s.totalEarned,
    moyu: s.moyu,
    idleRate: effectOf(s).idleRate,
    clickPower: clickPowerOf(s),
    rankIdx,
    rankName: r.current,
    rankProgress: r.progress,
    toNextRank: r.next ? r.next.at - s.totalEarned : 0,
    collection,
    quotes: s.collected.quotes.length,
    flavors: s.collected.flavors.length,
    unlocked,
    levels: { ...s.levels },
    milestoneTotal: milestones,
    daily,
    offlineEarned: bot.offlineEarnedToday,
    activeEarned: bot.activeEarnedToday,
    dayIncome,
    offlineRatio: dayIncome > 0 ? bot.offlineEarnedToday / dayIncome : 0,
    dailyRewardRatio: dayIncome > 0 && daily ? daily.reward / dayIncome : 0,
    newChanges,
    newMilestones: prev ? milestones - prev.milestoneTotal : milestones,
    nextMilestoneGap,
    surviveStreak: s.surviveStreak,
    clicks: dayVisits.reduce((a, v) => a + v.clicks, 0),
    purchases: dayVisits.reduce((a, v) => a + v.purchases, 0),
    patrols: dayVisits.reduce((a, v) => a + v.patrols, 0),
    memeHits: dayVisits.reduce((a, v) => a + v.memeHits, 0),
    totalLevels,
  };
}

/** 跑完整 N 天（每天 3 次回访，每次 180s） */
export function runBot(cfg: BotConfig = DEFAULT_CFG): Bot {
  const bot = createBot(cfg);
  const visitMinutes = cfg.visitMinutes ?? VISIT_MINUTES;
  let prev: DayLog | null = null;
  for (let day = 1; day <= cfg.days; day++) {
    bot.offlineEarnedToday = 0;
    bot.activeEarnedToday = 0;
    bot.dayFirstClaim = null;
    const dayStart = EPOCH_DAY1 + (day - 1) * DAY_MS;
    for (let v = 0; v < visitMinutes.length; v++) {
      const at = dayStart + visitMinutes[v]! * 60_000;
      const open = openPage(bot, at);
      const active = playSession(bot);
      bot.offlineEarnedToday += open.offlineEarned;
      bot.activeEarnedToday += Math.max(0, active);
      const s = bot.state;
      const rec: VisitLog = {
        ...open,
        day,
        visit: v + 1,
        activeEarned: active,
        clicks: bot.cur.clicks,
        patrols: bot.cur.patrols,
        patrolReward: bot.cur.patrolReward,
        memeHits: bot.cur.memeHits,
        purchases: bot.cur.purchases,
        claimedReward: bot.cur.claimedReward,
        dailyDoneAtEnd: !!s.daily && dailyAllDone(s.daily),
        rankName: rankFor(s.totalEarned).current,
        collection: collectionCount(s),
      };
      bot.visits.push(rec);
    }
    const dayLog = snapshotDay(bot, day, prev);
    bot.days.push(dayLog);
    prev = dayLog;
  }
  return bot;
}

/** 连续「无确定新变化」的最长天数（按 DayLog.newChanges 为空计） */
export function longestNoChangeRun(days: DayLog[]): {
  length: number;
  from: number;
  to: number;
  runs: { from: number; to: number; length: number }[];
} {
  const runs: { from: number; to: number; length: number }[] = [];
  let start: number | null = null;
  for (const d of days) {
    const isQuiet = d.newChanges.length === 0;
    if (isQuiet && start === null) start = d.day;
    if (!isQuiet && start !== null) {
      runs.push({ from: start, to: d.day - 1, length: d.day - start });
      start = null;
    }
  }
  if (start !== null) {
    const last = days[days.length - 1]!;
    runs.push({ from: start, to: last.day, length: last.day - start + 1 });
  }
  runs.sort((a, b) => b.length - a.length);
  return { length: runs[0]?.length ?? 0, from: runs[0]?.from ?? 0, to: runs[0]?.to ?? 0, runs };
}

/** 连续「无弱变化」：新变化 + 里程碑 ×2 都没有（宽松口径） */
export function longestNoWeakChangeRun(days: DayLog[]): { length: number; from: number; to: number } {
  let best = { length: 0, from: 0, to: 0 };
  let start: number | null = null;
  days.forEach((d, i) => {
    const quiet = d.newChanges.length === 0 && d.newMilestones === 0;
    if (quiet && start === null) start = d.day;
    if (!quiet && start !== null) {
      const len = d.day - start;
      if (len > best.length) best = { length: len, from: start, to: d.day - 1 };
      start = null;
    }
    if (i === days.length - 1 && start !== null) {
      const len = d.day - start + 1;
      if (len > best.length) best = { length: len, from: start, to: d.day };
    }
  });
  return best;
}

/** 一行成长表 */
export function dayRow(d: DayLog): string {
  const daily = d.daily
    ? `${d.daily.goals.map((g) => g.slice(0, 4)).join("/")} ${d.daily.claimed ? "已领" : d.daily.done ? "完成未领" : "未完成"} streak=${d.daily.streak}`
    : "无日报";
  return `D${String(d.day).padStart(2, "0")} ${d.date.slice(5)} ${d.rankName}(${d.rankIdx + 1}/7 ${(d.rankProgress * 100).toFixed(0)}%) 图鉴${d.collection}/${TOTAL_ITEMS} 解锁${d.unlocked}/9 Lv合计${d.totalLevels} 累计${formatMoyu(d.totalEarned)} 挂机${formatMoyu(d.idleRate)}/s 日收入${formatMoyu(d.dayIncome)}(离线${(d.offlineRatio * 100).toFixed(0)}%) 买${d.purchases} 日报[${daily}] 变化[${d.newChanges.join(",") || "无"}${d.newMilestones > 0 ? ` ×2:${d.newMilestones}` : ""}]`;
}

export { TOTAL_ITEMS, RANKS, dailyReward, formatMoyu, formatLocalDate };


/** 图鉴缺口分析：剩余条目 + 补齐所需的等级/花费（按当前状态） */
export function collectionGap(state: GameState): {
  quotesMissing: number;
  flavorsMissing: number;
  items: { upgradeId: string; name: string; tierLv: number; from: number; to: number; cost: number; click: boolean }[];
  totalCost: number;
  idle: number;
} {
  const quotesMissing = MEME_QUOTES.length - state.collected.quotes.length;
  const items: { upgradeId: string; name: string; tierLv: number; from: number; to: number; cost: number; click: boolean }[] = [];
  let totalCost = 0;
  for (const u of UPGRADES) {
    const lv = state.levels[u.id] ?? 0;
    for (const tierLv of TIER_LEVELS) {
      if (lv >= tierLv) continue;
      let cost = 0;
      for (let k = lv; k < tierLv; k++) cost += costOf(u.id, k);
      items.push({ upgradeId: u.id, name: u.name, tierLv, from: lv, to: tierLv, cost, click: !!u.clickPower });
      totalCost += cost;
    }
  }
  return {
    quotesMissing,
    flavorsMissing: UPGRADES.length * 5 - state.collected.flavors.length,
    items,
    totalCost,
    idle: effectOf(state).idleRate,
  };
}


/** 离线口径统计：首日 1.0 / 之后 0.7 的逐次结算与累计损失 */
export function offlineAudit(bot: Bot): {
  firstRate1Visit: number;
  firstRate07: { day: number; visit: number; at: number } | null;
  loss07: number;
  actual07: number;
  capLostHours: number;
  totalOffline: number;
  totalActive: number;
  byDay: { day: number; earned: number; rate: number; applied: number; gapHours: number }[];
} {
  let firstRate1Visit = 0;
  let firstRate07: { day: number; visit: number; at: number } | null = null;
  let loss07 = 0;
  let actual07 = 0;
  let capLostHours = 0;
  let totalOffline = 0;
  let totalActive = 0;
  const byDay: { day: number; earned: number; rate: number; applied: number; gapHours: number }[] = [];
  for (const v of bot.visits) {
    totalOffline += v.offlineEarned;
    totalActive += v.activeEarned;
    if (v.rate === 1) firstRate1Visit++;
    if (v.rate < 1) {
      actual07 += v.offlineEarned;
      loss07 += v.offlineEarned / v.rate - v.offlineEarned;
      if (!firstRate07) firstRate07 = { day: v.day, visit: v.visit, at: v.at };
    }
    capLostHours += Math.max(0, (v.gapSeconds - v.offlineApplied) / 3600);
    byDay.push({ day: v.day, earned: v.offlineEarned, rate: v.rate, applied: v.offlineApplied, gapHours: v.gapSeconds / 3600 });
  }
  return { firstRate1Visit, firstRate07, loss07, actual07, capLostHours, totalOffline, totalActive, byDay };
}
