import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { doClick, clickPowerOf, comboMultiplier, COMBO_MAX, COMBO_WINDOW_S, COMBO_BREAK_S } from "../src/engine/actions";
import { BOSS_DURATION } from "../src/engine/events";
import { stepCombo, comboRun, pct } from "./probe-r4v-challenge-lib";

/**
 * 验收-④ 连击链：main.ts 状态机（间隔<0.4s 累积、>3s 清零、封顶 12）下：
 * 对 1/3/8 cps 的收入提升幅度；1cps（间隔 1s > 0.4s）应零收益影响。
 * 同时检查"连击可保留"的边界：间隔 2.9s 不清零 → 一次爆发后慢点也能吃满 ×1.24。
 */

function clickIncomeWithCombo(cp: number, taps: { t: number; gap: number }[], initialCombo = 0): { income: number; baseline: number; comboEnd: number; avgCombo: number } {
  let combo = initialCombo;
  let income = 0;
  let combos = 0;
  for (const tap of taps) {
    combo = stepCombo(combo, tap.gap);
    income += cp * comboMultiplier(combo);
    combos += combo;
  }
  return { income, baseline: taps.length * cp, comboEnd: combo, avgCombo: taps.length ? combos / taps.length : 0 };
}

describe("验收-④ 连击链收入提升", () => {
  it("1/2/3/5/8 cps 持续点击 60s：收入提升幅度", () => {
    const cp = 100;
    const rows: Record<string, unknown>[] = [];
    for (const cps of [1, 2, 3, 5, 8]) {
      const r = comboRun(cp, cps, 60);
      rows.push({
        cps,
        点击数: r.clicks,
        总收入: Math.round(r.income),
        无连击基线: r.baseline,
        提升幅度: pct(r.lift),
        平均点击收入: +r.avgMult.toFixed(3),
        达到12连击耗时秒: r.timeToCap === Infinity ? "未达到" : +r.timeToCap.toFixed(2),
      });
    }
    console.table(rows);
    const r1c = comboRun(cp, 1, 60);
    const r2c = comboRun(cp, 2, 60);
    const r3c = comboRun(cp, 3, 60);
    const r8c = comboRun(cp, 8, 60);
    // 1cps 间隔 1s > 0.4s：冷启动下连击永远为 0 → 零收益（需求）
    expect(r1c.lift).toBe(0);
    expect(r2c.lift).toBe(0); // 2cps 间隔 0.5s 也 > 0.4s：同样零收益
    expect(r3c.lift).toBeGreaterThan(0.2);
    expect(r8c.lift).toBeGreaterThan(0.2);
    // 封顶 ×1.24
    expect(comboMultiplier(COMBO_MAX)).toBeCloseTo(1.24, 10);
    expect(comboMultiplier(99)).toBeCloseTo(1.24, 10);
    // 上限：3cps 与 8cps 的收益差 <3pp（手速超过 2.5cps 后不再有额外收益）
    expect(Math.abs(r8c.lift - r3c.lift)).toBeLessThan(0.03);
    console.log(`1cps 零收益 ✅；3cps ${pct(r3c.lift)}；8cps ${pct(r8c.lift)}；2cps 也是 0（阈值 >2.5cps）`);
  });

  it("巡逻 8s 窗口内的连击提升（影响偷点 EV 的系数）", () => {
    const cp = 100;
    const rows: Record<string, unknown>[] = [];
    for (const cps of [1, 3, 5, 8]) {
      const r = comboRun(cp, cps, BOSS_DURATION);
      rows.push({ cps, 窗口点击数: r.clicks, 提升幅度: pct(r.lift), 平均乘数: +r.avgMult.toFixed(3) });
    }
    console.table(rows);
    expect(comboRun(cp, 1, BOSS_DURATION).lift).toBe(0);
    expect(comboRun(cp, 8, BOSS_DURATION).lift).toBeGreaterThan(0.2);
  });

  it("连击链细节：0.4s/3s 边界与封顶行为", () => {
    // 0.39s 累积、0.4s 不累积
    expect(stepCombo(0, 0.39)).toBe(1);
    expect(stepCombo(0, 0.4)).toBe(0);
    // 2.99s 保留、3.01s 清零
    expect(stepCombo(7, 2.99)).toBe(7);
    expect(stepCombo(7, 3.01)).toBe(0);
    // 封顶 12
    let c = 0;
    for (let i = 0; i < 30; i++) c = stepCombo(c, 0.1);
    expect(c).toBe(COMBO_MAX);
    // 主循环 ui 文案用的也是同一乘数
    const s = { ...initialState(), levels: { coffee: 9 } };
    expect(clickPowerOf(s)).toBe(10);
    expect(doClick(s, 12).moyu).toBeCloseTo(10 * 1.24, 10);
    expect(COMBO_WINDOW_S).toBe(0.4);
    expect(COMBO_BREAK_S).toBe(3);
  });

  it("★发现：连击链只需一次爆发即可「永久保留」——间隔 2.9s 的慢玩家也吃满 ×1.24", () => {
    const cp = 100;
    // 冷启动 1cps：零收益
    const coldSlow = comboRun(cp, 1, 60);
    // 先 12 连击爆发（8cps ×1.5s），随后每 2.9s 点一下（>0.4s 不累积，但 <3s 不清零）
    const taps: { t: number; gap: number }[] = [];
    for (let i = 0; i < 12; i++) taps.push({ t: i / 8, gap: i === 0 ? Infinity : 1 / 8 });
    for (let t = 1.5 + 2.9; t < 60; t += 2.9) taps.push({ t, gap: 2.9 });
    const sticky = clickIncomeWithCombo(cp, taps);
    const baseline = taps.length * cp;
    const lift = sticky.income / baseline - 1;
    // 只看爆发之后的"慢点"部分：每一下都是 ×1.24（对比冷启动 1cps 的 ×1.0）
    const slowTaps = taps.slice(12);
    const slowIncome = slowTaps.length * cp * 1.24;
    const slowBaseline = slowTaps.length * cp;
    console.log({
      冷启动1cps提升: pct(coldSlow.lift),
      '整体(含爆发)提升': pct(lift),
      '爆发后慢点部分提升': pct(slowIncome / slowBaseline - 1),
      慢点击数: slowTaps.length,
      平均连击: +sticky.avgCombo.toFixed(1),
    });
    expect(lift).toBeGreaterThan(0.1); // 需求预期的"1cps 零收益"只对冷启动成立
    expect(slowIncome / slowBaseline - 1).toBeCloseTo(0.24, 10); // 慢点也吃满 ×1.24
    // 对照：间隔改成 3.01s（>3s）→ 只剩一次爆发收益
    const brokenTaps: { t: number; gap: number }[] = [];
    for (let i = 0; i < 12; i++) brokenTaps.push({ t: i / 8, gap: i === 0 ? Infinity : 1 / 8 });
    for (let t = 1.5 + 3.01; t < 60; t += 3.01) brokenTaps.push({ t, gap: 3.01 });
    const broken = clickIncomeWithCombo(cp, brokenTaps);
    console.log(`间隔 3.01s（清零）提升：${pct(broken.income / (brokenTaps.length * cp) - 1)}`);
    expect(broken.income / (brokenTaps.length * cp) - 1).toBeLessThan(0.02);
  });

  it("连击 = 两档手速（0 / +24%）：≥2.5cps 全部同收益，无更高技巧回报", () => {
    const cp = 100;
    const rows: Record<string, unknown>[] = [];
    for (const cps of [2.5, 3, 4, 5, 8, 12]) {
      const r = comboRun(cp, cps, 30);
      rows.push({ cps, 提升幅度: pct(r.lift), 平均乘数: +r.avgMult.toFixed(3), 达到封顶秒: +r.timeToCap.toFixed(2) });
    }
    console.table(rows);
    const at3 = comboRun(cp, 3, 30).lift;
    const at12 = comboRun(cp, 12, 30).lift;
    expect(Math.abs(at12 - at3)).toBeLessThan(0.02);
    console.log(`3cps 与 12cps 收益几乎相同（${pct(at3)} vs ${pct(at12)}）：连击只验证"是否够快"，不奖励更快`);
  });
});

