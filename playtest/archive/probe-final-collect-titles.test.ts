/**
 * probe-final-collect-titles.test.ts — 终验探针 ③：段位 7 档阈值 / 档内进度 / 终档无 next
 * 只读 src/，不改 src/。
 */
import { describe, it, expect } from "vitest";
import { RANKS, rankFor } from "../src/engine/titles";

const THRESHOLDS = [0, 10_000, 100_000, 1_000_000, 100_000_000, 1_000_000_000, 2_500_000_000];

describe("③ 段位：7 档阈值", () => {
  it("恰 7 档，阈值/名称与规格一致", () => {
    expect(RANKS).toHaveLength(7);
    expect(RANKS.map((r) => r.at)).toEqual(THRESHOLDS);
    expect(RANKS.map((r) => r.name)).toEqual([
      "摸鱼实习生",
      "摸鱼学徒",
      "资深摸鱼",
      "摸鱼大师",
      "带薪摸鱼传说",
      "摸鱼之神",
      "摸鱼宇宙尽头",
    ]);
    for (let i = 1; i < RANKS.length; i++) {
      expect(RANKS[i]!.at, `第 ${i} 档阈值必须严格递增`).toBeGreaterThan(RANKS[i - 1]!.at);
    }
    expect(new Set(RANKS.map((r) => r.name)).size).toBe(7);
  });

  it("每个阈值点晋升到对应档；阈值 -1 仍留在上一档", () => {
    THRESHOLDS.forEach((at, i) => {
      const r = rankFor(at);
      expect(r.current, `at=${at}`).toBe(RANKS[i]!.name);
      expect(r.next?.name ?? null, `at=${at}`).toBe(i + 1 < RANKS.length ? RANKS[i + 1]!.name : null);
      if (i > 0) {
        const below = rankFor(at - 1);
        expect(below.current, `at=${at - 1}`).toBe(RANKS[i - 1]!.name);
        expect(below.next?.name).toBe(RANKS[i]!.name);
      }
    });
    // 0 以下钳制到第一档
    expect(rankFor(-1).current).toBe(RANKS[0]!.name);
    expect(rankFor(-1).progress).toBe(0);
  });
});

describe("③ 段位：进度计算", () => {
  it("档内进度 = (total - cur.at)/(next.at - cur.at)，边界 0/中间/1", () => {
    const mid = (a: number, b: number) => a + (b - a) / 2;
    for (let i = 0; i + 1 < RANKS.length; i++) {
      const cur = RANKS[i]!;
      const next = RANKS[i + 1]!;
      expect(rankFor(cur.at).progress, `${cur.name} 起点`).toBe(0);
      if (i + 2 < RANKS.length) {
        // 下一档的起点（非终档时）
        expect(rankFor(next.at).progress, `${next.name} 起点`).toBe(0);
      }
      expect(rankFor(mid(cur.at, next.at)).progress).toBeCloseTo(0.5, 10);
      // 独立推定几个非对称点
      const quarter = cur.at + (next.at - cur.at) * 0.25;
      expect(rankFor(quarter).progress).toBeCloseTo(0.25, 10);
      const threeQuarter = cur.at + (next.at - cur.at) * 0.75;
      expect(rankFor(threeQuarter).progress).toBeCloseTo(0.75, 10);
      expect(rankFor(next.at - 1).progress).toBeGreaterThanOrEqual(0);
      expect(rankFor(next.at - 1).progress).toBeLessThan(1);
    }
    // 首个区间：50k → 40000/90000 ≈ 0.4444
    expect(rankFor(50_000).progress).toBeCloseTo(0.4444, 3);
    expect(rankFor(55_000).progress).toBeCloseTo(0.5, 10);
  });

  it("进度恒在 [0,1]（遍历各档内数百个点）", () => {
    for (let i = 0; i + 1 < RANKS.length; i++) {
      const cur = RANKS[i]!;
      const next = RANKS[i + 1]!;
      for (let k = 0; k <= 100; k++) {
        const v = cur.at + ((next.at - cur.at) * k) / 100;
        const p = rankFor(v).progress;
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });

  it("终档：无 next、progress=1，超过阈值也稳定", () => {
    const top = THRESHOLDS.at(-1)!;
    for (const v of [top, top + 1, top * 2, Number.MAX_SAFE_INTEGER, Infinity]) {
      const r = rankFor(v);
      expect(r.current).toBe(RANKS.at(-1)!.name);
      expect(r.next).toBeNull();
      expect(r.progress).toBe(1);
    }
  });

  it("单调：累计值越大段位序号不降（抽样 50 个点）", () => {
    const idxOf = (name: string): number => RANKS.findIndex((r) => r.name === name);
    let prev = -1;
    for (let k = 0; k < 50; k++) {
      const v = Math.round((THRESHOLDS.at(-1)! / 49) * k);
      const idx = idxOf(rankFor(v).current);
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });

  it("NaN 输入不抛错（非可达路径：restore 已挡非有限数）", () => {
    const r = rankFor(NaN);
    expect(r.current).toBe(RANKS[0]!.name);
    expect(r.next).not.toBeNull();
  });
});
