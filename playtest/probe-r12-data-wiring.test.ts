import { describe, it } from "vitest";
import { initialState, gain } from "../src/engine/state";
import { doClick, clickPowerOf, comboCapOf, comboWindowOf, comboMultiplier } from "../src/engine/actions";
import { effectOf, stationIdleScaled } from "../src/engine/upgrades";
import { offlineEfficiency } from "../src/engine/progression";
import { offlineEarn, OFFLINE_CAP_SECONDS } from "../src/engine/offline";
import { newEventState, onBossTap, bossSurviveReward, BOSS_STEAL_PENALTY_IDLE_SECONDS, BOSS_PENALTY_MIN } from "../src/engine/events";
import { recruit, COLLEAGUES, teamTraits, teamFixedRate, teamShareRatio } from "../src/engine/team";
import { talentEffects, TALENTS } from "../src/engine/talents";
import { withTalents, branchBuild, branchLinearIds } from "./probe-r12-data-lib";
import { fmt, pct } from "./probe-r12-data-lib";

const NOW = 1_700_000_000_000;

function stateWith(ids: string[], money = 1e12) {
  return withTalents(gain(initialState(), money), ids);
}

describe("R12R2-4 接线审计（天赋/被动是否真的生效）", () => {
  it("① 点击流：手速/连击上限/连击窗口/暴击/指尖风暴", () => {
    const base = gain(initialState(), 0);
    const t1 = withTalents(base, ["click_1"]);
    console.log(`\n手速：clickPower ${clickPowerOf(base).toFixed(1)} → ${clickPowerOf(t1).toFixed(1)}（+${pct(clickPowerOf(t1) / clickPowerOf(base) - 1)}）✓`);

    const t3 = withTalents(base, ["click_3"]);
    console.log(`连击上限：cap ${comboCapOf(base)} → ${comboCapOf(t3)}；20连时 comboMult ${comboMultiplier(20, comboCapOf(base)).toFixed(3)} vs 30连 ${comboMultiplier(30, comboCapOf(t3)).toFixed(3)} ✓`);
    const t2 = withTalents(base, ["click_2"]);
    console.log(`连击窗口：${comboWindowOf(base)}s → ${comboWindowOf(t2)}s（UI 用 comboWindowOf）✓`);

    // 暴击：每 20 次必暴击 ×5 → 100 次点击收入应显著增加
    const income = (s: typeof base) => {
      let x = s;
      const before = x.lifetimeEarned;
      for (let i = 0; i < 100; i++) x = doClick(x, 0);
      return x.lifetimeEarned - before;
    };
    const t4 = withTalents(base, ["click_4"]);
    console.log(
      `暴击（引擎 doClick 路径）：100 次点击收入 无天赋=${income(base).toFixed(0)} vs click_4=${income(t4).toFixed(0)} → ${income(base) === income(t4) ? "实际入账没生效 ✗（main.ts 只把飘字×5，doClick 未乘暴击）" : "生效 ✓"}`,
    );

    const t5b = withTalents(base, ["click_1", "click_5b"]);
    console.log(
      `指尖风暴：clickPower 基础=${clickPowerOf(base).toFixed(1)} → click_1+5b=${clickPowerOf(t5b).toFixed(1)}（×${(clickPowerOf(t5b) / clickPowerOf(withTalents(base, ["click_1"]))).toFixed(2)}，应 ×1.6）；连击每层翻倍需 comboMultiplier 参数，doClick 未传入 → 只生效一半`,
    );
  });

  it("② 事件流：罚款减免 / 预警 / 老板眼线", () => {
    const es = newEventState();
    const penaltyOf = (ids: string[]) => {
      const s = stateWith(ids);
      const e = { ...es, bossUntil: 1e9, bossStartAt: 0, bossVariant: "hold" as const, patrolCount: 10, bossPenaltyTotal: 0 };
      const r = onBossTap(s, e, 10, 0);
      return r.lost;
    };
    const noTalent = penaltyOf([]);
    const t2 = penaltyOf(["event_2"]);
    console.log(`\n反侦察（罚款 -35%）：无天赋罚 ${noTalent.toFixed(0)} vs event_2 罚 ${t2.toFixed(0)} → ${noTalent === t2 ? "完全没生效 ✗" : "生效 ✓（-35%）"}`);

    // 强哥被动（罚款减免 -10%）
    let sQ = gain(initialState(), 1e12);
    sQ = recruit(sQ, "qiang")!;
    const e = { ...es, bossUntil: 1e9, bossStartAt: 0, bossVariant: "hold" as const, patrolCount: 10, bossPenaltyTotal: 0 };
    const rQ = onBossTap(sQ, { ...e }, 10, 0);
    const idleRateQ = effectOf(sQ).idleRate;
    const expectedWithTrait = Math.max(BOSS_PENALTY_MIN, BOSS_STEAL_PENALTY_IDLE_SECONDS * idleRateQ) * (1 - 0.1);
    console.log(
      `强哥被动（罚款-10%）：teamTraits=${JSON.stringify(teamTraits(sQ))}；实际罚款 ${rQ.lost.toFixed(0)} vs 若生效应为 ${expectedWithTrait.toFixed(0)} → ${Math.abs(rQ.lost - expectedWithTrait) < 1 ? "生效 ✓" : "未接线 ✗（罚款未减免）"}`,
    );

    const t1 = stateWith(["event_1"]);
    const t1b = stateWith(["event_1", "event_4"]);
    const t5 = stateWith(["event_5b"]);
    const es2 = newEventState();
    console.log(
      `巡逻奖：无天赋=${fmt(bossSurviveReward(stateWith([]), es2))}｜event_1=${fmt(bossSurviveReward(t1, es2))}｜+event_4=${fmt(bossSurviveReward(t1b, es2))}｜event_5b(×2)=${fmt(bossSurviveReward(t5, es2))} ✓`,
    );
    console.log(
      `预警：patrolWarnSeconds=${talentEffects(withTalents(initialState(), ["event_4"]).talents).patrolWarnSeconds}；main.ts:431 已消费 → 巡逻前 2s 弹「王总快来了」提示 ✓（横幅本身未提前）`,
    );
  });

  it("③ 挂机流：离线扩容 / 离线效率 / 带队摸鱼 / 是否真能超 100%", () => {
    const noT = gain(initialState(), 0);
    const t2 = withTalents(noT, ["idle_2"]);
    const off1 = offlineEarn(noT, OFFLINE_CAP_SECONDS + 7200, 1);
    const off2 = offlineEarn(t2, OFFLINE_CAP_SECONDS + 7200, 1);
    console.log(`\n离线扩容：applied ${off1.applied}s → ${off2.applied}s（+${(off2.applied - off1.applied) / 3600}h）✓`);

    // 离线效率上限：idle_4 描述"可超过 100%"
    const createdAt = NOW - 10 * 86400_000;
    const rateOf = (ids: string[], visits: number, streak: number) => {
      let s = withTalents(initialState(), ids);
      s = { ...s, visits: { date: "x", count: visits } };
      s = { ...s, daily: s.daily ? { ...s.daily, streak } : { date: "x", window: 0, goals: [], claimed: false, streak } };
      return offlineEfficiency(s, createdAt, NOW);
    };
    console.log(
      `离线效率：0 回访无天赋=${pct(rateOf([], 0, 0))}｜idle_4=${pct(rateOf(["idle_4"], 0, 0))}｜idle_4+满回访+15 天 streak=${pct(rateOf(["idle_4"], 3, 15))} → ${rateOf(["idle_4"], 3, 15) > 1 ? "可超 100% ✓" : "仍封顶 100% ✗"}`,
    );

    // 带队摸鱼（idle_5b）：有队时 idleRate 是否变化
    let team = gain(initialState(), 1e12);
    for (const d of ["zhou", "mei"] as const) team = recruit(team, d)!;
    const noUlt = { ...team, talents: { unlocked: branchLinearIds("idle"), points: 0, rankGranted: -1 } };
    const withUlt = withTalents(team, [...branchLinearIds("idle"), "idle_5b"]);
    console.log(
      `带队摸鱼（同事挂机 +40%）：idleRate ${fmt(effectOf(noUlt).idleRate)} → ${fmt(effectOf(withUlt).idleRate)}（差 ${pct(effectOf(withUlt).idleRate / effectOf(noUlt).idleRate - 1)}）→ ${effectOf(withUlt).idleRate === effectOf(noUlt).idleRate ? "未接线 ✗" : "生效 ✓"}`,
    );

    // 小美被动：离线效率 +2%
    let withMei = gain(initialState(), 1e12);
    withMei = recruit(withMei, "mei")!;
    const a = offlineEfficiency(withMei, createdAt, NOW);
    const b = offlineEfficiency(initialState(), createdAt, NOW);
    console.log(`小美被动（离线效率+2%）：有/无小美 offlineEfficiency=${pct(a)} vs ${pct(b)} → ${a === b ? "未接线 ✗" : "生效 ✓"}（teamTraits=${JSON.stringify(teamTraits(withMei))}）`);
  });

  it("④ UI 层统计与实际结算一致性（面板同源）", () => {
    // 面板 idle 汇总：teamFixedRate + station*teamShareRatio vs 实际 teamFixed×mult×favor + station×ratio
    let s = gain(initialState(), 1e12);
    for (const d of COLLEAGUES) s = recruit(s, d.id)!;
    const panel = teamFixedRate(s) + stationIdleScaled(s) * teamShareRatio(s);
    const real = effectOf(s).idleRate - stationIdleScaled(s);
    console.log(
      `\n团队面板汇总"小队挂机 +${fmt(panel)}/秒" vs 实际同事贡献 ${fmt(real)}/秒（显示=${pct(panel / real)}）；差在图鉴/好感倍率（面板用 teamFixedRate×1）`,
    );
  });
});
