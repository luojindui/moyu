import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { advance } from "../src/engine/tick";
import { offlineEarn } from "../src/engine/offline";

/**
 * 审计探针 C：后台标签页（visibilitychange）恢复时的被动收益。
 * main.ts 主循环把 dt 钳制为 1s（rAF 在后台暂停，恢复后 now-last 可能是几十分钟），
 * 而 offlineEarn 只在 boot 时调用，visibilitychange 从 hidden→visible 不做任何结算。
 * 复刻 main.ts 第 96-99 行的帧推进逻辑验证：隐藏 30 分钟只补 1 秒收益。
 * 同时验证：刷新路径（boot 离线结算）不会重复计酬。
 */

const IDLE_RATE = 3; // 例：带薪蹲坑 ×1 = 3/秒

function resumeAfterHidden(hiddenSeconds: number): number {
  // 逐行复刻 main.ts 的帧推进：const dt = Math.min(1, (now - last) / 1000); state = advance(state, dt);
  let state = initialState();
  state.levels["toilet"] = 1; // 3/秒
  const last = 0;
  const now = hiddenSeconds * 1000;
  const dt = Math.min(1, (now - last) / 1000);
  state = advance(state, dt);
  return state.moyu;
}

describe("审计 C：隐藏标签页恢复收益（复刻 main.ts 帧逻辑）", () => {
  it("隐藏 30 分钟后恢复，应补足 idleRate × 1800s", () => {
    const gained = resumeAfterHidden(1800);
    console.log("恢复后实得:", gained, "应得:", IDLE_RATE * 1800);
    expect(gained).toBeCloseTo(IDLE_RATE * 1800, 1); // 🔴 实测只得到 3（=1 秒），丢 1799 秒
  });

  it("刷新路径：boot 离线结算不与帧循环重复计酬（dt 钳制上限 1s）", () => {
    // 关页面 → 8 小时后重开：boot 时 offlineEarn 结算 8h 封顶；恢复帧最多再给 1s → 不双发
    const offline = offlineEarn({ moyu: 0, levels: { toilet: 1 } }, 24 * 3600);
    const resumeFrame = Math.min(1, (24 * 3600 * 1000) / 1000); // 恢复第一帧钳到 1s
    const total = offline.earned + IDLE_RATE * Math.min(resumeFrame, 1);
    expect(offline.applied).toBe(8 * 3600);
    expect(total).toBeLessThanOrEqual(IDLE_RATE * (8 * 3600 + 1));
  });
});
