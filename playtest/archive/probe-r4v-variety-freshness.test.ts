/**
 * probe-r4v-variety-freshness.test.ts — 验收 2：时间桶多样性 / 变体熵 / 新鲜度悬崖
 * 只 import playtest 库 + src/engine（不改 src/）。
 *
 * 方法：5 分钟桶 × 30 分钟会话；3 画像 × 6 种子 × A/B 两臂。
 *   A（baseline）= 本次上线前语义：恒 hold 变体、无连击、无日报、无连胜（事件时序与 B 完全同源）
 *   B（current） = 现行语义：三变体 + 连击 + 日报 + 连胜
 * 记录：每桶动作种类数 / 每桶主线新内容数 / 每桶巡逻变体熵 / 变体种类数 CV /
 *       内容耗尽时间（末次新内容 / 持续空桶起点 / 密集期终点）/ 前 5·10·12·20·30 分钟累计收集。
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { PERSONAS, simulate, aggregate, DT, BUCKET_SEC, type SimResult, type Aggregate } from "./probe-r4v-variety-lib";
import { BOSS_VARIANTS } from "../src/engine/events";

const MINUTES = 30;
const SEEDS = [1000, 8919, 16838, 24757, 32676, 40595];

function runArm(mode: "baseline" | "current") {
  const perPersona = PERSONAS.map((p) => {
    const runs: SimResult[] = SEEDS.map((seed) => simulate({ persona: p, mode, minutes: MINUTES, seed }));
    return aggregate(runs);
  });
  return perPersona;
}

describe("R4V 多样性 · 时间桶新鲜度曲线（5min 桶 × 30min）", () => {
  const baseline = runArm("baseline");
  const current = runArm("current");

  it("每桶动作种类数：三变体应让动作层更厚（current ≥ baseline），且未退化为纯点击", () => {
    const rows = current.map((c, i) => {
      const b = baseline[i]!;
      return {
        persona: c.persona,
        baselineMeanActionKinds: b.meanActionKinds,
        currentMeanActionKinds: c.meanActionKinds,
        delta: +(c.meanActionKinds - b.meanActionKinds).toFixed(2),
        baselineActionKindsByBucket: b.actionKindsPerBucket,
        currentActionKindsByBucket: c.actionKindsPerBucket,
        baselineNewContentByBucket: b.newContentPerBucket,
        currentNewContentByBucket: c.newContentPerBucket,
        currentNewMechanicsByBucket: c.newMechanicsPerBucket,
      };
    });
    console.log("[r4v-freshness] 动作种类/桶", JSON.stringify(rows, null, 1));
    for (let i = 0; i < current.length; i++) {
      // 变体上线前后动作层只增不减（type/blitz 点击 = 新的动作类别）
      expect(current[i]!.meanActionKinds).toBeGreaterThanOrEqual(baseline[i]!.meanActionKinds);
      // 不是纯点击游戏：平均每桶至少 2 类有意义动作
      expect(current[i]!.meanActionKinds).toBeGreaterThanOrEqual(2);
    }
  });

  it("变体熵：上线前恒 1 种 hold（CV=0），上线后每桶变体种类 1~3 且有真实分布熵", () => {
    const rows = current.map((c, i) => {
      const b = baseline[i]!;
      return {
        persona: c.persona,
        baselineVariantKindsCV: b.variantKindsCV,
        currentVariantKindsCV: c.variantKindsCV,
        baselineMeanVariantEntropy: b.meanVariantEntropy,
        currentMeanVariantEntropy: c.meanVariantEntropy,
        variantUniverse: BOSS_VARIANTS.length,
      };
    });
    console.log("[r4v-freshness] 变体熵", JSON.stringify(rows, null, 1));
    for (let i = 0; i < current.length; i++) {
      // baseline 前置条件：恒 1 种 hold → CV 必为 0、熵 0
      expect(baseline[i]!.variantKindsCV).toBe(0);
      expect(baseline[i]!.meanVariantEntropy).toBe(0);
      // current：变体种类数出现波动（CV>0），每桶熵 >0 且 <= log2(3)=1.585
      expect(current[i]!.variantKindsCV).toBeGreaterThan(0);
      expect(current[i]!.meanVariantEntropy).toBeGreaterThan(0);
      expect(current[i]!.meanVariantEntropy).toBeLessThanOrEqual(Math.log2(3) + 1e-9);
    }
  });

  it("新鲜度悬崖：内容耗尽时间相对上线前被推后多少（逐画像）", () => {
    const rows = current.map((c, i) => {
      const b = baseline[i]!;
      const push = (a: number | null, z: number | null): number | null =>
        a === null || z === null ? null : +(a - z).toFixed(2);
      return {
        persona: c.persona,
        baseline: {
          lastNoveltyMin: b.medianLastNoveltyMin,
          denseUntilMin: b.medianDenseUntilMin,
          plateauStartMin: b.medianPlateauStartMin,
          at10: b.medianAt10,
          at12: b.medianAt12,
          collected30: b.medianCollected,
        },
        current: {
          lastNoveltyMin: c.medianLastNoveltyMin,
          denseUntilMin: c.medianDenseUntilMin,
          plateauStartMin: c.medianPlateauStartMin,
          at10: c.medianAt10,
          at12: c.medianAt12,
          collected30: c.medianCollected,
        },
        push: {
          lastNoveltyMin: push(c.medianLastNoveltyMin, b.medianLastNoveltyMin),
          denseUntilMin: push(c.medianDenseUntilMin, b.medianDenseUntilMin),
          plateauStartMin: push(c.medianPlateauStartMin, b.medianPlateauStartMin),
          at12: c.medianAt12 - b.medianAt12,
        },
      };
    });
    console.log("[r4v-freshness] 悬崖", JSON.stringify(rows, null, 1));
    for (const r of rows) {
      // 主线内容池：上线后 61（55 收藏 + 3 日报 + 3 变体），上线前 55
      expect(r.current.collected30 >= r.baseline.collected30).toBe(true);
      // 12 分钟前累计收集不减少（变体首见 + 日报目标前置了内容）
      expect(r.push.at12).toBeGreaterThanOrEqual(0);
    }
  });

  it("内容池口径与收集数合法（前 5 分钟必有首批内容、30 分钟不超过池上限）", () => {
    for (const c of current) {
      expect(c.medianAt10).toBeGreaterThan(0);
      expect(c.medianAt30).toBeGreaterThanOrEqual(c.medianAt10);
      expect(c.medianCollected).toBeLessThanOrEqual(61);
      expect(c.medianMechanicsCollected).toBeGreaterThan(0); // 首购/变体达标等机制里程碑存在
    }
    for (const b of baseline) {
      expect(b.medianCollected).toBeLessThanOrEqual(55);
    }
  });

  it("输出 JSON（供验收报告引用）", () => {
    const report = {
      probe: "r4v-variety-freshness",
      generatedAt: new Date().toISOString(),
      method: { bucketSec: BUCKET_SEC, minutes: MINUTES, seeds: SEEDS, personas: PERSONAS.length, dt: DT },
      baseline,
      current,
      arms: {
        baseline: "上线前：恒 hold 变体 / 无连击 / 无日报 / 无连胜（事件时序与 current 同源）",
        current: "现行：hold40%+type35%+blitz25% / 连击链 / 日报3目标 / 安然连胜",
      },
      contentPool: {
        currentPrimary: 61,
        currentBreakdown: { flavors: 45, quotes: 10, dailyGoals: 3, variants: 3 },
        baselinePrimary: 55,
        baselineBreakdown: { flavors: 45, quotes: 10 },
      },
    };
    writeFileSync("playtest/r4v-variety-freshness.json", JSON.stringify(report, null, 2));
    expect(report.current.length).toBe(PERSONAS.length);
  });
});
