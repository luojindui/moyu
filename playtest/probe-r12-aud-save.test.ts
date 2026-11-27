/**
 * R12 批次 1 审计：存档 v2（save.ts）——v1→v2 迁移、字段净化、跨字段钳制、
 * 未知任务 id 崩溃链路、未来版本备份是否真的生效。
 * 只读 src/。断言按「当前实现实测行为」写。
 */
import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import {
  NEWER_SAVE_KEY,
  SAVE_KEY,
  SAVE_VERSION,
  encodeSaveCode,
  decodeSaveCode,
  restore,
  serialize,
} from "../src/engine/save";
import { claimMission } from "../src/engine/team";
import { branchTier, talentEffects } from "../src/engine/talents";
import { memoryAdapter, withColleagues, withLevels, withTalents, rich, consumers } from "./probe-r12-aud-lib";

const NOW = 1_700_000_000_000;
const T0 = NOW - 60_000;

function blob(over: Record<string, unknown>) {
  return JSON.stringify({ v: SAVE_VERSION, moyu: 0, levels: {}, savedAt: T0, ...over });
}

describe("G. v1→v2 迁移", () => {
  it("G1 v1 旧档：补齐 team/talents/patrolSurvives，原有字段不丢", () => {
    const a = memoryAdapter({
      [SAVE_KEY]: JSON.stringify({
        v: 1,
        moyu: 12345,
        totalEarned: 50000,
        levels: { coffee: 3, retire: 12 },
        savedAt: T0,
        lifetimeEarned: 80000,
        prestige: 2,
        surviveStreak: 3,
        totalClicks: 777,
        createdAt: T0 - 86400000 * 10,
      }),
    });
    const r = restore(a, NOW);
    expect(r.state).not.toBeNull();
    const s = r.state!;
    expect(s.moyu).toBe(12345);
    expect(s.levels["retire"]).toBe(12);
    expect(s.lifetimeEarned).toBe(80000);
    expect(s.prestige).toBe(2);
    expect(s.totalClicks).toBe(777);
    expect(s.team).toEqual({ colleagues: {} });
    expect(s.talents).toEqual({ unlocked: [], points: 0, rankGranted: -1 });
    expect(s.patrolSurvives).toBe(0); // v2 新字段默认 0
    expect(r.offlineSeconds).toBeCloseTo(60, 6);
  });

  it("G2 v2 roundtrip：小队/天赋/patrolSurvives 完整保留", () => {
    let s = withColleagues(withLevels(rich(1e12), { retire: 10 }), ["zhou"], 3);
    s = withTalents(s, ["click_1", "idle_1", "idle_2"]);
    s = { ...s, talents: { ...s.talents, points: 4, rankGranted: 4 }, patrolSurvives: 9, totalEarned: 1e12 };
    const t = { ...s.team, colleagues: { zhou: { ...s.team.colleagues["zhou"]!, missionId: "quick", startedAt: 111, endsAt: 222, favor: 37 } } };
    s = { ...s, team: t };
    const a = memoryAdapter();
    serialize(s, a, T0);
    const raw = JSON.parse(a.store.get(SAVE_KEY)!) as Record<string, unknown>;
    expect(raw.v).toBe(2);
    expect(raw.patrolSurvives).toBe(9);
    const r = restore(a, NOW)!;
    expect(r.state!.patrolSurvives).toBe(9);
    expect(r.state!.team.colleagues["zhou"]!.level).toBe(3);
    expect(r.state!.team.colleagues["zhou"]!.missionId).toBe("quick");
    expect(r.state!.team.colleagues["zhou"]!.endsAt).toBe(222);
    expect(r.state!.team.colleagues["zhou"]!.favor).toBe(37);
    expect(r.state!.talents.points).toBe(4);
    expect(r.state!.talents.rankGranted).toBe(4);
    expect(r.state!.talents.unlocked).toEqual(["click_1", "idle_1", "idle_2"]);
  });
});

describe("H. 篡改字段净化 / 跨字段钳制", () => {
  it("H1 小队：等级/好感钳制，未知同事丢弃，非对象忽略", () => {
    const a = memoryAdapter({
      [SAVE_KEY]: blob({
        moyu: 100,
        totalEarned: 100,
        team: {
          colleagues: {
            zhou: { level: 999, missionId: null, startedAt: 0, endsAt: 0, favor: 999 },
            mei: { level: 0, missionId: null, startedAt: -5, endsAt: -5, favor: 3.7 },
            qiang: { level: 2.5, missionId: 42, startedAt: 0, endsAt: 0, favor: -3 },
            hacker: { level: 5, favor: 100 },
            li: "not-an-object",
          },
        },
      }),
    });
    const s = restore(a, NOW).state!;
    expect(s.team.colleagues["zhou"]).toMatchObject({ level: 5, favor: 100 });
    expect(s.team.colleagues["mei"]).toMatchObject({ level: 1, favor: 3 }); // 0/负数 → 1 级（仍是「已招募」）
    expect(s.team.colleagues["qiang"]).toMatchObject({ level: 1, favor: 0, missionId: null });
    expect(s.team.colleagues["hacker"]).toBeUndefined();
    expect(s.team.colleagues["li"]).toBeUndefined();
    expect(Object.keys(s.team.colleagues).sort()).toEqual(["mei", "qiang", "zhou"]);
  });

  it("H2 天赋：未知 id 过滤、点数 0-15 整数、rankGranted 任意整数都被接受", () => {
    const a = memoryAdapter({
      [SAVE_KEY]: blob({
        moyu: 100,
        totalEarned: 100,
        talents: { unlocked: ["click_1", "hack", 5, "click_1"], points: 999, rankGranted: 1e9 },
      }),
    });
    const s = restore(a, NOW).state!;
    expect(s.talents.points).toBe(15); // 上限钳制
    expect(s.talents.rankGranted).toBe(1e9); // 【缺陷】任意整数被接受 → 段位点永久断供
    expect(s.talents.unlocked).toEqual(["click_1", "click_1"]); // 【缺陷】重复 id 未去重
    const b = memoryAdapter({
      [SAVE_KEY]: blob({ moyu: 1, totalEarned: 1, talents: { unlocked: [], points: -5, rankGranted: "x" } }),
    });
    expect(restore(b, NOW).state!.talents).toEqual({ unlocked: [], points: 0, rankGranted: -1 });
  });

  it("H3 天赋跳级解锁（篡改）：无前置也能点亮 5 级并生效", () => {
    const a = memoryAdapter({
      [SAVE_KEY]: blob({ moyu: 100, totalEarned: 100, talents: { unlocked: ["click_5", "event_5"], points: 0 } }),
    });
    const s = restore(a, NOW).state!;
    expect(branchTier(s.talents, "click")).toBe(5); // 没有 click_1..4 也显示 5/5
    expect(talentEffects(s.talents).surviveToIdle).toBe(true);
    expect(talentEffects(s.talents).clickToIdleStep).toBe(300);
    console.log("[H3] 跳级天赋净化缺失：unlocked 未校验前置链（点击流 5/5 无需 1-4 级）");
  });

  it("H4 【缺陷】未知 missionId 被原样保留 → 下次领取抛 TypeError（该同事永久卡死）", () => {
    const a = memoryAdapter({
      [SAVE_KEY]: blob({
        moyu: 1000,
        totalEarned: 1000,
        team: {
          colleagues: {
            zhou: { level: 1, missionId: "ghost_mission", startedAt: 0, endsAt: 0, favor: 0 },
          },
        },
      }),
    });
    const s = restore(a, NOW).state!;
    expect(s.team.colleagues["zhou"]!.missionId).toBe("ghost_mission"); // 未对 MISSIONS 校验
    expect(() => claimMission(s, "zhou", NOW, 100)).toThrow(TypeError);
  });

  it("H5 【缺陷】startedAt/endsAt 任意有限非负数被接受：endsAt=0 的「伪已完成」可白领，endsAt=1e300 永久卡死", () => {
    const a = memoryAdapter({
      [SAVE_KEY]: blob({
        moyu: 1000,
        totalEarned: 1000,
        team: {
          colleagues: {
            zhou: { level: 1, missionId: "quick", startedAt: 0, endsAt: 0, favor: 0 },
            mei: { level: 1, missionId: "chat", startedAt: 0, endsAt: 1e300, favor: 0 },
          },
        },
      }),
    });
    const s = restore(a, NOW).state!;
    // 没派遣过也能立刻领（endsAt=0）
    const c = claimMission(s, "zhou", NOW, 100)!;
    expect(c).not.toBeNull();
    // 未来时间导致的永久进行中
    expect(s.team.colleagues["mei"]!.endsAt).toBe(1e300);
  });

  it("H6 跨字段钳制：moyu ≤ totalEarned ≤ lifetimeEarned；负值归零", () => {
    const a = memoryAdapter({
      [SAVE_KEY]: blob({
        moyu: 1e9,
        totalEarned: 100,
        lifetimeEarned: 50,
        prestige: -3,
        surviveStreak: -2,
        totalClicks: 1.5,
        patrolSurvives: -1,
      }),
    });
    const s = restore(a, NOW).state!;
    expect(s.moyu).toBe(100); // min(moyu, totalEarned)
    expect(s.totalEarned).toBe(100);
    expect(s.lifetimeEarned).toBe(100);
    expect(s.prestige).toBe(0);
    expect(s.surviveStreak).toBe(0);
    expect(s.totalClicks).toBe(0);
    expect(s.patrolSurvives).toBe(0);
  });

  it("H7 顶层形状非法：moyu/savedAt/levels 非法 → 回初始状态（不抛错）", () => {
    for (const bad of [
      blob({ moyu: "100" }),
      blob({ savedAt: "yesterday" }),
      blob({ levels: [1, 2] }),
      blob({ levels: null }),
    ]) {
      const r = restore(memoryAdapter({ [SAVE_KEY]: bad }), NOW);
      expect(r.state).toEqual(initialState());
    }
    expect(SAVE_VERSION).toBe(2);
  });
});

describe("I. 未来版本保护（backupNewerSave）", () => {
  it("I1 【缺陷】backupNewerSave 在 src 中无调用点 → 旧客户端会把未来版本档覆盖成 v2（数据丢失）", () => {
    expect(consumers("backupNewerSave", "save.ts")).toEqual([]); // 定义了但没人调用
    const future = JSON.stringify({ v: 3, moyu: 999, levels: { retire: 40 }, savedAt: T0, talents: { unlocked: [] }, team: { colleagues: {} }, patrolSurvives: 3 });
    const a = memoryAdapter({ [SAVE_KEY]: future });
    expect(restore(a, NOW).state).toEqual(initialState()); // 拒绝未来版本（对）
    // 旧客户端随后照常写档：直接覆盖，且没有 .newer.bak 备份
    serialize(initialState(), a, NOW);
    expect(JSON.parse(a.store.get(SAVE_KEY)!).v).toBe(2);
    expect(a.store.get(NEWER_SAVE_KEY)).toBeUndefined(); // 未来档已丢失
    console.log("[I1] v3 档被 v2 客户端静默覆盖，NEWER_SAVE_KEY 从未写入 → 升级/回退场景会丢档");
  });
});

describe("J. 存档码与 v2 新字段", () => {
  it("J1 存档码可携带 team/talents，encode→decode 完整性校验生效", () => {
    let s = withColleagues(withLevels(rich(1e6), { retire: 3 }), ["zhou"], 2);
    s = withTalents(s, ["click_1"]);
    s = { ...s, talents: { ...s.talents, points: 4, rankGranted: 2 }, patrolSurvives: 5 };
    const a = memoryAdapter();
    serialize(s, a, T0);
    const code = encodeSaveCode(a.store.get(SAVE_KEY)!);
    const dec = decodeSaveCode(code);
    expect(dec.ok).toBe(true);
    const imported = restore(memoryAdapter({ [SAVE_KEY]: dec.blob! }), NOW).state!;
    expect(imported.team.colleagues["zhou"]!.level).toBe(2);
    expect(imported.talents.unlocked).toEqual(["click_1"]);
    expect(imported.patrolSurvives).toBe(5);
    // 篡改一个字符 → 校验失败
    expect(decodeSaveCode(code.slice(0, -1) + (code.endsWith("a") ? "b" : "a")).ok).toBe(false);
  });
});
