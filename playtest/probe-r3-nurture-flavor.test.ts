import { describe, it, expect } from "vitest";
import { NURTURE_PERSONAS, runNurture, FLAVOR_TOTAL, FLAVOR_TIERS } from "./probe-r3-nurture-lib";

/**
 * 养成党探针 ②彩蛋解锁节奏细化：45 条文案的发现曲线（20/40/44/45 各在何时），
 * 以及最后一条（retire Lv.50）的真实耗时。48h 连续游玩上界。
 */
describe("养成党：彩蛋 45 条发现曲线（48h）", () => {
  for (const p of NURTURE_PERSONAS.filter((x) => x.name.includes("clicker") || x.name.includes("casual") || x.name.includes("idle"))) {
    it(`${p.name} 48h 发现曲线`, { timeout: 240_000 }, () => {
      const r = runNurture(p, { minutes: 48 * 60, sampleEverySec: 30 });
      const marks = [9, 18, 27, 36, 40, 44, 45];
      const times = r.flavorUnlocks.map((u) => u.tSec).sort((a, b) => a - b);
      console.log(`\n[${p.name}] 48h totalEarned=${(r.endTotalEarned / 1e8).toFixed(2)}e8, 彩蛋 ${r.flavorSeenCount}/${FLAVOR_TOTAL}`);
      for (const m of marks) {
        const t = times[m - 1];
        console.log(`  见到第 ${m}/45 条: ${t === undefined ? "48h 未达成" : (t / 3600).toFixed(2) + "h"}`);
      }
      const retireLv = r.endLevels.retire ?? 0;
      const retire50 = r.flavorUnlocks.find((u) => u.id === "retire" && u.tier === 50);
      console.log(`  retire 终档(Lv.50): ${retire50 ? (retire50.tSec / 3600).toFixed(2) + "h 达成" : `48h 未达成（终级 Lv.${retireLv}）`}`);
      // 事实断言：档位阈值 1/5/10/20/50；48h 内第 45 条（retire Lv.50）三画像均未达成
      expect(FLAVOR_TIERS).toEqual([1, 5, 10, 20, 50]);
      expect(retire50).toBeUndefined();
      expect(r.flavorSeenCount).toBe(44);
    });
  }
});
