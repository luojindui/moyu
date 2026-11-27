/**
 * 终验·数据自洽（第 5 代新玩家 / 数据党）——引擎实算探针
 * 覆盖：升级价格/里程碑、全系统倍率叠加、派遣/日报/巡逻/丢梗/小游戏/离线奖励公式、
 *       转生、精力存档一致性、面板显示公式 vs 引擎真值、静态文案漂移。
 * 产出：playtest/final-data-engine.json
 * 运行：node node_modules/vitest/vitest.mjs run --config vitest.final-data.config.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync, readFileSync } from "node:fs";
import { initialState, gain, type GameState } from "../src/engine/state";
import { UPGRADES, costOf, effectOf, stationIdleOf, stationIdleScaled, marginalEffect, milestoneGap, idleIfHome, conversionBonus } from "../src/engine/upgrades";
import { clickPowerOf, doClick, BASE_CLICK_POWER, comboMultiplier } from "../src/engine/actions";
import { prestigeMultiplier, prestigeGain, prestigeThreshold, canPrestige, doPrestige, PRESTIGE_TUNING, PRESTIGE_UNLOCK, PRESTIGE_POINT_CAP } from "../src/engine/prestige";
import { COLLEAGUES, MISSIONS, MAX_COLLEAGUE_LEVEL, upgradeCostOf, recruit, upgradeColleague, dispatchReward, dispatch, claimMission, missionSecondsFor, teamFixedRate, teamShareRatio, favorBonuses, favorTier, SKILL_MATCH_BONUS, DISPATCH_COEF, DISPATCH_FLOOR, DISPATCH_LEVEL_FACTOR, UPGRADE_COEF, UPGRADE_BASE, TEAM_OFFLINE_SHARE } from "../src/engine/team";
import { TALENTS, talentEffects, addTalentPoints, emptyTalents, talentCostOf, TALENT_POINT_CAP, costOfTalent } from "../src/engine/talents";
import { DECOR, buyDecor, decorEffects, DECOR_COMPLETE_BONUS } from "../src/engine/decor";
import { ENERGY_ACTIONS, ENERGY_PER_DAY, emptyEnergy, useEnergy, energyEffects, ensureEnergy } from "../src/engine/energy";
import { CARDS, cardEffects, emptyCardState } from "../src/engine/cards";
import { dailyReward, claimDaily, rollDaily, ensureDaily } from "../src/engine/daily";
import { bossSurviveReward, newEventState, finishPatrol, onMemeTap, onBossTap, surviveStreakMult, BOSS_REWARD_MIN, BOSS_REWARD_IDLE_SECONDS, BOSS_TYPE_TARGET, BOSS_BLITZ_TARGET, BOSS_BLITZ_REWARD_MULT, MEME_REWARD_CLICKS } from "../src/engine/events";
import { resolveBossChoice, CHOICE_CORRECT_MULT, CHOICE_WRONG_PENALTY_RATIO } from "../src/engine/boss-choice";
import { offlineEarn, capForElapsed, OFFLINE_CAP_SECONDS, OFFLINE_CAP_WEEK, OFFLINE_CAP_MONTH } from "../src/engine/offline";
import { offlineEfficiency } from "../src/engine/progression";
import { finishGame, REF_SCORE_BY_GAME, TARGET_IDLE_SECONDS, EARLY_FLOOR, ARCADE_DAILY_LIMIT } from "../src/engine/minigames";
import { MEME_QUOTES, UPGRADE_FLAVOR } from "../src/engine/flavor";
import { collectionCount, TOTAL_ITEMS } from "../src/engine/collection";
import { computeStats, investedOf } from "../src/engine/stats";
import { serialize, restore, SAVE_KEY, type SaveAdapter } from "../src/engine/save";
import { formatMoyu } from "../src/engine/format";

const NOW = Date.now();
const TODAY = new Date(NOW).toLocaleDateString("sv-SE");
const DAY = 86_400_000;
const report: Record<string, any> = { generatedAt: new Date(NOW).toISOString(), nowIso: new Date(NOW).toISOString(), today: TODAY, checks: {}, defects: [] as any[] };

afterAll(() => {
  writeFileSync("playtest/final-data-engine.json", JSON.stringify(report, null, 2));
});

const close = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= Math.max(1, Math.abs(b)) * rel;

/** 全系统富状态：8 家具 + 5 同事满级 + 天赋 24 点 + 转生 8 点 + 图鉴 55 + 精力 3 项 + 咖啡日卡 */
function richState(over: Partial<GameState> = {}): GameState {
  const levels: Record<string, number> = { coffee: 12, water: 8, chair: 5, phone: 30, toilet: 22, group: 15, meeting: 7, deep: 3, retire: 1 };
  const quotes = MEME_QUOTES.map((_, i) => i);
  const flavors = Array.from({ length: UPGRADES.length * 5 }, (_, i) => i);
  const team = {
    colleagues: {
      zhou: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 100, autoRepeat: false, rewardSnapshot: 0 },
      mei: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 90, autoRepeat: false, rewardSnapshot: 0 },
      qiang: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 85, autoRepeat: false, rewardSnapshot: 0 },
      li: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 80, autoRepeat: false, rewardSnapshot: 0 },
      wang: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 70, autoRepeat: false, rewardSnapshot: 0 },
    },
  };
  // 24 点：点击 9（5a）+ 挂机 9（5b）+ 事件 6
  const unlocked = ["click_1", "click_2", "click_3", "click_4", "click_5a", "idle_1", "idle_2", "idle_3", "idle_4", "idle_5b", "event_1", "event_2", "event_3", "event_4"];
  const talents = { unlocked, points: 0, rankGranted: 12, dailyGiftDate: TODAY, overflow: 4 };
  const cards = { date: TODAY, offers: ["coffee_day"], chosen: "coffee_day", until: NOW + 3600_000, nextDayGuaranteed: null, dismissed: true, chosenDate: TODAY };
  let s: GameState = {
    ...initialState(),
    moyu: 1e12,
    totalEarned: 5e12,
    lifetimeEarned: 5e12,
    levels,
    collected: { quotes, flavors },
    daily: { date: TODAY, goals: [
      { id: "visit_1", target: 1, progress: 1, done: true },
      { id: "idle_earn", target: 1, progress: 1, done: true },
      { id: "click_100", target: 100, progress: 100, done: true },
    ], streak: 5, lastCompleteDate: new Date(NOW - DAY).toLocaleDateString("sv-SE"), claimed: false, window: 0, claimsToday: 0 },
    totalClicks: 3000,
    patrolSurvives: 20,
    visit: undefined as never,
    visits: { date: TODAY, count: 5 },
    prestige: 8,
    team,
    talents,
    cards,
    decor: DECOR.map((d) => d.id),
    energy: emptyEnergy(TODAY),
    arcade: { date: TODAY, played: 0, best: { coffee: 300 } },
  };
  delete (s as any).visit;
  s = useEnergy(s, "slack")!;
  s = useEnergy(s, "fake-work")!;
  s = useEnergy(s, "social")!;
  return { ...s, ...over };
}

// ═══════════ 一、升级 9 档：价格 ×1.15 / 里程碑 ×2 ═══════════
describe("升级 9 档", () => {
  it("价格 = ceil(base × 1.15^level)，9 档全部核对", () => {
    const rows = UPGRADES.map((u) => {
      const prices = [0, 1, 10, 20, 50].map((lv) => costOf(u.id, lv));
      const want = [0, 1, 10, 20, 50].map((lv) => Math.ceil(u.baseCost * 1.15 ** lv));
      expect(prices, u.id).toEqual(want);
      return { id: u.id, base: u.baseCost, prices, expect };
    });
    report.checks.upgradePrices = rows;
    expect(rows).toHaveLength(9);
  });
  it("里程碑 ×2 每 20 级（含错峰），与 UI 的 marginalEffect/milestoneGap 吻合", () => {
    // 咖啡 offset0：lv19→20 效果翻倍
    const e19 = effectOf({ ...initialState(), levels: { coffee: 0, retire: 20 } });
    const rows: any[] = [];
    for (const u of UPGRADES) {
      const m = (lv: number) => {
        const before = effectOf({ ...initialState(), levels: { [u.id]: lv } }).idleRate + clickPowerOfForClick(u.id, lv);
        const after = effectOf({ ...initialState(), levels: { [u.id]: lv + 1 } }).idleRate + clickPowerOfForClick(u.id, lv + 1);
        const inc = after - before;
        const mm = marginalEffect(u.id, lv);
        const shown = mm.clickPower || mm.idleRate;
        return { lv, inc, shown, gap: milestoneGap(u.id, lv) };
      };
      rows.push({ id: u.id, base: u.clickPower ?? u.idleRate, ...m(19), ...m(20) });
    }
    report.checks.milestones = rows;
    // 每个档位：19→20 的增量应是 18→19 的 ~2 倍（严格按各自偏移）
    for (const r of rows) {
      expect(r.shown).toBeGreaterThan(0);
      expect(close(r.inc, r.shown, 1e-9)).toBe(true);
    }
    // 咖啡 lv19 边际 = +20（基础1×20×2^0=20）；lv20→21 边际 = 21*2-20*2=2? 实际 20*2=40 → 21*2=42，差 2
    void e19;
  });
  it("UI「×2差 N 级」与实际翻倍级数一致（抽查 9 档）", () => {
    const rows: any[] = [];
    for (const u of UPGRADES) {
      for (const lv of [0, 3, 17, 19, 20, 21]) {
        // 找到实际下一次效果跳变的等级
        let jump = -1;
        const baseAt = (l: number) => (u.clickPower ?? u.idleRate ?? 0) * l * 2 ** Math.floor((l + (((UPGRADES.findIndex((x) => x.id === u.id) % 4) * 5))) / 20);
        for (let l = lv; l <= lv + 25; l++) {
          if (baseAt(l + 1) / baseAt(l + 1) === 1) continue;
          const incNow = baseAt(l + 1) - baseAt(l);
          const incNext = baseAt(l + 2) - baseAt(l + 1);
          if (incNext > incNow * 1.5) { jump = l + 1; break; }
        }
        if (jump > 0) rows.push({ id: u.id, lv, gapShown: milestoneGap(u.id, lv), actualJumpIn: jump - lv });
      }
    }
    report.checks.milestoneGaps = rows;
    for (const r of rows) expect(r.gapShown, `${r.id}@${r.lv}`).toBe(r.actualJumpIn);
  });
});

function clickPowerOfForClick(id: string, lv: number): number {
  const saved = id;
  void saved;
  const s: GameState = { ...initialState(), levels: { [id]: lv } };
  return clickPowerOf(s) - BASE_CLICK_POWER; // 去掉基础 1，得到升级贡献
}

// ═══════════ 二、倍率叠加（挂机：天赋×家具×精力×卡×溢出×转生×图鉴） ═══════════
describe("倍率叠加验证（引擎）", () => {
  it("逐因子拆解：每个因子单独乘进去都精确命中", () => {
    const base = richState({ prestige: 0, collected: { quotes: [], flavors: [] }, decor: [], talents: emptyTalents(), cards: emptyCardState(TODAY), energy: emptyEnergy(TODAY), team: { colleagues: {} } });
    const raw = stationIdleOf(base);
    const rows: any[] = [];
    const probe = (name: string, st: GameState, expectFactor: number) => {
      const got = stationIdleScaled(st) / (stationIdleOf(st) * (name === "prestige" ? 1 : 1));
      rows.push({ name, got, expectFactor });
    };
    // 单因子：转生 8 点 → ×7
    probe("prestige", { ...base, prestige: 8 }, 7);
    // 图鉴 55 → ×1.2；5 格 → ×1.02
    probe("collection55", { ...base, collected: { quotes: [0, 1, 2, 3, 4], flavors: Array.from({ length: 50 }, (_, i) => i) } }, 1.2);
    probe("collection5", { ...base, collected: { quotes: [0, 1, 2], flavors: [0, 1] } }, 1.02);
    // 天赋 idle_1+idle_3 = ×1.08
    const idleT = { unlocked: ["idle_1", "idle_3"], points: 0, rankGranted: -1, dailyGiftDate: "", overflow: 0 };
    probe("talentIdle", { ...base, talents: idleT }, 1.08);
    // 溢出 4 点 = ×1.02
    probe("overflow4", { ...base, talents: { ...emptyTalents(), overflow: 4 } }, 1.02);
    // 咖啡日卡 ×1.15
    probe("card", { ...base, cards: { ...emptyCardState(TODAY), chosen: "coffee_day", until: NOW + 3600_000, chosenDate: TODAY } }, 1.15);
    // 家具：plant+fridge+aquarium+catbed + 集齐 ×1.1
    probe("decor5", { ...base, decor: ["plant", "fridge", "aquarium", "catbed"] }, 1.05 * 1.08 * 1.1 * 1.15);
    probe("decor8", { ...base, decor: DECOR.map((d) => d.id) }, 1.05 * 1.08 * 1.1 * 1.15 * 1.1);
    // 精力 slack+social = ×1.25×1.05
    let e = { ...base, team: { colleagues: { zhou: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 } } } };
    e = useEnergy(e, "slack")!;
    e = useEnergy(e, "social")!;
    probe("energy2", e, 1.25 * 1.05);
    report.checks.stackFactors = rows;
    for (const r of rows) expect(r.got, r.name).toBeCloseTo(r.expectFactor, 12);
  });

  it("全系统叠加：手动乘积 == stationIdleScaled（13 位精度）", () => {
    const s = richState();
    const raw = stationIdleOf(s);
    const t = talentEffects(s.talents);
    const card = cardEffects(s, NOW);
    const decor = decorEffects(s);
    const energy = energyEffects(s);
    const mult = prestigeMultiplier(s.prestige) * 1.2; // 图鉴 55 → ×1.2
    const conv = 1 + 0.10; // click_5a：3000 点击 → +10%
    const expected = raw * mult * t.idleMult * conv * (1 + t.overflowIdleBonus) * card.idleMult * (decor.idleMult) * energy.idleMult;
    const got = stationIdleScaled(s);
    const parts = {
      raw, mult, talentIdle: t.idleMult, conv, overflow: 1 + t.overflowIdleBonus,
      card: card.idleMult, decor: decor.idleMult, energy: energy.idleMult,
      expected, got, ratio: got / expected,
      factors: { prestige: prestigeMultiplier(s.prestige), collection: 1.2, talentIdle: t.idleMult, conversion: conv, overflow: 1 + t.overflowIdleBonus, card: card.idleMult, decor: decor.idleMult, energy: energy.idleMult },
    };
    report.checks.stackFull = parts;
    expect(close(got, expected, 1e-12)).toBe(true);
  });

  it("effectOf.idleRate 三段拆分：工位 + 同事固定 + 同事占比，与手动一致", () => {
    const s = richState();
    const t = talentEffects(s.talents);
    const mult = prestigeMultiplier(s.prestige) * 1.2;
    const station = stationIdleScaled(s);
    const fixed = teamFixedRate(s) * mult * favorBonuses(s).idleMult * t.teamIdleMult;
    const share = stationIdleOf(s) * mult * teamShareRatio(s) * t.teamIdleMult;
    const total = effectOf(s).idleRate;
    report.checks.idleSplit = { station, fixed, share, total, manual: station + fixed + share, diff: total - (station + fixed + share) };
    expect(close(total, station + fixed + share, 1e-12)).toBe(true);
  });

  it("点击力叠加：转生×图鉴×天赋×卡×家具×精力，手动乘积 == clickPowerOf", () => {
    const s = richState();
    const t = talentEffects(s.talents);
    const card = cardEffects(s, NOW);
    const decor = decorEffects(s);
    const energy = energyEffects(s);
    const mult = prestigeMultiplier(s.prestige) * 1.2;
    const rawClick = UPGRADES.filter((u) => u.clickPower).reduce((acc, u) => {
      const lv = s.levels[u.id] ?? 0;
      if (!lv) return acc;
      const off = (UPGRADES.findIndex((x) => x.id === u.id) % 4) * 5;
      const eff = (u.clickPower ?? 0) * lv * 2 ** Math.floor((lv + off) / 20);
      return acc + eff;
    }, 0);
    // 注意 clickPowerOf = (BASE×prestige + effectOf.clickPower) × talent.clickMult × card × decor × energy
    // effectOf.clickPower = rawClick × prestige×collection
    const expected = (BASE_CLICK_POWER * prestigeMultiplier(s.prestige) + rawClick * mult) * t.clickMult * card.clickMult * decor.clickMult * energy.clickMult;
    const got = clickPowerOf(s);
    report.checks.clickStack = { rawClick, prestige: prestigeMultiplier(s.prestige), collection: 1.2, mult, talent: t.clickMult, card: card.clickMult, decor: decor.clickMult, energy: energy.clickMult, expected, got };
    expect(close(got, expected, 1e-12)).toBe(true);
  });
});

// ═══════════ 三、奖励公式 ═══════════
describe("奖励公式核对", () => {
  it("派遣：base=max(300, (工位+同事×2)×秒×0.011) × 倍率 × 匹配 × 等级 × 好感 × 被动 × 卡 × 家具", () => {
    const s = richState();
    const station = stationIdleScaled(s);
    const rows: any[] = [];
    for (const def of COLLEAGUES) {
      for (const m of MISSIONS) {
        const probe: GameState = { ...s, team: { colleagues: { ...s.team.colleagues, [def.id]: { ...s.team.colleagues[def.id]!, missionId: m.id } } } };
        const cur = s.team.colleagues[def.id]!;
        const got = dispatchReward(probe, def.id, station);
        const colIdle = def.idlePerLevel * cur.level + station * def.sharePerLevel * cur.level;
        const base = Math.max(DISPATCH_FLOOR, (station + colIdle * 2) * m.seconds * DISPATCH_COEF);
        const match = def.skill === m.type ? 1 + SKILL_MATCH_BONUS : 1;
        const lvF = 1 + DISPATCH_LEVEL_FACTOR * ((cur.level - 1) / (MAX_COLLEAGUE_LEVEL - 1));
        const favor = (cur.favor >= 100 ? 1.5 : 1) * favorBonuses(s).dispatchMult;
        let trait = 1;
        if (def.trait === "短任务加成" && m.seconds <= 3600) trait += def.traitValue;
        if (def.trait === "长任务加成" && m.seconds >= 4 * 3600) trait += def.traitValue;
        const expected = Math.floor(base * m.mult * match * lvF * favor * trait * cardEffects(s, NOW).dispatchRewardMult * decorEffects(s).dispatchRewardMult);
        rows.push({ colleague: def.id, mission: m.id, got, expected, ok: got === expected });
        expect(got, `${def.id}/${m.id}`).toBe(expected);
      }
    }
    report.checks.dispatch = { station, rows };
  });

  it("派遣：派单快照 = 领奖到账；升级后再领不放大", () => {
    let s = richState();
    const station = stationIdleScaled(s);
    const before = dispatchReward({ ...s, team: { colleagues: { ...s.team.colleagues, zhou: { ...s.team.colleagues.zhou!, missionId: "chat" } } } }, "zhou", station);
    s = dispatch(s, "zhou", "chat", NOW, station)!;
    expect(s.team.colleagues.zhou!.rewardSnapshot).toBe(before);
    // 升级改状态（模拟领奖前涨挂机）
    const richer = richState({ totalEarned: 6e12, lifetimeEarned: 9e12, levels: { ...richState().levels, retire: 2 } });
    const withMission = { ...richer, team: { colleagues: { ...richer.team.colleagues, zhou: { ...richer.team.colleagues.zhou!, missionId: "chat", startedAt: NOW - 2e6, endsAt: NOW - 1, rewardSnapshot: s.team.colleagues.zhou!.rewardSnapshot } } } };
    const r = claimMission(withMission, "zhou", NOW, stationIdleScaled(richer))!;
    expect(r.reward).toBe(before);
    report.checks.dispatchSnapshot = { snapshot: before, claimed: r.reward };
  });

  it("日报：max(500, 600×idleRate) 正好到账；streak 只按天 +1", () => {
    const s = richState();
    const rate = effectOf(s).idleRate;
    const expected = Math.max(500, 600 * rate);
    const r = claimDaily(s, TODAY)!;
    expect(r.claimedReward).toBe(expected);
    expect(close(r.state.moyu - s.moyu, expected, 1e-10)).toBe(true);
    expect(r.state.daily!.claimed).toBe(true);
    report.checks.daily = { idleRate: rate, expected, got: r.claimedReward, delta: r.state.moyu - s.moyu };
    // 低倍率：max(500, ...) 生效
    const low = { ...initialState(), daily: rollDaily(TODAY, Math.random, 0) };
    low.daily = { ...low.daily!, goals: low.daily!.goals.map((g) => ({ ...g, progress: g.target, done: true })) };
    expect(claimDaily(low, TODAY)!.claimedReward).toBe(500);
  });

  it("巡逻：hold/type/blitz/choice 四种公式 + 连胜 ×1.5 封顶 + 天赋/卡/精力加成", () => {
    const s = richState();
    const idle = effectOf(s).idleRate;
    const base = Math.max(BOSS_REWARD_MIN, BOSS_REWARD_IDLE_SECONDS * idle);
    const t = talentEffects(s.talents);
    const card = cardEffects(s, NOW);
    const energy = energyEffects(s);
    const expectHold = base * surviveStreakMult(3) * t.patrolRewardMult * card.patrolRewardMult * energy.patrolRewardMult;
    const es3 = { ...newEventState(), bossVariant: "hold" as const, surviveStreak: 3, bossUntil: 1 };
    const gotHold = bossSurviveReward(s, es3);
    report.checks.patrol = { idle, base, expectHold, gotHold, streak3: surviveStreakMult(3), streakCap: surviveStreakMult(99), talent: t.patrolRewardMult, card: card.patrolRewardMult, energy: energy.patrolRewardMult };
    expect(close(gotHold, expectHold, 1e-12)).toBe(true);
    expect(surviveStreakMult(99)).toBe(1.5); // 封顶 ×1.5，源码注释有 "封顶 ×2" 漂移
    // 连胜 0 时
    expect(bossSurviveReward(s)).toBe(base * t.patrolRewardMult * card.patrolRewardMult * energy.patrolRewardMult);
    // type/blitz 达标
    const esType = { ...newEventState(), bossVariant: "type" as const, bossTaps: BOSS_TYPE_TARGET, bossUntil: 1 };
    const esBlitz = { ...newEventState(), bossVariant: "blitz" as const, bossTaps: BOSS_BLITZ_TARGET, bossUntil: 1 };
    const rType = finishPatrol({ ...s, surviveStreak: 0 }, esType);
    const rBlitz = finishPatrol({ ...s, surviveStreak: 0 }, esBlitz);
    expect(rType.reward).toBeCloseTo(base * t.patrolRewardMult * card.patrolRewardMult * energy.patrolRewardMult, 6);
    expect(rBlitz.reward).toBeCloseTo(base * BOSS_BLITZ_REWARD_MULT * t.patrolRewardMult * card.patrolRewardMult * energy.patrolRewardMult, 6);
    // choice：选对 ×1.8 / 选错 -1.0（新手宽限 0）
    const cBase = bossSurviveReward({ ...s, team: { colleagues: {} } }, { ...newEventState(), surviveStreak: 0 });
    const ok = resolveBossChoice({ ...s, team: { colleagues: {} } }, "hasty", "act-busy", cBase);
    const bad = resolveBossChoice({ ...s, team: { colleagues: {} } }, "hasty", "switch-screen", cBase);
    expect(ok.delta).toBe(Math.floor(cBase * CHOICE_CORRECT_MULT));
    expect(bad.delta).toBe(-Math.min(Math.floor(cBase * CHOICE_WRONG_PENALTY_RATIO), s.moyu));
    report.checks.patrolVariants = { typeReward: rType.reward, blitzReward: rBlitz.reward, choiceCorrect: ok.delta, choiceWrong: bad.delta, choiceBase: cBase };
  });

  it("丢梗：5×点击力 × 天赋 × 好感(60 档 +10%)；一梗一奖", () => {
    const s = richState();
    const t = talentEffects(s.talents);
    const favor = favorBonuses(s);
    const expected = MEME_REWARD_CLICKS * clickPowerOf(s) * t.memeRewardMult * favor.memeMult;
    const es = { ...newEventState(), memeUntil: 10 };
    const r = onMemeTap(s, es);
    report.checks.meme = { clickPower: clickPowerOf(s), talentMeme: t.memeRewardMult, favorMeme: favor.memeMult, expected, got: r.earned };
    expect(r.earned).toBe(expected);
    // 第二次（已关闭窗口）0
    expect(onMemeTap(r.state, es).earned).toBe(0);
  });

  it("小游戏：max(floor(idle×25×ratio), ceil(30×ratio))，三游戏参考分/早退折算", () => {
    const idle = 1000;
    const rows: any[] = [];
    for (const g of ["coffee", "findboss", "rhythm"] as const) {
      const ref = REF_SCORE_BY_GAME[g];
      const full = finishGame({ ...initialState(), arcade: { date: TODAY, played: 0, best: {} } }, g, ref, idle, 30)!;
      const expectFull = Math.max(Math.floor(idle * TARGET_IDLE_SECONDS * 1), Math.ceil(EARLY_FLOOR * 1));
      const half = finishGame({ ...initialState(), arcade: { date: TODAY, played: 0, best: {} } }, g, Math.floor(ref / 2), idle, 30)!;
      const early = finishGame({ ...initialState(), arcade: { date: TODAY, played: 0, best: {} } }, g, ref, idle, 3)!;
      const zero = finishGame({ ...initialState(), arcade: { date: TODAY, played: 0, best: {} } }, g, 0, idle, 30)!;
      rows.push({ game: g, ref, full: full.reward, expectFull, half: half.reward, early: early.reward, zero: zero.reward, zeroPlayed: zero.state.arcade.played });
      expect(full.reward).toBe(expectFull);
      expect(early.reward).toBe(Math.max(Math.floor(idle * TARGET_IDLE_SECONDS * 0.1 * 3), Math.ceil(EARLY_FLOOR * 0.3)));
      expect(zero.reward).toBe(0);
    }
    // 早期保底：idle=0.2 → 满分 30
    const early = finishGame({ ...initialState(), arcade: { date: TODAY, played: 0, best: {} } }, "coffee", 540, 0.2, 30)!;
    expect(early.reward).toBe(30);
    // 前 2 秒退还次数
    const refund = finishGame({ ...initialState(), arcade: { date: TODAY, played: 0, best: {} } }, "coffee", 540, 1000, 1.5)!;
    expect(refund.state.arcade.played).toBe(0);
    expect(refund.reward).toBe(0);
    report.checks.arcade = { rows, earlyFloor: early.reward, refundPlayed: refund.state.arcade.played };
  });

  it("离线：12h/24h/48h 阶梯封顶 + 同事只 50% + 首日/回访效率", () => {
    const sAll = richState();
    // 先去掉 idle_2（离线封顶 +2h），单独验证基础阶梯
    const s = { ...sAll, talents: { ...sAll.talents, unlocked: sAll.talents.unlocked.filter((id) => id !== "idle_2") } };
    const station = stationIdleScaled(s);
    const total = effectOf(s).idleRate;
    const teamPart = total - station;
    const cases = [
      { seconds: 1 * 3600, cap: OFFLINE_CAP_SECONDS },
      { seconds: 11 * 3600, cap: OFFLINE_CAP_SECONDS },
      { seconds: 13 * 3600, cap: OFFLINE_CAP_SECONDS },
      { seconds: 8 * 86400, cap: OFFLINE_CAP_WEEK },
      { seconds: 31 * 86400, cap: OFFLINE_CAP_MONTH },
    ];
    const rows: any[] = [];
    for (const c of cases) {
      expect(capForElapsed(c.seconds)).toBe(c.cap);
      const r = offlineEarn(s, c.seconds, 1);
      const applied = Math.min(c.seconds, c.cap);
      const expectEarned = (station + teamPart * TEAM_OFFLINE_SHARE) * applied;
      rows.push({ seconds: c.seconds, capHours: c.cap / 3600, applied, got: r.earned, expectEarned, ratio: r.earned / expectEarned });
      expect(close(r.earned, expectEarned, 1e-12)).toBe(true);
    }
    // 天赋 idle_2：+2h 上限
    const withIdle2 = { ...s, talents: { ...s.talents, unlocked: [...s.talents.unlocked, "idle_2"] } };
    expect(offlineEarn(withIdle2, 20 * 3600, 1).applied).toBe(OFFLINE_CAP_SECONDS + 2 * 3600);
    // 离线效率：首日 1.0；之后 0.7 + 回访
    const created = NOW - 3 * DAY;
    const effRows = {
      firstDay: offlineEfficiency(s, NOW - 3600_000, NOW),
      afterDay_noVisit: offlineEfficiency({ ...s, visits: { date: TODAY, count: 0 } }, created, NOW),
      afterDay_1visit: offlineEfficiency({ ...s, visits: { date: TODAY, count: 1 } }, created, NOW),
      afterDay_3visit: offlineEfficiency({ ...s, visits: { date: TODAY, count: 3 } }, created, NOW),
    };
    report.checks.offline = { rows, caps: { day: OFFLINE_CAP_SECONDS, week: OFFLINE_CAP_WEEK, month: OFFLINE_CAP_MONTH }, idle2Applied: offlineEarn(withIdle2, 20 * 3600, 1).applied, rates: effRows };
    expect(effRows.firstDay).toBeGreaterThan(1); // 首日家具/天赋加成不被 1.0 截断
    expect(effRows.afterDay_3visit).toBeGreaterThanOrEqual(1);
  });

  it("转生：+75%/点线性、点数公式 floor(3×(本局/1e8)^0.4) 封顶 20、门槛随倍率涨", () => {
    const p0 = { ...initialState(), totalEarned: 1e8, lifetimeEarned: 1e8 };
    const rows: any[] = [];
    for (const pts of [0, 1, 5, 8, 20, 40]) {
      const mult = prestigeMultiplier(pts);
      expect(close(mult, 1 + 0.75 * pts, 1e-15)).toBe(true);
      rows.push({ points: pts, mult });
    }
    const g = prestigeGain(p0);
    const normalized = p0.totalEarned / (PRESTIGE_UNLOCK * prestigeMultiplier(0));
    const expectG = Math.max(1, Math.min(PRESTIGE_POINT_CAP, Math.floor(PRESTIGE_TUNING.gainA * normalized ** PRESTIGE_TUNING.gainB)));
    const threshold = prestigeThreshold(p0);
    const r = doPrestige(p0)!;
    report.checks.prestige = { rows, gainAtUnlock: g, expectG, threshold, perPoint: PRESTIGE_TUNING.perPoint, keepLevelRatio: PRESTIGE_TUNING.keepLevelRatio, gained: r.gained, levelsKeep: r.state.levels };
    expect(g).toBe(expectG);
    expect(threshold).toBe(PRESTIGE_UNLOCK);
    expect(r.gained).toBe(g);
    // 门槛随倍率线性涨
    expect(prestigeThreshold({ ...p0, prestige: 8 })).toBe(PRESTIGE_UNLOCK * 7);
    // 保留 80% 等级
    const keep = doPrestige({ ...p0, levels: { phone: 10, coffee: 3 } })!;
    expect(keep.state.levels).toEqual({ phone: 8, coffee: 2 });
  });
});

// ═══════════ 四、精力存档一致性（focus 被重算成 1.2 / 丢 8%） ═══════════
describe("精力存档往返一致性", () => {
  function memAdapter(): SaveAdapter {
    const store = new Map<string, string>();
    return { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) };
  }
  it("focus：实时 ×2 点击 / +8% 挂机，存档往返后变 ×1.2 / 无挂机加成（P1）", () => {
    const base = richState({ energy: emptyEnergy(TODAY) });
    const live = useEnergy(base, "focus")!;
    const liveClick = clickPowerOf(live);
    const liveIdle = effectOf(live).idleRate;
    const ad = memAdapter();
    serialize(live, ad, NOW);
    const restored = restore(ad, NOW).state!;
    const restoredClick = clickPowerOf(restored);
    const restoredIdle = effectOf(restored).idleRate;
    const noEnergy = clickPowerOf(base);
    report.checks.energyRoundtrip = {
      desc: "专注点击：今天点击力 ×2，且挂机 +8%",
      liveBoost: energyEffects(live),
      restoredBoost: energyEffects(restored),
      liveClick, restoredClick, ratioAfterReload: restoredClick / liveClick,
      liveIdle, restoredIdle, idleDropPct: (1 - restoredIdle / liveIdle) * 100,
      baseClick: noEnergy,
    };
    // 期望：实时 ×2；存档后应仍是 ×2（实测 1.2）
    expect(energyEffects(live).clickMult).toBeCloseTo(2, 12);
    expect(energyEffects(live).idleMult).toBeCloseTo(1.08, 12);
    expect(restoredClick / liveClick).toBeCloseTo(0.6, 6); // 2→1.2
    expect(restoredIdle).toBeLessThan(liveIdle);
  });
});

// ═══════════ 五、面板显示公式 vs 引擎真值（UI 复现） ═══════════
describe("面板显示公式 vs 引擎", () => {
  it("小队面板「小队挂机 +X/秒」= teamFixedRate + stationIdleScaled×shareRatio（缺转生/图鉴/天赋/好感，P1）", () => {
    const s = richState();
    const station = stationIdleScaled(s);
    const uiTotal = teamFixedRate(s) + station * teamShareRatio(s);
    const engineTeam = effectOf(s).idleRate - station;
    report.checks.teamSummary = {
      uiShown: uiTotal,
      engineTeam,
      ratio: uiTotal / engineTeam,
      missing: { prestigeMult: prestigeMultiplier(s.prestige), collection: 1.2, favorIdle: favorBonuses(s).idleMult, teamIdle: talentEffects(s.talents).teamIdleMult },
    };
    expect(Math.abs(uiTotal - engineTeam) / engineTeam).toBeGreaterThan(0.3);
  });
  it("同事卡「挂机 +X/秒」漏掉好感/带队天赋/离岗折损（P2）", () => {
    const s = richState();
    const mult = prestigeMultiplier(s.prestige);
    const t = talentEffects(s.talents);
    const favor = favorBonuses(s).idleMult;
    const rows = COLLEAGUES.map((def) => {
      const cur = s.team.colleagues[def.id]!;
      const ui = Math.round(def.idlePerLevel * cur.level * mult);
      const engine = def.idlePerLevel * cur.level * mult * favor * t.teamIdleMult;
      return { id: def.id, ui, engine, k: ui / engine };
    });
    report.checks.colleagueIdle = rows;
    expect(rows.some((r) => Math.abs(r.k - 1) > 0.2)).toBe(true);
  });
  it("派遣按钮「净 +X/h」用 stationIdleScaled 估离岗损失（与引擎离岗损失口径不一致，P2）", () => {
    const s = richState();
    const station = stationIdleScaled(s);
    const mult = prestigeMultiplier(s.prestige) * 1.2;
    const t = talentEffects(s.talents);
    const def = COLLEAGUES.find((d) => d.id === "qiang")!;
    const cur = s.team.colleagues["qiang"]!;
    const m = MISSIONS.find((x) => x.id === "meeting")!;
    const probe: GameState = { ...s, team: { colleagues: { ...s.team.colleagues, qiang: { ...cur, missionId: m.id } } } };
    const est = dispatchReward(probe, "qiang", station);
    const perHour = est / (m.seconds / 3600);
    const uiLoss = (def.idlePerLevel * cur.level * mult + station * def.sharePerLevel * cur.level) * 0.15;
    const engineLoss = (def.idlePerLevel * cur.level * mult * favorBonuses(s).idleMult * t.teamIdleMult + stationIdleOf(s) * mult * def.sharePerLevel * cur.level * t.teamIdleMult) * 0.15;
    report.checks.dispatchNet = { perHour, uiLossPerHour: uiLoss * 3600, engineLossPerHour: engineLoss * 3600, uiNet: perHour - uiLoss * 3600, engineNet: perHour - engineLoss * 3600 };
    expect(Math.abs(uiLoss * 3600 - engineLoss * 3600) / (engineLoss * 3600)).toBeGreaterThan(0.2);
  });
  it("天赋面板「点击转化/安然转化」：未点对应天赋时仍显示百分比（P1/P2）", () => {
    const s = richState();
    const actual = conversionBonus(s);
    const eff = talentEffects(s.talents);
    const uiClick = Math.min(0.35, Math.floor(s.totalClicks / 300) * 0.01);
    const uiSurvive = Math.min(0.3, s.patrolSurvives * 0.01);
    const uiTotal = uiClick + uiSurvive;
    report.checks.talentTransform = {
      state: "解锁 click_5a，未解锁 event_5a；patrolSurvives=20",
      uiLines: { click: uiClick, survive: uiSurvive },
      actualConversion: actual,
      uiSumIfAdded: uiTotal,
      clickToIdleStep: eff.clickToIdleStep,
      surviveToIdle: eff.surviveToIdle,
      note: "UI 两行恒显示；未解锁 event_5a 时「安然转化 +20%」并未生效；若选 click_5b 则显示公式也不对",
    };
    expect(eff.surviveToIdle).toBe(false);
    expect(uiSurvive).toBeGreaterThan(0);
    expect(actual).toBeCloseTo(0.10, 12);
  });
  it("今日回访显示 x/3：visits 计数无上限（P2）", () => {
    const s = richState();
    const st = computeStats(s);
    report.checks.visits = { count: st.visits, shown: `${st.visits}/3` };
    expect(st.visits).toBe(5);
  });
  it("「累计投入」investedOf 含同事招募+升级价，但与余额+现有等级无关（只做加总，抽查）", () => {
    const s = richState();
    const inv = investedOf(s);
    report.checks.invested = { invested: inv, balance: s.moyu };
    expect(inv).toBeGreaterThan(0);
  });
});


// ═══════════ 五-b、文案口径 vs 引擎作用域（数据党会算总账） ═══════════
describe("文案加成口径 vs 实际总收益增幅", () => {
  it("精力「今天挂机 +25%/+5%」只作用于工位段，总挂机增幅被同事稀释", () => {
    const withEnergy = richState();
    const noEnergy = { ...withEnergy, energy: emptyEnergy(TODAY) };
    const totalWith = effectOf(withEnergy).idleRate;
    const totalNo = effectOf(noEnergy).idleRate;
    const stationWith = stationIdleScaled(withEnergy);
    const stationNo = stationIdleScaled(noEnergy);
    // 单项 slack
    const slackOnly = useEnergy({ ...noEnergy }, "slack")!;
    const slackGain = effectiveIdle({ ...noEnergy, energy: slackOnly.energy });
    report.checks.labelScope = {
      energy: {
        claimedFactors: "slack ×1.25、social ×1.05（文案「今天挂机 +25% / +5%」）",
        stationFactor: stationWith / stationNo,
        totalIdleFactor: totalWith / totalNo,
        totalIdlePct: (totalWith / totalNo - 1) * 100,
        claimedPctIfStacked: 31.25,
        stationShareOfTotal: stationNo / totalNo,
      },
      slackOnly: {
        stationFactor: stationWith / stationNo,
        totalPct: (slackGain / totalNo - 1) * 100,
        claimedPct: 25,
      },
    };
    expect(close(stationWith / stationNo, 1.25 * 1.05, 1e-12)).toBe(true);
    expect(totalWith / totalNo).toBeLessThan(1.3125 * 0.5); // 明显低于标称
  });
  it("天赋「挂机收益 +4%」同样只作用于工位段（idle_1/idle_3）", () => {
    const base = richState();
    const noTalents = { ...base, talents: { ...base.talents, unlocked: base.talents.unlocked.filter((id) => id !== "idle_1" && id !== "idle_3") } };
    const t = talentEffects(base.talents).idleMult / talentEffects(noTalents.talents).idleMult;
    const totalFactor = effectOf(base).idleRate / effectOf(noTalents).idleRate;
    report.checks.labelScope.talentIdle = { talentMult: t, totalIdleFactor: totalFactor, totalPct: (totalFactor - 1) * 100, claimedPct: 8 };
    expect(close(t, 1.08, 1e-12)).toBe(true);
    expect(totalFactor).toBeLessThan(1.08);
  });
  function effectiveIdle(s: GameState): number {
    return effectOf(s).idleRate;
  }
});

// ═══════════ 五-c、其它口径问题 ═══════════
describe("其它数据口径", () => {
  it("日报：跨时段重掷后 claimed 复位 → 同一天可多次领取（4 时段），文案「今日已领」易误解", () => {
    let s = richState();
    const first = claimDaily(s, TODAY)!;
    expect(first.claimedReward).toBeGreaterThan(0);
    s = first.state;
    expect(s.daily!.claimed).toBe(true);
    // 窗口切换：ensureDaily 重掷 → claimed 复位，但目标进度保留
    const next = ensureDaily(s, TODAY, Math.random, 1);
    const afterWindow = ensureDaily(s, TODAY, Math.random, 1);
    const rerolled = { ...afterWindow, daily: afterWindow.daily ? { ...afterWindow.daily, goals: afterWindow.daily.goals.map((g) => ({ ...g, progress: g.target, done: true })) } : null };
    const second = claimDaily(rerolled, TODAY)!;
    report.checks.dailyWindows = {
      firstReward: first.claimedReward,
      claimedAfterWindowReroll: next.daily!.claimed,
      secondReward: second.claimedReward,
      totalSameDay: first.claimedReward + second.claimedReward,
      note: "claimDaily 只在同一天第一次 +streak；但奖励可领 4 次/天（每 6 小时时段）",
    };
    expect(next.daily!.claimed).toBe(false);
    expect(second.claimedReward).toBe(dailyReward(rerolled));
  });
  it("首日「离线效率 -20%」风险卡：首日分支用 max(0, raise) 把负加成吃掉（文案写 -20% 但实际 0）", () => {
    const s = { ...richState(), cards: { ...emptyCardState(TODAY), chosen: "overtime", until: NOW + 3600_000, chosenDate: TODAY } };
    const firstDay = offlineEfficiency(s, NOW - 3600_000, NOW);
    const later = offlineEfficiency(s, NOW - 10 * DAY, NOW);
    report.checks.firstDayRisk = { firstDayRate: firstDay, laterRate: later, claimedRisk: 0.2, note: "首日 branch: 1+max(0, raise)；负风险被截断" };
    expect(firstDay).toBeGreaterThanOrEqual(1);
    expect(later).toBeLessThan(firstDay);
  });
  it("好感提示「再领 N 次到 milestone」按每次 +2 估算，匹配任务实际 +3（带卡 +4）", () => {
    const now = Date.now();
    const base: GameState = { ...richState(), team: { colleagues: { zhou: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 10, autoRepeat: false, rewardSnapshot: 0 } } } };
    // 匹配任务 chat：派单→完成→领取
    const station = stationIdleScaled(base);
    let s = dispatch(base, "zhou", "chat", now - 2 * 3600_000, station)!;
    const claimed = claimMission(s, "zhou", now, station)!;
    const gainMatch = claimed.state.team.colleagues.zhou!.favor - 10;
    report.checks.favorHint = {
      uiFormula: "ceil((next-favor)/2)",
      uiClaimsTo20: Math.ceil((20 - 10) / 2),
      actualGainPerMatchedClaim: gainMatch,
      actualClaimsTo20: Math.ceil((20 - 10) / gainMatch),
      cardFavorNote: "今日卡 old_zhou_secret 再 +1 → 每次 +4",
    };
    expect(gainMatch).toBe(3);
  });
  it("「纪录·最佳单日」实现的是「本次会话增量」（lastDaySnapshot 仅启动时赋值、不跨日重置）", () => {
    const src = readFileSync("src/main.ts", "utf8");
    const cnt = (src.match(/lastDaySnapshot/g) ?? []).length;
    report.defects.push({ level: "P2", where: "src/main.ts saveNow/lastDaySnapshot", issue: `「纪录·最佳单日」用 lifetime - lastDaySnapshot.lifetime，而 lastDaySnapshot 只在启动时赋值（共 ${cnt} 处引用），实际是「本次会话增量」，多会话/跨零点会低估或错记日期` });
    expect(cnt).toBe(2);
  });
  it("天赋面板静态说明「满树需 27 点」正确；但 talents.ts TALENT_COST 注释写「tier1-4=1 点，终极=2 点」与实际 1/1/2/2/3 不符（P2）", () => {
    const src = readFileSync("src/engine/talents.ts", "utf8");
    report.defects.push({ level: "P2", where: "src/engine/talents.ts:26", issue: "注释「每级天赋需要的点数（tier1-4 = 1 点，终极 = 2 点）」与实际 talentCostOf（1/1/2/2/3）不符；同文件 TALENT_POINT_CAP 注释「3 流派 × 6 点 = 18」也与 24 不符" });
    expect(src).toContain("tier1-4 = 1 点，终极 = 2 点");
    expect(src).toContain("3 流派 × 6 点 = 18");
    const sum = ["click_1", "click_2", "click_3", "click_4", "click_5a"].reduce((a, id) => a + costOfTalent(id), 0);
    expect(sum).toBe(9);
  });
  it("图鉴/统计面板：今日回访显示 x/3 但计数无上限（P2）", () => {
    const src = readFileSync("src/ui/journal.ts", "utf8");
    const s = richState();
    const st = computeStats(s);
    report.defects.push({ level: "P2", where: "src/ui/journal.ts 今日回访", issue: `面板写「今日回访 ${st.visits}/3」但 visits.count 每次打开+1 无上限（实测富档 ${st.visits}/3），离线效率却按 min(count,3) 计算` });
    expect(src).toContain("/3（离线效率");
  });
});
// ═══════════ 六、静态文案漂移（不可解释/自相矛盾） ═══════════
describe("静态文案漂移", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("welcome 面板写「8 小时封顶」但引擎封顶 12h（P1）", () => {
    const src = read("src/ui/welcome.ts");
    report.defects.push({ level: "P1", where: "src/ui/welcome.ts:24", issue: "欢迎回来面板固定文案「8 小时封顶」，引擎 OFFLINE_CAP_SECONDS=12h（≥7 天 24h / ≥30 天 48h）；同面板封顶结算行会显示「已按上限结算 12 小时 0 分」自相矛盾" });
    expect(src).toContain("8 小时封顶");
    expect(OFFLINE_CAP_SECONDS).toBe(12 * 3600);
  });
  it("prestige 注释/状态注释仍写 ×1.08 复利、点数公式 ^0.3（实现是 +75% 线性 / ^0.4）（P2）", () => {
    const p = read("src/engine/prestige.ts");
    const st = read("src/engine/state.ts");
    report.defects.push({ level: "P2", where: "src/engine/prestige.ts:8,42 / src/engine/state.ts:35", issue: "注释写「每点永久 ×1.08 复利」「1.08^points」「floor(3×(本局/1e8)^0.3)」，实现为 1+0.75×points 线性、^0.4；state.ts 注释同样写 ×1.08" });
    expect(p).toContain("×1.08");
    expect(st).toContain("×1.08");
    expect(p).toContain("^0.3");
  });
  it("events 注释写连胜「封顶 ×2」，实现 SURVIVE_STREAK_CAP=5 → ×1.5（P2）", () => {
    const e = read("src/engine/events.ts");
    report.defects.push({ level: "P2", where: "src/engine/events.ts:29,72,284", issue: "注释「封顶 ×2」，实现 1+0.1×min(n,5) = 封顶 ×1.5；同文件常量注释又写「封顶 ×1.5」" });
    expect(e).toContain("封顶 ×2");
    expect(surviveStreakMult(99)).toBe(1.5);
  });
  it("offline 注释写「日常 8h」「8h 封顶」，实现 12h（P2）", () => {
    const o = read("src/engine/offline.ts");
    report.defects.push({ level: "P2", where: "src/engine/offline.ts:11,27", issue: "注释「日常 8h」「8h 封顶」，实现 OFFLINE_CAP_SECONDS=12h" });
    expect(o).toContain("8h");
  });
  it("energy 注释写社交好感 +3，实现 +5（P2）", () => {
    const en = read("src/engine/energy.ts");
    report.defects.push({ level: "P2", where: "src/engine/energy.ts:87", issue: "注释「社交：全体同事好感 +3」，实现 +5（desc 也写 +5）" });
    expect(en).toContain("好感 +3");
  });
  it("精力存档重算 focus 写死 1.2，与 energy.ts 的 ×2 不一致（P1，见往返用例）", () => {
    const sv = read("src/engine/save.ts");
    const en = read("src/engine/energy.ts");
    report.defects.push({ level: "P1", where: "src/engine/save.ts:287-290", issue: "存档按 used 重算 boosted：focus 的 clickMult 用 1.2（energy.ts 用 2）、idleMult 漏掉 focus 的 1.08 → 刷新后「专注点击 ×2 / 挂机+8%」实际变成 ×1.2 / +0%" });
    expect(en).toContain('action === "focus" ? 2 : 1');
    expect(en).toContain('action === "focus" ? 1.08 : 1');
    expect(sv).toContain('if (a === "focus") energy.boosted.clickMult *= 1.2;');
    expect(sv).not.toContain('if (a === "focus") energy.boosted.clickMult *= 2;');
  });
  it("PRESTIGE_GAIN_PER_POINT=0.5 未被使用（死常量，P2）", () => {
    const ps = read("src/engine/prestige.ts").replace(/export const PRESTIGE_GAIN_PER_POINT[^\n]*\n/, "");
    expect(ps).not.toContain("PRESTIGE_GAIN_PER_POINT");
  });
  it("图鉴/总计常量：55 格 = 10 语录 + 45 彩蛋，与 UI 静态文案一致", () => {
    expect(MEME_QUOTES.length).toBe(10);
    expect(UPGRADES.length * 5).toBe(45);
    expect(TOTAL_ITEMS).toBe(55);
  });
});
void gain;
void idleIfHome;
void recruit;
void upgradeColleague;
void upgradeCostOf;
void UPGRADE_COEF;
void UPGRADE_BASE;
void missionSecondsFor;
void favorTier;
void emptyTalents;
void talentCostOf;
void TALENT_POINT_CAP;
void costOfTalent;
void TALENTS;
void addTalentPoints;
void buyDecor;
void DECOR_COMPLETE_BONUS;
void ENERGY_ACTIONS;
void ENERGY_PER_DAY;
void useEnergy;
void ensureEnergy;
void CARDS;
void emptyCardState;
void dailyReward;
void ensureDaily;
void onBossTap;
void finishGame;
void ARCADE_DAILY_LIMIT;
void onMemeTap;
void doClick;
void comboMultiplier;
void canPrestige;
void collectionCount;
void formatMoyu;
void serialize;
void restore;
void SAVE_KEY;
void UPGRADE_FLAVOR;
void dailyReward;
void 0;