/**
 * R12 批次 1 复验：天赋树（18 节点）——互斥终极 / 发点 / 各节点是否真正接入玩法。
 * 只读 src/。断言按当前实现行为写。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { initialState } from "../src/engine/state";
import { COMBO_MAX, clickPowerOf, comboCapOf, comboMultiplier, comboWindowOf, doClick } from "../src/engine/actions";
import {
  TALENT_POINT_CAP,
  TALENTS,
  branchTier,
  canUnlock,
  costOfTalent,
  emptyTalents,
  exclusiveTaken,
  grantPrestigeTalentPoints,
  grantRankTalents,
  resetTalents,
  talentEffects,
  unlockTalent,
  type TalentState,
} from "../src/engine/talents";
import { bossSurviveReward, newEventState, onBossTap, onMemeTap } from "../src/engine/events";
import { conversionBonus, effectOf, stationIdleScaled } from "../src/engine/upgrades";
import { offlineEfficiency } from "../src/engine/progression";
import { teamTraits, recruit } from "../src/engine/team";
import { withLevels, withTalents, rich, consumers } from "./probe-r12-aud2-lib";

const stateWith = (ids: string[], over: Partial<ReturnType<typeof initialState>> = {}) => ({
  ...initialState(),
  ...over,
  talents: { unlocked: [...ids], points: 0, rankGranted: 12 } as TalentState,
});

describe("W1. 18 天赋结构 / 互斥终极 / 点数", () => {
  it("W1 结构：每流派 6 个（4 线性 + 2 互斥终极），上限 18 点", () => {
    expect(TALENTS).toHaveLength(18);
    expect(TALENT_POINT_CAP).toBe(18);
    for (const b of ["click", "idle", "event"] as const) {
      expect(TALENTS.filter((t) => t.branch === b)).toHaveLength(6);
      expect(TALENTS.filter((t) => t.branch === b && t.exclusive)).toHaveLength(2);
    }
  });

  it("W2 互斥终极：选 A 后 B 不可点；需 tier4 前置；终极 2 点；重置退款含 2 点", () => {
    let s = { ...initialState(), talents: { ...emptyTalents(), points: 18 } };
    for (const id of ["click_1", "click_2", "click_3", "click_4"]) s = unlockTalent(s, id)!;
    expect(canUnlock(s.talents, "click_5a")).toBe(true);
    expect(canUnlock(s.talents, "click_5b")).toBe(true);
    s = unlockTalent(s, "click_5a")!;
    expect(exclusiveTaken(s.talents, "click_ult")).toBe("click_5a");
    expect(canUnlock(s.talents, "click_5b")).toBe(false);
    expect(costOfTalent("click_5a")).toBe(2);
    const r = resetTalents(s);
    expect(r.talents.points).toBe(18); // 1+1+1+1+2 全退（18−6+6）
    expect(r.talents.unlocked).toEqual([]);
    // 跳级被拒（未点 tier4 时终极不可点）
    const t = { ...initialState(), talents: { ...emptyTalents(), points: 10 } };
    let u = t;
    for (const id of ["idle_1", "idle_2", "idle_3"]) u = unlockTalent(u, id)!;
    expect(canUnlock(u.talents, "idle_5a")).toBe(false);
  });

  it("W3 段位发点幂等 + 上限 18；转生发点封顶 18", () => {
    let t = emptyTalents();
    let total = 0;
    for (let i = 0; i <= 13; i++) {
      const g = grantRankTalents(t, i);
      total += g.granted;
      t = g.talents;
    }
    expect(total).toBe(6);
    expect(grantRankTalents(t, 13).granted).toBe(0);
    const many = grantPrestigeTalentPoints({ ...emptyTalents(), points: 17 }, 5);
    expect(many.points).toBe(18);
    expect(grantRankTalents({ ...emptyTalents(), points: 18 }, 13).talents.points).toBe(18);
  });
});

describe("W4. 天赋节点接入验证（本轮修复重点）", () => {
  it("W4a 已接入：click_2 连击窗口 0.5→0.65、click_3 连击上限 20→30（doClick 也生效）", () => {
    const a = stateWith([]);
    const b = stateWith(["click_2", "click_3"]);
    expect(comboWindowOf(a)).toBe(0.5);
    expect(comboWindowOf(b)).toBe(0.65);
    expect(comboCapOf(a)).toBe(COMBO_MAX);
    expect(comboCapOf(b)).toBe(30);
    // combo 30：无天赋封顶 20 → ×1.24；有 click_3 → ×1.36
    const gainA = doClick({ ...a, moyu: 0 }, 30).moyu;
    const gainB = doClick({ ...b, moyu: 0 }, 30).moyu;
    expect(gainA).toBeCloseTo(clickPowerOf(a) * 1.24, 6);
    expect(gainB).toBeCloseTo(clickPowerOf(b) * 1.36, 6);
    console.log("[W4a] comboWindow", comboWindowOf(a), "→", comboWindowOf(b), "; comboCap", comboCapOf(a), "→", comboCapOf(b));
  });

  it("W4b 【缺陷·语义】click_4 暴击：main 已消费字段，但只乘到飘字变量，实际收入仍走 doClick（无暴击）", () => {
    expect(consumers("critEvery", "talents.ts").length).toBeGreaterThan(0); // main.ts 有消费点
    // 引擎侧：第 20 次点击（totalClicks=19）收入与无暴击完全一致
    const s = stateWith(["click_1", "click_4"], { totalClicks: 19 });
    const gainAt20 = doClick(s, 0).moyu - s.moyu;
    expect(gainAt20).toBeCloseTo(clickPowerOf(s), 6); // 无 ×5
    // 100 次点击收入恒为 1 档
    const base = stateWith(["click_1", "click_2", "click_3", "click_4"], { levels: {} });
    const deltas = new Set<number>();
    let cur = base;
    for (let i = 0; i < 100; i++) {
      const before = cur.moyu;
      cur = doClick(cur, 0);
      deltas.add(Math.round((cur.moyu - before) * 1e6) / 1e6);
    }
    expect(deltas.size).toBe(1);
    const main = readFileSync("src/main.ts", "utf8");
    // main 里 crit 只改 gained（飘字），随后 state = doClick(state, combo) 不含暴击倍率
    expect(main).toContain("critEvery");
    expect(main).not.toMatch(/doClick\([^)]*crit/);
    console.log("[W4b] 第 20 次点击收入=", gainAt20, "=正常点击（×5 未进账，只在飘字/音效）");
  });

  it("W4c event_2/强哥被动 罚款减免已接入（-35%/-10%）", () => {
    const penaltyConsumers = consumers("penaltyReduction").filter((h) => !h.path.endsWith("talents.ts") && !h.path.endsWith("team.ts"));
    console.log("[W4c] penaltyReduction 玩法消费点:", penaltyConsumers);
    expect(penaltyConsumers.length).toBeGreaterThan(0);
    const base = withLevels(rich(), { retire: 10 });
    const withEv = withTalents(base, ["event_1", "event_2"]);
    const withQiang = recruit(base, "qiang")!;
    const run = (state: typeof base) => {
      const es = newEventState();
      es.bossUntil = 100;
      es.bossStartAt = 0;
      es.bossVariant = "hold";
      es.patrolCount = 10;
      return onBossTap(state, es, 50, 0);
    };
    const norm = (state: typeof base) => run(state).lost / Math.max(1e-9, 0.6 * effectOf(state).idleRate); // lost 应恒 = 0.6×idleRate（无减免）
    const a = run(base).lost;
    const b = run(withEv).lost;
    const c = run(withQiang).lost;
    console.log("[W4c] 罚款：无天赋=", a, " event_2(−35%)=", b, " 强哥队友时=", c, " 归一化:", norm(base), norm(withEv), norm(withQiang));
    expect(norm(withEv)).toBeCloseTo(norm(base) * 0.65, 3); // event_2 -35%
    expect(norm(withQiang)).toBeCloseTo(norm(base) * 0.9, 3); // 强哥 -10%
    expect(consumers("teamTraits", "team.ts").length).toBeGreaterThan(0);
    expect(teamTraits(withQiang).penaltyReduction).toBe(0.1);
  });

  it("W4d event_4「巡逻横幅提前 2s」已接入 main（+5% 奖励有效）", () => {
    expect(consumers("patrolWarnSeconds", "talents.ts").length).toBeGreaterThan(0);
    const eff = talentEffects({ ...emptyTalents(), unlocked: ["event_1", "event_4"] });
    expect(eff.patrolWarnSeconds).toBe(2);
    expect(eff.patrolRewardMult).toBeCloseTo(1.2, 6);
  });

  it("W4e idle_5b「同事挂机 +40%」已接入 effectOf（teamIdleMult）", () => {
    expect(consumers("teamIdleMult", "talents.ts").length).toBeGreaterThan(0);
    const base = withLevels(rich(), { retire: 10 });
    // 需要先招募同事，否则同事部分为 0
    const withMate = { ...base, team: { colleagues: { zhou: { level: 5, missionId: null as string | null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 } } } };
    const a = withTalents(withMate, ["idle_1"]);
    const b = withTalents(withMate, ["idle_1", "idle_5b"]);
    expect(talentEffects(b.talents).teamIdleMult).toBe(1.4);
    // 同事部分（fixed+share）应 ×1.4；工位不变
    const stationA = stationIdleScaled(a);
    const stationB = stationIdleScaled(b);
    expect(stationB).toBeCloseTo(stationA, 6);
    const teamA = effectOf(a).idleRate - stationA;
    const teamB = effectOf(b).idleRate - stationB;
    console.log("[W4e] 同事挂机 idle_1=", teamA.toFixed(1), " 加 idle_5b=", teamB.toFixed(1), " 比值=", (teamB / teamA).toFixed(3));
    expect(teamB / teamA).toBeCloseTo(1.4, 3);
  });

  it("W4f 【缺陷】click_5b 的「连击每层收益翻倍（上限 ×1.72）」未实现：仍按 0.012/层", () => {
    const with5b = stateWith(["click_1", "click_3", "click_5b"]);
    const gain = doClick({ ...with5b, moyu: 0 }, 30).moyu;
    expect(gain).toBeCloseTo(clickPowerOf(with5b) * 1.36, 6); // 不是 ×1.72
    // perCombo 参数无任何调用方传自定义值
    const callers = consumers("comboMultiplier(").filter((h) => !h.path.endsWith("actions.ts") && !h.path.endsWith("events.ts"));
    console.log("[W4f] comboMultiplier 自定义 perCombo 调用点:", callers);
    expect(consumers("0.024")).toEqual([]);
  });

  it("W4g idle_4「离线效率上限 +0.08（可超过100%）」已放开", () => {
    const s = withTalents({ ...initialState(), visits: { date: "2026-11-27", count: 3 }, daily: { date: "2026-11-27", window: 0, goals: [], streak: 14, claimed: false } as never }, ["idle_4"]);
    const eff = offlineEfficiency(s, 0, 3 * 86400_000);
    console.log("[W4g] 离线效率（idle_4+3回访+14天streak）=", eff);
    expect(eff).toBeGreaterThan(1); // 上限随天赋提高（1+talentBase）
  });

  it("W4h 已接入的效果：click_1/5a/5b 点击倍率、idle_1/3/5a 挂机、event_1/3/5b 事件 ×2", () => {
    const eff = talentEffects({ ...emptyTalents(), unlocked: ["click_1", "click_5b", "idle_1", "idle_3", "idle_5a", "event_1", "event_4", "event_5b", "event_3"] });
    expect(eff.clickMult).toBeCloseTo(1.25 * 1.12, 6);
    expect(eff.idleMult).toBeCloseTo(1.2, 6);
    expect(eff.patrolRewardMult).toBeCloseTo((1 + 0.15 + 0.05) * 2, 6);
    expect(eff.memeRewardMult).toBeCloseTo((1 + 0.15) * 2, 6);
    // event_5b 行为验证：巡逻/丢梗奖励 ×2
    const s = withLevels(rich(), { retire: 10 });
    const a = bossSurviveReward(withTalents(s, ["event_1"]));
    const b = bossSurviveReward(withTalents(s, ["event_1", "event_5b"]));
    expect(b / a).toBeCloseTo(2, 6);
    const esA = newEventState();
    esA.memeUntil = 100;
    const esB = newEventState();
    esB.memeUntil = 100;
    const mA = onMemeTap(withTalents(s, []), esA).earned;
    const mB = onMemeTap(withTalents(s, ["event_5b"]), esB).earned;
    expect(mB / mA).toBeCloseTo(2, 6);
    // click_5a 转化：3000 次点击 → 工位 +10%
    const conv = stateWith(["click_5a"], { totalClicks: 3000 });
    expect(conversionBonus(conv)).toBeCloseTo(0.1, 6);
    // 点击力倍率确实进 clickPowerOf
    expect(clickPowerOf(stateWith(["click_1", "click_5b"])) / clickPowerOf(stateWith([]))).toBeCloseTo(1.25 * 1.12, 6);
    // 挂机天赋确实进工位
    expect(stationIdleScaled(withTalents(withLevels(s, { retire: 10 }), ["idle_1", "idle_3", "idle_5a"])) / stationIdleScaled(withLevels(s, { retire: 10 }))).toBeCloseTo(1.2, 6);
  });
});
