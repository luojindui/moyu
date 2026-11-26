import { describe, it, expect } from "vitest";
import { UPGRADES, costOf, effectOf, marginalEffect, milestoneGap, valueScoreOf } from "./upgrades";
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

  it("里程碑倍数：每满 20 级该项效果 ×2，错峰偏移 (index%4)×5 级", () => {
    const s = initialState();
    // coffee：表序 0 → 偏移 0，语义与规格场景一致：19→19/s，20→40/s
    s.levels["coffee" as string] = 20;
    expect(effectOf(s).clickPower).toBe(40);
    s.levels["coffee" as string] = 19;
    expect(effectOf(s).clickPower).toBe(19);
    // phone：表序 3 → 偏移 15，首次翻倍在第 5 级（5+15=20）
    s.levels = {};
    s.levels["phone" as string] = 5;
    expect(effectOf(s).idleRate - 0.2).toBe(10); // 1 × 5 × 2^1 = 10
    s.levels["phone" as string] = 19;
    expect(effectOf(s).idleRate - 0.2).toBe(38); // 1 × 19 × 2^1
    s.levels["phone" as string] = 24;
    expect(effectOf(s).idleRate - 0.2).toBe(48); // 1 × 24 × 2^1，还差 1 级到第二次翻倍
    s.levels["phone" as string] = 25;
    expect(effectOf(s).idleRate - 0.2).toBe(100); // 1 × 25 × 2^2
  });

  it("点击线同样吃里程碑倍数（coffee lv20 → +40）", () => {
    const s = initialState();
    s.levels["coffee" as string] = 20;
    expect(effectOf(s).clickPower).toBe(40);
  });

  it("marginalEffect：下一级的即时效果增量（含里程碑跳变）", () => {
    // coffee（偏移 0）lv19→20: 19 → 40，增量 21（而非 1）
    expect(marginalEffect("coffee", 19).clickPower).toBe(21);
    expect(marginalEffect("coffee", 19).idleRate).toBe(0);
    // phone（偏移 15）lv19→20 无跳变（首次翻倍在 lv5，第二次在 lv25）
    expect(marginalEffect("phone", 19).idleRate).toBe(2); // 19×2 → 20×2
    // coffee lv0→1: 0 → 1
    expect(marginalEffect("coffee", 0).clickPower).toBe(1);
  });

  it("milestoneGap：距离下次 ×2 还差几级（含偏移）", () => {
    // coffee（偏移 0）：lv0 差 20 级，lv15 差 5 级，lv20 重置差 20
    expect(milestoneGap("coffee", 0)).toBe(20);
    expect(milestoneGap("coffee", 15)).toBe(5);
    expect(milestoneGap("coffee", 20)).toBe(20);
    // phone（偏移 15）：lv0 差 5（首次翻倍在 lv5）
    expect(milestoneGap("phone", 0)).toBe(5);
    expect(milestoneGap("phone", 24)).toBe(1); // lv25 第二次翻倍
  });

  it("valueScoreOf：每万摸鱼值的边际效果（暴露性价比黑箱）", () => {
    // 独立推定：coffee lv0 价 15，边际 +1 点击力 → 1/15×10000 ≈ 666.7 点击力/万值
    const coffee0 = valueScoreOf("coffee", 0);
    expect(coffee0.click).toBeCloseTo(666.7, 1);
    expect(coffee0.idle).toBe(0);
    // 里程碑跳变级性价比应高于平时：coffee lv19 边际 21 点击力
    const price19 = costOf("coffee", 19);
    const coffee19 = valueScoreOf("coffee", 19);
    expect(coffee19.click).toBeCloseTo((21 / price19) * 10000, 3);
    expect(coffee19.click).toBeGreaterThan(coffee0.click); // 跳变级更值得等
  });
});
