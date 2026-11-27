import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { offlineEarn } from "../src/engine/offline";
import { settleReturn } from "../src/engine/resume";
import { effectOf } from "../src/engine/upgrades";

/**
 * 审计探针 C（已修复后的回归版）：后台标签页恢复收益走 settleReturn 真链路。
 * 历史缺陷：rAF 后台暂停 + dt 钳制 1s + visibilitychange 不结算 → 隐藏 30 分钟只补 1 秒。
 * 修复：src/engine/resume.ts settleReturn 按真实时钟差补结算（≥5s 阈值）。
 */

function hiddenState() {
  const state = initialState();
  state.levels["toilet" as string] = 1; // 5/秒 + 底薪 0.2
  return state;
}

describe("审计 C（回归）：隐藏标签页恢复收益（settleReturn 真链路）", () => {
  it("隐藏 30 分钟后恢复，补足 idleRate × 1800s", () => {
    const rate = effectOf(hiddenState()).idleRate; // 5.2
    const r = settleReturn(hiddenState(), 0, 1800_000);
    console.log("恢复后实得:", r.earned, "应得:", rate * 1800);
    expect(r.applied).toBe(1800);
    expect(r.earned).toBeCloseTo(rate * 1800, 1);
    expect(r.showPanel).toBe(true);
  });

  it("短暂离开（<5s）不结算，避免正常帧抖动触发面板", () => {
    const r = settleReturn(hiddenState(), 0, 3_000);
    expect(r.earned).toBe(0);
    expect(r.showPanel).toBe(false);
  });

  it("刷新路径：boot 离线结算 8h 封顶，不与帧循环重复计酬", () => {
    const offline = offlineEarn({ ...hiddenState(), totalEarned: 0 }, 24 * 3600);
    const resumeFrameSeconds = Math.min(1, 24 * 3600); // 恢复第一帧钳到 1s
    const rate = effectOf(hiddenState()).idleRate;
    expect(offline.applied).toBe(8 * 3600);
    expect(offline.earned + rate * resumeFrameSeconds).toBeLessThanOrEqual(rate * (8 * 3600 + 1));
  });
});
