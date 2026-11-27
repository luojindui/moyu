import { describe, it } from "vitest";
import { DRAFT_TEAM, NO_TALENT, simulate, type SimOpts, type TeamCfg } from "./probe-b1-lib";

const base = (over: Partial<SimOpts>): SimOpts => ({
  days: 7, visitHours: [9, 13, 20], sessionSeconds: 600, cps: 0,
  recruit: true, dispatch: true, levelColleagues: true,
  team: DRAFT_TEAM, talent: NO_TALENT, prestige: false, dailyClaim: true, events: true,
  ...over,
});
const pct = (x: number) => (x * 100).toFixed(1) + "%";
const e8 = (x: number) => (x / 1e8).toFixed(0);

function cmp(label: string, team: TeamCfg, levelColleagues = true) {
  const none = simulate(base({ recruit: false, dispatch: false, levelColleagues: false, team }));
  const nd = simulate(base({ team, levelColleagues, recruit: true, dispatch: false }));
  const dp = simulate(base({ team, levelColleagues, recruit: true, dispatch: true }));
  console.log(
    `${label}: 无小队=${e8(none.totals.total)} | 招募不派遣=${pct(nd.totals.total / none.totals.total - 1)} | 招募+派遣=${pct(dp.totals.total / none.totals.total - 1)} (派遣占比 ${pct(dp.totals.dispatch / dp.totals.total)}, 同事idle占比 ${pct(dp.final.teamIdle / dp.final.idleRate)})`,
  );
}

describe("B1 诊断", () => {
  it("不同成本结构 / 等级策略下 7 天净收益", () => {
    cmp("基线（lv50经济? no, lv10）", DRAFT_TEAM);
    cmp("基线-不升同事", DRAFT_TEAM, false);
    cmp("升级系数0.2", { ...DRAFT_TEAM, colleagues: DRAFT_TEAM.colleagues.map((c) => ({ ...c, upgradeCoef: 0.2 })) });
    cmp("升级系数0.2-不升同事", { ...DRAFT_TEAM, colleagues: DRAFT_TEAM.colleagues.map((c) => ({ ...c, upgradeCoef: 0.2 })) }, false);
    cmp("派遣系数0.02", { ...DRAFT_TEAM, dispatchCoef: 0.02 });
    cmp("派遣系数0.02-不升同事", { ...DRAFT_TEAM, dispatchCoef: 0.02 }, false);
    cmp("招募价×0.3", { ...DRAFT_TEAM, colleagues: DRAFT_TEAM.colleagues.map((c) => ({ ...c, cost: Math.round(c.cost * 0.3) })) });
    cmp("招募价×0.3-不升同事", { ...DRAFT_TEAM, colleagues: DRAFT_TEAM.colleagues.map((c) => ({ ...c, cost: Math.round(c.cost * 0.3) })) }, false);
    cmp("share1%/lv", { ...DRAFT_TEAM, colleagues: DRAFT_TEAM.colleagues.map((c) => ({ ...c, sharePerLevel: 0.01 })) });
    cmp("share1%/lv-不升同事", { ...DRAFT_TEAM, colleagues: DRAFT_TEAM.colleagues.map((c) => ({ ...c, sharePerLevel: 0.01 })) }, false);
    cmp("派遣0.02+升级0.2", { ...DRAFT_TEAM, dispatchCoef: 0.02, colleagues: DRAFT_TEAM.colleagues.map((c) => ({ ...c, upgradeCoef: 0.2 })) });
    cmp("派遣0.02+升级0.2-不升同事", { ...DRAFT_TEAM, dispatchCoef: 0.02, colleagues: DRAFT_TEAM.colleagues.map((c) => ({ ...c, upgradeCoef: 0.2 })) }, false);
  });
});
