import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { emptyEnergy, useEnergy, energyEffects } from "../src/engine/energy";
import { offlineEfficiency } from "../src/engine/progression";

const T = Date.UTC(2026, 11, 1);

describe("批次3 回归：focus 不再是被支配选项（硬核 P1-4）", () => {
  it("focus：点击力 ×2 且挂机 +8%（不是只有 20% 点击）", () => {
    const s = useEnergy({ ...initialState(), energy: emptyEnergy("2026-12-01") }, "focus")!;
    expect(energyEffects(s).clickMult).toBeCloseTo(2, 6);
    expect(energyEffects(s).idleMult).toBeCloseTo(1.08, 6);
  });
});

describe("批次3 回归：首日离线加成不被 1.0 截断（硬核 P1-2）", () => {
  it("建档首日：有地毯时离线效率 > 1（而不是恒 1）", () => {
    const now = Date.UTC(2026, 11, 1);
    const created = now - 3600_000; // 1 小时前建档（首日）
    const base = initialState();
    const noDecor = offlineEfficiency(base, created, now);
    const withRug = offlineEfficiency({ ...base, decor: ["rug"] }, created, now);
    expect(noDecor).toBe(1);
    expect(withRug).toBeCloseTo(1.05, 6);
  });
});
