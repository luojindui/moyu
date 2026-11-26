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
} from "./probe-opt-lib";
import { UPGRADES, costOf } from "../src/engine/upgrades";

/** 纯挂机党：t=0 点 T 下之后再也不点，贪心只可能看上挂机项（点击力对其价值为 0） */
function idleOnlyRun(taps: number, minutes = 180, opts: { baselineIdle?: number } = {}) {
  const costFn = engineCost;
  const effectFn = engineEffect;
  return runSim({
    minutes,
    tps: 0,
    dt: 0.25,
    initialTaps: taps,
    orderFn: makeGreedy(costFn, effectFn),
    baselineIdle: opts.baselineIdle,
    checkpointMinutes: [1, 3, 10, 30, 60, 120, 180],
  });
}

describe("纯挂机党：点多少下才能活？", () => {
  it("点击数 T ∈ {0,5,10,15,20,30,40,49,50,60,100} → 180min 结局", () => {
    console.log("\n===== 点击数门槛扫描（之后 0tps，挂 180min）=====");
    console.log("T(下) | 首购min | 挂机收入180min | income/s | 购买数 | 结局");
    for (const T of [0, 5, 10, 15, 20, 30, 40, 49, 50, 60, 100]) {
      const run = idleOnlyRun(T);
      const end = run.curve.at(-1)!;
      const first = Object.values(run.firstBuyOf)[0];
      console.log(
        `  ${String(T).padStart(3)} | ${String(first ?? "-").padStart(7)} | ${String(end.ir).padStart(14)} | ${String(end.income).padStart(7)} | ${String(run.purchases).padStart(4)} | ${end.income > 0 ? "活" : "死局"}`,
      );
    }
    console.log(
      `  [门槛解释] 最便宜挂机项=刷手机(${costOf("phone", 0)})，咖啡=${costOf("coffee", 0)}(纯点击力，对挂机党无用)`,
    );
  });

  it("死局逃逸路径：T=15/30/49 时买咖啡能否爬到刷手机？(手动核数)", () => {
    // 挂机党买咖啡不产生任何挂机收入，只消耗存量 → 唯一活路是存量直接够 50
    for (const T of [15, 30, 49]) {
      let moyu = T;
      let lv = 0;
      let spent = 0;
      // 贪心地把钱全花在能买的项上（咖啡也买，看会不会更糟）
      for (;;) {
        const p = costOf("coffee", lv);
        if (moyu >= p) {
          moyu -= p;
          spent += p;
          lv += 1;
        } else break;
      }
      console.log(
        `  T=${T}: 全花咖啡后 剩余=${moyu} 花费=${spent} → 距离刷手机(50)还差 ${Math.max(0, 50 - moyu)}，无挂机收入 → 死局`,
      );
    }
  });
});

describe("修复方案对比（目标：10 下点击的挂机党能活，且不破坏点击党）", () => {
  it("V0 原版 / V1 底薪0.2 / V1b 底薪0.5 / V2 刷手机50→30 / V3 底薪0.2+刷手机50→30", () => {
    console.log("\n===== 修复方案（10 下点击后纯挂 180min）=====");
    // V0
    const v0 = idleOnlyRun(10);
    // V1/V1b/V3：baselineIdle（反事实：无条件基础挂机）
    const v1 = idleOnlyRun(10, 180, { baselineIdle: 0.2 });
    const v1b = idleOnlyRun(10, 180, { baselineIdle: 0.5 });
    // V2/V3：刷手机 baseCost 50→30（反事实价格表）
    const cfPhone30 = (id: string, lv: number) => {
      const u = UPGRADES.find((x) => x.id === id)!;
      const base = id === "phone" ? 30 : u.baseCost;
      return Math.ceil(base * 1.15 ** lv);
    };
    const v2 = runSim({
      minutes: 180, tps: 0, dt: 0.25, initialTaps: 10,
      orderFn: makeGreedy(cfPhone30, engineEffect),
      costFn: undefined, // costFn 仅用于买价：这里走 CF 分支
      // 注意：makeGreedy 已用 cfPhone30 定价；runSim 的 costFn 也要换成同一张表
    });
    const v3 = runSim({
      minutes: 180, tps: 0, dt: 0.25, initialTaps: 10,
      orderFn: makeGreedy(cfPhone30, engineEffect),
      costFn: undefined,
      baselineIdle: 0.2,
    });
    void v2; void v3; // 上两个因 costFn 默认走引擎价，单独重跑正确版：
    const v2b = runSim({
      minutes: 180, tps: 0, dt: 0.25, initialTaps: 10,
      orderFn: (s, t, tp, inc) => makeGreedy(cfPhone30, engineEffect)(s, t, tp, inc),
      effectFn: engineEffect,
      // @ts-expect-error 反事实探针：直接注入自定义买价
      costFn: cfPhone30,
      baselineIdle: 0,
    });
    const v3b = runSim({
      minutes: 180, tps: 0, dt: 0.25, initialTaps: 10,
      orderFn: (s, t, tp, inc) => makeGreedy(cfPhone30, engineEffect)(s, t, tp, inc),
      effectFn: engineEffect,
      // @ts-expect-error 反事实探针：直接注入自定义买价
      costFn: cfPhone30,
      baselineIdle: 0.2,
    });
    const rows: [string, ReturnType<typeof idleOnlyRun>][] = [
      ["V0 原版", v0],
      ["V1 底薪0.2/s", v1],
      ["V1b 底薪0.5/s", v1b],
      ["V2 刷手机50→30", v2b as never],
      ["V3 底薪0.2+刷手机→30", v3b as never],
    ];
    for (const [name, run] of rows) {
      const end = run.curve.at(-1)!;
      const first = run.firstBuyOf["phone"];
      console.log(
        `  ${name.padEnd(20)}: 首购刷手机@${String(first ?? "-").padStart(6)}min  income180=${String(end.income).padStart(8)}/s  购买${String(run.purchases).padStart(4)}次  结局=${end.income > 0 ? "活" : "死局"}`,
      );
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
