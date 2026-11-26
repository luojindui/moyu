import { describe, it, expect } from "vitest";
import { UPGRADES, costOf, effectOf, marginalEffect, milestoneGap } from "./upgrades";
import { initialState } from "./state";

describe("升级表与价格曲线", () => {
  it("九个升级均有 id/名称/基础价与效果（三条点击线 + 六条挂机线）", () => {
    expect(UPGRADES).toHaveLength(9);
    const clicks = UPGRADES.filter((u) => (u.clickPower ?? 0) > 0);
    const idles = UPGRADES.filter((u) => (u.idleRate ?? 0) > 0);
    expect(clicks).toHaveLength(3);
    expect(idles).toHaveLength(6);
    for (const u of UPGRADES) {
      expect(u.id.length).toBeGreaterThan(0);
      expect(u.baseCost).toBeGreaterThan(0);
      expect(u.clickPower || u.idleRate).toBeGreaterThan(0);
    }
  });

  it("档位按 optimizer 方案拉开：挂机 50/600/4000/25000/150000/1000000", () => {
    const idleCosts = UPGRADES.filter((u) => (u.idleRate ?? 0) > 0).map((u) => u.baseCost);
    expect(idleCosts).toEqual([50, 600, 4000, 25000, 150000, 1000000]);
  });

  it("价格按 1.15^n 上浮：cost(level2) = ceil(base × 1.15²)", () => {
    const u = UPGRADES[0]!;
    expect(costOf(u.id, 2)).toBe(Math.ceil(u.baseCost * 1.15 ** 2));
    expect(costOf(u.id, 0)).toBe(u.baseCost);
  });

  it("无购买时 effectOf 返回底薪挂机 0.2/s、点击加成 0（底薪修死局）", () => {
    expect(effectOf(initialState())).toEqual({ clickPower: 0, idleRate: 0.2 });
  });

  it("里程碑倍数：每满 20 级该项效果 ×2（effect = base × lv × 2^⌊lv/20⌋）", () => {
    const s = initialState();
    s.levels["phone" as string] = 20; // 1 × 20 × 2^1 = 40/s（不含底薪）
    expect(effectOf(s).idleRate - 0.2).toBe(40);
    s.levels["phone" as string] = 19; // 1 × 19 × 2^0 = 19/s
    expect(effectOf(s).idleRate - 0.2).toBe(19);
    s.levels["phone" as string] = 40; // 1 × 40 × 2^2 = 160/s
    expect(effectOf(s).idleRate - 0.2).toBe(160);
  });

  it("点击线同样吃里程碑倍数", () => {
    const s = initialState();
    s.levels["coffee" as string] = 20; // 1 × 20 × 2 = 40 点击加成
    expect(effectOf(s).clickPower).toBe(40);
  });

  it("marginalEffect：下一级的即时效果增量（含里程碑跳变）", () => {
    // phone lv19→20: 19 → 40，增量 21（而非 1）
    expect(marginalEffect("phone", 19).idleRate).toBe(21);
    expect(marginalEffect("phone", 19).clickPower ?? 0).toBe(0);
    // coffee lv0→1: 0 → 1
    expect(marginalEffect("coffee", 0).clickPower).toBe(1);
  });

  it("milestoneGap：距离下次 ×2 还差几级", () => {
    expect(milestoneGap("phone", 0)).toBe(20);
    expect(milestoneGap("phone", 15)).toBe(5);
    expect(milestoneGap("phone", 20)).toBe(20);
  });
});
