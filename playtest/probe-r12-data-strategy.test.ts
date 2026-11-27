import { describe, it } from "vitest";
import { simulate, pct, fmt, secs } from "./probe-r12-data-lib";
import { COLLEAGUES } from "../src/engine/team";

const VISITS = [9, 13, 20];

interface Row {
  name: string;
  total: number;
  delta: number;
  dispatch: number;
  dispatchShare: number;
  teamIdleShare: number;
  recruits: string;
  endIdle: number;
}

function runTeam(name: string, days: number, cps: number, opts: Parameters<typeof simulate>[0], base?: number): Row {
  const r = simulate(opts);
  const t = r.totals;
  const idleShare = (t.idle) / Math.max(1, t.lifetime);
  return {
    name,
    total: t.lifetime,
    delta: base ? t.lifetime / base - 1 : 0,
    dispatch: t.dispatch,
    dispatchShare: t.dispatch / Math.max(1, t.lifetime),
    teamIdleShare: r.final.teamIdle / Math.max(1e-9, r.final.idleRate),
    recruits: r.log.recruits.map((id) => id.slice(0, 2)).join(",") || "-",
    endIdle: r.final.idleRate,
  };
}

describe("R12-5 小队策略 A/B（投入产出）", () => {
  it("① 7 天 / 30 天：不招 / 招老周 / 招前二 / 全招（攒钱买）", () => {
    for (const days of [7, 30]) {
      for (const cps of [0, 1, 3]) {
        const baseOpts = { days, visitHours: VISITS, sessionSeconds: 600, cps, team: "none" as const };
        const base = simulate(baseOpts).totals.lifetime;
        const cfgs: [string, Parameters<typeof simulate>[0]][] = [
          ["不招", baseOpts],
          ["只招老周", { ...baseOpts, team: "smart", recruitLimit: 1 }],
          ["招前二", { ...baseOpts, team: "smart", recruitLimit: 2 }],
          ["全招5个", { ...baseOpts, team: "smart" }],
          ["全招(贪心不攒钱)", { ...baseOpts, team: "full" }],
        ];
        const rows = cfgs.map(([n, o]) => runTeam(n, days, cps, o, base));
        console.log(`\n### ${days} 天 · cps=${cps}`);
        for (const r of rows) {
          console.log(
            `${r.name.padEnd(8)}: 总入=${fmt(r.total)} 相对不招 ${r.delta >= 0 ? "+" : ""}${pct(r.delta)}｜派遣=${fmt(r.dispatch)}（占 ${pct(r.dispatchShare)}）｜同事占挂机=${pct(r.teamIdleShare)}｜期末挂机=${fmt(r.endIdle)}/s｜招募=[${r.recruits}]`,
          );
        }
      }
    }
  });

  it("② 攒钱阈值敏感性（为买同事停买升级的机会成本）", () => {
    const days = 7;
    const cps = 1;
    const base = simulate({ days, visitHours: VISITS, sessionSeconds: 600, cps, team: "none" }).totals.lifetime;
    for (const ratio of [0.3, 0.5, 0.7, 0.9]) {
      const r = simulate({ days, visitHours: VISITS, sessionSeconds: 600, cps, team: "smart", teamSaveRatio: ratio });
      console.log(
        `攒钱阈值 ${ratio}: 总入=${fmt(r.totals.lifetime)}（${pct(r.totals.lifetime / base - 1)}）招募=[${r.log.recruits.join(",")}] 派遣占比=${pct(r.totals.dispatch / r.totals.lifetime)}`,
      );
    }
  });

  it("③ 全招5个时 每个同事的招募日与投入产出", () => {
    const r = simulate({ days: 30, visitHours: VISITS, sessionSeconds: 600, cps: 1, team: "smart" });
    for (const def of COLLEAGUES) {
      const a = r.firstAfford[def.id]!;
      console.log(`${def.name}: 累计收入首次达 ${fmt(def.cost)} 在 D${a.atDay + 1}`);
    }
    console.log(`招募顺序=${r.log.recruits.join(" → ")}，升级次数=${r.log.upgrades.length}，派遣=${r.log.dispatches} 次，领取=${r.log.claims} 次`);
  });
});

describe("R12-5b 投入产出归因（30 天，cps=1）", () => {
  it("同事挂机 vs 派遣 各贡献多少", () => {
    const days = 30;
    const cps = 1;
    const common = { days, visitHours: VISITS, sessionSeconds: 600, cps };
    const none = simulate({ ...common, team: "none" }).totals.lifetime;
    for (const mode of ["smart", "full"] as const) {
      const noDispatch = simulate({ ...common, team: mode, dispatchEnabled: false }).totals.lifetime;
      const full = simulate({ ...common, team: mode }).totals.lifetime;
      console.log(
        `${mode}: 不招=${fmt(none)}｜招人但不派遣=${fmt(noDispatch)}（${pct(noDispatch / none - 1)}）｜招人+派遣=${fmt(full)}（总 ${pct(full / none - 1)}）→ 派遣边际贡献 ${pct(full / noDispatch - 1)}`,
      );
    }
  });

  it("面板账本污染量级（30 天 smart 跑完后的真实状态）", async () => {
    const { computeStats, investedOf } = await import("../src/engine/stats");
    const { MAX_COLLEAGUE_LEVEL, upgradeCostOf } = await import("../src/engine/team");
    const r = simulate({ days: 30, visitHours: VISITS, sessionSeconds: 600, cps: 1, team: "smart" });
    const st = computeStats(r.state);
    let teamSpent = 0;
    for (const def of COLLEAGUES) {
      const cur = r.state.team.colleagues[def.id];
      if (!cur) continue;
      teamSpent += def.cost;
      for (let lv = 1; lv < cur.level; lv++) teamSpent += upgradeCostOf(def, lv);
    }
    console.log(`\n面板「累计投入」=${fmt(st.invested)}｜同事实际花费=${fmt(teamSpent)}（面板漏报 ${pct(teamSpent / st.invested)}）`);
    console.log(`面板「生涯」=${fmt(st.lifetime)}｜「本局」=${fmt(st.run)}｜「往期」=${fmt(st.previous)}（从未转生，往期应为 0）`);
    console.log(`= lifetime - run = ${fmt(st.lifetime - st.run)} ≈ 同事花费 ${fmt(teamSpent)}（本局被扣、往期虚增）`);
  });
});
