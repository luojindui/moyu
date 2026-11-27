import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { emptyArcade, finishGame, REF_SCORE, TARGET_IDLE_SECONDS, MAX_SCORE } from "../src/engine/minigames";

const TODAY = "2026-11-27";
const st = () => ({ ...initialState(), arcade: emptyArcade(TODAY) });

describe("批次4 回归：奖励跨阶段不漂移", () => {
  it("满分奖励 ≈ TARGET_IDLE_SECONDS 秒挂机收益（早期/中期/后期一致）", () => {
    for (const idle of [1, 1000, 100000]) {
      const r = finishGame(st(), "rhythm", REF_SCORE, idle)!;
      expect(r.reward).toBe(Math.floor(idle * TARGET_IDLE_SECONDS));
    }
  });

  it("奖励与分数成正比（半程 ≈ 一半）", () => {
    const full = finishGame(st(), "rhythm", REF_SCORE, 1000)!.reward;
    const half = finishGame(st(), "rhythm", REF_SCORE / 2, 1000)!.reward;
    expect(half).toBeCloseTo(full / 2, 0);
  });

  it("分数上限 MAX_SCORE 生效（篡改不会超额）", () => {
    const r = finishGame(st(), "rhythm", 1e9, 1000)!;
    expect(r.reward).toBe(Math.floor(1000 * TARGET_IDLE_SECONDS * 1)); // ratio 封顶 1
    expect(MAX_SCORE).toBeGreaterThanOrEqual(REF_SCORE);
  });

  it("早期不再出现 300 倍异常（idle=0.2 时满分奖励 = 5）", () => {
    const r = finishGame(st(), "rhythm", REF_SCORE, 0.2)!;
    expect(r.reward).toBe(Math.floor(0.2 * TARGET_IDLE_SECONDS));
  });
});
