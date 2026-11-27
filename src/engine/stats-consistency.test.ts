import { describe, it, expect } from "vitest";
import { initialState, gain, lose } from "./state";
import { restore, SAVE_KEY } from "./save";
import { onBossTap, newEventState } from "./events";
import { rankFor } from "./titles";
import { doPrestige } from "./prestige";

const mem = (prefill: Record<string, string> = {}) => {
  const store = new Map(Object.entries(prefill));
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
};

describe("R9 数据显示一致性", () => {
  it("罚款不扣 lifetimeEarned（历史累计单调，段位不倒退）", () => {
    const s = gain(initialState(), 10_000);
    const r = lose(s, 300);
    expect(r.state.totalEarned).toBe(9_700);
    expect(r.state.lifetimeEarned).toBe(10_000); // 毛收入不减
    expect(rankFor(r.state.lifetimeEarned).current).toBe(rankFor(10_000).current);
  });

  it("lifetime ≥ total ≥ moyu 不变量", () => {
    let s = gain(initialState(), 5000);
    s = { ...s, moyu: 5000 };
    expect(s.lifetimeEarned).toBeGreaterThanOrEqual(s.totalEarned);
    expect(s.totalEarned).toBeGreaterThanOrEqual(s.moyu);
  });

  it("事件点击也计入 totalClicks（点击线彩蛋/日报口径一致）", () => {
    const s = { ...initialState(), moyu: 1000 };
    const es = { ...newEventState(), bossUntil: 10, bossStartAt: 0, patrolCount: 9 };
    const r1 = onBossTap(s, es, 5);
    expect(r1.state.totalClicks).toBe(1);
  });

  it("restore 钳制跨字段（篡改 moyu > total > lifetime 被收敛）", () => {
    const a = mem({
      [SAVE_KEY]: JSON.stringify({ v: 1, moyu: 1e9, totalEarned: 0, lifetimeEarned: 0, levels: {}, savedAt: Date.now() - 1000 }),
    });
    const r = restore(a, Date.now());
    const st = r.state!;
    expect(st.lifetimeEarned).toBeGreaterThanOrEqual(st.totalEarned);
    expect(st.totalEarned).toBeGreaterThanOrEqual(st.moyu);
    expect(st.moyu).toBe(0);
  });

  it("转生后 lifetime 保留、total 归零（段位口径用 lifetime）", () => {
    let s = gain(initialState(), 2e8);
    const r = doPrestige(s)!;
    expect(r.state.totalEarned).toBe(0);
    expect(r.state.lifetimeEarned).toBe(2e8);
    expect(rankFor(r.state.lifetimeEarned).current).toBe(rankFor(2e8).current);
  });
});
