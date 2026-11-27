import { describe, it, expect } from "vitest";
import { initialState, type GameState } from "./state";
import { ENERGY_ACTIONS, ENERGY_PER_DAY, emptyEnergy, energyEffects, ensureEnergy, useEnergy } from "./energy";
import { emptyTeam } from "./team";

const TODAY = "2026-11-27";

function base(): GameState {
  return {
    ...initialState(),
    team: { colleagues: { zhou: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 10, autoRepeat: false, rewardSnapshot: 0 } } },
    energy: emptyEnergy(TODAY),
  };
}

describe("每日精力", () => {
  it("3 种行为，总花费不超过 100", () => {
    expect(ENERGY_ACTIONS).toHaveLength(3);
    const total = ENERGY_ACTIONS.reduce((s, a) => s + a.cost, 0);
    expect(total).toBeLessThanOrEqual(ENERGY_PER_DAY);
  });

  it("使用后扣精力、效果叠加", () => {
    let s = base();
    s = useEnergy(s, "slack")!;
    expect(s.energy.left).toBe(ENERGY_PER_DAY - 40);
    expect(energyEffects(s).idleMult).toBeCloseTo(1.25, 6);
    s = useEnergy(s, "fake-work")!;
    expect(energyEffects(s).patrolRewardMult).toBeCloseTo(1.8, 6);
  });

  it("同一天不能重复用同一行为", () => {
    const s = useEnergy(base(), "slack")!;
    expect(useEnergy(s, "slack")).toBeNull();
  });

  it("精力不足不能再用", () => {
    let s = base();
    s = useEnergy(s, "slack")!; // 40
    s = useEnergy(s, "fake-work")!; // 35
    expect(s.energy.left).toBe(25);
    expect(useEnergy(s, "social")).not.toBeNull(); // 正好 25
  });

  it("社交：全体同事好感 +3", () => {
    const s = useEnergy(base(), "social")!;
    expect(s.team.colleagues["zhou"]!.favor).toBe(13);
  });

  it("跨日重置精力（幂等）", () => {
    let s = useEnergy(base(), "slack")!;
    const next = ensureEnergy(s, "2026-11-28");
    expect(next.energy.left).toBe(ENERGY_PER_DAY);
    expect(next.energy.used).toEqual([]);
    expect(ensureEnergy(next, "2026-11-28")).toBe(next);
  });
});

void emptyTeam;
