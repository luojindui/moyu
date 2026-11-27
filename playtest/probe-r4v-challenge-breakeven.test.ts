import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { effectOf } from "../src/engine/upgrades";
import {
  newEventState,
  onBossTap,
  BOSS_GRACE_SECONDS,
  BOSS_PENALTY_RATE,
  BOSS_PENALTY_MIN,
  BOSS_PENALTY_CAP_IDLE_SECONDS,
} from "../src/engine/events";
import { loadScenes, stateFrom, decision, flipCps, openHold, r1, pct } from "./probe-r4v-challenge-lib";

/**
 * 验收-② 盈亏线：扫描点击力/挂机率/囤积深度，找"硬刚期望翻正"的条件，
 * 判断是否与设计意图一致（代码注释：盈亏线约在点击力 > 罚款封顶；低点击力自动落忍侧）。
 *
 * 罚款 = min( max(10, 5%×余额), max(10, 10×idleRate), 余额 )，宽限后每巡逻一次。
 * 硬刚−忍 = 8s 点击收入 − 罚款 − 安然奖励(5×idleRate×连胜)。
 * 关键：罚款 ≤ 10×idleRate → 只要 8s 点击收入 > 15×idleRate，硬刚就正期望。
 */

const CP_LIST = [11, 293, 2497, 6401];
const IR_LIST = [0.2, 10.2, 189.2, 9556.2, 40272.2];

describe("验收-② 盈亏线扫描", () => {
  it("罚款公式逐点复核：min(max(10,5%余额), max(10,10×idleRate), 余额)", () => {
    let checked = 0;
    for (const s of loadScenes()) {
      for (const bank of [0, s.moyu, s.moyu * 3]) {
        const st = stateFrom(s.levels, bank);
        const es = newEventState();
        openHold(es, 1000);
        const r = onBossTap(st, es, 1000 + BOSS_GRACE_SECONDS + 0.01, 0);
        const afterIncome = bank + r.income;
        const raw = Math.max(BOSS_PENALTY_MIN, afterIncome * BOSS_PENALTY_RATE);
        const cap = Math.max(BOSS_PENALTY_MIN, BOSS_PENALTY_CAP_IDLE_SECONDS * effectOf(st).idleRate);
        const expectLost = Math.min(raw, cap, afterIncome);
        expect(r.lost).toBeCloseTo(expectLost, 6);
        expect(r.state.moyu).toBeGreaterThanOrEqual(0);
        // 收入先进 totalEarned（罚款不扣累计 → 不倒退段位）
        expect(r.state.totalEarned).toBeCloseTo(bank + r.income, 6);
        checked++;
      }
    }
    console.log(`罚款公式复核：${checked} 个真实场景点全部吻合；罚款 ≤ 余额，累计值不受罚`);
  });

  it("罚款两套机制：余额<200×idleRate 时 5% 生效，否则 10s 挂机封顶", () => {
    const rows: Record<string, unknown>[] = [];
    for (const s of loadScenes().filter((x) => x.minute >= 3)) {
      const st = stateFrom(s.levels, s.moyu);
      const es = newEventState();
      openHold(es, 1000);
      const r = onBossTap(st, es, 1000 + BOSS_GRACE_SECONDS + 0.01, 0);
      const cap = Math.max(10, 10 * s.ir);
      const raw = Math.max(10, 0.05 * (s.moyu + r.income));
      rows.push({
        画像: `${s.persona.split("(")[0]}@${s.minute}min`,
        '余额/挂机秒': Math.round(s.moyu / s.ir),
        'cp/ir': +(s.cp / s.ir).toFixed(2),
        '罚款/挂机秒': +(r.lost / s.ir).toFixed(1),
        '5%理论/挂机秒': +(raw / s.ir).toFixed(1),
        '10s封顶/挂机秒': +(cap / s.ir).toFixed(1),
        生效: raw < cap ? "5%余额" : "10s挂机封顶",
      });
    }
    console.table(rows);
    const capRows = rows.filter((r) => r.生效 === "10s挂机封顶");
    console.log(`罚款被 10×idleRate 封顶：${capRows.length}/${rows.length} 场景（这些场景"囤积惩罚"失效，罚款只剩 ~10s 挂机收入）`);
  });

  it("解析盈亏线：封顶生效时阈值≈1.875×idleRate/点击力；5%生效时随余额上涨", () => {
    const scenes = loadScenes().filter((s) => [3, 10, 60, 180].includes(s.minute));
    const rows: Record<string, unknown>[] = [];
    for (const s of scenes) {
      for (const banked of [0, 200, 2000]) {
        const st = stateFrom(s.levels, banked * s.ir);
        rows.push({
          画像: `${s.persona.split("(")[0]}@${s.minute}min`,
          'cp/ir': +(s.cp / s.ir).toFixed(2),
          '囤积/挂机秒': banked,
          '实测翻正cps': flipCps(st, 0),
          '理论_封顶无连击': +(1.875 * s.ir / s.cp).toFixed(2),
          '理论_封顶含连击': +(1.875 / 1.24 * s.ir / s.cp).toFixed(2),
        });
      }
    }
    console.table(rows);
  });

  it("设计意图核对：注释判据『点击力>罚款封顶』是否成立；慢手是否仍受保护", () => {
    const scenes = loadScenes().filter((s) => [10, 60, 180].includes(s.minute));
    const rows: Record<string, unknown>[] = [];
    for (const s of scenes) {
      const st = stateFrom(s.levels, s.moyu);
      const cap = Math.max(10, 10 * s.ir);
      rows.push({
        画像: `${s.persona.split("(")[0]}@${s.minute}min`,
        点击力: s.cp,
        罚款封顶: Math.round(cap),
        注释判据_点击力大于封顶: s.cp > cap,
        '1cps硬刚−忍': r1(decision(st, 1, 0).delta),
        '3cps硬刚−忍': r1(decision(st, 3, 0).delta),
        '8cps硬刚−忍': r1(decision(st, 8, 0).delta),
      });
    }
    console.table(rows);
    const slowDodge = scenes.map((s) => decision(stateFrom(s.levels, s.moyu), 1, 0));
    // 保护线：慢手(1cps)在重度囤积场景必须仍有忍优空间
    expect(slowDodge.some((d) => d.delta <= 0)).toBe(true);
    console.log(`真实场景 1cps：忍优 ${slowDodge.filter((d) => d.delta <= 0).length}/${slowDodge.length}`);
    const at3 = scenes.map((s) => decision(stateFrom(s.levels, s.moyu), 3, 0));
    console.log(`真实场景 3cps：硬刚优 ${at3.filter((d) => d.delta > 0).length}/${at3.length} (${pct(at3.filter((d) => d.delta > 0).length / at3.length)})`);
    // 注释判据证伪：即便点击力 < 罚款封顶（注释应判"忍"），3cps 下也可能硬刚优
    const falseNeg = scenes.filter((s) => s.cp < Math.max(10, 10 * s.ir) && decision(stateFrom(s.levels, s.moyu), 3, 0).delta > 0);
    console.log(`注释判据(点击力>封顶)误判为"忍优"、但实际 3cps 硬刚优：${falseNeg.length}/${scenes.length}`);
  });

  it("挂机党是否被破坏：不点击=0 损失；习惯性 1cps 点击的挂机党每小时税收", () => {
    const scenes = loadScenes().filter((s) => [10, 30, 60, 120, 180].includes(s.minute));
    const rows: Record<string, unknown>[] = [];
    for (const s of scenes) {
      const st = stateFrom(s.levels, s.moyu);
      const d = decision(st, 1, 0);
      const patrolsPerHour = 28; // 约 128s 一次巡逻
      const hourlyIdle = s.ir * 3600;
      const hourlyPenalty = d.penalty * patrolsPerHour;
      const hourlyRewardLost = d.soft * patrolsPerHour;
      rows.push({
        画像: `${s.persona.split("(")[0]}@${s.minute}min`,
        'idle/秒': +s.ir.toFixed(1),
        '1cps硬刚−忍': r1(d.delta),
        '每小时罚款': Math.round(hourlyPenalty),
        '每小时漏拿奖励': Math.round(hourlyRewardLost),
        '占挂机收入': pct((hourlyPenalty + hourlyRewardLost) / hourlyIdle),
      });
    }
    console.table(rows);
    // 完全不点击的挂机党：机制不触发（onBossTap 不被调用），零损失
    const st = stateFrom({ retire: 1 }, 1e6);
    expect(decision(st, 1, 0).soft).toBeGreaterThan(0);
    console.log("不点击的挂机党：零损失（罚款只在主动点击时触发）；但习惯性点击者每小时税见上表");
  });

  it("危险配比：cp/ir 越大，硬刚门槛越低", () => {
    const scenes = loadScenes().filter((s) => s.minute >= 10);
    const buckets = new Map<string, { hard: number; total: number; flips: number[] }>();
    const bucketOf = (ratio: number): string => (ratio < 0.3 ? "cp/ir<0.3(挂机主导)" : ratio < 1 ? "0.3~1" : ratio < 5 ? "1~5" : ">5(点击主导)");
    for (const s of scenes) {
      const key = bucketOf(s.cp / s.ir);
      const b = buckets.get(key) ?? { hard: 0, total: 0, flips: [] };
      b.total++;
      if (decision(stateFrom(s.levels, s.moyu), 3, 0).delta > 0) b.hard++;
      const f = flipCps(stateFrom(s.levels, s.moyu), 0);
      if (f !== null) b.flips.push(f);
      buckets.set(key, b);
    }
    const rows = [...buckets.entries()].map(([k, v]) => ({
      配比: k,
      '3cps硬刚占优': `${v.hard}/${v.total}`,
      '翻正cps中位数': v.flips.length ? v.flips.sort((a, b) => a - b)[Math.floor(v.flips.length / 2)] : "无",
    }));
    console.table(rows);
    const clickDominated = scenes.filter((s) => s.cp / s.ir >= 1);
    if (clickDominated.length > 0) {
      const hard = clickDominated.filter((s) => decision(stateFrom(s.levels, s.moyu), 3, 0).delta > 0).length;
      console.log(`点击主导(cp/ir≥1) × 3cps：硬刚优 ${hard}/${clickDominated.length}`);
      expect(hard / clickDominated.length).toBeGreaterThan(0.5);
    }
    void CP_LIST;
    void IR_LIST;
  });
});
