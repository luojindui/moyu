import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { emptyArcade, finishGame } from "../src/engine/minigames";

const TODAY = "2026-11-27";
const st = () => ({ ...initialState(), arcade: emptyArcade(TODAY) });

describe("批次4 回归：早退不能刷奖励", () => {
  it("打满 30 秒：全额奖励", () => {
    const full = finishGame(st(), "findboss", 600, 1000, 30)!.reward;
    expect(full).toBe(25000);
  });

  it("玩 2 秒即退：按比例大幅缩水（不能与打满同额）", () => {
    const early = finishGame(st(), "findboss", 600, 1000, 2)!.reward;
    expect(early).toBeLessThan(full30() / 3);
  });

  it("玩 15 秒（≥1/3）即给全额", () => {
    expect(finishGame(st(), "findboss", 600, 1000, 15)!.reward).toBe(25000);
  });

  it("0 秒退出：奖励为 0", () => {
    expect(finishGame(st(), "findboss", 600, 1000, 0)!.reward).toBe(0);
  });
});

function full30(): number {
  return finishGame(st(), "findboss", 600, 1000, 30)!.reward;
}
