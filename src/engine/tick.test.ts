import { describe, it, expect } from "vitest";
import { advance } from "./tick";
import { initialState } from "./state";
import { UPGRADES, effectOf } from "./upgrades";

describe("被动收益 tick", () => {
  it("advance(60s) 增加挂机收益 × 60（含底薪 0.2）", () => {
    const s = initialState();
    const phone = UPGRADES.find((u) => u.id === "phone")!;
    s.levels[phone.id] = 2; // 1/秒 × 2 级 + 底薪 0.2 = 2.2/秒
    const rate = effectOf(s).idleRate;
    expect(rate).toBeCloseTo(2.2, 10);
    const out = advance(s, 60);
    expect(out.moyu).toBeCloseTo(s.moyu + rate * 60, 6);
  });

  it("无升级时仅底薪推进", () => {
    const s = initialState();
    const out = advance(s, 60);
    // 独立推定：0.2 × 60 = 12
    expect(out.moyu).toBeCloseTo(12, 6);
  });

  it("dt 为 0 或负数时不变化", () => {
    const s = initialState();
    s.levels["phone" as string] = 1;
    expect(advance(s, 0).moyu).toBe(s.moyu);
    expect(advance(s, -5).moyu).toBe(s.moyu);
  });
});
