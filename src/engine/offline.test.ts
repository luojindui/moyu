import { describe, it, expect } from "vitest";
import { offlineEarn } from "./offline";
import { initialState } from "./state";
import { UPGRADES } from "./upgrades";

describe("离线收益", () => {
  const idleState = () => {
    const s = initialState();
    const phone = UPGRADES.find((u) => u.id === "phone")!;
    s.levels[phone.id] = 5; // 5/秒
    return s;
  };

  it("离线 30 分钟全额结算", () => {
    const s = idleState();
    const r = offlineEarn(s, 30 * 60);
    // 独立推定：5/秒 × 1800s = 9000
    expect(r.earned).toBe(9000);
    expect(r.applied).toBe(30 * 60);
  });

  it("离线 24 小时封顶 8 小时", () => {
    const s = idleState();
    const r = offlineEarn(s, 24 * 3600);
    expect(r.applied).toBe(8 * 3600);
    expect(r.earned).toBe(5 * 8 * 3600);
  });

  it("无挂机收益离线为 0", () => {
    const r = offlineEarn(initialState(), 3600);
    expect(r.earned).toBe(0);
  });

  it("elapsed 为负（时钟回拨）按 0 处理", () => {
    const r = offlineEarn(idleState(), -100);
    expect(r.earned).toBe(0);
    expect(r.applied).toBe(0);
  });
});
