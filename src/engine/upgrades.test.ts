import { describe, it, expect } from "vitest";
import { UPGRADES, costOf, effectOf } from "./upgrades";
import { initialState } from "./state";

describe("升级表与价格曲线", () => {
  it("六个升级均有 id/名称/基础价与效果", () => {
    expect(UPGRADES).toHaveLength(6);
    for (const u of UPGRADES) {
      expect(u.id.length).toBeGreaterThan(0);
      expect(u.name.length).toBeGreaterThan(0);
      expect(u.baseCost).toBeGreaterThan(0);
      expect(u.clickPower ?? 0).toBeGreaterThanOrEqual(0);
      expect(u.idleRate ?? 0).toBeGreaterThanOrEqual(0);
      expect(u.clickPower || u.idleRate).toBeGreaterThan(0);
    }
  });

  it("价格按 1.15^n 上浮：cost(level2) = base × 1.15²", () => {
    const u = UPGRADES[0]!;
    // 独立推定：15 × 1.15² = 19.8375 → 向上取整 20
    expect(costOf(u.id, 2)).toBe(Math.ceil(u.baseCost * 1.15 ** 2));
    expect(costOf(u.id, 0)).toBe(u.baseCost);
  });

  it("未购买时 effectOf 返回零加成", () => {
    const s = initialState();
    expect(effectOf(s)).toEqual({ clickPower: 0, idleRate: 0 });
  });

  it("累计购买等级对应加成", () => {
    const s = initialState();
    const clickUp = UPGRADES.find((u) => (u.clickPower ?? 0) > 0)!;
    const idleUp = UPGRADES.find((u) => (u.idleRate ?? 0) > 0)!;
    s.levels[clickUp.id] = 3;
    s.levels[idleUp.id] = 2;
    const e = effectOf(s);
    expect(e.clickPower).toBe(clickUp.clickPower! * 3);
    expect(e.idleRate).toBe(idleUp.idleRate! * 2);
  });
});
