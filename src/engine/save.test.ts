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
  it("roundtrip：存后取回状态一致", () => {
    const a = memoryAdapter();
    const s = initialState();
    s.moyu = 123.45;
    s.levels["coffee" as string] = 3;
    serialize(s, a, 1_700_000_000_000);
    const r = restore(a, 1_700_000_000_500);
    expect(r.state).not.toBeNull();
    expect(r.state!.moyu).toBe(123.45);
    expect(r.state!.levels["coffee" as string]).toBe(3);
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
