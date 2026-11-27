import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { offlineEarn } from "../src/engine/offline";
import { decorEffects, decorComplete, buyDecor, DECOR, DECOR_COMPLETE_BONUS } from "../src/engine/decor";
import { gain } from "../src/engine/state";

const now = Date.UTC(2026, 11, 1);
const created = now - 30 * 86400_000;
const baseState = () => ({
  ...initialState(),
  visits: { date: new Date(now).toLocaleDateString("sv-SE"), count: 3 },
  daily: { date: "", goals: [], claimed: false, streak: 28, lastCompleteDate: "", window: 0, claimsToday: 0 } as never,
});

/** 离线基准压到最低（0.7）：否则会撞 0.95 硬上限，看不出单件增量 */
function lowBase() {
  return {
    ...initialState(),
    visits: { date: new Date(now).toLocaleDateString("sv-SE"), count: 0 },
    daily: { date: "", goals: [], claimed: false, streak: 0, lastCompleteDate: "", window: 0, claimsToday: 0 } as never,
  };
}

describe("批次3 回归：家具离线加成走独立倍率（不被 95% 上限吃掉）", () => {
  it("rug/chair/catbed 的 offlineIncomeMult 正确相乘", () => {
    expect(decorEffects({ ...initialState(), decor: ["rug"] }).offlineIncomeMult).toBeCloseTo(1.1, 6);
    expect(decorEffects({ ...initialState(), decor: ["chair"] }).offlineIncomeMult).toBeCloseTo(1.18, 6);
    expect(decorEffects({ ...initialState(), decor: ["catbed"] }).offlineIncomeMult).toBeCloseTo(1.25, 6);
    expect(decorEffects({ ...initialState(), decor: ["rug", "chair", "catbed"] }).offlineIncomeMult).toBeCloseTo(1.1 * 1.18 * 1.25, 6);
  });

  it("离线结算真的乘上该倍率（cap 之后，不会被 95% 上限吞掉）", () => {
    const now = Date.now();
    const base = { ...initialState() };
    const withRug = { ...base, decor: ["rug"] };
    const no = offlineEarn(base, 3600, 0.95).earned;
    const has = offlineEarn(withRug, 3600, 0.95).earned;
    expect(has / no).toBeCloseTo(1.1, 4);
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
