/**
 * R13 复验探针（HEAD 888ec11）：修复项逐条验证 + 回归边界
 * 运行：npx vite-node playtest/probe-r13-audit2.ts
 */
import { initialState, gain } from "../src/engine/state";
import {
  CARDS,
  dismissCards,
  activeCard,
  cardEffects,
  chooseCard,
  emptyCardState,
  ensureCards,
  rollOffers,
} from "../src/engine/cards";
import { effectOf } from "../src/engine/upgrades";
import { offlineEfficiency } from "../src/engine/progression";
import {
  bossSurviveReward,
  finishPatrol,
  newEventState,
  onBossChoice,
  onBossTap,
  scheduleEvents,
} from "../src/engine/events";
import { resolveBossChoice } from "../src/engine/boss-choice";
import { restore } from "../src/engine/save";

const NOW = Date.now();
const today = new Date(NOW).toLocaleDateString("sv-SE");
const day = (offset: number) => new Date(NOW + offset * 86400000).toLocaleDateString("sv-SE");
const out: Record<string, unknown> = {};

function baseState() {
  return gain(initialState(), 1e9);
}
function cardsState(offers: string[], date = today, extra: Record<string, unknown> = {}) {
  return { ...emptyCardState(date), offers, ...extra };
}
function withCard(cardId: string, nowMs = NOW) {
  const s = { ...baseState(), cards: cardsState([cardId, "coffee_day", "overtime"]) };
  return chooseCard(s, cardId, nowMs)!;
}
function noCard() {
  return { ...baseState(), cards: cardsState(["coffee_day", "overtime", "hr_talk"]) };
}

// ---------- A. P1-1 两个卡效果是否真的生效 ----------
{
  const m: Record<string, unknown> = {};
  const gapOf = (mult: number) => {
    const es = { ...newEventState(), patrolCount: 5 };
    scheduleEvents(es, 0, () => 0.37, mult);
    return es.nextBossAt;
  };
  m.eventRateMult_patrolGap = {
    mult1: gapOf(1),
    mult1_3_quietDay: gapOf(1.3),
    mult2_bigMeeting: gapOf(2),
    ratio1_3: gapOf(1) / gapOf(1.3),
    ratio2: gapOf(1) / gapOf(2),
  };
  const created = NOW - 3 * 86400000;
  m.riskPenalty_offlineEff = {
    noCard: offlineEfficiency(noCard(), created, NOW),
    overtime_risk0_2: offlineEfficiency(withCard("overtime"), created, NOW),
    earlyLeave_offline0_15: offlineEfficiency(withCard("early_leave"), created, NOW),
    idleRateWithOvertime: effectOf(withCard("overtime")).idleRate,
  };
  out.A_fixedEffects = m;
}

// ---------- B. P1-2 跨天 24h：保留 + 新回归（每日卡断档 / 剧情链时序） ----------
{
  const m: Record<string, unknown> = {};
  const T0 = NOW;
  const s = chooseCard(noCard(), "coffee_day", T0)!;
  const d2keep = ensureCards(s, day(1), () => 0.42, T0 + 3600_000);
  m.crossDayKeep = {
    date: d2keep.cards.date,
    chosen: d2keep.cards.chosen,
    sameUntil: d2keep.cards.until === s.cards.until,
    activeOnDay2: activeCard(d2keep, T0 + 3600_000)?.id ?? null,
    idleMultOnDay2: cardEffects(d2keep, T0 + 3600_000).idleMult,
    offersUnchanged: JSON.stringify(d2keep.cards.offers) === JSON.stringify(s.cards.offers),
  };
  // 卡在"第二天"某个时刻过期（T0=23:00 选卡 → 次日 23:00 到期），此时代码是否给新卡池？
  const afterExpireSameDay = ensureCards(d2keep, day(1), () => 0.42, T0 + 24 * 3600_000 + 1000);
  m.expiredMidDay2 = {
    chosen: afterExpireSameDay.cards.chosen,
    active: activeCard(afterExpireSameDay, T0 + 24 * 3600_000 + 1000),
    offers: afterExpireSameDay.cards.offers,
    sameStateRef: afterExpireSameDay === d2keep,
    note: "若 sameStateRef=true 且 active=null：从到期到次日 0 点既无生效卡也无新可选卡",
  };
  const day3 = ensureCards(afterExpireSameDay, day(2), () => 0.42, T0 + 25 * 3600_000);
  m.day3Roll = {
    chosen: day3.cards.chosen,
    offers: day3.cards.offers,
    active: activeCard(day3, T0 + 25 * 3600_000),
  };
  // 剧情链时序：hr_talk day1 → 次日保底 secret_project？
  const hr = chooseCard(noCard(), "hr_talk", T0)!;
  const hrD2 = ensureCards(hr, day(1), () => 0.42, T0 + 3600_000); // 跨天保留
  const hrD2exp = ensureCards(hrD2, day(1), () => 0.42, T0 + 24 * 3600_000 + 1000); // 过期
  const hrD3 = ensureCards(hrD2exp, day(2), () => 0.42, T0 + 25 * 3600_000); // 下一次换池
  m.storyChainTiming = {
    day1Chosen: hr.cards.chosen,
    day1Guarantee: hr.cards.nextDayGuaranteed,
    day2GuaranteeStill: hrD2.cards.nextDayGuaranteed,
    day2ExpiredOffers: hrD2exp.cards.offers,
    day3Offers: hrD3.cards.offers,
    guaranteeDeliveredOnDay3: hrD3.cards.offers.includes("secret_project"),
    nextDaySpecBroken: true,
  };
  out.B_crossDayRegression = m;
}

// ---------- C. P2-1 choice 是否吃巡逻倍率/连胜/天赋 ----------
{
  const s = baseState();
  const mkEs = (extra: Record<string, unknown> = {}) => ({
    ...newEventState(),
    bossVariant: "choice" as const,
    bossPersonality: "hasty" as const,
    bossUntil: 1000,
    bossStartAt: 0,
    patrolCount: 9,
    ...extra,
  });
  out.C_choiceReward = {
    base50_correct: onBossChoice(s, mkEs(), "act-busy", 999)!.delta,
    bigMeeting_cardX2_correct: onBossChoice(withCard("big_meeting"), mkEs(), "act-busy", 999)!.delta,
    streak5_correct: onBossChoice({ ...s, surviveStreak: 5 }, mkEs({ surviveStreak: 5 }), "act-busy", 999)!.delta,
    bigMeeting_streak5_correct: onBossChoice({ ...withCard("big_meeting"), surviveStreak: 5 }, mkEs({ surviveStreak: 5 }), "act-busy", 999)!.delta,
  };
}

// ---------- D. P2-2 窗口校验 / 超时 ----------
{
  const s = baseState();
  const es = () => ({ ...newEventState(), bossVariant: "choice" as const, bossPersonality: "hasty" as const, bossUntil: 1000, bossStartAt: 0, patrolCount: 9 });
  const e1 = es();
  const inWindow = onBossChoice(s, e1, "act-busy", 999);
  const e2 = es();
  const justAfter = onBossChoice(s, e2, "act-busy", 1001);
  const e3 = es();
  const omittedNow = onBossChoice(s, e3, "act-busy");
  const e4 = es();
  const timeout = finishPatrol(s, e4);
  const lateAfterTimeout = onBossChoice(s, e4, "act-busy", 1001);
  out.D_window = {
    inWindow: inWindow ? inWindow.delta : null,
    justAfter0: justAfter,
    omittedNowBypass: omittedNow ? omittedNow.delta : null,
    timeoutReward: timeout.reward,
    bossChoiceDoneAfterTimeout: e4.bossChoiceDone,
    lateAfterTimeout,
  };
}

// ---------- E. P2-3 choice 窗口内点画布 ----------
{
  const s = baseState();
  const es = { ...newEventState(), bossVariant: "choice" as const, bossPersonality: "hasty" as const, bossUntil: 1000, bossStartAt: 0, patrolCount: 9, surviveStreak: 4 };
  const r = onBossTap(s, es, 500);
  out.E_choiceTap = { caught: r.caught, lost: r.lost, income: r.income > 0, streak: es.surviveStreak, bossCaught: es.bossCaught };
}

// ---------- F. 新手宽限 / 5 秒窗口 ----------
{
  out.F_rookie = {
    patrol3_wrong: resolveBossChoice(baseState(), "hasty", "switch-screen", 1000, true).delta,
    patrol4_wrong: resolveBossChoice(baseState(), "hasty", "switch-screen", 1000, false).delta,
    windowSeconds: (await import("../src/engine/boss-choice")).CHOICE_SECONDS,
  };
}

// ---------- G. P2-4 forceBoss 性格是否还随机 ----------
{
  const es = { ...newEventState(), nextBossAt: 0, forcedVariant: "choice" as const, bossPersonality: "suspicious" as const };
  scheduleEvents(es, 100, () => 0.1); // dev hook 预置 suspicious，rng 0.1 会抽到 hasty
  out.G_forcedPersonality = { expected: "suspicious", actual: es.bossPersonality, variant: es.bossVariant };
}

// ---------- H. P2-5 dismissed / 存档净化 ----------
{
  const mem = (cards: unknown) => {
    let raw = JSON.stringify({ v: 2, moyu: 100, levels: {}, savedAt: NOW, cards });
    const adapter = {
      getItem: () => raw,
      setItem: (_k: string, v: string) => { raw = v; },
      removeItem: () => { raw = null as unknown as string; },
    };
    return restore(adapter as never, NOW).state!;
  };
  const m: Record<string, unknown> = {};
  const s = noCard();
  const dismissed = dismissCards(s);
  m.dismissed = {
    flag: dismissed.cards.dismissed,
    sameDayNoReroll: ensureCards(dismissed, today, () => 0.4, NOW) === dismissed,
    nextDayRoll: ensureCards(dismissed, day(1), () => 0.4, NOW + 86400000).cards.dismissed,
  };
  const r = mem({ date: today, offers: ["coffee_day", "coffee_day", "bogus", "overtime"], chosen: "overtime", until: NOW + 1e15 });
  m.sanitize = {
    dateBad: mem({ date: "2026-13-99", offers: ["coffee_day", "overtime", "hr_talk"] }).cards.date,
    offersDedup: r.cards.offers,
    expiredChosenCleared: (() => {
      const st = mem({ date: today, offers: ["coffee_day", "overtime", "hr_talk"], chosen: "coffee_day", until: NOW - 5 });
      return { chosen: st.cards.chosen, until: st.cards.until, canChooseAgain: !!chooseCard(st, "overtime", NOW) };
    })(),
    guaranteeHrTalk: mem({ date: today, offers: ["coffee_day", "overtime", "hr_talk"], nextDayGuaranteed: "hr_talk" }).cards.nextDayGuaranteed,
    guaranteeUnknown: mem({ date: today, offers: ["coffee_day", "overtime", "hr_talk"], nextDayGuaranteed: "promotion" }).cards.nextDayGuaranteed,
    dismissedPersist: mem({ date: today, offers: ["coffee_day", "overtime", "hr_talk"], dismissed: true }).cards.dismissed,
  };
  const ghost = rollOffers(today, () => 0.5, "hr_talk");
  m.ghostFixed = { offers: ghost.offers, next: ghost.nextDayGuaranteed, exists: CARDS.some((c) => c.id === ghost.nextDayGuaranteed) };
  out.H_dismissAndSanitize = m;
}

console.log(JSON.stringify(out, null, 1));

// ---------- I. 回归：过期后刷新 → 旧卡池是否被重放 ----------
{
  const stale = {
    ...baseState(),
    cards: { date: day(1), offers: ["coffee_day", "overtime", "hr_talk"], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: false },
  };
  const after = ensureCards(stale, day(1), () => 0.42, NOW + 86400000);
  const picked = chooseCard(after, "coffee_day", NOW + 86400000);
  out.I_staleOffersReplay = {
    offersUnchanged: after.cards.offers,
    sameStateRef: after === stale,
    canChooseFromStalePool: picked ? picked.cards.chosen : null,
    note: "跨天保留卡过期后（或刷新净化 chosen 后）date 已是今天 → 不重抽，旧池原样重放",
  };
}
console.log(JSON.stringify({ I_staleOffersReplay: out.I_staleOffersReplay }, null, 1));
