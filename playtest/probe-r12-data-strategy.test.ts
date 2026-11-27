import { describe, it } from "vitest";
import { simulate, pct, fmt } from "./probe-r12-data-lib";
import { COLLEAGUES } from "../src/engine/team";

const VISITS = [9, 13, 20];

function row(opts: Parameters<typeof simulate>[0], base: number) {
  const r = simulate(opts);
  const t = r.totals;
  return {
    total: t.lifetime,
    delta: t.lifetime / base - 1,
    dispatch: t.dispatch,
    dispatchShare: t.dispatch / Math.max(1, t.lifetime),
    teamIdleShare: r.final.teamIdle / Math.max(1e-9, r.final.idleRate),
    recruits: r.log.recruits.map((id) => id.slice(0, 2)).join(",") || "-",
    endIdle: r.final.idleRate,
    claims: r.log.claims,
  };
}

describe("R12R2-6 小队策略 A/B（50% 派遣代价后）", () => {
  it("① 7/30 天：不招 / 招前1/2/5 个（攒钱买）/ 全招（贪心）", () => {
    for (const days of [7, 30]) {
      for (const cps of [0, 1, 3]) {
        const base = simulate({ days, visitHours: VISITS, sessionSeconds: 600, cps, team: "none" }).totals.lifetime;
        const cfgs: [string, Parameters<typeof simulate>[0]][] = [
          ["不招", { days, visitHours: VISITS, sessionSeconds: 600, cps, team: "none" }],
          ["只招老周", { days, visitHours: VISITS, sessionSeconds: 600, cps, team: "smart", recruitLimit: 1 }],
          ["招前二", { days, visitHours: VISITS, sessionSeconds: 600, cps, team: "smart", recruitLimit: 2 }],
          ["全招5个", { days, visitHours: VISITS, sessionSeconds: 600, cps, team: "smart" }],
          ["全招(闲钱买)", { days, visitHours: VISITS, sessionSeconds: 600, cps, team: "full" }],
        ];
        console.log(`\n### ${days} 天 · cps=${cps}`);
        for (const [n, o] of cfgs) {
          const r = row(o, base);
          console.log(
            `${n.padEnd(10)}: 总入=${fmt(r.total)} ${r.delta >= 0 ? "+" : ""}${pct(r.delta)}｜派遣毛=${fmt(r.dispatch)}（占 ${pct(r.dispatchShare)}）｜同事占挂机=${pct(r.teamIdleShare)}｜招募=[${r.recruits}]｜领取 ${r.claims} 次`,
          );
        }
      }
    }
  });

  it("② 派遣的净贡献（开/关派遣，同事状态不变）", () => {
    const days = 30;
    for (const cps of [0, 1]) {
      const base = { days, visitHours: VISITS, sessionSeconds: 600, cps };
      const none = simulate({ ...base, team: "none" }).totals.lifetime;
      for (const mode of ["smart", "full"] as const) {
        const off = simulate({ ...base, team: mode, dispatchEnabled: false }).totals.lifetime;
        const on = simulate({ ...base, team: mode }).totals.lifetime;
        console.log(
          `\n${mode} cps=${cps}: 不招=${fmt(none)}｜招人不派遣=${fmt(off)}（${pct(off / none - 1)}）｜招人+派遣=${fmt(on)}（总 ${pct(on / none - 1)}）→ 派遣边际贡献 ${pct(on / off - 1)}`,
        );
      }
    }
  });

  it("③ 招募日与顺序（全招，cps=1）", () => {
    const r = simulate({ days: 30, visitHours: VISITS, sessionSeconds: 600, cps: 1, team: "smart" });
    for (const def of COLLEAGUES) {
      const a = r.firstAfford[def.id]!;
      console.log(`${def.name}: 累计收入首次达 ${fmt(def.cost)} 在 D${a.atDay + 1}`);
    }
    console.log(`招募顺序=${r.log.recruits.join(" → ")}｜升级 ${r.log.upgrades.length} 次｜派遣 ${r.log.dispatches} 次｜领取 ${r.log.claims} 次`);
  });

  it("④ 攒钱阈值敏感性（7 天 cps=1）", () => {
    const base = simulate({ days: 7, visitHours: VISITS, sessionSeconds: 600, cps: 1, team: "none" }).totals.lifetime;
    for (const ratio of [0.3, 0.5, 0.7, 0.9]) {
      const r = simulate({ days: 7, visitHours: VISITS, sessionSeconds: 600, cps: 1, team: "smart", teamSaveRatio: ratio });
      console.log(
        `阈值 ${ratio}: 总入=${fmt(r.totals.lifetime)}（${pct(r.totals.lifetime / base - 1)}）招募=[${r.log.recruits.join(",")}] 派遣毛占比=${pct(r.totals.dispatch / r.totals.lifetime)}`,
      );
    }
  });

  it("⑤ 派遣「必做」复核：早鸟 vs 不派 vs 只在后期派", () => {
    // 用引擎验证：同一同事、同一工位，派 vs 不派的净收益随 S 变化（见 dispatch 探针），
    // 这里看全流程：始终派遣 vs 始终不派遣（但允许招募）
    const days = 30;
    const base = { days, visitHours: VISITS, sessionSeconds: 600, cps: 1 };
    const off = simulate({ ...base, team: "smart", dispatchEnabled: false }).totals.lifetime;
    const on = simulate({ ...base, team: "smart" }).totals.lifetime;
    console.log(`\n30 天 cps=1：只招募不派遣=${fmt(off)} → 招募+派遣=${fmt(on)}（派遣净贡献 ${pct(on / off - 1)}）`);
    console.log("（逐单净收益的盈亏平衡点见 dispatch 探针②：老周咖啡 S*=373/s，小李咖啡 S*=6303/s，王师傅咖啡 S*=3263/s）");
  });
});

describe("R12R2-6b 一键领取面板偏差（真实流程）", () => {
  it("30 天流程中「一键领取显示 / 实际到账」的最大倍率", () => {
    for (const mode of ["smart", "full"] as const) {
      const r = simulate({ days: 30, visitHours: VISITS, sessionSeconds: 600, cps: 1, team: mode });
      console.log(`\n${mode}: 一键领取显示/实际 最大倍率 = ${r.claimMismatchMax.toFixed(2)}×（1.00 = 完全一致）`);
    }
  });
});
