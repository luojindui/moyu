import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { emptyArcade, finishGame } from "../src/engine/minigames";

const TODAY = "2026-11-27";
const st = () => ({ ...initialState(), arcade: emptyArcade(TODAY) });

describe("批次4 回归：前 2 秒误触退还次数", () => {
  it("1.2 秒退出：不消耗次数、无奖励", () => {
    const r = finishGame(st(), "rhythm", 200, 100, 1.2)!;
    expect(r.state.arcade.played).toBe(0);
    expect(r.reward).toBe(0);
  });

  it("2.5 秒退出：消耗次数但奖励按比例缩水", () => {
    const r = finishGame(st(), "rhythm", 600, 1000, 2.5)!;
    expect(r.state.arcade.played).toBe(1);
    expect(r.reward).toBeGreaterThan(0);
    expect(r.reward).toBeLessThan(finishGame(st(), "rhythm", 600, 1000, 30)!.reward);
  });

  it("打满 30 秒：全额", () => {
    const r = finishGame(st(), "rhythm", 600, 1000, 30)!;
    expect(r.reward).toBe(25000);
  });
});
