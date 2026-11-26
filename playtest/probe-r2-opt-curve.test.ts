/**
 * probe-r2-opt-curve.test.ts — r2 数值党探针①：批次3 实测 vs 预测、过热度、M=25 对比、48h 长线
 * 运行：npx vitest run playtest/probe-r2-opt-curve.test.ts
 */
import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { doClick, BASE_CLICK_POWER } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { costOf, effectOf, UPGRADES } from "../src/engine/upgrades";
import {
  runSim, makeGreedy, engineCost, engineEffect, cfCost, cfEffect,
  phaseStats, relGainByBucket, quantile, type CostFn, type EffFn,
} from "./probe-opt-lib";

describe("sanity：探针 ≡ 批次3 引擎", () => {
  it("cfCost(1.15)≡costOf；cfEffect(20)≡effectOf；手动点击/挂机≡引擎", { timeout: 120_000 },
      () => {
    const cf115 = cfCost(1.15);
    for (const u of UPGRADES) for (let lv = 0; lv <= 90; lv++) expect(cf115(u.id, lv)).toBe(costOf(u.id, lv));
    const samples = [{}, { coffee: 19, phone: 20 }, { chair: 21, deep: 40, retire: 1 }, { coffee: 41, meeting: 60 }];
    for (const levels of samples) expect(cfEffect(20)(levels)).toEqual(effectOf({ moyu: 0, totalEarned: 0, levels }));
    for (const levels of samples) {
      const s = { ...initialState(), levels };
      expect(doClick(s).moyu - s.moyu).toBe(BASE_CLICK_POWER + effectOf(s).clickPower);
      const dt = 7.3;
      expect(advance(s, dt).moyu - s.moyu).toBe(effectOf(s).idleRate * dt);
    }
  });
});

describe("批次3 实测：贪心 180min 四画像", () => {
  it("tps=1 / 3 / 8→1 / 挂机党(10下)：曲线+阶段+首购时间线", { timeout: 120_000 },
      () => {
    const runs = [
      { name: "casual(1tps)", tps: 1 },
      { name: "clicker(3tps)", tps: 3 },
      { name: "whale(8→1tps)", tps: (t: number) => (t < 1800 ? 8 : 1) },
      { name: "idle(10下后0tps)", tps: 0, taps: 10 },
    ];
    for (const r of runs) {
      const run = runSim({
        minutes: 180, tps: r.tps, dt: 0.25, initialTaps: r.taps,
        orderFn: makeGreedy(engineCost, engineEffect),
        checkpointMinutes: [0, 1, 3, 10, 30, 60, 120, 180],
      });
      console.log(`\n===== r2 贪心 ${r.name} =====`);
      for (const c of run.curve) {
        console.log(
          `  ${String(c.tMin).padStart(4)}min  moyu=${String(c.moyu).padStart(9)}  totalEarned=${String(c.totalEarned).padStart(10)}  cp=${String(c.cp).padStart(6)}  idle=${String(c.ir).padStart(8)}/s  income=${String(c.income).padStart(9)}/s  levels=${JSON.stringify(c.levels)}`,
        );
      }
      for (const [a, b, label] of [[0, 3, "0-3min"], [3, 30, "3-30min"], [30, 180, "30-180min"]] as [number, number, string][]) {
        console.log(`  阶段${label.padEnd(9)}: ${JSON.stringify(phaseStats(run, a, b))}`);
      }
      console.log(`  首购时间线: ${JSON.stringify(run.firstBuyOf)}`);
      console.log(`  总购买${run.purchases}次  点击收入${run.totalClickIncome}  挂机收入${run.totalIdleIncome}`);
      const pulses = run.events.filter((e) => e.relGain > 0.1).length;
      console.log(`  相对收益>10%的脉冲购买: ${pulses} 次`);
    }
    // 30min 桶饱和速度（tps=1 复测）
    const c1 = runs[0];
    const run1 = runSim({ minutes: 180, tps: c1.tps as number, dt: 0.25, orderFn: makeGreedy(engineCost, engineEffect) });
    console.log("\n===== tps=1 贪心：每 30min 桶[每次购买相对收益%] =====");
    for (const b of relGainByBucket(run1, 30, 180)) console.log(`  ${JSON.stringify(b)}`);
  });
});

describe("真实倍率：批次3 vs 批次1 语义（同贪心）", () => {
  it("重建批次1（六档/线性/无底薪），对比 income@180", { timeout: 120_000 },
      () => {
    const B1: Record<string, { base: number; clickPower?: number; idleRate?: number }> = {
      coffee: { base: 15, clickPower: 1 }, water: { base: 100, clickPower: 2 },
      phone: { base: 50, idleRate: 1 }, toilet: { base: 300, idleRate: 3 },
      group: { base: 1200, idleRate: 8 }, meeting: { base: 6000, idleRate: 25 },
    };
    const b1Cost: CostFn = (id, lv) => { const u = B1[id]; return u ? Math.ceil(u.base * 1.15 ** lv) : 0; };
    const b1Effect: EffFn = (levels) => {
      let cp = 0, ir = 0;
      for (const [id, u] of Object.entries(B1)) { const lv = levels[id] ?? 0; cp += (u.clickPower ?? 0) * lv; ir += (u.idleRate ?? 0) * lv; }
      return { clickPower: cp, idleRate: ir };
    };
    console.log("\n===== 批次3(现行) vs 批次1(重建) income@180 =====");
    for (const [name, tps, taps] of [["1tps", 1, 0], ["3tps", 3, 0], ["idle(10下)", 0, 10]] as [string, number, number][]) {
      const now = runSim({ minutes: 180, tps, dt: 0.25, initialTaps: taps, orderFn: makeGreedy(engineCost, engineEffect), checkpointMinutes: [180] });
      const old = runSim({ minutes: 180, tps, dt: 0.25, initialTaps: taps, orderFn: makeGreedy(b1Cost, b1Effect), costFn: b1Cost, effectFn: b1Effect, checkpointMinutes: [180] });
      const a = now.curve.at(-1)!.income, b = old.curve.at(-1)!.income;
      console.log(`  ${name.padEnd(10)}: 批次1=${String(b).padStart(7)}/s → 批次3=${String(a).padStart(9)}/s  (×${(a / Math.max(b, 0.001)).toFixed(1)})`);
    }
    // r1 预测参照：M=20 单独反事实（无九档/无底薪之外的增益）当时 ×5.2
    console.log("  [参照] r1 预测：仅里程碑M=20（六档+无底薪）×5.2；批次3 叠加九档+底薪后看上方真实倍率");
  });
});

describe("M=20 vs M=25（要不要降温）", () => {
  it("同九档+底薪，仅里程碑步长不同：income@180 / 脉冲 / 后期节奏", { timeout: 120_000 },
      () => {
    console.log("\n===== 里程碑步长对比（贪心 tps=1）=====");
    for (const M of [20, 25]) {
      const eff = cfEffect(M);
      const run = runSim({
        minutes: 180, tps: 1, dt: 0.25,
        orderFn: makeGreedy(engineCost, eff), effectFn: eff,
        checkpointMinutes: [10, 30, 60, 120, 180],
      });
      const late = phaseStats(run, 30, 180);
      const pulses = run.events.filter((e) => e.relGain > 0.1).length;
      const c = run.curve;
      console.log(
        `  M=${M}: income 10min=${c[0].income}/s 30min=${c[1].income}/s 60min=${c[2].income}/s 120min=${c[3].income}/s 180min=${c[4].income}/s  购买${run.purchases}次  脉冲${pulses}次  30-180min中位相对收益=${late.medianRelGain}% 中位间隔=${late.medianWaitSec}s`,
      );
    }
  });
});

describe("48h 长线（现行引擎，贪心 tps=1，纯在线）", () => {
  it("6h 块增长/间隔/死区 + 深档解锁时间", { timeout: 120_000 },
      () => {
    const run = runSim({
      minutes: 2880, tps: 1, dt: 1,
      orderFn: makeGreedy(engineCost, engineEffect),
      checkpointMinutes: [30, 60, 120, 240, 360, 480, 720, 1080, 1440, 2160, 2880],
    });
    console.log("\n===== r2 48h 长线：收入曲线 =====");
    for (const c of run.curve) {
      console.log(`  ${(c.tMin / 60).toFixed(1).padStart(5)}h  totalEarned=${String(c.totalEarned).padStart(12)}  income=${String(c.income).padStart(11)}/s  levels=${JSON.stringify(c.levels)}`);
    }
    console.log("===== 每 6h 块：购买数/中位间隔/最大间隔/>30min死区/收入倍数 =====");
    for (let b = 0; b < 2880; b += 360) {
      const s = phaseStats(run, b, b + 360);
      const c0 = run.curve.filter((c) => c.tMin <= b).at(-1) ?? run.curve[0];
      const c1 = run.curve.filter((c) => c.tMin <= b + 360).at(-1)!;
      console.log(
        `  ${String(b / 60).padStart(4)}-${String((b + 360) / 60).padStart(4)}h: 购买${String(s.purchases).padStart(4)}次  中位间隔=${String(s.medianWaitSec).padStart(5)}s  最大=${String(s.maxWaitSec).padStart(6)}s  >5min=${String(s.waitsOver5min).padStart(3)}  >30min=${s.waitsOver30min}  收入${c0.income}→${c1.income}/s (×${(c1.income / Math.max(c0.income, 1)).toFixed(2)})`,
      );
    }
    const first10 = run.events.find((e) => e.waitSec > 600);
    const first30 = run.events.find((e) => e.waitSec > 1800);
    console.log(`  首次间隔>10min: ${first30 ? "" : ""}${first10 ? first10.tMin.toFixed(0) + "min" : "48h内无"}；>30min: ${first30 ? first30.tMin.toFixed(0) + "min" : "48h内无"}`);
    const waits = run.events.slice(1).map((e) => e.waitSec);
    console.log(`  全程等待分位: p50=${quantile(waits, 0.5).toFixed(0)}s p90=${quantile(waits, 0.9).toFixed(0)}s p99=${quantile(waits, 0.99).toFixed(0)}s  总购买=${run.purchases}`);
    const lv = run.endState.levels;
    console.log("  终局等级与下一级边际成本(价格/每单位):");
    for (const u of UPGRADES) {
      const l = lv[u.id] ?? 0;
      const price = costOf(u.id, l);
      const unit = u.clickPower ?? u.idleRate!;
      console.log(`    ${u.name}(lv${l}): ${Math.round(price)} / +${unit}${u.clickPower ? "点击力" : "/s"} → ${Math.round(price / unit)}${u.clickPower ? "/点击力" : "/每1s"}`);
    }
  });
});
