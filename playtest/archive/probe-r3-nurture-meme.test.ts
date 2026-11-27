import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { MEME_QUOTES, UPGRADE_FLAVOR } from "../src/engine/flavor";
import { MEME_INTERVAL_MIN, MEME_INTERVAL_MAX } from "../src/engine/events";
import { serialize, SAVE_KEY } from "../src/engine/save";

/**
 * 养成党探针 ③丢梗语录收集可行性：
 * 一次丢梗窗口=1 次抽取（onMemeTap 一梗一奖），语录均匀随机、无任何状态追踪。
 * 蒙特卡洛 + 引擎事实断言（GameState/存档无收集字段）。
 */

/** 均匀随机抽 n 条语录的蒙特卡洛（多种子） */
function mc(trials: number, draws: number) {
  let sumDistinct = 0;
  let sumCompleteDraw = 0;
  let completeTrials = 0;
  let sumRepeatsAfterComplete = 0;
  for (let t = 0; t < trials; t++) {
    const seen = new Set<number>();
    let completeAt: number | null = null;
    let repeats = 0;
    for (let i = 0; i < draws; i++) {
      const q = Math.floor(Math.random() * MEME_QUOTES.length);
      if (seen.has(q)) {
        if (completeAt !== null) repeats++;
      } else {
        seen.add(q);
        if (seen.size === MEME_QUOTES.length && completeAt === null) completeAt = i + 1;
      }
    }
    sumDistinct += seen.size;
    if (completeAt !== null) {
      completeTrials++;
      sumCompleteDraw += completeAt;
      sumRepeatsAfterComplete += repeats;
    }
  }
  return {
    trials,
    draws,
    meanDistinct: +(sumDistinct / trials).toFixed(2),
    completeRate: +(completeTrials / trials).toFixed(3),
    meanDrawsToComplete: completeTrials ? +(sumCompleteDraw / completeTrials).toFixed(1) : null,
    meanRepeatsAfterComplete: completeTrials ? +(sumRepeatsAfterComplete / completeTrials).toFixed(1) : null,
  };
}

describe("养成党：丢梗语录图鉴可行性", () => {
  it("R3 修复回归：语录池 10 条 + 图鉴追踪已实现（collected）", () => {
    expect(MEME_QUOTES.length).toBe(10);
    // ✅ 已修复：GameState 增加 collected（图鉴）与 daily（日报）
    expect(Object.keys(initialState()).sort()).toEqual(["collected", "daily", "levels", "moyu", "surviveStreak", "totalEarned"]);
    // 存档 blob 同样不含收集字段
    const store = new Map<string, string>();
    serialize(initialState(), { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) }, 0);
    const blob = Object.keys(JSON.parse(store.get(SAVE_KEY)!));
    expect(blob.sort()).toEqual(["collected", "createdAt", "daily", "levels", "moyu", "savedAt", "surviveStreak", "totalEarned", "v"]);
    // 丢梗窗口参数：45-75s 一次
    expect([MEME_INTERVAL_MIN, MEME_INTERVAL_MAX]).toEqual([45, 75]);
  });

  it("蒙特卡洛：单次会话内能见全，但重复率极高", () => {
    const avgIntervalSec = (MEME_INTERVAL_MIN + MEME_INTERVAL_MAX) / 2; // 60s/条
    for (const sessionMin of [30, 60, 120]) {
      const draws = Math.round((sessionMin * 60) / avgIntervalSec);
      const r = mc(4000, draws);
      const minutesToComplete = r.meanDrawsToComplete ? +(r.meanDrawsToComplete * avgIntervalSec / 60).toFixed(1) : null;
      console.log(
        `[${sessionMin}min 会话 ≈ ${draws} 次丢梗] 平均见到 ${r.meanDistinct}/10 条；集齐率 ${r.completeRate * 100}%；` +
          `平均需 ${r.meanDrawsToComplete} 抽（≈${minutesToComplete}min 活跃游玩）；集齐后仍会重复 ${r.meanRepeatsAfterComplete} 次`,
      );
    }
  });

  it("对比：升级彩蛋池 45 条是确定性解锁（语录池完全随机）", () => {
    const items = Object.keys(UPGRADE_FLAVOR);
    expect(items.length).toBe(9);
    expect(items.reduce((n, k) => n + UPGRADE_FLAVOR[k]!.length, 0)).toBe(45);
    // 彩蛋按等级档位确定解锁；语录按随机均匀分布，无法感知缺哪条
    expect(MEME_QUOTES.length).toBeLessThan(45);
  });
});
