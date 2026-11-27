/**
 * R12 三次复验：存档净化（P1-2/P2-4 复验）与未来版本备份（P1-3 复验）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { initialState } from "../src/engine/state";
import {
  NEWER_SAVE_KEY,
  SAVE_KEY,
  SAVE_VERSION,
  backupNewerSave,
  restore,
  serialize,
} from "../src/engine/save";
import { claimMission, missionDone } from "../src/engine/team";
import { talentEffects } from "../src/engine/talents";
import { branchTier } from "../src/engine/talents";
import { memoryAdapter, withColleagues, rich, withLevels } from "./probe-r12-aud2-lib";

const NOW = Date.UTC(2026, 11, 1);
const T0 = NOW - 60_000;
const blob = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ v: SAVE_VERSION, moyu: 0, levels: {}, savedAt: T0, ...over });

describe("Z1. 存档净化（P1-2/P2-4 复验）", () => {
  it("Z1 未知 missionId → null（不再崩溃）；已知 id 保留", () => {
    const a = memoryAdapter({
      [SAVE_KEY]: blob({
        moyu: 1000,
        totalEarned: 1000,
        team: { colleagues: { zhou: { level: 1, missionId: "ghost_mission", startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 5000 } } },
      }),
    });
    const s = restore(a, NOW).state!;
    expect(s.team.colleagues["zhou"]!.missionId).toBeNull();
    expect(s.team.colleagues["zhou"]!.endsAt).toBe(0);
    expect(claimMission(s, "zhou", NOW, 100)).toBeNull(); // 不再抛 TypeError
    const b = memoryAdapter({
      [SAVE_KEY]: blob({ moyu: 100, totalEarned: 100, team: { colleagues: { zhou: { level: 1, missionId: "quick", startedAt: NOW - 100_000, endsAt: NOW - 1000 } } } }),
    });
    expect(restore(b, NOW).state!.team.colleagues["zhou"]!.missionId).toBe("quick");
    console.log("[Z1] 未知任务 id 已清空，领取不再崩 ✓");
  });

  it("Z1b startedAt/endsAt 钳制：1e300 不再永久卡死（上限 startedAt+9h）", () => {
    const a = memoryAdapter({
      [SAVE_KEY]: blob({
        moyu: 100,
        totalEarned: 100,
        team: { colleagues: { zhou: { level: 1, missionId: "quick", startedAt: 0, endsAt: 1e300 } } },
      }),
    });
    const s = restore(a, NOW).state!;
    const c = s.team.colleagues["zhou"]!;
    expect(c.endsAt).toBeLessThanOrEqual(0 + 9 * 3600 * 1000);
    expect(c.endsAt).toBeLessThan(1e300);
    // 时间戳过旧 + ended → 仍可领：残留「篡改可白领快照」（见 Z1c）
    console.log("[Z1b] 1e300 endsAt 已被钳制到", c.endsAt);
  });

  it("Z1c 【残留】startedAt=0/endsAt=0 的篡改档仍会被钳成「已完成」→ 可白领快照（上限 1e18）", () => {
    const a = memoryAdapter({
      [SAVE_KEY]: blob({
        moyu: 1000,
        totalEarned: 1000,
        team: { colleagues: { zhou: { level: 1, missionId: "quick", startedAt: 0, endsAt: 0, autoRepeat: false, rewardSnapshot: 5000 } } },
      }),
    });
    const s = restore(a, NOW).state!;
    const c = s.team.colleagues["zhou"]!;
    expect(c.endsAt).toBe(1000); // max(startedAt+1s, 0)
    expect(missionDone(s, "zhou", NOW)).toBe(true);
    const claim = claimMission(s, "zhou", NOW, 100);
    console.log("[Z1c] 篡改档白领：", claim?.reward);
    expect(claim?.reward).toBe(5000); // 上限被 1e18 压住，但「未派遣也能领」仍成立
  });

  it("Z2 天赋净化：去重 + 互斥只留一个 + 点数/rankGranted/dailyGiftDate 钳制 + 快照上限", () => {
    const a = memoryAdapter({
      [SAVE_KEY]: blob({
        moyu: 100,
        totalEarned: 100,
        talents: {
          unlocked: ["click_5a", "click_5b", "click_1", "click_1", 5, "hack"],
          points: 99,
          rankGranted: 99,
          dailyGiftDate: "not-a-date",
        },
        team: { colleagues: { zhou: { level: 1, missionId: "quick", startedAt: 0, endsAt: 0, rewardSnapshot: 1e19 } } },
      }),
    });
    const s = restore(a, NOW).state!;
    console.log("[Z2] unlocked=", s.talents.unlocked, " points=", s.talents.points, " rankGranted=", s.talents.rankGranted, " dailyGiftDate=", JSON.stringify(s.talents.dailyGiftDate));
    expect(s.talents.unlocked).toEqual(["click_5a", "click_1"]); // 去重 + 互斥只留首个
    expect(s.talents.points).toBe(24);
    expect(s.talents.rankGranted).toBe(12);
    expect(s.talents.dailyGiftDate).toBe("");
    expect(s.team.colleagues["zhou"]!.rewardSnapshot).toBe(1e18);
    // 互斥两组都只保留了首个：event 组同样验证
    const b = memoryAdapter({
      [SAVE_KEY]: blob({ moyu: 1, totalEarned: 1, talents: { unlocked: ["event_5b", "event_5a"] } }),
    });
    expect(restore(b, NOW).state!.talents.unlocked).toEqual(["event_5b"]);
  });

  it("Z2a 溢出点 overflow：整数 0-30 钳制，非法/缺失 → 0，并 roundtrip", () => {
    const a = memoryAdapter({ [SAVE_KEY]: blob({ moyu: 1, totalEarned: 1, talents: { unlocked: [], points: 24, overflow: 99 } }) });
    expect(restore(a, NOW).state!.talents.overflow).toBe(30);
    const b = memoryAdapter({ [SAVE_KEY]: blob({ moyu: 1, totalEarned: 1, talents: { unlocked: [], points: 0, overflow: -5 } }) });
    expect(restore(b, NOW).state!.talents.overflow).toBe(0);
    const c = memoryAdapter({ [SAVE_KEY]: blob({ moyu: 1, totalEarned: 1, talents: { unlocked: [] } }) });
    expect(restore(c, NOW).state!.talents.overflow).toBe(0);
    const s = { ...initialState(), moyu: 0, totalEarned: 0, talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: "", overflow: 7 } };
    const d = memoryAdapter();
    serialize(s, d, T0);
    expect(restore(d, NOW).state!.talents.overflow).toBe(7);
  });

  it("Z2b rankGranted 下限钳制到 -1", () => {
    const a = memoryAdapter({ [SAVE_KEY]: blob({ moyu: 1, totalEarned: 1, talents: { unlocked: [], points: 0, rankGranted: -999 } }) });
    expect(restore(a, NOW).state!.talents.rankGranted).toBe(-1);
  });

  it("Z2c 【残留】unlocked 仅去重/互斥，不校验前置链（篡改可单独点亮终极）", () => {
    const a = memoryAdapter({ [SAVE_KEY]: blob({ moyu: 1, totalEarned: 1, talents: { unlocked: ["click_5a"] } }) });
    const s = restore(a, NOW).state!;
    expect(branchTier(s.talents, "click")).toBe(5); // 5/5 但 click_1-4 未点
    expect(talentEffects(s.talents).clickToIdleStep).toBe(300);
    console.log("[Z2c] 前置链仍未净化（仅影响手改存档）");
  });
});

describe("Z2. 未来版本备份（P1-3 复验）", () => {
  it("Z3 main.ts 已接线 backupNewerSave（自动存档定时器前调用）", () => {
    const main = readFileSync("src/main.ts", "utf8");
    const backupIdx = main.indexOf("backupNewerSave(localStorageAdapter)");
    const timerIdx = main.indexOf("const saveTimer = setInterval");
    console.log("[Z3] backup idx=", backupIdx, " saveTimer idx=", timerIdx);
    expect(backupIdx).toBeGreaterThan(0);
    expect(backupIdx).toBeLessThan(timerIdx);
    expect(main).toContain('from "./engine/save"');
  });

  it("Z3b v3 档会被备份到 moyu-save.newer.bak（旧客户端随后覆盖 v2）", () => {
    const future = JSON.stringify({ v: 3, moyu: 999, levels: { retire: 40 }, savedAt: T0, team: { colleagues: {} }, talents: { unlocked: [] }, patrolSurvives: 3 });
    const a = memoryAdapter({ [SAVE_KEY]: future });
    expect(restore(a, NOW).state).toEqual(initialState()); // 拒绝未来版本
    backupNewerSave(a); // main.ts 启动即调用
    expect(a.store.get(NEWER_SAVE_KEY)).toBe(future); // v3 原始内容已备份
    serialize(initialState(), a, NOW); // 旧客户端写 v2
    expect(JSON.parse(a.store.get(SAVE_KEY)!).v).toBe(2);
    expect(a.store.get(NEWER_SAVE_KEY)).toBe(future); // 备份仍在
    console.log("[Z3b] v3 档 → 备份成功，v2 覆盖后 new.bak 仍保留 ✓");
  });

  it("Z2d v2 roundtrip 保留 dailyGiftDate/autoRepeat/rewardSnapshot", () => {
    let s = withColleagues(withLevels(rich(1e6), { retire: 3 }), ["zhou"], 2);
    s = {
      ...s,
      team: { colleagues: { zhou: { ...s.team.colleagues["zhou"]!, missionId: "quick", autoRepeat: true, rewardSnapshot: 777 } } },
      talents: { unlocked: ["click_1"], points: 5, rankGranted: 2, dailyGiftDate: "2026-11-27" },
    };
    const a = memoryAdapter();
    serialize(s, a, T0);
    const back = restore(a, NOW).state!;
    expect(back.talents.dailyGiftDate).toBe("2026-11-27");
    expect(back.team.colleagues["zhou"]).toMatchObject({ autoRepeat: true, rewardSnapshot: 777, missionId: "quick" });
  });
});
