import { describe, it, expect } from "vitest";
import { doClick, buyUpgrade } from "./actions";
import { initialState } from "./state";
import { UPGRADES, effectOf, costOf } from "./upgrades";

describe("点击与购买", () => {
  it("doClick 增加点击力对应的摸鱼值", () => {
    const s = initialState();
    const base = effectOf(s).clickPower + 1; // 初始点击力为 1
    const out = doClick(s);
    expect(out.moyu).toBe(s.moyu + base);
  });

  it("买得起：扣当前价、涨一级、价格上浮", () => {
    const s = initialState();
    const u = UPGRADES[0]!;
    s.moyu = costOf(u.id, 0) + 5;
    const out = buyUpgrade(s, u.id);
    expect(out).not.toBeNull();
    expect(out!.moyu).toBe(s.moyu - costOf(u.id, 0));
    expect(out!.levels[u.id]).toBe(1);
    expect(costOf(u.id, 1)).toBeGreaterThan(costOf(u.id, 0));
  });

  it("买不起：拒绝且状态不变", () => {
    const s = initialState();
    const u = UPGRADES[0]!;
    s.moyu = costOf(u.id, 0) - 1;
    expect(buyUpgrade(s, u.id)).toBeNull();
    expect(s.moyu).toBe(costOf(u.id, 0) - 1);
    expect(s.levels[u.id]).toBeUndefined();
  });

  it("未知升级 id 拒绝", () => {
    expect(buyUpgrade(initialState(), "nope")).toBeNull();
  });
});
