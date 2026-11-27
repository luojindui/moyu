import { describe, it, expect } from "vitest";
import { initialState, gain } from "./state";
import { buyUpgrade } from "./actions";
import { computeStats, investedOf } from "./stats";
import { costOf } from "./upgrades";

describe("统计数据", () => {
  it("已投入 = 历次购买价格之和（与余额闭合）", () => {
    let s = gain(initialState(), 100_000);
    s.moyu = 100_000;
    let spent = 0;
    for (let i = 0; i < 5; i++) {
      const price = costOf("phone", s.levels["phone"] ?? 0);
      const next = buyUpgrade(s, "phone")!;
      spent += price;
      s = next;
    }
    expect(investedOf(s)).toBe(spent);
    expect(s.moyu + investedOf(s)).toBe(100_000); // 闭合
  });

  it("computeStats 汇总两本账与图鉴/转生", () => {
    let s = gain(initialState(), 5000);
    s = { ...s, prestige: 2, totalClicks: 300 };
    const st = computeStats(s);
    expect(st.lifetime).toBe(5000);
    expect(st.run).toBe(5000);
    expect(st.previous).toBe(0);
    expect(st.totalClicks).toBe(300);
    expect(st.prestige).toBe(2);
    expect(st.prestigeMult).toBeCloseTo(2.5, 6);
    expect(st.collectionTotal).toBe(55);
  });

  it("转生后：生涯 = 本局 + 往期", () => {
    let s = gain(initialState(), 3000);
    s = { ...s, totalEarned: 1000 }; // 模拟转生后本局只剩 1000
    const st = computeStats(s);
    expect(st.previous).toBe(2000);
  });
});
