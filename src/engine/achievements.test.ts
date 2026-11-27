import { describe, it, expect } from "vitest";
import { initialState } from "./state";
import {
  ACHIEVEMENTS,
  achByCategory,
  achDone,
  achDoneCount,
  achEffects,
  achLevel,
  achPoints,
  achById,
} from "./achievements";

const base = () => initialState();

describe("成就墙", () => {
  it("22 条成就、10 个分类、id 唯一", () => {
    expect(ACHIEVEMENTS).toHaveLength(22);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(22);
    expect(achByCategory(base())).toHaveLength(10);
  });

  it("新号：0 条完成（点击/图鉴/家具都是 0）", () => {
    expect(achPoints(base())).toBe(0);
    expect(achLevel(base())).toBe(1);
  });

  it("点击里程碑：1000 次点亮第一条", () => {
    const s = { ...base(), totalClicks: 1000 };
    expect(achDone(achById("click_1k")!, s)).toBe(true);
    expect(achPoints(s)).toBeGreaterThan(0);
  });

  it("图鉴 55/55 点亮全图鉴成就", () => {
    const s = {
      ...base(),
      collected: { quotes: Array.from({ length: 10 }, (_, i) => i), flavors: Array.from({ length: 45 }, (_, i) => i) },
    };
    expect(achDone(achById("codex_55")!, s)).toBe(true);
  });

  it("成就加成只来自已完成的成就", () => {
    const none = achEffects(base());
    expect(none.idleMult).toBe(1);
    expect(none.clickMult).toBe(1);
    const some = achEffects({ ...base(), totalClicks: 100_000 });
    expect(some.clickMult).toBeGreaterThan(1);
    expect(some.idleMult).toBe(1); // 点击成就只给点击加成
  });

  it("成就等级：每 4 条 1 级", () => {
    const s = { ...base(), totalClicks: 100_000, surviveStreak: 10, decor: ["plant", "lamp", "rug", "fridge"] };
    const n = achDoneCount(s);
    expect(achLevel(s)).toBe(Math.floor(n / 4) + 1);
  });

  it("分类进度合计 = 总数", () => {
    const cats = achByCategory(base());
    expect(cats.reduce((sum, c) => sum + c.total, 0)).toBe(ACHIEVEMENTS.length);
  });
});
