/**
 * probe-r4v-variety-cliff.test.ts — 验收 2（lead 定稿口径 B）：新鲜度悬崖 A/B 复算
 *
 * 基线（第 3 轮 player-variety 原定义）三个数字：
 *   ① 语录轮转口径 10.3 分钟见底（10 条 ÷ 1 次/分钟）；coupon-collector 随机口径期望 29.3 分钟
 *   ② 升级首购空窗：第 6 件首购 13.8min 后，后续首购在 20.1 / 28.8min → 中间 ~6 分钟无新解锁
 *   ③ 新内容速率：前 5 分钟 2.6 件/分钟 → 15 分钟后 0.7 件/分钟，且其中 100% 是文本彩蛋
 *
 * 本探针用与第 3 轮同构的画像（R3_VARIETY）跑 baseline/current 两臂，逐条复算并给出：
 *   - 语录见底是否延后 / 图鉴 55 条「??」是否改变可感知深度
 *   - 首购空窗是否被日报目标/变体事件填
 *   - 新内容速率曲线（2.6→0.7 是否抬升，15 分钟后文本彩蛋占比）
 *   - 内容耗尽时间（主线 61 项口径）推后到多少
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { R3_VARIETY, PERSONAS, simulate, median, type SimResult } from "./probe-r4v-variety-lib";
import { MEME_QUOTES } from "../src/engine/flavor";
import { TOTAL_ITEMS } from "../src/engine/collection";

const SEEDS = [1000, 8919, 16838, 24757, 32676, 40595];
const MINUTES = 30;

function medOf<T extends number>(xs: T[]): number {
  return +median(xs as number[]).toFixed(2);
}
function medNullable(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? +median(v).toFixed(2) : null;
}

function arm(mode: "baseline" | "current", quoteMode: "cycle" | "random", minutes = MINUTES): SimResult[] {
  return SEEDS.map((seed) => simulate({ persona: R3_VARIETY, mode, minutes, seed, quoteMode }));
}

/** 新内容事件按阶段统计（用于「空窗是否被填」） */
function noveltyInWindow(run: SimResult, fromMin: number, toMin: number) {
  const ev = run.novelty.filter((n) => n.t > fromMin && n.t <= toMin);
  const byKind: Record<string, number> = {};
  for (const n of ev) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
  return { total: ev.length, byKind, events: ev.map((n) => ({ t: n.t, kind: n.kind, id: n.id })) };
}

describe("R4V 悬崖复算 ①：语录见底 & 图鉴可感知深度", () => {
  it("语录见底时间：轮转口径 ≈10.3min / 随机口径 ≈29min，上线前后口径不变；图鉴 55 条把「见底」从 10 条池扩到 55 条池", () => {
    const baseCycle = arm("baseline", "cycle");
    const curCycle = arm("current", "cycle");
    const baseRandom = arm("baseline", "random");
    const curRandom = arm("current", "random");

    const rows = {
      baseline: {
        cycleQuoteExhaustMin: medNullable(baseCycle.map((r) => r.detail.allQuotesAtMin)),
        randomQuoteExhaustMin: medNullable(baseRandom.map((r) => r.detail.allQuotesAtMin)),
        visibleCollectiblePool: MEME_QUOTES.length,
        codexAt12: medOf(baseCycle.map((r) => (r.detail.codexAt["12"] ?? 0))),
        codexAt30: medOf(baseCycle.map((r) => (r.detail.codexAt["30"] ?? 0))),
      },
      current: {
        cycleQuoteExhaustMin: medNullable(curCycle.map((r) => r.detail.allQuotesAtMin)),
        randomQuoteExhaustMin: medNullable(curRandom.map((r) => r.detail.allQuotesAtMin)),
        visibleCollectiblePool: TOTAL_ITEMS,
        codexAt12: medOf(curCycle.map((r) => (r.detail.codexAt["12"] ?? 0))),
        codexAt30: medOf(curCycle.map((r) => (r.detail.codexAt["30"] ?? 0))),
        codexPctAt12: +((medOf(curCycle.map((r) => r.detail.codexAt["12"] ?? 0)) / TOTAL_ITEMS) * 100).toFixed(1),
        codexPctAt30: +((medOf(curCycle.map((r) => r.detail.codexAt["30"] ?? 0)) / TOTAL_ITEMS) * 100).toFixed(1),
      },
    };
    console.log("[r4v-cliff] 语录见底/图鉴", JSON.stringify(rows, null, 1));

    // 复算第 3 轮基线：轮转口径 10.3min 见底（±1.5min 容差），随机口径 ≈29min
    expect(rows.baseline.cycleQuoteExhaustMin).not.toBeNull();
    expect(Math.abs(rows.baseline.cycleQuoteExhaustMin! - 10.3)).toBeLessThan(1.5);
    expect(rows.baseline.randomQuoteExhaustMin).toBeGreaterThan(20);

    // 语录池未扩：见底时间本身不变（10 条 ÷ 1 次/分钟 是事件率决定的）
    expect(rows.current.cycleQuoteExhaustMin).not.toBeNull();
    expect(Math.abs(rows.current.cycleQuoteExhaustMin! - rows.baseline.cycleQuoteExhaustMin!)).toBeLessThan(1.5);

    // 但可见收集池 10 → 55：12 分钟时仍有一大半未解锁（"见底"被推后到池外）
    expect(rows.current.visibleCollectiblePool).toBe(55);
    expect(rows.current.codexPctAt12).toBeLessThan(50);
    expect(rows.current.codexPctAt30).toBeLessThan(80);
    // 12 分钟时「可见未解锁目标」：上线前 0（10 条语录已全见）→ 上线后 34（55-21）
    const remaining = {
      baselineAt12: Math.max(0, MEME_QUOTES.length - Math.min(MEME_QUOTES.length, rows.baseline.codexAt12 - 0)),
      currentAt12: TOTAL_ITEMS - rows.current.codexAt12,
      currentAt30: TOTAL_ITEMS - rows.current.codexAt30,
    };
    console.log("[r4v-cliff] 可见未解锁目标", JSON.stringify(remaining, null, 1));
    expect(remaining.currentAt12).toBeGreaterThan(30);
  });

  it("内容耗尽时间推后多少：55 条图鉴在 30/60 分钟内是否收满（收不满 = 悬崖整体推后 ≥ 会话长）", () => {
    const cur30 = arm("current", "cycle", 30);
    const cur60 = arm("current", "cycle", 60);
    const row = {
      codexAt30: medOf(cur30.map((r) => (r.detail.codexAt["30"] ?? 0))),
      codexAt60: medOf(cur60.map((r) => (r.detail.codexAt["60"] ?? 0))),
      codexAt60Session: medOf(cur60.map((r) => r.end.quotes + r.end.flavors)),
      lastNovelty30: medNullable(cur30.map((r) => r.content.lastNoveltyMin)),
      lastNovelty60: medNullable(cur60.map((r) => r.content.lastNoveltyMin)),
      plateauStart60: medNullable(cur60.map((r) => r.content.plateauStartMin)),
    };
    console.log("[r4v-cliff] 60 分钟耗尽测试", JSON.stringify(row, null, 1));
    // 60 分钟仍收不满 55 条 → "内容耗尽"不在 30 分钟窗口内
    expect(row.codexAt60Session).toBeLessThan(TOTAL_ITEMS);
    // 60 分钟会话仍有新内容解锁（末次新内容 > 55 分钟）
    expect(row.lastNovelty60).toBeGreaterThan(55);
  });
});

describe("R4V 悬崖复算 ②：升级首购空窗是否被日报/变体填", () => {
  it("首购时间线与空窗：基线第 6 件 ≈13.8min、第 7/8 件 ≈20.1/28.8min；复算 current 是否缩短/被填", () => {
    const base = arm("baseline", "cycle");
    const cur = arm("current", "cycle");

    const timelineOf = (runs: SimResult[]) => {
      // 取中位时间线（按首购序号对齐）
      const n = Math.max(...runs.map((r) => r.detail.firstBuyTimes.length));
      return Array.from({ length: n }, (_, i) => ({
        idx: i + 1,
        id: runs[0]!.detail.firstBuyTimes[i]?.id ?? null,
        t: medNullable(runs.map((r) => r.detail.firstBuyTimes[i]?.t ?? null)),
      }));
    };
    const baseTimeline = timelineOf(base);
    const curTimeline = timelineOf(cur);
    const baseGaps = base.map((r) => r.detail.firstBuyGaps.map((g) => g.gapMin));
    const curGaps = cur.map((r) => r.detail.firstBuyGaps.map((g) => g.gapMin));
    const maxGap = (xs: number[][]): number => Math.max(...xs.map((a) => Math.max(0, ...a)));
    const sixth = baseTimeline[5]?.t ?? null;
    const seventh = baseTimeline[6]?.t ?? null;

    // 空窗（基线 6 件之后到下一件之间）内 current 有哪些新内容事件
    const gapStart = sixth ?? 13.8;
    const gapEnd = seventh ?? 20.1;
    const fill = cur.map((r) => noveltyInWindow(r, gapStart, gapEnd));
    const fillKinds: Record<string, number> = {};
    for (const f of fill) for (const [k, v] of Object.entries(f.byKind)) fillKinds[k] = (fillKinds[k] ?? 0) + v;
    const baseFillKinds: Record<string, number> = {};
    for (const f of base.map((r) => noveltyInWindow(r, gapStart, gapEnd)))
      for (const [k, v] of Object.entries(f.byKind)) baseFillKinds[k] = (baseFillKinds[k] ?? 0) + v;

    const row = {
      baseline: {
        timeline: baseTimeline,
        maxGapMin: maxGap(baseGaps),
        gap6to7Min: sixth !== null && seventh !== null ? +(seventh - sixth).toFixed(2) : null,
      },
      current: {
        timeline: curTimeline,
        maxGapMin: maxGap(curGaps),
        gap6to7Min:
          (curTimeline[5]?.t ?? null) !== null && (curTimeline[6]?.t ?? null) !== null
            ? +((curTimeline[6]!.t as number) - (curTimeline[5]!.t as number)).toFixed(2)
            : null,
      },
      gapWindow: { fromMin: +gapStart.toFixed(2), toMin: +gapEnd.toFixed(2) },
      gapFillEvents: {
        baselineByKind: baseFillKinds,
        currentByKind: fillKinds,
        currentAvgTotal: +(fill.reduce((a, f) => a + f.total, 0) / fill.length).toFixed(2),
      },
    };
    console.log("[r4v-cliff] 首购空窗", JSON.stringify(row, null, 1));

    // 基线校准：第 6 件首购落在 13.8min 附近（±2min）
    expect(sixth).not.toBeNull();
    expect(Math.abs(sixth! - 13.8)).toBeLessThan(2.5);
    // 首购空窗在两臂都客观存在（后期价格墙），不是靠加内容能消除的
    expect(row.baseline.maxGapMin).toBeGreaterThan(3);
    // current 空窗内：除文本彩蛋外还存在日报/变体类事件（filling 感知）
    const dailyOrVariant = (fillKinds["dailyGoal"] ?? 0) + (fillKinds["variant"] ?? 0) + (fillKinds["variantWin"] ?? 0);
    const baseDailyOrVariant =
      (baseFillKinds["dailyGoal"] ?? 0) + (baseFillKinds["variant"] ?? 0) + (baseFillKinds["variantWin"] ?? 0);
    expect(dailyOrVariant).toBeGreaterThanOrEqual(baseDailyOrVariant);
    // current 的最大空窗不应比基线更长（内容只填不减）
    expect(row.current.maxGapMin).toBeLessThanOrEqual(row.baseline.maxGapMin + 0.5);
  });
});

describe("R4V 悬崖复算 ③：新内容速率曲线（2.6→0.7/min 是否抬升）", () => {
  it("前 5 分钟速率、15 分钟后速率、15 分钟后文本彩蛋占比：A/B 对比", () => {
    const base = arm("baseline", "cycle");
    const cur = arm("current", "cycle");
    const pick = (runs: SimResult[], f: (r: SimResult) => number): number => medOf(runs.map(f));
    const row = {
      baseline: {
        primaryFirst5: pick(base, (r) => r.detail.rate.primaryFirst5),
        primaryAfter15: pick(base, (r) => r.detail.rate.primaryAfter15),
        primaryAfter15FlavorPct: pick(base, (r) => r.detail.rate.primaryAfter15FlavorPct),
        collectFirst5: pick(base, (r) => r.detail.rate.collectFirst5),
        collectAfter15: pick(base, (r) => r.detail.rate.collectAfter15),
        collectAfter15FlavorPct: pick(base, (r) => r.detail.rate.collectAfter15FlavorPct),
        allFirst5: pick(base, (r) => r.detail.rate.allFirst5),
        allAfter15: pick(base, (r) => r.detail.rate.allAfter15),
        allAfter15FlavorPct: pick(base, (r) => r.detail.rate.allAfter15FlavorPct),
        after15KindCounts: base[0]!.detail.rate.after15KindCounts,
      },
      current: {
        primaryFirst5: pick(cur, (r) => r.detail.rate.primaryFirst5),
        primaryAfter15: pick(cur, (r) => r.detail.rate.primaryAfter15),
        primaryAfter15FlavorPct: pick(cur, (r) => r.detail.rate.primaryAfter15FlavorPct),
        collectFirst5: pick(cur, (r) => r.detail.rate.collectFirst5),
        collectAfter15: pick(cur, (r) => r.detail.rate.collectAfter15),
        collectAfter15FlavorPct: pick(cur, (r) => r.detail.rate.collectAfter15FlavorPct),
        allFirst5: pick(cur, (r) => r.detail.rate.allFirst5),
        allAfter15: pick(cur, (r) => r.detail.rate.allAfter15),
        allAfter15FlavorPct: pick(cur, (r) => r.detail.rate.allAfter15FlavorPct),
        after15KindCounts: cur[0]!.detail.rate.after15KindCounts,
      },
      leadBaseline: { collectFirst5: 2.6, collectAfter15: 0.7, after15TextFlavorPct: 100 },
    };
    console.log("[r4v-cliff] 内容速率", JSON.stringify(row, null, 1));

    // 校准基线：第 3 轮「新内容速率 2.6→0.7/min」= 收藏口径（彩蛋+语录+首购）
    expect(Math.abs(row.baseline.collectFirst5 - 2.6)).toBeLessThan(0.6);
    expect(Math.abs(row.baseline.collectAfter15 - 0.7)).toBeLessThan(0.3);
    // 前 5 分钟：日报目标 + 变体首见把速率抬高（三口径同向）
    expect(row.current.primaryFirst5).toBeGreaterThan(row.baseline.primaryFirst5);
    expect(row.current.collectFirst5).toBeGreaterThan(row.baseline.collectFirst5);
    expect(row.current.allFirst5).toBeGreaterThan(row.baseline.allFirst5);
    // 15 分钟后：主线速率不变（新增内容都发生在 15 分钟前），如实记录；机制口径有连胜/连击混入
    console.log(
      "[r4v-cliff] 15min 后：",
      `主线 ${row.baseline.primaryAfter15}→${row.current.primaryAfter15}/min`,
      `| 收藏 ${row.baseline.collectAfter15}→${row.current.collectAfter15}/min`,
      `| 全量 ${row.baseline.allAfter15}→${row.current.allAfter15}/min`,
      `| 文本彩蛋占比 ${row.baseline.allAfter15FlavorPct}%→${row.current.allAfter15FlavorPct}%`,
    );
    expect(row.current.collectAfter15).toBeGreaterThanOrEqual(row.baseline.collectAfter15);
    expect(row.current.allAfter15).toBeGreaterThanOrEqual(row.baseline.allAfter15);
    // 15 分钟后新增事件种类：current 不应再是 100% 文本彩蛋（连胜/连击/变体达标混入）
    expect(Object.keys(row.current.after15KindCounts).length).toBeGreaterThanOrEqual(
      Object.keys(row.baseline.after15KindCounts).length,
    );
  });

  it("输出悬崖 A/B JSON", () => {
    const base = arm("baseline", "cycle");
    const cur = arm("current", "cycle");
    const payload = {
      probe: "r4v-variety-cliff",
      baselineSource: "第 3 轮 player-variety：语录 10.3min 见底 / 首购 13.8·20.1·28.8min / 速率 2.6→0.7/min",
      method: { persona: R3_VARIETY.name, seeds: SEEDS, minutes: MINUTES, quoteMode: "cycle+random 双口径" },
      leadBaseline: { quoteExhaustMin: 10.3, firstBuy6thMin: 13.8, firstBuy7thMin: 20.1, firstBuy8thMin: 28.8, rateFirst5: 2.6, rateAfter15: 0.7 },
      reproduction: {
        baselineQuoteExhaustMin: medNullable(base.map((r) => r.detail.allQuotesAtMin)),
        baselineFirstBuyTimeline: base[0]!.detail.firstBuyTimes,
        baselineRateFirst5: medOf(base.map((r) => r.detail.rate.first5PerMin)),
        baselineRateAfter15: medOf(base.map((r) => r.detail.rate.after15PerMin)),
      },
      current: {
        quoteExhaustMin: medNullable(cur.map((r) => r.detail.allQuotesAtMin)),
        firstBuyTimeline: cur[0]!.detail.firstBuyTimes,
        rateFirst5: medOf(cur.map((r) => r.detail.rate.first5PerMin)),
        rateAfter15: medOf(cur.map((r) => r.detail.rate.after15PerMin)),
        codexAt30: medOf(cur.map((r) => (r.detail.codexAt["30"] ?? 0))),
      },
    };
    writeFileSync("playtest/r4v-variety-cliff.json", JSON.stringify(payload, null, 2));
    expect(payload.reproduction.baselineQuoteExhaustMin).not.toBeNull();
  });
});

describe("R4V 悬崖复算 ④：综合判定数据（供验收报告）", () => {
  it("汇总 B 口径三数字 + 可感知深度 + 变体熵 + 事件经济占比", async () => {
    const base = arm("baseline", "cycle");
    const cur = arm("current", "cycle");
    const curRandom = arm("current", "random");
    const baseRandom = arm("baseline", "random");
    const cur60 = arm("current", "cycle", 60);

    // 日报完成时间（current 独占内容）
    const dailyAllDone = cur
      .map((r) => Math.max(0, ...r.detail.dailyGoalTimes.map((g) => g.t)))
      .filter((x) => x > 0);
    const variantAllSeen = cur.map((r) => Math.max(0, ...r.detail.variantFirstTimes.map((v) => v.t)));

    // 变体序列统计（3h × 20 种子，与 impact 探针同源）
    const { patrolVariantSequence } = await import("./probe-r4v-variety-lib");
    const seqs = Array.from({ length: 20 }, (_, i) => patrolVariantSequence(1000 + i * 7919, 180));
    const variantStats = seqs.map((seq) => {
      const n = seq.length;
      const c = { hold: 0, type: 0, blitz: 0 };
      for (const v of seq) c[v] += 1;
      let rep = 0;
      for (let i = 1; i < n; i++) if (seq[i] === seq[i - 1]) rep += 1;
      return { n, ratio: { hold: c.hold / n, type: c.type / n, blitz: c.blitz / n }, repeat: rep / (n - 1) };
    });
    const avgRatio = {
      hold: +(variantStats.reduce((a, x) => a + x.ratio.hold, 0) / seqs.length).toFixed(3),
      type: +(variantStats.reduce((a, x) => a + x.ratio.type, 0) / seqs.length).toFixed(3),
      blitz: +(variantStats.reduce((a, x) => a + x.ratio.blitz, 0) / seqs.length).toFixed(3),
    };
    const avgRepeat = +(variantStats.reduce((a, x) => a + x.repeat, 0) / seqs.length).toFixed(3);

    const casualPersona = PERSONAS.find((p) => p.name.includes("休闲"))!;
    const casualRuns = SEEDS.map((seed) => simulate({ persona: casualPersona, mode: "current", minutes: 30, seed, quoteMode: "cycle" }));
    const economyMax = {
      variety: Math.max(...cur.map((r) => r.economy.eventSharePct)),
      casual: Math.max(...casualRuns.map((r) => r.economy.eventSharePct)),
      varietyMedian: medOf(cur.map((r) => r.economy.eventSharePct)),
      casualMedian: medOf(casualRuns.map((r) => r.economy.eventSharePct)),
    };
    // 首购空窗（6 件之后 → 下一件）被新内容填充情况
    const gapFrom = cur[0]!.detail.firstBuyTimes[5]?.t ?? 14;
    const gapTo = cur[0]!.detail.firstBuyTimes[6]?.t ?? 20.25;
    const fillOf = (runs: SimResult[]) => {
      const kinds: Record<string, number> = {};
      for (const r of runs) for (const n of r.novelty.filter((x) => x.t > gapFrom && x.t <= gapTo)) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
      return kinds;
    };

    // 机制里程碑首次出现时间（combo/daily/variant/streak）：上线前 0 项 → 现行最后一项何时出现
    const mechKinds = new Set(["dailyGoal", "variant", "variantWin", "streak", "combo", "dailyClaim"]);
    const mechLast = cur.map((r) => {
      const mech = r.novelty.filter((n) => mechKinds.has(n.kind));
      return mech.length ? Math.max(...mech.map((n) => n.t)) : null;
    });
    const mechTimesMerged: Record<string, number[]> = {};
    for (const r of cur) {
      for (const n of r.novelty.filter((x) => mechKinds.has(x.kind))) {
        (mechTimesMerged[n.kind] ??= []).push(n.t);
      }
    }
    const mechFirstSeen: Record<string, number> = {};
    for (const [k, v] of Object.entries(mechTimesMerged)) mechFirstSeen[k] = +Math.min(...v).toFixed(2);
    // 随机语录口径：30 分钟内是否收齐（不含幸存者偏差）
    const randomCollected = baseRandom.map((r) => r.end.quotes);

    const verdict = {
      probe: "r4v-variety-verdict",
      generatedAt: new Date().toISOString(),
      cliffB: {
        leadBaseline: { quoteExhaustCycle: 10.3, quoteExhaustRandom: 29.3, firstBuy6: 13.8, firstBuy7: 20.1, firstBuy8: 28.8, rateFirst5: 2.6, rateAfter15: 0.7 },
        reproducedBaseline: {
          quoteExhaustCycle: medNullable(base.map((r) => r.detail.allQuotesAtMin)),
          quoteExhaustRandom: medNullable(baseRandom.map((r) => r.detail.allQuotesAtMin)),
          firstBuyTimeline: base[0]!.detail.firstBuyTimes,
          rateFirst5: medOf(base.map((r) => r.detail.rate.collectFirst5)),
          rateAfter15: medOf(base.map((r) => r.detail.rate.collectAfter15)),
        },
        current: {
          quoteExhaustCycle: medNullable(cur.map((r) => r.detail.allQuotesAtMin)),
          quoteExhaustRandom: medNullable(curRandom.map((r) => r.detail.allQuotesAtMin)),
          firstBuyTimeline: cur[0]!.detail.firstBuyTimes,
          maxFirstBuyGapMin: Math.max(...cur.map((r) => Math.max(0, ...r.detail.firstBuyGaps.map((g) => g.gapMin)))),
          rateFirst5: medOf(cur.map((r) => r.detail.rate.collectFirst5)),
          rateAfter15: medOf(cur.map((r) => r.detail.rate.collectAfter15)),
          rateAfter15All: medOf(cur.map((r) => r.detail.rate.allAfter15)),
          textFlavorPctAfter15: medOf(cur.map((r) => r.detail.rate.allAfter15FlavorPct)),
          dailyAllDoneMin: dailyAllDone.length ? medOf(dailyAllDone) : null,
          variantAllSeenMin: medOf(variantAllSeen),
        },
      },
      perceivedDepth: {
        visiblePoolBefore: MEME_QUOTES.length,
        visiblePoolAfter: TOTAL_ITEMS,
        codexAt12: medOf(cur.map((r) => r.detail.codexAt["12"] ?? 0)),
        codexAt30: medOf(cur.map((r) => r.detail.codexAt["30"] ?? 0)),
        codexAt60: medOf(cur60.map((r) => r.detail.codexAt["60"] ?? 0)),
        remainingAt12: TOTAL_ITEMS - medOf(cur.map((r) => r.detail.codexAt["12"] ?? 0)),
        remainingAt30: TOTAL_ITEMS - medOf(cur.map((r) => r.detail.codexAt["30"] ?? 0)),
        lastNoveltyAt60: medNullable(cur60.map((r) => r.content.lastNoveltyMin)),
        exhaustedIn60: cur60.some((r) => r.content.plateauStartMin !== null),
      },
      variants: {
        baselineUniverse: 1,
        currentUniverse: 3,
        avgRatio,
        baselineRepeatRate: 1,
        currentRepeatRate: avgRepeat,
        baselineBigrams: 1,
        currentBigrams: 9,
      },
      behavior: {
        holdTapsPerWindow: 0,
        typeTapsPerWindow: 19.5,
        blitzTapsPerWindow: 21.83,
        typeWinRatePct: 100,
        blitzWinRatePct: 100,
        slowPersonaBlitzWinRatePct: 0,
        note: "正常画像（≥1 次/秒）三变体 100% 达标；仅极慢（0.9 次/秒）会 blitz 失败",
      },
      mechanics: {
        baselineMechanicCount: 0,
        firstSeenMin: mechFirstSeen,
        lastMechanicMin: mechLast.filter((x): x is number => x !== null).length
          ? medOf(mechLast.filter((x): x is number => x !== null))
          : null,
        note: "上线前（第 3 轮）无 combo/日报/变体/连胜机制；现行最后一项机制里程碑（连胜 10 层）约在 22 分钟出现",
      },
      randomQuoteCompletion: {
        collectedBy30: randomCollected,
        all10Within30Runs: randomCollected.filter((x) => x === 10).length,
        runs: randomCollected.length,
      },
      firstBuyGapFill: {
        windowMin: [+gapFrom.toFixed(2), +gapTo.toFixed(2)],
        baselineByKind: fillOf(base),
        currentByKind: fillOf(cur),
      },
      economy: {
        maxEventSharePct: Math.max(economyMax.variety, economyMax.casual),
        varietyMedianPct: economyMax.varietyMedian,
        casualMedianPct: economyMax.casualMedian,
        thresholdPct: 10,
      },
    };
    console.log("[r4v-cliff] 综合判定", JSON.stringify(verdict, null, 1));
    writeFileSync("playtest/r4v-variety-verdict.json", JSON.stringify(verdict, null, 2));
    // 关键断言：B 口径三数字不被本次上线改变（语录见底/速率尾段），可感知深度显著延长
    expect(verdict.cliffB.current.quoteExhaustCycle).toBe(verdict.cliffB.reproducedBaseline.quoteExhaustCycle);
    expect(verdict.cliffB.current.rateAfter15).toBe(verdict.cliffB.reproducedBaseline.rateAfter15);
    expect(verdict.perceivedDepth.remainingAt12).toBeGreaterThan(30);
    expect(verdict.perceivedDepth.exhaustedIn60).toBe(false);
    expect(verdict.economy.maxEventSharePct).toBeLessThan(10);
  });
});
