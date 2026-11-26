/**
 * probe-opt-curve.test.ts — 数值党探针①：成长曲线 / 饱和 / 反事实曲线对比 / 48h 长线
 * 运行：npx vitest run playtest/probe-opt-curve.test.ts
 */
import { describe, it, expect } from "vitest";
import { doClick, BASE_CLICK_POWER } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { costOf, effectOf, UPGRADES } from "../src/engine/upgrades";
import { initialState } from "../src/engine/state";
import {
  runSim,
  makeGreedy,
  engineCost,
  engineEffect,
  cfCost,
  cfEffect,
  phaseStats,
  relGainByBucket,
  quantile,
} from "./probe-opt-lib";

const PHASES: [number, number, string][] = [
  [0, 3, "0-3min    "],
  [3, 30, "3-30min   "],
  [30, 180, "30-180min "],
];

describe("sanity：探针循环 ≡ 引擎语义", () => {
  it("cfCost(1.15) 与引擎 costOf 逐级相等；cfEffect(null) 与 effectOf 相等；手动点击/挂机与引擎相等", () => {
    const cf115 = cfCost(1.15);
    for (const u of UPGRADES) {
      for (let lv = 0; lv <= 90; lv++) {
        expect(cf115(u.id, lv)).toBe(costOf(u.id, lv));
      }
    }
    const samples = [
      {},
      { coffee: 5 },
      { coffee: 20, water: 10, phone: 30, toilet: 12, group: 7, meeting: 40 },
    ];
    for (const levels of samples) {
      expect(cfEffect(null)(levels)).toEqual(effectOf({ moyu: 0, levels }));
    }
    // 手动点击 ≡ doClick；手动挂机 ≡ advance
    for (const levels of samples) {
      let s = initialState();
      s = { ...s, levels };
      const clicked = doClick(s);
      expect(clicked.moyu - s.moyu).toBe(BASE_CLICK_POWER + effectOf(s).clickPower);
      const dt = 7.3;
      const adv = advance(s, dt);
      expect(adv.moyu - s.moyu).toBe(effectOf(s).idleRate * dt);
    }
  });
});

describe("原版曲线：贪心玩家的 180min", () => {
  it("tps=1 / tps=3 / 爆肝(8tps 30min 后 1tps) 三画像", () => {
    const runs = [
      { name: "casual(1tps)", tps: 1 },
      { name: "clicker(3tps)", tps: 3 },
      { name: "whale(8→1tps)", tps: (t: number) => (t < 1800 ? 8 : 1) },
    ];
    for (const r of runs) {
      const run = runSim({
        minutes: 180,
        tps: r.tps,
        dt: 0.25,
        orderFn: makeGreedy(engineCost, engineEffect),
        checkpointMinutes: [0, 1, 3, 10, 30, 60, 90, 120, 150, 180],
      });
      console.log(`\n===== 贪心 ${r.name} =====`);
      console.log("曲线(min): moyu / 点击力 / 挂机/秒 / 收入/秒");
      for (const c of run.curve) {
        console.log(
          `  ${String(c.tMin).padStart(4)}min  moyu=${String(c.moyu).padStart(8)}  cp=${String(c.cp).padStart(5)}  idle=${String(c.ir).padStart(6)}/s  income=${String(c.income).padStart(7)}/s  levels=${JSON.stringify(c.levels)}`,
        );
      }
      for (const [a, b, label] of PHASES) {
        console.log(`  阶段${label}: ${JSON.stringify(phaseStats(run, a, b))}`);
      }
      console.log(`  首次购买: ${JSON.stringify(run.firstBuyOf)}`);
      console.log(`  总购买 ${run.purchases} 次；点击收入 ${run.totalClickIncome}，挂机收入 ${run.totalIdleIncome}`);
    }
  });

  it("tps=1：每 30min 一桶的每次购买相对收益（饱和速度）", () => {
    const run = runSim({
      minutes: 180,
      tps: 1,
      dt: 0.25,
      orderFn: makeGreedy(engineCost, engineEffect),
    });
    console.log("\n===== tps=1 贪心：每 30min 桶内[每次购买相对收益%] =====");
    for (const b of relGainByBucket(run, 30, 180)) console.log(`  ${JSON.stringify(b)}`);
  });
});

describe("反事实 A：换价曲线因子（tps=1）", () => {
  it("factor ∈ {1.15, 1.12, 1.10, 1.07}：购买数/终局收入/相对收益分布/长等待", () => {
    console.log("\n===== 价曲线因子对比（贪心 tps=1, 180min）=====");
    for (const f of [1.15, 1.12, 1.1, 1.07]) {
      const costFn = f === 1.15 ? engineCost : cfCost(f);
      const run = runSim({
        minutes: 180,
        tps: 1,
        dt: 0.25,
        orderFn: makeGreedy(costFn, engineEffect),
        costFn,
        checkpointMinutes: [180],
      });
      const late = phaseStats(run, 30, 180);
      const maxLv = Math.max(...Object.values(run.endState.levels));
      const end = run.curve.at(-1)!;
      console.log(
        `  ×${f}: 购买${run.purchases}次  income@180=${end.income}/s  30-180min: 中位相对收益=${late.medianRelGain}%  p90=${late.p90RelGain}%  中位间隔=${late.medianWaitSec}s  最大间隔=${late.maxWaitSec}s  >5min等待=${late.waitsOver5min}次  最高等级=${maxLv}`,
      );
    }
  });
});

describe("反事实 B：里程碑倍数（每 M 级全效果 ×2）", () => {
  it("tps=1：M ∈ {10, 20, 25} vs 原版：收入曲线 + 里程碑脉冲", () => {
    for (const M of [10, 20, 25]) {
      const effM = cfEffect(M);
      const run = runSim({
        minutes: 180,
        tps: 1,
        dt: 0.25,
        orderFn: makeGreedy(engineCost, effM),
        effectFn: effM,
        checkpointMinutes: [3, 10, 30, 60, 120, 180],
      });
      const base = runSim({
        minutes: 180,
        tps: 1,
        dt: 0.25,
        orderFn: makeGreedy(engineCost, engineEffect),
        checkpointMinutes: [180],
      });
      const mM = run.curve.at(-1)!.income;
      const vanilla = base.curve.at(-1)!.income;
      const bigPurchases = run.events.filter((e) => e.relGain > 0.1);
      console.log(`\n===== 里程碑(每${M}级×2) 贪心 tps=1 =====`);
      for (const c of run.curve) {
        console.log(`  ${String(c.tMin).padStart(4)}min  income=${String(c.income).padStart(9)}/s  levels=${JSON.stringify(c.levels)}`);
      }
      console.log(
        `  income@180: 原版=${vanilla}/s  M=${M}=${mM}/s (×${(mM / vanilla).toFixed(1)})  购买${run.purchases}次  相对收益>10%的脉冲购买${bigPurchases.length}次`,
      );
      const late = phaseStats(run, 30, 180);
      console.log(`  30-180min: 中位相对收益=${late.medianRelGain}%  中位间隔=${late.medianWaitSec}s  最大间隔=${late.maxWaitSec}s`);
    }
  });
});

describe("48h 长线（原版 ×1.15，贪心 tps=1，纯在线）", () => {
  it("收入曲线 / 每 6h 购买节奏 / 首次 >10min 等待", () => {
    const run = runSim({
      minutes: 2880,
      tps: 1,
      dt: 1,
      orderFn: makeGreedy(engineCost, engineEffect),
      checkpointMinutes: [30, 60, 120, 240, 360, 480, 720, 1080, 1440, 2160, 2880],
    });
    console.log("\n===== 48h 长线：收入曲线 =====");
    for (const c of run.curve) {
      const h = (c.tMin / 60).toFixed(1);
      console.log(`  ${String(h).padStart(5)}h  moyu=${String(c.moyu).padStart(10)}  income=${String(c.income).padStart(9)}/s  levels=${JSON.stringify(c.levels)}`);
    }
    console.log("===== 每 6h 块：购买数 / 中位间隔 / 最大间隔 / 块末收入较块初倍数 =====");
    const blocks: { b: number; s: ReturnType<typeof phaseStats>; inc0: number; inc1: number }[] = [];
    for (let b = 0; b < 2880; b += 360) {
      const s = phaseStats(run, b, b + 360);
      const c0 = run.curve.filter((c) => c.tMin <= b).at(-1) ?? run.curve[0];
      const c1 = run.curve.filter((c) => c.tMin <= b + 360).at(-1)!;
      blocks.push({ b, s, inc0: c0.income, inc1: c1.income });
    }
    for (const bl of blocks) {
      console.log(
        `  ${String(bl.b / 60).padStart(4)}-${String((bl.b + 360) / 60).padStart(4)}h: 购买${String(bl.s.purchases).padStart(4)}次  中位间隔=${String(bl.s.medianWaitSec).padStart(6)}s  最大间隔=${String(bl.s.maxWaitSec).padStart(6)}s  >5min等待=${bl.s.waitsOver5min}  收入${bl.inc0}→${bl.inc1}/s (×${(bl.inc1 / Math.max(bl.inc0, 1)).toFixed(2)})`,
      );
    }
    const first10 = run.events.find((e) => e.waitSec > 600);
    const first30 = run.events.find((e) => e.waitSec > 1800);
    console.log(
      `  首次购买间隔>10min 出现在 ${first10 ? first10.tMin.toFixed(0) + "min" : "48h内无"}；>30min 在 ${first30 ? first30.tMin.toFixed(0) + "min" : "48h内无"}`,
    );
    const waits = run.events.slice(1).map((e) => e.waitSec);
    console.log(
      `  全程等待分位: p50=${quantile(waits, 0.5).toFixed(0)}s p90=${quantile(waits, 0.9).toFixed(0)}s p99=${quantile(waits, 0.99).toFixed(0)}s  总购买=${run.purchases}`,
    );
    // 终局边际成本
    const lv = run.endState.levels;
    console.log("  终局等级与边际成本(下一级价格 / 每秒增量):");
    for (const u of UPGRADES) {
      const l = lv[u.id] ?? 0;
      const price = costOf(u.id, l);
      console.log(
        `    ${u.name}(lv${l}): 下一级 ${Math.round(price)} 摸鱼值 / +${u.clickPower ? u.clickPower + "点击力" : u.idleRate + "/s"} → 每单位效果 ${Math.round(price / (u.clickPower ?? u.idleRate!))}`,
      );
    }
  });
});
