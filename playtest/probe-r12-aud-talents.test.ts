/**
 * R12 批次 1 审计：天赋树（talents.ts）点数发放/边界，以及效果是否真正接入玩法。
 * 只读 src/。断言按「当前实现实测行为」写。
 */
import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import {
  TALENTS,
  TALENT_POINT_CAP,
  TALENT_COST,
  TALENT_RANK_TIERS,
  branchTier,
  canUnlock,
  emptyTalents,
  grantPrestigeTalentPoints,
  grantRankTalents,
  resetTalents,
  talentEffects,
  unlockTalent,
  type TalentState,
} from "../src/engine/talents";
import { dotClick, doPrestigeCheck } from "./probe-r12-aud-helper";
import { doClick, comboMultiplier, clickPowerOf } from "../src/engine/actions";
import { newEventState, onBossTap } from "../src/engine/events";
import { withLevels, withTalents, rich, consumers } from "./probe-r12-aud-lib";

function withPoints(points: number, base: TalentState = emptyTalents()) {
  return { ...initialState(), talents: { ...base, points } };
}

describe("E. 天赋点：发放 / 幂等 / 上限 / 重置", () => {
  it("E1 段位档位发点：第 3/5/7/9/11/13 档各 +1，共 6 点，重复调用不重复发", () => {
    expect(TALENT_RANK_TIERS).toEqual([2, 4, 6, 8, 10, 12]);
    let t = emptyTalents();
    let total = 0;
    for (let rankIndex = 0; rankIndex <= 13; rankIndex++) {
      const g = grantRankTalents(t, rankIndex);
      total += g.granted;
      t = g.talents;
    }
    console.log("[E1] rank 0→13 累计发放:", total, " points:", t.points, " rankGranted:", t.rankGranted);
    expect(total).toBe(6);
    expect(t.points).toBe(6);
    expect(t.rankGranted).toBe(12);
    expect(grantRankTalents(t, 13).granted).toBe(0); // 幂等
    expect(grantRankTalents(t, 2).granted).toBe(0); // 回退不补发
  });

  it("E2 跨多档跳跃一次性补发", () => {
    const g = grantRankTalents(emptyTalents(), 12); // 直接从 0 跳到第 13 档
    expect(g.granted).toBe(6);
    expect(g.talents.points).toBe(6);
    expect(g.talents.rankGranted).toBe(12);
  });

  it("E3 点数上限 15：溢出被吞掉（发点前已满 → 该档位永久失去）", () => {
    expect(TALENT_POINT_CAP).toBe(15);
    const capped = grantPrestigeTalentPoints({ ...emptyTalents(), points: 14 }, 3);
    expect(capped.points).toBe(15);
    const full = grantRankTalents({ ...emptyTalents(), points: 15 }, 13);
    expect(full.granted).toBe(6); // 档位被记为已发
    expect(full.talents.points).toBe(15); // 但点数没进账
    expect(full.talents.rankGranted).toBe(12);
    // 之后重置/花掉点数也不会补回
    expect(grantRankTalents(full.talents, 13).granted).toBe(0);
    console.log("[E3] 满点时跳段：granted=6 但 points 仍 15 → 5 点永久蒸发（规格「多余点不产出」）");
  });

  it("E4 重置：返还已用点数、保留 rankGranted、免费无冷却", () => {
    let s = withPoints(3);
    s = unlockTalent(s, "idle_1")!;
    s = unlockTalent(s, "idle_2")!;
    expect(s.talents.points).toBe(1);
    const r = resetTalents(s);
    expect(r.talents.points).toBe(3);
    expect(r.talents.unlocked).toEqual([]);
    expect(r.talents.rankGranted).toBe(s.talents.rankGranted); // 不回退（防重复发段位点）
  });

  it("E5 转生 +1 点、上限 15、天赋/队伍跨转生保留", () => {
    // 直接驱动 doPrestige 的封顶逻辑：用 grantPrestigeTalentPoints 验证
    const at14 = grantPrestigeTalentPoints({ ...emptyTalents(), points: 14 });
    expect(at14.points).toBe(15);
    expect(grantPrestigeTalentPoints(at14).points).toBe(15);
    // 转生行为（doPrestige）在 helper 中验证
    const r = doPrestigeCheck();
    expect(r.gained).toBeGreaterThanOrEqual(1);
    expect(r.talentsBefore).toEqual(r.talentsAfter.unlocked); // 天赋保留
    expect(r.teamKept).toBe(true);
    expect(r.pointsDelta).toBe(1);
  });

  it("E6 逐级解锁：跳级/点数不足/未知 id 都被拒", () => {
    const s = withPoints(15);
    expect(canUnlock(s.talents, "click_2")).toBe(false);
    expect(TALENTS.length).toBe(15);
    expect(TALENT_COST).toBe(1);
    let cur = s;
    for (const id of ["click_1", "click_2", "click_3", "click_4", "click_5"]) cur = unlockTalent(cur, id)!;
    expect(cur.talents.points).toBe(10);
    expect(branchTier(cur.talents, "click")).toBe(5);
    expect(unlockTalent(cur, "click_5")).toBeNull();
  });
});

describe("F. 天赋效果接入：哪些节点是「点了没效果」", () => {
  it("F1 【缺陷】点击流 2 级「连击窗口」无效果：连击仍用常量 0.5s", () => {
    const eff = talentEffects({ ...emptyTalents(), unlocked: ["click_2"] });
    expect(eff.comboWindowBonus).toBe(0.1);
    expect(consumers("comboWindowBonus", "talents.ts")).toEqual([]); // 无消费点
  });

  it("F2 【缺陷】点击流 3 级「连击上限 30」无效果：comboMultiplier 仍封顶 20 连 ×1.24", () => {
    expect(comboMultiplier(20)).toBeCloseTo(1.24, 6);
    expect(comboMultiplier(30)).toBeCloseTo(1.24, 6); // 30 连也不给 1.36
    expect(consumers("comboMaxBonus", "talents.ts")).toEqual([]);
    // 点与不点 click_3，同样 30 连的点击收入完全一致
    const a = withLevels(rich(), { retire: 10 });
    const b = withTalents(a, ["click_1", "click_2", "click_3"]);
    expect(clickPowerOf({ ...a })).toBe(clickPowerOf({ ...b, talents: b.talents }) / 1.25);
    // comboMultiplier 不接收 talents 参数：签名即证明
    expect(comboMultiplier.length).toBe(1);
  });

  it("F3 【缺陷】点击流 4 级「每 20 次必暴击 ×5」无效果：连点 100 次无暴击跳变", () => {
    let s = withTalents(withLevels(rich(0), { retire: 10 }), ["click_1", "click_2", "click_3", "click_4"]);
    const per = clickPowerOf(s);
    const deltas = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const before = s.moyu;
      s = doClick(s, 0);
      deltas.add(Math.round((s.moyu - before) * 1e6) / 1e6);
    }
    console.log("[F3] 100 次点击的收入取值集合:", [...deltas]);
    expect(deltas.size).toBe(1); // 无任何 ×5 暴击
    expect([...deltas][0]).toBeCloseTo(per, 6);
    expect(dotClick().delta).toBe(clickPowerOf(dotClick().state)); // helper 复核 doClick 语义
    expect(consumers("critEvery", "talents.ts")).toEqual([]);
  });

  it("F4 【缺陷】事件流 2 级「偷点罚款 -35%」无效果：罚款与未点时一致", () => {
    const base = withLevels(rich(), { retire: 10 });
    const withT = withTalents(base, ["event_1", "event_2"]);
    const run = (state: typeof base) => {
      const es = newEventState();
      es.bossUntil = 100;
      es.bossStartAt = 0;
      es.bossVariant = "hold";
      es.patrolCount = 10;
      return onBossTap(state, es, 50, 0);
    };
    const a = run(base);
    const b = run(withT);
    console.log("[F4] 未点罚款=", a.lost, " 点了 event_2 罚款=", b.lost);
    expect(talentEffects(withT.talents).penaltyReduction).toBe(0.35);
    expect(b.lost).toBeCloseTo(a.lost, 6); // 实测完全没减
    expect(consumers("penaltyReduction", "talents.ts")).toEqual([]);
  });

  it("F5 【缺陷】事件流 4 级「巡逻横幅提前 2s」无效果（+5% 奖励有效）", () => {
    expect(consumers("patrolWarnSeconds", "talents.ts")).toEqual([]);
    const eff = talentEffects({ ...emptyTalents(), unlocked: ["event_1", "event_4"] });
    expect(eff.patrolWarnSeconds).toBe(2); // 聚合了但没人读
    expect(eff.patrolRewardMult).toBeCloseTo(1.2, 6); // 这部分有效
  });

  it("F6 有接入的效果（对照）：点击 1 级 / 挂机 1·3·5 / 事件 1·3·5", () => {
    expect(consumers("clickMult", "talents.ts").length).toBeGreaterThan(0);
    expect(consumers("idleMult", "talents.ts").length).toBeGreaterThan(0);
    expect(consumers("memeRewardMult", "talents.ts").length).toBeGreaterThan(0);
    expect(consumers("surviveToIdle", "talents.ts").length).toBeGreaterThan(0);
  });
});
