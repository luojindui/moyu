import { describe, it, expect } from "vitest";
import { serialize, restore, type SaveAdapter } from "../src/engine/save";
import { initialState } from "../src/engine/state";
import { advance } from "../src/engine/tick";
import { effectOf } from "../src/engine/upgrades";
import { formatMoyu } from "../src/engine/format";

/**
 * 审计探针 D：存档恢复的字段校验漏洞。
 * 规格（本地存档/损坏兜底）：「存档 JSON 解析失败或字段非法 → 忽略存档并以初始状态开始」。
 * 怀疑实现只清洗部分字段：levels 非法时不丢弃整个存档；levels 内部接受小数/超大数值，
 * 超大等级可把 idleRate 算成 Infinity 并污染 HUD。
 */

function memAdapter(prefill: Record<string, string>): SaveAdapter {
  const store = new Map(Object.entries(prefill));
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
}

describe("审计 D：restore 字段校验", () => {
  it("字段非法（levels=42 非对象）应整体忽略存档、回到初始状态", () => {
    const a = memAdapter({
      "moyu-save": JSON.stringify({ v: 1, moyu: 9999, levels: 42, savedAt: Date.now() }),
    });
    const r = restore(a, Date.now());
    console.log("levels=42 时恢复出的状态:", r.state);
    expect(r.state).toEqual(initialState()); // 🔴 实测 moyu=9999 被保留，未按规格整体忽略
  });

  it("levels 中小数等级（非法）应被拒绝", () => {
    const a = memAdapter({
      "moyu-save": JSON.stringify({ v: 1, moyu: 0, levels: { coffee: 1.5 }, savedAt: Date.now() }),
    });
    const r = restore(a, Date.now());
    const lv = r.state!.levels["coffee"];
    console.log("恢复出的 coffee 等级:", lv);
    expect(Number.isInteger(lv)).toBe(true); // 🔴 实测 1.5 被接受 → 点击力 2.5
  });

  it("超大等级不应把 idleRate 算成 Infinity 并污染显示", () => {
    const a = memAdapter({
      "moyu-save": JSON.stringify({ v: 1, moyu: 0, levels: { toilet: 1e308 }, savedAt: Date.now() }),
    });
    const r = restore(a, Date.now());
    const idle = effectOf(r.state!).idleRate;
    const advanced = advance(r.state!, 1);
    console.log("idleRate:", idle, "1 秒后 moyu:", advanced.moyu, "HUD 显示:", formatMoyu(advanced.moyu));
    expect(Number.isFinite(idle)).toBe(true); // 🔴 实测 Infinity
    expect(Number.isFinite(advanced.moyu)).toBe(true); // 🔴 实测 Infinity → HUD 显示 "Infinity亿"
  });

  it("moyu 字段非法（字符串）确实会整体忽略存档（对照组，实现已符合）", () => {
    const a = memAdapter({
      "moyu-save": JSON.stringify({ v: 1, moyu: "9999", levels: { coffee: 2 }, savedAt: Date.now() }),
    });
    const r = restore(a, Date.now());
    expect(r.state).toEqual(initialState()); // ✅ 对照：moyu 非法时整体丢弃
  });

  it("levels 为字符串/数字/数组等垃圾类型时安全降级为空等级（对照）", () => {
    for (const levels of ["x", 42, [], null]) {
      const a = memAdapter({
        "moyu-save": JSON.stringify({ v: 1, moyu: 5, levels, savedAt: Date.now() }),
      });
      const r = restore(a, Date.now());
      expect(r.state!.moyu).toBe(5); // ✅ 保留数值部分，等级清空，不抛错
      expect(r.state!.levels).toEqual({});
    }
  });
});
