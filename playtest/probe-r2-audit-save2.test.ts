import { describe, it, expect } from "vitest";
import { serialize, restore, clearSave, MAX_LEVEL, type SaveAdapter } from "../src/engine/save";
import { initialState } from "../src/engine/state";

/**
 * R2 审计探针③：存档 schema 扩展（totalEarned / createdAt / MAX_LEVEL）。
 * 重点：createdAt 继承链、非法 createdAt 的接受面（首日判定可被永久伪造）、等级钳制。
 */

function memAdapter(prefill: Record<string, string> = {}): SaveAdapter & { dump: () => string | null } {
  const store = new Map(Object.entries(prefill));
  return {
    dump: () => store.get("moyu-save") ?? null,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
}

const DAY = 86_400_000;

describe("R2 审计③a：createdAt 继承链", () => {
  it("首次 serialize 建档 = savedAt；后续 serialize 继承旧 createdAt", () => {
    const a = memAdapter();
    serialize({ ...initialState(), moyu: 1 }, a, 1000);
    const b1 = JSON.parse(a.dump()!) as { createdAt: number };
    expect(b1.createdAt).toBe(1000);
    serialize({ ...initialState(), moyu: 2 }, a, 1000 + 3 * DAY);
    const b2 = JSON.parse(a.dump()!) as { createdAt: number; savedAt: number };
    expect(b2.createdAt).toBe(1000); // 继承
    expect(b2.savedAt).toBe(1000 + 3 * DAY);
    const r = restore(a, 1000 + 3 * DAY + 1000);
    expect(r.createdAt).toBe(1000);
  });

  it("clearSave 后重新建档（reset 语义）", () => {
    const a = memAdapter();
    serialize(initialState(), a, 1000);
    clearSave(a);
    serialize(initialState(), a, 5000);
    expect((JSON.parse(a.dump()!) as { createdAt: number }).createdAt).toBe(5000);
  });

  it("旧档（无 createdAt）restore 补当前时间 → 重新获得首日全额", () => {
    const a = memAdapter({
      "moyu-save": JSON.stringify({ v: 1, moyu: 5, levels: { phone: 1 }, savedAt: 1000 }),
    });
    const r = restore(a, 9000);
    expect(r.createdAt).toBe(9000); // 迁移：老玩家重获 24h 首日（设计选择，现状记录）
  });

  it("restore 接受未来/超大 createdAt → 首日判定可被永久伪造（鲁棒性洞）", () => {
    const a = memAdapter({
      "moyu-save": JSON.stringify({ v: 1, moyu: 5, levels: {}, savedAt: 1000, createdAt: 1e18 }),
    });
    const r = restore(a, 2000);
    console.log("未来 createdAt 被原样接受:", r.createdAt);
    const firstDay = Date.now() - r.createdAt < DAY;
    expect(Number.isFinite(r.createdAt)).toBe(true); // 通过（有限）
    expect(r.createdAt).toBe(1e18); // 🔴 现状：任意数值原样接受 → currentOfflineRate 恒判首日
  });

  it("restore 接受负 createdAt（同样恒判首日）", () => {
    const a = memAdapter({
      "moyu-save": JSON.stringify({ v: 1, moyu: 5, levels: {}, savedAt: 1000, createdAt: -1 }),
    });
    const r = restore(a, 2000);
    expect(r.createdAt).toBe(-1); // 🔴 现状记录
  });
});

describe("R2 审计③b：等级与 totalEarned 净化", () => {
  const mk = (levels: unknown, extra: Record<string, unknown> = {}) =>
    memAdapter({
      "moyu-save": JSON.stringify({ v: 1, moyu: 10, levels, savedAt: Date.now(), ...extra }),
    });

  it("MAX_LEVEL=1000 之上（2000）的键被整键丢弃", () => {
    const r = restore(mk({ phone: 2000 }), Date.now());
    expect(r.state!.levels["phone"]).toBeUndefined();
    expect(r.state!.moyu).toBe(10); // 其余保留
  });

  it("MAX_LEVEL 边界 1000 恰好接受", () => {
    const r = restore(mk({ phone: MAX_LEVEL }), Date.now());
    expect(r.state!.levels["phone"]).toBe(MAX_LEVEL);
  });

  it("小数 / 负数 / 字符串等级键被丢弃", () => {
    const r = restore(mk({ a: 1.5, b: -3, c: "5", d: NaN }), Date.now());
    expect(r.state!.levels).toEqual({});
  });

  it("totalEarned：非法（负/字符串）→ 0，不整档作废", () => {
    expect(restore(mk({}, { totalEarned: -5 }), 0).state!.totalEarned).toBe(0);
    expect(restore(mk({}, { totalEarned: "x" }), 0).state!.totalEarned).toBe(0);
    expect(restore(mk({}, { totalEarned: 12345 }), 0).state!.totalEarned).toBe(12345);
  });

  it("levels 为数组 / 字符串 / null → 整档作废（规格字面）", () => {
    for (const levels of [[1, 2], "x", null]) {
      expect(restore(mk(levels), 0).state).toEqual(initialState());
    }
  });

  it("roundtrip：totalEarned 与 createdAt 完整往返", () => {
    const a = memAdapter();
    const s = { moyu: 77.5, totalEarned: 12345.6, levels: { phone: 21, retire: 1 } };
    serialize(s, a, 42_000);
    const r = restore(a, 42_500);
    expect(r.state!.totalEarned).toBe(12345.6);
    expect(r.state!.levels).toEqual({ phone: 21, retire: 1 });
    expect(r.createdAt).toBe(42_000);
    expect(r.offlineSeconds).toBeCloseTo(0.5, 6);
  });
});
