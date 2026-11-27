import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { rollDaily } from "../src/engine/daily";
import { FIRST_COLLEAGUE_PRICE, recruitCostOf, canRecruit } from "../src/engine/team";

describe("批次5 回归：新手引导可达性", () => {
  it("首位同事新人价 1,500（原 12,000）", () => {
    const s = initialState();
    expect(recruitCostOf(s, "zhou")).toBe(FIRST_COLLEAGUE_PRICE);
    expect(FIRST_COLLEAGUE_PRICE).toBe(1_500);
    expect(canRecruit({ ...s, moyu: 1_500 }, "zhou")).toBe(true);
    expect(canRecruit({ ...s, moyu: 1_499 }, "zhou")).toBe(false);
  });

  it("招到第一位同事后恢复原价", () => {
    const s = { ...initialState(), team: { colleagues: { zhou: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 } } } };
    expect(recruitCostOf(s, "mei")).toBe(500_000);
  });

  it("首日日报不抽到「等老板巡逻」目标（不阻塞领工资）", () => {
    for (let seed = 0; seed < 200; seed++) {
      let x = seed * 9301 + 49297;
      const rng = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
      const d = rollDaily("2026-11-27", rng, 0); // prevStreak=0 → 首日
      expect(d.goals.some((g) => g.id === "survive_2")).toBe(false);
    }
  });

  it("非首日仍可能出现 survive 目标（保留多样性）", () => {
    let sawSurvive = false;
    for (let seed = 0; seed < 300 && !sawSurvive; seed++) {
      let x = seed * 7919 + 104729;
      const rng = () => ((x = (x * 7919 + 104729) % 233280) / 233280);
      const d = rollDaily("2026-12-01", rng, 5);
      if (d.goals.some((g) => g.id === "survive_2")) sawSurvive = true;
    }
    expect(sawSurvive).toBe(true);
  });
});
