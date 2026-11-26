/**
 * probe-opt-value.test.ts — 数值党探针③：升级性价比表 / 交点等级 / 策略对比 / 消融（陷阱项）
 * 运行：npx vitest run playtest/probe-opt-value.test.ts
 */
import { describe, it } from "vitest";
import { UPGRADES, costOf } from "../src/engine/upgrades";
import { runSim, makeGreedy, makeGreedyFilter, byPrice, ablate, engineCost, engineEffect, phaseStats } from "./probe-opt-lib";

describe("边际性价比表", () => {
  it("每个升级在第 N 级的买价 / 每单位效果成本", () => {
    console.log("\n===== 边际性价比：第 N 级买价 ÷ 效果增量 =====");
    const levelsList = [0, 5, 10, 20, 30, 50, 75];
    for (const u of UPGRADES) {
      const unit = u.clickPower ?? u.idleRate!;
      const row = levelsList
        .map((lv) => `lv${lv}:${Math.round(costOf(u.id, lv) / unit)}`)
        .join("  ");
      console.log(`  ${u.name}(${u.id}, 每级+${unit}${u.clickPower ? "点击力" : "/s"}): ${row}`);
    }
    console.log("  注：点击力价值=taps/s×点击力；对 3tps 玩家 1点击力≈3/s，对挂机党≈0");
  });

  it("交叉点：某项升到第几级就不如下一档裸价（陷阱区间）", () => {
    console.log("\n===== 交叉点（边际成本/效果 > 下一档裸价/效果 的最低等级）=====");
    const idleLadder = ["phone", "toilet", "group", "meeting"];
    for (let i = 0; i < idleLadder.length - 1; i++) {
      const a = UPGRADES.find((u) => u.id === idleLadder[i])!;
      const b = UPGRADES.find((u) => u.id === idleLadder[i + 1])!;
      const unitA = a.idleRate!;
      const unitB = b.idleRate!;
      // a 的边际成本/效果 = base_a×1.15^n/unit_a；b 裸价/效果 = base_b/unit_b
      let n = 0;
      while (costOf(a.id, n) / unitA <= costOf(b.id, 0) / unitB && n < 200) n++;
      console.log(
        `  ${a.name}→${b.name}: 从 lv${n} 起，${a.name}第${n}级(${Math.round(costOf(a.id, n))}摸鱼值/+${unitA}/s=${Math.round(costOf(a.id, n) / unitA)}) 贵过 ${b.name}裸价(${costOf(b.id, 0)}/+${unitB}/s=${Math.round(costOf(b.id, 0) / unitB)})`,
      );
    }
    for (const tps of [1, 3, 8]) {
      const coffee = UPGRADES.find((u) => u.id === "coffee")!;
      const water = UPGRADES.find((u) => u.id === "water")!;
      let n = 0;
      while ((costOf(coffee.id, n) / coffee.clickPower!) / tps <= (costOf(water.id, 0) / water.clickPower!) / tps && n < 200) n++;
      console.log(`  咖啡→带薪喝水(点击线, ${tps}tps): 从 lv${n} 起咖啡单级贵过喝水裸价`);
    }
  });
});

describe("策略对比（tps=3，180min）：贪心 vs 逐价 vs 攒钱等最优", () => {
  it("终局收入与误买证据", () => {
    // 攒钱等最优：永远只买当前边际性价比最高的那一项，买不起就等（不将就买便宜的）
    const waitBest: Parameters<typeof runSim>[0]["orderFn"] = (state, t, tpsNow, income) => {
      const order = makeGreedy(engineCost, engineEffect)(state, t, tpsNow, income);
      return order.slice(0, 1);
    };
    const strategies: [string, Parameters<typeof runSim>[0]][] = [
      ["贪心-立即花光", { orderFn: makeGreedy(engineCost, engineEffect) }],
      ["逐价便宜优先(stock画像)", { orderFn: byPrice(engineCost) }],
      ["逐价最贵优先(stock画像)", { orderFn: byPrice(engineCost, true) }],
      ["攒钱等最优项", { orderFn: waitBest }],
    ];
    console.log("\n===== 策略对比 tps=3 @180min =====");
    const results: { name: string; income: number; run: ReturnType<typeof runSim> }[] = [];
    for (const [name, opts] of strategies) {
      const run = runSim({ minutes: 180, tps: 3, dt: 0.25, ...opts, checkpointMinutes: [30, 180] });
      const end = run.curve.at(-1)!;
      results.push({ name, income: end.income, run });
      console.log(
        `  ${name.padEnd(22)}: income@180=${String(end.income).padStart(8)}/s  income@30=${String(run.curve[0].income).padStart(7)}/s  购买${run.purchases}次  终局等级=${JSON.stringify(run.endState.levels)}`,
      );
    }
    const best = Math.max(...results.map((r) => r.income));
    for (const r of results) {
      console.log(`  ${r.name} 相对最优: ${(((best - r.income) / best) * 100).toFixed(1)}%`);
    }
    // 贪心的购买顺序：看每项最后一次被买的时刻（=该项退出最优的时间）
    const greedy = results[0].run;
    for (const u of UPGRADES) {
      const evs = greedy.events.filter((e) => e.id === u.id);
      const last = evs.at(-1);
      const lv = greedy.endState.levels[u.id] ?? 0;
      console.log(
        `  贪心买 ${u.name}: ${evs.length}次, 最后一次@${last ? last.tMin.toFixed(1) : "-"}min(终局lv${lv}), 该次花费=${last?.cost}`,
      );
    }
  });

  it("消融：砍掉某一项升级，贪心 180min 收入损失 → 重要性排序", () => {
    console.log("\n===== 消融实验 tps=3（砍掉单项后的 income@180 相对损失%）=====");
    const base = runSim({
      minutes: 180, tps: 3, dt: 0.25,
      orderFn: makeGreedy(engineCost, engineEffect),
      checkpointMinutes: [180],
    });
    const baseIncome = base.curve.at(-1)!.income;
    const rows: [string, number][] = [];
    for (const u of UPGRADES) {
      const run = runSim({
        minutes: 180, tps: 3, dt: 0.25,
        orderFn: ablate(makeGreedy(engineCost, engineEffect), u.id),
        checkpointMinutes: [180],
      });
      const income = run.curve.at(-1)!.income;
      rows.push([u.name, ((baseIncome - income) / baseIncome) * 100]);
    }
    rows.sort((a, b) => a[1] - b[1]);
    for (const [name, loss] of rows) console.log(`  ${name.padEnd(10)}: 砍掉后收入损失 ${loss.toFixed(1)}%`);
  });

  it("转型陷阱：点 1 分钟(60下)后转挂机，买咖啡 vs 攒钱买刷手机", () => {
    const tps = (t: number) => (t < 60 ? 1 : 0);
    console.log("\n===== 转型陷阱：1tps×1min 后纯挂 180min =====");
    // (a) 贪心按当前价值买：第一分钟内咖啡性价比最高(1tps×1/15 > 1/50) → 会买咖啡
    const greedyRun = runSim({
      minutes: 180, tps, dt: 0.25,
      orderFn: makeGreedy(engineCost, engineEffect),
      checkpointMinutes: [1, 3, 10, 30, 180],
    });
    // (b) 只买挂机项（攒钱到 50 买刷手机）
    const idleRun = runSim({
      minutes: 180, tps, dt: 0.25,
      orderFn: makeGreedyFilter(engineCost, engineEffect, "idle"),
      checkpointMinutes: [1, 3, 10, 30, 180],
    });
    console.log(
      `  (a) 贪心买咖啡路线: 1min 时等级=${JSON.stringify(greedyRun.curve[0].levels)}(终局${JSON.stringify(greedyRun.endState.levels)}) → income@180=${greedyRun.curve.at(-1)!.income}/s ${greedyRun.curve.at(-1)!.income > 0 ? "" : "【死局】"}`,
    );
    console.log(`      轨迹: ${greedyRun.curve.map((c) => `${c.tMin}min:${c.income}/s`).join("  ")}`);
    console.log(
      `  (b) 攒钱直奔刷手机: income@180=${idleRun.curve.at(-1)!.income}/s  购买${idleRun.purchases}次  轨迹: ${idleRun.curve.map((c) => `${c.tMin}min:${c.income}/s`).join("  ")}`,
    );
  });
});

describe("购买间隔手感（贪心 tps=3）", () => {
  it("间隔分位数 per 阶段（等待感≠空转，是攒钱预期）", () => {
    const run = runSim({
      minutes: 180, tps: 3, dt: 0.25,
      orderFn: makeGreedy(engineCost, engineEffect),
    });
    console.log("\n===== 购买间隔手感 tps=3 贪心 =====");
    for (const [a, b, label] of [[0, 3, "0-3min"], [3, 30, "3-30min"], [30, 180, "30-180min"]] as [number, number, string][]) {
      const s = phaseStats(run, a, b);
      console.log(`  ${label}: 购买${s.purchases}次  中位间隔=${s.medianWaitSec}s  最大间隔=${s.maxWaitSec}s  间隔>5min=${s.waitsOver5min}次`);
    }
  });
});

