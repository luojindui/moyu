import { describe, it } from "vitest";
import {
  newEventState,
  scheduleEvents,
  BOSS_DURATION,
  MEME_DURATION,
} from "../src/engine/events";

/**
 * 挑战党探针 R3-③：无挑战空窗。
 * 两次事件间隔 45-150s，玩家（尤其挑战党）在这段时间里没有任何可做的事。
 * 量化：事件占空比（有事情发生的时间比例）、空窗分布、决策密度。
 */

const DT = 0.25;

describe("R3-③ 无挑战空窗", () => {
  it("2 小时真实调度：占空比 + 空窗分布 + 挑战型玩家活跃时间", () => {
    for (const seed of [7, 123, 999]) {
      const rng = (() => {
        let s = seed >>> 0;
        return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
      })();
      const es = newEventState();
      es.nextBossAt = 0;
      es.nextMemeAt = 0;
      const events: { type: "boss" | "meme"; start: number; end: number }[] = [];
      let prevBoss = false;
      let prevMeme = false;
      for (let t = 0; t <= 7200; t += DT) {
        scheduleEvents(es, t, rng);
        const boss = es.bossUntil > t;
        const meme = es.memeUntil > t;
        if (boss && !prevBoss) events.push({ type: "boss", start: t, end: t + BOSS_DURATION });
        if (meme && !prevMeme) events.push({ type: "meme", start: t, end: t + MEME_DURATION });
        prevBoss = boss;
        prevMeme = meme;
      }
      // 事件窗口总时长（互斥保证不重叠）
      const eventTime = events.reduce((a, e) => a + (e.end - e.start), 0);
      const bossEvents = events.filter((e) => e.type === "boss");
      const memeEvents = events.filter((e) => e.type === "meme");
      // boss 中真正"有事可做"的部分：只有开始 ~0.8s 宽限期需要急停；之后 7.2s 是纯等待
      const bossDecisionTime = bossEvents.length * 0.8; // 急停决策
      const memeActionTime = memeEvents.length * 0.6; // 一次点击 ~0.6s
      // 空窗：合并相邻事件间的间隔
      const sorted = events.sort((a, b) => a.start - b.start);
      const gaps: number[] = [];
      for (let i = 1; i < sorted.length; i++) gaps.push(+(sorted[i].start - sorted[i - 1].end).toFixed(1));
      const total = 7200;
      console.log({
        seed,
        boss次数: bossEvents.length,
        meme次数: memeEvents.length,
        事件窗口占空比: +(eventTime / total).toFixed(4),
        空闲比例: +(1 - eventTime / total).toFixed(4),
        boss决策时间_急停0p8s: +bossDecisionTime.toFixed(1),
        meme操作时间_0p6s: +memeActionTime.toFixed(1),
        真正手部操作占空比: +((bossDecisionTime + memeActionTime) / total).toFixed(5),
        空窗数: gaps.length,
        空窗mean: +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1),
        空窗median: gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)],
        空窗p90: gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length * 0.9)],
        空窗max: Math.max(...gaps),
        超过60s的空窗占比: +(gaps.filter((g) => g > 60).length / gaps.length).toFixed(3),
      });
    }
  });

  it("最长无刺激 Stretch：事件间隔上界推算", () => {
    // boss 90-150s、meme 45-75s 均匀。最坏情况：meme 被 boss 互斥推迟 + 双方都抽到上界。
    // 理论最大空窗 = meme_max(75) 推迟到 boss 结束后 + boss_max(150) + meme_dur 推迟量
    // 模拟验证：
    let worst = 0;
    let worstSeed = 0;
    for (let seed = 0; seed < 200; seed++) {
      const rng = (() => {
        let s = (seed * 7919 + 1) >>> 0;
        return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
      })();
      const es = newEventState();
      es.nextBossAt = 0;
      es.nextMemeAt = 0;
      const events: { start: number; end: number }[] = [];
      let prevBoss = false;
      let prevMeme = false;
      for (let t = 0; t <= 3600; t += 0.5) {
        scheduleEvents(es, t, rng);
        const boss = es.bossUntil > t;
        const meme = es.memeUntil > t;
        if (boss && !prevBoss) events.push({ start: t, end: t + BOSS_DURATION });
        if (meme && !prevMeme) events.push({ start: t, end: t + MEME_DURATION });
        prevBoss = boss;
        prevMeme = meme;
      }
      const sorted = events.sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].start - sorted[i - 1].end;
        if (gap > worst) {
          worst = gap;
          worstSeed = seed;
        }
      }
    }
    console.log({ 一小时内最坏空窗s: +worst.toFixed(1), worstSeed });
  });
});
