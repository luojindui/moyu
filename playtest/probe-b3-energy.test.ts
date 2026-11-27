import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { ENERGY_ACTIONS, ENERGY_PER_DAY, emptyEnergy, energyEffects, ensureEnergy, useEnergy } from "../src/engine/energy";
import { offlineEfficiency } from "../src/engine/progression";

describe("批次3 审计回归：精力取舍与跨日", () => {
  it("4 项合计 > 100，必须放弃至少一项", () => {
    const total = ENERGY_ACTIONS.reduce((s, a) => s + a.cost, 0);
    expect(total).toBeGreaterThan(ENERGY_PER_DAY);
    // 最便宜三项 25+35+40=100 → 最多点 3 项，必有 1 项放弃
    const cheapest = [...ENERGY_ACTIONS].sort((a, b) => a.cost - b.cost);
    const threeCheapest = cheapest[0]!.cost + cheapest[1]!.cost + cheapest[2]!.cost;
    expect(threeCheapest).toBe(ENERGY_PER_DAY); // 恰好 100 → 第 4 项必然放弃
    expect(threeCheapest + cheapest[3]!.cost).toBeGreaterThan(ENERGY_PER_DAY);
  });

  it("跨日重置会清空 boosted（离线结算不能用昨天的加成）", () => {
    let s = { ...initialState(), energy: emptyEnergy("2026-11-27") };
    s = useEnergy(s, "slack")!;
    expect(energyEffects(s).idleMult).toBeCloseTo(1.25, 6);
    const next = ensureEnergy(s, "2026-11-28");
    expect(next.energy.boosted.idleMult).toBe(1);
    expect(next.energy.boosted.patrolRewardMult).toBe(1);
    expect(next.energy.left).toBe(ENERGY_PER_DAY);
  });

  it("离线效率计入工位家具加成（上限 95%）", () => {
    const now = Date.UTC(2026, 11, 1);
    const created = now - 30 * 86400_000;
    const base = {
      ...initialState(),
      visits: { date: new Date(now).toLocaleDateString("sv-SE"), count: 0 },
      daily: { date: "", goals: [], claimed: false, streak: 0, lastCompleteDate: "", window: 0, claimsToday: 0 } as never,
    };
    const noDecor = offlineEfficiency(base, created, now);
    const withDecor = offlineEfficiency({ ...base, decor: ["rug", "chair"] }, created, now);
    expect(withDecor).toBeGreaterThan(noDecor); // 地毯+按摩椅的离线加成确实计入（直到硬上限）
    expect(withDecor).toBeLessThanOrEqual(0.95);
  });
});
