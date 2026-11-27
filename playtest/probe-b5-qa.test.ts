import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { achEffects, achDone, achById } from "../src/engine/achievements";

describe("批次5 QA 回归（审计党 P1）", () => {
  it("P1-1 跳过每日卡后，目标链的选卡步应算完成（源码断言）", async () => {
    const { readFileSync } = await import("node:fs");
    const quest = readFileSync("src/ui/quest.ts", "utf8");
    // 选卡步的 done 必须包含 dismissed
    expect(quest).toContain("s.cards?.chosenDate || !!s.cards?.dismissed");
  });

  it("P1-2 天赋成就用历史最高解锁数：重置天赋后不回退", () => {
    const unlockAll = { ...initialState(), talents: { unlocked: ["idle_1", "idle_2", "idle_3", "idle_4", "click_1", "click_2"], points: 0, rankGranted: -1 }, bestTalentsUnlocked: 6 };
    expect(achDone(achById("talent_6")!, unlockAll)).toBe(true);
    const afterReset = { ...unlockAll, talents: { unlocked: [], points: 8, rankGranted: -1 } };
    expect(achDone(achById("talent_6")!, afterReset)).toBe(true); // 不回退
    expect(achEffects(afterReset).idleMult).toBeGreaterThan(1); // 永久加成仍在
  });

  it("P2-3 老玩家判定：已招募同事/已装修/已用精力 不算新手", async () => {
    const { readFileSync } = await import("node:fs");
    const main = readFileSync("src/main.ts", "utf8");
    expect(main).toContain("looksNewbie");
    expect(main).toContain("Object.keys(state.team.colleagues).length === 0");
    expect(main).toContain("state.decor.length === 0");
    expect(main).toContain("state.energy.used.length === 0");
  });
});
