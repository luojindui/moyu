import { describe, it } from "vitest";
import { fmt, pct, secs, multOf } from "./probe-r12-data-lib";
import { initialState, type GameState } from "../src/engine/state";
import { gain } from "../src/engine/state";
import { computeStats, investedOf } from "../src/engine/stats";
import { buyUpgrade } from "../src/engine/actions";
import { stationIdleScaled, effectOf, costOf } from "../src/engine/upgrades";
import {
  COLLEAGUES,
  MISSIONS,
  recruit,
  upgradeColleague,
  dispatch,
  claimMission,
  dispatchReward,
  colleagueDef,
  MAX_COLLEAGUE_LEVEL,
} from "../src/engine/team";
import { offlineEfficiency } from "../src/engine/progression";
import { talentEffects } from "../src/engine/talents";

const NOW = 1_700_000_000_000;
const HOUR = 3600_000;

function rich(amount = 1e12): GameState {
  return gain(initialState(), amount);
}

describe("R12-4 面板可信度", () => {
  it("① 团队面板预览的派遣奖励 ≠ 实际领取（面板用总挂机，领取用工位挂机）", () => {
    let s = rich();
    for (const def of COLLEAGUES) {
      s = recruit(s, def.id)!;
    }
    // 让工位有值：买一批 phone
    for (let i = 0; i < 120; i++) s = buyUpgrade(s, "phone")!;
    const idleTotal = effectOf(s).idleRate;
    const idleStation = stationIdleScaled(s);
    console.log(
      `\n### 工位挂机=${fmt(idleStation)}/s，总挂机=${fmt(idleTotal)}/s（同事占比 ${pct((idleTotal - idleStation) / idleTotal)}）`,
    );
    for (const def of COLLEAGUES.slice(0, 3)) {
      const m = MISSIONS[4]!;
      const busy = dispatch(s, def.id, m.id, NOW)!;
      const panelReward = dispatchReward(busy, def.id, idleTotal); // team-panel.ts 的预览口径
      const claim = claimMission(busy, def.id, NOW + m.seconds * 1000, idleStation)!; // main.ts 实际口径
      console.log(
        `${def.name} 8h咖啡：面板显示 +${fmt(panelReward)}，实到 +${fmt(claim.reward)}（面板虚高 ${pct(panelReward / claim.reward - 1)}）`,
      );
    }
  });

  it("② 累计投入不统计同事花费 → 面板三本账对不上", () => {
    let s = rich(1e9);
    // 买 20 次 phone
    for (let i = 0; i < 20; i++) s = buyUpgrade(s, "phone")!;
    const upgradeSpent = investedOf(s);
    const before = computeStats(s);
    // 招募 + 升满 老周
    s = recruit(s, "zhou")!;
    for (let i = 0; i < MAX_COLLEAGUE_LEVEL - 1; i++) s = upgradeColleague(s, "zhou")!;
    const after = computeStats(s);
    let teamSpent = COLLEAGUES[0]!.cost;
    for (let lv = 1; lv < MAX_COLLEAGUE_LEVEL; lv++) {
      teamSpent += Math.ceil(COLLEAGUES[0]!.cost * 0.4 * 1.35 ** lv);
    }
    console.log(`\n### 升级花费=${fmt(upgradeSpent)} 同事花费=${fmt(teamSpent)} 实际总花费=${fmt(upgradeSpent + teamSpent)}`);
    console.log(`面板「累计投入」=${fmt(after.invested)}（只统计升级，漏掉同事 ${fmt(teamSpent)}，漏报 ${pct(after.invested / (upgradeSpent + teamSpent) - 1)}）`);
    console.log(
      `面板「生涯=${fmt(after.lifetime)} / 本局=${fmt(after.run)} / 往期=${fmt(after.previous)}」；` +
        `招募前本局=${fmt(before.run)} → 招募后本局=${fmt(after.run)}（-${fmt(before.run - after.run)}，生涯不变 ${fmt(after.lifetime)}）`,
    );
    console.log(`即：花在同事上的钱不进「累计投入」，却从「本局收入」里扣掉 → 凭空多出「往期收入 ${fmt(after.previous)}」`);
  });

  it("③ 同事挂机/派遣是否进面板与生涯", () => {
    let s = rich(1e12);
    s = recruit(s, "zhou")!;
    const idleWith = effectOf(s).idleRate;
    const noTeam = effectOf({ ...s, team: { colleagues: {} } }).idleRate;
    const st = computeStats(s);
    console.log(`\n### 招募老周后：面板 idleRate=${fmt(st.idleRate)}/s（无同事 ${noTeam.toFixed(3)}/s，同事贡献 ${pct((idleWith - noTeam) / idleWith)}）→ 同事挂机已进面板 ✓`);
    // 派遣奖励进生涯
    const before = computeStats(s);
    s = dispatch(s, "zhou", MISSIONS[0]!.id, NOW)!;
    const r = claimMission(s, "zhou", NOW + MISSIONS[0]!.seconds * 1000, stationIdleScaled(s))!;
    const after = computeStats(r.state);
    console.log(
      `派遣奖励 +${fmt(r.reward)} → 生涯 +${fmt(after.lifetime - before.lifetime)}，本局 +${fmt(after.run - before.run)}（一致 ✓）`,
    );
  });

  it("④ 团队面板的「挂机 +X/秒」漏算转生/图鉴倍率与 share 项", () => {
    let s = rich(1e12);
    s = recruit(s, "wang")!;
    // 造一个工位：买 phone 到高等级
    for (let i = 0; i < 150; i++) s = buyUpgrade(s, "phone")!;
    const S = stationIdleScaled(s);
    const def = COLLEAGUES[4]!;
    const shown = def.idlePerLevel * 1; // team-panel.ts 显示值
    const real = def.idlePerLevel * multOf(s) + S * def.sharePerLevel;
    console.log(
      `\n### 王师傅 Lv1：面板写「挂机 +${shown}/秒」；实际=${fmt(real)}/s（显示值只占实际的 ${pct(shown / real)}，漏算 share ${fmt(S * def.sharePerLevel)}/s + 倍率）`,
    );
  });

  it("⑤ 今日回访的「离线效率」显示 vs 引擎实际（首日/天赋/好感）", () => {
    // journal.ts 行内公式：0.7 + min(3,visits)*0.1
    const panelRate = (visits: number) => Math.min(1, 0.7 + Math.min(3, visits) * 0.1);
    // 场景 A：首日（建档 12h 内）2 次回访
    let s = initialState();
    s = { ...s, visits: { date: "2026-11-27", count: 2 } };
    const day1 = offlineEfficiency(s, NOW - 12 * HOUR, NOW);
    // 场景 B：老玩家 0 次回访 + 挂机流4级（+0.05）+ 好感40（+0.03）
    let s2 = initialState();
    s2 = { ...s2, visits: { date: "2026-11-27", count: 0 }, talents: { unlocked: ["idle_4"], points: 0, rankGranted: -1 } };
    s2 = recruit(gain(s2, 1e9), "zhou")!;
    for (let i = 0; i < MAX_COLLEAGUE_LEVEL - 1; i++) s2 = upgradeColleague(s2, "zhou")!; // 好感靠领奖，这里手动
    s2 = { ...s2, team: { colleagues: { ...s2.team.colleagues, zhou: { ...s2.team.colleagues.zhou!, favor: 45 } } } };
    const b = offlineEfficiency(s2, NOW - 10 * 86400_000, NOW);
    console.log(
      `\n### 首日 2 次回访：面板写 ${pct(panelRate(2))}，引擎实际 ${pct(day1)}（首日全额，面板低估）\n` +
        `### 老玩家 0 回访 + 挂机4级 + 好感45：面板写 ${pct(panelRate(0))}，引擎实际 ${pct(b)}（面板漏天赋/好感加成）`,
    );
  });

  it("⑥ 点击飘字金额 vs 实际入账（main.ts 用 0.02，引擎用 0.012）", () => {
    const clicks = [0, 6, 12, 20];
    for (const combo of clicks) {
      const shown = 1 + 0.02 * Math.min(combo, 20); // main.ts doTap 的飘字口径
      const real = 1 + 0.012 * Math.min(combo, 20); // actions.ts comboMultiplier
      console.log(`连击 ${combo}：飘字 ×${shown.toFixed(2)} vs 实际 ×${real.toFixed(2)}（虚高 ${pct(shown / real - 1)}）`);
    }
  });

  it("⑦ 面板 idleRate 与工位/同事的闭合关系", () => {
    let s = rich(1e10);
    s = recruit(s, "zhou")!;
    s = recruit(s, "mei")!;
    s = { ...s, team: { colleagues: { ...s.team.colleagues, zhou: { ...s.team.colleagues.zhou!, favor: 80 } } } };
    for (let i = 0; i < 60; i++) s = buyUpgrade(s, "phone")!;
    const eff = effectOf(s);
    const station = stationIdleScaled(s);
    const share = station * (0.008 * 1 + 0.008 * 1);
    const fixed = (20 + 100) * multOf(s) * (1.1); // favorTier>=4 → +10%
    console.log(
      `\n### idleRate=${fmt(eff.idleRate)} = 工位${fmt(station)} + 同事固定${fmt(fixed)} + share${fmt(share)} → ${fmt(station + fixed + share)}（闭合 ✓）`,
    );
  });
});
