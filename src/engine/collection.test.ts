import { describe, it, expect } from "vitest";
import {
  collectQuote,
  collectFlavor,
  collectionCount,
  syncFlavorCollection,
  TOTAL_ITEMS,
  flavorIndex,
  collectionRows,
} from "./collection";
import { initialState } from "./state";
import { UPGRADES } from "./upgrades";
import { MEME_QUOTES, UPGRADE_FLAVOR } from "./flavor";

describe("摸鱼图鉴（收集）", () => {
  it("collectQuote：新语录入册、重复不重复计", () => {
    let s = initialState();
    const r1 = collectQuote(s, 3);
    expect(r1.isNew).toBe(true);
    expect(r1.state.collected.quotes).toEqual([3]);
    const r2 = collectQuote(r1.state, 3);
    expect(r2.isNew).toBe(false);
    expect(r2.state.collected.quotes).toEqual([3]);
    expect(r2.state).toBe(r1.state); // 无新条目时引用不变
  });

  it("flavorIndex：升级表序 × 档位 → 0..54 唯一索引", () => {
    expect(flavorIndex("coffee", 0)).toBe(0);
    expect(flavorIndex("coffee", 4)).toBe(4);
    expect(flavorIndex("water", 0)).toBe(5);
    expect(flavorIndex("retire", 4)).toBe(8 * 5 + 4);
  });

  it("collectFlavor：新彩蛋入册", () => {
    const s = initialState();
    const r = collectFlavor(s, "coffee", 2);
    expect(r.isNew).toBe(true);
    expect(r.state.collected.flavors).toEqual([2]);
  });

  it("collectionCount：语录 + 彩蛋合计，TOTAL = 语录数 + 45", () => {
    let s = initialState();
    s = collectQuote(s, 0).state;
    s = collectFlavor(s, "coffee", 0).state;
    expect(collectionCount(s)).toBe(2);
    expect(TOTAL_ITEMS).toBe(MEME_QUOTES.length + UPGRADES.length * 5);
    expect(UPGRADE_FLAVOR["retire"]).toHaveLength(5);
  });

  it("syncFlavorCollection：按当前等级补齐历史档（coffee Lv22 → 1/5/10/20 四档）", () => {
    let s = initialState();
    s.levels["coffee" as string] = 22;
    s = syncFlavorCollection(s);
    const coffeeIdx = UPGRADES.findIndex((u) => u.id === "coffee")! * 5;
    expect(s.collected.flavors).toEqual([coffeeIdx + 0, coffeeIdx + 1, coffeeIdx + 2, coffeeIdx + 3]);
    // 幂等：再跑一遍不变
    const again = syncFlavorCollection(s);
    expect(again.collected.flavors).toHaveLength(4);
  });
});

describe("图鉴边界与净化（nurture 验收 #4）", () => {
  it("collectQuote 拒绝越界/负数索引", () => {
    const s = initialState();
    expect(collectQuote(s, 99).isNew).toBe(false);
    expect(collectQuote(s, -5).isNew).toBe(false);
    expect(collectQuote(s, 0).isNew).toBe(true);
  });

  it("collectFlavor 拒绝未知升级 id 与越界档位", () => {
    const s = initialState();
    expect(collectFlavor(s, "nope", 0).isNew).toBe(false);
    expect(collectFlavor(s, "coffee", 9).isNew).toBe(false);
    expect(collectFlavor(s, "coffee", 4).isNew).toBe(true);
  });

  it("collectionCount 不超过 TOTAL_ITEMS（篡改档收敛）", () => {
    const s = { ...initialState(), collected: { quotes: [0, 0, 0, 1], flavors: [0, 0] } };
    expect(collectionCount(s)).toBe(3); // 去重后 2 + 1
  });
});

describe("图鉴可浏览列表（variety 建议 #2：???" , () => {
  it("collectionRows：55 格，含分组/名称/是否解锁/文本", () => {
    const s = initialState();
    s.collected.quotes = [0, 2];
    s.collected.flavors = [0, 5];
    const rows = collectionRows(s);
    expect(rows.filter((r) => r.group === "quote")).toHaveLength(10);
    expect(rows.filter((r) => r.group === "flavor")).toHaveLength(45);
    expect(rows).toHaveLength(55);
    // 解锁项带原文；未解锁为 ??? 占位
    const q0 = rows.find((r) => r.group === "quote" && r.index === 0)!;
    expect(q0.unlocked).toBe(true);
    expect(q0.text).toBe(MEME_QUOTES[0]);
    const q1 = rows.find((r) => r.group === "quote" && r.index === 1)!;
    expect(q1.unlocked).toBe(false);
    expect(q1.text).toBe("???");
    // 每组按顺序：quote 先、flavor 后
    expect(rows[0]!.group).toBe("quote");
    expect(rows[rows.length - 1]!.group).toBe("flavor");
  });
});
