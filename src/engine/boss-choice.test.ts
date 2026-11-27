import { describe, it, expect } from "vitest";
import { initialState, gain } from "./state";
import { CHOICES, PERSONALITIES, isCorrect, resolveBossChoice } from "./boss-choice";

const base = () => gain(initialState(), 1e6);

describe("回合制老板", () => {
  it("三种性格各有唯一正确应对", () => {
    for (const p of PERSONALITIES) {
      const correct = CHOICES.filter((c) => isCorrect(p.id, c.id));
      expect(correct).toHaveLength(1);
      expect(correct[0]!.id).toBe(p.correct);
    }
  });

  it("选对：奖励 = 基础 × 2.2 且入账", () => {
    const s = base();
    const r = resolveBossChoice(s, "suspicious", "switch-screen", 1000);
    expect(r.correct).toBe(true);
    expect(r.delta).toBe(2200);
    expect(r.state.moyu).toBe(s.moyu + 2200);
    expect(r.state.lifetimeEarned).toBe(s.lifetimeEarned + 2200);
  });

  it("选错：罚款 = 基础 × 0.6（不超余额）", () => {
    const s = base();
    const r = resolveBossChoice(s, "hasty", "keep-slacking", 1000);
    expect(r.correct).toBe(false);
    expect(r.delta).toBe(-600);
    expect(r.state.moyu).toBe(s.moyu - 600);
  });

  it("选错时余额不足只扣到 0", () => {
    const s = { ...initialState(), moyu: 100, totalEarned: 1000, lifetimeEarned: 1000 };
    const r = resolveBossChoice(s, "hasty", "keep-slacking", 10000);
    expect(r.delta).toBe(-100);
    expect(r.state.moyu).toBe(0);
  });
});
