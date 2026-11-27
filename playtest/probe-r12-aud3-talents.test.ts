/**
 * R12 三次复验：天赋树 27 点分层花费 / 互斥 / 新效果 / UI 文案一致性。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { initialState } from "../src/engine/state";
import {
  TALENT_POINT_CAP,
  TALENTS,
  ULTIMATE_COST,
  canUnlock,
  costOfTalent,
  emptyTalents,
  exclusiveTaken,
  resetTalents,
  talentEffects,
  unlockTalent,
} from "../src/engine/talents";
import { conversionBonus } from "../src/engine/upgrades";
import { finishPatrol, newEventState } from "../src/engine/events";
import { offlineEfficiency } from "../src/engine/progression";
import { withLevels, rich, withColleagues } from "./probe-r12-aud2-lib";

const S = (over: Partial<ReturnType<typeof initialState>> = {}) => ({ ...initialState(), ...over });
const tal = (unlocked: string[], points = 27) => ({ unlocked: [], points, rankGranted: 12, dailyGiftDate: "" } as never);

describe("Y1. 27 点树：分层花费 / 逐级 / 互斥 / 重置", () => {
  it("Y1 花费：tier1-2=1、tier3-4=2、终极=3；每流派 9 点，全树 27", () => {
    expect(TALENT_POINT_CAP).toBe(27);
    expect(ULTIMATE_COST).toBe(3);
    expect(costOfTalent("click_1")).toBe(1);
    expect(costOfTalent("click_2")).toBe(1);
    expect(costOfTalent("click_3")).toBe(2);
    expect(costOfTalent("click_4")).toBe(2);
    expect(costOfTalent("click_5a")).toBe(3);
    for (const b of ["click", "idle", "event"]) {
      const linear = TALENTS.filter((t) => t.branch === b && !t.exclusive).reduce((a, t) => a + costOfTalent(t.id), 0);
      expect(linear).toBe(6); // 1+1+2+2
      expect(linear + costOfTalent("click_5a")).toBe(9); // 每流派（取一个终极）9 点
    }
    // 全树：3 流派 × 9 = 27（终极互斥，不能两个都点）
    expect(3 * 9).toBe(TALENT_POINT_CAP);
  });

  it("Y2 点数必须够花费才能点；点亮扣除对应花费；重置全额返还", () => {
    let s = S({ talents: tal([], 3) });
    for (const id of ["idle_1", "idle_2"]) s = unlockTalent(s, id)!; // 1+1
    expect(s.talents.points).toBe(1);
    expect(canUnlock(s.talents, "idle_3")).toBe(false); // 需 2 点
    const rich2 = { ...s, talents: { ...s.talents, points: 2 } };
    const u = unlockTalent(rich2, "idle_3")!;
    expect(u.talents.points).toBe(0);
    // 奖励点全部退还（1+1+2=4）
    const r = resetTalents(u);
    expect(r.talents.points).toBe(4);
    expect(r.talents.unlocked).toEqual([]);
  });

  it("Y3 互斥终极：只能选一个；重置后可改选", () => {
    let s = S({ talents: tal([], 27) });
    for (const id of ["click_1", "click_2", "click_3", "click_4"]) s = unlockTalent(s, id)!;
    expect(s.talents.points).toBe(27 - (1 + 1 + 2 + 2));
    s = unlockTalent(s, "click_5a")!;
    expect(s.talents.points).toBe(27 - 9);
    expect(exclusiveTaken(s.talents, "click_ult")).toBe("click_5a");
    expect(canUnlock(s.talents, "click_5b")).toBe(false);
    const r = resetTalents(s);
    expect(r.talents.points).toBe(27);
  });
});

describe("Y2. 新效果与文案一致性", () => {
  it("Y4 click_5b 挂机转化封顶 32%（而非 20%）", () => {
    const many = S({ totalClicks: 50000, talents: { ...emptyTalents(), unlocked: ["click_5b"], points: 0, rankGranted: 12, dailyGiftDate: "" } });
    expect(conversionBonus(many)).toBeCloseTo(0.32, 6);
    expect(talentEffects(many.talents).clickUltPerK).toBe(0.01);
    console.log("[Y4] click_5b 转化封顶 =", conversionBonus(many));
  });

  it("Y5 event_5b：离线效率 +20% 已接入；但代码仍保留 +10 秒挂机收益（desc/附录未写）", () => {
    const base = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou"], 1);
    const no = { ...base, visits: { date: "", count: 0 }, daily: null };
    const with5b = { ...no, talents: { unlocked: ["event_5b"], points: 0, rankGranted: 12, dailyGiftDate: "" } as never };
    const eNo = offlineEfficiency(no, NOW() - 10 * 86400_000, NOW());
    const e5b = offlineEfficiency(with5b, NOW() - 10 * 86400_000, NOW());
    console.log("[Y5] 离线效率 无=%s 有event_5b=%s", eNo.toFixed(3), e5b.toFixed(3));
    expect(e5b - eNo).toBeCloseTo(0.2, 3);
    // 额外 +10s 挂机收益仍然存在（未在 desc/附录中说明）
    const eff = talentEffects(with5b.talents);
    expect(eff.surviveBonusIdleSeconds).toBe(10);
    const es = newEventState();
    es.bossUntil = 100;
    es.bossVariant = "hold";
    es.patrolCount = 1;
    es.bossCaught = false;
    const before = finishPatrol(no, { ...es }).reward;
    const after = finishPatrol(with5b, { ...es }).reward;
    expect(after).toBeGreaterThan(before);
    console.log("[Y5] 巡逻奖励 无=%s 有event_5b=%s（额外 +10s 挂机收益未写在文案）", before.toFixed(1), after.toFixed(1));
  });

  it("Y6 【UI 文案缺陷】天赋面板花费标签/上限仍是旧值（tier3-4 显示「点亮」实扣 2；终极显示「点亮 2」实扣 3；底部写上限 18）", () => {
    const panel = readFileSync("src/ui/team-panel.ts", "utf8");
    expect(panel).toContain("const need = t.tier >= 5 ? 2 : 1;");
    expect(panel).toContain("（终极·2点）");
    expect(panel).toContain("上限 18");
    // 与引擎真实花费不一致
    expect(costOfTalent("click_3")).toBe(2);
    expect(costOfTalent("click_5a")).toBe(3);
    console.log("[Y6] UI 标签需要 2、终极 2 点、上限 18；实际 tier3-4=2、终极=3、上限 27");
  });
});

function NOW() {
  return Date.UTC(2026, 11, 1);
}
