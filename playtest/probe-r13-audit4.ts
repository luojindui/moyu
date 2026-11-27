/**
 * R13 最终审计（HEAD fa9ad17）：shouldPromptCards 门槛 / 同日过期清理 / 跨天再选 / forceBoss 性格 / 存档
 * 运行：npx vite-node playtest/probe-r13-audit4.ts
 */
import { initialState } from "../src/engine/state";
import {
  activeCard,
  chooseCard,
  dismissCards,
  emptyCardState,
  ensureCards,
  shouldPromptCards,
} from "../src/engine/cards";
import { newEventState, scheduleEvents } from "../src/engine/events";
import { restore } from "../src/engine/save";

const DAY1 = "2026-11-27";
const DAY2 = "2026-11-28";
const T1 = Date.UTC(2026, 10, 27, 14, 0); // 本地 11-27 22:00
const T2 = Date.UTC(2026, 10, 28, 9, 0); // 本地 11-28 17:00
const rng = () => 0.37;
const out: Record<string, unknown> = {};

// ---------- A. shouldPromptCards 门槛矩阵 ----------
{
  let s = { ...initialState(), cards: emptyCardState() };
  s = ensureCards(s, DAY1, rng, T1);
  const picked = chooseCard(s, s.cards.offers[0]!, T1)!;
  const day2 = ensureCards(picked, DAY2, rng, T2);
  const dismissed = dismissCards(day2);
  const matrix = {
    undefinedCards: shouldPromptCards(undefined, DAY2),
    emptyOffers: shouldPromptCards({ ...emptyCardState(DAY2) }, DAY2),
    dismissedToday: shouldPromptCards({ ...day2.cards, dismissed: true }, DAY2),
    alreadyChosenToday: shouldPromptCards({ ...day2.cards, chosenDate: DAY2 }, DAY2),
    yesterdayChosenBuffActive: shouldPromptCards(day2.cards, DAY2),
    chosenActiveDay2: activeCard(day2, T2)?.id ?? null,
    chosenDateDay2: day2.cards.chosenDate,
  };
  // 次日再选
  const repick = chooseCard(day2, day2.cards.offers[0]!, T2);
  const afterRepick = {
    allowed: repick !== null,
    newChosen: repick?.cards.chosen,
    newChosenDate: repick?.cards.chosenDate,
    promptAfterPick: repick ? shouldPromptCards(repick.cards, DAY2) : null,
    secondPickSameDay: repick ? chooseCard(repick, repick.cards.offers[1]!, T2) : null,
  };
  out.A_promptMatrix = { matrix, afterRepick, dismissedFlagIgnored: shouldPromptCards(dismissed.cards, DAY2) };
}

// ---------- B. 同日过期清理 + 解锁提示 ----------
{
  let s = { ...initialState(), cards: emptyCardState() };
  s = ensureCards(s, DAY1, rng, T1);
  s = chooseCard(s, s.cards.offers[0]!, T1)!;
  const later = T1 + 25 * 3600_000; // 同日字符串不变，但已过 24h
  const cleaned = ensureCards(s, DAY1, rng, later);
  const cleanedAgain = ensureCards(cleaned, DAY1, rng, later + 1000);
  out.B_sameDayExpiry = {
    chosen: cleaned.cards.chosen,
    until: cleaned.cards.until,
    chosenDate: cleaned.cards.chosenDate,
    active: activeCard(cleaned, later),
    promptUnlocked: shouldPromptCards(cleaned.cards, DAY1),
    idempotentNextTick: cleanedAgain === cleaned,
  };
}

// ---------- C. 跨天：新池 + 旧 buff + 可提示 + 剧情链 ----------
{
  let s = { ...initialState(), cards: emptyCardState() };
  s = ensureCards(s, DAY1, rng, T1);
  s = chooseCard(s, s.cards.offers[0]!, T1)!;
  const d2 = ensureCards(s, DAY2, rng, T2);
  let c = { ...initialState(), cards: emptyCardState() };
  c = ensureCards(c, DAY1, rng, T1);
  c = { ...c, cards: { ...c.cards, offers: ["hr_talk", c.cards.offers[0]!, c.cards.offers[1]!] } };
  c = chooseCard(c, "hr_talk", T1)!;
  const c2 = ensureCards(c, DAY2, rng, T2);
  out.C_crossDay = {
    date: d2.cards.date,
    offersCount: d2.cards.offers.length,
    buffKept: d2.cards.chosen === s.cards.chosen && d2.cards.until === s.cards.until,
    prompt: shouldPromptCards(d2.cards, DAY2),
    dismissedReset: d2.cards.dismissed === false,
    chainNextDay: c2.cards.offers.includes("secret_project"),
    chainBuffKept: c2.cards.chosen === "hr_talk",
  };
}

// ---------- D. forceBoss 性格稳定（预置 suspicious 应保留） ----------
{
  const forcedChoice = (seed: number) => {
    const e = { ...newEventState(), nextBossAt: 0, forcedVariant: "choice" as const, bossPersonality: "suspicious" as const };
    scheduleEvents(e, 100, () => seed);
    return e.bossPersonality;
  };
  const choiceRuns = [0.05, 0.3, 0.5, 0.7, 0.95].map(forcedChoice);
  const forcedHold = (seed: number) => {
    const e = { ...newEventState(), nextBossAt: 0, forcedVariant: "hold" as const, bossPersonality: "suspicious" as const };
    scheduleEvents(e, 100, () => seed);
    return e.bossPersonality;
  };
  const unforced = (seed: number) => {
    const e = { ...newEventState(), nextBossAt: 0, bossPersonality: "suspicious" as const };
    scheduleEvents(e, 100, () => seed);
    return { personality: e.bossPersonality, variant: e.bossVariant };
  };
  out.D_forceBoss = {
    forcedChoiceStable: choiceRuns,
    allSuspicious: choiceRuns.every((x) => x === "suspicious"),
    forcedHoldStillRandom: [0.1, 0.5, 0.9].map(forcedHold),
    unforcedStillRandom: [0.1, 0.5, 0.9].map(unforced),
  };
}

// ---------- E. 存档：chosenDate 回填 + 提示门槛 ----------
{
  const mem = (cards: Record<string, unknown>) => {
    let raw = JSON.stringify({ v: 2, moyu: 100, levels: {}, savedAt: T2, cards });
    const adapter = { getItem: () => raw, setItem: (_k: string, v: string) => { raw = v; }, removeItem: () => { raw = null as unknown as string; } };
    return restore(adapter as never, T2).state!;
  };
  const s = mem({ date: DAY2, offers: ["coffee_day", "overtime", "hr_talk"], chosen: "coffee_day", until: T2 + 3600000, chosenDate: DAY1 });
  const sNoDate = mem({ date: DAY2, offers: ["coffee_day", "overtime", "hr_talk"], chosen: "coffee_day", until: T2 + 3600000 });
  out.E_sanitize = {
    yesterdayBuffChosenDate: s.cards.chosenDate,
    promptForYesterdayBuff: shouldPromptCards(s.cards, DAY2),
    noChosenDateFallback: sNoDate.cards.chosenDate,
    promptForNoChosenDate: shouldPromptCards(sNoDate.cards, DAY2),
  };
}

console.log(JSON.stringify(out, null, 1));
