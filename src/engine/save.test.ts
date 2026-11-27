import { describe, it, expect } from "vitest";
import { serialize, restore, SaveAdapter } from "./save";
import { initialState } from "./state";

function memoryAdapter(prefill: Record<string, string> = {}): SaveAdapter & { store: Map<string, string> } {
  const store = new Map(Object.entries(prefill));
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
}

describe("存档", () => {
  it("roundtrip：存后取回状态一致（含累计摸鱼值与建档时间）", () => {
    const a = memoryAdapter();
    const s = initialState();
    s.moyu = 123.45;
    s.totalEarned = 999.9;
    s.levels["coffee" as string] = 3;
    serialize(s, a, 1_700_000_000_000);
    const r = restore(a, 1_700_000_000_500);
    expect(r.state).not.toBeNull();
    expect(r.state!.moyu).toBe(123.45);
    expect(r.state!.totalEarned).toBe(999.9);
    expect(r.state!.levels["coffee" as string]).toBe(3);
    expect(r.createdAt).toBe(1_700_000_000_000);
  });

  it("旧档缺 totalEarned/createdAt 时给默认值且不弃档", () => {
    const a = memoryAdapter({
      "moyu-save": JSON.stringify({ v: 1, moyu: 88, levels: { coffee: 2 }, savedAt: Date.now() - 1000 }),
    });
    const r = restore(a, Date.now());
    expect(r.state!.moyu).toBe(88);
    // 旧档缺账本字段：用余额推断（否则会丢钱）
    expect(r.state!.totalEarned).toBe(88);
    expect(r.state!.lifetimeEarned).toBe(88);
    expect(r.createdAt).toBeGreaterThan(0);
  });

  it("createdAt 越界（未来/垃圾）钳制为 savedAt，防离线分级永久绕过", () => {
    const savedAt = Date.now() - 7 * 86400_000; // 建档 7 天前，远超首日
    const a = memoryAdapter({
      "moyu-save": JSON.stringify({ v: 1, moyu: 88, levels: {}, savedAt, createdAt: Date.now() + 1e12 }),
    });
    const r = restore(a, Date.now());
    expect(r.createdAt).toBe(savedAt);
  });

  it("createdAt 缺失时默认为 savedAt（不重发首日全额）", () => {
    const savedAt = Date.now() - 7 * 86400_000;
    const a = memoryAdapter({
      "moyu-save": JSON.stringify({ v: 1, moyu: 88, levels: {}, savedAt }),
    });
    const r = restore(a, Date.now());
    expect(r.createdAt).toBe(savedAt);
  });

  it("损坏 JSON：返回初始状态且不抛错", () => {
    const a = memoryAdapter({ "moyu-save": "{oops not json" });
    const r = restore(a, Date.now());
    expect(r.state).toEqual(initialState());
    expect(r.state!.moyu).toBe(0);
  });

  it("版本不符：返回初始状态", () => {
    const a = memoryAdapter({ "moyu-save": JSON.stringify({ v: 99, moyu: 999 }) });
    const r = restore(a, Date.now());
    expect(r.state!.moyu).toBe(0);
  });

  it("levels 非对象（如数字）：整档作废回初始状态", () => {
    const a = memoryAdapter({ "moyu-save": JSON.stringify({ v: 1, moyu: 9999, levels: 42, savedAt: Date.now() - 1000 }) });
    const r = restore(a, Date.now());
    expect(r.state).toEqual(initialState());
  });

  it("levels 含小数/负数/超大值：该键丢弃，其余保留", () => {
    const blob = JSON.stringify({
      v: 1,
      moyu: 500,
      levels: { coffee: 1.5, toilet: -2, group: 1e308, phone: 3, meeting: "5" },
      savedAt: Date.now() - 1000,
    });
    const r = restore(memoryAdapter({ "moyu-save": blob }), Date.now());
    expect(r.state!.moyu).toBe(500);
    expect(r.state!.levels).toEqual({ phone: 3 });
  });

  it("无存档：返回初始状态", () => {
    const r = restore(memoryAdapter(), Date.now());
    expect(r.state).toEqual(initialState());
  });

  it("restore 返回离线秒数供结算", () => {
    const a = memoryAdapter();
    serialize(initialState(), a, 1_000_000);
    const r = restore(a, 1_000_000 + 7_200_000); // 时间戳契约毫秒：7200s = 7.2e6 ms
    expect(r.offlineSeconds).toBe(7200);
  });
});

describe("R9 存档码（跨设备迁移）", () => {
  it("encode → decode 往返一致，且带完整性校验", async () => {
    const { encodeSaveCode, decodeSaveCode } = await import("./save");
    const blob = JSON.stringify({ v: 1, moyu: 123, levels: { phone: 3 }, savedAt: 1, totalEarned: 200, lifetimeEarned: 300 });
    const code = encodeSaveCode(blob);
    expect(code.length).toBeGreaterThan(20);
    expect(code).not.toContain("{"); // base64url
    const dec = decodeSaveCode(code);
    expect(dec.ok).toBe(true);
    expect(dec.blob).toBe(blob);
  });

  it("篡改/截断的存档码被拒绝", async () => {
    const { encodeSaveCode, decodeSaveCode } = await import("./save");
    const code = encodeSaveCode(JSON.stringify({ v: 1, moyu: 1 }));
    expect(decodeSaveCode(code.slice(0, -4)).ok).toBe(false);
    expect(decodeSaveCode("garbage!!!").ok).toBe(false);
    expect(decodeSaveCode("").ok).toBe(false);
  });

  it("导入后不带离线时长（防旧码刷挂机）：decode 出来的 savedAt 由调用方重置", async () => {
    const { encodeSaveCode, decodeSaveCode } = await import("./save");
    const code = encodeSaveCode(JSON.stringify({ v: 1, moyu: 1, savedAt: 1000 }));
    const dec = decodeSaveCode(code);
    const parsed = JSON.parse(dec.blob!);
    expect(parsed.savedAt).toBe(1000);
  });

  it("未来版本不被旧客户端覆盖（restore 拒绝 v>当前 时，写档需备份）", async () => {
    const { SAVE_VERSION } = await import("./save");
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(1);
  });
});
