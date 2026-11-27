import { describe, it, expect } from "vitest";
import { initialState, gain } from "./state";
import { canPrestige, prestigeGain, doPrestige, prestigeMultiplier, PRESTIGE_UNLOCK, PRESTIGE_POINT_CAP } from "./prestige";
import { effectOf } from "./upgrades";
import { doClick } from "./actions";

describe("离职再就业（转生层）", () => {
  it("解锁门槛 1e8；未达标不可转生", () => {
    expect(PRESTIGE_UNLOCK).toBe(1e8);
    const s = gain(initialState(), 9e7);
    expect(canPrestige(s)).toBe(false);
    expect(prestigeGain(s)).toBe(0);
    expect(doPrestige(s)).toBeNull();
  });

  it("转生点 = floor(3 × (本局累计/1e8)^0.4)，单局封顶 20", () => {
    // 独立推定：1e8 → floor(3)=3；1e10 → floor(3×100^0.4)=floor(18.9)=18
    expect(prestigeGain(gain(initialState(), 1e8))).toBe(3);
    expect(prestigeGain(gain(initialState(), 1e10))).toBe(18);
    // 极大值封顶 20
    expect(prestigeGain(gain(initialState(), 1e20))).toBe(PRESTIGE_POINT_CAP);
  });

  it("每点永久 +75%（线性，避免指数爆炸）", () => {
    expect(prestigeMultiplier(0)).toBe(1);
    expect(prestigeMultiplier(1)).toBeCloseTo(1.75, 10);
    expect(prestigeMultiplier(4)).toBeCloseTo(4, 10);
    const s = { ...initialState(), prestige: 4 };
    expect(effectOf(s).idleRate).toBeCloseTo(0.2 * 4, 8);
  });

  it("转生重置本局（余额/等级/本局累计），保留图鉴/日报/历史累计/点击数", () => {
    let s = gain(initialState(), 2e8);
    s = { ...s, levels: { phone: 9 }, collected: { quotes: [1, 2], flavors: [3] }, totalClicks: 1234 };
    s = { ...s, daily: { date: "2026-11-27", goals: [], streak: 4, lastCompleteDate: "2026-11-26", claimed: true, window: 0, claimsToday: 1 } };
    const r = doPrestige(s)!;
    expect(r.gained).toBe(prestigeGain(s));
    expect(r.state.prestige).toBe(r.gained);
    expect(r.state.moyu).toBe(0);
    expect(r.state.levels).toEqual({ phone: 7 }); // 保留 80% 等级（9→7）
    expect(r.state.totalEarned).toBe(0);
    expect(r.state.lifetimeEarned).toBe(2e8);
    expect(r.state.collected.quotes).toEqual([1, 2]);
    expect(r.state.daily!.streak).toBe(4);
    expect(r.state.totalClicks).toBe(1234);
  });

  it("历史累计跨转生累加（段位不倒退）", () => {
    let s = gain(initialState(), 2e8);
    const first = doPrestige(s)!;
    s = gain(first.state, 1e8);
    const second = doPrestige(s)!;
    expect(second.state.lifetimeEarned).toBe(3e8);
    expect(second.state.prestige).toBe(first.state.prestige + second.gained);
  });

  it("转生后点击收益也吃倍率（复利生效）", () => {
    const s = { ...initialState(), prestige: 5 };
    expect(doClick(s).moyu).toBeCloseTo(1 * (1 + 0.75 * 5), 8);
  });
});
