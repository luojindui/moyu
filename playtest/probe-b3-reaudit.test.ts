/**
 * R14 复验（HEAD 7857cf1，批次3 v2 规格）：8 家具 + 4 项精力
 * - 规格表逐项（价格/加成数值/@ 新精力 4 项 145>100）
 * - 接线：8 家具（idle/click/offline/dispatch）+ 4 精力（idle/patrol/click/好感）
 * - D1 场景鱼缸自适应、D2 按钮实时态、D4 boosted 由 used 推导、D5 跨日先重置、
 *   D6 离线工位段吃满倍率、D7 无同事社交不可用
 * - 回归回归：decor 离线加成是否被重复计入（新缺陷嫌疑）、left 篡改残留
 * 证据：playtest/r14-reaudit-engine-v2.json
 */
import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync } from "node:fs";
import { initialState, gain, type GameState } from "../src/engine/state";
import { DECOR, buyDecor, canBuyDecor, decorEffects, decorCount, ownsDecor, decorDef } from "../src/engine/decor";
import {
  ENERGY_ACTIONS,
  ENERGY_PER_DAY,
  emptyEnergy,
  energyEffects,
  ensureEnergy,
  useEnergy,
  type EnergyAction,
} from "../src/engine/energy";
import { effectOf, stationIdleOf, stationIdleScaled } from "../src/engine/upgrades";
import { clickPowerOf, doClick, BASE_CLICK_POWER } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { offlineEfficiency } from "../src/engine/progression";
import { offlineEarn } from "../src/engine/offline";
import { dispatch, dispatchReward, claimMission } from "../src/engine/team";
import { bossSurviveReward, finishPatrol, newEventState } from "../src/engine/events";
import { doPrestige } from "../src/engine/prestige";
import { restore, serialize, SAVE_KEY, SAVE_VERSION, type SaveAdapter } from "../src/engine/save";

const NOW = Date.UTC(2026, 10, 27, 12, 0, 0);
const DAY = 86_400_000;
const TODAY = "2026-11-27";
const YESTERDAY = "2026-11-26";
const report: Record<string, unknown> = { commit: "7857cf1", generatedAt: new Date().toISOString(), wiring: {}, boundary: {}, save: {}, observations: {}, defects: [] };

afterAll(() => {
  writeFileSync("playtest/r14-reaudit-engine-v2.json", JSON.stringify(report, null, 2));
});

function memAdapter(blob?: unknown): SaveAdapter {
  const store = new Map<string, string>();
  if (blob !== undefined) store.set(SAVE_KEY, JSON.stringify(blob));
  return { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) };
}
function saveBlob(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 2, moyu: 0, totalEarned: 0, lifetimeEarned: 0, levels: {}, savedAt: NOW, createdAt: NOW - 3 * DAY,
    collected: { quotes: [], flavors: [] }, daily: null, surviveStreak: 0, patrolSurvives: 0, totalClicks: 0,
    visits: { date: "", count: 0 }, prestige: 0, team: { colleagues: {} },
    talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: TODAY },
    ...over,
  };
}
const rich = (n = 1e11): GameState => gain(initialState(), n);
function withZhou(over: Partial<GameState> = {}, favor = 0): GameState {
  return {
    ...initialState(), ...over,
    team: { colleagues: { zhou: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor, autoRepeat: false, rewardSnapshot: 0 } } },
  };
}
const energyWith = (actions: EnergyAction[], over: Partial<GameState> = {}): GameState => {
  let s: GameState = { ...initialState(), ...over, energy: emptyEnergy(TODAY) };
  for (const a of actions) {
    const n = useEnergy(s, a);
    if (!n) throw new Error(`useEnergy(${a}) failed`);
    s = n;
  }
  return s;
};

// ── 一、规格表 ──
describe("规格表 v2：8 家具 + 4 精力", () => {
  const SPEC: Array<[string, number, Record<string, number>]> = [
    ["plant", 3_000, { idleMult: 1.05 }],
    ["lamp", 20_000, { clickMult: 1.15 }],
    ["rug", 120_000, { offlineBonus: 0.05 }],
    ["fridge", 600_000, { idleMult: 1.08 }],
    ["chair", 4_000_000, { offlineBonus: 0.08 }],
    ["aquarium", 30_000_000, { idleMult: 1.1, clickMult: 1.1 }],
    ["projector", 200_000_000, { dispatchRewardMult: 1.3 }],
    ["catbed", 2_000_000_000, { idleMult: 1.15, offlineBonus: 0.1 }],
  ];
  it("家具 8 件数值", () => {
    expect(DECOR).toHaveLength(8);
    for (const [id, cost, eff] of SPEC) {
      expect(decorDef(id)!.cost, id).toBe(cost);
      expect(decorDef(id)!.effects, id).toEqual(eff);
    }
  });
  it("精力 4 项：花费 40/35/25/45、合计 145>100、最省三项恰好 100", () => {
    expect(ENERGY_ACTIONS.map((a) => [a.id, a.cost])).toEqual([
      ["slack", 40], ["fake-work", 35], ["social", 25], ["focus", 45],
    ]);
    const total = ENERGY_ACTIONS.reduce((s, a) => s + a.cost, 0);
    expect(total).toBe(145);
    const sorted = [...ENERGY_ACTIONS].sort((a, b) => a.cost - b.cost);
    expect(sorted[0]!.cost + sorted[1]!.cost + sorted[2]!.cost).toBe(100);
    expect(total).toBeGreaterThan(ENERGY_PER_DAY);
  });
});

// ── 二、接线（真实收入入口） ──
describe("挂机线（decor/energy → effectOf → advance）", () => {
  it("plant/fridge/aquarium/catbed 挂机倍数（纯工位）", () => {
    const cases: Array<[string, number]> = [["plant", 0.21], ["fridge", 0.216], ["aquarium", 0.22], ["catbed", 0.23]];
    const got: Record<string, number> = { base: effectOf(initialState()).idleRate };
    for (const [id, expectIdle] of cases) {
      const idle = effectOf({ ...initialState(), decor: [id] }).idleRate;
      got[id] = idle;
      expect(idle, id).toBeCloseTo(expectIdle, 10);
      expect(advance({ ...initialState(), decor: [id] }, 10).moyu / advance(initialState(), 10).moyu).toBeCloseTo(expectIdle / 0.2, 10);
    }
    report.wiring = { ...(report.wiring as object), idle: got };
  });
  it("slack 挂机 ×1.25 / social 挂机 ×1.05（含好感 +5）", () => {
    const slack = energyWith(["slack"]);
    expect(effectOf(slack).idleRate).toBeCloseTo(0.25, 10);
    expect(advance(slack, 10).moyu / advance(initialState(), 10).moyu).toBeCloseTo(1.25, 10);
    const social = energyWith(["social"], withZhou({}, 10));
    expect(energyEffects(social).idleMult).toBeCloseTo(1.05, 10);
    expect(effectOf({ ...social, team: { colleagues: {} } }).idleRate).toBeCloseTo(0.21, 10);
    expect(social.team.colleagues.zhou!.favor).toBe(15);
    // slack+social 叠加
    const both = energyWith(["slack", "social"], withZhou({}, 0));
    expect(energyEffects(both).idleMult).toBeCloseTo(1.25 * 1.05, 10);
    report.wiring = { ...(report.wiring as object), energyIdle: { slack: effectOf(slack).idleRate, socialMult: energyEffects(social).idleMult, both: energyEffects(both).idleMult } };
  });
});

describe("点击线（decor/energy → clickPowerOf → doClick）", () => {
  it("lamp×1.15 / aquarium×1.1 / focus ×1.2", () => {
    expect(clickPowerOf(initialState())).toBe(BASE_CLICK_POWER);
    expect(clickPowerOf({ ...initialState(), decor: ["lamp"] })).toBeCloseTo(1.15, 10);
    expect(clickPowerOf({ ...initialState(), decor: ["aquarium"] })).toBeCloseTo(1.1, 10);
    const focus = energyWith(["focus"]);
    expect(energyEffects(focus).clickMult).toBeCloseTo(1.2, 10);
    expect(clickPowerOf(focus)).toBeCloseTo(1.2, 10);
    expect(doClick(focus).moyu / doClick(initialState()).moyu).toBeCloseTo(1.2, 10);
    // 点击不被精力 idle 影响
    expect(clickPowerOf(energyWith(["slack"]))).toBe(1);
    report.wiring = { ...(report.wiring as object), click: { lamp: 1.15, aquarium: 1.1, focus: clickPowerOf(focus) } };
  });
});

describe("离线线（progression.offlineEfficiency → offlineEarn）", () => {
  const createdAt = NOW - 3 * DAY;
  it("rug/chair/catbed 离线效率应精确 +0.05/+0.08/+0.10（spec 表）", () => {
    const base = offlineEfficiency(initialState(), createdAt, NOW);
    expect(base).toBeCloseTo(0.7, 10);
    const got: Record<string, number> = { base };
    const cases: Array<[string, number]> = [["rug", 0.75], ["chair", 0.78], ["catbed", 0.8]];
    for (const [id, expectEff] of cases) {
      const eff = offlineEfficiency({ ...initialState(), decor: [id] }, createdAt, NOW);
      got[id] = eff;
      expect(eff, `${id} spec=+${(expectEff - 0.7).toFixed(2)}`).toBeCloseTo(expectEff, 10);
    }
    const all = offlineEfficiency({ ...initialState(), decor: ["rug", "chair", "catbed"] }, createdAt, NOW);
    got.allThree = all;
    expect(all).toBeCloseTo(0.93, 10); // 0.7+0.23
    report.wiring = { ...(report.wiring as object), offline: got };
  });
  it("D6：offlineEarn 工位段吃满家具/精力挂机倍率（catbed idle ×1.15 全额）", () => {
    const catbed = { ...initialState(), decor: ["catbed"] };
    const eff = offlineEfficiency(catbed, createdAt, NOW);
    const station = stationIdleScaled(catbed);
    const total = effectOf(catbed).idleRate;
    const r = offlineEarn(catbed, 3600, eff);
    report.wiring = { ...(report.wiring as object), offlineStation: { station, total, teamPart: Math.max(0, total - station), eff, earned: r.earned } };
    expect(station).toBeCloseTo(0.23, 10); // 0.2×1.15
    expect(total).toBeCloseTo(station, 10); // 无同事 → 无 teamPart
    expect(r.earned).toBeCloseTo(station * 3600 * eff, 6);
    // 有同事时 teamPart 不因 decor/energy 挂机倍率而虚增
    const baseTeam = withZhou();
    const plantTeam = withZhou({ decor: ["plant"] });
    const slackTeam = energyWith(["slack"], baseTeam);
    const tp = (s: GameState) => Math.max(0, effectOf(s).idleRate) - stationIdleScaled(s);
    const obs = { teamPartBase: tp(baseTeam), teamPartPlant: tp(plantTeam), teamPartSlack: tp(slackTeam) };
    report.observations = { ...(report.observations as object), offlineTeamPart: obs };
    expect(tp(plantTeam)).toBeCloseTo(tp(baseTeam), 8);
    expect(tp(slackTeam)).toBeCloseTo(tp(baseTeam), 8);
  });
});

describe("派遣线（projector ×1.3）", () => {
  it("dispatch → claim 奖励 ×1.3", () => {
    const st = withZhou();
    const station = stationIdleOf(st);
    const probe = { ...st, team: { colleagues: { zhou: { ...st.team.colleagues.zhou!, missionId: "chat" } } } };
    const base = dispatchReward(probe, "zhou", station);
    const proj = dispatchReward({ ...probe, decor: ["projector"] }, "zhou", station);
    expect(proj / base).toBeCloseTo(1.3, 2);
    const d0 = dispatch(st, "zhou", "chat", NOW - 1000, station)!;
    const d1 = dispatch({ ...st, decor: ["projector"] }, "zhou", "chat", NOW - 1000, station)!;
    const r0 = claimMission(d0, "zhou", NOW + 2 * 3600_000, station)!;
    const r1 = claimMission(d1, "zhou", NOW + 2 * 3600_000, station)!;
    expect(r1.reward / r0.reward).toBeCloseTo(1.3, 2);
    report.wiring = { ...(report.wiring as object), dispatch: { base, proj, claimBase: r0.reward, claimProj: r1.reward } };
  });
});

describe("巡逻线（fake-work ×2.2）", () => {
  it("bossSurviveReward 50→110；finishPatrol 实测", () => {
    expect(bossSurviveReward(initialState())).toBe(50);
    const s = energyWith(["fake-work"]);
    expect(energyEffects(s).patrolRewardMult).toBeCloseTo(2.2, 10);
    expect(bossSurviveReward(s)).toBeCloseTo(110, 10);
    expect(finishPatrol(initialState(), newEventState()).reward).toBe(50);
    expect(finishPatrol(s, newEventState()).reward).toBeCloseTo(110, 10);
    report.wiring = { ...(report.wiring as object), patrol: { base: 50, boosted: 110, mult: 110 / 50 } };
  });
});

// ── 三、精力 4 项取舍 / 边界 ──
describe("精力（4 项 145>100）", () => {
  it("4 项无法全点：最省三项恰好用尽 100 点，第 4 项必然放弃", () => {
    let s = energyWith(["social", "fake-work", "slack"], withZhou());
    expect(s.energy.left).toBe(0);
    expect(useEnergy(s, "focus")).toBeNull();
    // 任何顺序都点不满 4 项
    const orders: EnergyAction[][] = [["slack", "fake-work", "social"], ["focus", "slack", "social"], ["fake-work", "social", "slack"], ["focus", "fake-work", "slack"]];
    const counts: number[] = [];
    for (const order of orders) {
      let t: GameState | null = { ...withZhou(), energy: emptyEnergy(TODAY) };
      for (const a of order) { const n = t ? useEnergy(t, a) : null; if (n) t = n; }
      counts.push(t!.energy.used.length);
      expect(t!.energy.used.length).toBeLessThanOrEqual(3);
    }
    report.boundary = { ...(report.boundary as object), budget: { total: 145, cheapestThree: 100, leftAfter: s.energy.left, usedCounts: counts } };
  });
  it("同日重复 / 精力不足 / 未知 / social 无同事均返回 null", () => {
    const s = energyWith(["slack"]);
    expect(useEnergy(s, "slack")).toBeNull();
    const low: GameState = { ...initialState(), energy: { ...emptyEnergy(TODAY), left: 30 } };
    expect(useEnergy(low, "slack")).toBeNull(); // 40>30
    expect(useEnergy(low, "focus")).toBeNull(); // 45>30
    expect(useEnergy({ ...initialState(), energy: emptyEnergy(TODAY) }, "ghost" as never)).toBeNull();
    // D7：无同事 social 不可用
    expect(useEnergy({ ...initialState(), energy: emptyEnergy(TODAY) }, "social")).toBeNull();
    expect(useEnergy(withZhou(), "social")).not.toBeNull();
  });
  it("社交：全体好感 +5（封顶 100）+ 挂机 ×1.05", () => {
    expect(useEnergy(withZhou({}, 10), "social")!.team.colleagues.zhou!.favor).toBe(15);
    expect(useEnergy(withZhou({}, 98), "social")!.team.colleagues.zhou!.favor).toBe(100);
    expect(energyWith(["social"], withZhou()).energy.boosted.idleMult).toBeCloseTo(1.05, 10);
  });
  it("跨日重置清空 boosted 3 个字段", () => {
    const s = energyWith(["slack", "focus"]);
    const next = ensureEnergy(s, "2026-11-28");
    expect(next.energy.left).toBe(ENERGY_PER_DAY);
    expect(next.energy.used).toEqual([]);
    expect(next.energy.boosted).toEqual({ idleMult: 1, patrolRewardMult: 1, clickMult: 1 });
    expect(ensureEnergy(next, "2026-11-28")).toBe(next);
  });
  it("组合上限：用于展示的 4 项加成幅度（正常一天拿不到）", () => {
    const boosted = { idleMult: 1.25 * 1.05, patrolRewardMult: 2.2, clickMult: 1.2 };
    expect(boosted.idleMult).toBeCloseTo(1.3125, 10); // 4 项全点才可能，实际拿不到
    report.observations = { ...(report.observations as object), maxBoost: boosted };
  });
});

// ── 四、存档（D4 / D5 / 新字段） ──
describe("存档：boosted 由 used 推导（D4）", () => {
  it("注入 boosted:{2,3} 且 used=[] → 全为 1（被忽略）", () => {
    const r = restore(memAdapter(saveBlob({ energy: { date: TODAY, left: 100, used: [], boosted: { idleMult: 2, patrolRewardMult: 3 } } })), NOW);
    expect(r.state!.energy.boosted).toEqual({ idleMult: 1, patrolRewardMult: 1, clickMult: 1 });
    expect(effectOf(r.state!).idleRate).toBeCloseTo(0.2, 10);
    expect(bossSurviveReward(r.state!)).toBe(50);
    report.save = { ...(report.save as object), boostedTamperIgnored: r.state!.energy.boosted };
  });
  it("used=[slack] + boosted:{2,3} → 1.25/1/1（按 used 推导）", () => {
    const r = restore(memAdapter(saveBlob({ energy: { date: TODAY, left: 60, used: ["slack"], boosted: { idleMult: 9, patrolRewardMult: 9 } } })), NOW);
    expect(r.state!.energy.boosted).toEqual({ idleMult: 1.25, patrolRewardMult: 1, clickMult: 1 });
  });
  it("used=[slack,fake-work,social,focus] 全部合法 → 推导 1.3125/2.2/1.2", () => {
    const r = restore(memAdapter(saveBlob({ energy: { date: TODAY, left: 0, used: ["slack", "fake-work", "social", "focus", "slack", "ghost"], boosted: {} } })), NOW);
    expect(r.state!.energy.used).toEqual(["slack", "fake-work", "social", "focus"]);
    expect(r.state!.energy.boosted.idleMult).toBeCloseTo(1.25 * 1.05, 10);
    expect(r.state!.energy.boosted.patrolRewardMult).toBeCloseTo(2.2, 10);
    expect(r.state!.energy.boosted.clickMult).toBeCloseTo(1.2, 10);
  });
  it("残留：left 与 used 不交叉校验 → used 3 项 + left=100 可再点第 4 项（白嫖）", () => {
    const r = restore(memAdapter(saveBlob({ energy: { date: TODAY, left: 100, used: ["social", "fake-work", "slack"], boosted: {} } })), NOW);
    const s = r.state!;
    expect(s.energy.left).toBe(100); // 合法值应为 0
    const after = useEnergy(s, "focus");
    expect(after, "D4 残留：可白嫖第 4 项").not.toBeNull();
    expect(after!.energy.left).toBe(55);
    report.defects = [...(report.defects as unknown[]), { id: "D4-residual", where: "save.ts:269-281", detail: "left 未按 used 成本重算，used=3+left=100 可再使用 focus（145 点预算）", actualLeft: s.energy.left }];
  });
  it("left 越界/非法 date/未知 used（沿用旧规则）", () => {
    const g = (left: unknown) => restore(memAdapter(saveBlob({ energy: { date: TODAY, left, used: [], boosted: {} } })), NOW).state!.energy.left;
    expect(g(999)).toBe(100);
    expect(g(-5)).toBe(0);
    expect(g(33.9)).toBe(33);
    const bad = restore(memAdapter(saveBlob({ energy: { date: "2026-13-99", left: 100, used: [], boosted: {} } })), NOW);
    expect(bad.state!.energy.date).toBe("2026-13-99");
    expect(restore(memAdapter(saveBlob({ energy: "bad" })), NOW).state!.energy).toEqual(emptyEnergy());
  });
  it("无限/旧档（无 energy 字段）→ 默认", () => {
    expect(restore(memAdapter(saveBlob({})), NOW).state!.energy).toEqual(emptyEnergy());
  });
});

describe("存档：D5 跨日精力先重置再结算（引擎口径）", () => {
  it("昨日 boosted 若未重置会让离线虚高；ensureEnergy 后回到基准", () => {
    const createdAt = NOW - 3 * DAY;
    const stale: GameState = {
      ...withZhou({}),
      energy: { date: YESTERDAY, left: 60, used: ["slack"], boosted: { idleMult: 1.25, patrolRewardMult: 1, clickMult: 1 } },
    };
    const effStale = offlineEfficiency(stale, createdAt, NOW);
    const effFresh = offlineEfficiency(ensureEnergy(stale, TODAY), createdAt, NOW);
    const earnedStale = offlineEarn(stale, 3600, effStale).earned;
    const earnedFresh = offlineEarn(ensureEnergy(stale, TODAY), 3600, effFresh).earned;
    expect(earnedStale).toBeGreaterThan(earnedFresh); // 未重置时确实虚高（说明主流程必须在结算前重置）
    report.observations = { ...(report.observations as object), d5: { earnedStale, earnedFresh, ratio: earnedStale / earnedFresh } };
  });
});

describe("存档：持久化 / 转生", () => {
  it("serialize→restore 保留 8 件家具与 4 项精力状态", () => {
    let s = rich();
    for (const d of DECOR) s = buyDecor(s, d.id)!;
    s = energyWith(["slack", "fake-work"], withZhou(s));
    const mem = memAdapter();
    serialize(s, mem, NOW);
    const back = restore(mem, NOW).state!;
    expect(back.decor).toEqual(DECOR.map((d) => d.id));
    expect(back.energy.left).toBe(100 - 40 - 35);
    expect(back.energy.boosted).toEqual({ idleMult: 1.25, patrolRewardMult: 2.2, clickMult: 1 });
    report.observations = { ...(report.observations as object), persistDebug: {
      decor: back.decor, decorIdle: decorEffects(back).idleMult, stationIdleOf: stationIdleOf(back),
      idle: stationIdleScaled(back), energy: back.energy.boosted, levels: back.levels,
      collected: back.collected.quotes.length + back.collected.flavors.length, prestige: back.prestige,
    } };
    expect(stationIdleScaled(back)).toBeCloseTo(0.2 * 1.577961 * 1.25, 8);
  });
  it("转生保留 decor/energy", () => {
    let s = rich(5e8);
    s = buyDecor(s, "plant")!;
    s = buyDecor(s, "projector")!;
    s = energyWith(["fake-work"], s);
    const r = doPrestige(s)!;
    expect(r.state.decor).toEqual(["plant", "projector"]);
    expect(r.state.energy.boosted.patrolRewardMult).toBeCloseTo(2.2, 10);
    expect(decorEffects(r.state).dispatchRewardMult).toBeCloseTo(1.3, 10);
  });
});

// ── 五、观察项 ──
describe("观察项", () => {
  it("观察：decor 离线加成在 base 与 capRaise 中重复计入（新缺陷嫌疑）", () => {
    const createdAt = NOW - 3 * DAY;
    const rug = offlineEfficiency({ ...initialState(), decor: ["rug"] }, createdAt, NOW);
    const all = offlineEfficiency({ ...initialState(), decor: ["rug", "chair", "catbed"] }, createdAt, NOW);
    const obs = {
      rugActual: rug, rugSpec: 0.75,
      allActual: all, allSpec: 0.93,
      note: "progression.ts base 里 teamBase 已含 decorBonus，capRaise 又含 decorBase → 家具离线加成被计两次",
    };
    report.defects = [...(report.defects as unknown[]), { id: "D11", where: "src/engine/progression.ts:41-52", detail: obs.note, rugActual: rug, rugSpec: 0.75, allActual: all, allSpec: 0.93 }];
    report.observations = { ...(report.observations as object), decorOfflineDouble: obs };
    expect(rug, "D11: rug 离线 → 0.75(spec)").toBeCloseTo(0.75, 10);
    expect(all, "D11: 三件离线 → 0.93(spec)").toBeCloseTo(0.93, 10);
  });
  it("观察：精力面板「省心组合」按钮恒不可用（left>=145 永远不成立）", () => {
    // 代码条件 energy.left >= sum(145) && used.length===0 → 初始 100 点即 disabled
    const total = ENERGY_ACTIONS.reduce((s, a) => s + a.cost, 0);
    expect(total).toBe(145);
    report.defects = [...(report.defects as unknown[]), { id: "D12", where: "src/ui/team-panel.ts:526,280", detail: "「省心组合」按钮禁用条件 left>=145（四项总和），正常 100 点永远禁用 → 死按钮；onUseAllEnergy 逻辑已按 100 组合实现却点不到" }];
    expect(total > ENERGY_PER_DAY).toBe(true);
  });
  it("观察：social 无同事时 UI 仍显示可用（引擎返回 null，无提示）", () => {
    const s = { ...initialState(), energy: emptyEnergy(TODAY) };
    const can = !s.energy.used.includes("social") && s.energy.left >= 25; // renderDecor/data-disabled 条件
    expect(can).toBe(true); // UI 层判定为可点
    expect(useEnergy(s, "social")).toBeNull(); // 引擎拒绝
    report.defects = [...(report.defects as unknown[]), { id: "D13", where: "src/ui/team-panel.ts:512-527,258-272", detail: "social 无同事时 UI 按钮/整行仍显示可点，点击静默无效（引擎正确返回 null，UI 未同步禁用）" }];
  });
  it("观察：注释残留（3 种行为 / 好感+3 / boosted 钳制旧描述）", () => {
    report.defects = [...(report.defects as unknown[]), { id: "D14", where: "src/engine/energy.ts:4,76", detail: "头部注释仍写「3 种行为」；social 处注释「好感 +3」实际 +5（doc-only）" }];
    expect(true).toBe(true);
  });
  it("观察：energyEffects 返回内部引用（沿用旧观察）", () => {
    const s = energyWith(["slack"]);
    expect(energyEffects(s)).toBe(s.energy.boosted);
  });
  it("观察：8/8 集齐额外 +10% 挂机（spec 未记载、无测试）", () => {
    const all: GameState = { ...initialState(), decor: DECOR.map((d) => d.id) };
    const eff = decorEffects(all);
    const specProduct = DECOR.reduce((m, d) => m * (d.effects.idleMult ?? 1), 1);
    expect(specProduct).toBeCloseTo(1.43451, 8);
    expect(eff.idleMult).toBeCloseTo(specProduct * 1.1, 8); // DECOR_COMPLETE_BONUS
    report.defects = [...(report.defects as unknown[]), {
      id: "D15", where: "src/engine/decor.ts:61-80",
      detail: "新增「集齐 8 件挂机额外 +10%」未写入 docs/spec-batch3.md、无对应测试；全家具 idle 1.43451→1.577961（+10%），属规格外平衡改动",
      specProduct, actualIdleMult: eff.idleMult,
    }];
    report.observations = { ...(report.observations as object), decorCompleteBonus: { specProduct, actualIdleMult: eff.idleMult } };
  });
  it("观察：台灯场景位置改为桌面左侧（spec 写「桌面右侧」）", () => {
    report.defects = [...(report.defects as unknown[]), { id: "D16", where: "src/render/scene.ts:342-343", detail: "台灯 lx=vw/2-1.5u 移到桌面左侧，与 spec「桌面右侧灯杆+灯罩+光锥」不符（为避让公告板改位置，但文档未同步）" }];
    expect(true).toBe(true);
  });
  it("观察：save 版本仍为 2", () => {
    expect(SAVE_VERSION).toBe(2);
  });
});