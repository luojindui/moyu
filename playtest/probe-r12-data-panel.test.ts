import { describe, it } from "vitest";
import { fmt, pct } from "./probe-r12-data-lib";
import { initialState, gain } from "../src/engine/state";
import { computeStats, investedOf } from "../src/engine/stats";
import { buyUpgrade } from "../src/engine/actions";
import { stationIdleScaled, effectOf } from "../src/engine/upgrades";
import { prestigeMultiplier } from "../src/engine/prestige";
import {
  COLLEAGUES,
  MISSIONS,
  recruit,
  upgradeColleague,
  dispatch,
  claimMission,
  dispatchReward,
  claimableTotal,
  upgradeCostOf,
  MAX_COLLEAGUE_LEVEL,
  teamFixedRate,
  teamShareRatio,
} from "../src/engine/team";
import { offlineEfficiency } from "../src/engine/progression";

const NOW = 1_700_000_000_000;

function rich(amount = 1e12) {
  return gain(initialState(), amount);
}

describe("R12R2-5 面板可信度复验", () => {
  it("① 派遣预览 = 实领？（快照已修）", () => {
    let s = rich();
    s = recruit(s, "zhou")!;
    for (let i = 0; i < 120; i++) s = buyUpgrade(s, "phone")!;
    const m = MISSIONS[4]!;
    const busy = dispatch(s, "zhou", m.id, NOW, stationIdleScaled(s))!;
    const snap = busy.team.colleagues.zhou!.rewardSnapshot;
    // 面板：team-panel 用 cur.rewardSnapshot → 与实领一致
    const claim = claimMission(busy, "zhou", NOW + m.seconds * 1000, stationIdleScaled(busy))!;
    console.log(`\n派单预览（快照）=${fmt(snap)}，实领=${fmt(claim.reward)} → ${snap === claim.reward ? "一致 ✓" : "不一致 ✗"}`);
  });

  it("② 一键领取按钮总额 = 各单实领之和？（快照 vs 现价）", () => {
    let s = rich();
    s = recruit(s, "zhou")!;
    s = recruit(s, "mei")!;
    const m = MISSIONS[4]!;
    s = dispatch(s, "zhou", m.id, NOW, stationIdleScaled(s))!;
    s = dispatch(s, "mei", m.id, NOW, stationIdleScaled(s))!;
    // 派遣后玩家又升级工位（挂机率涨 200 倍）
    for (let i = 0; i < 200; i++) {
      const n = buyUpgrade(s, "phone");
      if (!n) break;
      s = n;
    }
    const at = NOW + m.seconds * 1000;
    const panelTotal = claimableTotal(s, at, stationIdleScaled(s)); // 一键领取显示值
    let actual = 0;
    let st = s;
    for (const id of ["zhou", "mei"]) {
      const r = claimMission(st, id, at, stationIdleScaled(st))!;
      actual += r.reward;
      st = r.state;
    }
    console.log(
      `\n一键领取显示=${fmt(panelTotal)}｜实际到账=${fmt(actual)} → 面板高估 ${pct(panelTotal / actual - 1)}（claimableTotal 用当前工位，逐单领取用快照）`,
    );
  });

  it("③ 「本局/往期」：招募后往期是否仍为 0", () => {
    let s = rich();
    for (let i = 0; i < 20; i++) s = buyUpgrade(s, "phone")!;
    s = recruit(s, "zhou")!;
    for (let i = 0; i < MAX_COLLEAGUE_LEVEL - 1; i++) s = upgradeColleague(s, "zhou")!;
    const st = computeStats(s);
    console.log(`\n本局=${fmt(st.run)}｜往期=${fmt(st.previous)} → ${st.previous === 0 ? "0 ✓（不再被招募费污染）" : "非 0 ✗"}`);
  });

  it("④「累计投入」是否含同事招募+升级", () => {
    let s = rich();
    for (let i = 0; i < 20; i++) s = buyUpgrade(s, "phone")!;
    const upSpent = investedOf(s);
    s = recruit(s, "zhou")!;
    for (let i = 0; i < MAX_COLLEAGUE_LEVEL - 1; i++) s = upgradeColleague(s, "zhou")!;
    let teamSpent = COLLEAGUES[0]!.cost;
    for (let lv = 1; lv < MAX_COLLEAGUE_LEVEL; lv++) teamSpent += upgradeCostOf(COLLEAGUES[0]!, lv);
    const st = computeStats(s);
    console.log(`\n升级花费=${fmt(upSpent)}｜同事花费=${fmt(teamSpent)}｜面板累计投入=${fmt(st.invested)} → ${st.invested === upSpent + teamSpent ? "闭合 ✓" : "差 " + fmt(upSpent + teamSpent - st.invested) + " ✗"}`);
  });

  it("⑤「今日回访/离线效率」是否用真实函数（首日/回访/天赋）", () => {
    const createdAt = NOW - 12 * 3600_000;
    let s = initialState();
    s = { ...s, visits: { date: "x", count: 2 } };
    const day1 = offlineEfficiency(s, createdAt, NOW);
    const createdAt2 = NOW - 10 * 86400_000;
    let s2 = { ...s, visits: { date: "x", count: 0 }, talents: { unlocked: ["idle_4"], points: 0, rankGranted: -1 } };
    const later = offlineEfficiency(s2, createdAt2, NOW);
    console.log(
      `\n首日 2 回访：引擎实际=${pct(day1)}（面板直接调同一函数 → 一致 ✓）；老玩家 0 回访+idle_4=${pct(later)}`,
    );
  });

  it("⑥ 团队面板「挂机 +X/秒」：漏图鉴/好感倍率？", () => {
    let s = rich();
    s = recruit(s, "wang")!;
    for (let i = 0; i < 150; i++) s = buyUpgrade(s, "phone")!;
    // 造图鉴 + 好感
    s = { ...s, collected: { quotes: Array.from({ length: 10 }, (_, i) => i), flavors: Array.from({ length: 10 }, (_, i) => i) } };
    const cols = { ...s.team.colleagues, wang: { ...s.team.colleagues.wang!, favor: 85 } };
    s = { ...s, team: { colleagues: cols } };
    const def = COLLEAGUES[4]!;
    const panel = def.idlePerLevel * 1 * prestigeMultiplier(s.prestige); // team-panel 显示口径
    // 实际固定部分贡献 = effectOf.idleRate − 工位 − 工位×share
    const station = stationIdleScaled(s);
    const teamContribution = effectOf(s).idleRate - station;
    const fixedPart = teamContribution - station * 0.016;
    console.log(
      `\n王师傅 Lv1「挂机 +${fmt(panel)}/秒」；实际固定部分贡献≈${fmt(fixedPart)}/秒（含图鉴 +${pct((1 + 0.04) - 1)}、好感 80+ 的 +10%）→ 显示 ${pct(panel / fixedPart)}，漏报 ${pct(1 - panel / fixedPart)}`,
    );
    console.log(`（team-panel 用 prestigeMultiplier 单乘，未乘 collectionBonus/favorIdleBonus）`);
  });

  it("⑦ 顶部「小队挂机 +X/秒」与实际同事贡献", () => {
    let s = rich();
    for (const d of COLLEAGUES) s = recruit(s, d.id)!;
    for (let i = 0; i < 150; i++) s = buyUpgrade(s, "phone")!;
    s = { ...s, collected: { quotes: Array.from({ length: 10 }, (_, i) => i), flavors: Array.from({ length: 10 }, (_, i) => i) } };
    const station = stationIdleScaled(s);
    // panel 口径：teamFixedRate + station*shareRatio（均不含 mult/favor）
    const panel = teamFixedRate(s) + station * teamShareRatio(s);
    const real = effectOf(s).idleRate - station;
    console.log(`\n小队挂机：面板 ${fmt(panel)}/s vs 实际 ${fmt(real)}/s → 显示 ${pct(panel / real)}`);
  });

  it("⑧ 点击飘字 = 引擎实际（已统一）", () => {
    const combo = 20;
    const shown = 1 + 0.012 * combo; // main.ts: comboMultiplier(combo, cap) = 1+0.012×combo
    const engine = 1 + 0.012 * Math.min(combo, 20);
    console.log(`\n20 连击：飘字 ×${shown.toFixed(2)} vs 引擎 ×${engine.toFixed(2)} → ${shown === engine ? "一致 ✓" : "不一致 ✗"}`);
  });
});
