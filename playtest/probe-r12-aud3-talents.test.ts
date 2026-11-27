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
  grantDailyTalentPoint,
  grantPrestigeTalentPoints,
  exclusiveTaken,
  resetTalents,
  talentEffects,
  unlockTalent,
  addTalentPoints,
} from "../src/engine/talents";
import { conversionBonus, effectOf, stationIdleOf, stationIdleScaled } from "../src/engine/upgrades";
import { finishPatrol, newEventState } from "../src/engine/events";
import { offlineEfficiency } from "../src/engine/progression";
import { withLevels, rich, withColleagues } from "./probe-r12-aud2-lib";
import { teamFixedRate, teamShareRatio } from "../src/engine/team";

const S = (over: Partial<ReturnType<typeof initialState>> = {}) => ({ ...initialState(), ...over });
const tal = (unlocked: string[], points = 24) => ({ unlocked: [], points, rankGranted: 12, dailyGiftDate: "", overflow: 0 } as never);

describe("Y1. 27 点树：分层花费 / 逐级 / 互斥 / 重置", () => {
  it("Y1 花费：tier1-2=1、tier3-4=2、终极=3；每流派 9 点，全树 27", () => {
    expect(TALENT_POINT_CAP).toBe(24); // 满树需 27 → 终局必须放弃一条流派
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
    // 全树需 27 点（终极互斥，不能两个都点）；上限 24 → 满树不可达
    expect(3 * 9).toBe(27);
    expect(3 * 9).toBeGreaterThan(TALENT_POINT_CAP);
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
    let s = S({ talents: tal([], 24) });
    for (const id of ["click_1", "click_2", "click_3", "click_4"]) s = unlockTalent(s, id)!;
    expect(s.talents.points).toBe(24 - (1 + 1 + 2 + 2));
    s = unlockTalent(s, "click_5a")!;
    expect(s.talents.points).toBe(24 - 9);
    expect(exclusiveTaken(s.talents, "click_ult")).toBe("click_5a");
    expect(canUnlock(s.talents, "click_5b")).toBe(false);
    const r = resetTalents(s);
    expect(r.talents.points).toBe(24);
  });
});

describe("Y2. 新效果与文案一致性", () => {
  it("Y3b 发点封顶 24（转生/每日/段位）", () => {
    expect(grantPrestigeTalentPoints({ ...emptyTalents(), points: 23 }, 5).points).toBe(24);
    expect(grantDailyTalentPoint({ ...emptyTalents(), points: 23, dailyGiftDate: "" }, "2099-01-01").talents.points).toBe(24);
    console.log("[Y3b] 点数上限 24 生效（满树 27 不可达）");
  });

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

  it("Y6 天赋面板花费标签已与分层花费一致（终极 3 点、tier3-4 标 2 点、上限 24）", () => {
    const panel = readFileSync("src/ui/team-panel.ts", "utf8");
    expect(panel).toContain("const need = costOfTalent(t.id);");
    expect(panel).toContain("（终极·${need}点）");
    expect(panel).toContain("（上限 24");
    expect(costOfTalent("click_3")).toBe(2);
    expect(costOfTalent("click_5a")).toBe(3);
    expect(TALENT_POINT_CAP).toBe(24);
    console.log("[Y6] UI 标签与引擎花费一致 ✓（此前 2 点/上限 18 的文案已修）");
  });

});

function NOW() {
  return Date.UTC(2026, 11, 1);
}


describe("Y3. 溢出天赋点（485191e 新机制）", () => {
  it("Y7 溢出点 → 每点 +0.5% 挂机，封顶 +15%；存入 overflow，保留至重置/解锁", () => {
    const t = addTalentPoints({ ...emptyTalents() }, 30);
    console.log("[Y7] 赠送 30 点 → points=", t.points, " overflow=", t.overflow);
    expect(t.points).toBe(24);
    expect(t.overflow).toBe(6);
    expect(talentEffects(t).overflowIdleBonus).toBeCloseTo(0.03, 6);
    const capped = addTalentPoints({ ...emptyTalents(), points: 24, overflow: 30 }, 5);
    expect(capped.overflow).toBe(30);
    expect(talentEffects(capped).overflowIdleBonus).toBeCloseTo(0.15, 6);
    // 转生/段位发点会进 overflow；每日签到满点不再给
    expect(grantPrestigeTalentPoints({ ...emptyTalents(), points: 24, overflow: 2 }).overflow).toBe(3);
    expect(grantDailyTalentPoint({ ...emptyTalents(), points: 24, overflow: 2 }, "2099-01-01").granted).toBe(0);
    expect(grantDailyTalentPoint({ ...emptyTalents(), points: 24, overflow: 2 }, "2099-01-01").talents.overflow).toBe(2);
    // 重置/点亮保留 overflow
    expect(resetTalents(S({ talents: { ...emptyTalents(), points: 5, unlocked: ["click_1"], overflow: 4 } })).talents.overflow).toBe(4);
  });

  it("Y8 溢出加成进入工位挂机（stationIdleScaled/effectOf），但不放大同事 share 基数", () => {
    const base = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou"], 1);
    const withOverflow = { ...base, talents: { ...emptyTalents(), overflow: 10 } };
    const ratio = stationIdleScaled(withOverflow) / stationIdleScaled(base);
    console.log("[Y8] overflow=10 → 工位 ×", ratio.toFixed(3));
    expect(ratio).toBeCloseTo(1.05, 6); // +5%
    // share 基数 rawStation 不含 overflow
    const raw = stationIdleOf(withOverflow) * 1;
    expect(effectOf(withOverflow).idleRate).toBeCloseTo(stationIdleScaled(withOverflow) + raw * teamShareRatio(withOverflow) + teamFixedRate(withOverflow), 6);
  });

  it("Y9 溢出点已有 UI：天赋面板显示「溢出转化：N/30 点（当前 +X% 挂机）」", () => {
    const panel = readFileSync("src/ui/team-panel.ts", "utf8");
    expect(panel).toContain("溢出转化：");
    expect(panel).toContain("state.talents.overflow ?? 0");
    // 0 点引导条件包含 overflow（有溢出时不显示"还没有天赋点"）
    expect(panel).toContain("(state.talents.overflow ?? 0) === 0");
    console.log("[Y9] 溢出转化 UI 已接入（指数/当前百分比）");
  });


  it("Y10 idle 终极已加强：5a +20%、5b 同事 +70%", () => {
    expect(TALENTS.find((t) => t.id === "idle_5a")!.value).toBe(0.2);
    expect(TALENTS.find((t) => t.id === "idle_5b")!.value).toBe(0.7);
    expect(talentEffects({ ...emptyTalents(), unlocked: ["idle_5a"] }).idleMult).toBeCloseTo(1.2, 6);
    expect(talentEffects({ ...emptyTalents(), unlocked: ["idle_5b"] }).teamIdleMult).toBeCloseTo(1.7, 6);
  });
});
