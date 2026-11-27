/**
 * R7 硬核放置玩家 · 转生（prestige）系统设计验证
 *
 * 必做验证 3：对比业界核心循环后，指出本作最缺的 1 个系统并给数值设计。
 * 用本作实测收入曲线 T(X)（累计收入达到 X 所需的在线小时数）验证设计：
 *   转生点 P_run = floor(2√(X_run / 1e8))，每点永久 ×1.08（复利），
 *   玩家节奏「每局 ≤3h 就转生」，输出回环表与到终档 3.2e11 的预期时长。
 *
 * 运行：npx vitest run --config playtest/vitest.r7-hard.config.ts
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { DEFAULT_HARD_CFG, formatMoyu, makeInverse, runSim, type HardConfig } from "./probe-r7-hard-lib";

const OUT = new URL("./r7-hard-prestige.json", import.meta.url).pathname;
const TERMINAL = 3.2e11;

function base(over: Partial<HardConfig>): HardConfig {
  return { ...DEFAULT_HARD_CFG, ...over };
}

const TARGETS = [1e8, 1e9, 2.5e9, 1e10, 2e10, 4e10, 8e10, 1.6e11];

interface CadenceDesign {
  /** P_run = floor(k × (X/unlock)^e) */
  e: number;
  k: number;
  unlock: number;
  /** 每点永久加成：mul=复利 ×(1+bonus)^P；add=加法 1+bonus×P */
  bonus: number;
  mode: "mul" | "add";
  /** 每局时长上限（小时） */
  capHours: number;
}

interface LoopRow {
  run: number;
  target: number;
  runHours: number;
  pointsGained: number;
  pointsTotal: number;
  mult: number;
  cumHours: number;
}

/** 按「每局 ≤ capHours」节奏模拟转生回环 */
function simulateCadence(inverse: (x: number) => number | null, d: CadenceDesign, maxRuns = 80): { rows: LoopRow[]; totalHours: number; done: boolean; finalMult: number } {
  const rows: LoopRow[] = [];
  let p = 0;
  let cum = 0;
  let done = false;
  const tTerm = inverse(TERMINAL) ?? Infinity;
  for (let run = 1; run <= maxRuns; run++) {
    const m = d.mode === "mul" ? Math.pow(1 + d.bonus, p) : 1 + d.bonus * p;
    const terminalHours = tTerm / m;
    if (terminalHours <= d.capHours) {
      cum += terminalHours;
      rows.push({ run, target: TERMINAL, runHours: terminalHours, pointsGained: 0, pointsTotal: p, mult: m, cumHours: cum });
      done = true;
      break;
    }
    let target = -1;
    let runHours = 0;
    for (const x of TARGETS) {
      const t = inverse(x);
      if (t === null) continue;
      const h = t / m;
      if (h <= d.capHours && x > target) {
        target = x;
        runHours = h;
      }
    }
    if (target < 0) break; // 连最低档都超 cap：设计失效
    const gained = Math.floor(d.k * Math.pow(target / d.unlock, d.e));
    if (gained <= 0) break;
    p += gained;
    cum += runHours;
    rows.push({ run, target, runHours, pointsGained: gained, pointsTotal: p, mult: d.mode === "mul" ? Math.pow(1 + d.bonus, p) : 1 + d.bonus * p, cumHours: cum });
  }
  return { rows, totalHours: cum, done, finalMult: d.mode === "mul" ? Math.pow(1 + d.bonus, p) : 1 + d.bonus * p };
}

describe("R7 硬核 · 转生系统数值设计验证", () => {
  it("基准曲线 T(X)：长跑 200h 采样（低分辨率，用于设计验证）", () => {
    const sim = runSim(base({ hours: 200, cps: 0, dt: 2, buyInterval: 1, roiRatio: 0.6, approxEventShare: 0.034, doEvents: false, snapshotHours: [1, 6, 24, 72, 200] }));
    console.log("\n### E. 基准曲线 T(X)（dt=2s 长跑 200h，事件按 3.4% 折算；与 0.5s 细粒度基线误差 <2%）");
    for (const s of sim.snapshots) console.log(`  ${String(s.hours).padStart(4)}h 累计 ${formatMoyu(s.totalEarned).padStart(10)} 挂机 ${formatMoyu(s.idleRate)}/s 段位 ${s.rankName}`);
    const inv = makeInverse(sim.samples);
    console.log("\n反推阈值时长（转生设计用）：");
    for (const x of [1e8, 1e9, 2.5e9, 1e10, 2e10, 4e10, 8e10, 1.6e11, TERMINAL]) {
      const t = inv(x);
      console.log(`  ${formatMoyu(x).padStart(10)} → ${t === null ? "200h 内未达" : t.toFixed(2) + "h"}`);
    }
    expect(inv(1e8)).not.toBeNull();
    writeFileSync(OUT.replace(".json", "-curve.json"), JSON.stringify({ snapshots: sim.snapshots }, null, 2));
  });

  it("设计参数扫描：转生点公式 × 每点加成 × 每局时长上限 → 到终档总时长", () => {
    const sim = runSim(base({ hours: 200, cps: 0, dt: 2, buyInterval: 1, roiRatio: 0.6, approxEventShare: 0.034, doEvents: false }));
    const inv = makeInverse(sim.samples);
    const designs: CadenceDesign[] = [
      { e: 0.3, k: 2, unlock: 1e8, bonus: 0.1, mode: "add", capHours: 3 },
      { e: 0.4, k: 2, unlock: 1e8, bonus: 0.05, mode: "add", capHours: 3 },
      { e: 0.4, k: 3, unlock: 1e8, bonus: 0.05, mode: "add", capHours: 3 },
      { e: 0.5, k: 2, unlock: 1e8, bonus: 0.05, mode: "add", capHours: 3 },
      { e: 0.5, k: 2, unlock: 1e8, bonus: 0.08, mode: "mul", capHours: 3 },
      { e: 0.4, k: 2, unlock: 1e8, bonus: 0.08, mode: "mul", capHours: 3 },
      { e: 0.4, k: 2, unlock: 1e8, bonus: 0.1, mode: "mul", capHours: 3 },
    ];
    console.log("\n### F. 转生设计扫描（P_run = floor(k×(X/1e8)^e)，每局 ≤cap 就转）");
    console.log("| e | k | 模式 | 每点加成 | 每局上限 | 首转 | 回环数 | 总主动时长 | 终档倍率 | 折日常天数(2×1.5h/天) |");
    console.log("|---|---|---|---|---|---|---|---|---|---|");
    const rows: Record<string, unknown>[] = [];
    for (const d of designs) {
      const r = simulateCadence(inv, d);
      if (!r.rows.length) continue;
      const first = r.rows[0]!;
      console.log(
        `| ${d.e} | ${d.k} | ${d.mode} | ${d.mode === "mul" ? "×(1+" + d.bonus + ")" : "+" + d.bonus * 100 + "%"} | ${d.capHours}h | ${formatMoyu(first.target)}@${first.runHours.toFixed(2)}h | ${r.rows.length} | ${r.totalHours.toFixed(1)}h | ×${r.finalMult.toFixed(1)} | ${(r.totalHours / 3).toFixed(1)} 天 |`,
      );
      rows.push({ ...d, runs: r.rows.length, totalHours: r.totalHours, finalMult: r.finalMult });
    }
    writeFileSync(OUT, JSON.stringify(rows, null, 2));
    expect(rows.length).toBeGreaterThan(2);
  });

  it("推荐设计明细：逐次回环表（含预期时长）", () => {
    const sim = runSim(base({ hours: 200, cps: 0, dt: 2, buyInterval: 1, roiRatio: 0.6, approxEventShare: 0.034, doEvents: false }));
    const inv = makeInverse(sim.samples);
    const d: CadenceDesign = { e: 0.4, k: 2, unlock: 1e8, bonus: 0.08, mode: "mul", capHours: 3 };
    const r = simulateCadence(inv, d, 60);
    console.log("\n### G. 推荐设计逐次回环：P_run = floor(2×(X/1e8)^0.4)，每点永久 ×1.08（复利），每局 ≤3h 就转");
    console.log("| 第几转 | 本局目标 | 本局时长 | 本局点数 | 累计点 | 永久倍率 | 累计主动时长 |");
    console.log("|---|---|---|---|---|---|---|");
    for (const row of r.rows) {
      console.log(
        `| ${row.run} | ${formatMoyu(row.target)} | ${row.runHours.toFixed(2)}h | +${row.pointsGained} | ${row.pointsTotal} | ×${row.mult.toFixed(2)} | ${row.cumHours.toFixed(1)}h |`,
      );
    }
    console.log(`\n首转：X=1e8（${inv(1e8)?.toFixed(2)}h）→ +2 点 → ×1.17`);
    console.log(`到终档 3.2e11：共 ${r.rows.length} 局、累计主动操作 ${r.totalHours.toFixed(1)}h；按每天 2 次×1.5h ≈ ${(r.totalHours / 3).toFixed(1)} 天`);
    console.log(`对照：无转生（同一硬核最优口径）需连续在线 152h，且第 6.3 天后收入环比恒为 1.00×（纯刷无回环）`);
    expect(r.done).toBe(true);
    expect(r.rows.length).toBeGreaterThan(2);
    expect(r.totalHours).toBeLessThan(40);
  });
});
