import { describe, it, expect } from "vitest";
import { initialState, gain } from "./state";
import { DECOR, buyDecor, canBuyDecor, decorCount, decorEffects, ownsDecor } from "./decor";

const rich = (n = 1e12) => gain(initialState(), n);

describe("工位经营", () => {
  it("8 件家具，id 唯一", () => {
    expect(DECOR).toHaveLength(8);
    expect(new Set(DECOR.map((d) => d.id)).size).toBe(8);
  });

  it("购买：扣钱、入档、不可重复买", () => {
    const s = rich();
    const plant = DECOR[0]!;
    const r = buyDecor(s, "plant")!;
    expect(r.moyu).toBe(s.moyu - plant.cost);
    expect(ownsDecor(r, "plant")).toBe(true);
    expect(decorCount(r)).toBe(1);
    expect(buyDecor(r, "plant")).toBeNull();
  });

  it("钱不够不能买", () => {
    const s = { ...initialState(), moyu: 10 };
    expect(canBuyDecor(s, "plant")).toBe(false);
    expect(buyDecor(s, "plant")).toBeNull();
  });

  it("加成汇总：挂机/点击相乘、离线相加", () => {
    let s = rich();
    s = buyDecor(s, "plant")!; // idle 1.05
    s = buyDecor(s, "lamp")!; // click 1.15
    s = buyDecor(s, "rug")!; // offline +0.05
    s = buyDecor(s, "fridge")!; // idle 1.08
    const e = decorEffects(s);
    expect(e.idleMult).toBeCloseTo(1.05 * 1.08, 6);
    expect(e.clickMult).toBeCloseTo(1.15, 6);
    expect(e.offlineBonus).toBeCloseTo(0.05, 6);
  });

  it("未知 id 不生效", () => {
    const s = { ...rich(), decor: ["ghost"] };
    expect(decorEffects(s).idleMult).toBe(1);
    expect(decorCount(s)).toBe(0);
  });
});
