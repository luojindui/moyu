import { describe, it, expect } from "vitest";
import { initialState, type GameState } from "./state";
import {
  TALENT_POINT_CAP,
  talentCostOf,
  TALENTS,
  TALENT_POINTS_PER_PRESTIGE,
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
} from "./talents";

function withPoints(points: number): GameState {
  return { ...initialState(), talents: { unlocked: [], points, rankGranted: -1, dailyGiftDate: "", overflow: 0 } };
}

describe("天赋树（18 个：3 流派 × 4 线性 + 2 互斥终极）", () => {
  it("结构：每流派 6 个，其中 2 个互斥终极", () => {
    expect(TALENTS).toHaveLength(18);
    for (const b of ["click", "idle", "event"] as const) {
      expect(TALENTS.filter((t) => t.branch === b)).toHaveLength(6);
      expect(TALENTS.filter((t) => t.branch === b && t.exclusive)).toHaveLength(2);
    }
  });

  it("必须逐级解锁：不能跳级", () => {
    const s = withPoints(10);
    expect(canUnlock(s.talents, "click_2")).toBe(false);
    expect(canUnlock(s.talents, "click_1")).toBe(true);
    const s1 = unlockTalent(s, "click_1")!;
    expect(branchTier(s1.talents, "click")).toBe(1);
    expect(canUnlock(s1.talents, "click_2")).toBe(true);
  });

  it("点数不足 / 已点亮 / 未知 id 都不能点", () => {
    expect(unlockTalent(withPoints(0), "click_1")).toBeNull();
    const s1 = unlockTalent(withPoints(5), "click_1")!;
    expect(unlockTalent(s1, "click_1")).toBeNull();
    expect(unlockTalent(s1, "nope")).toBeNull();
  });

  it("互斥终极：选了 A 不能选 B；重置后可改选", () => {
    let s = withPoints(10);
    for (const id of ["click_1", "click_2", "click_3", "click_4"]) s = unlockTalent(s, id)!;
    expect(canUnlock(s.talents, "click_5a")).toBe(true);
    expect(canUnlock(s.talents, "click_5b")).toBe(true);
    s = unlockTalent(s, "click_5a")!;
    expect(exclusiveTaken(s.talents, "click_ult")).toBe("click_5a");
    expect(canUnlock(s.talents, "click_5b")).toBe(false);
    const r = resetTalents(s);
    expect(r.talents.unlocked).toEqual([]);
    // 重置后重新点 tier1-4 即可改选另一条终极
    let t = r;
    for (const id of ["click_1", "click_2", "click_3", "click_4"]) t = unlockTalent(t, id)!;
    expect(canUnlock(t.talents, "click_5b")).toBe(true);
  });

  it("终极要 3 点且需 tier4 前置", () => {
    let t = withPoints(10);
    for (const id of ["idle_1", "idle_2", "idle_3"]) t = unlockTalent(t, id)!;
    expect(canUnlock(t.talents, "idle_5a")).toBe(false); // 缺 tier4
    t = unlockTalent(t, "idle_4")!;
    const before = t.talents.points;
    t = unlockTalent(t, "idle_5a")!;
    expect(costOfTalent("idle_5a")).toBe(3);
    expect(t.talents.points).toBe(before - 3);
  });

  it("重置返还全部点数（含终极的 3 点）", () => {
    let s = withPoints(20);
    for (const id of ["idle_1", "idle_2", "idle_3", "idle_4", "idle_5a"]) s = unlockTalent(s, id)!;
    expect(s.talents.points).toBe(20 - 1 - 1 - 2 - 2 - 3);
    const r = resetTalents(s);
    // 上限 27，返还后为 20
    expect(r.talents.points).toBe(20);
    expect(r.talents.unlocked).toEqual([]);
  });

  it("段位发点：幂等、不重复、封顶 18", () => {
    const g1 = grantRankTalents(emptyTalents(), 6); // 覆盖第 3/5/7 档 = 3 点
    expect(g1.granted).toBe(3);
    expect(grantRankTalents(g1.talents, 6).granted).toBe(0); // 幂等
    const g2 = grantRankTalents(g1.talents, 12);
    expect(g2.granted).toBe(3);
    expect(g2.talents.points).toBe(6);
    expect(grantPrestigeTalentPoints({ ...emptyTalents(), points: TALENT_POINT_CAP }).points).toBe(TALENT_POINT_CAP);
  });

  it("转生给天赋点", () => {
    const t = grantPrestigeTalentPoints(emptyTalents());
    expect(t.points).toBe(TALENT_POINTS_PER_PRESTIGE);
  });

  it("效果：点击流线性 + 终极 5a/5b 互斥", () => {
    const e0 = talentEffects(emptyTalents());
    expect(e0.clickMult).toBe(1);
    let a = withPoints(10);
    for (const id of ["click_1", "click_2", "click_3", "click_4", "click_5a"]) a = unlockTalent(a, id)!;
    const ea = talentEffects(a.talents);
    expect(ea.clickMult).toBeCloseTo(1.25, 6);
    expect(ea.comboWindowBonus).toBeCloseTo(0.15, 6);
    expect(ea.comboMaxBonus).toBe(10);
    expect(ea.critEvery).toBe(20);
    expect(ea.clickToIdleStep).toBe(300);

    let b = withPoints(10);
    for (const id of ["click_1", "click_2", "click_3", "click_4", "click_5b"]) b = unlockTalent(b, id)!;
    const eb = talentEffects(b.talents);
    expect(eb.clickMult).toBeCloseTo(1.25 * 1.6, 6);
    expect(eb.clickToIdleStep).toBe(0);
  });

  it("效果：挂机流线性叠加 + 终极选择", () => {
    let a = withPoints(10);
    for (const id of ["idle_1", "idle_2", "idle_3", "idle_4", "idle_5a"]) a = unlockTalent(a, id)!;
    const ea = talentEffects(a.talents);
    expect(ea.idleMult).toBeCloseTo(1 + 0.04 + 0.04 + 0.2, 6);
    expect(ea.offlineCapBonusHours).toBe(2);
    expect(ea.offlineBaseBonus).toBe(0.08);
    expect(ea.teamIdleMult).toBe(1);

    let b = withPoints(10);
    for (const id of ["idle_1", "idle_2", "idle_3", "idle_4", "idle_5b"]) b = unlockTalent(b, id)!;
    expect(talentEffects(b.talents).teamIdleMult).toBeCloseTo(1.7, 6);
  });

  it("效果：事件流 + 终极 ×2", () => {
    let a = withPoints(10);
    for (const id of ["event_1", "event_2", "event_3", "event_4", "event_5a"]) a = unlockTalent(a, id)!;
    const ea = talentEffects(a.talents);
    expect(ea.patrolRewardMult).toBeCloseTo(1.2, 6);
    expect(ea.penaltyReduction).toBe(0.35);
    expect(ea.memeRewardMult).toBeCloseTo(1.15, 6);
    expect(ea.patrolWarnSeconds).toBe(2);
    expect(ea.surviveToIdle).toBe(true);

    let b = withPoints(10);
    for (const id of ["event_1", "event_2", "event_3", "event_4", "event_5b"]) b = unlockTalent(b, id)!;
    const eb = talentEffects(b.talents);
    expect(eb.patrolRewardMult).toBeCloseTo(2.4, 6);
    expect(eb.surviveToIdle).toBe(false);
  });

  it("满树 27 点（每流派 9 点），单流派 9 点", () => {
    expect(talentCostOf(1)).toBe(1);
    expect(talentCostOf(2)).toBe(1);
    expect(talentCostOf(3)).toBe(2);
    expect(talentCostOf(4)).toBe(2);
    expect(talentCostOf(5)).toBe(3);
    const perBranch = 1 + 1 + 2 + 2 + 3;
    expect(perBranch).toBe(9);
    // 上限 24 < 满树 27 → 终局必须放弃一条流派
    expect(TALENT_POINT_CAP).toBe(24);
    expect(perBranch * 3).toBe(27);
  });
});
