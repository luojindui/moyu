import { describe, it, expect } from "vitest";
import { initialState, type GameState } from "./state";
import {
  MAX_TIER,
  TALENTS,
  TALENT_POINTS_PER_PRESTIGE,
  branchTier,
  canUnlock,
  emptyTalents,
  grantPrestigeTalentPoints,
  resetTalents,
  talentEffects,
  unlockTalent,
} from "./talents";

function withPoints(points: number): GameState {
  return { ...initialState(), talents: { unlocked: [], points, rankGranted: -1 } };
}

describe("天赋树", () => {
  it("三条流派各 5 级，共 15 个天赋", () => {
    expect(TALENTS).toHaveLength(15);
    for (const b of ["click", "idle", "event"] as const) {
      expect(TALENTS.filter((t) => t.branch === b)).toHaveLength(MAX_TIER);
    }
  });

  it("必须逐级解锁：不能跳级", () => {
    const s = withPoints(10);
    expect(canUnlock(s.talents, "click_2")).toBe(false); // 未点 click_1
    expect(canUnlock(s.talents, "click_1")).toBe(true);
    const s1 = unlockTalent(s, "click_1")!;
    expect(branchTier(s1.talents, "click")).toBe(1);
    expect(canUnlock(s1.talents, "click_2")).toBe(true);
  });

  it("点数不足/已点亮/未知 id 都不能点", () => {
    const poor = withPoints(0);
    expect(unlockTalent(poor, "click_1")).toBeNull();
    const rich = withPoints(5);
    const s1 = unlockTalent(rich, "click_1")!;
    expect(unlockTalent(s1, "click_1")).toBeNull(); // 已点
    expect(unlockTalent(s1, "nope")).toBeNull();
  });

  it("重置返还全部点数", () => {
    let s = withPoints(3);
    s = unlockTalent(s, "idle_1")!;
    s = unlockTalent(s, "idle_2")!;
    expect(s.talents.points).toBe(1);
    const r = resetTalents(s);
    expect(r.talents.points).toBe(3);
    expect(r.talents.unlocked).toEqual([]);
  });

  it("转生给天赋点", () => {
    const t = grantPrestigeTalentPoints(emptyTalents());
    expect(t.points).toBe(TALENT_POINTS_PER_PRESTIGE);
    expect(t.unlocked).toEqual([]);
  });

  it("效果聚合：点击流 1 级 → 点击力 ×1.25", () => {
    const e0 = talentEffects(emptyTalents());
    expect(e0.clickMult).toBe(1);
    expect(e0.idleMult).toBe(1);
    let s = withPoints(5);
    s = unlockTalent(s, "click_1")!;
    expect(talentEffects(s.talents).clickMult).toBe(1.25);
  });

  it("效果聚合：挂机流 1+3+5 级叠加", () => {
    let s = withPoints(5);
    for (const id of ["idle_1", "idle_2", "idle_3", "idle_4", "idle_5"]) s = unlockTalent(s, id)!;
    const e = talentEffects(s.talents);
    expect(e.idleMult).toBeCloseTo(1 + 0.05 + 0.05 + 0.05, 6); // 三档各 +5%
    expect(e.offlineCapBonusHours).toBe(2);
    expect(e.offlineBaseBonus).toBe(0.05);
  });

  it("效果聚合：事件流", () => {
    let s = withPoints(5);
    for (const id of ["event_1", "event_2", "event_3", "event_4", "event_5"]) s = unlockTalent(s, id)!;
    const e = talentEffects(s.talents);
    expect(e.patrolRewardMult).toBeCloseTo(1.2, 6); // 15% + 5%
    expect(e.penaltyReduction).toBe(0.35);
    expect(e.memeRewardMult).toBeCloseTo(1.1, 6);
    expect(e.patrolWarnSeconds).toBe(2);
    expect(e.surviveToIdle).toBe(true);
  });
});
