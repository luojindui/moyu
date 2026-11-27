import { describe, it, expect } from "vitest";
import {
  collectQuote,
  collectFlavor,
  collectionCount,
  syncFlavorCollection,
  TOTAL_ITEMS,
  flavorIndex,
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
