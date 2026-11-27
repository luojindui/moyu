import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import {
  NURTURE_PERSONAS,
  runNurture,
  flavorDiscoveryTimeline,
  progressDensity,
  RANKS,
  FLAVOR_TOTAL,
  type NurtureRunResult,
} from "./probe-r3-nurture-lib";

/**
 * 养成党探针 ①段位达成时长 ②彩蛋解锁节奏 ④进度条可见成长密度。
 * 画像语义与 simulate.test.ts 完全一致（同种子 LCG），额外追踪 totalEarned。
 * 24h 游戏时长 = 连续游玩假设；多日仪式感模型见 probe-r3-nurture-daily.test.ts。
 */
const MINUTES = 24 * 60; // 24h
const runs: Record<string, NurtureRunResult> = {};

describe("养成党：段位 / 彩蛋 / 进度条密度（24h 连续游玩）", () => {
  it("四画像 24h：段位跨越时刻", { timeout: 240_000 }, () => {
    for (const p of NURTURE_PERSONAS) {
      runs[p.name] = runNurture(p, { minutes: MINUTES, sampleEverySec: 5 });
    }

    const lines: string[] = [];
    for (const [name, r] of Object.entries(runs)) {
      const cross = r.rankCrossings.map((c) => ({
        rank: c.name,
        threshold: c.at,
        hour: c.tSec === null ? null : +(c.tSec / 3600).toFixed(2),
      }));
      lines.push({ persona: name, crossings: cross, endTotalEarned: Math.round(r.endTotalEarned) });
      console.log(
        `\n[${name}] 24h totalEarned=${(r.endTotalEarned / 1e4).toFixed(1)}万`,
      );
      for (const c of cross) {
        console.log(
          `  ${c.rank} @${c.at >= 1e6 ? (c.at / 1e6).toFixed(0) + "e6" : c.at >= 1e4 ? c.at / 1e4 + "e4" : c.at} → ${
            c.hour === null ? "24h 未达成" : `${c.hour}h`
          }`,
        );
      }
    }
    writeFileSync("playtest/r3-nurture-ranks.json", JSON.stringify(lines, null, 2));

    // 事实断言：段位体系只有 5 档、4 次跨越
    expect(RANKS.length).toBe(7); // R4 扩充（nurture #3）：1e9 / 2.5e9 两档
    expect(RANKS.map((r) => r.at)).toEqual([0, 1e4, 1e5, 1e6, 1e8, 1e9, 2.5e9]); // R4 扩充 7 档
    const clicker = runs["clicker(狂点党)"]!;
    expect(clicker.endTotalEarned).toBeGreaterThan(1e6);
  });

  it("彩蛋 45 条解锁节奏：各画像何时见完", { timeout: 60_000 }, () => {
    for (const [name, r] of Object.entries(runs)) {
      const tl = flavorDiscoveryTimeline(r.flavorUnlocks);
      const done = tl.find((e) => e.seen === FLAVOR_TOTAL);
      const byItem: Record<string, number> = {};
      for (const u of r.flavorUnlocks) {
        byItem[u.id] = Math.max(byItem[u.id] ?? 0, u.tier);
      }
      console.log(`\n[${name}] 彩蛋 ${r.flavorSeenCount}/${FLAVOR_TOTAL} 条（24h 内）`);
      for (const [id, tier] of Object.entries(byItem)) {
        console.log(`  ${id}: 最高档 Lv.${tier}（已见 ${tier >= 50 ? 5 : tier >= 20 ? 4 : tier >= 10 ? 3 : tier >= 5 ? 2 : 1}/5 条）`);
      }
      console.log(`  见完时刻: ${done ? (done.tMin / 60).toFixed(2) + "h" : "24h 内未集齐"}`);
      expect(r.flavorSeenCount).toBeLessThanOrEqual(FLAVOR_TOTAL);
    }
    // sanity：Lv.50 档是最后一条，必须所有 9 项都到 50 才见完
    expect(FLAVOR_TOTAL).toBe(45);
  });

  it("进度条密度：每 5 分钟档内进度走多少", { timeout: 60_000 }, () => {
    const out: Record<string, unknown> = {};
    for (const [name, r] of Object.entries(runs)) {
      const dens = progressDensity(r.samples, 300);
      out[name] = dens;
      console.log(`\n[${name}] 段位进度条 5min 增量（档内百分比）：`);
      for (const [k, v] of Object.entries(dens)) {
        const seg = v as { tier: string; windows: number; median5min: number; p10_5min: number; firstMin: number; lastMin: number };
        const fillMin = seg.median5min > 0 ? +(100 / seg.median5min * 5).toFixed(1) : Infinity;
        console.log(
          `  ${k}: 档内中位 +${seg.median5min}%/5min（p10 ${seg.p10_5min}%），按此速率填满本档需 ${fillMin === Infinity ? "∞" : fillMin + "min"}，观测区间 ${seg.firstMin}-${seg.lastMin}min`,
        );
      }
    }
    writeFileSync("playtest/r3-nurture-progress.json", JSON.stringify(out, null, 2));
    expect(Object.keys(runs).length).toBe(4);
  });
});
