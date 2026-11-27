/**
 * R7 新手（onboarding）探针公共库：按 src/main.ts 真实主循环装配引擎，模拟「第一次接触放置游戏的新手」。
 *
 * 与 main.ts 对齐：
 *  - 点击：巡逻 hold 期 tap → onBossTap（0.8s 宽限后罚款）；type/blitz 期 tap 计数；丢梗期按概率命中 → onMemeTap
 *  - 每帧：gameTime += dt → scheduleEvents → 巡逻结束 finishPatrol → 跨日 ensureDaily → advance(dt)
 *  - 商店：每 3-5 秒瞄一眼（刷新节流 150ms）；优先买没买过的卡；「手痒」画像还会把闲钱砸在最便宜的已购卡上
 *
 * 新手画像：
 *  - 回应型（默认）：看到横幅会照做 → hold 忍住不点、type/blitz 点满
 *  - 屏蔽型：不看横幅，一直点（hold 巡逻被罚）
 *
 * 探针只读 src/，不修改任何游戏文件。
 */
import { initialState, type GameState } from "../src/engine/state";
import { doClick, buyUpgrade, clickPowerOf, COMBO_WINDOW_S, COMBO_BREAK_S, COMBO_MAX } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { UPGRADES, costOf, effectOf } from "../src/engine/upgrades";
import { newEventState, scheduleEvents, onBossTap, onMemeTap, finishPatrol, type EventState } from "../src/engine/events";
import { collectQuote, syncFlavorCollection, collectionCount, TOTAL_ITEMS } from "../src/engine/collection";
import { MEME_QUOTES } from "../src/engine/flavor";
import { ensureDaily, dailyTrack, formatLocalDate, dailyAllDone, type DailyState } from "../src/engine/daily";
import { rankFor } from "../src/engine/titles";
import { serialize, restore, type SaveAdapter } from "../src/engine/save";
import { offlineEarn, OFFLINE_CAP_SECONDS } from "../src/engine/offline";
import { formatMoyu } from "../src/engine/format";

export const DT = 0.05;
export const DAY_MS = 86_400_000;

/** mulberry32：可复现实数 */
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

export interface Purchase {
  t: number;
  id: string;
  name: string;
  cost: number;
  /** 是否为「第一次买这张卡」（解锁新内容） */
  isNew: boolean;
  lvAfter: number;
}

export interface Sim {
  state: GameState;
  es: EventState;
  gameTime: number;
  now: number;
  combo: number;
  lastTapAt: number;
  rng: () => number;
  /** 回应横幅：hold 巡逻忍住不点 */
  dodgeHold: boolean;
  /** 戳到丢梗的概率（屏幕随机位置） */
  memeHitProb: number;
  purchases: Purchase[];
  clicks: number;
  memeHits: number;
  patrols: number;
  patrolReward: number;
  caught: number;
  caughtTaps: number;
  fines: number;
  prevBossActive: boolean;
  events: { t: number; text: string }[];
  firstPatrolAt: number | null;
  firstMemeAt: number | null;
  firstCaughtAt: number | null;
  variantsSeen: Set<string>;
  firstAffordlessAt: number | null;
  maxAffordlessStreak: number;
  affordlessSeconds: number;
}

export function dateOf(ms: number): string {
  return formatLocalDate(new Date(ms));
}

export function newSim(opts: { seed?: number; now?: number; dodgeHold?: boolean; memeHitProb?: number } = {}): Sim {
  const rng = makeRng(opts.seed ?? 7);
  const now = opts.now ?? new Date(2026, 10, 27, 10, 0, 0).getTime();
  let state = initialState();
  state = ensureDaily(state, dateOf(now), rng);
  return {
    state,
    es: newEventState(),
    gameTime: 0,
    now,
    combo: 0,
    lastTapAt: -99,
    rng,
    dodgeHold: opts.dodgeHold ?? true,
    memeHitProb: opts.memeHitProb ?? 0.25,
    purchases: [],
    clicks: 0,
    memeHits: 0,
    patrols: 0,
    patrolReward: 0,
    caught: 0,
    caughtTaps: 0,
    fines: 0,
    prevBossActive: false,
    events: [],
    firstPatrolAt: null,
    firstMemeAt: null,
    firstCaughtAt: null,
    variantsSeen: new Set(),
    firstAffordlessAt: null,
    maxAffordlessStreak: 0,
    affordlessSeconds: 0,
  };
}

const dailyTick = (sim: Sim, kind: "click" | "meme" | "buy" | "survive", n = 1): void => {
  if (sim.state.daily) sim.state = { ...sim.state, daily: dailyTrack(sim.state.daily, kind, n) };
};

/** 与 main.ts pointerdown 同逻辑的一次点击 */
export function tap(sim: Sim): void {
  if (sim.dodgeHold && sim.es.bossUntil > sim.gameTime && sim.es.bossVariant === "hold") return;
  const nowMs = sim.gameTime * 1000;
  const gap = (nowMs - sim.lastTapAt) / 1000;
  sim.combo = gap < COMBO_WINDOW_S ? Math.min(COMBO_MAX, sim.combo + 1) : gap > COMBO_BREAK_S ? 0 : sim.combo;
  sim.lastTapAt = nowMs;
  sim.clicks++;

  if (sim.es.bossUntil > sim.gameTime) {
    const r = onBossTap(sim.state, sim.es, sim.gameTime, sim.combo);
    sim.state = r.state;
    if (r.caught) {
      sim.caught++;
      sim.fines += r.lost;
      if (sim.firstCaughtAt === null) {
        sim.firstCaughtAt = sim.gameTime;
        sim.events.push({ t: sim.gameTime, text: `第一次偷点被逮（-${Math.round(r.lost)}）` });
      }
    }
    if (sim.es.bossVariant !== "hold") sim.caughtTaps++;
    dailyTick(sim, "click");
    return;
  }
  if (sim.es.memeUntil > sim.gameTime && sim.rng() < sim.memeHitProb) {
    const r = onMemeTap(sim.state, sim.es);
    const qi = Math.floor(sim.rng() * MEME_QUOTES.length);
    sim.state = collectQuote(r.state, qi).state;
    sim.memeHits++;
    dailyTick(sim, "meme");
    return;
  }
  sim.state = doClick(sim.state, sim.combo);
  dailyTick(sim, "click");
}

/** 推进一步（= main.ts 单帧内的引擎部分） */
export function step(sim: Sim, dt: number): void {
  sim.gameTime += dt;
  sim.now += dt * 1000;
  const memeWasIdle = sim.es.memeUntil < 0;
  scheduleEvents(sim.es, sim.gameTime, sim.rng);
  if (memeWasIdle && sim.es.memeUntil > 0) {
    if (sim.firstMemeAt === null) sim.firstMemeAt = sim.gameTime;
    sim.events.push({ t: sim.gameTime, text: "丢梗出现" });
  }
  const bossActive = sim.es.bossUntil > sim.gameTime;
  if (!sim.prevBossActive && bossActive) {
    if (sim.firstPatrolAt === null) sim.firstPatrolAt = sim.gameTime;
    sim.variantsSeen.add(sim.es.bossVariant);
    sim.events.push({ t: sim.gameTime, text: `巡逻开始（${sim.es.bossVariant}）` });
  }
  if (sim.prevBossActive && !bossActive) {
    const r = finishPatrol(sim.state, sim.es);
    sim.state = r.state;
    sim.patrols++;
    if (r.reward > 0) {
      sim.patrolReward += r.reward;
      dailyTick(sim, "survive");
      sim.events.push({ t: sim.gameTime, text: `安然过巡逻 +${Math.round(r.reward)}` });
    } else {
      sim.events.push({ t: sim.gameTime, text: `巡逻结束：没奖（${sim.es.bossVariant}）` });
    }
  }
  sim.prevBossActive = bossActive;
  const d = dateOf(sim.now);
  if (sim.state.daily && sim.state.daily.date !== d) sim.state = ensureDaily(sim.state, d, sim.rng);
  sim.state = advance(sim.state, dt);
}

/** 新手瞄一眼商店：优先买没见过的新卡；spendLevels=true 时闲钱砸最便宜已购卡 */
export function buyLook(sim: Sim, spendLevels = true): Purchase | null {
  const lv = (id: string): number => sim.state.levels[id] ?? 0;
  const affordable = UPGRADES.filter((u) => sim.state.moyu >= costOf(u.id, lv(u.id)));
  if (affordable.length === 0) return null;
  const unseen = affordable.filter((u) => lv(u.id) === 0);
  let pick: (typeof UPGRADES)[number] | undefined;
  if (unseen.length > 0) {
    pick = unseen[0];
  } else if (spendLevels) {
    pick = [...affordable].sort((a, b) => costOf(a.id, lv(a.id)) - costOf(b.id, lv(b.id)))[0];
  }
  if (!pick) return null;
  const cost = costOf(pick.id, lv(pick.id));
  const isNew = lv(pick.id) === 0;
  const next = buyUpgrade(sim.state, pick.id);
  if (!next) return null;
  sim.state = syncFlavorCollection(next);
  dailyTick(sim, "buy");
  const p: Purchase = { t: sim.gameTime, id: pick.id, name: pick.name, cost, isNew, lvAfter: lv(pick.id) + 1 };
  sim.purchases.push(p);
  return p;
}

export interface Profile {
  name: string;
  cps: number;
  buyEvery: number;
  dodgeHold?: boolean;
  /** 是否把闲钱砸在最便宜的已购卡上（新手「手痒点亮卡」），默认 true */
  spendLevels?: boolean;
}

export interface MinuteRow {
  minute: number;
  moyu: number;
  clickPower: number;
  idleRate: number;
  cards: number;
  rank: string;
  rankIdx: number;
  totalEarned: number;
  purchasesInMinute: number;
  affordableNow: number;
  unbought: number;
  nextNewCost: number | null;
  nextNewEta: number | null;
}

export interface Stall {
  t: number;
  kind: "买不起任何卡" | "没有新卡" | "内容耗尽";
  detail: string;
}

export interface ProfileResult {
  profile: Profile;
  sim: Sim;
  rows: MinuteRow[];
  purchases: Purchase[];
  firstPurchaseAt: number | null;
  unlockAt: number[];
  rankAt: number[];
  exhaustionAt: number | null;
  firstStall: Stall | null;
  stalls: Stall[];
  patrols: number;
  patrolReward: number;
  variants: string[];
  caught: number;
  fines: number;
  memeHits: number;
  clicks: number;
  dailyGoalsDone: number;
  dailyDoneAt: number | null;
  collection: number;
  finalState: GameState;
  events: { t: number; text: string }[];
  firstPatrolAt: number | null;
  firstMemeAt: number | null;
  firstCaughtAt: number | null;
  /** 每分钟结束时的「可买卡数」为 0 的分钟数 */
  emptyShopMinutes: number[];
}

function rankIdxOf(s: GameState): number {
  return ["摸鱼实习生", "摸鱼学徒", "资深摸鱼", "摸鱼大师", "带薪摸鱼传说", "摸鱼之神", "摸鱼宇宙尽头"].indexOf(rankFor(s.totalEarned).current);
}

/** 跑一次新手 session（默认 600 秒） */
export function runProfile(p: Profile, seconds = 600, seed = 7): ProfileResult {
  const sim = newSim({ seed, dodgeHold: p.dodgeHold ?? true });
  const spendLevels = p.spendLevels ?? true;
  const rows: MinuteRow[] = [];
  const unlockAt: number[] = [];
  const rankAt: number[] = [];
  const seenCards = new Set<string>();
  const stalls: Stall[] = [];
  const emptyShopMinutes: number[] = [];
  const events = sim.events;
  let nextBuyAt = p.buyEvery;
  let tapCredit = 0;
  let purchasesInMinute = 0;
  let minuteIdx = 0;
  let lastRankIdx = rankIdxOf(sim.state);
  let lastUnlockT = 0;
  let firstStall: Stall | null = null;
  let dailyDoneAt: number | null = null;
  let affordlessStreak = 0;

  rows.push(snapshot(sim, 0, 0, p.cps));
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    tapCredit += p.cps * DT;
    while (tapCredit >= 1) {
      tap(sim);
      tapCredit -= 1;
    }
    step(sim, DT);

    // 每秒采样一次商店可买性 / 卡住检测
    if (i % 20 === 19) {
      const owned = sim.state.levels;
      const cheapest = Math.min(...UPGRADES.map((u) => costOf(u.id, owned[u.id] ?? 0)));
      const affordless = sim.state.moyu < cheapest;
      if (affordless) {
        sim.affordlessSeconds += 1;
        affordlessStreak += 1;
        if (sim.firstAffordlessAt === null) sim.firstAffordlessAt = sim.gameTime;
        if (affordlessStreak > sim.maxAffordlessStreak) sim.maxAffordlessStreak = affordlessStreak;
        if (affordlessStreak === 15) {
          const nextNew = cheapestNew(owned);
          stalls.push({
            t: sim.gameTime - 14,
            kind: "买不起任何卡",
            detail: `余额 ${formatMoyu(sim.state.moyu)} < 最便宜卡价 ${formatMoyu(cheapest)}；下一张新卡「${
              nextNew?.name ?? "无"
            }」需 ${nextNew ? formatMoyu(nextNew.cost) : "—"}，按当前收入约需 ${nextNew ? Math.round(nextNew.cost / Math.max(1, incomeOf(sim, p.cps))) : "—"}s`,
          });
        }
      } else {
        affordlessStreak = 0;
      }
      // 没有新卡可买：距上一张新卡 > 180s 且未全解锁
      const unbought = UPGRADES.filter((u) => (owned[u.id] ?? 0) === 0);
      if (unbought.length > 0 && sim.gameTime - lastUnlockT > 180) {
        const key = `no-new-${Math.round(lastUnlockT)}`;
        if (!stalls.some((s) => s.kind === "没有新卡" && Math.abs(s.t - lastUnlockT) < 1)) {
          const nextNew = cheapestNew(owned);
          stalls.push({
            t: lastUnlockT,
            kind: "没有新卡",
            detail: `「${lastUnlockedName(seenCards)}」之后 ${Math.round(
              sim.gameTime - lastUnlockT,
            )}s 没有新卡；下一张「${nextNew?.name}」${nextNew ? formatMoyu(nextNew.cost) : "—"}（约 ${nextNew ? Math.round(nextNew.cost / Math.max(1, incomeOf(sim, p.cps))) : "—"}s 收入），但闲钱被「最便宜已购卡」吸走`,
          });
        }
        void key;
      }
    }

    if (sim.gameTime >= nextBuyAt) {
      nextBuyAt += p.buyEvery;
      const before = sim.purchases.length;
      const bought = buyLook(sim, spendLevels);
      purchasesInMinute += sim.purchases.length - before;
      if (bought?.isNew && !seenCards.has(bought.id)) {
        seenCards.add(bought.id);
        unlockAt.push(bought.t);
        lastUnlockT = bought.t;
        events.push({ t: bought.t, text: `解锁新卡「${bought.name}」(${formatMoyu(bought.cost)})` });
      }
    }

    if (dailyDoneAt === null && sim.state.daily && dailyAllDone(sim.state.daily)) dailyDoneAt = sim.gameTime;
    const rk = rankIdxOf(sim.state);
    if (rk > lastRankIdx) {
      lastRankIdx = rk;
      rankAt[rk] = sim.gameTime;
      events.push({ t: sim.gameTime, text: `段位 → ${rankFor(sim.state.totalEarned).current}` });
    }

    if (Math.floor(sim.gameTime / 60) > minuteIdx) {
      minuteIdx = Math.floor(sim.gameTime / 60);
      const snap = snapshot(sim, minuteIdx * 60, purchasesInMinute, p.cps);
      rows.push(snap);
      if (snap.affordableNow === 0) emptyShopMinutes.push(snap.minute);
      purchasesInMinute = 0;
    }
  }

  // 收尾：最后一次新卡之后到 session 结束仍无新卡 → 也是「内容空窗」
  const ownedFinal = sim.state.levels;
  const remaining = UPGRADES.filter((u) => (ownedFinal[u.id] ?? 0) === 0);
  if (remaining.length > 0 && seconds - lastUnlockT > 180) {
    stalls.push({
      t: lastUnlockT,
      kind: "没有新卡",
      detail: `session 最后 ${Math.round(seconds - lastUnlockT)}s 无新卡；剩 ${remaining.map((u) => `${u.name}(${formatMoyu(costOf(u.id, 0))})`).join("、")}`,
    });
  }
  const exhaustionAt = remaining.length === 0 ? lastUnlockT : null;
  if (exhaustionAt !== null) stalls.push({ t: exhaustionAt, kind: "内容耗尽", detail: "9/9 张卡全解锁，之后只剩升级等级" });
  stalls.sort((a, b) => a.t - b.t);
  firstStall = stalls[0] ?? null;

  const d = sim.state.daily;
  return {
    profile: p,
    sim,
    rows,
    purchases: sim.purchases,
    firstPurchaseAt: sim.purchases[0]?.t ?? null,
    unlockAt,
    rankAt,
    exhaustionAt,
    firstStall,
    stalls,
    patrols: sim.patrols,
    patrolReward: sim.patrolReward,
    variants: [...sim.variantsSeen],
    caught: sim.caught,
    fines: sim.fines,
    memeHits: sim.memeHits,
    clicks: sim.clicks,
    dailyGoalsDone: d ? d.goals.filter((g) => g.done).length : 0,
    dailyDoneAt,
    collection: collectionCount(sim.state),
    finalState: sim.state,
    events,
    firstPatrolAt: sim.firstPatrolAt,
    firstMemeAt: sim.firstMemeAt,
    firstCaughtAt: sim.firstCaughtAt,
    emptyShopMinutes,
  };
}

function incomeOf(sim: Sim, cps: number): number {
  return clickPowerOf(sim.state) * cps + effectOf(sim.state).idleRate;
}

function cheapestNew(owned: Record<string, number>): { name: string; cost: number } | null {
  const rest = UPGRADES.filter((u) => (owned[u.id] ?? 0) === 0);
  if (rest.length === 0) return null;
  const u = [...rest].sort((a, b) => costOf(a.id, 0) - costOf(b.id, 0))[0]!;
  return { name: u.name, cost: costOf(u.id, 0) };
}

function lastUnlockedName(seen: Set<string>): string {
  const ids = UPGRADES.filter((u) => seen.has(u.id));
  return ids.at(-1)?.name ?? "开局";
}

function snapshot(sim: Sim, t: number, purchasesInMinute: number, cps: number): MinuteRow {
  const owned = sim.state.levels;
  const idleRate = effectOf(sim.state).idleRate;
  const clickPower = clickPowerOf(sim.state);
  const unbought = UPGRADES.filter((u) => (owned[u.id] ?? 0) === 0);
  const next = cheapestNew(owned);
  const income = clickPower * cps + idleRate;
  const rank = rankFor(sim.state.totalEarned);
  return {
    minute: Math.round(t / 60),
    moyu: sim.state.moyu,
    clickPower,
    idleRate,
    cards: UPGRADES.length - unbought.length,
    rank: rank.current,
    rankIdx: rankIdxOf(sim.state),
    totalEarned: sim.state.totalEarned,
    purchasesInMinute,
    affordableNow: UPGRADES.filter((u) => sim.state.moyu >= costOf(u.id, owned[u.id] ?? 0)).length,
    unbought: unbought.length,
    nextNewCost: next?.cost ?? null,
    nextNewEta: next ? Math.max(0, (next.cost - sim.state.moyu) / Math.max(0.01, income)) : null,
  };
}

/** 一次回访：存档 → 前进 offlineSeconds → restore → 离线结算（= main.ts boot 链路） */
export function visitBack(sim: Sim, offlineSeconds: number): { earnings: number; applied: number; rate: number } {
  const mem = memSave();
  serialize(sim.state, mem, sim.now);
  sim.now += offlineSeconds * 1000;
  const back = restore(mem, sim.now);
  const rate = sim.now - back.createdAt < DAY_MS ? 1 : 0.7;
  const off = offlineEarn(back.state ?? sim.state, back.offlineSeconds, rate);
  sim.state = syncFlavorCollection(off.state);
  sim.state = ensureDaily(sim.state, dateOf(sim.now), sim.rng);
  return { earnings: off.earned, applied: off.applied, rate };
}

/** HUD 一行（= Hud.refresh 的显示逻辑） */
export function hudLine(s: GameState): string {
  const r = rankFor(s.totalEarned);
  const short = r.current.replace(/^带薪/, "").replace(/^摸鱼/, "");
  return `摸鱼值 ${formatMoyu(s.moyu)}｜点击 +${clickPowerOf(s)}｜挂机 ${formatMoyu(effectOf(s).idleRate)}/秒｜${
    r.next ? `${short} ${(r.progress * 100).toFixed(0)}%` : short
  }`;
}

/** 报告一行（Markdown 表） */
export function tableRow(r: MinuteRow): string {
  return `| ${r.minute} | ${formatMoyu(r.moyu)} | ${r.clickPower} | ${formatMoyu(r.idleRate)} | ${r.cards}/9 | ${
    r.rank
  } | ${r.purchasesInMinute} | ${r.affordableNow} | ${r.nextNewCost === null ? "—" : formatMoyu(r.nextNewCost)} |`;
}

export { UPGRADES, costOf, effectOf, clickPowerOf, formatMoyu, rankFor, dailyAllDone, OFFLINE_CAP_SECONDS, TOTAL_ITEMS, collectionCount, offlineEarn, serialize, restore, syncFlavorCollection };
