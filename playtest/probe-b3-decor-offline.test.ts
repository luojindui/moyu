import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { offlineEfficiency } from "../src/engine/progression";
import { decorEffects, decorComplete, buyDecor, DECOR, DECOR_COMPLETE_BONUS } from "../src/engine/decor";
import { gain } from "../src/engine/state";

const now = Date.UTC(2026, 11, 1);
const created = now - 30 * 86400_000;
const baseState = () => ({
  ...initialState(),
  visits: { date: new Date(now).toLocaleDateString("sv-SE"), count: 3 },
  daily: { date: "", goals: [], claimed: false, streak: 28, lastCompleteDate: "", window: 0, claimsToday: 0 } as never,
});

describe("批次3 回归：离线加成不被重复计算（D11）", () => {
  it("单件家具的离线加成只计一次（rug +5%）", () => {
    const s = baseState();
    const no = offlineEfficiency(s, created, now);
    const withRug = offlineEfficiency({ ...s, decor: ["rug"] }, created, now);
    expect(withRug - no).toBeCloseTo(0.05, 6); // 不是 0.10
  });

  it("chair +8% 与 catbed +10% 也都只计一次", () => {
    const s = baseState();
    const no = offlineEfficiency(s, created, now);
    expect(offlineEfficiency({ ...s, decor: ["chair"] }, created, now) - no).toBeCloseTo(0.08, 6);
    expect(offlineEfficiency({ ...s, decor: ["catbed"] }, created, now) - no).toBeCloseTo(0.1, 6);
    expect(offlineEfficiency({ ...s, decor: ["rug", "chair", "catbed"] }, created, now) - no).toBeCloseTo(0.23, 6);
  });
});

describe("批次3 回归：8/8 集齐奖励（D15）", () => {
  it("集齐 8 件后挂机额外 ×1.1，且写进规格", () => {
    let s = gain(initialState(), 1e12);
    for (const d of DECOR) s = buyDecor(s, d.id)!;
    expect(decorComplete(s)).toBe(true);
    const eff = decorEffects(s);
    const product = DECOR.reduce((m, d) => m * (d.effects.idleMult ?? 1), 1);
    expect(eff.idleMult).toBeCloseTo(product * (1 + DECOR_COMPLETE_BONUS), 6);
  });

  it("未集齐时没有额外奖励", () => {
    let s = gain(initialState(), 1e12);
    for (const d of DECOR.slice(0, 7)) s = buyDecor(s, d.id)!;
    expect(decorComplete(s)).toBe(false);
    const eff = decorEffects(s);
    const product = DECOR.slice(0, 7).reduce((m, d) => m * (d.effects.idleMult ?? 1), 1);
    expect(eff.idleMult).toBeCloseTo(product, 6);
  });
});
