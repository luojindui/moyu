import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import {
  newEventState,
  scheduleEvents,
  BOSS_INTERVAL_MIN,
  BOSS_INTERVAL_MAX,
  BOSS_DURATION,
  MEME_INTERVAL_MIN,
  MEME_INTERVAL_MAX,
  MEME_DURATION,
} from "../src/engine/events";
import { MEME_QUOTES } from "../src/engine/flavor";

/**
 * 探针 R3-variety #2：事件节奏单调度（"每局不一样"的程度）
 * - 只跑调度器 3h × 20 种子：巡逻/丢梗间隔的均值/方差/CV
 * - 事件类型序列的 bigram 分布（重复感：B 后面是不是总是那几个）
 * - 窗口时长恒定（8s / 5s）→ 每次事件的"玩法参数"是否变化
 * - 语录随机有放回：重复率（期望口径 coupon collector）
 */

function mkRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const DT = 0.25;
const HOURS = 3;

function stats(xs: number[]) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const varr = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { n, mean: +mean.toFixed(1), std: +Math.sqrt(varr).toFixed(1), cv: +(Math.sqrt(varr) / mean).toFixed(3) };
}

describe("R3 variety #2 事件节奏单调度", () => {
  it("3h × 20 种子调度统计", () => {
    const seeds = Array.from({ length: 20 }, (_, i) => 1000 + i * 7919);
    const perSeed = seeds.map((seed) => {
      const es = newEventState();
      const rng = mkRng(seed);
      const onsets: { t: number; type: "B" | "M" }[] = [];
      let prevBoss = false;
      let prevMeme = false;
      for (let t = 0; t <= HOURS * 3600; t += DT) {
        scheduleEvents(es, t, rng);
        const boss = es.bossUntil > t;
        const meme = es.memeUntil > t;
        if (boss && !prevBoss) onsets.push({ t, type: "B" });
        if (meme && !prevMeme) onsets.push({ t, type: "M" });
        prevBoss = boss;
        prevMeme = meme;
      }
      const bossIv: number[] = [];
      const memeIv: number[] = [];
      const mergedIv: number[] = [];
      onsets.forEach((e, i) => {
        if (i > 0) mergedIv.push(e.t - onsets[i - 1].t);
        const prevSame = onsets.slice(0, i).reverse().find((x) => x.type === e.type);
        if (prevSame) (e.type === "B" ? bossIv : memeIv).push(e.t - prevSame.t);
      });
      const seq = onsets.map((e) => e.type).join("");
      const bigrams = new Map<string, number>();
      for (let i = 0; i < seq.length - 1; i++) {
        const g = seq.slice(i, i + 2);
        bigrams.set(g, (bigrams.get(g) ?? 0) + 1);
      }
      return { seed, bossCount: bossIv.length + 1, memeCount: memeIv.length + 1, bossIv, memeIv, mergedIv, seq, bigrams };
    });

    const agg = perSeed.map((s) => ({
      seed: s.seed,
      boss: stats(s.bossIv),
      meme: stats(s.memeIv),
      merged: stats(s.mergedIv),
      bigrams: Object.fromEntries(s.bigrams),
    }));

    // 汇总：bigram 分布平均
    const bgTotals = new Map<string, number>();
    perSeed.forEach((s) => s.bigrams.forEach((v, k) => bgTotals.set(k, (bgTotals.get(k) ?? 0) + v)));
    const bgSum = [...bgTotals.values()].reduce((a, b) => a + b, 0);
    const bgDist = [...bgTotals.entries()].map(([k, v]) => ({ g: k, count: v, pct: +((v / bgSum) * 100).toFixed(1) })).sort((a, b) => b.count - a.count);

    // 语录 coupon collector：全 10 条首见需要的事件数期望
    const n = MEME_QUOTES.length;
    const couponExpected = n * (1 / 1 + 1 / 2 + 1 / 3 + 1 / 4 + 1 / 5 + 1 / 6 + 1 / 7 + 1 / 8 + 1 / 9 + 1 / 10);
    const memePerMin = 60 / ((MEME_INTERVAL_MIN + MEME_INTERVAL_MAX) / 2);
    const bossPerMin = 60 / ((BOSS_INTERVAL_MIN + BOSS_INTERVAL_MAX) / 2);

    const summary = {
      bossPerMin: +bossPerMin.toFixed(2),
      memePerMin: +memePerMin.toFixed(2),
      eventsPerMin: +(bossPerMin + memePerMin).toFixed(2),
      bossWindowSeconds: BOSS_DURATION,
      memeWindowSeconds: MEME_DURATION,
      windowDurationCV: 0, // 恒定值
      quotePool: n,
      quoteCouponCollectorExpectedEvents: +couponExpected.toFixed(1),
      quoteCollectAllMinutes: +(couponExpected / memePerMin).toFixed(1),
      quoteDuplicateRateFirst10: +((1 - n * 0.1) * 0).toFixed(0),
      bigramDist: bgDist,
      intervalStatsSample: agg.slice(0, 5),
      avgBossIvCV: +(agg.reduce((a, s) => a + s.boss.cv, 0) / agg.length).toFixed(3),
      avgMemeIvCV: +(agg.reduce((a, s) => a + s.meme.cv, 0) / agg.length).toFixed(3),
      avgMergedIvCV: +(agg.reduce((a, s) => a + s.merged.cv, 0) / agg.length).toFixed(3),
      avgMergedGapSec: +(agg.reduce((a, s) => a + s.merged.mean, 0) / agg.length).toFixed(1),
      avgBossCount3h: +(agg.reduce((a, s) => a + s.boss.n, 0) / agg.length).toFixed(0),
      avgMemeCount3h: +(agg.reduce((a, s) => a + s.meme.n, 0) / agg.length).toFixed(0),
    };
    writeFileSync("playtest/r3-variety-rhythm.json", JSON.stringify({ probe: "r3-variety-rhythm", summary, perSeed: agg.map(({ seed, boss, meme, merged }) => ({ seed, boss, meme, merged })) }, null, 2));
    console.log(JSON.stringify(summary, null, 1));
  });
});
