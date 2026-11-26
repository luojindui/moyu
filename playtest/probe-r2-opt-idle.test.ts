/**
 * probe-r2-opt-idle.test.ts — r2 数值党探针②：死局修复验证 / idle vs active 平衡 / 挂机党长线
 * 运行：npx vitest run playtest/probe-r2-opt-idle.test.ts
 */
import { describe, it } from "vitest";
import { runSim, makeGreedy, makeGreedyFilter, byPrice, engineCost, engineEffect } from "./probe-opt-lib";
import { effectOf } from "../src/engine/upgrades";
import { offlineEarn } from "../src/engine/offline";
import type { GameState } from "../src/engine/state";

describe("死局修复验证（批次3 含底薪 0.2/s）", () => {
  it("T=0（从未点击）与 T=10：能否起家", { timeout: 120_000 },
      () => {
    for (const T of [0, 10]) {
      const run = runSim({
        minutes: 180, tps: 0, dt: 0.25, initialTaps: T,
        orderFn: makeGreedy(engineCost, engineEffect),
        checkpointMinutes: [1, 3, 5, 10, 30, 60, 120, 180],
      });
      const end = run.curve.at(-1)!;
      console.log(`\n  T=${T}: 首购@${JSON.stringify(run.firstBuyOf)}  购买${run.purchases}次  income@180=${end.income}/s`);
      console.log(`     轨迹: ${run.curve.map((c) => `${c.tMin}min:${c.income}/s`).join("  ")}`);
    }
  });
});

describe("idle vs active 平衡（同贪心策略，180min）", () => {
  it("income 与 totalEarned 对比：idle 反超是否健康", { timeout: 120_000 },
      () => {
    const cases: [string, number, number][] = [
      ["idle(0tps,10下)", 0, 10],
      ["casual(1tps)", 1, 0],
      ["clicker(3tps)", 3, 0],
      ["whale(8→1tps)", NaN, 0],
    ];
    console.log("\n===== 平衡对比（贪心） =====");
    const rows: { name: string; income: number; earned: number; idle: number; cp: number }[] = [];
    for (const [name, tps, taps] of cases) {
      const run = runSim({
        minutes: 180, tps: Number.isNaN(tps) ? (t: number) => (t < 1800 ? 8 : 1) : tps, dt: 0.25, initialTaps: taps,
        orderFn: makeGreedy(engineCost, engineEffect),
        checkpointMinutes: [180],
      });
      const c = run.curve.at(-1)!;
      rows.push({ name, income: c.income, earned: c.totalEarned, idle: c.ir, cp: c.cp });
      console.log(`  ${name.padEnd(16)}: income@180=${String(c.income).padStart(9)}/s  totalEarned=${String(c.totalEarned).padStart(12)}  idle=${c.ir}/s  cp=${c.cp}`);
    }
    const active = rows[1]!.income;
    const idle = rows[0]!.income;
    console.log(`  idle/active(1tps) 收入比: ${(idle / active).toFixed(2)}`);
    // 存量口径：挂机党少花钱（无购买时机差异——贪心都是立刻买），再对比余额
    console.log(`  余额@180: ${rows.map((r) => `${r.name}=${Math.round(r.income < 1e9 ? r.income : 0)}`).join("  ")}`);
  });

  it("stock 口径假象复现：cheapest-first 让挂机党乱买点击项的浪费", { timeout: 120_000 },
      () => {
    // 复现 stock 画像行为（cheapest 全序 + 60s 节流），对比理性挂机贪心
    const stockIdle = runSim({
      minutes: 180, tps: 0, dt: 0.25, initialTaps: 10,
      orderFn: byPrice(engineCost), // 便宜优先：会买咖啡/喝水/椅子
      checkpointMinutes: [180],
    });
    const smartIdle = runSim({
      minutes: 180, tps: 0, dt: 0.25, initialTaps: 10,
      orderFn: makeGreedyFilter(engineCost, engineEffect, "idle"), // 只买挂机项
      checkpointMinutes: [180],
    });
    console.log(`\n  cheapest全序(=stock画像): income@180=${stockIdle.curve.at(-1)!.income}/s  终局等级=${JSON.stringify(stockIdle.endState.levels)}`);
    console.log(`  只买挂机项(理性):        income@180=${smartIdle.curve.at(-1)!.income}/s  终局等级=${JSON.stringify(smartIdle.endState.levels)}`);
    const a = stockIdle.curve.at(-1)!.income, b = smartIdle.curve.at(-1)!.income;
    console.log(`  乱买点击项的收入损失: ${(((b - a) / b) * 100).toFixed(1)}%`);
  });
});

describe("挂机党 7 天长线（离线为主，每天回来清仓）", () => {
  it("纯挂机党 vs 休闲党 2h/天：日终挂机速率对比", { timeout: 120_000 },
      () => {
    const dumpBuy = (state: GameState): GameState => {
      const order = makeGreedy(engineCost, engineEffect);
      for (;;) {
        let bought = false;
        for (const id of order(state, 0, 1, effectOf(state).idleRate)) {
          const price = engineCost(id, state.levels[id] ?? 0);
          if (price > 0 && state.moyu >= price) {
            state = { ...state, moyu: state.moyu - price, levels: { ...state.levels, [id]: (state.levels[id] ?? 0) + 1 } };
            bought = true;
            break;
          }
        }
        if (!bought) break;
      }
      return state;
    };
    const scenarios: [string, number, number][] = [
      ["挂机党(10下+清仓)", 0, 10],
      ["休闲党(2h+清仓)", 120, 0],
    ];
    console.log("\n===== 7 天离线循环（首夜 rate=1，之后 0.7，8h 封顶，离线 12h/夜） =====");
    for (const [name, activeMin, taps] of scenarios) {
      let state = { ...({ moyu: 0, totalEarned: 0, levels: {} } as GameState) };
      const dayRates: number[] = [];
      for (let day = 1; day <= 7; day++) {
        if (activeMin > 0) {
          // 休闲党：每天 2h 在线点击+贪心购买
          const sess = runSim({
            minutes: activeMin, tps: 1, dt: 0.5,
            orderFn: makeGreedy(engineCost, engineEffect), checkpointMinutes: [activeMin],
            initial: state,
          });
          state = sess.endState;
        } else if (day === 1) {
          // 挂机党：仅 day1 点 10 下，之后每天只离线收菜清仓
          const sess = runSim({
            minutes: 10, tps: 0, dt: 0.5, initialTaps: taps,
            orderFn: makeGreedy(engineCost, engineEffect), checkpointMinutes: [10],
          });
          state = sess.endState;
        }
        const r = offlineEarn(state, 12 * 3600, day === 1 ? 1 : 0.7);
        state = dumpBuy(r.state);
        dayRates.push(Math.round(effectOf(state).idleRate));
      }
      console.log(`  ${name}: 清仓后日终挂机速率=[${dayRates.join(", ")}]/s`);
    }
  });
});
