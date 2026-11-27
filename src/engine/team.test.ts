import { describe, it, expect } from "vitest";
import { initialState, gain } from "./state";
import {
  COLLEAGUES,
  FIRST_COLLEAGUE_PRICE,
  MAX_COLLEAGUE_LEVEL,
  MISSIONS,
  SKILL_MATCH_BONUS,
  canRecruit,
  claimMission,
  claimableCount,
  dispatch,
  dispatchReward,
  DISPATCH_COEF,
  DISPATCH_FLOOR,
  DISPATCH_LEVEL_FACTOR,
  emptyTeam,
  missionDone,
  recruit,
  teamFixedRate,
  teamShareRatio,
  teamSize,
  upgradeColleague,
  upgradeCostOf,
} from "./team";

const NOW = 1_700_000_000_000;

function rich(amount = 100_000_000_000) {
  return gain(initialState(), amount);
}

describe("摸鱼小队（第二玩法）", () => {
  it("招募：扣钱、入队、提供挂机收益", () => {
    const s = rich();
    expect(canRecruit(s, "zhou")).toBe(true);
    const r = recruit(s, "zhou")!;
    // 首位同事有新人价折扣（12,000 → 1,500），让新手目标链第 8 步可达
    expect(r.moyu).toBe(s.moyu - FIRST_COLLEAGUE_PRICE);
    expect(teamSize(r)).toBe(1);
    expect(teamFixedRate(r)).toBe(COLLEAGUES[0]!.idlePerLevel);
    expect(teamShareRatio(r)).toBeCloseTo(COLLEAGUES[0]!.sharePerLevel, 10);
    // 不能重复招募
    expect(recruit(r, "zhou")).toBeNull();
  });

  it("招募：钱不够失败", () => {
    const s = initialState();
    expect(canRecruit(s, "zhou")).toBe(false);
    expect(recruit(s, "zhou")).toBeNull();
  });

  it("升级：价格递增、收益线性增长、等级上限 5", () => {
    let s = rich();
    s = recruit(s, "zhou")!;
    const def = COLLEAGUES[0]!;
    const price1 = upgradeCostOf(def, 1);
    s = upgradeColleague(s, "zhou")!;
    expect(s.team.colleagues["zhou"]!.level).toBe(2);
    expect(teamFixedRate(s)).toBe(def.idlePerLevel * 2);
    const price2 = upgradeCostOf(def, 2);
    expect(price2).toBeGreaterThan(price1);
    // 升到 5 级后不能再升
    let capped = s;
    for (let i = 0; i < 5; i++) {
      const nx = upgradeColleague(capped, "zhou");
      if (nx) capped = nx;
    }
    expect(capped.team.colleagues["zhou"]!.level).toBe(MAX_COLLEAGUE_LEVEL);
    expect(upgradeColleague(capped, "zhou")).toBeNull();
  });

  it("派遣：占用同事、到点可领、领完恢复空闲", () => {
    let s = recruit(rich(), "zhou")!;
    const m = MISSIONS[1]!; // 开会 1h
    s = dispatch(s, "zhou", m.id, NOW, 1000)!;
    expect(s.team.colleagues["zhou"]!.missionId).toBe(m.id);
    expect(missionDone(s, "zhou", NOW + 1000)).toBe(false);
    expect(claimMission(s, "zhou", NOW + 1000, 100)).toBeNull();
    expect(missionDone(s, "zhou", NOW + m.seconds * 1000)).toBe(true);
    const c = claimMission(s, "zhou", NOW + m.seconds * 1000, 100)!;
    expect(c.reward).toBeGreaterThan(0);
    expect(c.state.team.colleagues["zhou"]!.missionId).toBeNull();
    expect(c.state.moyu).toBeGreaterThan(s.moyu);
  });

  it("派遣中不能再次派遣", () => {
    let s = recruit(rich(), "zhou")!;
    s = dispatch(s, "zhou", MISSIONS[0]!.id, NOW, 1000)!;
    expect(dispatch(s, "zhou", MISSIONS[2]!.id, NOW, 1000)).toBeNull();
  });

  it("技能匹配 +50% 奖励（老周擅长 chat）", () => {
    const s = recruit(rich(), "zhou")!;
    // 用同一任务、人为把同事技能改成不匹配来对比，隔离时长/倍率影响
    const chatMission = MISSIONS.find((m) => m.type === "chat")!;
    const matched = dispatch(s, "zhou", chatMission.id, NOW, 1000)!;
    const stationIdle = 1000;
    const withMatch = dispatchReward(matched, "zhou", stationIdle);
    // 直接计算：max(300, 1000×秒×0.011) × mult × 匹配1.5 × 等级系数1（lv1） × 好感1
    // 公式：base = max(300, (工位 + 同事贡献×2) × 秒 × 0.011)
    const colIdle = 20 * 1 + stationIdle * 0.008 * 1; // 老周 Lv1
    const base = Math.max(DISPATCH_FLOOR, (stationIdle + colIdle * 2) * chatMission.seconds * DISPATCH_COEF);
    const levelFactor = 1 + DISPATCH_LEVEL_FACTOR * 0; // lv1
    expect(withMatch).toBe(Math.floor(base * chatMission.mult * (1 + SKILL_MATCH_BONUS) * levelFactor));
    expect(SKILL_MATCH_BONUS).toBe(0.5);
  });

  it("长任务奖励更高（同挂机率下）", () => {
    let s = recruit(rich(), "zhou")!;
    const short = MISSIONS[0]!;
    const long = MISSIONS[2]!;
    const withShort = dispatch(s, "zhou", short.id, NOW, 1000)!;
    const rShort = dispatchReward(withShort, "zhou", 1000);
    const withLong = dispatch(s, "zhou", long.id, NOW, 1000)!;
    const rLong = dispatchReward(withLong, "zhou", 1000);
    expect(rLong).toBeGreaterThan(rShort);
  });

  it("claimableCount 统计可领数量", () => {
    let s = recruit(rich(), "zhou")!;
    s = recruit(s, "mei")!;
    s = dispatch(s, "zhou", MISSIONS[0]!.id, NOW, 1000)!;
    s = dispatch(s, "mei", MISSIONS[0]!.id, NOW, 1000)!;
    expect(claimableCount(s, NOW + 1000)).toBe(0);
    expect(claimableCount(s, NOW + MISSIONS[0]!.seconds * 1000)).toBe(2);
  });

  it("空队伍", () => {
    const s = initialState();
    expect(teamFixedRate(s)).toBe(0);
    expect(teamShareRatio(s)).toBe(0);
    expect(teamSize(s)).toBe(0);
    expect(s.team).toEqual(emptyTeam());
  });
});
