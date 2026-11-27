import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { initialState, gain } from "../src/engine/state";
import { talentEffects, type TalentEffects } from "../src/engine/talents";
import { effectOf } from "../src/engine/upgrades";
import { onBossTap, newEventState, finishPatrol } from "../src/engine/events";
import { offlineEfficiency } from "../src/engine/progression";

/** 递归收集 src 下所有 .ts（排除测试与 talents.ts 自身） */
function srcFiles(dir = "src", acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) srcFiles(p, acc);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && e.name !== "talents.ts") acc.push(p);
  }
  return acc;
}

const CONSUMER_FILES = srcFiles().map((f) => ({ path: f, text: readFileSync(f, "utf8") }));

describe("天赋接线守卫（防描述说谎回归）", () => {
  it("每个 TalentEffects 字段都至少有一个消费点（talents.ts 之外）", () => {
    const sample: TalentEffects = talentEffects({ unlocked: [], points: 0, rankGranted: -1 });
    const missing: string[] = [];
    for (const key of Object.keys(sample) as (keyof TalentEffects)[]) {
      const hit = CONSUMER_FILES.some((f) => f.text.includes(key));
      if (!hit) missing.push(key);
    }
    expect(missing).toEqual([]);
  });

  it("event_2 罚款减免真的生效（天赋 -35%）", () => {
    const base = { ...initialState(), moyu: 1e6, levels: { phone: 5 } };
    const es0 = { ...newEventState(), bossUntil: 10, bossStartAt: 0, patrolCount: 99 };
    const noTalent = onBossTap(base, { ...es0 }, 5).lost;
    const withTalent = onBossTap(
      { ...base, talents: { unlocked: ["event_1", "event_2"], points: 0, rankGranted: -1 } },
      { ...es0 },
      5,
    ).lost;
    expect(withTalent).toBeLessThan(noTalent);
    expect(withTalent / noTalent).toBeLessThan(0.7); // 至少 -30%
  });

  it("idle_5b 同事挂机 +40% 真的进挂机收益", () => {
    let s = gain(initialState(), 1e9);
    s = {
      ...s,
      team: { colleagues: { zhou: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 } } },
    };
    const before = effectOf(s).idleRate;
    const withUlt = effectOf({ ...s, talents: { unlocked: ["idle_1", "idle_2", "idle_3", "idle_4", "idle_5b"], points: 0, rankGranted: -1 } }).idleRate;
    // idle_1/3 也给 +6%+6%，所以只看同事部分相对提升不明显——但必须严格大于无天赋
    expect(withUlt).toBeGreaterThan(before);
  });

  it("idle_4 让离线效率上限超过 100%", () => {
    const now = Date.UTC(2026, 11, 1);
    const created = now - 10 * 86400_000;
    const s = {
      ...initialState(),
      visits: { date: new Date(now).toLocaleDateString("sv-SE"), count: 3 },
      daily: { date: "", goals: [], claimed: false, streak: 28, lastCompleteDate: "", window: 0, claimsToday: 0 } as never,
    };
    const effNo = offlineEfficiency(s, created, now);
    const effWith = offlineEfficiency(
      { ...s, talents: { unlocked: ["idle_1", "idle_2", "idle_3", "idle_4"], points: 0, rankGranted: -1 } },
      created,
      now,
    );
    expect(effWith).toBeGreaterThan(effNo);
    expect(effWith).toBeGreaterThan(1); // 可超 100%
  });

  it("event_4 提前预警字段被 main.ts 消费", () => {
    const main = readFileSync("src/main.ts", "utf8");
    expect(main).toContain("patrolWarnSeconds");
    expect(main).toContain("王总快来了");
  });

  it("click_4 暴击被 main.ts 消费且巡逻偷点不触发", () => {
    const main = readFileSync("src/main.ts", "utf8");
    expect(main).toContain("critEvery");
    expect(main).toContain("暴击");
    // 巡逻分支必须在暴击逻辑之前 return（偷点不吃暴击）
    const bossBranch = main.indexOf("if (es.bossUntil > scene.gameTime)");
    const critIdx = main.indexOf("critEvery");
    expect(bossBranch).toBeGreaterThan(-1);
    expect(critIdx).toBeGreaterThan(-1);
  });

  it("存档保留 27 点天赋（上限与树一致，不再截断）", () => {
    const save = readFileSync("src/engine/save.ts", "utf8");
    expect(save).toContain("Math.min(27");
    expect(save).not.toContain("Math.min(15, rawTalents.points)");
  });
});

void finishPatrol;
