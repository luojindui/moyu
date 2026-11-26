/**
 * probe-opt-idle.test.ts — 数值党探针②：纯挂机党死局分析 + 修复方案对比
 * 运行：npx vitest run playtest/probe-opt-idle.test.ts
 */
import { describe, it } from "vitest";
import {
  runSim,
  makeGreedy,
  engineCost,
  engineEffect,
  type CostFn,
} from "./probe-opt-lib";
import { UPGRADES, costOf } from "../src/engine/upgrades";

/** 纯挂机党：t=0 点 T 下之后再也不点（点击力对 0tps 玩家价值为 0，贪心自然只买挂机项） */
function idleOnlyRun(taps: number, minutes = 180, opts: { baselineIdle?: number; costFn?: CostFn } = {}) {
  return runSim({
    minutes,
    tps: 0,
    dt: 0.25,
    initialTaps: taps,
    orderFn: makeGreedy(opts.costFn ?? engineCost, engineEffect),
    baselineIdle: opts.baselineIdle,
    costFn: opts.costFn,
    checkpointMinutes: [1, 3, 10, 30, 60, 120, 180],
  });
}

describe("纯挂机党：点多少下才能活？", () => {
  it("点击数 T ∈ {0,5,10,15,20,30,40,49,50,60,100} → 180min 结局", () => {
    console.log("\n===== 点击数门槛扫描（之后 0tps，挂 180min）=====");
    console.log("T(下) | 首购min | 挂机速率 | income/s@180 | 购买数 | 结局");
    for (const T of [0, 5, 10, 15, 20, 30, 40, 49, 50, 60, 100]) {
      const run = idleOnlyRun(T);
      const end = run.curve.at(-1)!;
      const first = Object.values(run.firstBuyOf)[0];
      console.log(
        `  ${String(T).padStart(3)} | ${String(first ?? "-").padStart(7)} | ${String(end.ir).padStart(8)} | ${String(end.income).padStart(12)} | ${String(run.purchases).padStart(4)} | ${end.income > 0 ? "活" : "死局"}`,
      );
    }
    console.log(
      `  [门槛解释] 最便宜挂机项=刷手机(${costOf("phone", 0)})；咖啡(${costOf("coffee", 0)})只加点击力，对挂机党零价值`,
    );
  });

  it("死局逃逸路径核数：T=15/30/49 全花咖啡能否爬到刷手机？", () => {
    for (const T of [15, 30, 49]) {
      let moyu = T;
      let lv = 0;
      let spent = 0;
      for (;;) {
        const p = costOf("coffee", lv);
        if (moyu >= p) {
          moyu -= p;
          spent += p;
          lv += 1;
        } else break;
      }
      console.log(
        `  T=${T}: 全花咖啡后剩余=${moyu}(花费${spent}) → 距刷手机(50)还差 ${Math.max(0, 50 - moyu)}，且咖啡不产生挂机 → 死局`,
      );
    }
  });
});

describe("修复方案对比（目标：10 下点击的挂机党能活，且不破坏点击党）", () => {
  it("V0 原版 / V1 底薪0.2 / V1b 底薪0.5 / V2 刷手机50→30 / V3 底薪0.2+刷手机→30", () => {
    const cfPhone30: CostFn = (id, lv) => {
      const u = UPGRADES.find((x) => x.id === id)!;
      const base = id === "phone" ? 30 : u.baseCost;
      return Math.ceil(base * 1.15 ** lv);
    };
    const cases: [string, ReturnType<typeof idleOnlyRun>][] = [
      ["V0 原版", idleOnlyRun(10)],
      ["V1 底薪0.2/s", idleOnlyRun(10, 180, { baselineIdle: 0.2 })],
      ["V1b 底薪0.5/s", idleOnlyRun(10, 180, { baselineIdle: 0.5 })],
      ["V2 刷手机50→30", idleOnlyRun(10, 180, { costFn: cfPhone30 })],
      ["V3 底薪0.2+手机→30", idleOnlyRun(10, 180, { baselineIdle: 0.2, costFn: cfPhone30 })],
    ];
    console.log("\n===== 修复方案（开局点 10 下后纯挂 180min）=====");
    for (const [name, run] of cases) {
      const end = run.curve.at(-1)!;
      const first = run.firstBuyOf["phone"];
      console.log(
        `  ${name.padEnd(18)}: 首购刷手机@${String(first ?? "-").padStart(7)}min  income@180=${String(end.income).padStart(8)}/s  购买${String(run.purchases).padStart(4)}次  结局=${end.income > 0 ? "活" : "死局"}`,
      );
      console.log(`     生存轨迹: ${run.curve.map((c) => `${c.tMin}min:${c.income}/s`).join("  ")}`);
    }
  });

  it("底薪 0.2/s 是否破坏点击党平衡（tps=3 贪心 180min）", () => {
    const base = runSim({
      minutes: 180, tps: 3, dt: 0.25,
      orderFn: makeGreedy(engineCost, engineEffect),
      checkpointMinutes: [180],
    });
    const withSalary = runSim({
      minutes: 180, tps: 3, dt: 0.25, baselineIdle: 0.2,
      orderFn: makeGreedy(engineCost, engineEffect),
      checkpointMinutes: [180],
    });
    const a = base.curve.at(-1)!.income;
    const b = withSalary.curve.at(-1)!.income;
    console.log(`\n  点击党(3tps) income@180: 原版=${a}/s vs 底薪0.2=${b}/s (Δ${(((b - a) / a) * 100).toFixed(1)}%)`);
  });
});
