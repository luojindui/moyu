/**
 * R12 批次 1 审计：同事系统（team.ts）边界 / 非法输入 / 倍率与离线精度。
 * 只读 src/。断言按「当前实现实测行为」写，用于给缺陷报告提供可复现证据。
 * 运行：npx vitest run --config playtest/vitest.r12-aud.config.ts playtest/probe-r12-aud-engine.test.ts
 */
import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import {
  COLLEAGUES,
  MISSIONS,
  MAX_COLLEAGUE_LEVEL,
  DISPATCH_COEF,
  DISPATCH_FLOOR,
  canRecruit,
  canDispatch,
  claimMission,
  dispatch,
  dispatchReward,
  claimableCount,
  missionDone,
  recruit,
  teamFixedRate,
  teamShareRatio,
  teamSize,
  upgradeColleague,
  upgradeCostOf,
  favorTier,
} from "../src/engine/team";
import { effectOf, stationIdleOf, stationIdleScaled } from "../src/engine/upgrades";
import { offlineEarn } from "../src/engine/offline";
import { canPrestige } from "../src/engine/prestige";
import { buyUpgrade } from "../src/engine/actions";
import { withColleagues, withLevels, withTalents, rich, consumers, favorTierThresholds } from "./probe-r12-aud-lib";

const NOW = 1_700_000_000_000;

describe("A. 招募 / 升级：非法输入与边界", () => {
  it("A1 招募：未知 id / 余额不足 / 重复招募 全部返回 null 且不改状态", () => {
    const s = rich(12_000);
    expect(canRecruit(s, "nope")).toBe(false);
    expect(recruit(s, "nope")).toBeNull();
    expect(recruit(initialState(), "zhou")).toBeNull();
    expect(recruit(rich(11_999), "zhou")).toBeNull();
    expect(canRecruit(rich(11_999), "zhou")).toBe(false);
    const ok = recruit(rich(12_000), "zhou");
    expect(ok).not.toBeNull();
    expect(recruit(ok!, "zhou")).toBeNull();
    // 负余额（异常态）也不应招募成功
    const neg = { ...initialState(), moyu: -100 };
    expect(recruit(neg, "zhou")).toBeNull();
  });

  it("A2 升级：未知 id / 未招募 / 满级 / 钱不够 全部 null；价格=招募价×0.4×1.35^当前级", () => {
    expect(upgradeColleague(rich(), "nope")).toBeNull();
    expect(upgradeColleague(rich(), "zhou")).toBeNull(); // 未招募
    let s = recruit(rich(), "zhou")!;
    const def = COLLEAGUES[0]!;
    for (let lv = 1; lv < MAX_COLLEAGUE_LEVEL; lv++) {
      expect(upgradeCostOf(def, lv)).toBe(Math.ceil(def.cost * 0.4 * 1.35 ** lv));
    }
    // 钱不够：state 不变
    const poor = { ...s, moyu: upgradeCostOf(def, 1) - 1 };
    const before = JSON.stringify(poor);
    expect(upgradeColleague(poor, "zhou")).toBeNull();
    expect(JSON.stringify(poor)).toBe(before);
    // 升满后拒绝
    while (s.team.colleagues["zhou"]!.level < MAX_COLLEAGUE_LEVEL) s = upgradeColleague(s, "zhou")!;
    expect(upgradeColleague(s, "zhou")).toBeNull();
    expect(s.team.colleagues["zhou"]!.level).toBe(5);
  });

  it("A3 招募/升级扣款会扣减本局累计 totalEarned（与商店购买不一致）", () => {
    // state.ts 注释：totalEarned =「累计获得摸鱼值（含已花费，用于段位/转生门槛）」
    const base = { ...initialState(), moyu: 20_000, totalEarned: 20_000, lifetimeEarned: 100_000 };
    const r = recruit(base, "zhou")!;
    expect(r.moyu).toBe(8_000);
    console.log("[A3] recruit 后 totalEarned:", r.totalEarned, "(期望保持 20000)");
    expect(r.totalEarned).toBe(8_000); // 实测：被扣减

    const shop = buyUpgrade({ ...initialState(), moyu: 100, totalEarned: 1_000, lifetimeEarned: 1_000 }, "coffee")!;
    expect(shop.moyu).toBe(85);
    expect(shop.totalEarned).toBe(1_000); // 商店购买不扣累计 → 两套口径
  });

  it("A4 招募会把玩家踢回转生门槛之下（可观察的进度倒退）", () => {
    const near = { ...initialState(), moyu: 80_000_000, totalEarned: 100_000_000, lifetimeEarned: 200_000_000 };
    expect(canPrestige(near)).toBe(true);
    const after = recruit(near, "mei")!; // 小美 80 万
    console.log("[A4] 招募小美前 totalEarned=1e8 canPrestige=true → 后:", after.totalEarned, canPrestige(after));
    expect(canPrestige(after)).toBe(false); // 实测：本局累计跌破 1e8，转生按钮重新变灰
  });
});

describe("B. 派遣 / 领取：非法输入、时间回拨、重复领取、未知任务 id", () => {
  it("B1 派遣：未知同事 / 未知任务 / 已派遣 全部 null", () => {
    const s = recruit(rich(), "zhou")!;
    expect(dispatch(s, "nope", "quick", NOW)).toBeNull();
    expect(dispatch(s, "zhou", "nope", NOW)).toBeNull();
    const busy = dispatch(s, "zhou", "quick", NOW)!;
    expect(canDispatch(busy, "zhou")).toBe(false);
    expect(dispatch(busy, "zhou", "chat", NOW)).toBeNull();
  });

  it("B2 领取：未完成 / 时间回拨 / 重复领取 / 未招募 全部 null", () => {
    let s = recruit(rich(), "zhou")!;
    s = dispatch(s, "zhou", "quick", NOW)!;
    expect(missionDone(s, "zhou", NOW)).toBe(false);
    expect(claimMission(s, "zhou", NOW, 100)).toBeNull();
    // 系统时钟回拨到派遣前：任务未完成
    expect(claimMission(s, "zhou", NOW - 60_000, 100)).toBeNull();
    expect(claimMission(s, "nope", NOW + 10 * 60_000, 100)).toBeNull();
    const done = claimMission(s, "zhou", NOW + 15 * 60_000, 100)!;
    expect(done.state.team.colleagues["zhou"]!.missionId).toBeNull();
    // 重复领取：任务已交，第二次 null
    expect(claimMission(done.state, "zhou", NOW + 15 * 60_000, 100)).toBeNull();
    // 领取后再次派遣用当前时间（时间回拨后 endsAt 在过去，可立刻领）—— 记录行为
  });

  it("B3 好感：非匹配 +2 / 匹配 +3 / 封顶 100 / 100 时派遣 ×1.5", () => {
    let s = withColleagues(rich(), ["zhou"], 1);
    s = dispatch(s, "zhou", "quick", NOW)!; // 溜一圈=跑腿，老周擅长 chat → 不匹配
    const c1 = claimMission(s, "zhou", NOW + 15 * 60_000, 100)!;
    expect(c1.state.team.colleagues["zhou"]!.favor).toBe(2);
    let s2 = withColleagues(rich(), ["zhou"], 1);
    s2 = dispatch(s2, "zhou", "chat", NOW)!; // 茶水间=chat → 匹配
    const c2 = claimMission(s2, "zhou", NOW + 30 * 60_000, 100)!;
    expect(c2.state.team.colleagues["zhou"]!.favor).toBe(3);

    // 封顶
    const maxState = {
      ...withColleagues(rich(), ["zhou"], 1),
      team: { colleagues: { zhou: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 100 } } },
    };
    const done = dispatch(maxState, "zhou", "chat", NOW)!;
    const claimed = claimMission(done, "zhou", NOW + 30 * 60_000, 100)!;
    expect(claimed.state.team.colleagues["zhou"]!.favor).toBe(100); // 不再涨

    // 100 好感 ×1.5：同任务同等级同挂机，只差好感
    const f99 = { ...maxState, team: { colleagues: { zhou: { level: 1, missionId: "chat" as string, startedAt: 0, endsAt: 0, favor: 99 } } } };
    const f100 = { ...maxState, team: { colleagues: { zhou: { level: 1, missionId: "chat" as string, startedAt: 0, endsAt: 0, favor: 100 } } } };
    const r99v = dispatchReward(f99, "zhou", 1000);
    const r100v = dispatchReward(f100, "zhou", 1000);
    expect(r100v / r99v).toBeCloseTo(1.5, 6);
  });

  it("B4 【缺陷】未知 missionId 的存档进入领取会抛 TypeError（无净化）", () => {
    const s = withColleagues(rich(), ["zhou"], 1);
    const bad = {
      ...s,
      team: {
        colleagues: {
          zhou: { level: 1, missionId: "ghost_mission", startedAt: 0, endsAt: 0, favor: 0 },
        },
      },
    };
    expect(missionDone(bad, "zhou", NOW)).toBe(true); // endsAt=0 → 视为已完成
    expect(() => claimMission(bad, "zhou", NOW, 100)).toThrow(TypeError); // m 为 undefined → def.skill === m.type 崩溃
    // UI 上该同事永远显示「领取 +0」且点击无反应（main.ts onClaim 内抛错）
    expect(dispatchReward(bad, "zhou", 100)).toBe(0);
  });

  it("B5 【缺陷】UI 显示的领取奖励用 effectOf（含同事）当基数，实际到账用 stationIdleScaled（不含同事）", () => {
    // 复刻 team-panel.ts:127/158 的算法
    let s = withColleagues(withLevels(rich(), { retire: 10 }), COLLEAGUES.map((c) => c.id), 5);
    s = dispatch(s, "zhou", "quick", 0)!;
    const panelBase = effectOf(s).idleRate; // UI 用的「挂机总收益」
    const shown = dispatchReward(s, "zhou", panelBase); // UI 按钮文案
    const actual = claimMission(s, "zhou", MISSIONS[0]!.seconds * 1000, stationIdleScaled(s))!.reward; // main.ts:174
    console.log("[B5] 面板显示领取 +", shown, " 实际到账 +", actual, " 显示/实际 =", (shown / actual).toFixed(3));
    expect(shown / actual).toBeGreaterThan(1.5); // 实测约 1.93×，白高兴一场
    // 反证：若 UI 也用 stationIdleScaled，则完全一致
    expect(dispatchReward(s, "zhou", stationIdleScaled(s))).toBe(actual);
  });
});

describe("C. 倍率：离线 50% 精度 / 工位·同事·天赋是否重复放大", () => {
  it("C1 离线：工位 100% + 同事 50% 精确成立", () => {
    const s = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou"], 1);
    const station = stationIdleScaled(s);
    const idle = effectOf(s).idleRate;
    const expected = (station + (idle - station) * 0.5) * 3600;
    const got = offlineEarn(s, 3600, 1);
    expect(got.applied).toBe(3600);
    console.log("[C1] station=", station, " team=", idle - station, " 离线每小时=", got.earned, " 期望=", expected);
    expect(got.earned).toBeCloseTo(expected, 6);
    // 同事固定值占比 0.5：两倍同事 → 离线增量恰好一半
    const s2 = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou", "mei"], 1);
    const inc1 = offlineEarn(s, 3600, 1).earned - offlineEarn(withLevels(rich(), { retire: 10 }), 3600, 1).earned;
    const inc2 = offlineEarn(s2, 3600, 1).earned - offlineEarn(withLevels(rich(), { retire: 10 }), 3600, 1).earned;
    expect(inc2).toBeGreaterThan(inc1);
  });

  it("C2 离线：挂机天赋只放大工位，不放大同事固定值（无双重放大）", () => {
    const base = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou"], 1);
    const t = withTalents(base, ["idle_1"]); // 挂机 +5%
    const station0 = stationIdleScaled(base);
    const station1 = stationIdleScaled(t);
    expect(station1 / station0).toBeCloseTo(1.05, 6);
    // 同事固定部分：effectOf - station - share = fixed，天赋前后应完全一致
    const share0 = station0 * teamShareRatio(base);
    const share1 = station1 * teamShareRatio(t);
    const fixed0 = effectOf(base).idleRate - station0 - share0;
    const fixed1 = effectOf(t).idleRate - station1 - share1;
    expect(fixed0).toBeCloseTo(teamFixedRate(base), 6);
    expect(fixed1).toBeCloseTo(teamFixedRate(t), 6); // 未被 idleMult 放大 → 符合设计
  });

  it("C3 【规格偏差】同事 share 以「已放大工位」为基数，被挂机天赋二次放大", () => {
    const base = withColleagues(withLevels(rich(), { retire: 10 }), COLLEAGUES.map((c) => c.id), 5);
    const t = withTalents(base, ["idle_1"]);
    const share0 = stationIdleScaled(base) * teamShareRatio(base);
    const share1 = stationIdleScaled(t) * teamShareRatio(t);
    console.log("[C3] share 无天赋=", share0.toFixed(2), " 有 idle_1=", share1.toFixed(2), " 比值=", (share1 / share0).toFixed(4));
    // 平衡决策书 §五.4：share 以「未放大工位」为基数 → 期望比值 1.0；实测 1.05
    expect(share1 / share0).toBeCloseTo(1.05, 6);
  });

  it("C4 好感里程碑：只实现了 40 / 80（且 80 是全局 +10% 而非 +2%/人）", () => {
    const thresholds = favorTierThresholds().sort((a, b) => a - b);
    console.log("[C4] favorTier 阈值消费点:", thresholds);
    expect(thresholds).toEqual([2, 4]); // 缺 20(1)/60(3)：好感 20「横幅提前 2s」、60「丢梗 +10%」无实现
    // 80：只招募老周一人、好感 80 → 同事挂机固定部分直接 ×1.1
    const one = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou"], 1);
    const with80 = { ...one, team: { colleagues: { zhou: { ...one.team.colleagues["zhou"]!, favor: 80 } } } };
    const share = stationIdleScaled(with80) * teamShareRatio(with80);
    const fixed80 = effectOf(with80).idleRate - stationIdleScaled(with80) - share;
    console.log("[C4] 单同事好感 80 时固定部分:", fixed80, "(原始 20)");
    expect(fixed80).toBeCloseTo(22, 6); // 规格「+2%/同事」；当前实现直接 +10%
    expect(favorTier(with80)).toBe(4);
  });

  it("C5 倍率不重复：effectOf.idleRate 恰好 = 工位(已放大) + 固定 + share×工位", () => {
    let s = withColleagues(withLevels(rich(), { retire: 10 }), COLLEAGUES.map((c) => c.id), 5);
    s = withTalents(s, ["idle_1", "idle_3", "idle_5", "click_5", "event_5"]);
    s = { ...s, totalClicks: 3000, patrolSurvives: 10 };
    const station = stationIdleScaled(s);
    const fixed = teamFixedRate(s);
    const share = station * teamShareRatio(s);
    const idle = effectOf(s).idleRate;
    console.log("[C5] station=", station, " fixed=", fixed, " share=", share, " total=", idle);
    expect(idle).toBeCloseTo(station + fixed + share, 6);
    // 离线再算一次也不重复：earned/hr = station + (fixed+share)*0.5
    expect(offlineEarn(s, 3600, 1).earned).toBeCloseTo((station + (fixed + share) * 0.5) * 3600, 6);
  });

  it("C6 派遣奖励基数不含同事（规格：避免自我循环）", () => {
    const bare = withLevels(rich(), { retire: 10 });
    const mate = withColleagues(bare, ["zhou"], 1);
    const d1 = dispatch(bare, "zhou", "quick", 0);
    expect(d1).toBeNull(); // 未招募不能派遣
    const dm = dispatch(mate, "zhou", "quick", 0)!;
    const r = dispatchReward(dm, "zhou", stationIdleScaled(dm));
    const base = Math.max(DISPATCH_FLOOR, stationIdleScaled(dm) * 900 * DISPATCH_COEF);
    expect(r).toBe(Math.floor(base * MISSIONS[0]!.mult * 1 * 1));
  });

  it("C7 小队计数 / 可领数量与空队一致", () => {
    const s = withColleagues(rich(), ["zhou", "mei"], 2);
    expect(teamSize(s)).toBe(2);
    expect(claimableCount(s, NOW)).toBe(0);
    let d = dispatch(s, "zhou", "quick", NOW)!;
    d = dispatch(d, "mei", "chat", NOW)!;
    expect(claimableCount(d, NOW)).toBe(0);
    expect(claimableCount(d, NOW + 15 * 60_000)).toBe(1);
    expect(claimableCount(d, NOW + 30 * 60_000)).toBe(2);
  });
});

describe("D. 静态消费点：天赋效果字段是否有消费者", () => {
  it("D1 点击流 2/3/4 级与事件流 2/4(预警) 的效果字段在 src 中无消费点", () => {
    const dead = ["comboWindowBonus", "comboMaxBonus", "critEvery", "penaltyReduction", "patrolWarnSeconds"];
    for (const field of dead) {
      const hits = consumers(field, "talents.ts");
      console.log(`[D1] ${field} 消费点:`, hits);
      expect(hits).toEqual([]); // 只有 talents.ts 聚合，没有被任何玩法读取 → 点了没效果
    }
  });
});
