import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { initialState, gain } from "../src/engine/state";
import { doClick, buyUpgrade } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { UPGRADES, costOf, valueScoreOf, milestoneGap, marginalEffect } from "../src/engine/upgrades";
import { newEventState, scheduleEvents, onMemeTap, bossSurviveReward } from "../src/engine/events";

/**
 * 探针 R3-variety #3：升级决策空间（策略层算不算玩法）
 * - 每 5s 采样：可买项数分布（>1 的时刻占比）
 * - 星标（性价比第一）易主频率：挂机向/点击向 argmax 切换次数
 * - Top3 集合变化频率（排序 churn）
 * - 里程碑等待张力：跳变级的性价比倍数（等 vs 现在买的收益差）
 * - 三种购买策略 30min 终态差（策略选择是否重要）
 */

const DT = 0.25;
const MINUTES = 30;

function mkRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Pick = "cheapest" | "dearest" | "value";

function runStrategy(pick: Pick, seed: number) {
  let state = initialState();
  const es = newEventState();
  const rng = mkRng(seed);
  const samples: {
    t: number; affordable: number; bestIdle: string; bestClick: string; top3Idle: string[];
  }[] = [];
  let lastBuyAt = -1e9;
  let tapCredit = 0;
  let prevBoss = false;
  let prevMeme = false;

  const rankIdle = (s = state) => [...UPGRADES].filter((u) => u.idleRate)
    .map((u) => ({ id: u.id, v: valueScoreOf(u.id, s.levels[u.id] ?? 0).idle }))
    .sort((a, b) => b.v - a.v);
  const rankClick = (s = state) => [...UPGRADES].filter((u) => u.clickPower)
    .map((u) => ({ id: u.id, v: valueScoreOf(u.id, s.levels[u.id] ?? 0).click }))
    .sort((a, b) => b.v - a.v);

  for (let t = 0; t <= MINUTES * 60; t += DT) {
    scheduleEvents(es, t, rng);
    const bossActive = es.bossUntil > t;
    tapCredit += (bossActive ? 0 : 2) * DT; // 多玩法党：2 cps
    while (tapCredit >= 1) { tapCredit -= 1; state = doClick(state); }
    const memeActive = es.memeUntil > t;
    if (memeActive && !prevMeme) { const r = onMemeTap(state, es); state = r.state; }
    prevMeme = memeActive;
    if (prevBoss && !bossActive && !es.bossCaught) state = gain(state, bossSurviveReward(state, es));
    prevBoss = bossActive;
    state = advance(state, DT);

    if (t - lastBuyAt >= 10) {
      const affordable = UPGRADES.filter((u) => state.moyu >= costOf(u.id, state.levels[u.id] ?? 0));
      if (affordable.length > 0) {
        let target: string;
        if (pick === "cheapest") {
          target = affordable.sort((a, c) => costOf(a.id, state.levels[a.id] ?? 0) - costOf(c.id, state.levels[c.id] ?? 0))[0].id;
        } else if (pick === "dearest") {
          target = affordable.sort((a, c) => costOf(c.id, state.levels[c.id] ?? 0) - costOf(a.id, state.levels[a.id] ?? 0))[0].id;
        } else {
          target = affordable.map((u) => {
            const sc = valueScoreOf(u.id, state.levels[u.id] ?? 0);
            return { id: u.id, v: Math.max(sc.idle, sc.click * 0.5) };
          }).sort((a, c) => c.v - a.v)[0].id;
        }
        const next = buyUpgrade(state, target);
        if (next) { state = next; lastBuyAt = t; }
      }
    }

    // 决策采样：每 5s
    if (Math.abs(t % 5) < DT / 2) {
      const ri = rankIdle();
      const rc = rankClick();
      samples.push({
        t: +t.toFixed(1),
        affordable: UPGRADES.filter((u) => state.moyu >= costOf(u.id, state.levels[u.id] ?? 0)).length,
        bestIdle: ri[0].id,
        bestClick: rc[0].id,
        top3Idle: ri.slice(0, 3).map((x) => x.id),
      });
    }
  }
  return { state, samples };
}

describe("R3 variety #3 升级决策空间", () => {
  it("决策采样 + 星标易主 + 策略对比", () => {
    const { state, samples } = runStrategy("value", 12345);

    // 星标易主
    let idleSwitches = 0;
    let clickSwitches = 0;
    let top3Changes = 0;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].bestIdle !== samples[i - 1].bestIdle) idleSwitches++;
      if (samples[i].bestClick !== samples[i - 1].bestClick) clickSwitches++;
      const prev = samples[i - 1].top3Idle;
      const cur = samples[i].top3Idle;
      if (prev.some((x) => !cur.includes(x))) top3Changes++;
    }
    const per10min = (n: number) => +(n / (MINUTES / 10)).toFixed(1);

    // 可买项数分布
    const affBuckets = [0, 1, 2, 3, 4, "5+"].map((k) => ({ k: String(k), pct: 0 })) as { k: string; pct: number }[];
    samples.forEach((s) => {
      const idx = s.affordable >= 5 ? 5 : s.affordable;
      affBuckets[idx].pct++;
    });
    affBuckets.forEach((b) => (b.pct = +((b.pct / samples.length) * 100).toFixed(1)));
    const gt1 = +(samples.filter((s) => s.affordable > 1).length / samples.length * 100).toFixed(1);

    // 星标持有者集中度
    const holders = new Map<string, number>();
    samples.forEach((s) => holders.set(s.bestIdle, (holders.get(s.bestIdle) ?? 0) + 1));

    // 里程碑跳变倍数（静态分析：每项在 milestone-1 级时的边际 vs 前一级）
    const jumps = UPGRADES.map((u) => {
      const lv = 19; // 下一级即跳变（无偏移项近似）
      const normal = marginalEffect(u.id, 0);
      const jump = marginalEffect(u.id, lv);
      const base = (u.clickPower ?? u.idleRate ?? 0);
      return {
        id: u.id,
        normalGain: base,
        jumpGain: u.clickPower ? jump.clickPower : jump.idleRate,
        jumpMultiple: +(base > 0 ? ((u.clickPower ? jump.clickPower : jump.idleRate) / base) : 0).toFixed(1),
        gapFrom0: milestoneGap(u.id, 0),
      };
    });

    // 三策略终态对比
    const strat = (["cheapest", "dearest", "value"] as Pick[]).map((p) => {
      const r = runStrategy(p, 12345);
      return { strategy: p, endTotalEarned: Math.round(r.state.totalEarned), endMoyu: Math.round(r.state.moyu), levels: { ...r.state.levels } };
    });
    const best = Math.max(...strat.map((s) => s.endTotalEarned));
    const worst = Math.min(...strat.map((s) => s.endTotalEarned));
    const strategySpreadPct = +(((best - worst) / worst) * 100).toFixed(1);

    const report = {
      probe: "r3-variety-decisions",
      samples: samples.length,
      affordableGt1Pct: gt1,
      affordableDist: affBuckets,
      starChurn: { idleSwitches, clickSwitches, per10minIdle: per10min(idleSwitches), per10minClick: per10min(clickSwitches), top3Changes, per10minTop3: per10min(top3Changes) },
      starHolders: Object.fromEntries([...holders.entries()].map(([k, v]) => [k, +((v / samples.length) * 100).toFixed(1) + "%"])),
      milestoneJumps: jumps,
      strategyCompare: strat,
      strategySpreadPct,
    };
    writeFileSync("playtest/r3-variety-decisions.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ affordableGt1Pct: gt1, affordableDist: affBuckets, starChurn: report.starChurn, starHolders: report.starHolders, strategySpreadPct, strategyCompare: strat.map(s=>({strategy:s.strategy,endTotalEarned:s.endTotalEarned})) }, null, 1));
    void state;
  });
});
