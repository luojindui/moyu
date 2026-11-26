import { describe, it, expect } from "vitest";
import { advance } from "./tick";
import { initialState } from "./state";
import { UPGRADES, effectOf } from "./upgrades";

describe("被动收益 tick", () => {
  it("advance(60s) 增加挂机收益 × 60", () => {
    const s = initialState();
    const phone = UPGRADES.find((u) => u.id === "phone")!;
    s.levels[phone.id] = 2; // 1/秒 × 2 级 = 2/秒
    const rate = effectOf(s).idleRate;
    expect(rate).toBe(2);
    const out = advance(s, 60);
    expect(out.moyu).toBeCloseTo(s.moyu + rate * 60, 6);
  });

  it("无升级时 advance 不产出", () => {
    const s = initialState();
    const out = advance(s, 120);
    expect(out.moyu).toBe(s.moyu);
  });

  it("dt 为 0 或负数时不变化", () => {
    const s = initialState();
    s.levels["phone" as string] = 1;
    expect(advance(s, 0).moyu).toBe(s.moyu);
    expect(advance(s, -5).moyu).toBe(s.moyu);
  });
});
