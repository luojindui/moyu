/**
 * probe-final-collect-collection.test.ts — 终验探针 ①：图鉴 55 格 / 净化 / 幂等
 * 只读 src/，不改 src/；以真实 engine 逻辑独立断言（不复用 src 内测试）。
 */
import { describe, it, expect } from "vitest";
import {
  collectionRows,
  collectionCount,
  collectQuote,
  collectFlavor,
  syncFlavorCollection,
  sanitizeCollected,
  flavorIndex,
  TOTAL_ITEMS,
  type CollectionRow,
} from "../src/engine/collection";
import { initialState, type GameState } from "../src/engine/state";
import { UPGRADES } from "../src/engine/upgrades";
import { MEME_QUOTES, UPGRADE_FLAVOR } from "../src/engine/flavor";
import { restore, serialize, SAVE_KEY, type SaveAdapter } from "../src/engine/save";

function memAdapter(raw?: string): SaveAdapter {
  let v = raw ?? null;
  return {
    getItem: (k) => (k === SAVE_KEY ? v : null),
    setItem: (_k, val) => {
      v = val;
    },
    removeItem: () => {
      v = null;
    },
  };
}

const key = (r: CollectionRow): string => `${r.group}:${r.index}`;

function compact(rows: CollectionRow[]): { total: number; on: number; off: number; lockedLabel: string[] } {
  return {
    total: rows.length,
    on: rows.filter((r) => r.unlocked).length,
    off: rows.filter((r) => !r.unlocked).length,
    lockedLabel: [...new Set(rows.filter((r) => !r.unlocked).map((r) => r.text))],
  };
}

describe("① 图鉴 55 格：行数 / 唯一性 / 解锁内容", () => {
  it("TOTAL=55（quote 10 + flavor 45），与数据源一致", () => {
    expect(MEME_QUOTES.length).toBe(10);
    expect(UPGRADES.length).toBe(9);
    expect(UPGRADES.length * 5).toBe(45);
    expect(TOTAL_ITEMS).toBe(55);
    const rows = collectionRows(initialState());
    expect(rows).toHaveLength(55);
    expect(rows.filter((r) => r.group === "quote")).toHaveLength(10);
    expect(rows.filter((r) => r.group === "flavor")).toHaveLength(45);
  });

  it("无重复格：quote 索引恰为 0..9、flavor 索引恰为 0..44，(group,index) 组合 55 个唯一", () => {
    const rows = collectionRows(initialState());
    const keys = new Set(rows.map(key));
    expect(keys.size).toBe(55);
    expect(rows.filter((r) => r.group === "quote").map((r) => r.index).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 10 }, (_, i) => i),
    );
    expect(rows.filter((r) => r.group === "flavor").map((r) => r.index).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 45 }, (_, i) => i),
    );
    // flavor 行顺序 = 升级表序 × 5 档，与 flavorIndex 映射一致
    UPGRADES.forEach((u, ui) => {
      for (let t = 0; t < 5; t++) {
        const row = rows.find((r) => r.group === "flavor" && r.index === flavorIndex(u.id, t))!;
        expect(row).toBeTruthy();
        expect(row.label).toContain(u.name);
      }
    });
  });

  it("初始态：55 格全未解锁，text 全为 ???", () => {
    const rows = collectionRows(initialState());
    expect(rows.every((r) => !r.unlocked)).toBe(true);
    expect(rows.every((r) => r.text === "???")).toBe(true);
    expect(compact(rows)).toMatchObject({ total: 55, on: 0, off: 55, lockedLabel: ["???"] });
    expect(collectionCount(initialState())).toBe(0);
  });

  it("部分解锁：解锁格显示真实文本/标签，未解锁格保持 ???", () => {
    const s = initialState();
    s.collected.quotes = [0, 3, 9];
    s.collected.flavors = [0, 4, 5, 44]; // coffee Lv.1 / Lv.50, water Lv.1, retire Lv.50
    const rows = collectionRows(s);
    const on = rows.filter((r) => r.unlocked);
    expect(on).toHaveLength(7);
    expect(rows.filter((r) => !r.unlocked)).toHaveLength(48);

    const q0 = rows.find((r) => r.group === "quote" && r.index === 0)!;
    expect(q0.unlocked).toBe(true);
    expect(q0.text).toBe(MEME_QUOTES[0]);
    expect(q0.label).toBe("语录 1");
    const q1 = rows.find((r) => r.group === "quote" && r.index === 1)!;
    expect(q1.unlocked).toBe(false);
    expect(q1.text).toBe("???");
    // 未解锁格不能泄露原文
    for (const r of rows.filter((x) => !x.unlocked)) expect(r.text).toBe("???");

    const coffeeLv1 = rows.find((r) => r.group === "flavor" && r.index === 0)!;
    expect(coffeeLv1.unlocked).toBe(true);
    expect(coffeeLv1.text).toBe(UPGRADE_FLAVOR["coffee"]![0]);
    expect(coffeeLv1.label).toContain("咖啡续命");
    const coffeeLv5 = rows.find((r) => r.group === "flavor" && r.index === 1)!;
    expect(coffeeLv5.unlocked).toBe(false);
    expect(coffeeLv5.text).toBe("???");

    const retireLv50 = rows.find((r) => r.group === "flavor" && r.index === 44)!;
    expect(retireLv50.unlocked).toBe(true);
    expect(retireLv50.text).toBe(UPGRADE_FLAVOR["retire"]![4]);

    expect(collectionCount(s)).toBe(7);
    expect(collectionCount(s)).toBe(rows.filter((r) => r.unlocked).length);
  });

  it("全收集：10+45=55 格全亮、无 ???、计数 55", () => {
    const s = initialState();
    s.collected.quotes = Array.from({ length: 10 }, (_, i) => i);
    s.collected.flavors = Array.from({ length: 45 }, (_, i) => i);
    const rows = collectionRows(s);
    expect(rows.filter((r) => r.unlocked)).toHaveLength(55);
    expect(rows.every((r) => r.text !== "???")).toBe(true);
    expect(collectionCount(s)).toBe(TOTAL_ITEMS);
  });
});

describe("① syncFlavorCollection：按等级补齐、幂等", () => {
  it("等级 → 档位（Lv.1/5/10/20/50）独立推定", () => {
    const cases: [number, number][] = [
      [0, 0],
      [1, 1],
      [4, 1],
      [5, 2],
      [9, 2],
      [10, 3],
      [19, 3],
      [20, 4],
      [49, 4],
      [50, 5],
      [999, 5],
    ];
    for (const [lv, want] of cases) {
      const s: GameState = { ...initialState(), levels: { coffee: lv } };
      const out = syncFlavorCollection(s);
      const coffeeIdx = UPGRADES.findIndex((u) => u.id === "coffee") * 5;
      expect(out.collected.flavors).toEqual(Array.from({ length: want }, (_, t) => coffeeIdx + t));
    }
  });

  it("多升级混合等级：只补缺失档，不改语录/已有彩蛋", () => {
    const s: GameState = {
      ...initialState(),
      levels: { coffee: 22, retire: 50, phone: 3 },
      collected: { quotes: [2], flavors: [0] }, // coffee Lv.1 已存在
    };
    const out = syncFlavorCollection(s);
    expect(out.collected.quotes).toEqual([2]);
    const coffeeIdx = UPGRADES.findIndex((u) => u.id === "coffee") * 5;
    const retireIdx = UPGRADES.findIndex((u) => u.id === "retire") * 5;
    const phoneIdx = UPGRADES.findIndex((u) => u.id === "phone") * 5;
    // coffee Lv22 → 档 0..3；retire Lv50 → 0..4；phone Lv3 → 档 0
    expect(new Set(out.collected.flavors)).toEqual(
      new Set([0, coffeeIdx + 1, coffeeIdx + 2, coffeeIdx + 3, retireIdx, retireIdx + 1, retireIdx + 2, retireIdx + 3, retireIdx + 4, phoneIdx]),
    );
    expect(new Set(out.collected.flavors).size).toBe(out.collected.flavors.length); // 无重复
    expect(collectionCount(out)).toBe(11);
  });

  it("幂等：二次调用引用不变、内容不变", () => {
    const s: GameState = { ...initialState(), levels: { coffee: 22, water: 5 } };
    const once = syncFlavorCollection(s);
    const twice = syncFlavorCollection(once);
    expect(twice).toBe(once);
    expect(syncFlavorCollection(initialState())).toEqual(initialState());
  });

  it("购买后同步：collectFlavor + sync 不产生重复索引", () => {
    let s = initialState();
    s = collectFlavor(s, "coffee", 0).state;
    s = { ...s, levels: { coffee: 5 } };
    s = syncFlavorCollection(s);
    const coffeeIdx = flavorIndex("coffee", 0);
    expect(s.collected.flavors.filter((i) => i === coffeeIdx)).toHaveLength(1);
    expect(s.collected.flavors).toEqual([coffeeIdx, coffeeIdx + 1]);
  });
});

describe("① 数据净化：重复 / 越界 / 非整数 / 篡改存档", () => {
  it("sanitizeCollected 去重 + 越界裁剪 + 非整数丢弃 + 排序", () => {
    const out = sanitizeCollected({
      quotes: [0, 0, 1, 1, 10, -1, 1.5, "2", 4],
      flavors: [0, 0, 44, 45, 99, -3, 2.5, 44],
    });
    expect(out.quotes).toEqual([0, 1, 4]);
    expect(out.flavors).toEqual([0, 44]);
    expect(out.quotes.length).toBeLessThanOrEqual(10);
    expect(out.flavors.length).toBeLessThanOrEqual(45);
    // 非数组/非法输入 → 空
    expect(sanitizeCollected(undefined)).toEqual({ quotes: [], flavors: [] });
    expect(sanitizeCollected({ quotes: "x", flavors: {} })).toEqual({ quotes: [], flavors: [] });
  });

  it("篡改存档（重复 + 越界 + 垃圾）经 restore 后被净化到 ≤55，且计数与格子一致", () => {
    const evers = {
      v: 1,
      moyu: 0,
      totalEarned: 0,
      levels: { coffee: 50 },
      savedAt: Date.now(),
      createdAt: Date.now(),
      collected: {
        quotes: [0, 0, 0, 1, 1, 10, 99, -1, 1.5, "3", null],
        flavors: [0, 0, 44, 44, 45, 99, -1, 2.5, 3, 3],
      },
      daily: null,
    };
    const a = memAdapter(JSON.stringify(evers));
    const r = restore(a, Date.now());
    expect(r.state).not.toBeNull();
    const s = r.state!;
    expect(s.collected.quotes).toEqual([0, 1]);
    expect(s.collected.flavors).toEqual([0, 3, 44]);
    expect(collectionCount(s)).toBeLessThanOrEqual(55);
    expect(collectionCount(s)).toBe(5);
    const rows = collectionRows(s);
    expect(rows.filter((x) => x.unlocked)).toHaveLength(5);
    expect(collectionCount(s)).toBe(rows.filter((x) => x.unlocked).length);
  });

  it("collectQuote/collectFlavor 越界拒绝且不污染状态", () => {
    const s = initialState();
    expect(collectQuote(s, 10).isNew).toBe(false);
    expect(collectQuote(s, -1).isNew).toBe(false);
    expect(collectQuote(s, 1.5).isNew).toBe(false);
    expect(collectFlavor(s, "coffee", 5).isNew).toBe(false);
    expect(collectFlavor(s, "nope", 0).isNew).toBe(false);
    expect(collectQuote(s, 0).isNew).toBe(true);
    // 重复收集不重复计
    const dup = collectQuote(collectQuote(s, 0).state, 0);
    expect(dup.isNew).toBe(false);
  });

  it("极端篡改：flavor 索引塞满 0..54 也不超 55（collectionCount 上界）", () => {
    const s = initialState();
    s.collected.quotes = Array.from({ length: 10 }, (_, i) => i);
    s.collected.flavors = Array.from({ length: 55 }, (_, i) => i);
    expect(collectionCount(s)).toBeLessThanOrEqual(55);
    expect(collectionCount(s)).toBe(10 + 45);
  });

  it("存档 round-trip：合法图鉴原样保留（去重后）", () => {
    const s = initialState();
    s.collected.quotes = [9, 0, 3];
    s.collected.flavors = [44, 0];
    const a = memAdapter();
    serialize(s, a, Date.now());
    const back = restore(a, Date.now()).state!;
    expect(back.collected.quotes).toEqual([0, 3, 9]);
    expect(back.collected.flavors).toEqual([0, 44]);
    expect(collectionCount(back)).toBe(5);
  });
});
