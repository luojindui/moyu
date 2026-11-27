/**
 * 终验（休闲画像）探针公共库：按 main.ts 真实主循环装配引擎
 *  - 点击：巡逻期 onBossTap / 丢梗期 onMemeTap / 平时 doClick（连击按真实间隔）
 *  - 事件：scheduleEvents / finishPatrol 与 main.ts 同顺序
 *  - 养成：买升级（含图鉴彩蛋同步、日报 buy 计数）、日报 ensureDaily/dailyTrack
 *  - 存档：serialize → restore → offlineEarn（离线 30 分钟真实链路）
 *
 * 探针只读 src/，不修改任何游戏文件。
 */
import { initialState, type GameState } from "../src/engine/state";
import { doClick, buyUpgrade, clickPowerOf, COMBO_WINDOW_S, COMBO_BREAK_S, COMBO_MAX, comboMultiplier } from "../src/engine/actions";
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

export interface Sim {
  state: GameState;
  es: EventState;
  gameTime: number;
  /** 模拟墙钟（ms） */
  now: number;
  combo: number;
  lastTapAt: number;
  rng: () => number;
  purchases: { t: number; id: string; name: string; lv: number }[];
  clicks: number;
  memeHits: number;
  /** 休闲玩家会看横幅：hold（忍住别点）时不点；type/blitz 照点 */
  dodgeHold: boolean;
  patrols: number;
  /** 巡逻安然奖励累计 */
  patrolReward: number;
  /** 上一帧是否处于巡逻（与 main.ts 的 prevBossActive 一致，跨帧保留） */
  prevBossActive: boolean;
}

export function newSim(seed = 7, now = new Date(2026, 10, 27, 10, 0, 0).getTime()): Sim {
  const rng = makeRng(seed);
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
    purchases: [],
    clicks: 0,
    memeHits: 0,
    dodgeHold: true,
    patrols: 0,
    patrolReward: 0,
    prevBossActive: false,
  };
}

export function dateOf(ms: number): string {
  return formatLocalDate(new Date(ms));
}

export function rankText(s: GameState): string {
  const r = rankFor(s.totalEarned);
  return r.next ? `${r.current}（升 ${r.next.name} ${(r.progress * 100).toFixed(0)}%）` : r.current;
}

/** 与 main.ts pointerdown 同逻辑（丢梗视为玩家瞄准命中） */
export function tap(sim: Sim): void {
  // 忍住型：老板巡逻 hold 变体期间不点（看横幅照做）
  if (sim.dodgeHold && sim.es.bossUntil > sim.gameTime && sim.es.bossVariant === "hold") return;
  const nowMs = sim.gameTime * 1000;
  const gap = (nowMs - sim.lastTapAt) / 1000;
  sim.combo = gap < COMBO_WINDOW_S ? Math.min(COMBO_MAX, sim.combo + 1) : gap > COMBO_BREAK_S ? 0 : sim.combo;
  sim.lastTapAt = nowMs;
  sim.clicks++;
  const daily = (kind: "click" | "meme" | "buy" | "survive", n = 1): void => {
    if (sim.state.daily) sim.state = { ...sim.state, daily: dailyTrack(sim.state.daily, kind, n) };
  };
  if (sim.es.bossUntil > sim.gameTime) {
    const r = onBossTap(sim.state, sim.es, sim.gameTime, sim.combo);
    sim.state = r.state;
    daily("click");
    return;
  }
  if (sim.es.memeUntil > sim.gameTime) {
    const r = onMemeTap(sim.state, sim.es);
    let next = r.state;
    const qi = Math.floor(sim.rng() * MEME_QUOTES.length);
    next = collectQuote(next, qi).state;
    sim.state = next;
    sim.memeHits++;
    daily("meme");
    return;
  }
  sim.state = doClick(sim.state, sim.combo);
  daily("click");
}

/** 推进 dt：与 main.ts frame 内的事件/巡逻/被动收益顺序一致 */
export function step(sim: Sim, dt: number): void {
  sim.gameTime += dt;
  sim.now += dt * 1000;
  scheduleEvents(sim.es, sim.gameTime, sim.rng);
  const bossActive = sim.es.bossUntil > sim.gameTime;
  if (sim.prevBossActive && !bossActive) {
    const r = finishPatrol(sim.state, sim.es);
    sim.state = r.state;
    sim.patrols++;
    if (r.reward > 0) {
      sim.patrolReward += r.reward;
      if (sim.state.daily) sim.state = { ...sim.state, daily: dailyTrack(sim.state.daily, "survive") };
    }
  }
  sim.prevBossActive = bossActive;
  // 跨日
  const d = dateOf(sim.now);
  if (sim.state.daily && sim.state.daily.date !== d) {
    sim.state = ensureDaily(sim.state, d, sim.rng);
  }
  sim.state = advance(sim.state, dt);
}

/** 玩家点击节奏：cps(t) 每秒点击次数（t=本次 session 内秒数） */
export function runSession(
  sim: Sim,
  seconds: number,
  cps: (t: number) => number,
  buyEvery = 5,
  strategy: "new" | "cheapest" = "new",
): { purchases: number; start: GameState; end: GameState } {
  const start = sim.state;
  let tapCredit = 0;
  let nextBuyAt = 0;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    tapCredit += cps(t) * DT;
    while (tapCredit >= 1) {
      tap(sim);
      tapCredit -= 1;
    }
    step(sim, DT);
    if (t >= nextBuyAt) {
      nextBuyAt += buyEvery;
      buyBest(sim, strategy);
    }
  }
  return { purchases: sim.purchases.length, start, end: sim.state };
}

/** 买升级：new=优先解锁新卡（收集欲），cheapest=最便宜 */
export function buyBest(sim: Sim, strategy: "new" | "cheapest" = "new"): boolean {
  const owned = new Set(Object.keys(sim.state.levels));
  const affordable = UPGRADES.filter((u) => sim.state.moyu >= costOf(u.id, sim.state.levels[u.id] ?? 0));
  if (!affordable.length) return false;
  let target = affordable.find((u) => !owned.has(u.id) && strategy === "new");
  if (!target) {
    target = [...affordable].sort((a, b) => costOf(a.id, sim.state.levels[a.id] ?? 0) - costOf(b.id, sim.state.levels[b.id] ?? 0))[0];
  }
  if (!target) return false;
  const next = buyUpgrade(sim.state, target.id);
  if (!next) return false;
  sim.state = syncFlavorCollection(next);
  if (sim.state.daily) sim.state = { ...sim.state, daily: dailyTrack(sim.state.daily, "buy") };
  sim.purchases.push({ t: sim.gameTime, id: target.id, name: target.name, lv: sim.state.levels[target.id] ?? 0 });
  return true;
}

/** 可买卡片数（当前余额能买得起的升级项） */
export function affordableCount(s: GameState): number {
  return UPGRADES.filter((u) => s.moyu >= costOf(u.id, s.levels[u.id] ?? 0)).length;
}

export function lockedCount(s: GameState): number {
  return UPGRADES.filter((u) => !(u.id in s.levels)).length;
}

export function dailySnapshot(d: DailyState | null): string {
  if (!d) return "无日报";
  const done = d.goals.filter((g) => g.done).length;
  const state = d.claimed ? "已领" : dailyAllDone(d) ? "★可领" : `${done}/3`;
  return `日报 ${d.date} ${state} streak=${d.streak}`;
}

/** 离线速率规则（与 main.ts currentOfflineRate 完全一致：建档 24h 内 1.0，之后 0.7） */
export function offlineRate(now: number, createdAt: number): number {
  return now - createdAt < DAY_MS ? 1 : 0.7;
}

/** 一次"回访"：存档 → 前进 offlineSeconds → restore → 离线结算（main.ts boot 链路） */
export function visitBack(sim: Sim, offlineSeconds: number): {
  restored: GameState;
  earnings: number;
  applied: number;
  rate: number;
  createdAt: number;
  welcome: boolean;
} {
  const mem = memSave();
  serialize(sim.state, mem, sim.now);
  sim.now += offlineSeconds * 1000;
  const back = restore(mem, sim.now);
  const rate = offlineRate(sim.now, back.createdAt);
  const off = offlineEarn(back.state ?? sim.state, back.offlineSeconds, rate);
  sim.state = syncFlavorCollection(off.state);
  const d = dateOf(sim.now);
  sim.state = ensureDaily(sim.state, d, sim.rng);
  const welcome = off.earned > 0;
  return { restored: back.state ?? sim.state, earnings: off.earned, applied: off.applied, rate, createdAt: back.createdAt, welcome };
}

/** HUD 一行（数值随时间的可读性） */
export function hudLine(s: GameState): string {
  return `摸鱼值 ${formatMoyu(s.moyu)}｜点击 +${clickPowerOf(s)}｜挂机 ${formatMoyu(effectOf(s).idleRate)}/秒｜${rankText(s)}`;
}

export { OFFLINE_CAP_SECONDS, TOTAL_ITEMS, collectionCount, clickPowerOf, effectOf, costOf, UPGRADES, formatMoyu, comboMultiplier };
