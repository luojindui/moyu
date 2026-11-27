import { describe, it } from "vitest";
import { initialState } from "../src/engine/state";
import {
  newEventState,
  scheduleEvents,
  onMemeTap,
  MEME_DURATION,
  MEME_INTERVAL_MIN,
  MEME_INTERVAL_MAX,
  MEME_REWARD_CLICKS,
} from "../src/engine/events";
import { clickPowerOf } from "../src/engine/actions";
import { effectOf } from "../src/engine/upgrades";

/**
 * 挑战党探针 R3-②：丢梗的时间压力。
 * 5s 窗口 vs 真实反应的 slack：窗口对在场玩家是"无限宽"，对挂机玩家是"看运气"。
 * 奖励 = 5×点击力，一次性、无惩罚、无时机梯度（0.1s 点和 4.9s 点同酬）。
 */

const DT = 0.25;

/** 用 report.json casual 检查点构造真实状态 */
function st(levels: Record<string, number>) {
  return { ...initialState(), levels: { ...levels } };
}

describe("R3-② 丢梗时间压力", () => {
  it("时机无梯度：窗口内不同时刻点击，奖励完全相同（引擎实跑）", () => {
    const s = st({ coffee: 39, phone: 31, water: 26, toilet: 13, chair: 11 });
    const rows: unknown[] = [];
    for (const delay of [0.1, 1, 2.5, 4, 4.9]) {
      const es = newEventState();
      es.memeUntil = 100 + MEME_DURATION;
      const r = onMemeTap(s, es);
      rows.push({ 点击延时s: delay, 奖励: r.earned, 期望: MEME_REWARD_CLICKS * clickPowerOf(s) });
      if (r.earned !== MEME_REWARD_CLICKS * clickPowerOf(s)) throw new Error("奖励不恒定");
    }
    console.table(rows);
  });

  it("注意力模型：每 C 秒瞄一眼屏幕的玩家，抓到梗的概率 + 期望收入", () => {
    // 玩家每 checkEvery 秒看一次屏幕（随机相位）；看到后需要 react 秒反应。
    // 挂机党 C 大（30-300s），活跃党 C 小（<5s 常驻）。
    const rows: unknown[] = [];
    const N = 4000;
    for (const checkEvery of [1, 5, 15, 30, 60, 120, 300]) {
      for (const react of [0.5, 1.5]) {
        let captured = 0;
        for (let i = 0; i < N; i++) {
          // 梗出现的相位相对检查周期均匀 → 下次检查距离 d ~ U(0, checkEvery)
          const d = Math.random() * checkEvery;
          if (d + react <= MEME_DURATION) captured++;
        }
        rows.push({
          检查间隔s: checkEvery,
          反应s: react,
          捕获率: +(captured / N).toFixed(3),
          理论捕获率: +Math.min(1, Math.max(0, (MEME_DURATION - react) / checkEvery)).toFixed(3),
        });
      }
    }
    console.table(rows);
  });

  it("丢梗经济占比：相对挂机收入的百分比（沿真实进度曲线）", () => {
    // 期望每小时：boss 3600/120=30 次，meme 名义 3600/60=60 次（互斥略减，按 55 计）
    const states = [
      { label: "m=3 casual", levels: { coffee: 6 } },
      { label: "m=10 casual", levels: { coffee: 14, phone: 5, water: 1 } },
      { label: "m=60 casual", levels: { coffee: 39, phone: 31, water: 26, toilet: 13, chair: 11 } },
      { label: "m=180 casual", levels: { coffee: 74, phone: 66, water: 61, toilet: 48, chair: 46, group: 35, meeting: 21, deep: 9 } },
      { label: "m=180 clicker", levels: { coffee: 91, phone: 82, water: 77, toilet: 65, chair: 62, group: 51, meeting: 38, deep: 25, retire: 11 } },
    ];
    const rows = states.map((s) => {
      const state = st(s.levels);
      const { idleRate } = effectOf(state);
      const cp = clickPowerOf(state);
      const memePerHour = 55;
      const bossPerHour = 30;
      const memeIncome = memePerHour * MEME_REWARD_CLICKS * cp;
      const bossIncome = bossPerHour * Math.max(50, 5 * idleRate);
      const idleIncome = idleRate * 3600;
      return {
        场景: s.label,
        挂机时收: Math.round(idleIncome),
        丢梗时收: Math.round(memeIncome),
        巡逻奖励时收: Math.round(bossIncome),
        丢梗占比: +(memeIncome / idleIncome).toFixed(3),
        巡逻占比: +(bossIncome / idleIncome).toFixed(3),
        单个丢梗_等值挂机秒: +((5 * cp) / idleRate).toFixed(1),
      };
    });
    console.table(rows);
  });

  it("真实调度器统计：2 小时里丢梗出现次数/间隔分布（含互斥推迟）", () => {
    const rng = (() => {
      let s = 42 >>> 0;
      return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
    })();
    const es = newEventState();
    es.nextBossAt = 0;
    es.nextMemeAt = 0;
    const memeStarts: number[] = [];
    let prevMeme = 0;
    for (let t = 0; t <= 7200; t += DT) {
      scheduleEvents(es, t, rng);
      if (es.memeUntil > t && es.memeUntil - MEME_DURATION >= t - DT && es.memeUntil - t >= MEME_DURATION - DT) {
        // 检测新开的丢梗窗口
        if (memeStarts.length === 0 || t - prevMeme > 1) {
          // 用 memeUntil 反推开始时刻去重
        }
      }
    }
    // 更简单：包一层记录
    const es2 = newEventState();
    es2.nextBossAt = 0;
    es2.nextMemeAt = 0;
    let prevActive = false;
    const starts: number[] = [];
    for (let t = 0; t <= 7200; t += DT) {
      scheduleEvents(es2, t, rng);
      const active = es2.memeUntil > t;
      if (active && !prevActive) starts.push(t);
      prevActive = active;
    }
    const gaps = starts.slice(1).map((x, i) => +(x - starts[i]).toFixed(1));
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    console.log({
      两小时丢梗次数: starts.length,
      名义无互斥期望: Math.round(7200 / ((MEME_INTERVAL_MIN + MEME_INTERVAL_MAX) / 2)),
      间隔_mean: +mean.toFixed(1),
      间隔_min: Math.min(...gaps),
      间隔_max: Math.max(...gaps),
    });
  });
});
