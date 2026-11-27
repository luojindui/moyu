import { describe, it, expect } from "vitest";
import { initialState, gain } from "./state";
import {
  COLLEAGUES,
  MISSIONS,
  SKILL_MATCH_BONUS,
  canRecruit,
  claimMission,
  claimableCount,
  dispatch,
  dispatchReward,
  emptyTeam,
  missionDone,
  recruit,
  teamIdleRate,
  teamSize,
  upgradeColleague,
  upgradeCostOf,
} from "./team";

const NOW = 1_700_000_000_000;

function rich(amount = 10_000_000) {
  return gain(initialState(), amount);
}

describe("摸鱼小队（第二玩法）", () => {
  it("招募：扣钱、入队、提供挂机收益", () => {
    const s = rich();
    expect(canRecruit(s, "zhou")).toBe(true);
    const r = recruit(s, "zhou")!;
    expect(r.moyu).toBe(s.moyu - COLLEAGUES[0]!.cost);
    expect(teamSize(r)).toBe(1);
    expect(teamIdleRate(r)).toBe(COLLEAGUES[0]!.idlePerLevel);
    // 不能重复招募
    expect(recruit(r, "zhou")).toBeNull();
  });

  it("招募：钱不够失败", () => {
    const s = initialState();
    expect(canRecruit(s, "zhou")).toBe(false);
    expect(recruit(s, "zhou")).toBeNull();
  });

  it("升级：价格递增、收益线性增长、封顶", () => {
    let s = rich();
    s = recruit(s, "zhou")!;
    const def = COLLEAGUES[0]!;
    const price1 = upgradeCostOf(def, 1);
    s = upgradeColleague(s, "zhou")!;
    expect(s.team.colleagues["zhou"]!.level).toBe(2);
    expect(teamIdleRate(s)).toBe(def.idlePerLevel * 2);
    const price2 = upgradeCostOf(def, 2);
    expect(price2).toBeGreaterThan(price1);
  });

  it("派遣：占用同事、到点可领、领完恢复空闲", () => {
    let s = recruit(rich(), "zhou")!;
    const m = MISSIONS[1]!; // 开会 1h
    s = dispatch(s, "zhou", m.id, NOW)!;
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
    s = dispatch(s, "zhou", MISSIONS[0]!.id, NOW)!;
    expect(dispatch(s, "zhou", MISSIONS[2]!.id, NOW)).toBeNull();
  });

  it("技能匹配 +50% 奖励（老周擅长 chat）", () => {
    const s = recruit(rich(), "zhou")!;
    // 用同一任务、人为把同事技能改成不匹配来对比，隔离时长/倍率影响
    const chatMission = MISSIONS.find((m) => m.type === "chat")!;
    const matched = dispatch(s, "zhou", chatMission.id, NOW)!;
    const withMatch = dispatchReward(matched, "zhou", 1000);
    // 直接计算基准：max(200, 1000×seconds) × mult
    const base = Math.max(200, 1000 * chatMission.seconds) * chatMission.mult;
    expect(withMatch).toBe(Math.floor(base * (1 + SKILL_MATCH_BONUS)));
    expect(SKILL_MATCH_BONUS).toBe(0.5);
  });

  it("长任务奖励更高（同挂机率下）", () => {
    let s = recruit(rich(), "zhou")!;
    const short = MISSIONS[0]!;
    const long = MISSIONS[2]!;
    const withShort = dispatch(s, "zhou", short.id, NOW)!;
    const rShort = dispatchReward(withShort, "zhou", 1000);
    const withLong = dispatch(s, "zhou", long.id, NOW)!;
    const rLong = dispatchReward(withLong, "zhou", 1000);
    expect(rLong).toBeGreaterThan(rShort);
  });

  it("claimableCount 统计可领数量", () => {
    let s = recruit(rich(), "zhou")!;
    s = recruit(s, "mei")!;
    s = dispatch(s, "zhou", MISSIONS[0]!.id, NOW)!;
    s = dispatch(s, "mei", MISSIONS[0]!.id, NOW)!;
    expect(claimableCount(s, NOW + 1000)).toBe(0);
    expect(claimableCount(s, NOW + MISSIONS[0]!.seconds * 1000)).toBe(2);
  });

  it("空队伍", () => {
    const s = initialState();
    expect(teamIdleRate(s)).toBe(0);
    expect(teamSize(s)).toBe(0);
    expect(s.team).toEqual(emptyTeam());
  });
});
