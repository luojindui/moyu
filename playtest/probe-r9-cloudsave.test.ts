/**
 * R9 多设备玩家（r9-cloudsave）探针 —— 只读 src/，只写 playtest/。
 *
 * 画像：手机 + 平板 + 电脑都玩、换设备/清缓存/换浏览器会直接弃坑的玩家。
 * 只回答四个问题：
 *   1) 丢档场景的机制根因（strict 版本、静默写失败、多标签 LWW）；
 *   2) 存档跨版本迁移能力（v1 ↔ 未来 v2 / 同 v 新增字段）；
 *   3) 手动导出/导入存档码是否可行：大小、校验、往返一致性、离线作弊面；
 *   4) 本地存档被改的风险：现有净化边界 + 导出码要不要签名。
 *
 * 运行：npx vitest run --config playtest/vitest.r9-cloudsave.config.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { serialize, restore, SAVE_KEY, SAVE_VERSION, type SaveAdapter } from "../src/engine/save";
import { initialState, type GameState } from "../src/engine/state";
import { offlineEarn, OFFLINE_CAP_SECONDS } from "../src/engine/offline";
import { effectOf } from "../src/engine/upgrades";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 27, 4, 0, 0); // 2026-11-27T12:00+08:00
const UPGRADE_IDS = ["coffee", "water", "chair", "phone", "toilet", "group", "meeting", "deep", "retire"];

interface MemAdapter extends SaveAdapter {
  store: Map<string, string>;
}

function mem(prefill: Record<string, string> = {}): MemAdapter {
  const store = new Map(Object.entries(prefill));
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
}

/** 只读存档快照（不经过 restore，用来观察原始 JSON 里到底有什么） */
function rawBlob(adapter: SaveAdapter): Record<string, unknown> {
  return JSON.parse(adapter.getItem(SAVE_KEY) ?? "{}") as Record<string, unknown>;
}

function daily(): NonNullable<GameState["daily"]> {
  return {
    date: "2026-11-20",
    goals: [
      { id: "click_100", target: 100, progress: 100, done: true },
      { id: "meme_1", target: 1, progress: 0, done: false },
      { id: "buy_3", target: 3, progress: 2, done: false },
    ],
    streak: 4,
    lastCompleteDate: "2026-11-19",
    claimed: true,
    window: 2,
    claimsToday: 1,
  };
}

function newbie(): GameState {
  return initialState();
}

function mid(): GameState {
  return {
    ...initialState(),
    moyu: 12345,
    totalEarned: 45678,
    levels: { coffee: 5, phone: 3, toilet: 1 },
    collected: { quotes: [0, 3], flavors: [0, 5] },
    daily: daily(),
    surviveStreak: 7,
    totalClicks: 850,
    visits: { date: "2026-11-20", count: 3 },
    lifetimeEarned: 98_765,
    prestige: 2,
  };
}

function maxed(): GameState {
  const levels: Record<string, number> = {};
  for (const id of UPGRADE_IDS) levels[id] = 1000;
  return {
    ...initialState(),
    moyu: 8.8e12,
    totalEarned: 1.2e13,
    levels,
    collected: { quotes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], flavors: Array.from({ length: 45 }, (_, i) => i) },
    daily: daily(),
    surviveStreak: 1234,
    totalClicks: 999_999,
    visits: { date: "2026-11-27", count: 3 },
    lifetimeEarned: 5e13,
    prestige: 320,
  };
}

// ---------- 存档码参考实现（仅探针内验证可行性，不写进 src/） ----------
const b64u = (b: Buffer): string => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string): Buffer => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** MY1-<fnv32>-<base64url(deflate(原始存档 JSON))>；直接打包原始 blob，复用 restore 的全部净化 */
function encodeSave(raw: string): string {
  const packed = b64u(deflateRawSync(Buffer.from(raw, "utf8")));
  return `MY1-${fnv1a(packed)}-${packed}`;
}

function decodeSave(code: string): string {
  const m = /^MY1-([0-9a-f]{8})-([A-Za-z0-9_-]+)$/.exec(code.trim());
  if (!m) throw new Error("格式错误");
  const [, sum, packed] = m as unknown as [string, string, string];
  if (fnv1a(packed) !== sum) throw new Error("校验和不符（粘贴截断/字符错）");
  return inflateRawSync(unb64u(packed)).toString("utf8");
}

function freshWith(state: GameState): MemAdapter {
  const a = mem();
  serialize(state, a, NOW);
  return a;
}

const evidence: Record<string, unknown> = {};

// ---------- 1. 旧档兼容（v1 内缺字段） ----------
describe("A. 旧档（v1 缺字段）读取兼容性", () => {
  it("最小旧档（只有 v/moyu/levels/savedAt）不弃档，字段补默认值", () => {
    const a = mem({
      [SAVE_KEY]: JSON.stringify({ v: 1, moyu: 88, levels: { coffee: 2 }, savedAt: NOW - 3_600_000 }),
    });
    const r = restore(a, NOW);
    expect(r.state).not.toBeNull();
    expect(r.state!.moyu).toBe(88);
    expect(r.state!.levels).toEqual({ coffee: 2 });
    expect(r.state!.totalEarned).toBe(0);
    expect(r.state!.prestige).toBe(0);
    expect(r.state!.surviveStreak).toBe(0);
    expect(r.state!.totalClicks).toBe(0);
    expect(r.state!.daily).toBeNull();
    expect(r.state!.collected).toEqual({ quotes: [], flavors: [] });
    expect(r.state!.lifetimeEarned).toBe(0);
    expect(r.createdAt).toBe(NOW - 3_600_000); // 缺失 → savedAt，不重发首日
    expect(r.offlineSeconds).toBe(3600);
    evidence["A_minimal_old_save"] = { restoredMoyu: r.state!.moyu, offlineSeconds: r.offlineSeconds };
  });

  it("lifetimeEarned 缺失时按 max(lifetimeEarned, totalEarned) 迁移，段位不倒退", () => {
    const a = mem({ [SAVE_KEY]: JSON.stringify({ v: 1, moyu: 1, levels: {}, savedAt: NOW - 1000, totalEarned: 1e9 }) });
    const r = restore(a, NOW);
    expect(r.state!.lifetimeEarned).toBe(1e9);
  });

  it("旧版未知子字段不会炸读取（同 v 内向后兼容 OK）", () => {
    const a = mem({
      [SAVE_KEY]: JSON.stringify({
        v: SAVE_VERSION,
        moyu: 100,
        levels: { phone: 4 },
        savedAt: NOW - 1000,
        futureField: { x: 1 },
      }),
    });
    const r = restore(a, NOW);
    expect(r.state!.moyu).toBe(100);
    expect(r.state!.levels).toEqual({ phone: 4 });
  });
});

// ---------- 2. 跨版本迁移（关键） ----------
describe("B. 跨版本迁移能力（v1 → 未来版本）", () => {
  it("未来 v2 存档：当前 v1 代码直接整档作废（无迁移分支）", () => {
    const v2 = {
      v: 2,
      moyu: 9_999_999,
      levels: { coffee: 30 },
      savedAt: NOW - 1000,
      totalEarned: 1e8,
      prestige: 9,
      newSystem: { tree: 3 },
    };
    const a = mem({ [SAVE_KEY]: JSON.stringify(v2) });
    const r = restore(a, NOW);
    expect(r.state).toEqual(initialState());
    // 只剩初始 0：玩家所有进度直接消失，且无任何提示
    evidence["B_v2_wipe"] = { inputMoyu: v2.moyu, restoredMoyu: r.state!.moyu, restoredPrestige: r.state!.prestige };
  });

  it("反向（版本降级）覆盖：旧客户端 serialize 会把 v2 档写成 v1 并丢掉新字段", () => {
    const v2 = {
      v: 2,
      moyu: 777,
      levels: { coffee: 10 },
      savedAt: NOW - 5000,
      totalEarned: 5000,
      createdAt: NOW - 40 * DAY,
      newSystem: { tree: 3 },
    };
    const a = mem({ [SAVE_KEY]: JSON.stringify(v2) });
    // 旧客户端启动：restore 失败 → 初始状态 → 10s 后定时存档写回
    const r = restore(a, NOW);
    expect(r.state).toEqual(initialState());
    serialize(r.state!, a, NOW);
    const after = rawBlob(a);
    expect(after.v).toBe(1);
    expect(after.newSystem).toBeUndefined();
    expect(after.moyu).toBe(0);
    expect(after.createdAt).toBe(NOW - 40 * DAY); // createdAt 被保留，其余全丢
    evidence["B_downgrade_overwrite"] = { afterVersion: after.v, afterMoyu: after.moyu, newSystemKept: false };
  });

  it("同 v 新增 state 字段：serialize 白名单写死，往返后被静默丢弃", () => {
    const a = freshWith(mid());
    const b = rawBlob(a);
    b.futureStateField = 42; // 假设 v1.1 加了新状态字段但没改 v
    const a2 = mem({ [SAVE_KEY]: JSON.stringify(b) });
    const r = restore(a2, NOW);
    expect(r.state).not.toBeNull();
    serialize(r.state!, a2, NOW);
    expect(rawBlob(a2).futureStateField).toBeUndefined();
    evidence["B_same_v_new_field_dropped"] = { note: "v 不变但 state 新增字段 → 旧客户端一写档就永久丢掉" };
  });

  it("v 缺失/非法/被改成字符串：一律作废（严格等号判定）", () => {
    for (const v of [undefined, "1", 1.5, 0, -1]) {
      const blob: Record<string, unknown> = { moyu: 500, levels: { coffee: 1 }, savedAt: NOW - 1000 };
      if (v !== undefined) blob.v = v;
      const r = restore(mem({ [SAVE_KEY]: JSON.stringify(blob) }), NOW);
      expect(r.state).toEqual(initialState());
    }
  });
});

// ---------- 3. 手动导出/导入存档码可行性 ----------
describe("C. 档案码方案可行性（base64 + 压缩 + 校验）", () => {
  const cases: Array<[string, GameState]> = [
    ["newbie", newbie()],
    ["mid", mid()],
    ["maxed", maxed()],
  ];

  it("三种存档规模：原始 / 未压缩 base64 / 压缩后 code 长度（判断能否塞进 URL）", () => {
    const rows: Record<string, unknown>[] = [];
    for (const [name, state] of cases) {
      const a = freshWith(state);
      const raw = a.getItem(SAVE_KEY)!;
      const code = encodeSave(raw);
      const plainB64 = b64u(Buffer.from(raw, "utf8"));
      rows.push({
        profile: name,
        rawBytes: Buffer.byteLength(raw),
        plainB64Len: plainB64.length,
        codeLen: code.length,
        urlLenCompressed: `https://moyu.app/#s=${code}`.length,
        urlLenPlain: `https://moyu.app/#s=${plainB64}`.length,
      });
      expect(code.startsWith("MY1-")).toBe(true);
    }
    evidence["C_sizes"] = rows;
    console.log("C 尺寸", rows);
    // 压缩后即使满级档也应能塞进 2KB 级 URL（移动端 IM 里可发）
    for (const r of rows) expect(r.codeLen as number).toBeLessThan(2048);
  });

  it("往返一致：code → 新设备 → restore 后与源档状态一致（三种规模）", () => {
    for (const [name, state] of cases) {
      const src = freshWith(state);
      const code = encodeSave(src.getItem(SAVE_KEY)!);
      const dst = mem({ [SAVE_KEY]: decodeSave(code) });
      const orig = restore(src, NOW);
      const r = restore(dst, NOW);
      expect(r.state).toEqual(orig.state);
      expect(r.createdAt).toBe(orig.createdAt);
      evidence[`C_roundtrip_${name}`] = { ok: true, codeLen: code.length };
    }
  });

  it("校验和能抓粘贴截断/错字符（但抓不住有意改档：无签名）", () => {
    const code = encodeSave(freshWith(mid()).getItem(SAVE_KEY)!);
    const mid1 = Math.floor(code.length / 2);
    const typo = code.slice(0, mid1) + (code[mid1] === "a" ? "b" : "a") + code.slice(mid1 + 1);
    expect(() => decodeSave(typo)).toThrow();
    expect(() => decodeSave(code.slice(0, -7))).toThrow();
    // 有意改档：自己算一遍校验和就通过 → 校验和只防手滑，不防作弊
    const raw = decodeSave(code);
    const blob = JSON.parse(raw) as Record<string, unknown>;
    blob.moyu = 1e15;
    const forged = encodeSave(JSON.stringify(blob));
    const forgedRaw = decodeSave(forged);
    expect(JSON.parse(forgedRaw).moyu).toBe(1e15);
    evidence["C_checksum"] = { catchesTypo: true, catchesTamper: false };
  });

  it("导入坏码不应先覆盖当前档（两阶段：decode→restore→确认→写）", () => {
    const old = mem({ [SAVE_KEY]: JSON.stringify({ v: 1, moyu: 888, levels: { phone: 7 }, savedAt: NOW - 1000 }) });
    // 坏码场景：当前实现缺失。探针给出建议流程：只 demote 到临时 adapter 验证，不碰 SAVE_KEY
    const tmp = mem({ [SAVE_KEY]: '{"v":1,"moyu":"x"}' });
    const r = restore(tmp, NOW);
    expect(r.state).toEqual(initialState()); // 坏码验证失败
    expect(old.getItem(SAVE_KEY)).not.toBeNull(); // 原档仍在 → 说明"先验证后写"是可行的
    expect(JSON.parse(old.getItem(SAVE_KEY)!).moyu).toBe(888);
  });

  it("导入旧码的离线结算口径：savedAt 陈旧 → 一次导入可白拿 8h 挂机（可无限重放）", () => {
    // 30 天前导出的存档码，导入到今天
    const state = mid();
    const old = mem();
    serialize(state, old, NOW - 30 * DAY);
    const code = encodeSave(old.getItem(SAVE_KEY)!);
    const dst = mem({ [SAVE_KEY]: decodeSave(code) });
    const r = restore(dst, NOW);
    expect(Math.round(r.offlineSeconds)).toBe(30 * 86400);
    const idleRate = effectOf(r.state!).idleRate;
    const once = offlineEarn(r.state!, r.offlineSeconds, 1);
    expect(once.applied).toBe(OFFLINE_CAP_SECONDS); // 8h 封顶
    const earnPerImport = once.earned;
    // 重放：同一份旧码导入 N 次，每次都以旧 savedAt 结算 8h
    const replay10 = earnPerImport * 10;
    evidence["C_import_offline_exploit"] = {
      idleRate,
      earnPerImport,
      replay10,
      note: "导入必须把 savedAt 重置为 now / 或不结算离线，否则旧码可反复刷 8h 挂机",
    };
    console.log("C 导入离线", { idleRate, earnPerImport, replay10 });
    expect(earnPerImport).toBeGreaterThan(0);
  });
});

// ---------- 4. 静默失败 / 多标签 / 隐私 ----------
describe("D. 丢档机制：静默写失败与多标签覆盖", () => {
  it("localStorage 被禁/写满（隐私模式、Safari 存储限制）：serialize 静默失败，玩家无感知", () => {
    const throwing: SaveAdapter = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    expect(() => serialize(mid(), throwing, NOW)).not.toThrow();
    // 会话内游戏照跑，但关页即全丢；没有任何"未存档"提示
    const r = restore(throwing, NOW);
    expect(r.state).toEqual(initialState());
    evidence["D_silent_write_fail"] = { throws: false, warning: null, lostOnClose: true };
  });

  it("读被禁（getItem 抛错）：静默回初始档（同样无提示）", () => {
    const throwing: SaveAdapter = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    const r = restore(throwing, NOW);
    expect(r.state).toEqual(initialState());
    expect(() => serialize(mid(), throwing, NOW)).not.toThrow();
  });

  it("双标签/多窗口：旧标签 10s 定时存档用陈旧状态覆盖新标签进度（LWW，无冲突检测）", () => {
    const base = freshWith(mid());
    const tabA = restore(base, NOW).state!;
    const tabB = restore(base, NOW).state!;
    // B 买了 3 级 phone（progress +）
    const bState: GameState = { ...tabB, moyu: tabB.moyu - 500, levels: { ...tabB.levels, phone: tabB.levels.phone! + 3 } };
    serialize(bState, base, NOW + 10_000);
    // A 是 20 秒前的旧状态，定时器到点照写
    serialize({ ...tabA, moyu: tabA.moyu + 30 }, base, NOW + 20_000);
    const merged = restore(base, NOW + 20_000).state!;
    expect(merged.levels.phone).toBe(3); // B 的 +3 被 A 覆盖回 3 → 实际上 B 的 3 级白买
    const beforeB = tabB.levels.phone ?? 0;
    expect(merged.levels.phone).toBe(beforeB);
    evidence["D_multitab_lww"] = {
      tabBPhoneAfter: bState.levels.phone,
      afterOverwrite: merged.levels.phone,
      note: "B 买的 3 级被 A 的陈旧状态覆盖（6→3），无冲突检测/无提示",
    };
  });

  it("存档内容不含任何设备/账号/位置元数据（隐私面小）", () => {
    const a = freshWith(maxed());
    const keys = Object.keys(rawBlob(a)).sort();
    expect(keys).toEqual(
      ["collected", "createdAt", "daily", "levels", "lifetimeEarned", "moyu", "prestige", "savedAt", "surviveStreak", "totalClicks", "totalEarned", "v", "visits"].sort(),
    );
    const raw = a.getItem(SAVE_KEY)!;
    expect(raw).not.toMatch(/userAgent|deviceId|navigator\.|localStorage|@[a-z]/i);
    evidence["D_pii"] = { keys };
  });

  it("本地改档：现有净化拦得住形状/Infinity，但拦不住「合法但离谱」的数值", () => {
    // 1) 净化生效：levels 越界/非法丢弃
    const r1 = restore(
      mem({ [SAVE_KEY]: JSON.stringify({ v: 1, moyu: 500, levels: { coffee: 1.5, toilet: 1e308, phone: 3 }, savedAt: NOW - 1000 }) }),
      NOW,
    );
    expect(r1.state!.levels).toEqual({ phone: 3 });
    expect(Number.isFinite(effectOf(r1.state!).idleRate)).toBe(true);
    // 2) 但合法范围内的离谱值照收：moyu=1e15 / prestige=9999 / 图鉴全满
    const r2 = restore(
      mem({
        [SAVE_KEY]: JSON.stringify({
          v: 1,
          moyu: 1e15,
          totalEarned: 1e15,
          levels: { retire: 1000 },
          savedAt: NOW - 1000,
          prestige: 9999,
          lifetimeEarned: 1e15,
          collected: { quotes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], flavors: Array.from({ length: 45 }, (_, i) => i) },
        }),
      }),
      NOW,
    );
    expect(r2.state!.moyu).toBe(1e15);
    expect(r2.state!.prestige).toBe(9999);
    evidence["D_local_edit"] = { sanitizedShape: true, replayableAbsurdValues: true };
  });
});

// ---------- 5. 抽样数据落盘 ----------
afterAll(() => {
  evidence["_meta"] = {
    probe: "r9-cloudsave",
    at: new Date().toISOString(),
    head: "500359b",
    saveVersion: SAVE_VERSION,
    offlineCapSeconds: OFFLINE_CAP_SECONDS,
  };
  writeFileSync("playtest/r9-cloudsave.json", JSON.stringify(evidence, null, 2));
});
