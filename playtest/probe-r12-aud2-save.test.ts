/**
 * R12 批次 1 复验：存档 v2 净化 / 新字段（autoRepeat / rewardSnapshot / 18 点天赋）边界。
 * 只读 src/。断言按当前实现行为写。
 */
import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import {
  NEWER_SAVE_KEY,
  SAVE_KEY,
  SAVE_VERSION,
  backupNewerSave,
  decodeSaveCode,
  encodeSaveCode,
  restore,
  serialize,
} from "../src/engine/save";
import { claimMission } from "../src/engine/team";
import { branchTier, exclusiveTaken, TALENT_POINT_CAP, talentEffects } from "../src/engine/talents";
import { memoryAdapter, withColleagues, withLevels, withTalents, rich, consumers } from "./probe-r12-aud2-lib";

const NOW = 1_700_000_000_000;
const T0 = NOW - 60_000;
const blob = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ v: SAVE_VERSION, moyu: 0, levels: {}, savedAt: T0, ...over });

describe("R1. v1→v2 迁移 / v2 roundtrip", () => {
  it("R1 v1 旧档：补齐 team/talents/patrolSurvives，原字段保留", () => {
    const a = memoryAdapter({
      [SAVE_KEY]: JSON.stringify({ v: 1, moyu: 999, totalEarned: 50000, levels: { retire: 3 }, savedAt: T0, lifetimeEarned: 50000 }),
    });
    const s = restore(a, NOW).state!;
    expect(s.moyu).toBe(999);
    expect(s.levels["retire"]).toBe(3);
    expect(s.team).toEqual({ colleagues: {} });
    expect(s.talents).toEqual({ unlocked: [], points: 0, rankGranted: -1 });
    expect(s.patrolSurvives).toBe(0);
  });

  it("R2 v2 roundtrip：autoRepeat / rewardSnapshot / mission / 天赋完整保留", () => {
    let s = withColleagues(withLevels(rich(1e12), { retire: 10 }), ["zhou"], 3);
    s = withTalents(s, ["click_1", "click_5a"], 6, 4);
    s = { ...s, patrolSurvives: 9, totalEarned: 1e12 };
    s = {
      ...s,
      team: {
        colleagues: {
          zhou: { level: 3, missionId: "quick", startedAt: 111, endsAt: 222, favor: 37, autoRepeat: true, rewardSnapshot: 12345 },
        },
      },
    };
    const a = memoryAdapter();
    serialize(s, a, T0);
    const raw = JSON.parse(a.store.get(SAVE_KEY)!) as Record<string, unknown>;
    expect(raw.v).toBe(2);
    const r = restore(a, NOW).state!;
    const c = r.team.colleagues["zhou"]!;
    expect(c).toMatchObject({ level: 3, missionId: "quick", startedAt: 111, endsAt: 222, favor: 37, autoRepeat: true, rewardSnapshot: 12345 });
    expect(r.talents).toMatchObject({ unlocked: ["click_1", "click_5a"], points: 6, rankGranted: 4 });
    console.log("[R2] v2 新字段 roundtrip ✓");
  });
});

describe("R3. 本轮新缺陷：18 点天赋被存档按 15 截断", () => {
  it("R3 存 18 点 → 读回 15 点（正常玩法可触发，点数永久丢失）", () => {
    expect(TALENT_POINT_CAP).toBe(18);
    for (const pts of [16, 17, 18]) {
      const s = { ...initialState(), moyu: 0, totalEarned: 0, lifetimeEarned: 0, talents: { unlocked: [], points: pts, rankGranted: 12 } };
      const a = memoryAdapter();
      serialize(s, a, T0);
      const back = restore(a, NOW).state!;
      console.log(`[R3] 存档 ${pts} 点 → 读回 ${back.talents.points} 点（丢失 ${pts - back.talents.points}）`);
      expect(back.talents.points).toBe(15);
    }
    // save.ts 里的上限是硬编码 15，而非 TALENT_POINT_CAP
    const src = consumers("TALENT_POINT_CAP");
    console.log("[R3] TALENT_POINT_CAP 消费点:", src);
    expect(src.some((h) => h.path.endsWith("save.ts"))).toBe(false);
  });
});

describe("R4. P1-4 复验：脏 missionId / 时间字段净化", () => {
  it("R4 【未修复】未知 missionId 仍被保留 → 领取抛 TypeError（同事永久卡死）", () => {
    const a = memoryAdapter({
      [SAVE_KEY]: blob({
        moyu: 1000,
        totalEarned: 1000,
        team: { colleagues: { zhou: { level: 1, missionId: "ghost_mission", startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 } } },
      }),
    });
    const s = restore(a, NOW).state!;
    expect(s.team.colleagues["zhou"]!.missionId).toBe("ghost_mission"); // 未对 MISSIONS 校验
    expect(() => claimMission(s, "zhou", NOW, 100)).toThrow(TypeError);
    console.log("[R4] 未知 missionId 未净化，领取仍崩 TypeError（P1-4 未落地）");
  });

  it("R4b 【未修复】startedAt/endsAt 未按 now 钳制：endsAt=0 可凭空领取、endsAt=1e300 永久进行中", () => {
    const a = memoryAdapter({
      [SAVE_KEY]: blob({
        moyu: 1000,
        totalEarned: 1000,
        team: {
          colleagues: {
            zhou: { level: 1, missionId: "quick", startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 5000 },
            mei: { level: 1, missionId: "chat", startedAt: 0, endsAt: 1e300, favor: 0, autoRepeat: false, rewardSnapshot: 0 },
          },
        },
      }),
    });
    const s = restore(a, NOW).state!;
    expect(s.team.colleagues["zhou"]!.endsAt).toBe(0);
    const c = claimMission(s, "zhou", NOW, 100)!;
    expect(c.reward).toBe(5000); // 没派遣过也能按快照白领
    expect(s.team.colleagues["mei"]!.endsAt).toBe(1e300); // 永久进行中
    console.log("[R4b] endsAt 未钳制：0 → 即刻可领(快照 5000)；1e300 → 永久卡死");
  });
});

describe("R5. P1-5 复验：未来版本备份", () => {
  it("R5 【未修复】backupNewerSave 仍无调用点；v3 档被旧客户端覆盖且无 .newer.bak", () => {
    expect(consumers("backupNewerSave", "save.ts")).toEqual([]);
    const future = JSON.stringify({ v: 3, moyu: 999, levels: { retire: 40 }, savedAt: T0, talents: { unlocked: [] }, team: { colleagues: {} }, patrolSurvives: 3 });
    const a = memoryAdapter({ [SAVE_KEY]: future });
    expect(restore(a, NOW).state).toEqual(initialState());
    serialize(initialState(), a, NOW); // 旧客户端写档
    expect(JSON.parse(a.store.get(SAVE_KEY)!).v).toBe(2);
    expect(a.store.get(NEWER_SAVE_KEY)).toBeUndefined();
    console.log("[R5] v3 存档被静默覆盖为 v2，备份 key 未写入（P1-5 未落地）");
  });

  it("R5b backupNewerSave 函数本身行为正确（若被调用可工作）", () => {
    const future = JSON.stringify({ v: 3, moyu: 1, levels: {}, savedAt: T0 });
    const a = memoryAdapter({ [SAVE_KEY]: future });
    backupNewerSave(a);
    expect(a.store.get(NEWER_SAVE_KEY)).toBe(future); // 函数没问题，只是没被调用
  });
});

describe("R6. 天赋净化与新字段边界", () => {
  it("R6 未知天赋 id 过滤；重复 id 保留；互斥终极可同时存在（净化不查互斥/前置）", () => {
    const a = memoryAdapter({
      [SAVE_KEY]: blob({
        moyu: 100,
        totalEarned: 100,
        talents: { unlocked: ["click_1", "hack", "click_1", "click_5a", "click_5b"], points: 3, rankGranted: 8 },
      }),
    });
    const s = restore(a, NOW).state!;
    expect(s.talents.unlocked).toEqual(["click_1", "click_1", "click_5a", "click_5b"]);
    expect(exclusiveTaken(s.talents, "click_ult")).toBe("click_5a"); // 两个互斥终极同时存在
    const eff = talentEffects(s.talents);
    expect(eff.clickToIdleStep).toBe(300); // 5a 生效
    expect(eff.clickMult).toBeCloseTo(1.25 * 1.6, 6); // 5b 也生效 → 互斥被篡改破坏
    expect(branchTier(s.talents, "click")).toBe(5);
    console.log("[R6] 篡改档可同时点亮 click_5a+click_5b（互斥仅在 canUnlock 生效，restore 不校验）");
  });

  it("R6b rankGranted 非整数/越界：整数化但任意大整数被接受（自断发点）", () => {
    const a = memoryAdapter({ [SAVE_KEY]: blob({ moyu: 1, totalEarned: 1, talents: { unlocked: [], points: 0, rankGranted: 1e9 } }) });
    expect(restore(a, NOW).state!.talents.rankGranted).toBe(1e9);
    const b = memoryAdapter({ [SAVE_KEY]: blob({ moyu: 1, totalEarned: 1, talents: { unlocked: [], points: 0, rankGranted: 2.5 } }) });
    expect(restore(b, NOW).state!.talents.rankGranted).toBe(-1);
  });

  it("R6c 新字段净化：autoRepeat 非布尔→false；rewardSnapshot 取非负有限数（无上限，篡改可白领）", () => {
    const a = memoryAdapter({
      [SAVE_KEY]: blob({
        moyu: 1000,
        totalEarned: 1000,
        team: {
          colleagues: {
            zhou: { level: 1, missionId: "quick", startedAt: 0, endsAt: 0, favor: 0, autoRepeat: "yes", rewardSnapshot: -50 },
            mei: { level: 1, missionId: "chat", startedAt: 0, endsAt: 0, favor: 0, autoRepeat: true, rewardSnapshot: 1e300 },
          },
        },
      }),
    });
    const s = restore(a, NOW).state!;
    expect(s.team.colleagues["zhou"]!.autoRepeat).toBe(false);
    expect(s.team.colleagues["zhou"]!.rewardSnapshot).toBe(0);
    expect(s.team.colleagues["mei"]!.rewardSnapshot).toBe(1e300); // 【缺陷】快照无上限
    const c = claimMission(s, "mei", NOW, 100)!;
    expect(c.reward).toBe(1e300);
    console.log("[R6c] 篡改 rewardSnapshot=1e300 → 领取直接 1e300（仅篡改可达，记录为硬化缺口）");
  });

  it("R6d 其余跨字段钳制仍生效（moyu ≤ total ≤ lifetime；levels/等级/好感截断）", () => {
    const a = memoryAdapter({
      [SAVE_KEY]: blob({
        moyu: 1e9,
        totalEarned: 100,
        lifetimeEarned: 50,
        levels: { retire: 9999, coffee: 2.5 },
        team: { colleagues: { zhou: { level: 99, favor: 999, missionId: null, startedAt: 0, endsAt: 0 } } },
      }),
    });
    const s = restore(a, NOW).state!;
    expect(s.moyu).toBe(100);
    expect(s.lifetimeEarned).toBe(100);
    expect(s.levels["retire"]).toBeUndefined();
    expect(s.levels["coffee"]).toBeUndefined();
    expect(s.team.colleagues["zhou"]).toMatchObject({ level: 5, favor: 100, autoRepeat: false, rewardSnapshot: 0 });
  });
});

describe("R7. 存档码携带新字段", () => {
  it("R7 存档码 roundtrip 含 autoRepeat / rewardSnapshot / 18 点天赋", () => {
    let s = withColleagues(withLevels(rich(1e6), { retire: 3 }), ["zhou"], 2);
    s = withTalents(s, ["click_1", "click_5a"], 8, 2);
    s = { ...s, team: { colleagues: { zhou: { ...s.team.colleagues["zhou"]!, missionId: "quick", autoRepeat: true, rewardSnapshot: 777 } } }, patrolSurvives: 5 };
    const a = memoryAdapter();
    serialize(s, a, T0);
    const dec = decodeSaveCode(encodeSaveCode(a.store.get(SAVE_KEY)!));
    expect(dec.ok).toBe(true);
    const back = restore(memoryAdapter({ [SAVE_KEY]: dec.blob! }), NOW).state!;
    expect(back.team.colleagues["zhou"]).toMatchObject({ autoRepeat: true, rewardSnapshot: 777, missionId: "quick" });
    expect(back.talents.points).toBe(8);
    expect(back.patrolSurvives).toBe(5);
  });
});
