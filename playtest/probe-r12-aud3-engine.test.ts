/**
 * R12 三次复验：同事/派遣/离线/好感/离岗折损/面板数值。
 * 只读 src/。断言按当前实现（HEAD 913d2ee / src 62f1486）行为写。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { initialState } from "../src/engine/state";
import {
  AWAY_IDLE_FACTOR,
  COLLEAGUES,
  DISPATCH_COEF,
  DISPATCH_FLOOR,
  MISSIONS,
  claimMission,
  claimableTotal,
  dispatch,
  dispatchReward,
  favorBonuses,
  favorTier,
  missionSecondsFor,
  recruit,
  setAutoRepeat,
  teamFixedRate,
  teamShareRatio,
} from "../src/engine/team";
import { effectOf, idleIfHome, stationIdleOf, stationIdleScaled } from "../src/engine/upgrades";
import { offlineEarn } from "../src/engine/offline";
import { offlineEfficiency } from "../src/engine/progression";
import { withColleagues, withLevels, withTalents, rich, memoryAdapter } from "./probe-r12-aud2-lib";

const NOW = Date.UTC(2026, 11, 1);

describe("X1. 离岗折损 15%（只在进行中）与离线", () => {
  it("X1a 派遣中固定/share 只算 85%；任务结束（未领）即恢复 100%", () => {
    expect(AWAY_IDLE_FACTOR).toBe(0.85);
    const home = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou"], 5);
    const fixedHome = teamFixedRate(home);
    const d = dispatch(home, "zhou", "quick", Date.now(), stationIdleScaled(home))!;
    const away = teamFixedRate(d);
    const done = { ...d, team: { colleagues: { zhou: { ...d.team.colleagues["zhou"]!, endsAt: Date.now() - 1 } } } };
    console.log("[X1a] fixed home=", fixedHome, " in-progress=", away, " done=", teamFixedRate(done));
    expect(away).toBeCloseTo(fixedHome * 0.85, 6);
    expect(teamFixedRate(done)).toBeCloseTo(fixedHome, 6);
    expect(teamShareRatio(d)).toBeCloseTo(teamShareRatio(home) * 0.85, 10);
  });

  it("X1b 离线：同事部分先 ×85%（进行中）再 ×50%", () => {
    const home = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou"], 1);
    const d = dispatch(home, "zhou", "quick", Date.now(), stationIdleScaled(home))!;
    const station = stationIdleScaled(d);
    const teamPart = effectOf(d).idleRate - station;
    expect(offlineEarn(d, 3600, 1).earned).toBeCloseTo((station + teamPart * 0.5) * 3600, 6);
    // 相对"在家离线" → 85%
    const homeOfflineTeam = (effectOf(home).idleRate - stationIdleScaled(home)) * 0.5 * 3600;
    const awayOfflineTeam = teamPart * 0.5 * 3600;
    expect(awayOfflineTeam / homeOfflineTeam).toBeCloseTo(0.85, 3);
  });
});

describe("X2. share 已改为「未放大工位」基数（P2-2 复验）", () => {
  it("X2 挂机天赋只放大工位，不再放大同事 share", () => {
    const base = withColleagues(withLevels(rich(), { retire: 10 }), COLLEAGUES.map((c) => c.id), 5);
    const t = withTalents(base, ["idle_1"]); // 工位 +6%
    const raw0 = stationIdleOf(base); // 无转生/图鉴 → rawStation = stationIdleOf
    const share0 = raw0 * teamShareRatio(base);
    const share1 = raw0 * teamShareRatio(t);
    console.log("[X2] share(无天赋)=", share0.toFixed(1), " share(有 idle_1)=", share1.toFixed(1), " 比值=", (share1 / share0).toFixed(4));
    expect(share1 / share0).toBeCloseTo(1, 10); // 不再被 idleMult 放大
    expect(stationIdleScaled(t) / stationIdleScaled(base)).toBeCloseTo(1.04, 6); // 工位本身仍吃天赋（idle_1 最终值 +4%）
    // effectOf 拆解：teamShare 用 rawStation
    const idle = effectOf(t).idleRate;
    const fixed = teamFixedRate(t) * 1 * favorBonuses(t).idleMult * 1;
    expect(idle).toBeCloseTo(stationIdleScaled(t) + fixed + share1, 6);
  });
});

describe("X3. 好感里程碑（P2-1 复验）", () => {
  it("X3a 20 档不再加派遣奖励；60 档丢梗 +10%；80 档每同事 +2% 封顶 +10%", () => {
    const base = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou"], 1);
    const f19 = { ...base, team: { colleagues: { zhou: { ...base.team.colleagues["zhou"]!, favor: 19 } } } };
    const f20 = { ...base, team: { colleagues: { zhou: { ...base.team.colleagues["zhou"]!, favor: 20 } } } };
    expect(favorBonuses(f20).dispatchMult).toBe(1);
    const d19 = dispatch(f19, "zhou", "quick", 0, 1000)!;
    const d20 = dispatch(f20, "zhou", "quick", 0, 1000)!;
    expect(d20.team.colleagues["zhou"]!.rewardSnapshot).toBe(d19.team.colleagues["zhou"]!.rewardSnapshot);

    const f60 = { ...base, team: { colleagues: { zhou: { ...base.team.colleagues["zhou"]!, favor: 60 } } } };
    expect(favorBonuses(f60).memeMult).toBeCloseTo(1.1, 6);
    expect(favorTier(f60)).toBe(3);

    // 单同事 80：固定挂机 +2%
    const f80 = { ...base, team: { colleagues: { zhou: { ...base.team.colleagues["zhou"]!, favor: 80 } } } };
    const rawStation = stationIdleOf(f80);
    const share = rawStation * teamShareRatio(f80) * 1;
    const fixedPart = effectOf(f80).idleRate - stationIdleScaled(f80) - share;
    console.log("[X3a] 单同事好感80固定部分=", fixedPart, "(原始 20 → 期望 20.4)");
    expect(fixedPart).toBeCloseTo(20.4, 6);
    // 5 人全 80：+10%
    const all5 = withColleagues(withLevels(rich(), { retire: 10 }), COLLEAGUES.map((c) => c.id), 5);
    const all80 = {
      ...all5,
      team: {
        colleagues: Object.fromEntries(
          Object.entries(all5.team.colleagues).map(([k, v]) => [k, { ...v, favor: 80 }]),
        ),
      },
    };
    expect(favorBonuses(all80).idleMult).toBeCloseTo(1.1, 6);
    const fixed80 = teamFixedRate(all80) * favorBonuses(all80).idleMult;
    const fixedNone = teamFixedRate(all5);
    expect(fixed80 / fixedNone).toBeCloseTo(1.1, 6);
  });

  it("X3b 20 档预警 +1s 已接入 main（favorTier>=1 → warnSec +1）", () => {
    const main = readFileSync("src/main.ts", "utf8");
    expect(main).toContain("patrolWarnSeconds + (favorTier(state) >= 1 ? 1 : 0)");
    console.log("[X3b] main 巡逻预警 = talent.patrolWarnSeconds + (favor>=20 ? 1s : 0)");
  });
});

describe("X4. 派遣公式（含同事贡献 ×2）与净收益展示", () => {
  it("X4a 奖励基数为 (工位 + 2×同事贡献) × 秒数 × 0.011", () => {
    const s = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou"], 5);
    const st = stationIdleScaled(s);
    const d = dispatch(s, "zhou", "quick", 0, st)!;
    const def = COLLEAGUES.find((c) => c.id === "zhou")!;
    const m = MISSIONS.find((x) => x.id === "quick")!;
    const colIdle = def.idlePerLevel * 5 + st * def.sharePerLevel * 5;
    const base = Math.max(DISPATCH_FLOOR, (st + colIdle * 2) * m.seconds * DISPATCH_COEF);
    const expected = Math.floor(base * m.mult * 1 * 1.5 * 1 * 1); // lv5 等级系数 1.5
    console.log("[X4a] snapshot=", d.team.colleagues["zhou"]!.rewardSnapshot, " expected=", expected);
    expect(d.team.colleagues["zhou"]!.rewardSnapshot).toBe(expected);
  });

  it("X4b 净收益预览=毛收益/h−该同事本人离岗损失（与实派后一致，误差<2%）", () => {
    const s = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou"], 5);
    const st = stationIdleScaled(s);
    const m = MISSIONS.find((x) => x.id === "quick")!;
    const snapshot = dispatch(s, "zhou", "quick", 0, st)!.team.colleagues["zhou"]!.rewardSnapshot;
    const perHour = snapshot / (m.seconds / 3600);
    // 面板公式（team-panel.ts:319）
    const def = COLLEAGUES.find((c) => c.id === "zhou")!;
    const cur = s.team.colleagues["zhou"]!;
    const mult = 1; // prestige 0
    const colIdlePerSec = (def.idlePerLevel * cur.level * mult + st * def.sharePerLevel * cur.level) * 0.15;
    const netPreview = perHour - colIdlePerSec * 3600;
    // 实派后真实净收益
    const d = dispatch(s, "zhou", "quick", Date.now(), st)!;
    const lossActual = Math.max(0, idleIfHome(s) - effectOf(d).idleRate) * 3600;
    const netActual = perHour - lossActual;
    console.log("[X4b] 预览净=", Math.round(netPreview), "/h 实际净=", Math.round(netActual), "/h 偏差=", (Math.abs(netPreview - netActual) / netActual * 100).toFixed(2), "%");
    expect(Math.abs(netPreview - netActual) / netActual).toBeLessThan(0.02);
  });

});

describe("X5. 自动排班 autoRepeat / 领取快照", () => {
  it("X5a autoRepeat 领取后自动续班（快照重算、好感累加）", () => {
    const s = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou"], 1);
    const st = stationIdleScaled(s);
    let cur = dispatch(s, "zhou", "quick", 0, st)!.team.colleagues["zhou"]!;
    const withAuto = setAutoRepeat({ ...s, team: { colleagues: { zhou: cur } } }, "zhou", true)!;
    const r = claimMission(withAuto, "zhou", cur.endsAt, st)!;
    const next = r.state.team.colleagues["zhou"]!;
    expect(next.missionId).toBe("quick");
    expect(next.endsAt).toBe(cur.endsAt + missionSecondsFor("zhou", "quick") * 1000);
    expect(next.favor).toBe(2);
    expect(claimMission(r.state, "zhou", cur.endsAt, st)).toBeNull();
  });

  it("X5b 领取=派单快照；一键=各单快照和", () => {
    const s = withColleagues(withLevels(rich(), { retire: 10 }), ["zhou", "mei"], 1);
    const st0 = stationIdleScaled(s);
    let d = dispatch(s, "zhou", "quick", 0, st0)!;
    d = dispatch(d, "mei", "chat", 0, st0)!;
    const ends = Math.max(...Object.values(d.team.colleagues).map((c) => c.endsAt));
    const grown = withLevels(d, { retire: 20 });
    const stNow = stationIdleScaled(grown);
    const snapSum = Object.values(grown.team.colleagues).reduce((a, c) => a + c.rewardSnapshot, 0);
    expect(claimableTotal(grown, ends, stNow)).toBe(snapSum);
    const c1 = claimMission(grown, "zhou", ends, stNow)!;
    const c2 = claimMission(c1.state, "mei", ends, stNow)!;
    expect(c1.reward + c2.reward).toBe(snapSum);
  });
});

describe("X6. 文档与代码一致性（附录 v2 数值）", () => {
  it("X6 文档附录与代码一致性：上限 24 / 溢出 / event_5b +10s 已同步", () => {
    const doc = readFileSync("docs/spec-batch1.md", "utf8");
    expect(doc).toContain("v2 实际生效数值");
    for (const v of ["12,000", "500,000", "8,000,000", "60,000,000", "400,000,000"]) expect(doc).toContain(v);
    expect(doc).toContain("AWAY_IDLE_FACTOR = 0.85");
    expect(doc).toContain("上限 24");
    expect(doc).toContain("溢出转化");
    expect(doc).toContain("每次安然额外 10 秒挂机收益");
    expect(doc).toContain("idle 5a「挂机+20%」vs 5b「同事挂机+70%」");
    // idle 线性最终值 +4%，与附录一致
    const talents = readFileSync("src/engine/talents.ts", "utf8");
    expect(talents).toContain('{ id: "idle_1", branch: "idle", tier: 1, name: "稳", desc: "挂机收益 +4%", value: 0.04 }');
    expect(doc).toContain("idle 线性 t1/t3 各 +4%");
    console.log("[X6] 文档附录与代码一致（上限 24/溢出/+10s/idle 终极/idle 线性 4%）✓");
  });


});


describe("X7. P1-1 复验：主循环不再强刷面板", () => {
  it("X7 150ms HUD 循环末尾改为 teamPanel.refresh()；refreshNow 仅保留 8 处 action 回调", () => {
    const main = readFileSync("src/main.ts", "utf8");
    const hudIdx = main.indexOf("hud.refresh(state, combo);");
    expect(hudIdx).toBeGreaterThan(0);
    const seg = main.slice(hudIdx, hudIdx + 300);
    console.log("[X7] HUD 循环末尾片段:", seg.replace(/\n/g, " | ").slice(0, 160));
    expect(seg).toContain("teamPanel.refresh(state);");
    expect(seg).not.toContain("teamPanel.refreshNow(state);");
    expect((main.match(/teamPanel\.refreshNow\(state\);/g) ?? []).length).toBe(8);
  });
});
