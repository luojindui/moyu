import { describe, it, expect } from "vitest";
import { settleReturn, RESUME_SETTLE_THRESHOLD_SECONDS } from "./resume";
import { initialState } from "./state";

describe("切后台回归结算", () => {
  const idleState = () => {
    const s = initialState();
    s.levels["phone" as string] = 5; // 5/秒
    return s;
  };

  it("离开超过阈值：按真实缺口全额结算并要求弹面板", () => {
    const s = idleState();
    // 独立推定：phone×5 偏移15 → (10 + 0.2底薪) × 300s = 3060
    const r = settleReturn(s, 0, 300_000);
    expect(r.applied).toBe(300);
    expect(r.earned).toBeCloseTo(3060, 6);
    expect(r.showPanel).toBe(true);
  });

  it("短暂离开（低于阈值）：不结算、不弹面板", () => {
    const s = idleState();
    const r = settleReturn(s, 0, 3_000);
    expect(r.applied).toBe(0);
    expect(r.earned).toBe(0);
    expect(r.showPanel).toBe(false);
  });

  it("超长离开按 8h 封顶", () => {
    const r = settleReturn(idleState(), 0, 24 * 3600 * 1000);
    expect(r.applied).toBe(8 * 3600);
  });

  it("时钟回拨（now < last）按 0 处理", () => {
    const r = settleReturn(idleState(), 100_000, 50_000);
    expect(r.applied).toBe(0);
    expect(r.earned).toBe(0);
    expect(r.showPanel).toBe(false);
  });

  it("阈值本身低于常规自动存档间隔，避免双结算竞态", () => {
    expect(RESUME_SETTLE_THRESHOLD_SECONDS).toBeLessThan(10);
  });
});
