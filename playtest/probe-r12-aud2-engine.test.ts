/**
 * R12 批次 1 复验：同事系统（P1-2/P1-3/新增快照·排班·traits·在外折损）行为验证。
 * 只读 src/。断言按当前实现实测行为写；console.log 输出用于报告取证。
 */
import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import {
  AWAY_IDLE_FACTOR,
  COLLEAGUES,
  DISPATCH_COEF,
  DISPATCH_FLOOR,
  MAX_COLLEAGUE_LEVEL,
  claimMission,
  claimableTotal,
  colleagueDef,
  dispatch,
  dispatchReward,
  missionDone,
  missionSecondsFor,
  recruit,
  setAutoRepeat,
  teamFixedRate,
  teamShareRatio,
  upgradeColleague,
} from "../src/engine/team";
import { effectOf, stationIdleScaled } from "../src/engine/upgrades";
import { offlineEarn } from "../src/engine/offline";
import { buyUpgrade } from "../src/engine/actions";
import { withColleagues, withLevels, withTalents, rich, dispatchAt, consumers, favorTierThresholds, COSTS } from "./probe-r12-aud2-lib";

describe("V1. P1-3 totalEarned 语义（复验）", () => {
  it("V1 招募/升级只扣余额，本局累计 totalEarned 不回退（与商店一致）", () => {
    const base = { ...initialState(), moyu: 1_000_000, totalEarned: 1_000_000, lifetimeEarned: 9_000_000 };
    const r = recruit(base, "zhou")!;
    expect(r.moyu).toBe(1_000_000 - COLLEAGUES[0]!.cost);
    expect(r.totalEarned).toBe(1_000_000); // 修复生效
    const u = upgradeColleague(r, "zhou")!;
    expect(u.totalEarned).toBe(1_000_000);
    const shop = buyUpgrade(base, "coffee")!;
    expect(shop.totalEarned).toBe(1_000_000);
    console.log("[V1] recruit/upgrade/shop 后 totalEarned 均保持 1000000 ✓");
  });
});

describe("V2. P1-2 领取显示 vs 实到账（快照复验）", () => {
  it("V2 派遣时快照：之后升级工位也不放大奖励；面板显示值=实到账", () => {
    let s = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou"], 1);
    const stationAtDispatch = stationIdleScaled(s);
    const d = dispatchAt(s, "zhou", "quick", 0, stationAtDispatch);
    const cur = d.state.team.colleagues["zhou"]!;
    const snapshot = cur.rewardSnapshot;
    expect(snapshot).toBe(dispatchReward(d.state, "zhou", stationAtDispatch));

    // 派遣后把工位从 7000/s 升到 28000/s
    const grown = withLevels(d.state, { retire: 20 });
    const stationNow = stationIdleScaled(grown);
    expect(stationNow).toBeGreaterThan(stationAtDispatch * 3);

    // 面板「领取 +N」复刻（team-panel.ts:265）：有快照用快照
    const panelShown = cur.rewardSnapshot > 0 ? cur.rewardSnapshot : dispatchReward(grown, "zhou", stationNow);
    const claimed = claimMission(grown, "zhou", d.endsAt, stationNow)!;
    expect(claimed.reward).toBe(snapshot);
    expect(panelShown).toBe(claimed.reward); // 显示 = 到账 ✓
    // 若按领取时重算会是多少（快照确实阻止了放大）
    const recomputed = dispatchReward({ ...grown, team: { colleagues: { zhou: { ...cur, missionId: "quick" } } } }, "zhou", stationNow);
    console.log("[V2] 快照=", snapshot, " 领取时重算=", recomputed, " 显示=到账=", claimed.reward);
    expect(recomputed).toBeGreaterThan(snapshot * 3);
  });

  it("V2b 【残留缺陷】一键领取总价用「当前挂机率」而非快照 → 显示值仍虚高", () => {
    let s = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou", "mei"], 1);
    const station0 = stationIdleScaled(s);
    s = dispatchAt(s, "zhou", "quick", 0, station0).state;
    s = dispatchAt(s, "mei", "chat", 0, station0).state;
    const snapSum = s.team.colleagues["zhou"]!.rewardSnapshot + s.team.colleagues["mei"]!.rewardSnapshot;
    const endsAt = Math.max(s.team.colleagues["zhou"]!.endsAt, s.team.colleagues["mei"]!.endsAt);
    // 派遣途中升级工位（正常玩法）
    const grown = withLevels(s, { retire: 20 });
    const stationNow = stationIdleScaled(grown);
    const shownTotal = claimableTotal(grown, endsAt, stationNow); // 面板「一键领取 +X」
    let st = grown;
    let actual = 0;
    for (const id of ["zhou", "mei"]) {
      const r = claimMission(st, id, endsAt, stationNow)!;
      actual += r.reward;
      st = r.state;
    }
    console.log("[V2b] 一键按钮显示 +", Math.round(shownTotal), " 实际合计 +", Math.round(actual), " 比值=", (shownTotal / actual).toFixed(2));
    expect(shownTotal).toBeGreaterThan(actual * 1.5); // 残留：一键领取展示值虚高
    expect(actual).toBe(snapSum);
  });

  it("V2c 旧档无快照（rewardSnapshot=0）按领取时结算（兼容旧存档）", () => {
    let s = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou"], 1);
    const st = stationIdleScaled(s);
    s = dispatchAt(s, "zhou", "quick", 0, st).state;
    const legacy = { ...s, team: { colleagues: { zhou: { ...s.team.colleagues["zhou"]!, rewardSnapshot: 0 } } } };
    const claimed = claimMission(legacy, "zhou", legacy.team.colleagues["zhou"]!.endsAt, st)!;
    expect(claimed.reward).toBe(dispatchReward({ ...legacy, team: { colleagues: { zhou: { ...legacy.team.colleagues["zhou"]!, missionId: "quick" } } } }, "zhou", st));
  });

  it("V2d 好感 100 的 ×1.5 不进快照：派遣后升到 100 再领，拿不到 1.5（边界）", () => {
    let s = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou"], 1);
    s = { ...s, team: { colleagues: { zhou: { ...s.team.colleagues["zhou"]!, favor: 99 } } } };
    const st = stationIdleScaled(s);
    s = dispatchAt(s, "zhou", "chat", 0, st).state; // 匹配任务
    const snap = s.team.colleagues["zhou"]!.rewardSnapshot;
    const atClaim = { ...s, team: { colleagues: { zhou: { ...s.team.colleagues["zhou"]!, favor: 100 } } } };
    const claimed = claimMission(atClaim, "zhou", atClaim.team.colleagues["zhou"]!.endsAt, st)!;
    const currentCalc = dispatchReward(atClaim, "zhou", st); // 好感 100 → ×1.5
    console.log("[V2d] 快照=", snap, " 领取时按好感100重算=", currentCalc, " 实到=", claimed.reward);
    expect(currentCalc / claimed.reward).toBeCloseTo(1.5, 3); // 设计边界：好感到 100 的那一笔拿不到 ×1.5
  });
});

describe("V3. 新增机制：在外折损 / traits / 排班", () => {
  it("V3 派遣中的同事固定值与 share 都只算 50%", () => {
    const home = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou"], 5);
    expect(teamFixedRate(home)).toBe(COLLEAGUES[0]!.idlePerLevel * 5);
    expect(teamShareRatio(home)).toBeCloseTo(0.008 * 5, 10);
    const away = dispatchAt(home, "zhou", "quick", 0, stationIdleScaled(home)).state;
    expect(teamFixedRate(away)).toBe(COLLEAGUES[0]!.idlePerLevel * 5 * AWAY_IDLE_FACTOR);
    expect(teamShareRatio(away)).toBeCloseTo(0.008 * 5 * AWAY_IDLE_FACTOR, 10);
    // 在线收益：在外 → 回来的瞬间 idleRate 提升
    const idleAway = effectOf(away).idleRate;
    const idleHome = effectOf(home).idleRate;
    expect(idleHome).toBeGreaterThan(idleAway);
    console.log("[V3] 在家 idle=", idleHome.toFixed(2), " 在外 idle=", idleAway.toFixed(2), " 差额=", (idleHome - idleAway).toFixed(2));
  });

  it("V3b 在外 + 离线 = 同事收益只剩 25%（50% 折损 × 50% 离线，设计口径记录）", () => {
    const home = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou"], 1);
    const st = stationIdleScaled(home);
    const away = dispatchAt(home, "zhou", "quick", 0, st).state;
    const earnedHome = offlineEarn(home, 3600, 1).earned;
    const earnedAway = offlineEarn(away, 3600, 1).earned;
    const homeTeamPart = effectOf(home).idleRate - stationIdleScaled(home);
    const awayTeamPart = effectOf(away).idleRate - stationIdleScaled(away);
    const homeOfflineTeam = homeTeamPart * 0.5 * 3600;
    const awayOfflineTeam = awayTeamPart * 0.5 * 3600;
    console.log("[V3b] 同事离线收益 在家=", homeOfflineTeam.toFixed(1), " 在外=", awayOfflineTeam.toFixed(1), " 相对在家=", (awayOfflineTeam / homeOfflineTeam).toFixed(3), " 相对名义在线=", (awayOfflineTeam / (homeTeamPart * 3600)).toFixed(3));
    // 在家离线 = 名义 50%；在外再 ×50% → 名义的 25%（相对"在家离线"是 50%）
    expect(awayOfflineTeam / (homeTeamPart * 3600)).toBeCloseTo(0.25, 3);
    expect(awayOfflineTeam / homeOfflineTeam).toBeCloseTo(0.5, 3);
    expect(earnedHome - earnedAway).toBeGreaterThan(0);
  });

  it("V3c traits：老周/小李/王师傅生效；小美/强哥的被动无消费点（失效）", () => {
    expect(missionSecondsFor("zhou", "quick")).toBe(765); // 900 × 0.85
    expect(missionSecondsFor("mei", "quick")).toBe(900);
    // 小李：1h 内任务 +50%
    const li = withColleagues(rich(), ["li"], 1);
    const st = 1000;
    const dLi = dispatchAt(li, "li", "quick", 0, st);
    const expectedLi = Math.floor(Math.max(DISPATCH_FLOOR, st * 900 * DISPATCH_COEF) * 1.2 * 1.5 * 1 * 1 * 1.5);
    expect(dLi.state.team.colleagues["li"]!.rewardSnapshot).toBe(expectedLi);
    // 王师傅：4h 以上 +50%
    const wang = withColleagues(rich(), ["wang"], 1);
    const dW = dispatchAt(wang, "wang", "coffee", 0, st);
    const expectedW = Math.floor(Math.max(DISPATCH_FLOOR, st * 28800 * DISPATCH_COEF) * 2.8 * 1.5 * 1 * 1 * 1.5);
    expect(dW.state.team.colleagues["wang"]!.rewardSnapshot).toBe(expectedW);
    // 小美（离线效率 +2%）/强哥（罚款 -10%）：teamTraits 无任何消费者
    const traitConsumers = consumers("teamTraits", "team.ts");
    console.log("[V3c] teamTraits 消费点:", traitConsumers, " penaltyReduction 消费点:", consumers("penaltyReduction", "talents.ts"));
    expect(traitConsumers).toEqual([]); // 【缺陷】两个被动 + event_2 全部无接入
  });

  it("V3d 排班层 autoRepeat：领取后自动再派同任务（快照重算、好感累加）", () => {
    let s = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou"], 1);
    const st = stationIdleScaled(s);
    s = dispatchAt(s, "zhou", "quick", 0, st).state;
    s = setAutoRepeat(s, "zhou", true)!;
    const cur = s.team.colleagues["zhou"]!;
    const r = claimMission(s, "zhou", cur.endsAt, st)!;
    const next = r.state.team.colleagues["zhou"]!;
    expect(next.missionId).toBe("quick");
    expect(next.endsAt).toBe(cur.endsAt + 765 * 1000);
    expect(next.startedAt).toBe(cur.endsAt);
    expect(next.rewardSnapshot).toBeGreaterThan(0);
    expect(next.favor).toBe(2); // 不匹配任务 +2
    expect(missionDone(r.state, "zhou", cur.endsAt)).toBe(false);
    expect(claimMission(r.state, "zhou", cur.endsAt, st)).toBeNull(); // 下一轮未完成不能领
    // 关闭自动重复后领取 → 回到空闲
    const off = setAutoRepeat(r.state, "zhou", false)!;
    const r2 = claimMission(off, "zhou", next.endsAt, st)!;
    expect(r2.state.team.colleagues["zhou"]!.missionId).toBeNull();
    console.log("[V3d] autoRepeat 正常：下一轮 endsAt=", next.endsAt, " snapshot=", next.rewardSnapshot);
  });

  it("V3e 非法输入：未知同事/未知任务/重复派遣/未完成领取 均 null", () => {
    const s = recruit(rich(), "zhou")!;
    expect(dispatch(s, "nope", "quick", 0, 100)).toBeNull();
    expect(dispatch(s, "zhou", "nope", 0, 100)).toBeNull();
    const busy = dispatch(s, "zhou", "quick", 0, 100)!;
    expect(dispatch(busy, "zhou", "chat", 0, 100)).toBeNull();
    expect(claimMission(busy, "zhou", 0, 100)).toBeNull();
    expect(claimMission(busy, "nope", 10 ** 12, 100)).toBeNull();
    expect(setAutoRepeat(s, "nope", true)).toBeNull();
  });
});

describe("V4. 倍率与里程碑（残留项复验）", () => {
  it("V4a 【残留】同事 share 仍以「已放大工位」为基数，被挂机天赋二次放大", () => {
    const base = withColleagues(withLevels(rich(), { retire: 10 }), COLLEAGUES.map((c) => c.id), 5);
    const t = withTalents(base, ["idle_1"]); // 挂机 +6%
    const share0 = stationIdleScaled(base) * teamShareRatio(base);
    const share1 = stationIdleScaled(t) * teamShareRatio(t);
    console.log("[V4a] share 无天赋=", share0.toFixed(1), " 有 idle_1=", share1.toFixed(1), " 比值=", (share1 / share0).toFixed(3));
    expect(share1 / share0).toBeCloseTo(1.06, 6);
  });

  it("V4b 【残留】好感里程碑：仍只有 40/80 生效；20/60 无实现，80 为全局 +10%", () => {
    const thresholds = favorTierThresholds().sort((a, b) => a - b);
    console.log("[V4b] favorTier 阈值消费点:", thresholds);
    expect(thresholds).toEqual([2, 4]);
    const one = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou"], 1);
    const with80 = { ...one, team: { colleagues: { zhou: { ...one.team.colleagues["zhou"]!, favor: 80 } } } };
    const station = stationIdleScaled(with80);
    const share = station * teamShareRatio(with80);
    const fixedPart = effectOf(with80).idleRate - station - share;
    console.log("[V4b] 单同事好感 80 → 固定挂机部分:", fixedPart, "(原始 20；规格 +2%/人 → 20.4)");
    expect(fixedPart).toBeCloseTo(22, 6);
  });
});

describe("V5. 规格数值漂移与初始状态", () => {
  it("V5 【规格漂移】同事招募价/每级 share 与平衡决策书不一致（未见于任何决策文档）", () => {
    const documented = [12_000, 800_000, 15_000_000, 300_000_000, 6_000_000_000];
    console.log("[V5] 文档价:", documented, " 代码价:", COSTS);
    expect(COSTS).not.toEqual(documented); // 12000/50万/800万/6000万/4亿 vs 文档 12k/80万/1500万/3亿/60亿
    expect(COSTS).toEqual([12_000, 500_000, 8_000_000, 60_000_000, 400_000_000]);
    expect(COLLEAGUES.map((c) => c.sharePerLevel)).toEqual([0.008, 0.01, 0.012, 0.014, 0.016]);
  });
});
