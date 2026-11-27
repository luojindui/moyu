import { describe, it } from "vitest";
import {
  DRAFT_TEAM,
  DAY_S,
  colleagueMaxCost,
  colleagueUpgradeCost,
  earnCurve,
  simulate,
  upgradePayback,
  upgradeTable,
  NO_TALENT,
} from "./probe-b1-lib";

/**
 * 基线经济学：定"首招时间 / 同事价格 / 每级挂机"锚点。
 * 运行：npx vitest run playtest/probe-b1-baseline.test.ts
 */
describe("B1 基线锚点", () => {
  it("升级性价比（+1 挂机/秒 的秒数回本）", () => {
    console.log(upgradeTable().join("\n"));
  });

  it("早期累计收入曲线（不花钱，用于定首招价）", () => {
    for (const cps of [0, 1, 3, 5]) {
      const rows = earnCurve(cps, 3600)
        .map((r) => `${(r.t / 60).toFixed(1)}min=${r.earned >= 1e6 ? (r.earned / 1e6).toFixed(1) + "M" : r.earned >= 1e3 ? (r.earned / 1e3).toFixed(1) + "k" : r.earned.toFixed(0)}`)
        .join(" ");
      console.log(`cps=${cps}: ${rows}`);
    }
  });

  it("同事投入产出（草案 vs 目标）", () => {
    const cfg = DRAFT_TEAM;
    for (const c of cfg.colleagues) {
      const maxCost = colleagueMaxCost(c, cfg);
      const maxIdle = c.idlePerLevel * cfg.maxLevel;
      console.log(
        `${c.name} 招募=${c.cost} 每级=${c.idlePerLevel}/s 满级50=${maxIdle}/s 满级总投入=${(maxCost / 1e4).toFixed(1)}万 招募回本=${(c.cost / c.idlePerLevel).toFixed(0)}s 满级均价=${(maxCost / maxIdle).toFixed(0)}s/(/s)`,
      );
      const lv = 1;
      console.log(`   升级价 Lv1→2=${colleagueUpgradeCost(c, 1, cfg)} Lv10→11=${colleagueUpgradeCost(c, 10, cfg)} Lv49→50=${colleagueUpgradeCost(c, 49, cfg)}`);
    }
    console.log("对照升级回本（早期 Lv0/Lv10/Lv20/Lv40）：");
    for (const id of ["phone", "toilet", "group", "meeting", "deep", "retire"]) {
      console.log(`  ${id}: ${[0, 10, 20, 40].map((lv) => upgradePayback(id, lv).toFixed(0)).join(" / ")} s`);
    }
  });

  it("7 天 3 次回访基线（无新系统，供后续对比）", () => {
    for (const cps of [0, 3]) {
      const r = simulate({
        days: 7,
        visitHours: [9, 13, 20],
        sessionSeconds: 600,
        cps,
        recruit: false,
        dispatch: false,
        levelColleagues: false,
        team: DRAFT_TEAM,
        talent: NO_TALENT,
        prestige: true,
        dailyClaim: true,
        events: true,
      });
      console.log(JSON.stringify(Object.keys(r.final)));
      console.log(
        `cps=${cps}: 7天 total=${(r.totals.total / 1e8).toFixed(1)}e8 lifetime=${(r.final.lifetime / 1e8).toFixed(1)}e8 idle=${(r.final.idleRate).toFixed(0)}/s 转生=${r.prestiges} 段位=${r.final.rank} 级=${JSON.stringify(r.final.levels)}`,
      );
      console.log(`  分项: idleBase=${(r.totals.idleBase / 1e8).toFixed(1)}e8 click=${(r.totals.click / 1e8).toFixed(2)}e8 event=${(r.totals.event / 1e8).toFixed(3)}e8 daily=${(r.totals.daily / 1e8).toFixed(2)}e8`);
    }
  });
});
