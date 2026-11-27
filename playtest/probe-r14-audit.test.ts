/**
 * R14 审计党：批次 3（工位经营 8 家具 + 每日精力）引擎级验证
 * - 规格表逐项断言（价格/加成数值）
 * - 12 项效果「真实收入入口」接线断言（advance/doClick/offlineEarn/dispatch→claimMission/finishPatrol/useEnergy）
 * - 边界：重复购买、未知 id、钱不足、精力不足、重复使用、跨日重置
 * - 存档净化：left=999 / used=["ghost"] / decor 重复/未知 / boosted 钳制 / 旧档 / 转生保留
 * 输出证据：playtest/r14-audit-engine.json
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
} from "../src/engine/energy";
import { effectOf, stationIdleOf } from "../src/engine/upgrades";
import { clickPowerOf, doClick, BASE_CLICK_POWER } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { offlineEfficiency } from "../src/engine/progression";
import { offlineEarn } from "../src/engine/offline";
import { dispatch, dispatchReward, claimMission, canDispatch } from "../src/engine/team";
import { bossSurviveReward, finishPatrol, newEventState } from "../src/engine/events";
import { doPrestige } from "../src/engine/prestige";
import { restore, serialize, SAVE_KEY, SAVE_VERSION, type SaveAdapter } from "../src/engine/save";

const NOW = Date.UTC(2026, 10, 27, 12, 0, 0);
const DAY = 86_400_000;
const TODAY = "2026-11-27";
const YESTERDAY = "2026-11-26";
const report: Record<string, unknown> = { generatedAt: new Date().toISOString(), wiring: {}, boundary: {}, save: {}, observations: {} };

afterAll(() => {
  writeFileSync("playtest/r14-audit-engine.json", JSON.stringify(report, null, 2));
});

function memAdapter(blob?: unknown, rawOverride?: string): SaveAdapter {
  const store = new Map<string, string>();
  if (rawOverride !== undefined) store.set(SAVE_KEY, rawOverride);
  else if (blob !== undefined) store.set(SAVE_KEY, JSON.stringify(blob));
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
}

function saveBlob(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 2,
    moyu: 0,
    totalEarned: 0,
    lifetimeEarned: 0,
    levels: {},
    savedAt: NOW,
    createdAt: NOW - 3 * DAY,
    collected: { quotes: [], flavors: [] },
    daily: null,
    surviveStreak: 0,
    patrolSurvives: 0,
    totalClicks: 0,
    visits: { date: "", count: 0 },
    prestige: 0,
    team: { colleagues: {} },
    talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: TODAY },
    ...over,
  };
}

const rich = (n = 1e11): GameState => gain(initialState(), n);

/** 有老周（1 级、未派遣）的即时状态 */
function withZhou(over: Partial<GameState> = {}, favor = 0): GameState {
  return {
    ...initialState(),
    ...over,
    team: { colleagues: { zhou: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor, autoRepeat: false, rewardSnapshot: 0 } } },
  };
}

function energyState(action: "slack" | "fake-work" | "social", over: Partial<GameState> = {}): GameState {
  const s = useEnergy({ ...initialState(), ...over, energy: emptyEnergy(TODAY) }, action);
  if (!s) throw new Error("useEnergy failed");
  return s;
}

// ────────────────────────────── 一、规格表数值 ──────────────────────────────
describe("规格表：8 件家具价格与加成数值逐项对齐", () => {
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
  it("8 件、id 唯一、价格/效果与 spec-batch3 一致", () => {
    expect(DECOR).toHaveLength(8);
    expect(new Set(DECOR.map((d) => d.id)).size).toBe(8);
    for (const [id, cost, eff] of SPEC) {
      const def = decorDef(id)!;
      expect(def, `missing ${id}`).toBeTruthy();
      expect(def.cost, `${id} cost`).toBe(cost);
      expect(def.effects, `${id} effects`).toEqual(eff);
      expect(def.shape, `${id} shape`).toBe(id);
    }
  });
});

// ────────────────────────────── 二、12 项效果接线（真实入口） ──────────────────────────────
describe("挂机线（upgrades.effectOf → tick.advance 实际收益）", () => {
  it("plant/fridge/aquarium/catbed 挂机：纯工位基线 0.2/s 的倍数精确", () => {
    const base = effectOf(initialState()).idleRate;
    expect(base).toBeCloseTo(0.2, 10);
    const cases: Array<[string, number]> = [
      ["plant", 0.2 * 1.05],
      ["fridge", 0.2 * 1.08],
      ["aquarium", 0.2 * 1.1],
      ["catbed", 0.2 * 1.15],
    ];
    const got: Record<string, number> = { base };
    for (const [id, expected] of cases) {
      const s = { ...initialState(), decor: [id] };
      const idle = effectOf(s).idleRate;
      got[id] = idle;
      expect(idle, `${id} idle`).toBeCloseTo(expected, 10);
      // 实际 tick 收益（10 秒）
      const before = advance(initialState(), 10).moyu;
      const after = advance(s, 10).moyu;
      expect(after / before, `${id} tick ratio`).toBeCloseTo(expected / 0.2, 10);
    }
    report.wiring = { ...(report.wiring as object), idle: got };
  });
});

describe("点击线（actions.clickPowerOf → doClick 实际收入）", () => {
  it("lamp ×1.15 / aquarium ×1.1 / 双件 ×1.265", () => {
    const base = clickPowerOf(initialState());
    expect(base).toBe(BASE_CLICK_POWER);
    const lamp = clickPowerOf({ ...initialState(), decor: ["lamp"] });
    expect(lamp).toBeCloseTo(1.15, 10);
    const aq = clickPowerOf({ ...initialState(), decor: ["aquarium"] });
    expect(aq).toBeCloseTo(1.1, 10);
    const both = clickPowerOf({ ...initialState(), decor: ["lamp", "aquarium"] });
    expect(both).toBeCloseTo(1.15 * 1.1, 10);
    // doClick 实际入账（无连击）
    const d0 = doClick(initialState());
    const dLamp = doClick({ ...initialState(), decor: ["lamp"] });
    expect(dLamp.moyu / d0.moyu).toBeCloseTo(1.15, 10);
    report.wiring = { ...(report.wiring as object), click: { base, lamp, aquarium: aq, lampAquarium: both } };
  });
});

describe("离线线（progression.offlineEfficiency → offlineEarn 实际收益）", () => {
  it("rug +0.05 / chair +0.08 / catbed +0.1 精确注入离线效率", () => {
    const createdAt = NOW - 3 * DAY;
    const base = offlineEfficiency(initialState(), createdAt, NOW);
    expect(base).toBeCloseTo(0.7, 10);
    const cases: Array<[string, number]> = [
      ["rug", 0.75],
      ["chair", 0.78],
      ["catbed", 0.8],
    ];
    const got: Record<string, number> = { base };
    for (const [id, expected] of cases) {
      const s = { ...initialState(), decor: [id] };
      const eff = offlineEfficiency(s, createdAt, NOW);
      got[id] = eff;
      expect(eff, `${id} offlineEfficiency`).toBeCloseTo(expected, 10);
      // offlineEarn 口径：stationIdleScaled 全额 + (effectOf.idleRate - stationIdleScaled)×50%
      // catbed 的 idle×1.15 会被算进 teamPart 再打五折（观察项 offlineMixedIdle）
      const station = stationIdleOf(s) * 1; // 无等级/天赋/图鉴时 == stationIdleScaled
      const total = effectOf(s).idleRate;
      const earned = offlineEarn(s, 3600, eff).earned;
      expect(earned, `${id} offlineEarn`).toBeCloseTo((station + Math.max(0, total - station) * 0.5) * 3600 * expected, 6);
    }
    // 观察：挂机家具的 idleMult 只有一半进入离线结算（catbed 实测）
    const catbed = { ...initialState(), decor: ["catbed"] };
    const rateCat = offlineEfficiency(catbed, createdAt, NOW);
    const earnedCat = offlineEarn(catbed, 3600, rateCat).earned;
    const onlyOfflineRate = 0.2 * 3600 * rateCat;
    report.observations = {
      ...(report.observations as object),
      offlineMixedIdle: {
        note: "offlineEarn 把 effectOf 中非 stationIdleScaled 的挂机加成当作 teamPart，按 50% 折算；catbed idle×1.15 因此额外泄漏 +7.5% 离线收益",
        catbedEarned: earnedCat,
        ifOnlyOfflineBonus: onlyOfflineRate,
        leakRatio: earnedCat / onlyOfflineRate,
      },
    };
    report.wiring = { ...(report.wiring as object), offline: got };
  });
});

describe("派遣线（team.dispatchReward → dispatch 快照 → claimMission 实际奖励）", () => {
  it("projector ×1.3 精确进入派遣奖励", () => {
    const st = withZhou();
    const station = stationIdleOf(st);
    const probe = { ...st, team: { colleagues: { zhou: { ...st.team.colleagues.zhou!, missionId: "chat" } } } };
    const base = dispatchReward(probe, "zhou", station);
    const withProj = { ...probe, decor: ["projector"] };
    const boosted = dispatchReward(withProj, "zhou", station);
    expect(base).toBeGreaterThan(0);
    expect(boosted / base).toBeCloseTo(1.3, 2);
    expect(boosted).toBe(Math.floor((boosted / 1.3) * 1.3)); // 记录整数口径

    // 走真实 dispatch → claimMission
    const dispatched = dispatch(st, "zhou", "chat", NOW - 1000, station)!;
    expect(canDispatch(st, "zhou")).toBe(true);
    expect(canDispatch(dispatched, "zhou")).toBe(false);
    const r0 = claimMission(dispatched, "zhou", NOW + 2 * 3600_000, station)!;
    const dispatchedP = dispatch({ ...st, decor: ["projector"] }, "zhou", "chat", NOW - 1000, station)!;
    const r1 = claimMission(dispatchedP, "zhou", NOW + 2 * 3600_000, station)!;
    expect(r1.reward / r0.reward).toBeCloseTo(1.3, 2);
    // 派遣后买投影仪不回溯（快照口径，记录）
    const late = { ...dispatched, decor: ["projector"] };
    const r2 = claimMission(late, "zhou", NOW + 2 * 3600_000, station)!;
    expect(r2.reward).toBe(r0.reward);
    report.wiring = { ...(report.wiring as object), dispatch: { base, withProjector: boosted, ratio: boosted / base, realClaimBase: r0.reward, realClaimProjector: r1.reward } };
  });
});

describe("精力线：slack → 挂机 ×1.25（effectOf + advance）；fake-work → 巡逻奖 ×1.8（finishPatrol）", () => {
  it("slack 挂机倍率", () => {
    const base = effectOf(initialState()).idleRate;
    const s = useEnergy({ ...initialState(), energy: emptyEnergy(TODAY) }, "slack")!;
    expect(energyEffects(s).idleMult).toBeCloseTo(1.25, 10);
    expect(effectOf(s).idleRate).toBeCloseTo(base * 1.25, 10);
    expect(advance(s, 10).moyu / advance(initialState(), 10).moyu).toBeCloseTo(1.25, 10);
    // 精力不应影响点击
    expect(clickPowerOf(s)).toBe(clickPowerOf(initialState()));
    report.wiring = { ...(report.wiring as object), energySlack: { idle: effectOf(s).idleRate, mult: 1.25 } };
  });

  it("fake-work 巡逻奖励 ×1.8（hold/type/blitz/choice 四条结算路径共用 bossSurviveReward）", () => {
    const base = bossSurviveReward(initialState());
    expect(base).toBe(50); // max(50, 4×0.2)=50
    const s = useEnergy({ ...initialState(), energy: emptyEnergy(TODAY) }, "fake-work")!;
    expect(bossSurviveReward(s)).toBe(90);
    // finishPatrol（hold 变体）实际结算
    const es0 = newEventState();
    const es1 = newEventState();
    const r0 = finishPatrol(initialState(), es0).reward;
    const r1 = finishPatrol(s, es1).reward;
    expect(r0).toBe(50);
    expect(r1).toBe(90);
    report.wiring = { ...(report.wiring as object), energyFakeWork: { base: r0, boosted: r1, mult: r1 / r0 } };
  });

  it("social 全体好感 +3（含 100 封顶）", () => {
    const s = useEnergy(withZhou(undefined, 10), "social")!;
    expect(s.team.colleagues.zhou!.favor).toBe(13);
    const capped = useEnergy(withZhou(undefined, 99), "social")!;
    expect(capped.team.colleagues.zhou!.favor).toBe(100);
    report.wiring = { ...(report.wiring as object), energySocial: { favor10to: 13, favor99to: 100 } };
  });

  it("全 8 家具汇总：idle 1.43451 / click 1.265 / offline +0.23 / dispatch 1.3", () => {
    const all: GameState = { ...initialState(), decor: DECOR.map((d) => d.id) };
    const eff = decorEffects(all);
    expect(eff.idleMult).toBeCloseTo(1.05 * 1.08 * 1.1 * 1.15, 10);
    expect(eff.clickMult).toBeCloseTo(1.15 * 1.1, 10);
    expect(eff.offlineBonus).toBeCloseTo(0.23, 10);
    expect(eff.dispatchRewardMult).toBeCloseTo(1.3, 10);
    const idle = effectOf(all).idleRate;
    expect(idle).toBeCloseTo(0.2 * 1.43451, 8);
    // 家具 + 精力叠加（slack）
    const both = useEnergy({ ...all, energy: emptyEnergy(TODAY) }, "slack")!;
    expect(effectOf(both).idleRate).toBeCloseTo(0.2 * 1.43451 * 1.25, 8);
    report.wiring = { ...(report.wiring as object), allDecor: { ...eff, pureIdle: idle, withSlack: effectOf(both).idleRate } };
  });
});

// ────────────────────────────── 三、购买边界 ──────────────────────────────
describe("购买边界", () => {
  it("重复购买 / 未知 id / 钱不足 / 恰好够", () => {
    const s = rich();
    const bought = buyDecor(s, "plant")!;
    expect(bought.moyu).toBe(s.moyu - 3_000);
    expect(ownsDecor(bought, "plant")).toBe(true);
    // 重复
    expect(buyDecor(bought, "plant")).toBeNull();
    expect(canBuyDecor(bought, "plant")).toBe(false);
    // 未知 id
    expect(buyDecor(s, "ghost")).toBeNull();
    expect(canBuyDecor(s, "ghost")).toBe(false);
    // 钱不足（差 1）
    const poor = { ...initialState(), moyu: 2_999 };
    expect(canBuyDecor(poor, "plant")).toBe(false);
    expect(buyDecor(poor, "plant")).toBeNull();
    expect(poor.decor).toEqual([]);
    // 恰好够
    const exact = { ...initialState(), moyu: 3_000 };
    const ok = buyDecor(exact, "plant")!;
    expect(ok.moyu).toBe(0);
    // 余额不会被扣成负数 / 不改变累计口径（与 buyUpgrade 一致只扣余额）
    expect(ok.totalEarned).toBe(0);
    expect(ok.lifetimeEarned).toBe(0);
    report.boundary = { ...(report.boundary as object), buy: { dup: null, ghost: null, poor: null, exactBalance: 0 } };
  });

  it("买齐 8 件：总价 2,234,743,000，余额精确", () => {
    let s = rich();
    for (const d of DECOR) s = buyDecor(s, d.id)!;
    expect(decorCount(s)).toBe(8);
    const totalCost = DECOR.reduce((a, d) => a + d.cost, 0);
    expect(totalCost).toBe(2_234_743_000);
    expect(s.moyu).toBe(1e11 - 2_234_743_000);
    // 全部买完后任何再买都失败
    for (const d of DECOR) expect(buyDecor(s, d.id)).toBeNull();
    report.boundary = { ...(report.boundary as object), buyAll: { totalCost, left: s.moyu } };
  });
});

// ────────────────────────────── 四、精力边界 ──────────────────────────────
describe("精力边界", () => {
  it("同日重复使用返回 null", () => {
    const s = useEnergy({ ...initialState(), energy: emptyEnergy(TODAY) }, "slack")!;
    expect(useEnergy(s, "slack")).toBeNull();
  });

  it("精力不足不可用；恰好 25 可用 social", () => {
    const s: GameState = { ...initialState(), energy: { ...emptyEnergy(TODAY), left: 24 } };
    expect(useEnergy(s, "social")).toBeNull();
    expect(useEnergy(s, "fake-work")).toBeNull();
    const ok = useEnergy({ ...s, energy: { ...emptyEnergy(TODAY), left: 25 } }, "social")!;
    expect(ok.energy.left).toBe(0);
  });

  it("三种行为同日各一次：100 点正好用尽，之后全部不可用", () => {
    let s: GameState = { ...initialState(), energy: emptyEnergy(TODAY) };
    s = useEnergy(s, "slack")!;
    s = useEnergy(s, "fake-work")!;
    s = useEnergy(s, "social")!;
    expect(s.energy.left).toBe(0);
    expect(s.energy.used.sort()).toEqual(["fake-work", "slack", "social"]);
    for (const a of ENERGY_ACTIONS) expect(useEnergy(s, a.id)).toBeNull();
    report.boundary = { ...(report.boundary as object), energyLoop: { left: 0, used: s.energy.used } };
  });

  it("跨日重置：幂等、清空 used/boosted", () => {
    let s = useEnergy({ ...initialState(), energy: emptyEnergy(TODAY) }, "slack")!;
    s = useEnergy(s, "fake-work")!;
    const next = ensureEnergy(s, "2026-11-28");
    expect(next.energy.date).toBe("2026-11-28");
    expect(next.energy.left).toBe(ENERGY_PER_DAY);
    expect(next.energy.used).toEqual([]);
    expect(next.energy.boosted).toEqual({ idleMult: 1, patrolRewardMult: 1 });
    expect(ensureEnergy(next, "2026-11-28")).toBe(next);
    report.boundary = { ...(report.boundary as object), crossDay: next.energy };
  });

  it("未知行为 id 不消耗", () => {
    expect(useEnergy({ ...initialState(), energy: emptyEnergy(TODAY) }, "ghost" as never)).toBeNull();
  });
});

// ────────────────────────────── 五、存档净化 ──────────────────────────────
describe("存档净化（decor）", () => {
  it("重复 / 未知 id / 非数组 → 去重 + 只留已知", () => {
    const r = restore(memAdapter(saveBlob({ decor: ["plant", "plant", "ghost", 42, "lamp", null] })), NOW);
    expect(r.state!.decor).toEqual(["plant", "lamp"]);
    expect(restore(memAdapter(saveBlob({ decor: "plant" })), NOW).state!.decor).toEqual([]);
    expect(restore(memAdapter(saveBlob({ decor: ["ghost"] })), NOW).state!.decor).toEqual([]);
    expect(restore(memAdapter(saveBlob({ decor: ["ghost"] })), NOW).state!.energy).toBeTruthy();
    report.save = { ...(report.save as object), decorSanitize: r.state!.decor };
  });

  it("净化后不可重复买、效果按净化结果生效", () => {
    const r = restore(memAdapter(saveBlob({ decor: ["plant", "plant", "ghost"] })), NOW);
    const s = r.state!;
    expect(canBuyDecor(s, "plant")).toBe(false);
    expect(decorEffects(s).idleMult).toBeCloseTo(1.05, 10); // 去重后只算一次
    expect(decorCount(s)).toBe(1);
  });
});

describe("存档净化（energy）", () => {
  it("left=999 → 100；left=-5 → 0；left=33.9 → 33；left=\"x\" → 100", () => {
    const g = (left: unknown) => restore(memAdapter(saveBlob({ energy: { date: TODAY, left, used: [], boosted: { idleMult: 1, patrolRewardMult: 1 } } })), NOW).state!.energy.left;
    expect(g(999)).toBe(100);
    expect(g(-5)).toBe(0);
    expect(g(33.9)).toBe(33);
    expect(g("x")).toBe(100);
    expect(g(Number.POSITIVE_INFINITY)).toBe(100); // JSON 里会变 null，等价缺失
  });

  it("used=[\"ghost\",\"slack\",\"slack\"] → [\"slack\"]", () => {
    const r = restore(memAdapter(saveBlob({ energy: { date: TODAY, left: 60, used: ["ghost", "slack", "slack", "fake-work", 7], boosted: { idleMult: 1.25, patrolRewardMult: 1 } } })), NOW);
    expect(r.state!.energy.used).toEqual(["slack", "fake-work"]);
  });

  it("date 正则：非法 → \"\"；合法保留", () => {
    const d = (date: unknown) => restore(memAdapter(saveBlob({ energy: { date, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1 } } })), NOW).state!.energy.date;
    expect(d("2026-11-27")).toBe("2026-11-27");
    expect(d("2026-1-1")).toBe("");
    expect(d("not-a-date")).toBe("");
    expect(d(20261127)).toBe("");
    expect(d("2026-13-99")).toBe("2026-13-99"); // 正则口径：只校验形状（语义非法日期会在 ensureEnergy 被重置）
  });

  it("boosted 钳制 [1,2]/[1,3]（spec 字面值）", () => {
    const b = (idleMult: unknown, patrolRewardMult: unknown) =>
      restore(memAdapter(saveBlob({ energy: { date: TODAY, left: 100, used: [], boosted: { idleMult, patrolRewardMult } } })), NOW).state!.energy.boosted;
    expect(b(999, 999)).toEqual({ idleMult: 2, patrolRewardMult: 3 });
    expect(b(-3, -3)).toEqual({ idleMult: 1, patrolRewardMult: 1 });
    expect(b("x", "y")).toEqual({ idleMult: 1, patrolRewardMult: 1 });
    expect(b(1.25, 1.8)).toEqual({ idleMult: 1.25, patrolRewardMult: 1.8 });
    report.save = { ...(report.save as object), boostedClamp: b(999, 999) };
  });

  it("energy 非对象 / 缺失 → 默认值", () => {
    expect(restore(memAdapter(saveBlob({ energy: "bad" })), NOW).state!.energy.left).toBe(100);
    expect(restore(memAdapter(saveBlob({})), NOW).state!.energy).toEqual(emptyEnergy());
  });
});

// ────────────────────────────── 六、持久化 / 转生 ──────────────────────────────
describe("持久化 / 转生保留", () => {
  it("serialize→restore 同档往返：decor / energy / boosted 原样保留", () => {
    let s = rich();
    s = buyDecor(s, "plant")!;
    s = buyDecor(s, "lamp")!;
    s = useEnergy(s, "slack")!;
    const mem = memAdapter();
    serialize(s, mem, NOW);
    const raw = JSON.parse((mem as unknown as { getItem(k: string): string }).getItem(SAVE_KEY)) as Record<string, unknown>;
    expect((raw.decor as string[])).toEqual(["plant", "lamp"]);
    expect((raw.energy as { left: number }).left).toBe(60);
    const r = restore(mem, NOW);
    expect(r.state!.decor).toEqual(["plant", "lamp"]);
    expect(r.state!.energy.left).toBe(60);
    expect(r.state!.energy.boosted.idleMult).toBeCloseTo(1.25, 10);
    expect(effectOf(r.state!).idleRate).toBeCloseTo(0.2 * 1.05 * 1.25, 10);
    report.save = { ...(report.save as object), roundtrip: { decor: r.state!.decor, left: r.state!.energy.left, idle: effectOf(r.state!).idleRate } };
  });

  it("转生保留 decor / energy（doPrestige + 存档往返）", () => {
    let s = rich(5e8);
    s = buyDecor(s, "plant")!;
    s = buyDecor(s, "projector")!;
    s = useEnergy(s, "fake-work")!;
    const before = { decor: [...s.decor], left: s.energy.left, patrol: energyEffects(s).patrolRewardMult };
    const r = doPrestige(s);
    expect(r).not.toBeNull();
    expect(r!.state.decor).toEqual(before.decor);
    expect(r!.state.energy).toEqual(s.energy);
    expect(decorEffects(r!.state).dispatchRewardMult).toBeCloseTo(1.3, 10);
    // 存档往返后仍保留
    const mem = memAdapter();
    serialize(r!.state, mem, NOW);
    const back = restore(mem, NOW).state!;
    expect(back.decor).toEqual(before.decor);
    expect(back.energy.left).toBe(before.left);
    expect(back.prestige).toBeGreaterThan(0);
    report.save = { ...(report.save as object), prestige: { decor: back.decor, left: back.energy.left, prestige: back.prestige, dispatch: decorEffects(back).dispatchRewardMult } };
  });

  it("旧档（无 decor/energy 字段）→ 默认空/满精力，不崩", () => {
    const old = saveBlob();
    delete old.decor;
    delete old.energy;
    const r = restore(memAdapter(old), NOW);
    expect(r.state!.decor).toEqual([]);
    expect(r.state!.energy).toEqual(emptyEnergy());
  });

  it("v 未来版本 → 拒绝（初始状态）", () => {
    const r = restore(memAdapter(saveBlob({ v: SAVE_VERSION + 1 })), NOW);
    expect(r.state!.decor).toEqual([]);
    expect(r.state!.moyu).toBe(0);
  });
});

// ────────────────────────────── 七、观察项（不作断言失败，输出证据） ──────────────────────────────
describe("观察项（记录证据，供缺陷定级）", () => {
  it("口径：有同事时家具/精力挂机加成的实际总挂机增幅远小于标称（仅乘工位部分）", () => {
    const st = withZhou();
    const base = effectOf(st).idleRate;
    const plant = effectOf({ ...st, decor: ["plant"] }).idleRate;
    const slack = effectOf(useEnergy({ ...st, energy: emptyEnergy(TODAY) }, "slack")!).idleRate;
    const both = effectOf(useEnergy({ ...st, decor: ["plant"], energy: emptyEnergy(TODAY) }, "slack")!).idleRate;
    const obs = {
      note: "decor.idleMult / energy.idleMult 只乘 stationIdle，(teamFixed + teamShare) 不乘；panel 标称 ×1.05 / ×1.25",
      baseIdleWithZhou: base,
      plantTotal: plant,
      plantObservedFactor: plant / base,
      slackTotal: slack,
      slackObservedFactor: slack / base,
      bothTotal: both,
    };
    expect(plant).toBeGreaterThan(base);
    expect(slack).toBeGreaterThan(plant);
    report.observations = { ...(report.observations as object), idleScope: obs };
  });

  it("观察：boosted 与 used/left 不交叉校验（存档可白嫖 2×挂机 / 3×巡逻）", () => {
    const r = restore(
      memAdapter(saveBlob({ energy: { date: TODAY, left: 100, used: [], boosted: { idleMult: 2, patrolRewardMult: 3 } } })),
      NOW,
    );
    const s = r.state!;
    const idle = effectOf(s).idleRate;
    const patrol = bossSurviveReward(s);
    expect(s.energy.used).toEqual([]);
    expect(s.energy.left).toBe(100);
    expect(idle).toBeCloseTo(0.4, 10);
    expect(patrol).toBe(150);
    const obs = { freeIdleMult: energyEffects(s).idleMult, freeIdleRate: idle, freePatrolMult: energyEffects(s).patrolRewardMult, freePatrolReward: patrol };
    report.observations = { ...(report.observations as object), boostedWithoutUsed: obs };
  });

  it("观察：used 与 left 不交叉校验（已用 100 点但 left=100 也接受）", () => {
    const r = restore(
      memAdapter(saveBlob({ energy: { date: TODAY, left: 100, used: ["slack", "fake-work", "social"], boosted: { idleMult: 1.25, patrolRewardMult: 1.8 } } })),
      NOW,
    );
    const s = r.state!;
    expect(s.energy.left).toBe(100);
    expect(s.energy.used).toHaveLength(3);
    expect(effectOf(s).idleRate).toBeCloseTo(0.25, 10);
    report.observations = { ...(report.observations as object), leftUsedMismatch: { left: s.energy.left, used: s.energy.used } };
  });

  it("观察：restore 不按今天重置跨日精力；主循环重置发生在离线结算之后（隔夜 boosted 会放大离线收益）", () => {
    const stale = restore(
      memAdapter(
        saveBlob({
          energy: { date: YESTERDAY, left: 60, used: ["slack"], boosted: { idleMult: 1.25, patrolRewardMult: 1 } },
        }),
      ),
      NOW,
    );
    const s = stale.state!;
    const createdAt = NOW - 3 * DAY;
    const rate = offlineEfficiency(s, createdAt, NOW);
    const earnedStale = offlineEarn(s, 3600, rate).earned;
    const fresh = ensureEnergy(s, TODAY);
    const earnedReset = offlineEarn(fresh, 3600, rate).earned;
    expect(s.energy.date).toBe(YESTERDAY); // restore 原样保留
    expect(earnedStale).toBeGreaterThan(earnedReset);
    // 因 idle 加成只乘工位、而 offlineEarn 把该差值当 teamPart 打五折 → 实测 +12.5%
    expect(earnedStale / earnedReset).toBeCloseTo(1.125, 10);
    const obs = { staleDateKeptByRestore: s.energy.date, offlineStale: earnedStale, offlineAfterEnsure: earnedReset, ratio: earnedStale / earnedReset };
    report.observations = { ...(report.observations as object), crossDayOffline: obs };
  });

  it("观察：decor 数组含重复 id 时 decorEffects 会重复乘算（引擎未防御；存档净化会去重）", () => {
    const s = { ...initialState(), decor: ["plant", "plant"] };
    expect(decorEffects(s).idleMult).toBeCloseTo(1.05 * 1.05, 10);
    report.observations = { ...(report.observations as object), duplicateDefense: { idleMult: decorEffects(s).idleMult } };
  });

  it("观察：social 在无同事时照扣 25 点但无任何收益", () => {
    const s = useEnergy({ ...initialState(), energy: emptyEnergy(TODAY) }, "social")!;
    expect(s.energy.left).toBe(75);
    expect(s.energy.used).toEqual(["social"]);
    expect(s.team.colleagues).toEqual({});
    report.observations = { ...(report.observations as object), socialNoColleagues: { left: s.energy.left, favor: 0 } };
  });

  it("观察：新字段未升 SAVE_VERSION（仍为 2），旧客户端写档会静默丢 decor/energy", () => {
    expect(SAVE_VERSION).toBe(2);
    report.observations = { ...(report.observations as object), saveVersion: SAVE_VERSION };
  });

  it("观察：全家具+精力后的真实 tick 收益（1 分钟）", () => {
    const all = { ...initialState(), decor: DECOR.map((d) => d.id) };
    const s = useEnergy(all, "slack")!;
    const minute = advance(s, 60).moyu;
    expect(minute).toBeCloseTo(0.2 * 1.43451 * 1.25 * 60, 6);
    report.observations = { ...(report.observations as object), minuteGainAll: minute };
  });

  it("观察：energyEffects 返回内部对象引用（外部可改）", () => {
    const s = useEnergy({ ...initialState(), energy: emptyEnergy(TODAY) }, "slack")!;
    const e = energyEffects(s);
    expect(e).toBe(s.energy.boosted);
  });
});