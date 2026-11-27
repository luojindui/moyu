/**
 * probe-r4v-nurture-collection.test.ts — 验收 1：摸鱼图鉴 55 条
 * 只 import ../src/engine/*，不改 src/。
 */
import { describe, it, expect } from "vitest";
import {
  TOTAL_ITEMS,
  flavorIndex,
  collectQuote,
  collectFlavor,
  syncFlavorCollection,
  collectionCount,
  emptyCollected,
} from "../src/engine/collection";
import { initialState, type GameState } from "../src/engine/state";
import { UPGRADES } from "../src/engine/upgrades";
import { MEME_QUOTES, UPGRADE_FLAVOR, flavorFor } from "../src/engine/flavor";

function log(label: string, value: unknown): void {
  console.log(`[r4v-collection] ${label}`, JSON.stringify(value));
}

/** 各升级取 level 时应解锁的彩蛋档数（Lv.1/5/10/20/50） */
const EXPECTED_TIERS: Array<[number, number]> = [
  [0, 0], [1, 1], [4, 1], [5, 2], [9, 2], [10, 3], [19, 3], [20, 4], [49, 4], [50, 5], [1000, 5],
];

describe("图鉴·总量与索引域（55 = 10 语录 + 9 升级×5 档）", () => {
  it("总量常量：TOTAL_ITEMS=55，语录 10 条、升级 9 项且每项 5 档文案", () => {
    expect(TOTAL_ITEMS).toBe(55);
    expect(MEME_QUOTES.length).toBe(10);
    expect(UPGRADES.length).toBe(9);
    expect(Object.keys(UPGRADE_FLAVOR).length).toBe(9);
    for (const u of UPGRADES) {
      const lines = UPGRADE_FLAVOR[u.id];
      expect(lines).toBeDefined();
      expect(lines).toHaveLength(5);
      expect(lines.every((s) => typeof s === "string" && s.length > 0)).toBe(true);
    }
    // 升级表与彩蛋表 id 一一对应（表序即索引基座）
    expect(Object.keys(UPGRADE_FLAVOR).sort()).toEqual(UPGRADES.map((u) => u.id).sort());
    log("总量", { TOTAL_ITEMS, quotes: MEME_QUOTES.length, upgrades: UPGRADES.length, flavor: 45 });
  });

  it("彩蛋索引域 0..44 全覆盖、无重复、无越界；语录域 0..9 全覆盖", () => {
    const idx: number[] = [];
    for (const u of UPGRADES) for (let t = 0; t < 5; t++) idx.push(flavorIndex(u.id, t));
    expect(idx).toHaveLength(45);
    expect(new Set(idx).size).toBe(45);
    expect(Math.min(...idx)).toBe(0);
    expect(Math.max(...idx)).toBe(44);
    expect(idx.every((i) => Number.isInteger(i) && i >= 0 && i < 45)).toBe(true);
    log("彩蛋索引", { count: 45, min: 0, max: 44, unique: 45 });
  });

  it("全量合法收集恰好 55 条，且语录/彩蛋两个命名空间互不串档", () => {
    let s: GameState = initialState();
    for (let i = 0; i < MEME_QUOTES.length; i++) s = collectQuote(s, i).state;
    for (const u of UPGRADES) for (let t = 0; t < 5; t++) s = collectFlavor(s, u.id, t).state;
    expect(collectionCount(s)).toBe(55);
    expect(new Set(s.collected.quotes).size).toBe(10);
    expect(new Set(s.collected.flavors).size).toBe(45);
    // 反证串档：只收语录时彩蛋为空，只收彩蛋时语录为空
    let q = initialState();
    for (let i = 0; i < 10; i++) q = collectQuote(q, i).state;
    expect(q.collected.flavors).toEqual([]);
    let f = initialState();
    for (const u of UPGRADES) f = collectFlavor(f, u.id, 0).state;
    expect(f.collected.quotes).toEqual([]);
    log("全收集", { total: collectionCount(s), quotes: 10, flavors: 45 });
  });

  it("重复入册不重复计（isNew=false 且引用不变）", () => {
    const s0 = initialState();
    const a = collectQuote(s0, 3);
    const b = collectQuote(a.state, 3);
    expect(a.isNew).toBe(true);
    expect(b.isNew).toBe(false);
    expect(b.state).toBe(a.state);
    const c = collectFlavor(a.state, "coffee", 2);
    const d = collectFlavor(c.state, "coffee", 2);
    expect(c.isNew).toBe(true);
    expect(d.isNew).toBe(false);
    expect(collectionCount(d.state)).toBe(2);
  });

  it("emptyCollected 每次返回新数组（无共享可变引用）", () => {
    const a = emptyCollected();
    a.quotes.push(1);
    expect(emptyCollected().quotes).toEqual([]);
  });
});

describe("图鉴·syncFlavorCollection 按等级补齐历史档（幂等）", () => {
  it("coffee Lv22 → 补齐 Lv1/5/10/20 四档（索引 0..3）", () => {
    const s0 = initialState();
    s0.levels["coffee"] = 22;
    const s = syncFlavorCollection(s0);
    const coffee = (i: number): number => UPGRADES.findIndex((u) => u.id === "coffee") * 5 + i;
    expect(s.collected.flavors).toEqual([coffee(0), coffee(1), coffee(2), coffee(3)]);
    expect(collectionCount(s)).toBe(4);
    log("coffee Lv22", { flavors: s.collected.flavors, count: collectionCount(s) });
  });

  it("档位阈值全覆盖：Lv0..1000 → 0/1/2/3/4/5 档，且与 flavorFor 文案档一致", () => {
    for (const [lv, tiers] of EXPECTED_TIERS) {
      const s0 = initialState();
      s0.levels["coffee"] = lv;
      const s = syncFlavorCollection(s0);
      expect(s.collected.flavors).toHaveLength(tiers);
      const lines = UPGRADE_FLAVOR["coffee"]!;
      // 最高解锁档的文案必须等于 flavorFor 在该等级返回的文案（两套阈值不漂移）
      const highest = s.collected.flavors.at(-1);
      if (tiers > 0 && highest !== undefined) {
        expect(lines[highest % 5]).toBe(flavorFor("coffee", lv));
      } else {
        expect(flavorFor("coffee", lv)).toBeNull();
      }
    }
    log("档位阈值", EXPECTED_TIERS);
  });

  it("幂等：无缺失时返回同一引用；重复调用不增量、不去重已有条目", () => {
    const s0 = initialState();
    s0.levels["phone"] = 10;
    const once = syncFlavorCollection(s0);
    const twice = syncFlavorCollection(once);
    expect(twice).toBe(once); // 无缺失 → 同引用
    expect(twice.collected.flavors).toHaveLength(3);
    // 已有部分条目（旧档只存了第 0 档）→ 只补缺失的 1/2 档，且不丢弃无关已有条目
    const phoneBase = UPGRADES.findIndex((u) => u.id === "phone") * 5;
    const partial = initialState();
    partial.levels["phone"] = 10;
    partial.collected.flavors = [phoneBase, 20]; // 20 = 另一项的彩蛋，应保留
    const filled = syncFlavorCollection(partial);
    expect(filled.collected.flavors).toEqual([phoneBase, 20, phoneBase + 1, phoneBase + 2]);
    expect(syncFlavorCollection(filled).collected.flavors).toEqual([phoneBase, 20, phoneBase + 1, phoneBase + 2]);
    log("幂等/补缺", { once: once.collected.flavors, filled: filled.collected.flavors });
  });

  it("全项 Lv1000 → 45 档全解锁；一档不重复不越界", () => {
    const s0 = initialState();
    for (const u of UPGRADES) s0.levels[u.id] = 1000;
    const s = syncFlavorCollection(s0);
    expect(s.collected.flavors).toHaveLength(45);
    expect(new Set(s.collected.flavors).size).toBe(45);
    expect(s.collected.flavors.every((i) => Number.isInteger(i) && i >= 0 && i <= 44)).toBe(true);
    expect(collectionCount(s)).toBe(45);
    // 再跑一次幂等
    expect(syncFlavorCollection(s).collected.flavors).toHaveLength(45);
    log("全 Lv1000", { flavors: 45, count: collectionCount(s) });
  });
});

describe("图鉴·边界与缺陷复现（预期失败 = 缺陷证据）", () => {
  it("✅ 已修复回归（原缺陷）：collectQuote 不校验索引边界，越界索引可污染「x/10」", () => {
    const s = collectQuote(initialState(), 99).state;
    log("collectQuote(99)", { quotes: s.collected.quotes, count: collectionCount(s) });
    expect(s.collected.quotes.every((i) => Number.isInteger(i) && i >= 0 && i < MEME_QUOTES.length)).toBe(true);
  });

  it("✅ 已修复回归（原缺陷）：collectQuote 接受负数索引", () => {
    const s = collectQuote(initialState(), -1).state;
    log("collectQuote(-1)", { quotes: s.collected.quotes });
    expect(s.collected.quotes.every((i) => i >= 0)).toBe(true);
  });

  it("✅ 已修复回归（原缺陷）：collectFlavor 未知升级 id → findIndex(-1) 生成负索引（-5）", () => {
    const s = collectFlavor(initialState(), "no_such_upgrade", 0).state;
    log("collectFlavor(unknown)", { flavors: s.collected.flavors, flavorIndex: flavorIndex("no_such_upgrade", 0) });
    expect(s.collected.flavors.every((i) => i >= 0 && i <= 44)).toBe(true);
  });

  it("📌 已知映射语义：tier 越界（5）会串到下一项的第 0 档（内部调用不会传入，仅记录）", () => {
    expect(flavorIndex("coffee", 5)).toBe(flavorIndex("water", 0));
  });
});
