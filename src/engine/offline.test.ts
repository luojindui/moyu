import { describe, it, expect } from "vitest";
import { offlineEarn } from "./offline";
import { initialState } from "./state";
import { UPGRADES } from "./upgrades";

describe("离线收益", () => {
  const idleState = () => {
    const s = initialState();
    const phone = UPGRADES.find((u) => u.id === "phone")!;
    s.levels[phone.id] = 5; // 5/秒 + 底薪 0.2 = 5.2/秒
    return s;
  };

  it("离线 30 分钟全额结算（首日新手钩子）", () => {
    const s = idleState();
    const r = offlineEarn(s, 30 * 60);
    // 独立推定：5.2/秒 × 1800s = 9360
    expect(r.earned).toBeCloseTo(9360, 6);
    expect(r.applied).toBe(30 * 60);
  });

  it("离线 24 小时封顶 8 小时", () => {
    const s = idleState();
    const r = offlineEarn(s, 24 * 3600);
    expect(r.applied).toBe(8 * 3600);
    expect(r.earned).toBeCloseTo(5.2 * 8 * 3600, 6);
  });

  it("非首日按 70% 效率结算（防首夜跳档）", () => {
    const s = idleState();
    const r = offlineEarn(s, 30 * 60, 0.7);
    // 独立推定：9360 × 0.7 = 6552
    expect(r.earned).toBeCloseTo(6552, 6);
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
