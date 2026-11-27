/**
 * R13 复验（HEAD 0e58b20）：跨天新卡池/buff 保留/每日再选/剧情链/卡池分布/赔率/窗口/forceBoss 性格
 * 运行：npx vite-node playtest/probe-r13-audit3.ts
 */
import { initialState, gain } from "../src/engine/state";
import {
  CARDS,
  activeCard,
  cardEffects,
  chooseCard,
  dismissCards,
  emptyCardState,
  ensureCards,
  rollOffers,
} from "../src/engine/cards";
import { newEventState, onBossChoice, scheduleEvents, finishPatrol } from "../src/engine/events";
import { CHOICE_CORRECT_MULT, CHOICE_WRONG_PENALTY_RATIO, CHOICE_SECONDS, resolveBossChoice } from "../src/engine/boss-choice";
import { restore } from "../src/engine/save";

const DAY1 = "2026-11-27";
const DAY2 = "2026-11-28";
const DAY3 = "2026-11-29";
const T1 = Date.UTC(2026, 10, 27, 14, 0); // 本地 11-27 22:00
const T2 = Date.UTC(2026, 10, 28, 9, 0); // 本地 11-28 17:00
const T2_LATE = T1 + 24 * 3600 * 1000 + 1000; // 旧卡过期后（仍是本地 11-28）
const rng = () => 0.42;
const out: Record<string, unknown> = {};

// ---------- A. 卡池规格（16 张：8/6/2）+ 抽取分布 + 去重 ----------
{
  const byR: Record<string, number> = {};
  for (const c of CARDS) byR[c.rarity] = (byR[c.rarity] ?? 0) + 1;
  const N = 20000;
  const picks: Record<string, number> = { common: 0, rare: 0, event: 0 };
  let dup = 0;
  for (let i = 0; i < N; i++) {
    const cs = rollOffers(DAY1, Math.random);
    if (cs.offers.length !== 3) dup++;
    if (new Set(cs.offers).size !== 3) dup++;
    for (const id of cs.offers) picks[CARDS.find((c) => c.id === id)!.rarity]! += 1;
  }
  out.A_pool = {
    total: CARDS.length,
    byRarity: byR,
    perPickShare: {
      common: +(picks.common! / (N * 3)).toFixed(4),
      rare: +(picks.rare! / (N * 3)).toFixed(4),
      event: +(picks.event! / (N * 3)).toFixed(4),
    },
    dupRolls: dup,
  };
}

// ---------- B. P1-A 跨天：新池 + 旧 buff + 次日再选 + 剧情链 ----------
{
  const m: Record<string, unknown> = {};
  let s = ensureCards({ ...initialState(), cards: emptyCardState() }, DAY1, rng, T1);
  const oldOffers = [...s.cards.offers];
  s = chooseCard(s, s.cards.offers[0]!, T1)!;
  const oldChosen = s.cards.chosen;
  const oldUntil = s.cards.until;
  const d2 = ensureCards(s, DAY2, rng, T2);
  m.crossDay = {
    date: d2.cards.date,
    offersCount: d2.cards.offers.length,
    uniqueOffers: new Set(d2.cards.offers).size,
    offersChangedFromDay1: JSON.stringify([...d2.cards.offers].sort()) !== JSON.stringify([...oldOffers].sort()),
    chosenKept: d2.cards.chosen === oldChosen,
    untilKept: d2.cards.until === oldUntil,
    chosenDateKept: d2.cards.chosenDate,
    activeOldBuff: activeCard(d2, T2)?.id === oldChosen,
    idleMultStill: cardEffects(d2, T2).idleMult,
    dismissedReset: d2.cards.dismissed === false,
    // UI 侧门槛（card-panel.ts:30 的 maybeShow 条件）：chosen 非空 → 不弹
    uiWouldShowCardModal: !(d2.cards.chosen && true) && !d2.cards.dismissed && d2.cards.offers.length > 0,
  };
  const pickedToday = chooseCard(d2, d2.cards.offers[0]!, T2);
  m.pickAgainSameDay = {
    engineAllows: pickedToday !== null,
    newChosen: pickedToday?.cards.chosen ?? null,
    chosenDate: pickedToday?.cards.chosenDate ?? null,
  };
  m.sameDaySecondPick = chooseCard(pickedToday!, pickedToday!.cards.offers[1]!, T2);
  // 旧卡过期后（同日）：ensureCards 不换池也不清 chosen → UI 仍被 chosen 挡住
  const lateSameDay = ensureCards(d2, DAY2, rng, T2_LATE);
  m.expiredMidDay2 = {
    chosenStale: lateSameDay.cards.chosen,
    active: activeCard(lateSameDay, T2_LATE),
    uiWouldShowCardModal: !lateSameDay.cards.chosen && !lateSameDay.cards.dismissed,
    sameDayRef: lateSameDay === d2,
  };
  // 剧情链：hr_talk → 次日卡池含 secret_project
  let c = ensureCards({ ...initialState(), cards: emptyCardState() }, DAY1, rng, T1);
  c = { ...c, cards: { ...c.cards, offers: ["hr_talk", c.cards.offers[0]!, c.cards.offers[1]!] } };
  c = chooseCard(c, "hr_talk", T1)!;
  const c2 = ensureCards(c, DAY2, rng, T2);
  m.storyChain = {
    guarantee: c.cards.nextDayGuaranteed,
    day2Offers: c2.cards.offers,
    landsNextDay: c2.cards.offers.includes("secret_project"),
    oldHrBuffKept: c2.cards.chosen === "hr_talk",
  };
  out.B_crossDay = m;
}

// ---------- C. 赔率 / 窗口 / 超时 ----------
{
  const base = 1000;
  const s = gain(initialState(), 1e6);
  const es = () => ({ ...newEventState(), bossVariant: "choice" as const, bossPersonality: "hasty" as const, bossUntil: 1000, bossStartAt: 0, patrolCount: 9 });
  const ev = (1 / 3) * CHOICE_CORRECT_MULT - (2 / 3) * CHOICE_WRONG_PENALTY_RATIO;
  out.C_odds = {
    correctMult: CHOICE_CORRECT_MULT,
    wrongRatio: CHOICE_WRONG_PENALTY_RATIO,
    windowSeconds: CHOICE_SECONDS,
    correctDelta: resolveBossChoice(s, "hasty", "act-busy", base).delta,
    wrongDelta: resolveBossChoice(s, "hasty", "switch-screen", base).delta,
    blindGuessEV: +ev.toFixed(4),
    rookieWrongDelta: resolveBossChoice(s, "hasty", "switch-screen", base, true).delta,
    inWindow: onBossChoice(s, es(), "act-busy", 999)?.delta ?? null,
    justAfterWindow: onBossChoice(s, es(), "act-busy", 1001),
    lateAfterTimeout: (() => { const e = es(); finishPatrol(s, e); return onBossChoice(s, e, "act-busy", 1200); })(),
  };
}

// ---------- D. forceBoss 性格是否稳定（dev hook 先置 suspicious） ----------
{
  const runs: string[] = [];
  for (const seed of [0.1, 0.5, 0.9, 0.2, 0.7]) {
    const e = { ...newEventState(), nextBossAt: 0, forcedVariant: "choice" as const, bossPersonality: "suspicious" as const };
    scheduleEvents(e, 100, () => seed);
    runs.push(e.bossPersonality);
  }
  out.D_forcedPersonality = { expected: "suspicious", runs, allStable: runs.every((x) => x === "suspicious") };
}

// ---------- E. 存档：chosenDate 净化 / 旧档兼容 ----------
{
  const mem = (cards: Record<string, unknown>) => {
    let raw = JSON.stringify({ v: 2, moyu: 100, levels: {}, savedAt: T2, cards });
    const adapter = { getItem: () => raw, setItem: (_k: string, v: string) => { raw = v; }, removeItem: () => { raw = null as unknown as string; } };
    return restore(adapter as never, T2).state!;
  };
  out.E_sanitize = {
    chosenDateKept: mem({ date: DAY2, offers: ["coffee_day", "overtime", "hr_talk"], chosen: "coffee_day", until: T2 + 3600000, chosenDate: DAY1 }).cards.chosenDate,
    chosenDateFallback: mem({ date: DAY2, offers: ["coffee_day", "overtime", "hr_talk"], chosen: "coffee_day", until: T2 + 3600000 }).cards.chosenDate,
    badChosenDate: mem({ date: DAY2, offers: ["coffee_day", "overtime", "hr_talk"], chosen: "coffee_day", until: T2 + 3600000, chosenDate: "xx" }).cards.chosenDate,
    // 旧档：chosen 但无 chosenDate → 回填 date，当天不能再选
    oldSaveRechooseToday: (() => {
      const st = mem({ date: DAY2, offers: ["coffee_day", "overtime", "hr_talk"], chosen: "coffee_day", until: T2 + 3600000 });
      return chooseCard(st, "overtime", T2);
    })(),
  };
}

// ---------- F. skip 逻辑（dismiss）与每日重置 ----------
{
  let s = ensureCards({ ...initialState(), cards: emptyCardState() }, DAY1, rng, T1);
  s = dismissCards(s);
  const same = ensureCards(s, DAY1, rng, T1 + 1000);
  const d2 = ensureCards(s, DAY2, rng, T2);
  out.F_dismiss = { sameDayNoReroll: same === s, dismissedSame: same.cards.dismissed, nextDayReset: d2.cards.dismissed === false, nextDayOffers: d2.cards.offers.length };
}

console.log(JSON.stringify(out, null, 1));
