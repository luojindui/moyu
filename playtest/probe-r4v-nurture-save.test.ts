/**
 * probe-r4v-nurture-save.test.ts — 验收 2：存档迁移（v1 旧档无 collected/daily）
 * 只 import ../src/engine/*，不改 src/。
 */
import { describe, it, expect } from "vitest";
import { serialize, restore, type SaveAdapter, SAVE_VERSION, SAVE_KEY } from "../src/engine/save";
import { initialState, type GameState } from "../src/engine/state";
import { syncFlavorCollection, collectionCount, TOTAL_ITEMS } from "../src/engine/collection";
import { ensureDaily, dailyAllDone, claimDaily, type DailyState } from "../src/engine/daily";
import { UPGRADES } from "../src/engine/upgrades";
import { lcg, dateStr, makeDaily } from "./probe-r4v-nurture-lib";

function log(label: string, value: unknown): void {
  console.log(`[r4v-save] ${label}`, JSON.stringify(value));
}

function memoryAdapter(prefill: Record<string, string> = {}): SaveAdapter & { store: Map<string, string> } {
  const store = new Map(Object.entries(prefill));
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
}

const NOW = 1_766_000_000_000; // 固定 now，避免时钟抖动
const TODAY = "2026-11-27";
const YESTERDAY = "2026-11-26";

/** 模拟 main.ts boot 的迁移序列：restore → syncFlavorCollection → ensureDaily */
function bootMigrate(adapter: SaveAdapter, now: number, today: string): GameState {
  const r = restore(adapter, now);
  let state = r.state ?? initialState();
  state = syncFlavorCollection(state);
  state = ensureDaily(state, today, lcg(42));
  return state;
}

describe("存档迁移·v1 旧档（无 collected/daily）", () => {
  it("旧档 restore 不崩、字段安全降级为空收集/null 日报，离线秒数正确", () => {
    const savedAt = NOW - 3_600_000;
    const adapter = memoryAdapter({
      [SAVE_KEY]: JSON.stringify({
        v: 1,
        moyu: 1234,
        levels: { coffee: 22, phone: 7 },
        savedAt,
      }),
    });
    const r = restore(adapter, NOW);
    expect(r.state).not.toBeNull();
    expect(r.state!.moyu).toBe(1234);
    expect(r.state!.levels).toEqual({ coffee: 22, phone: 7 });
    expect(r.state!.totalEarned).toBe(0);
    expect(r.state!.collected).toEqual({ quotes: [], flavors: [] });
    expect(r.state!.daily).toBeNull();
    expect(r.offlineSeconds).toBe(3600);
    log("旧档 restore", { moyu: r.state!.moyu, levels: r.state!.levels, collected: r.state!.collected, daily: r.state!.daily, offlineSeconds: r.offlineSeconds });
  });

  it("boot 迁移补齐历史彩蛋档（coffee Lv22→4 档、phone Lv7→2 档）并生成 3 目标日报", () => {
    const savedAt = NOW - 3_600_000;
    const adapter = memoryAdapter({
      [SAVE_KEY]: JSON.stringify({ v: 1, moyu: 1234, levels: { coffee: 22, phone: 7 }, savedAt }),
    });
    const state = bootMigrate(adapter, NOW, TODAY);
    const coffee = UPGRADES.findIndex((u) => u.id === "coffee") * 5;
    const phone = UPGRADES.findIndex((u) => u.id === "phone") * 5;
    expect(state.collected.flavors).toEqual([coffee, coffee + 1, coffee + 2, coffee + 3, phone, phone + 1]);
    expect(collectionCount(state)).toBe(6);
    expect(state.daily).not.toBeNull();
    expect(state.daily!.date).toBe(TODAY);
    expect(state.daily!.goals).toHaveLength(3);
    expect(state.daily!.streak).toBe(0);
    log("boot 迁移", { flavors: state.collected.flavors, goals: state.daily!.goals.map((g) => g.id) });
  });

  it("旧档迁移后可回存，raw 含 collected/daily，再 restore 仍在（前向兼容）", () => {
    const savedAt = NOW - 3_600_000;
    const adapter = memoryAdapter({
      [SAVE_KEY]: JSON.stringify({ v: 1, moyu: 1234, levels: { coffee: 22 }, savedAt }),
    });
    const state = bootMigrate(adapter, NOW, TODAY);
    serialize(state, adapter, NOW);
    const raw = JSON.parse(adapter.getItem(SAVE_KEY)!) as Record<string, unknown>;
    expect(raw.v).toBe(SAVE_VERSION);
    expect(raw.collected).toEqual({ quotes: [], flavors: [0, 1, 2, 3] });
    expect(raw.daily).not.toBeNull();
    const again = restore(adapter, NOW);
    expect(again.state!.collected.flavors).toEqual([0, 1, 2, 3]);
    expect(again.state!.daily!.date).toBe(TODAY);
    log("迁移回存", { rawCollected: raw.collected, rawDailyDate: (raw.daily as DailyState).date });
  });

  it("旧档 levels 含未知键：不崩、sync 忽略未知、已购等级保留", () => {
    const adapter = memoryAdapter({
      [SAVE_KEY]: JSON.stringify({ v: 1, moyu: 10, levels: { coffee: 1, hacker: 999 }, savedAt: NOW - 1000 }),
    });
    const state = bootMigrate(adapter, NOW, TODAY);
    expect(state.levels["coffee"]).toBe(1);
    expect(state.collected.flavors).toEqual([0]);
    expect(state.daily).not.toBeNull();
  });
});

describe("存档迁移·roundtrip 保留收集进度与日报", () => {
  it("serialize→restore 保留 quotes/flavors/日报 claimed/streak/lastCompleteDate", () => {
    const adapter = memoryAdapter();
    const s = initialState();
    s.moyu = 5000;
    s.totalEarned = 12_345;
    s.levels = { coffee: 5, phone: 10 };
    s.collected = { quotes: [0, 3, 9], flavors: [0, 2, 4, 20, 44] };
    s.daily = {
      date: TODAY,
      goals: makeDaily(["click_100", "buy_3", "survive_2"], TODAY).goals.map((g) => ({ ...g, progress: g.target, done: true })),
      streak: 3,
      lastCompleteDate: TODAY,
      claimed: true,
    };
    serialize(s, adapter, NOW);
    const r = restore(adapter, NOW);
    expect(r.state).not.toBeNull();
    expect(r.state!.collected).toEqual({ quotes: [0, 3, 9], flavors: [0, 2, 4, 20, 44] });
    expect(r.state!.daily!.claimed).toBe(true);
    expect(r.state!.daily!.streak).toBe(3);
    expect(r.state!.daily!.lastCompleteDate).toBe(TODAY);
    expect(r.state!.daily!.goals.every((g) => g.done)).toBe(true);
    log("roundtrip", { collected: r.state!.collected, daily: { claimed: r.state!.daily!.claimed, streak: r.state!.daily!.streak } });
  });

  it("跨日经存档：昨日已领 → 今日 ensureDaily 保留 streak，完成领取后 streak+1", () => {
    const adapter = memoryAdapter();
    let s = initialState();
    s.daily = {
      date: YESTERDAY,
      goals: makeDaily(["click_100", "buy_3", "survive_2"], YESTERDAY).goals.map((g) => ({ ...g, progress: g.target, done: true })),
      streak: 1,
      lastCompleteDate: YESTERDAY,
      claimed: true,
    };
    serialize(s, adapter, NOW);
    s = restore(adapter, NOW).state!;
    s = ensureDaily(s, TODAY, lcg(7));
    expect(s.daily!.streak).toBe(1); // 跨日保留
    s = { ...s, daily: { ...s.daily!, goals: s.daily!.goals.map((g) => ({ ...g, progress: g.target, done: true })) } };
    const r = claimDaily(s, TODAY);
    expect(r.claimedReward).not.toBeNull();
    expect(r.state.daily!.streak).toBe(2);
    log("跨日 streak", { before: 1, after: r.state.daily!.streak });
  });
});

describe("存档迁移·非法字段安全降级", () => {
  it("collected 非对象 / daily 非对象 → [] 与 null（不崩）", () => {
    const adapter = memoryAdapter({
      [SAVE_KEY]: JSON.stringify({ v: 1, moyu: 5, levels: {}, savedAt: NOW - 1000, collected: "junk", daily: 42 }),
    });
    const r = restore(adapter, NOW);
    expect(r.state!.collected).toEqual({ quotes: [], flavors: [] });
    expect(r.state!.daily).toBeNull();
  });

  it("collected 数组元素净化：非整数/负数/字符串/超上限丢弃", () => {
    const adapter = memoryAdapter({
      [SAVE_KEY]: JSON.stringify({
        v: 1,
        moyu: 5,
        levels: {},
        savedAt: NOW - 1000,
        collected: { quotes: [1, "a", 2.5, -1, 3], flavors: [0, null, 4] },
      }),
    });
    const r = restore(adapter, NOW);
    expect(r.state!.collected.quotes).toEqual([1, 3]);
    expect(r.state!.collected.flavors).toEqual([0, 4]);
  });

  it("✅ 已修复回归（原缺陷）：collected 越界索引未按图鉴总量收敛（净化只限 <1024）→ 60/55", () => {
    const bogus = Array.from({ length: 60 }, (_, i) => 100 + i); // 全在 sanitizeIdx 的 [0,1024) 内，但它不是合法彩蛋索引
    const adapter = memoryAdapter({
      [SAVE_KEY]: JSON.stringify({ v: 1, moyu: 5, levels: {}, savedAt: NOW - 1000, collected: { quotes: [], flavors: bogus } }),
    });
    const r = restore(adapter, NOW);
    log("越界彩蛋索引", {
      kept: r.state!.collected.flavors.length,
      count: collectionCount(r.state!),
      totalItems: TOTAL_ITEMS,
      journalWouldShow: `${collectionCount(r.state!)}/${TOTAL_ITEMS}`,
    });
    expect(collectionCount(r.state!)).toBeLessThanOrEqual(45);
  });

  it("✅ 已修复回归（原缺陷）：重复索引未去重 → 同一条目重复计数（图鉴分母虚高）", () => {
    const adapter = memoryAdapter({
      [SAVE_KEY]: JSON.stringify({ v: 1, moyu: 5, levels: {}, savedAt: NOW - 1000, collected: { quotes: [0, 0, 0], flavors: [] } }),
    });
    const r = restore(adapter, NOW);
    log("重复索引", { quotes: r.state!.collected.quotes, count: collectionCount(r.state!) });
    expect(new Set(r.state!.collected.quotes).size).toBe(r.state!.collected.quotes.length);
    expect(collectionCount(r.state!)).toBeLessThanOrEqual(TOTAL_ITEMS);
  });

  it("✅ 已修复回归（原缺陷）：日报只校验 date/goals/claimed，goals=[] 可通过 → 无需游戏即可白嫖奖励", () => {
    const adapter = memoryAdapter({
      [SAVE_KEY]: JSON.stringify({
        v: 1,
        moyu: 0,
        levels: {},
        savedAt: NOW - 1000,
        daily: { date: TODAY, goals: [], claimed: false },
      }),
    });
    const r = restore(adapter, NOW);
    const st = r.state!;
    const freeClaim = st.daily ? claimDaily(st, TODAY) : { claimedReward: null };
    log("空 goals 日报", {
      accepted: st.daily !== null,
      allDone: st.daily ? dailyAllDone(st.daily) : null,
      claimedRewardWithoutPlay: freeClaim.claimedReward,
    });
    expect(freeClaim.claimedReward).toBeNull(); // 期望：非法形状被拒 / 不可白嫖
  });

  it("✅ 已修复回归（原缺陷）：日报缺 streak 字段仍通过形状校验 → 领取后 streak=NaN（UI 显示🔥连续 NaN 天）", () => {
    const goals = makeDaily(["click_100", "buy_3", "survive_2"], TODAY).goals.map((g) => ({ ...g, progress: g.target, done: true }));
    const adapter = memoryAdapter({
      [SAVE_KEY]: JSON.stringify({
        v: 1,
        moyu: 0,
        levels: {},
        savedAt: NOW - 1000,
        daily: { date: TODAY, goals, claimed: false },
      }),
    });
    const r = restore(adapter, NOW);
    const claimed = claimDaily(r.state!, TODAY);
    log("缺 streak", { parsedStreak: String(r.state!.daily?.streak), afterClaim: String(claimed.state.daily!.streak) });
    expect(typeof claimed.state.daily!.streak).toBe("number");
    expect(Number.isFinite(claimed.state.daily!.streak)).toBe(true);
  });

  it("✅ 已修复回归（原缺陷）：日报 goals 含非数字 progress（字符串）→ dailyTrack 产出 NaN 进度", () => {
    const adapter = memoryAdapter({
      [SAVE_KEY]: JSON.stringify({
        v: 1,
        moyu: 0,
        levels: {},
        savedAt: NOW - 1000,
        daily: { date: TODAY, goals: [{ id: "click_100", target: 100, progress: "abc", done: false }], claimed: false, streak: 0, lastCompleteDate: null },
      }),
    });
    const r = restore(adapter, NOW);
    log("非法 progress 存档被拒", { daily: r.state!.daily });
    // ✅ 已修复：目标数不为 3 / progress 非数值 → 整份日报作废（null），不会产出 NaN
    expect(r.state!.daily).toBeNull();
  });
});
