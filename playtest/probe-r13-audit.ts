/**
 * R13 审计探针（只读 src/，不改 src/）：每日卡 + 回合制老板
 * 运行：npx vite-node playtest/probe-r13-audit.ts
 */
import { initialState, gain } from "../src/engine/state";
import {
  CARDS,
  CARD_DURATION,
  activeCard,
  cardEffects,
  chooseCard,
  emptyCardState,
  ensureCards,
  rollOffers,
} from "../src/engine/cards";
import { effectOf } from "../src/engine/upgrades";
import { clickPowerOf } from "../src/engine/actions";
import { offlineEfficiency } from "../src/engine/progression";
import {
  bossSurviveReward,
  finishPatrol,
  newEventState,
  onBossChoice,
  pickBossVariant,
  scheduleEvents,
} from "../src/engine/events";
import { PERSONALITIES, CHOICES, resolveBossChoice } from "../src/engine/boss-choice";
import { dispatch, dispatchReward, recruit } from "../src/engine/team";
import { restore, serialize } from "../src/engine/save";

const NOW = Date.now();
const today = new Date(NOW).toLocaleDateString("sv-SE");
const out: Record<string, unknown> = {};
const rng = Math.random;

function baseState() {
  return gain(initialState(), 1e9);
}
function cardsState(offers: string[], date = today) {
  return { ...emptyCardState(date), offers };
}
function withCard(cardId: string) {
  const s = { ...baseState(), cards: cardsState([cardId, "coffee_day", "overtime"]) };
  return chooseCard(s, cardId, NOW)!;
}
function noCard() {
  return { ...baseState(), cards: cardsState(["coffee_day", "overtime", "hr_talk"]) };
}

// ---------- A. 卡效果接线（idle/click/offline/patrol/dispatch/eventRate/risk） ----------
{
  const m: Record<string, unknown> = {};
  const none = noCard();
  m.idle_coffee_day = {
    noCard: effectOf(none).idleRate,
    card: effectOf(withCard("coffee_day")).idleRate,
  };
  m.click_frenzy = {
    noCard: clickPowerOf(none),
    card: clickPowerOf(withCard("click_frenzy")),
  };
  const created = NOW - 2 * 86400 * 1000;
  m.offline_early_leave = {
    noCard: offlineEfficiency(none, created, NOW),
    card: offlineEfficiency(withCard("early_leave"), created, NOW),
  };
  const es0 = { ...newEventState(), surviveStreak: 0 };
  m.patrol_big_meeting = {
    noCard: bossSurviveReward(none, es0),
    card: bossSurviveReward(withCard("big_meeting"), es0),
  };
  // dispatch：招募老周 + 派茶水间聊八卦（type chat 匹配）
  const build = (cardId: string | null) => {
    let s = recruit(baseState(), "zhou")!;
    s = dispatch(s, "zhou", "chat", NOW, effectOf(s).idleRate)!;
    if (cardId) {
      const cs = cardsState([cardId, "coffee_day", "overtime"]);
      s = chooseCard({ ...s, cards: cs }, cardId, NOW)!;
    }
    return s;
  };
  const dNone = build(null);
  const dTeam = build("team_bond"); // dispatchRewardMult 1.4
  const dZhou = build("old_zhou_secret"); // dispatchRewardMult 1.8
  const idleRateD = effectOf(dNone).idleRate;
  m.dispatch_team_bond = {
    noCard: dispatchReward(dNone, "zhou", idleRateD),
    card: dispatchReward(dTeam, "zhou", idleRateD),
  };
  m.dispatch_old_zhou = {
    noCard: dispatchReward(dNone, "zhou", idleRateD),
    card: dispatchReward(dZhou, "zhou", idleRateD),
  };
  // eventRateMult：scheduleEvents 是否读取 quiet_day 的 eventRateMult
  const sched = (cardId: string | null) => {
    const es = newEventState();
    const s = cardId ? withCard(cardId) : noCard();
    let seed = 0.37;
    const fakeRng = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    scheduleEvents(es, 0, fakeRng);
    return { nextBossAt: es.nextBossAt, variant: es.bossVariant, st: s.cards.chosen };
  };
  m.eventRate_quiet_day = { noCard: sched(null), card: sched("quiet_day") };
  // riskPenalty：所有消费者（静态见报告）；此处仅确认 cardEffects 返回值
  m.riskPenalty_cardEffects = cardEffects(withCard("overtime"), NOW);
  out.A_cardWiring = m;
}

// ---------- A2. 卡选择/每日刷新边界 ----------
{
  const m: Record<string, unknown> = {};
  const s = noCard();
  const picked = chooseCard(s, "coffee_day", NOW)!;
  m.pick_once = {
    first: !!picked,
    second: chooseCard(picked, "overtime", NOW),
    notOffered: chooseCard(s, "secret_project", NOW),
    unknownId: chooseCard(s, "no_such_card", NOW),
  };
  // 跨日：chosen 还在 24h 有效期内，但 ensureCards 换日直接清空
  const tomorrow = new Date(NOW + 86400000).toLocaleDateString("sv-SE");
  const nextDay = ensureCards(picked, tomorrow, () => 0.42);
  m.crossDay = {
    untilStillFuture: picked.cards.until > NOW + 60000,
    activeBeforeRoll: activeCard(picked, NOW + 1000)?.id ?? null,
    afterRollChosen: nextDay.cards.chosen,
    afterRollActive: activeCard(nextDay, NOW + 1000)?.id ?? null,
    idleMultAfterRoll: cardEffects(nextDay, NOW + 1000).idleMult,
  };
  // 同一天幂等
  m.sameDayIdempotent = ensureCards(picked, today, rng) === picked;
  // 剧情链：hr_talk → secret_project
  const hr = chooseCard(s, "hr_talk", NOW)!;
  const chainDay = ensureCards(hr, tomorrow, () => 0.65);
  m.storyChain = {
    nextDayGuaranteed: hr.cards.nextDayGuaranteed,
    nextOffers: chainDay.cards.offers,
    hasSecretProject: chainDay.cards.offers.includes("secret_project"),
    afterChainGuarantee: chainDay.cards.nextDayGuaranteed,
  };
  // rollOffers 的 guaranteed 传 "hr_talk" 时会写入不存在的 "promotion"
  const ghost = rollOffers(today, () => 0.5, "hr_talk");
  m.ghostGuarantee = {
    offers: ghost.offers,
    nextDayGuaranteed: ghost.nextDayGuaranteed,
    idExists: CARDS.some((c) => c.id === ghost.nextDayGuaranteed),
  };
  // 未知保底 id 静默忽略
  const bad = rollOffers(today, () => 0.5, "promotion");
  m.invalidGuaranteeIgnored = { offers: bad.offers, next: bad.nextDayGuaranteed };
  // 抽卡分布与不重复（2 万次）
  const counts: Record<string, number> = {};
  let dup = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const cs = rollOffers(today, rng);
    if (new Set(cs.offers).size !== 3) dup++;
    if (cs.offers.length !== 3) throw new Error("offers length " + cs.offers.length);
    for (const id of cs.offers) {
      const d = CARDS.find((c) => c.id === id)!;
      counts[d.rarity] = (counts[d.rarity] ?? 0) + 1;
    }
  }
  m.distribution = {
    totalPicks: N * 3,
    byRarity: counts,
    dupRolls: dup,
    commonShare: (counts.common ?? 0) / (N * 3),
    rareShare: (counts.rare ?? 0) / (N * 3),
    eventShare: (counts.event ?? 0) / (N * 3),
  };
  out.A2_cardEdges = m;
}

// ---------- B. save.ts cards 净化 ----------
{
  const mem = (blob: unknown) => {
    let raw = JSON.stringify(blob);
    const adapter = {
      getItem: () => raw,
      setItem: (_k: string, v: string) => {
        raw = v;
      },
      removeItem: () => {
        raw = null as unknown as string;
      },
    };
    return restore(adapter as never, NOW);
  };
  const mk = (cards: unknown) => ({
    v: 2,
    moyu: 100,
    levels: {},
    savedAt: NOW,
    cards,
  });
  const m: Record<string, unknown> = {};
  const r1 = mem(mk({ date: today, offers: ["coffee_day", "bogus", "overtime"], chosen: "overtime", until: NOW + 1e15 }));
  m.knownIds_and_chosenInOffers = {
    offers: r1.state?.cards.offers,
    chosen: r1.state?.cards.chosen,
    until: r1.state?.cards.until,
    untilClamped: r1.state?.cards.until === NOW + 2 * 86400000,
  };
  const r2 = mem(mk({ date: today, offers: ["coffee_day", "coffee_day", "coffee_day"], chosen: "coffee_day", until: NOW + 1000 }));
  m.duplicateOffersKept = { offers: r2.state?.cards.offers, chosen: r2.state?.cards.chosen };
  const r3 = mem(mk({ date: today, offers: ["coffee_day"], chosen: "overtime", until: NOW + 1000 }));
  m.chosenNotInOffers = { chosen: r3.state?.cards.chosen, offers: r3.state?.cards.offers };
  const r4 = mem(mk({ date: today, offers: ["coffee_day", "overtime", "hr_talk"], chosen: "coffee_day", until: -5 }));
  m.negativeUntil = { chosen: r4.state?.cards.chosen, until: r4.state?.cards.until, active: activeCard(r4.state!, NOW) };
  const r5 = mem(mk({ date: today, offers: ["coffee_day", "overtime", "hr_talk"], chosen: "coffee_day", until: 0 }));
  m.chosenWithUntilZero = {
    chosen: r5.state?.cards.chosen,
    until: r5.state?.cards.until,
    canChooseAgainSameDay: chooseCard(r5.state!, "overtime", NOW),
    active: activeCard(r5.state!, NOW),
  };
  const r6 = mem(mk({ date: today, offers: ["coffee_day", "overtime", "hr_talk"], chosen: null, until: NOW + 1000, nextDayGuaranteed: "hr_talk" }));
  m.anyKnownCardAcceptedAsGuarantee = r6.state?.cards.nextDayGuaranteed;
  const r7 = mem(mk({ date: "2026-13-99", offers: ["coffee_day", "overtime", "hr_talk"], chosen: null, until: 0 }));
  m.badDateFormatAccepted = r7.state?.cards.date;
  const r8 = mem(mk({ date: today, offers: ["coffee_day", "overtime", "hr_talk", "click_frenzy"], chosen: "click_frenzy", until: NOW + 1000 }));
  m.offersOver3Sliced = { offers: r8.state?.cards.offers, chosen: r8.state?.cards.chosen };
  // 存档往返：同日 chosen/until/offers 保留
  const s = chooseCard(noCard(), "overtime", NOW)!;
  let raw = "";
  const adapter = {
    getItem: () => raw || null,
    setItem: (_k: string, v: string) => {
      raw = v;
    },
    removeItem: () => {
      raw = null as unknown as string;
    },
  };
  serialize(s, adapter as never, NOW);
  const round = restore(adapter as never, NOW + 1000);
  m.roundTrip = {
    savedChosen: round.state?.cards.chosen,
    active: activeCard(round.state!, NOW + 1000)?.id ?? null,
    sameUntil: round.state?.cards.until === s.cards.until,
  };
  out.B_saveSanitize = m;
}

// ---------- C. 回合制老板 ----------
{
  const m: Record<string, unknown> = {};
  m.mapping = PERSONALITIES.map((p) => ({
    id: p.id,
    correct: p.correct,
    unique: CHOICES.filter((c) => p.correct === c.id).length === 1,
  }));
  const s = baseState();
  m.resolveFormulas = {
    base1000_correct: resolveBossChoice(s, "hasty", "act-busy", 1000).delta,
    base1000_wrong: resolveBossChoice(s, "hasty", "switch-screen", 1000).delta,
    base57_correct: resolveBossChoice(s, "hasty", "act-busy", 57).delta,
    base57_wrong: resolveBossChoice(s, "hasty", "switch-screen", 57).delta,
    floorCheck: { correct: Math.floor(57 * 2.2), wrong: Math.floor(57 * 0.6) },
  };
  // 余额不足时罚款打折（规格写"罚基础×0.6"）
  const poor = { ...initialState(), moyu: 5, totalEarned: 5, lifetimeEarned: 5 };
  m.penaltyWhenPoor = resolveBossChoice(poor, "hasty", "switch-screen", 100).delta; // 期望 -60，实际 -5
  // 正常结算：选对 / 选错 / 重复 / 非 choice 变体
  const mkEs = (extra: Partial<ReturnType<typeof newEventState>> = {}) => ({
    ...newEventState(),
    bossVariant: "choice" as const,
    bossPersonality: "suspicious" as const,
    bossUntil: 1000,
    bossStartAt: 0,
    patrolCount: 5,
    ...extra,
  });
  const es1 = mkEs();
  const r1 = onBossChoice(s, es1, "switch-screen")!;
  m.correctOutcome = {
    correct: r1.correct,
    delta: r1.delta,
    streak: r1.state.surviveStreak,
    patrolSurvives: r1.state.patrolSurvives,
    bossChoiceDone: es1.bossChoiceDone,
    bossUntil: es1.bossUntil,
    doubleResolve: onBossChoice(r1.state, es1, "switch-screen"),
  };
  const es2 = mkEs();
  const r2 = onBossChoice(s, es2, "act-busy")!;
  m.wrongOutcome = {
    correct: r2.correct,
    delta: r2.delta,
    streak: r2.state.surviveStreak,
    patrolSurvives: r2.state.patrolSurvives,
    bossCaught: es2.bossCaught,
  };
  // 超时：窗口已过、未做选择 → finishPatrol 0 奖
  const es3 = mkEs({ bossUntil: -1, bossChoiceDone: false, surviveStreak: 3 });
  const fin = finishPatrol({ ...s, surviveStreak: 3 }, es3);
  m.timeoutFinish = {
    reward: fin.reward,
    streakAfter: fin.state.surviveStreak,
    patrolSurvives: fin.state.patrolSurvives,
    bossChoiceDoneStillFalse: es3.bossChoiceDone,
    lateAfterTimeout: onBossChoice(fin.state, es3, "switch-screen"),
  };
  // ⚠ 窗口外调用 onBossChoice 仍然结算（无时间/窗口校验）
  const es4 = mkEs({ bossUntil: -1, bossChoiceDone: false });
  const late = onBossChoice(s, es4, "switch-screen");
  m.choiceAfterWindowClosed = late ? { correct: late.correct, delta: late.delta } : null;
  // 非 choice 变体拒绝
  const es5 = { ...newEventState(), bossVariant: "hold" as const, bossUntil: 1000 };
  m.rejectNonChoice = onBossChoice(s, es5, "act-busy");
  // choice 奖励没有乘连胜 / 天赋 / 卡巡逻倍率（hold 有）
  const streak5 = { ...s, surviveStreak: 5 };
  const esHold = { ...newEventState(), surviveStreak: 5 };
  const esZero = { ...newEventState(), surviveStreak: 0 };
  const bigCard = withCard("big_meeting");
  m.choiceVsHoldReward = {
    holdBase: bossSurviveReward(s, esZero),
    holdStreak5: bossSurviveReward(streak5, esHold),
    holdCardX2: bossSurviveReward(bigCard, esHold),
    choiceDeltaBase: onBossChoice(s, mkEs(), "switch-screen")!.delta,
    choiceDeltaStreak5: onBossChoice(streak5, mkEs(), "switch-screen")!.delta,
    choiceDeltaWithCardX2: onBossChoice(bigCard, mkEs(), "switch-screen")!.delta,
  };
  // 性格强制：dev hook 先设 suspicious，scheduleEvents 又随机覆盖
  const es6 = { ...newEventState(), nextBossAt: 0, forcedVariant: "choice" as const, bossPersonality: "suspicious" as const };
  scheduleEvents(es6, 100, () => 0.1);
  m.forcedChoicePersonality = {
    expected: "suspicious",
    actual: es6.bossPersonality,
    variant: es6.bossVariant,
    windowSeconds: es6.bossUntil - 100,
  };
  // 变体权重
  const tally: Record<string, number> = { hold: 0, type: 0, blitz: 0, choice: 0 };
  const NV = 200000;
  for (let i = 0; i < NV; i++) tally[pickBossVariant(rng)] += 1;
  m.variantWeights = {
    hold: tally.hold! / NV,
    type: tally.type! / NV,
    blitz: tally.blitz! / NV,
    choice: tally.choice! / NV,
  };
  out.C_bossChoice = m;
}

// ---------- D. 变体互斥：choice 窗口内点画布是否走 hold 的"偷点"罚款 ----------
{
  const { onBossTap } = await import("../src/engine/events");
  const s2 = baseState();
  const es = {
    ...newEventState(),
    bossVariant: "choice" as const,
    bossPersonality: "hasty" as const,
    bossUntil: 1000,
    bossStartAt: 0,
    patrolCount: 5,
    surviveStreak: 4,
  };
  const r = onBossTap(s2, es, 500); // 窗口内（5s 处）点画布
  out.D_variantLeak = {
    choiceTapCaught: r.caught,
    choiceTapLost: r.lost,
    streakAfterTap: es.surviveStreak,
    bossCaught: es.bossCaught,
    note: "choice 未被 onBossTap 识别为任务变体 → 走 hold 偷点罚款并清零连胜",
  };
}

console.log(JSON.stringify(out, null, 1));
