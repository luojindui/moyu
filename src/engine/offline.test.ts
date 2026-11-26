import { describe, it, expect } from "vitest";
import { offlineEarn } from "./offline";
import { initialState } from "./state";
import { UPGRADES } from "./upgrades";

describe("离线收益", () => {
  const idleState = () => {
    const s = initialState();
    const phone = UPGRADES.find((u) => u.id === "phone")!;
    s.levels[phone.id] = 5; // 偏移15：1×5×2^1 = 10/s + 底薪 0.2 = 10.2/秒
    return s;
  };

  it("离线 30 分钟全额结算（首日新手钩子）", () => {
    const s = idleState();
    const r = offlineEarn(s, 30 * 60);
    // 独立推定：10.2/秒 × 1800s = 18360
    expect(r.earned).toBeCloseTo(18360, 6);
    expect(r.applied).toBe(30 * 60);
  });

  it("离线 24 小时封顶 8 小时", () => {
    const s = idleState();
    const r = offlineEarn(s, 24 * 3600);
    expect(r.applied).toBe(8 * 3600);
    expect(r.earned).toBeCloseTo(10.2 * 8 * 3600, 6);
  });

  it("非首日按 70% 效率结算（防首夜跳档）", () => {
    const s = idleState();
    const r = offlineEarn(s, 30 * 60, 0.7);
    // 独立推定：18360 × 0.7 = 12852
    expect(r.earned).toBeCloseTo(12852, 6);
  });

  it("无挂机收益时底薪仍离线产出", () => {
    const r = offlineEarn(initialState(), 3600);
    expect(r.earned).toBeCloseTo(0.2 * 3600, 6);
  });

  it("elapsed 为负（时钟回拨）按 0 处理", () => {
    const r = offlineEarn(idleState(), -100);
    expect(r.earned).toBe(0);
    expect(r.applied).toBe(0);
  });
});
