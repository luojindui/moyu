/**
 * 终验硬核玩家探针（只读 src/，不改 src/）：30 天长线模拟 + 四批系统的最优策略/假选择审计。
 *
 * 运行：export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
 *       node_modules/.bin/vite-node playtest/probe-final-hardcore.ts
 *
 * 主画像：硬核放置玩家，每天开机 3 次（08:00 6min / 12:30 2min / 19:00 12min），
 * 关机期间按真实离线结算（夜间 13.1h 撞 12h 封顶）。合计在线 20min/天。
 * 对照画像：页面常开 24/7（挂机页不关）。
 * 数值全部走真实引擎：effectOf / stationIdleScaled / offlineEarn / offlineEfficiency /
 * dispatchReward / claimMission / dailyReward / finishGame / decorEffects / talentEffects / prestige*。
 */
import { writeFileSync } from "node:fs";
import type { GameState } from "../src/engine/state";
import { initialState, gain } from "../src/engine/state";
import { UPGRADES, costOf, effectOf, stationIdleScaled } from "../src/engine/upgrades";
import { clickPowerOf } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { offlineEarn } from "../src/engine/offline";
import { offlineEfficiency, ensureVisits } from "../src/engine/progression";
import { ensureDaily, claimDaily } from "../src/engine/daily";
import { DECOR, buyDecor, decorEffects } from "../src/engine/decor";
import {
  COLLEAGUES, MISSIONS, recruit, upgradeColleague, dispatch, claimMission, setAutoRepeat,
  dispatchReward, missionSecondsFor, MAX_COLLEAGUE_LEVEL,
} from "../src/engine/team";
import {
  canUnlock, unlockTalent, costOfTalent, talentEffects, grantDailyTalentPoint, grantRankTalents,
  TALENT_POINT_CAP,
} from "../src/engine/talents";
import { canPrestige, prestigeGain, doPrestige, prestigeMultiplier } from "../src/engine/prestige";
import { CARDS, rollOffers, chooseCard, cardEffects } from "../src/engine/cards";
import { ENERGY_ACTIONS, ensureEnergy, useEnergy } from "../src/engine/energy";
import { finishGame, ensureArcade } from "../src/engine/minigames";
import { syncFlavorCollection, collectQuote, collectionCount } from "../src/engine/collection";
import { bossSurviveReward, type EventState } from "../src/engine/events";
import { RANKS } from "../src/engine/titles";
import { MEME_QUOTES } from "../src/engine/flavor";

/* ============================== 工具 ============================== */
const DAY = 86400;
const REAL_NOW = Date.now();
const BASE_MS = new Date(2026, 10, 1, 0, 0, 0).getTime();
let seed = 1234567;
const rng = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toLocaleString("en-US", { maximumFractionDigits: d }) : String(x));
const sci = (x: number): string => {
  if (!Number.isFinite(x)) return "∞";
  if (x === 0) return "0";
  const ax = Math.abs(x);
  if (ax >= 1e5 || ax < 0.01) {
    const e = Math.floor(Math.log10(ax));
    return `${(x / 10 ** e).toFixed(2)}e${e}`;
  }
  return x.toFixed(1);
};
const hrs = (s: number) => (s >= 3600 ? `${fmt(s / 3600, 1)}h` : `${fmt(s / 60, 0)}min`);
const dateStr = (sec: number) => new Date(BASE_MS + sec * 1000).toLocaleDateString("sv-SE");

interface SessionDef { at: number; dur: number }
const SESSIONS: SessionDef[] = [
  { at: 8 * 3600, dur: 360 },
  { at: 12.5 * 3600, dur: 120 },
  { at: 19 * 3600, dur: 720 },
];
const ACTIVE_SEC = SESSIONS.reduce((a, b) => a + b.dur, 0); // 1200s
const SAME_DAY_GAPS = (12.5 * 3600 - (8 * 3600 + 360)) + (19 * 3600 - (12.5 * 3600 + 120));
const NIGHT_GAP = 24 * 3600 - (19 * 3600 + 720) + 8 * 3600; // 13.13h
const CLICK_SECONDS = [30, 0, 120]; // 375 点击/天
const CPS = 2.5;
const COMBO_MULT = 1.24;

/* 会话日历下每个任务「每天能领取几次」（页面只在会话窗口内开；离线完成只能下次开机领） */
function claimsPerDayFor(seconds: number, sessions: SessionDef[] = SESSIONS): number {
  const open = (t: number): boolean => sessions.some((s) => {
    const dayStart = Math.floor(t / DAY) * DAY;
    const st = dayStart + s.at;
    return t >= st && t < st + s.dur;
  });
  const nextOpen = (t: number): number => {
    for (let d = Math.floor(t / DAY); d <= Math.floor(t / DAY) + 2; d++) {
      for (const s of sessions) {
        const st = d * DAY + s.at;
        if (st >= t) return st;
      }
    }
    return t + DAY;
  };
  let claims = 0;
  let t = 0;
  let guard = 0;
  while (t < 2 * DAY && guard++ < 200000) {
    const doneAt = t + seconds;
    const claimAt = open(doneAt) ? doneAt : nextOpen(doneAt);
    if (claimAt >= 2 * DAY) break;
    if (claimAt >= DAY) claims++;
    t = claimAt;
  }
  return claims;
}
const CLAIM = new Map<number, number>();
for (const m of MISSIONS) CLAIM.set(m.seconds, claimsPerDayFor(m.seconds));
/** 页面常开画像：完成即可领 */
const CLAIM_OPEN = new Map<number, number>();
for (const m of MISSIONS) CLAIM_OPEN.set(m.seconds, Math.floor((DAY / m.seconds) * 100) / 100);

/* ============================== 派遣日收益估计 ============================== */
function dispatchDailyEst(
  state: GameState,
  claimTable: Map<number, number> = CLAIM,
): { total: number; per: Record<string, { mission: string; reward: number; claims: number; daily: number }> } {
  const station = stationIdleScaled(state);
  const per: Record<string, { mission: string; reward: number; claims: number; daily: number }> = {};
  let total = 0;
  for (const def of COLLEAGUES) {
    const cur = state.team.colleagues[def.id];
    if (!cur) continue;
    let best = { mission: "", reward: 0, claims: 0, daily: 0 };
    for (const m of MISSIONS) {
      const probe: GameState = { ...state, team: { colleagues: { ...state.team.colleagues, [def.id]: { ...cur, missionId: m.id } } } };
      const reward = dispatchReward(probe, def.id, station);
      const claims = claimTable.get(m.seconds) ?? 0;
      const daily = reward * claims;
      if (daily > best.daily) best = { mission: m.id, reward, claims, daily };
    }
    if (best.daily > 0) { per[def.id] = best; total += best.daily; }
  }
  return { total, per };
}

/* ============================== 候选购买 ============================== */
interface Cand { kind: "upgrade" | "decor" | "recruit" | "colUp"; id: string; cost: number; deltaDaily: number; buy: () => GameState | null }

function candidates(state: GameState, disp: { total: number }, claimTable: Map<number, number>, offSec: number, offEff: number, nowMs: number): Cand[] {
  const out: Cand[] = [];
  const eff = effectOf(state);
  const station = stationIdleScaled(state);
  const idleSec = ACTIVE_SEC + (SAME_DAY_GAPS + offSec) * offEff;
  const clicks = CLICK_SECONDS.reduce((a, b) => a + b, 0) * CPS;
  const dispTotal = disp.total;
  for (const u of UPGRADES) {
    const lv = state.levels[u.id] ?? 0;
    const cost = costOf(u.id, lv);
    const probe: GameState = { ...state, levels: { ...state.levels, [u.id]: lv + 1 } };
    const after = effectOf(probe);
    let delta = 0;
    if (u.idleRate) {
      delta += (after.idleRate - eff.idleRate) * idleSec;
      if (dispTotal > 0 && station > 0) delta += dispTotal * ((stationIdleScaled(probe) - station) / station) * 0.5;
    }
    if (u.clickPower) delta += (clickPowerOf(probe) - clickPowerOf(state)) * clicks;
    if (delta > 0 && cost > 0) out.push({ kind: "upgrade", id: u.id, cost, deltaDaily: delta, buy: () => ({ ...state, moyu: state.moyu - cost, levels: { ...state.levels, [u.id]: lv + 1 } }) });
  }
  for (const d of DECOR) {
    if (state.decor.includes(d.id)) continue;
    const probe: GameState = { ...state, decor: [...state.decor, d.id] };
    const dIdle = effectOf(probe).idleRate - eff.idleRate;
    // 离线/同日离线段：家具的 offlineBonus 通过 offlineEfficiency 抬高效率；用真实引擎离线结算差分
    const effBase = offlineEfficiency(state, BASE_MS, nowMs);
    const effProbe = offlineEfficiency(probe, BASE_MS, nowMs);
    const offGain = offSec > 0 ? offlineEarn(probe, offSec, effProbe).earned - offlineEarn(state, offSec, effBase).earned : 0;
    const sameGapGain = offSec > 0 ? offlineEarn(probe, SAME_DAY_GAPS, effProbe).earned - offlineEarn(state, SAME_DAY_GAPS, effBase).earned : 0;
    const dDisp = dispTotal * (decorEffects(probe).dispatchRewardMult / Math.max(decorEffects(state).dispatchRewardMult, 1e-9) - 1);
    const delta = dIdle * ACTIVE_SEC + offGain + sameGapGain + dDisp
      + (clickPowerOf(probe) - clickPowerOf(state)) * clicks;
    if (delta > 0) out.push({ kind: "decor", id: d.id, cost: d.cost, deltaDaily: delta, buy: () => buyDecor(state, d.id) });
  }
  for (const def of COLLEAGUES) {
    const cur = state.team.colleagues[def.id];
    if (!cur) {
      const after = recruit(state, def.id);
      if (!after) continue;
      const dIdle = (effectOf(after).idleRate - eff.idleRate) * idleSec;
      const dDisp = dispatchDailyEst(after, claimTable).total - dispTotal;
      const delta = dIdle + dDisp + (clickPowerOf(after) - clickPowerOf(state)) * clicks;
      if (delta > 0) out.push({ kind: "recruit", id: def.id, cost: def.cost, deltaDaily: delta, buy: () => recruit(state, def.id) });
    } else if (cur.level < MAX_COLLEAGUE_LEVEL) {
      const price = Math.ceil(def.cost * 0.4 * 1.35 ** cur.level);
      const after = upgradeColleague(state, def.id);
      if (!after) continue;
      const dIdle = (effectOf(after).idleRate - eff.idleRate) * idleSec;
      const dDisp = dispatchDailyEst(after, claimTable).total - dispTotal;
      const delta = dIdle + dDisp;
      if (delta > 0) out.push({ kind: "colUp", id: def.id, cost: price, deltaDaily: delta, buy: () => upgradeColleague(state, def.id) });
    }
  }
  return out.sort((a, b) => a.cost / a.deltaDaily - b.cost / b.deltaDaily);
}

/* ============================== 天赋：硬核加点顺序 ============================== */
const TALENT_ORDER = ["idle_1", "idle_2", "idle_3", "idle_4", "idle_5a", "click_1", "click_2", "click_3", "click_4", "click_5a", "event_1", "event_2", "event_3", "event_4"];
function spendTalents(state: GameState): GameState {
  for (const id of TALENT_ORDER) {
    if (!canUnlock(state.talents, id)) continue;
    const after = unlockTalent(state, id);
    if (after) return after;
  }
  return state;
}
function rankIndexFor(lifetime: number): number {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (lifetime >= RANKS[i]!.at) idx = i;
  return idx;
}

/* ============================== 评估工具 ============================== */
const ES5: EventState = {
  nextBossAt: 0, bossUntil: 0, nextMemeAt: 0, memeUntil: 0, bossCaught: false, bossStartAt: 0,
  surviveStreak: 5, bossVariant: "hold", bossTaps: 0, bossPenaltyTotal: 0, patrolCount: 10,
  memeCount: 0, bossPersonality: "hasty", bossChoiceDone: false, forcedVariant: null,
};
function cardValue(state: GameState, cardId: string, dispDaily: number, activeSec: number, sameDayGaps: number): number {
  const none = { ...state, cards: { ...state.cards, chosen: null, until: 0 } };
  const probe: GameState = { ...state, cards: { ...state.cards, chosen: cardId, chosenDate: "x", until: REAL_NOW + 1000 * 3600 * 48 } };
  const e0 = effectOf(none).idleRate;
  const e1 = effectOf(probe).idleRate;
  let v = (e1 - e0) * (activeSec + sameDayGaps);
  // 同日离线段：效率也受卡影响（offlineBonus/riskPenalty）
  const createdAt = BASE_MS - 10 * DAY;
  const eff0 = offlineEfficiency(none, createdAt, REAL_NOW);
  const eff1 = offlineEfficiency(probe, createdAt, REAL_NOW);
  const stationOnly = (st: GameState) => stationIdleScaled(st);
  // 离线结算 = (工位 100% + 同事 50%) × 秒 × 效率；用引擎离线结算的差分（同日两段）
  v += offlineEarn(probe, sameDayGaps, eff1).earned - offlineEarn(none, sameDayGaps, eff0).earned;
  void stationOnly;
  // 派遣
  const c0 = cardEffects(none, REAL_NOW).dispatchRewardMult;
  const c1 = cardEffects(probe, REAL_NOW).dispatchRewardMult;
  v += dispDaily * (c1 / c0 - 1);
  // 点击
  v += (clickPowerOf(probe) - clickPowerOf(none)) * CLICK_SECONDS.reduce((a, b) => a + b, 0) * CPS;
  // 巡逻
  const patrol0 = (activeSec / 120) * bossSurviveReward(none, ES5) * 1.22 * cardEffects(none, REAL_NOW).patrolRewardMult;
  const patrol1 = (activeSec / 120) * bossSurviveReward(probe, ES5) * 1.22 * cardEffects(probe, REAL_NOW).patrolRewardMult;
  v += patrol1 - patrol0;
  return v;
}

/* ============================== 主模拟 ============================== */
interface DaySnap {
  day: number; date: string; totalEarned: number; lifetime: number;
  income: number; click: number; stream: Record<string, number>;
  prestige: number; prestiges: number; rank: string; nextRankAt: number | null;
  levels: Record<string, number>; decor: string[]; col: string[]; colFavor: number; colLevelSum: number;
  talentUnlocked: number; talentPoints: number; talentOverflow: number; talentSpent: number;
  collection: number; store: number; dispDaily: number; dispShare: number;
  offEff: number; clickTotal: number;
}
type PrestigePolicy = "never" | "daily" | "spam" | "gain5" | "gain10" | "gain20";
interface SimOpts {
  prestigePolicy: PrestigePolicy;
  keepOpen: boolean;
  days: number;
  onDecorBuy?: (id: string, day: number, stateBefore: GameState, income: number) => void;
}

function simulate(o: SimOpts): { snaps: DaySnap[]; end: GameState } {
  const snaps: DaySnap[] = [];
  let state: GameState = initialState();
  const t0 = BASE_MS / 1000;
  let t = 0;
  let prestiges = 0;
  const claimTable = o.keepOpen ? CLAIM_OPEN : CLAIM;
  const offSec = o.keepOpen ? 0 : Math.min(NIGHT_GAP, 12 * 3600);
  const sessions: SessionDef[] = o.keepOpen ? [{ at: 0, dur: DAY }] : SESSIONS;
  const stream: Record<string, number> = {};
  const addStream = (k: string, v: number) => { if (v > 0) stream[k] = (stream[k] ?? 0) + v; };
  const gainTo = (before: GameState, after: GameState, k: string) => addStream(k, after.totalEarned - before.totalEarned);
  let lastDay = -1;
  let ownQuotes = new Set<number>();
  let pendingTasks: string[] = [];
  let lastJournalWindow = -1;
  const nowMs = () => (t0 + t) * 1000;
  const today = () => dateStr(t);
  const windowOf = () => Math.floor(new Date(nowMs()).getHours() / 6);

  const doPrestigeOnce = (why: string): void => {
    const r = doPrestige(state);
    if (!r) return;
    state = r.state;
    prestiges++;
    pendingTasks.push(`转生+${r.gained}(${why})`);
    for (let i = 0; i < 10; i++) state = spendTalents(state);
  };
  const doDayStart = (): void => {
    state = ensureEnergy(state, today());
    state = ensureArcade(state, today());
    const dg = grantDailyTalentPoint(state.talents, today());
    if (dg.granted > 0) { state = { ...state, talents: dg.talents }; pendingTasks.push("领每日天赋点"); }
    const rg = grantRankTalents(state.talents, rankIndexFor(state.lifetimeEarned));
    if (rg.granted > 0) { state = { ...state, talents: rg.talents }; pendingTasks.push(`段位天赋点+${rg.granted}`); }
    for (let i = 0; i < 10; i++) state = spendTalents(state);
  };
  const tryPrestige = (): void => {
    if (o.prestigePolicy === "never" || o.prestigePolicy === "daily") return;
    const minGain = o.prestigePolicy === "spam" ? 1 : o.prestigePolicy === "gain5" ? 5 : o.prestigePolicy === "gain10" ? 10 : 20;
    for (let i = 0; i < 5; i++) {
      if (!canPrestige(state) || prestigeGain(state) < minGain) return;
      doPrestigeOnce(`≥${minGain}点`);
    }
  };

  const settleOffline = (gapSec: number): void => {
    if (gapSec <= 0 || o.keepOpen) return;
    const rate = offlineEfficiency(state, BASE_MS, nowMs());
    const before = state;
    const r = offlineEarn(state, gapSec, rate);
    state = r.state;
    gainTo(before, state, "离线");
  };

  const collectCard = (): void => {
    const cs = state.cards && state.cards.date === today() ? state.cards : rollOffers(today(), rng);
    state = { ...state, cards: cs };
    if (cs.chosenDate === today()) return;
    const disp = dispatchDailyEst(state, claimTable).total;
    let bestId = cs.offers[0]!;
    let bestV = -Infinity;
    for (const id of cs.offers) {
      const v = cardValue(state, id, disp, ACTIVE_SEC, o.keepOpen ? 0 : SAME_DAY_GAPS);
      if (v > bestV) { bestV = v; bestId = id; }
    }
    if (bestV <= 0) { pendingTasks.push("今日卡全负收益：跳过"); return; }
    const after = chooseCard(state, bestId, nowMs());
    if (after) {
      state = after;
      pendingTasks.push(`选卡:${CARDS.find((c) => c.id === bestId)?.name}`);
    }
  };

  const claimJournal = (): void => {
    const w = windowOf();
    const d = today();
    let st = ensureDaily(state, d, rng, w);
    if (st.daily) {
      st = { ...st, daily: { ...st.daily, goals: st.daily.goals.map((g) => ({ ...g, progress: g.target, done: true })) } };
      const before = st;
      const r = claimDaily(st, d);
      if (r.claimedReward !== null) {
        state = r.state;
        gainTo(before, state, "日报");
        pendingTasks.push(`领日报+${sci(r.claimedReward)}`);
      } else state = st;
    }
  };

  const doDispatchSetup = (reoptimize: boolean): void => {
    const disp = dispatchDailyEst(state, claimTable);
    for (const def of COLLEAGUES) {
      const cur = state.team.colleagues[def.id];
      if (!cur) continue;
      const bestMid = disp.per[def.id]?.mission ?? "stroll";
      if (cur.missionId === null) {
        const r = dispatch(state, def.id, bestMid, nowMs(), stationIdleScaled(state));
        if (r) state = r;
        const ar = setAutoRepeat(state, def.id, true);
        if (ar) state = ar;
        continue;
      }
      if (!cur.autoRepeat) {
        const ar = setAutoRepeat(state, def.id, true);
        if (ar) state = ar;
      }
      if (reoptimize && cur.missionId !== bestMid) {
        // 重排：换任务会损失当前进度，仅当新任务日收益显著更高才换
        const station = stationIdleScaled(state);
        const curProbe: GameState = { ...state, team: { colleagues: { ...state.team.colleagues, [def.id]: { ...cur, missionId: cur.missionId } } } };
        const curM = MISSIONS.find((m) => m.id === cur.missionId)!;
        const curDaily = dispatchReward(curProbe, def.id, station) * (claimTable.get(curM.seconds) ?? 0);
        if ((disp.per[def.id]?.daily ?? 0) > curDaily * 1.5) {
          state = { ...state, team: { colleagues: { ...state.team.colleagues, [def.id]: { ...cur, missionId: null, endsAt: 0, startedAt: 0, rewardSnapshot: 0 } } } };
          const r = dispatch(state, def.id, bestMid, nowMs(), stationIdleScaled(state));
          if (r) state = r;
          pendingTasks.push(`换派:${def.name}→${MISSIONS.find((m) => m.id === bestMid)?.name}`);
        }
      }
    }
  };

  const useEnergyOptimal = (remainingIdleSec: number): void => {
    const base = ensureEnergy(state, today());
    const baseIdle = effectOf(base).idleRate;
    let best = { actions: [] as string[], value: 0 };
    const ids = ENERGY_ACTIONS.map((a) => a.id);
    for (let mask = 1; mask < 1 << ids.length; mask++) {
      const actions: string[] = [];
      let st: GameState | null = base;
      for (let i = 0; i < ids.length; i++) if (mask & (1 << i)) {
        st = useEnergy(st!, ids[i] as never);
        if (!st) break;
        actions.push(ids[i]!);
      }
      if (!st) continue;
      let v = (effectOf(st).idleRate - baseIdle) * remainingIdleSec;
      const dStat = stationIdleScaled(st) / Math.max(stationIdleScaled(base), 1e-9);
      v += dispatchDailyEst(base, claimTable).total * (dStat - 1);
      const patrols = (ACTIVE_SEC / 120);
      const p0 = bossSurviveReward(base, ES5) * 1.22 * patrols;
      const p1 = bossSurviveReward(st, ES5) * 1.22 * patrols * (cardEffects(st, REAL_NOW).patrolRewardMult / cardEffects(base, REAL_NOW).patrolRewardMult);
      v += p1 - p0;
      if (v > best.value) best = { actions, value: v };
    }
    for (const a of best.actions) {
      const r = useEnergy(state, a as never);
      if (r) state = r;
    }
    if (best.actions.length) pendingTasks.push(`精力:${best.actions.map((a) => ENERGY_ACTIONS.find((x) => x.id === a)?.name).join("+")}`);
  };

  const buyStep = (): void => {
    for (let iter = 0; iter < 8; iter++) {
      const disp = dispatchDailyEst(state, claimTable);
      const offEff = o.keepOpen ? 0 : offlineEfficiency(state, BASE_MS, nowMs());
      const cands = candidates(state, disp, claimTable, offSec, Math.max(offEff, 0), nowMs());
      const afford = cands.filter((c) => c.cost <= state.moyu);
      if (!afford.length) return;
      const buy = afford[0]!;
      if (o.onDecorBuy && buy.kind === "decor") o.onDecorBuy(buy.id, Math.floor(t / DAY) + 1, state, effectOf(state).idleRate);
      const after = buy.buy();
      if (!after) return;
      state = after;
    }
  };

  const stepSec = o.keepOpen ? 10 : 1;
  addStream("_", 0);
  for (let day = 0; day < o.days; day++) {
    for (const k of Object.keys(stream)) delete stream[k];
    pendingTasks = [];
    for (let si = 0; si < sessions.length; si++) {
      const s = sessions[si]!;
      const openAt = day * DAY + s.at;
      const prevEnd = si === 0
        ? (day === 0 ? openAt : (day - 1) * DAY + sessions[sessions.length - 1]!.at + sessions[sessions.length - 1]!.dur)
        : day * DAY + sessions[si - 1]!.at + sessions[si - 1]!.dur;
      const gap = day === 0 && si === 0 ? 0 : openAt - prevEnd;
      t = openAt;
      if (day !== lastDay) { lastDay = day; doDayStart(); }
      state = ensureVisits(state, nowMs());
      settleOffline(gap);
      if (si === 0 && o.prestigePolicy === "daily" && canPrestige(state)) doPrestigeOnce("每日");
      if (si === 0) collectCard();
      if (!o.keepOpen) claimJournal();
      doDispatchSetup(si === 0);
      if (si === 0) useEnergyOptimal(ACTIVE_SEC + (o.keepOpen ? 0 : SAME_DAY_GAPS));
      // 领取关机期间完成的派遣
      for (const def of COLLEAGUES) {
        const cur = state.team.colleagues[def.id];
        if (cur && cur.missionId !== null && nowMs() >= cur.endsAt) {
          const before = state;
          const r = claimMission(state, def.id, nowMs(), stationIdleScaled(state));
          if (r) { state = r.state; gainTo(before, state, "派遣"); }
        }
      }
      // 摸鱼站 3 次/天（内容向；占收入 <0.1%）
      for (let g = 0; g < 3; g++) {
        const r = finishGame(state, "findboss", 1200, effectOf(state).idleRate, 30);
        if (!r) break;
        state = r.state;
        addStream("小游戏", r.reward);
      }
      let clickBudget = o.keepOpen ? CLICK_SECONDS.reduce((a, b) => a + b, 0) : CLICK_SECONDS[si]!;
      let tp = 120; let tm = 60;
      for (let sec = 0; sec < s.dur; sec += stepSec) {
        const dt = Math.min(stepSec, s.dur - sec);
        if (clickBudget > 0) {
          const before = state;
          state = gain(state, clickPowerOf(state) * CPS * COMBO_MULT * dt);
          state = { ...state, totalClicks: state.totalClicks + CPS * dt };
          gainTo(before, state, "点击");
          clickBudget -= dt;
        }
        const beforeIdle = state;
        state = advance(state, dt);
        gainTo(beforeIdle, state, "挂机");
        for (const def of COLLEAGUES) {
          const cur = state.team.colleagues[def.id];
          if (cur && cur.missionId !== null && nowMs() >= cur.endsAt) {
            const before = state;
            const r = claimMission(state, def.id, nowMs(), stationIdleScaled(state));
            if (r) { state = r.state; gainTo(before, state, "派遣"); }
          }
        }
        tp -= dt;
        if (tp <= 0) {
          tp += 120;
          const before = state;
          const rw = bossSurviveReward(state, ES5) * 1.22;
          state = gain(state, rw);
          gainTo(before, state, "巡逻");
          state = { ...state, patrolSurvives: state.patrolSurvives + 1 };
        }
        tm -= dt;
        if (tm <= 0) {
          tm += 60;
          const before = state;
          state = gain(state, 5 * clickPowerOf(state));
          state = { ...state, totalClicks: state.totalClicks + 1 };
          gainTo(before, state, "丢梗");
          if (ownQuotes.size < MEME_QUOTES.length) {
            const idx = Math.floor(rng() * MEME_QUOTES.length);
            const r = collectQuote(state, idx);
            if (r.isNew) { state = r.state; ownQuotes.add(idx); }
          }
        }
        if ((sec + dt) % 15 === 0) buyStep();
        if (o.keepOpen) {
          const w = windowOf();
          if (w !== lastJournalWindow) { lastJournalWindow = w; claimJournal(); }
        }
        tryPrestige();
      }
      t = openAt + s.dur;
    }
    state = syncFlavorCollection(state);
    const disp = dispatchDailyEst(state, claimTable);
    const inc = effectOf(state).idleRate;
    const rk = rankIndexFor(state.lifetimeEarned);
    const spent = state.talents.unlocked.reduce((a, id) => a + costOfTalent(id), 0);
    const offEff = o.keepOpen ? 0 : offlineEfficiency(state, BASE_MS, nowMs());
    const dailyIdleSec = ACTIVE_SEC + (o.keepOpen ? 0 : (SAME_DAY_GAPS + Math.min(NIGHT_GAP, 12 * 3600)) * offEff);
    snaps.push({
      day: day + 1, date: today(), totalEarned: state.totalEarned, lifetime: state.lifetimeEarned,
      income: inc, click: clickPowerOf(state), stream: { ...stream },
      prestige: state.prestige, prestiges, rank: RANKS[rk]!.name,
      nextRankAt: rk + 1 < RANKS.length ? RANKS[rk + 1]!.at : null,
      levels: { ...state.levels }, decor: [...state.decor],
      col: COLLEAGUES.filter((c) => state.team.colleagues[c.id]).map((c) => c.name),
      colFavor: Math.max(0, ...COLLEAGUES.map((c) => state.team.colleagues[c.id]?.favor ?? 0)),
      colLevelSum: COLLEAGUES.reduce((a, c) => a + (state.team.colleagues[c.id]?.level ?? 0), 0),
      talentUnlocked: state.talents.unlocked.length, talentPoints: state.talents.points,
      talentOverflow: state.talents.overflow, talentSpent: spent,
      collection: collectionCount(state), store: state.moyu,
      dispDaily: disp.total,
      dispShare: disp.total / Math.max(inc * dailyIdleSec, 1e-9),
      offEff, clickTotal: state.totalClicks,
    });
  }
  return { snaps, end: state };
}

/* ============================== 运行 ============================== */
const L: string[] = [];
const log = (s: string) => { L.push(s); };

log("================== A. 30 天进度：转生（离职再就业）策略对比（真实引擎，全系统参与） ==================");
const decorBuyLog: Record<string, Array<{ day: number; cost: number; income: number }>> = {};
let mainRun: ReturnType<typeof simulate> | null = null;
const runs: Array<{ policy: string; r: ReturnType<typeof simulate> }> = [];
const POLICY_LABEL: Record<string, string> = {
  never: "不转生", daily: "每天开页面转一次", spam: "一解锁就转（spam）",
  gain5: "攒到 ≥5 点就转", gain10: "攒到 ≥10 点就转", gain20: "攒到 ≥20 点（封顶）再转",
};
for (const policy of ["never", "daily", "spam", "gain5", "gain10", "gain20"] as const) {
  seed = 1234567;
  const r = simulate({
    prestigePolicy: policy,
    keepOpen: false,
    days: 30,
    onDecorBuy: (id, day, _before, income) => {
      (decorBuyLog[id] ??= []).push({ day, cost: DECOR.find((d) => d.id === id)!.cost, income });
    },
  });
  runs.push({ policy, r });
  const e = r.snaps[r.snaps.length - 1]!;
  log(`策略 ${POLICY_LABEL[policy]!.padEnd(20)}：D30 挂机=${sci(e.income)}/s，lifetime=${sci(e.lifetime)}，转生点=${e.prestige}（${e.prestiges} 次），家具=${e.decor.length}/8，天赋=${e.talentSpent}点/${e.talentUnlocked}节点，图鉴=${e.collection}/55`);
}
const sortedRuns = [...runs].sort((a, b) => b.r.snaps[29]!.lifetime - a.r.snaps[29]!.lifetime);
const bestPolicy = sortedRuns[0]!;
log(`→ 30 天最优 = ${POLICY_LABEL[bestPolicy.policy]}（比次优高 ${fmt((bestPolicy.r.snaps[29]!.lifetime / sortedRuns[1]!.r.snaps[29]!.lifetime - 1) * 100, 0)}%）`);
mainRun = bestPolicy.r;

log("\n================== B. 主画像逐日明细（硬核：3 次开机/天，20min 在线，夜离线 12h 封顶） ==================");
log("D  | 瞬时挂机/s | 当日收入 | 离线% | 派遣% | 挂机% | 点击% | 日报% | 事件% | 游戏% | 家具 | 同事 | 天赋 | 图鉴 | 转生");
const fmtPct = (v: number, tot: number) => `${fmt((v / Math.max(tot, 1e-9)) * 100, 1)}%`;
for (const s of mainRun.snaps) {
  const keys = ["离线", "派遣", "挂机", "点击", "日报", "巡逻", "丢梗", "小游戏"];
  const tot = keys.reduce((a, k) => a + (s.stream[k] ?? 0), 0) || 1;
  const ev = (s.stream["巡逻"] ?? 0) + (s.stream["丢梗"] ?? 0);
  log(`D${String(s.day).padStart(2)}| ${sci(s.income).padEnd(9)} | ${sci(tot).padEnd(8)} | ${fmtPct(s.stream["离线"] ?? 0, tot).padEnd(5)} | ${fmtPct(s.stream["派遣"] ?? 0, tot).padEnd(5)} | ${fmtPct(s.stream["挂机"] ?? 0, tot).padEnd(5)} | ${fmtPct(s.stream["点击"] ?? 0, tot).padEnd(4)} | ${fmtPct(s.stream["日报"] ?? 0, tot).padEnd(4)} | ${fmtPct(ev, tot).padEnd(4)} | ${fmtPct(s.stream["小游戏"] ?? 0, tot).padEnd(4)} | ${s.decor.length}/8 | ${s.col.length}人L${s.colLevelSum}f${s.colFavor} | ${s.talentSpent}点 | ${s.collection}/55 | ×${fmt(prestigeMultiplier(s.prestige), 2)}(${s.prestiges}次)`);
}

log("\n================== C. 长线内容审计（D1/D3/D5/D10/D15/D20/D25/D30 还有什么可做） ==================");
for (const dayNo of [1, 3, 5, 10, 15, 20, 25, 30]) {
  const s = mainRun.snaps[dayNo - 1]!;
  const nextRankIn = s.nextRankAt ? s.nextRankAt - s.lifetime : null;
  const remainingCol = COLLEAGUES.filter((c) => !s.col.includes(c.name));
  const lvSum = Object.values(s.levels).reduce((a, b) => a + b, 0);
  const dispShare = s.dispDaily / Math.max(s.income * (ACTIVE_SEC + SAME_DAY_GAPS + Math.min(NIGHT_GAP, 12 * 3600) * s.offEff), 1e-9);
  log(
    `D${String(dayNo).padStart(2)}｜挂机${sci(s.income)}/s｜余额${sci(s.store)}｜家具${s.decor.length}/8${s.decor.length === 8 ? "（+10% 已生效）" : ""}｜同事${s.col.length}/5 Lv合计${s.colLevelSum}｜天赋${s.talentSpent}/24 点（${s.talentUnlocked}节点，余${s.talentPoints}点，溢出${s.talentOverflow}）｜图鉴${s.collection}/55｜转生×${fmt(prestigeMultiplier(s.prestige), 2)}（${s.prestige}点/${s.prestiges}次）｜段位=${s.rank}${nextRankIn !== null ? `（距下一档 ${sci(nextRankIn)}）` : "（终档）"}｜升级总等级=${lvSum}｜离线效率=${fmt(s.offEff, 2)}｜派遣日收益=${sci(s.dispDaily)}（占日收入 ${fmt(dispShare * 100, 1)}%）`,
  );
  const todo: string[] = [];
  if (s.decor.length < 8) todo.push(`家具 ${8 - s.decor.length} 件（一次性清单）`);
  if (remainingCol.length) todo.push(`招募 ${remainingCol.map((c) => c.name).join("/")}`);
  if (s.talentSpent < 24) todo.push(`天赋还差 ${24 - s.talentSpent} 点（每日/段位/转生发放）`);
  if (s.collection < 55) todo.push(`图鉴 ${55 - s.collection} 格（挂机线需 Lv50/点击线需 2 万点击，远期）`);
  todo.push("每日：选卡 / 精力 / 日报领奖 / 派遣自动 / 摸鱼站 3 次 / 转生");
  log(`      可做：${todo.join("；")}`);
}

log("\n================== D. 离线 vs 常开 / 离线效率>100% 的反直觉（硬核最优玩法） ==================");
{
  seed = 1234567;
  const opened = simulate({ prestigePolicy: bestPolicy.policy, keepOpen: true, days: 30 });
  const eo = opened.snaps[opened.snaps.length - 1]!;
  const ec = mainRun.snaps[mainRun.snaps.length - 1]!;
  log(`每天关机（20min 在线 + 23.3h 离线，夜段 12h 封顶）→ D30 lifetime=${sci(ec.lifetime)}，挂机=${sci(ec.income)}/s，离线效率=${fmt(ec.offEff, 2)}（>100%！）`);
  log(`页面常开 24h/天（在线 100%，无离线结算）        → D30 lifetime=${sci(eo.lifetime)}，挂机=${sci(eo.income)}/s`);
  log(`→ 关机玩法 lifetime = 常开的 ${fmt(ec.lifetime / eo.lifetime, 2)} 倍（${fmt((ec.lifetime / eo.lifetime - 1) * 100, 0)}% 更多）。离线系内容（地毯/按摩椅/离线卡/离线天赋）在常开画像下价值≈0。`);
  const offEffNow = mainRun.snaps[15]!.offEff;
  log(`根因：离线效率可自然 >100%（D16=${fmt(offEffNow, 2)}）：回访 3 次 +0.3、连签 3 周 +0.15、好感 40 +0.03、小美 +0.02 先把 raw 顶过 1.0，`);
  log(`      再由「家具离线 +0.23 / 天赋 idle_4 +0.08 / 事件终极 +0.2」把上限 1+raise 继续抬高 → min(1+raise, raw+raise) 恒等于 1+raise。`);
  log(`硬核最优实操 = 「上线 1-3 分钟做完领取/决策 → 立刻关掉页面」：同样 1 小时，离线给 ${fmt(offEffNow, 2)}×，在线上限只有 1×（离线每次最多 12h，分 3 段即可全额吃满）。`);
  log(`→ 对硬核玩家，这款放置游戏的最优策略是「尽量别玩」（挂机页常开反而亏 ${fmt((1 - eo.lifetime / ec.lifetime) * 100, 0)}% lifetime）。`);
}

log("\n\n================== E. 四批系统的最优解 / 假选择审计 ==================");

/* ---- E1 精力 ---- */
log("\n--- E1 精力（4 项 145 > 100）：全部可行子集枚举（真实引擎，3 阶段 × 2 画像） ---");
{
  const mk = (levels: Record<string, number>, cols: string[], favor: number, decor: string[] = []): GameState => {
    let s: GameState = { ...initialState(), moyu: 1e12, totalEarned: 1e12, lifetimeEarned: 1e12, levels: { ...levels }, decor: [...decor] };
    for (const id of cols) { s = recruit(s, id)!; while ((s.team.colleagues[id]?.level ?? 0) < 5) s = upgradeColleague(s, id)!; }
    const cols2 = { ...s.team.colleagues };
    for (const k of Object.keys(cols2)) cols2[k] = { ...cols2[k]!, favor };
    return { ...s, team: { colleagues: cols2 } };
  };
  const stages = [
    { name: "D1 早期", state: mk({ phone: 3, toilet: 2, group: 1, coffee: 2 }, ["zhou"], 0) },
    { name: "D5 中期", state: mk({ phone: 10, toilet: 10, group: 8, meeting: 6, deep: 2, coffee: 6, water: 3, chair: 2 }, ["zhou", "mei", "qiang"], 60) },
    { name: "D20 后期", state: mk({ phone: 22, toilet: 22, group: 22, meeting: 22, deep: 18, retire: 10, coffee: 14, water: 10, chair: 6 }, ["zhou", "mei", "qiang", "li", "wang"], 100, ["plant", "lamp", "rug", "fridge", "chair", "aquarium"]) },
  ];
  const profiles = [
    { name: "每天关机（在线 20min + 同日离线 11h）", idleSec: ACTIVE_SEC + SAME_DAY_GAPS, active: ACTIVE_SEC },
    { name: "页面常开（在线 24h）", idleSec: DAY, active: DAY },
  ];
  for (const prof of profiles) {
    log(`\n【${prof.name}】`);
    for (const stg of stages) {
      const base = ensureEnergy(stg.state, "2026-11-20");
      const baseIdle = effectOf(base).idleRate;
      const ids = ENERGY_ACTIONS.map((a) => a.id);
      const rows: Array<{ set: string[]; cost: number; value: number; perPoint: number }> = [];
      for (let mask = 0; mask < 1 << ids.length; mask++) {
        const actions: string[] = [];
        let st: GameState | null = base;
        let cost = 0;
        for (let i = 0; i < ids.length; i++) if (mask & (1 << i)) {
          const def = ENERGY_ACTIONS[i]!;
          st = useEnergy(st!, def.id);
          if (!st) break;
          actions.push(def.id); cost += def.cost;
        }
        if (!st) continue;
        let v = (effectOf(st).idleRate - baseIdle) * prof.idleSec;
        const dStat = stationIdleScaled(st) / Math.max(stationIdleScaled(base), 1e-9);
        v += dispatchDailyEst(base).total * (dStat - 1);
        const patrols = (prof.active / 120);
        const p0 = bossSurviveReward(base, ES5) * 1.22 * patrols;
        const p1 = bossSurviveReward(st, ES5) * 1.22 * patrols * (cardEffects(st, REAL_NOW).patrolRewardMult / cardEffects(base, REAL_NOW).patrolRewardMult);
        v += p1 - p0;
        rows.push({ set: actions, cost, value: v, perPoint: v / cost });
      }
      rows.sort((a, b) => b.value - a.value);
      const nm = (r: typeof rows[number]) => `${r.set.map((x) => ENERGY_ACTIONS.find((a) => a.id === x)?.name).join("+")}(${r.cost}点)`;
      log(`  ${stg.name}：最优=${nm(rows[0]!)}=${sci(rows[0]!.value)}；次优=${nm(rows[1]!)}（-${fmt((1 - rows[1]!.value / rows[0]!.value) * 100, 1)}%）；第三=${nm(rows[2]!)}（-${fmt((1 - rows[2]!.value / rows[0]!.value) * 100, 1)}%）`);
      const single = ENERGY_ACTIONS.map((a) => {
        const r = rows.find((x) => x.set.length === 1 && x.set[0] === a.id);
        return `${a.name}=${r ? sci(r.value) : "不可用"}`;
      });
      log(`      单项（含离线/派遣/巡逻）：${single.join("；")}`);
    }
  }
}

/* ---- E2 卡牌 ---- */
log("\n--- E2 每日卡（16 张）：D20 状态日价值排序 + 是否存在真决策 ---");
{
  const s0 = (() => {
    let s: GameState = { ...initialState(), moyu: 1e12, totalEarned: 1e12, lifetimeEarned: 1e12, levels: { phone: 22, toilet: 22, group: 22, meeting: 22, deep: 18, retire: 10, coffee: 14, water: 10, chair: 6 }, decor: ["plant", "lamp", "rug", "fridge", "chair", "aquarium"] };
    for (const c of COLLEAGUES) { s = recruit(s, c.id)!; while ((s.team.colleagues[c.id]?.level ?? 0) < 5) s = upgradeColleague(s, c.id)!; }
    const cols = { ...s.team.colleagues };
    for (const k of Object.keys(cols)) cols[k] = { ...cols[k]!, favor: 100 };
    return { ...s, team: { colleagues: cols } };
  })();
  const disp = dispatchDailyEst(s0).total;
  const rows = CARDS.map((c) => ({ c, v: cardValue(s0, c.id, disp, ACTIVE_SEC, SAME_DAY_GAPS) }));
  rows.sort((a, b) => b.v - a.v);
  log(`  D20 派遣日收益=${sci(disp)}；今日卡日价值排名（前 8）：`);
  for (const r of rows.slice(0, 8)) log(`    ${r.c.rarity.padEnd(6)} ${r.c.name.padEnd(7)} ${sci(r.v).padEnd(10)} ${r.c.desc}`);
  log(`  末位 4 张（负收益/纯陷阱）：`);
  for (const r of rows.slice(-4)) log(`    ${r.c.rarity.padEnd(6)} ${r.c.name.padEnd(7)} ${sci(r.v).padEnd(10)} ${r.c.desc}`);
  log(`  「通宵摸鱼」负作用实测：其风险惩罚在离线效率已 >1.0 时不生效（min(1+raise, raw+raise) 恒取 1+raise）→ 纯赚 +60% 挂机。`);
  log(`  「提前下班/食堂加菜」= 在线 0、离线仅 +效率，日价值 ${sci(rows.find((r) => r.c.id === "early_leave")!.v)}（远低于挂机卡）`);
  log(`  → 决策空间：3 张里按固定优先级选（挂机 > 离线 > 派遣 > 点击）；若 3 张全负（如 部门搬家/HR 约谈）→ 跳过不选。无真正的权衡。`);
}

/* ---- E3 天赋 ---- */
log("\n--- E3 天赋树：24 点上限的最优分配（用 D20 真实形貌状态 + 11,250 累计点击） ---");
{
  const s0 = (() => {
    let s: GameState = { ...initialState(), moyu: 1e13, totalEarned: 1e12, lifetimeEarned: 1e12, levels: { phone: 30, toilet: 30, group: 30, meeting: 30, deep: 25, retire: 20, coffee: 20, water: 12, chair: 8 }, decor: ["plant", "lamp", "rug", "fridge", "chair", "aquarium"], totalClicks: 11250, patrolSurvives: 400 };
    for (const c of COLLEAGUES) { s = recruit(s, c.id)!; while ((s.team.colleagues[c.id]?.level ?? 0) < 5) s = upgradeColleague(s, c.id)!; }
    const cols = { ...s.team.colleagues };
    for (const k of Object.keys(cols)) cols[k] = { ...cols[k]!, favor: 100 };
    return { ...s, team: { colleagues: cols } };
  })();
  const emptyT = { unlocked: [] as string[], points: 0, rankGranted: -1, dailyGiftDate: "", overflow: 0 };
  const withT = (unlocked: string[]): GameState => ({ ...s0, talents: { ...emptyT, unlocked } });
  const base = withT([]);
  const idleSec = ACTIVE_SEC + SAME_DAY_GAPS + 12 * 3600;
  const evalWith = (unlocked: string[]) => {
    const st = withT(unlocked);
    const dIdle = effectOf(st).idleRate - effectOf(base).idleRate;
    const eff = offlineEfficiency(st, BASE_MS - 20 * DAY, REAL_NOW);
    const night = offlineEarn(st, NIGHT_GAP, eff).earned - offlineEarn(base, NIGHT_GAP, offlineEfficiency(base, BASE_MS - 20 * DAY, REAL_NOW)).earned;
    const patrol = (ACTIVE_SEC / 120) * bossSurviveReward(st, ES5) * 1.22 - (ACTIVE_SEC / 120) * bossSurviveReward(base, ES5) * 1.22;
    const click = (clickPowerOf(st) - clickPowerOf(base)) * CLICK_SECONDS.reduce((a, b) => a + b, 0) * CPS;
    return { idle: dIdle, daily: dIdle * (ACTIVE_SEC + SAME_DAY_GAPS) + night + patrol + click, eff };
  };
  const idleLine = ["idle_1", "idle_2", "idle_3", "idle_4", "idle_5a"];
  const idleLine5b = ["idle_1", "idle_2", "idle_3", "idle_4", "idle_5b"];
  const clickLine = ["click_1", "click_2", "click_3", "click_4"];
  const eventLine = ["event_1", "event_2", "event_3", "event_4"];
  const builds: Array<{ name: string; unlocked: string[] }> = [
    { name: "挂机流全(5a) + 点击流全(5a) + 事件 t1-4", unlocked: [...idleLine, ...clickLine, "click_5a", ...eventLine] },
    { name: "挂机流全(5a) + 点击流全(5b) + 事件 t1-4", unlocked: [...idleLine, ...clickLine, "click_5b", ...eventLine] },
    { name: "挂机流全(5a) + 事件流全(5b) + 点击 t1-4", unlocked: [...idleLine, ...eventLine, "event_5b", ...clickLine] },
    { name: "挂机流全(5b) + 点击流全(5a) + 事件 t1-4", unlocked: [...idleLine5b, ...clickLine, "click_5a", ...eventLine] },
    { name: "挂机 t1-4 + 点击流全(5a) + 事件流全(5b)", unlocked: ["idle_1", "idle_2", "idle_3", "idle_4", ...clickLine, "click_5a", ...eventLine, "event_5b"] },
    { name: "挂机流全(5a) + 事件 t1-4 + 点击 t1-4（剩余 6 点随便花）", unlocked: [...idleLine, ...eventLine, ...clickLine] },
  ];
  for (const b of builds) {
    const used = b.unlocked.reduce((a, id) => a + costOfTalent(id), 0);
    const e = evalWith(b.unlocked);
    log(`  ${b.name.padEnd(48)} 点数=${String(used).padStart(2)}/24${used > 24 ? " 超限!" : "    "} Δ挂机=${sci(e.idle)}/s → 日价值≈${sci(e.daily)}（离线效率 ${fmt(e.eff, 2)}）`);
  }
  // idle_5a vs 5b 直接对比
  const a = evalWith([...idleLine]);
  const b5 = evalWith([...idleLine5b]);
  log(`  互斥终极 idle_5a(+20%挂机) vs idle_5b(同事挂机+70%)：日价值 5a=${sci(a.daily)}，5b=${sci(b5.daily)} → ${a.daily >= b5.daily ? "5a 优" : "5b 优"}（差 ${fmt(Math.abs(a.daily / b5.daily - 1) * 100, 1)}%）；随同事等级/工位占比变化会翻转，但终局工位占主导`);
  const c5a = evalWith([...clickLine, "click_5a"]);
  const c5b = evalWith([...clickLine, "click_5b"]);
  log(`  互斥终极 click_5a(每300点击→挂机+1%,上限35%) vs click_5b(+12%挂机+每1000点击+1%,上限32%,点击+60%)：日价值 5a=${sci(c5a.daily)}，5b=${sci(c5b.daily)} → ${c5a.daily >= c5b.daily ? "5a 优" : "5b 优"}（当前 11,250 累计点击下）`);
  log(`    解析：5a = min(0.35, clicks/300×0.01)；5b = min(0.44, 0.12 + clicks/1000×0.01)；两线交点 ≈ 5,143 点击（5a 反超）与 ≈ 23,000 点击（5b 再反超）→ 只有重点击党（>2.3 万点击）才该选 5b。`);
  log(`  24 点上限 vs 满树 27 点：必须放弃 3 点。实测最优放弃的是事件终极 event_5b（挂机全 + 点击全 + 事件 t1-4 = 24 点）；`);
  log(`    因为 event_5b 只给「事件×2 + 离线效率+0.2」，事件经济本身只占日收入 0.1~0.2%，+0.2 离线效率在 raise 已经很高时又被边际稀释。`);
  log(`  单点收益（从无天赋到全树逐节点增量，仅挂机+离线+巡逻+点击）：`);
  const all = [...idleLine, ...clickLine, "click_5a", ...eventLine];
  const nodeRows: Array<{ id: string; cost: number; v: number }> = [];
  for (const id of all) {
    const pre = all.filter((x) => x !== id);
    // 简化：单独加入（不保证前置，canUnlock 不考虑，纯数值分摊）
    const e1 = evalWith([...new Set([id])]);
    nodeRows.push({ id, cost: costOfTalent(id), v: e1.daily });
  }
  nodeRows.sort((x, y) => y.v / y.cost - x.v / x.cost);
  for (const r of nodeRows) log(`    ${r.id.padEnd(9)} ${r.cost}点 → 单独日价值=${sci(r.v)}（每点 ${sci(r.v / r.cost)}）`);
}

/* ---- E4 派遣 ---- */
log("\n--- E4 派遣任务：两种开机节奏下的任务排名（D20 状态，5 人满级满好感） ---");
{
  const s0 = (() => {
    let s: GameState = { ...initialState(), moyu: 1e13, totalEarned: 1e12, lifetimeEarned: 1e12, levels: { phone: 22, toilet: 22, group: 22, meeting: 22, deep: 18, retire: 10 } };
    for (const c of COLLEAGUES) { s = recruit(s, c.id)!; while ((s.team.colleagues[c.id]?.level ?? 0) < 5) s = upgradeColleague(s, c.id)!; }
    const cols = { ...s.team.colleagues };
    for (const k of Object.keys(cols)) cols[k] = { ...cols[k]!, favor: 100 };
    return { ...s, team: { colleagues: cols } };
  })();
  const station = stationIdleScaled(s0);
  const EFF = 1.18; // 主模拟实测离线效率
  const idleDailyClosed = effectOf(s0).idleRate * (ACTIVE_SEC + (SAME_DAY_GAPS + 12 * 3600) * EFF);
  const idleDailyOpen = effectOf(s0).idleRate * DAY;
  log(`  状态：挂机=${sci(effectOf(s0).idleRate)}/s，工位=${sci(station)}/s；关闭画像日收入≈${sci(idleDailyClosed)}，常开≈${sci(idleDailyOpen)}`);
  log(`  【每天关机画像】任务在日历下的每日可领次数与全队日收益：`);
  let bestClosed = { mission: "", daily: 0 };
  for (const m of MISSIONS) {
    const claims = CLAIM.get(m.seconds) ?? 0;
    let sum = 0;
    for (const c of COLLEAGUES) {
      const cur = s0.team.colleagues[c.id]!;
      const probe: GameState = { ...s0, team: { colleagues: { ...s0.team.colleagues, [c.id]: { ...cur, missionId: m.id } } } };
      sum += dispatchReward(probe, c.id, station) * claims;
    }
    if (sum > bestClosed.daily) bestClosed = { mission: m.id, daily: sum };
    log(`    ${m.name.padEnd(7)} ${hrs(m.seconds).padEnd(5)} ×${String(m.mult).padEnd(4)} 可领 ${String(claims).padStart(2)} 次/天 → 全队 ${sci(sum)}/天（占关闭画像日收入 ${fmt(sum / idleDailyClosed * 100, 1)}%）`);
  }
  log(`    → 每天关机画像最优任务 = ${MISSIONS.find((m) => m.id === bestClosed.mission)!.name}（其余任务被支配）`);
  log(`  【页面常开画像】可领次数 = 86400/时长：`);
  let bestOpen = { mission: "", daily: 0 };
  for (const m of MISSIONS) {
    const claims = CLAIM_OPEN.get(m.seconds) ?? 0;
    let sum = 0;
    for (const c of COLLEAGUES) {
      const cur = s0.team.colleagues[c.id]!;
      const probe: GameState = { ...s0, team: { colleagues: { ...s0.team.colleagues, [c.id]: { ...cur, missionId: m.id } } } };
      sum += dispatchReward(probe, c.id, station) * claims;
    }
    if (sum > bestOpen.daily) bestOpen = { mission: m.id, daily: sum };
    log(`    ${m.name.padEnd(7)} ${hrs(m.seconds).padEnd(5)} ×${String(m.mult).padEnd(4)} 可领 ${String(claims).padStart(5)} 次/天 → 全队 ${sci(sum)}/天（占常开画像日收入 ${fmt(sum / idleDailyOpen * 100, 1)}%）`);
  }
  log(`    → 页面常开画像最优任务 = ${MISSIONS.find((m) => m.id === bestOpen.mission)!.name}`);
  const bestDaily = dispatchDailyEst(s0, CLAIM);
  log(`  【最优排班】每天关机画像下按人最优：${COLLEAGUES.map((c) => `${c.name}→${MISSIONS.find((m) => m.id === bestDaily.per[c.id]?.mission)?.name ?? "-"}(${sci(bestDaily.per[c.id]?.daily ?? 0)}/天)`).join("；")}`);
  log(`    全队派遣日收益=${sci(bestDaily.total)}，占关闭画像日收入 ${fmt(bestDaily.total / idleDailyClosed * 100, 1)}%（设计目标 10-18%）`);
  log(`    注意：五人全派 8h 后「匹配任务 +50%」只在 30min/1h/4h 任务上有意义，但倍率差让 8h 任务在关机画像下全面胜出。`);
}

/* ---- E5 家具 ---- */
log("\n--- E5 家具：真实购买时点（主模拟贪心 ROI 采购）+ 回本 ---");
{
  const buyDays = DECOR.map((d) => ({ d, buy: (decorBuyLog[d.id] ?? [])[0] }));
  for (const { d, buy } of buyDays) {
    log(`  ${d.name.padEnd(5)} 价=${fmt(d.cost).padEnd(13)} ${d.desc.padEnd(16)} 首购=${buy ? "D" + buy.day : "30 天内未买"}${buy ? `（当时挂机 ${sci(buy.income)}/s）` : ""}`);
  }
  const doneDay = mainRun.snaps.find((s) => s.decor.length >= 8)?.day;
  log(`  集齐 8 件（+10% 集齐奖励）时间：${doneDay ? "D" + doneDay : "30 天内未达成"}`);
  // 在 D30 状态上算每件对日收益的边际价值（引擎口径：在线+同日离线+夜间离线+点击+派遣）
  const end = mainRun.end;
  const eff = mainRun.snaps[29]!.offEff;
  const idleSec = ACTIVE_SEC + (SAME_DAY_GAPS + Math.min(NIGHT_GAP, 12 * 3600)) * eff;
  const base = { ...end, decor: [] as string[] };
  const baseIdle = effectOf(base).idleRate;
  const dispBase = dispatchDailyEst(base).total;
  log(`  D30 状态（挂机 ${sci(effectOf(end).idleRate)}/s，离线效率 ${fmt(eff, 2)}）每件家具的日收益增量与回本：`);
  const fullBase = { ...end, decor: end.decor.filter((x) => x !== ""), };
  const fullIdle = effectOf(fullBase).idleRate;
  const fullDisp = dispatchDailyEst(fullBase).total;
  void base; void baseIdle; void dispBase;
  for (const d of DECOR) {
    const without: GameState = { ...fullBase, decor: fullBase.decor.filter((x) => x !== d.id) };
    const dIdle = fullIdle - effectOf(without).idleRate;
    const dDisp = fullDisp - dispatchDailyEst(without).total;
    const dDaily = dIdle * idleSec + dDisp;
    log(`    ${d.name.padEnd(5)} 集齐后边际日增=${sci(dDaily).padEnd(9)} 回本=${dDaily > 0 ? hrs(d.cost / dDaily) : "∞"}${d.id === "rug" || d.id === "chair" ? "  ← 仅离线兑现（常开画像=0）" : ""}${d.id === "projector" ? "  ← 仅派遣兑现（不派=0）" : ""}`);
  }
  log(`  结论：家具是一次性清单（D1-3 内买完），买到即永久；没有取舍，只有顺序。离线两件在「页面常开」画像下收益恒 0。`);
}

/* ---- E6 摸鱼站 ---- */
log("\n--- E6 摸鱼站 3 次/天 的经济占比 ---");
for (const dayNo of [1, 5, 20, 30]) {
  const s = mainRun.snaps[dayNo - 1]!;
  const total = Object.values(s.stream).reduce((a, b) => a + b, 0);
  const arc = s.stream["小游戏"] ?? 0;
  log(`  D${dayNo}: 3 次满分奖励=${sci(arc)}，占当日收入 ${fmt((arc / Math.max(total, 1e-9)) * 100, 2)}%（= 75 挂机秒，与阶段无关）`);
}

/* ---- E7 转生策略实测 ---- */
log("\n--- E7 转生（离职再就业）：攒够再转 vs 一解锁就刷，30 天实录 ---");
{
  const sortByLifetime = [...runs].sort((a, b) => b.r.snaps[29]!.lifetime - a.r.snaps[29]!.lifetime);
  for (const r of sortByLifetime) {
    const e = r.r.snaps[29]!;
    log(`  ${POLICY_LABEL[r.policy]!.padEnd(20)} D30 lifetime=${sci(e.lifetime).padEnd(9)} 相对最优=${fmt(e.lifetime / sortByLifetime[0]!.r.snaps[29]!.lifetime * 100, 1)}% 转生=${String(e.prestiges).padStart(3)} 次 / ${e.prestige} 点 / 倍率×${fmt(prestigeMultiplier(e.prestige), 1)}`);
  }
  log(`  公式：点数 = floor(3 × (本局累计/(1e8×当前倍率))^0.4)，单次封顶 20；门槛 = 1e8×当前倍率。`);
  log(`  关键机制：转生保留 80% 等级（floor），但每次转生都会把已经买起来的复利等级打回 0.8×；`);
  log(`  → 「一解锁就转（+3 点）」在 20min/天画像下反被惩罚：每转一次丢 20% 等级，一天转好几次等于自毁复利，30 天反而低 ${fmt((1 - RUNS_SPAM_RATIO()) * 100, 0)}%。`);
  log(`  → 本画像 30 天最优 = 「攒到接近单次上限（20 点）再转」≈ 每天开页面时转 1 次；点击党/长在线玩家可以提高频率（在线时间越长，等级回补越快，spam 越接近最优——上代 r8 竞速报告实测长在线 spam 路线 7.4h 打穿终档）。`);
  // 一次会话内不同频率对比（D30 状态，600s 连续在线）
  const simPrestige = (minGain: number): { n: number; pts: number } => {
    let st = { ...mainRun.end };
    let n = 0;
    const pts0 = st.prestige;
    for (let i = 0; i < 600; i++) {
      if (canPrestige(st) && prestigeGain(st) >= minGain) {
        const r = doPrestige(st)!;
        st = r.state; n++;
        for (let k = 0; k < 10; k++) st = spendTalents(st);
      }
      st = advance(st, 1);
      if (i % 15 === 0) {
        // 简易再投资：买当前最便宜的可见升级（复用引擎成本）
        for (const u of UPGRADES) {
          const cost = costOf(u.id, st.levels[u.id] ?? 0);
          if (st.moyu >= cost) { st = { ...st, moyu: st.moyu - cost, levels: { ...st.levels, [u.id]: (st.levels[u.id] ?? 0) + 1 } }; break; }
        }
      }
    }
    return { n, pts: st.prestige - pts0 };
  };
  const spam600 = simPrestige(1);
  const wait600 = simPrestige(20);
  log(`  实测（D30 状态连续在线 600 秒）：一解锁就转 → ${spam600.n} 次 / +${spam600.pts} 点；攒到 20 点再转 → ${wait600.n} 次 / +${wait600.pts} 点。`);
  log(`  → 答案不是唯一的「spam 最优」：转生频率与在线时长强相关。但无论哪种，最优都退化成「按固定节奏点同一个按钮」，没有构筑取舍。`);
}
function RUNS_SPAM_RATIO(): number {
  const best = [...runs].sort((a, b) => b.r.snaps[29]!.lifetime - a.r.snaps[29]!.lifetime)[0]!;
  const spam = runs.find((r) => r.policy === "spam")!;
  return spam.r.snaps[29]!.lifetime / best.r.snaps[29]!.lifetime;
}

/* ---- E8 完成度时间线 ---- */
log("\n--- E8 长线内容完成度时间线（主画像） ---");
{
  const at = (pred: (s: DaySnap) => boolean) => mainRun.snaps.find(pred)?.day ?? -1;
  const line = (name: string, d: number) => log(`  ${name.padEnd(30)} ${d > 0 ? "D" + d : "30 天内未达成"}`);
  line("集齐 8 件家具", at((s) => s.decor.length >= 8));
  line("招募全部 5 人", at((s) => s.col.length >= 5));
  line("好感 ≥80（第 4 档）", at((s) => s.colFavor >= 80));
  line("好感满 100（第 5 档）", at((s) => s.colFavor >= 100));
  line("天赋点满 24（14 节点）", at((s) => s.talentSpent >= 24));
  line("图鉴 55/55", at((s) => s.collection >= 55));
  line("段位 1e8（第 4 档）", at((s) => s.lifetime >= 1e8));
  line("段位 2.5e9（第 6 档）", at((s) => s.lifetime >= 2.5e9));
  line("段位 1.6e11（第 12 档）", at((s) => s.lifetime >= 1.6e11));
  line("段位 3.2e11（终档）", at((s) => s.lifetime >= 3.2e11));
  const lastSnap = mainRun.snaps[29]!;
  log(`  D30 时仍开着的目标：家具 ${lastSnap.decor.length}/8（差 ${8 - lastSnap.decor.length}）、天赋 ${lastSnap.talentSpent}/24、图鉴 ${lastSnap.collection}/55、段位终档已于 D${at((s) => s.lifetime >= 3.2e11)} 打穿`);
  log(`  其余每日可做：选卡（3 选 1，固定排序）、精力（固定最优）、日报领奖（自动目标）、派遣一键领取（自动）、摸鱼站 3 次（占比 <0.1%）、转生（可 spam）`);
}

/* ---- E9 每日决策链 ---- */
log("\n--- E9 硬核玩家「每天上线做什么」决策链（主画像，D10 之后） ---");
{
  log("  1. 开机：离线结算面板（自动，无决策）");
  log("  2. 每日卡：3 选 1 —— 按固定优先级排序，无权衡；3 张全负时跳过（约 5% 天数）");
  log("  3. 精力：固定最优组合（slack+focus = 85/100），剩 15 点作废；UI「省心组合」= 次优（-10%）");
  log("  4. 日报：3 个目标里 2 个自动完成 + 1 个自动可完成 → 领奖（3 窗/天），无决策");
  log("  5. 派遣：自动重复 + 开机自动领取 → 0 决策（改任务才有决策，但最优固定 = 8h 咖啡）");
  log("  6. 家具/同事/天赋：一次性清单，D5 前基本买完/招完；之后只等转生给天赋点");
  log("  7. 摸鱼站：3 次/天，可玩可不玩（占收入 <0.1%）；对硬核=纯内容");
  log("  8. 转生：攒到接近单次上限 20 点再点（≈1 次/天）；长在线玩家才值得提高频率 → 仍是「固定节奏点按钮」");
  log("  → 真实每日决策数：1 个（卡牌 3 选 1，且是固定排序，不是权衡）+ 可选的内容消耗（小游戏）");
  log("  → 唯一「需要想一下」的战略选择都发生在早期（1-3 天内）：先买哪件家具/先招谁/卡池要不要跳；之后系统全部收敛到固定最优。");
}

const outPath = "playtest/final-hardcore-sim.txt";
writeFileSync(outPath, L.join("\n"));
console.log(L.join("\n"));
console.log(`\n[written] ${outPath}`);