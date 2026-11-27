import { describe, it, expect } from "vitest";
import { newSim, hudLine, affordableCount, tap, step, buyBest, DT, rankText } from "./probe-final-casual-lib";
import { advance } from "../src/engine/tick";
import { initialState } from "../src/engine/state";
import { effectOf, costOf, UPGRADES } from "../src/engine/upgrades";
import { rankFor } from "../src/engine/titles";
import { formatMoyu } from "../src/engine/format";

/**
 * 终验① 新手前 60 秒 / 前 3 分钟：从 0 开始，按 1/2/3 次点击每秒模拟。
 * 事件窗口：巡逻 90-150s、丢梗 45-75s → 前 30 秒是纯"点击→攒钱→买卡"循环，不含随机事件，
 * 因此 30 秒内的理解成本完全由 UI/首购反馈承担。
 * 购买节奏：每 3 秒瞄一眼商店（新手边点边看），买得起就买（优先没见过的卡，否则最便宜）。
 * 另附 1/5/10 秒购买节奏的敏感度，说明首购时间与购买次数的区间而不是单点值。
 */

const CPS = [1, 2, 3];
const CADENCE = 3;

interface Run {
  sim: ReturnType<typeof newSim>;
  firstBuyAt: number | null;
  hudAt: Record<number, string>;
}

function play(seconds: number, cps: number, cadence = CADENCE): Run {
  const sim = newSim(20261127);
  let credited = 0;
  let nextBuyAt = 0;
  let firstBuyAt: number | null = null;
  const hudAt: Record<number, string> = {};
  const checkpoints = [0, 10, 20, 30, 60, 120, 180];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    credited += cps * DT;
    while (credited >= 1) {
      tap(sim);
      credited -= 1;
    }
    step(sim, DT);
    if (t + DT >= nextBuyAt) {
      nextBuyAt += cadence;
      const before = sim.purchases.length;
      buyBest(sim, "new");
      if (sim.purchases.length > before && firstBuyAt === null) firstBuyAt = +(t + DT).toFixed(1);
    }
    for (const cp of checkpoints) {
      if (Math.abs(t + DT - cp) < 1e-6 || (cp === 0 && i === 0)) hudAt[cp] = hudLine(sim.state);
    }
  }
  return { sim, firstBuyAt, hudAt };
}

const summary: Record<number, { first: number | null; buys60: number; buys180: number; levels: number; rank: string; total: string; hud30: string; hud180: string }> = {};

describe("终验①：新手前 60 秒（真实引擎主循环）", () => {
  for (const cps of CPS) {
    it(`${cps} 次/秒：首购 / HUD 轨迹`, () => {
      const r = play(60, cps);
      console.log(`\n== ${cps} cps · 0-60s（每 ${CADENCE}s 看一次商店）==`);
      for (const cp of [0, 10, 20, 30, 60]) console.log(`  ${String(cp).padStart(3)}s  ${r.hudAt[cp]}`);
      console.log(`  首购 ${r.firstBuyAt ?? "未买"}s；60s 购买 ${r.sim.purchases.length} 次：${r.sim.purchases.map((b) => `${b.t.toFixed(0)}s ${b.name}`).join(" → ")}`);
      console.log(`  60s 末可买 ${affordableCount(r.sim.state)}/9 项，已解锁 ${Object.keys(r.sim.state.levels).length}/9`);
      expect(r.firstBuyAt).not.toBeNull();
      expect(r.firstBuyAt!).toBeLessThan(30);
      expect(r.sim.purchases.length).toBeGreaterThanOrEqual(1);
    });

    it(`${cps} 次/秒：前 3 分钟购买次数`, () => {
      const r = play(180, cps);
      const s = r.sim.state;
      console.log(`\n== ${cps} cps · 0-180s ==`);
      console.log(`  30s  ${r.hudAt[30]}`);
      console.log(`  60s  ${r.hudAt[60]}`);
      console.log(`  120s ${r.hudAt[120]}`);
      console.log(`  180s ${r.hudAt[180]}`);
      console.log(`  购买 ${r.sim.purchases.length} 次；已解锁 ${Object.keys(s.levels).length}/9；段位 ${rankFor(s.totalEarned).current}`);
      console.log(`  随机事件：丢梗命中 ${r.sim.memeHits} 次、巡逻 ${r.sim.patrols} 次、安然奖励 ${formatMoyu(r.sim.patrolReward)}`);
      expect(r.sim.purchases.length).toBeGreaterThan(0);
      summary[cps] = {
        first: r.firstBuyAt,
        buys60: 0,
        buys180: r.sim.purchases.length,
        levels: Object.keys(s.levels).length,
        rank: rankFor(s.totalEarned).current,
        total: formatMoyu(s.totalEarned),
        hud30: r.hudAt[30] ?? "",
        hud180: r.hudAt[180] ?? "",
      };
    });
  }

  it("汇总 + 购买节奏敏感度", () => {
    for (const cps of CPS) summary[cps]!.buys60 = play(60, cps).sim.purchases.length;
    console.log("\n===== 新手 3 分钟总览（节奏 3s/次）=====");
    for (const cps of CPS) {
      const d = summary[cps]!;
      console.log(`  ${cps}cps: 首购 ${d.first}s｜60s 买 ${d.buys60} 次｜180s 买 ${d.buys180} 次｜解锁 ${d.levels}/9｜段位 ${d.rank}｜累计 ${d.total}`);
    }
    const worst = Math.max(...CPS.map((c) => summary[c]!.first ?? Infinity));
    console.log(`  最慢首购 ${worst}s → 「30 秒内知道该干什么」${worst < 30 ? "成立 ✅" : "不成立 ❌"}`);
    console.log("\n===== 购买节奏敏感度（180s 购买次数 / 首购时间）=====");
    for (const cps of CPS) {
      const row = [1, 3, 5, 10].map((cad) => {
        const r = play(180, cps, cad);
        return `${cad}s→${r.sim.purchases.length}次/首购${r.firstBuyAt}s`;
      });
      console.log(`  ${cps}cps: ${row.join("｜")}`);
    }
    expect(worst).toBeLessThan(30);
  });

  it("零操作基线：不点击也有底薪，但会卡在首卡之前", () => {
    const s30 = advance(initialState(), 30);
    const s60 = advance(s30, 30);
    const allLocked = UPGRADES.every((u) => s60.moyu < costOf(u.id, 0));
    console.log(`\n== 完全不点击 ==\n  30s 摸鱼值 ${formatMoyu(s30.moyu)}（挂机 ${formatMoyu(effectOf(s30).idleRate)}/秒）\n  60s 摸鱼值 ${formatMoyu(s60.moyu)}，最便宜升级 ${costOf("coffee", 0)} 仍买不起=${allLocked}\n  段位：${rankText(s60)}`);
    expect(s30.moyu).toBeCloseTo(6, 5);
    expect(allLocked).toBe(true);
  });
});
