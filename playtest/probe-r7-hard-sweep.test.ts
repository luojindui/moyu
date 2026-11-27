/**
 * R7 硬核 · 购买策略扫描（找「最优路线」基线）
 *
 * 硬核放置玩家会自建 optimizer：不是「有闲钱就买」，而是按 ROI 门槛判断
 * 「现在买这个便宜的，还是攒钱等全局最优」。本测试扫 roiRatio 0.4→1.0，
 * 取 24h / 72h 收入最高者为后续所有结论的基线策略。
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_HARD_CFG, formatMoyu, runSim, type HardConfig } from "./probe-r7-hard-lib";

function cfg(over: Partial<HardConfig>): HardConfig {
  return { ...DEFAULT_HARD_CFG, ...over };
}

describe("R7 硬核 · 购买策略扫描", () => {
  it("roiRatio 扫描（cps=0，72h）", () => {
    const ratios = [0.4, 0.6, 0.75, 0.85, 0.9, 0.95, 1.0];
    console.log("\n### 策略扫描：可负担项 ROI ≥ 全局最优 × ratio 才买，否则攒钱");
    console.log("| ratio | 24h 累计收入 | 24h 挂机率 | 72h 累计收入 | 72h 挂机率 | 72h Lv合计 | 攒钱等待次数 |");
    console.log("|---|---|---|---|---|---|---|");
    const rows: { ratio: number; h24: number; h72: number; idle72: number; levels72: number; waits: number }[] = [];
    for (const r of ratios) {
      const sim = runSim(cfg({ hours: 72, cps: 0, dt: 0.5, roiRatio: r, snapshotHours: [24] }));
      const s24 = sim.snapshots.find((s) => Math.abs(s.hours - 24) < 1e-6)!;
      const s72 = sim.snapshots[sim.snapshots.length - 1]!;
      rows.push({ ratio: r, h24: s24.totalEarned, h72: s72.totalEarned, idle72: s72.idleRate, levels72: s72.totalLevels, waits: sim.saveWaits });
      console.log(
        `| ${r} | ${formatMoyu(s24.totalEarned)} | ${formatMoyu(s24.idleRate)}/s | ${formatMoyu(s72.totalEarned)} | ${formatMoyu(s72.idleRate)}/s | ${s72.totalLevels} | ${sim.saveWaits} |`,
      );
    }
    // 基线：72h 最优
    const best = rows.reduce((a, b) => (b.h72 > a.h72 ? b : a));
    console.log(`\n72h 最优 ratio = ${best.ratio}（${formatMoyu(best.h72)}；比「有就买」+${(((best.h72 / rows[0]!.h72) - 1) * 100).toFixed(0)}%）`);
    expect(rows.length).toBe(ratios.length);
  });

  it("roiRatio=0.6 下再扫 maxWait 上限（避免为天价最优项长期裸等）", () => {
    const caps: (number | undefined)[] = [undefined, 300, 900, 1800, 3600, 7200];
    console.log("\n### 攒钱上限扫描（roiRatio=0.6）");
    console.log("| maxWait | 24h 收入 | 72h 收入 | 72h 挂机率 | Lv合计 |");
    console.log("|---|---|---|---|---|");
    const best: { cap: number | undefined; h72: number }[] = [];
    for (const cap of caps) {
      const sim = runSim(cfg({ hours: 72, cps: 0, dt: 0.5, roiRatio: 0.6, maxWaitSeconds: cap, snapshotHours: [24] }));
      const s24 = sim.snapshots.find((s) => Math.abs(s.hours - 24) < 1e-6)!;
      const s72 = sim.snapshots[sim.snapshots.length - 1]!;
      console.log(`| ${cap ?? "∞"} | ${formatMoyu(s24.totalEarned)} | ${formatMoyu(s72.totalEarned)} | ${formatMoyu(s72.idleRate)}/s | ${s72.totalLevels} |`);
      best.push({ cap, h72: s72.totalEarned });
    }
    const b = best.reduce((a, c) => (c.h72 > a.h72 ? c : a));
    console.log(`\n最优 maxWait = ${b.cap ?? "∞"}`);
    expect(best.length).toBe(caps.length);
  });
});
