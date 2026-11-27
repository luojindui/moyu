/**
 * R9 · 音游/节奏党定量模拟（只读 src/，不改任何游戏文件）。
 *
 * 目的：把"连击窗口是否合理 / blitz 2.5cps 够不够 / 节拍感"从主观感受变成数字。
 * 运行：npx vitest run --config playtest/vitest.r9.config.ts
 */
import { describe, expect, it } from "vitest";
import { COMBO_WINDOW_S, COMBO_BREAK_S, COMBO_MAX, comboMultiplier } from "../src/engine/actions";
import { BOSS_BLITZ_TARGET, BOSS_DURATION, BOSS_GRACE_SECONDS } from "../src/engine/events";

/* ---------- 与 src/main.ts 第 150 行完全一致的连击状态机 ---------- */
export function comboStep(prev: number, gap: number, windowS = COMBO_WINDOW_S, breakS = COMBO_BREAK_S): number {
  if (gap < windowS) return Math.min(COMBO_MAX, prev + 1);
  if (gap > breakS) return 0;
  return prev; // 0.4s~1.5s：既不涨也不断（现状语义）
}

/** 人类点击间隔：周期 × (1 + jitter·U[-1,1])，也可叠 lognormal 长尾 */
export function makeGaps(cps: number, jitter: number, n: number, rng: () => number): number[] {
  const period = 1 / cps;
  const gaps: number[] = [];
  for (let i = 0; i < n; i++) gaps.push(period * (1 + jitter * (rng() * 2 - 1)));
  return gaps;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ComboRun {
  maxCombo: number;
  avgCombo: number;
  avgMult: number;
  advanceRate: number;
  reachedCapAt: number | null;
}

function runCombo(cps: number, jitter: number, n: number, seed: number, windowS = COMBO_WINDOW_S, breakS = COMBO_BREAK_S): ComboRun {
  const rng = mulberry32(seed);
  const gaps = makeGaps(cps, jitter, n, rng);
  let combo = 0;
  let advanced = 0;
  let sum = 0;
  let capAt: number | null = null;
  for (let i = 0; i < gaps.length; i++) {
    const before = combo;
    combo = comboStep(combo, gaps[i], windowS, breakS);
    if (combo > before) advanced++;
    if (combo >= COMBO_MAX && capAt === null) capAt = i + 1;
    sum += combo;
  }
  return {
    maxCombo: combo,
    avgCombo: sum / gaps.length,
    avgMult: 1 + 0.02 * (sum / gaps.length),
    advanceRate: advanced / gaps.length,
    reachedCapAt: capAt,
  };
}

describe("R9 连击窗口 / blitz 节奏设计探针", () => {
  it("现状语义：0.4s 内涨、0.4~1.5s 保持、>1.5s 清零", () => {
    expect(COMBO_WINDOW_S).toBe(0.4);
    expect(COMBO_BREAK_S).toBe(1.5);
    expect(COMBO_MAX).toBe(12);
    expect(comboStep(2, 0.39)).toBe(3); // 涨
    expect(comboStep(2, 0.42)).toBe(2); // 保持（不涨）
    expect(comboStep(2, 1.49)).toBe(2); // 1.49s 空档仍不断
    expect(comboStep(2, 1.51)).toBe(0); // 才清零
    expect(comboMultiplier(12)).toBeCloseTo(1.24, 10);
    expect(comboMultiplier(30)).toBeCloseTo(1.24, 10); // 封顶后长连无收益
  });

  it("不同 cps 下 combo 的爬升能力（jitter 15%，10s）", () => {
    const rows = [];
    for (const cps of [1.5, 2, 2.5, 3, 4, 5, 8]) {
      const r = runCombo(cps, 0.15, Math.round(cps * 10), 12345 + cps * 100);
      rows.push({
        cps,
        "gap均值ms": Math.round(1000 / cps),
        "推进率%": Math.round(r.advanceRate * 100),
        "最高连击": r.maxCombo,
        "平均倍率": Number(r.avgMult.toFixed(3)),
        "到12连需点击": r.reachedCapAt ?? "未达到",
      });
    }
    console.log("\n[现状 0.4s/1.5s] 10 秒连点连击表现（每档 1000 次模拟取均值略）");
    console.table(rows);
    // 现状：2.5cps 恰好卡在窗口边界 —— 推进率约 50%
    const r25 = runCombo(2.5, 0.15, 2000, 999);
    expect(r25.advanceRate).toBeGreaterThan(0.4);
    expect(r25.advanceRate).toBeLessThan(0.6);
    // 3cps 才能稳定推进
    const r3 = runCombo(3, 0.15, 2000, 999);
    expect(r3.advanceRate).toBeGreaterThan(0.97);
  });

  it("窗口宽度扫描：0.4→0.5s 后 2.5cps 从'半推半断'变'稳推'", () => {
    const rows = [];
    for (const w of [0.35, 0.4, 0.45, 0.5, 0.55]) {
      const line: Record<string, unknown> = { "窗口s": w };
      for (const cps of [2, 2.5, 3, 4]) {
        const r = runCombo(cps, 0.15, 2000, 777 + cps, w, 0.9);
        line[`${cps}cps推进率%`] = Math.round(r.advanceRate * 100);
        line[`${cps}cps到12连`] = r.reachedCapAt ?? "未达到";
      }
      rows.push(line);
    }
    console.log("\n[窗口扫描] 不同连击窗口下各 cps 的推进率 / 到 12 连所需点击数（jitter 15%）");
    console.table(rows);
    const w40 = runCombo(2.5, 0.15, 2000, 777 + 2.5, 0.4, 0.9);
    const w50 = runCombo(2.5, 0.15, 2000, 777 + 2.5, 0.5, 0.9);
    expect(w50.advanceRate).toBeGreaterThan(w40.advanceRate + 0.2);
  });

  it("断点扫描：1.5s 太长（1.4s 空档不断），0.9s 才有'漏拍就断'的节奏压力", () => {
    const row = [];
    for (const brk of [0.8, 0.9, 1.0, 1.2, 1.5, 2.0]) {
      // 12 连后停 p 秒再点，看连击是否保住
      const survive = [0.6, 0.9, 1.2, 1.4, 1.5, 1.7].map((p) => (p > brk ? 0 : 1));
      row.push({ "断点s": brk, "停0.6s后": survive[0], "停0.9s后": survive[1], "停1.2s后": survive[2], "停1.4s后": survive[3], "停1.5s后": survive[4], "停1.7s后": survive[5] });
    }
    console.log("\n[断点扫描] 停止 p 秒后连击是否还活着（1=活，0=清零）");
    console.table(row);
    expect(comboStep(9, 1.4)).toBe(9); // 现状：1.4s 空档连击还在
    expect(comboStep(9, 1.4, 0.45, 0.9)).toBe(0); // 建议值：断
  });

  it("blitz 达标率：20 次 / 8s，先扣 0.8s 宽限 + 真人反应时间", () => {
    const target = BOSS_BLITZ_TARGET; // 20
    const duration = BOSS_DURATION; // 8
    const grace = BOSS_GRACE_SECONDS; // 0.8（type/blitz 也会被吞，见 src/engine/events.ts onBossTap 第 145 行）
    const rows = [];
    for (const cps of [1.8, 2.0, 2.2, 2.5, 2.8, 3.0, 4.0, 6.0, 8.0]) {
      for (const reaction of [0.2, 0.4]) {
        const trials = 3000;
        const rng = mulberry32(2024 + Math.round(cps * 10) + Math.round(reaction * 10));
        let pass = 0;
        let sumFinish = 0;
        let finished = 0;
        for (let t = 0; t < trials; t++) {
          let time = reaction; // 看到横幅 → 开始点
          let counted = 0;
          const period = 1 / cps;
          let endAt: number | null = null;
          while (time < duration) {
            // 点击落在宽限内：onBossTap 直接 return，不计入 bossTaps
            if (time >= grace) {
              counted++;
              if (counted >= target && endAt === null) endAt = time;
            }
            time += period * (1 + 0.18 * (rng() * 2 - 1));
          }
          if (counted >= target) {
            pass++;
            sumFinish += endAt ?? duration;
            finished++;
          }
        }
        rows.push({
          "cps": cps,
          "反应s": reaction,
          "达标率%": Math.round((pass / trials) * 100),
          "平均完成s": finished ? Number((sumFinish / finished).toFixed(2)) : "—",
          "理论最少cps": Number((target / (duration - grace - reaction)).toFixed(2)),
        });
      }
    }
    console.log("\n[blitz 达标率] 10cps 抖动18%，宽限 0.8s 内点击被吞（不计数）");
    console.table(rows);
    // 2.5cps 理论要求 2.78cps（20/(8-0.8-0.4)），实测达标率远低于 100%
    const t25 = rows.find((r) => r.cps === 2.5 && r.反应s === 0.2)!;
    expect(Number(t25["理论最少cps"])).toBeGreaterThan(2.5);
  });

  it("blitz 效率：8cps 无脑连打 2.5s 就达标，难度与手速不成正比", () => {
    const grace = BOSS_GRACE_SECONDS;
    const target = BOSS_BLITZ_TARGET;
    const durations = [];
    for (const cps of [2.5, 3, 4, 6, 8, 10]) {
      const t = target / cps; // 宽限后按 cps 计数
      durations.push({ cps, "达标用时s(宽限后)": Number(t.toFixed(2)), "占8s窗口%": Math.round((t / BOSS_DURATION) * 100) });
    }
    console.log("\n[blitz 达标用时]");
    console.table(durations);
    expect(8 / target).toBeLessThan(BOSS_DURATION - grace); // 2.5cps 理论刚好不够（含反应时间后）
  });

  it("连击经济：满连 1.24×，12 连后再点无额外收益；建议把链条拉长但倍率不变", () => {
    const rows = [];
    for (const cps of [2.5, 3, 5, 8]) {
      const reachS = COMBO_MAX / cps;
      rows.push({ "cps": cps, "到12连s": Number(reachS.toFixed(2)), "到顶后每秒收益": "不再增长", "满连加成%": 24 });
    }
    console.log("\n[连击经济] 12 连封顶后链条长度无意义，节奏党缺'继续连'的目标");
    console.table(rows);
    // 建议：窗口 0.45 / 断点 0.9 / 0.012×20 连（倍率仍 1.24 封顶，链条 20 连）
    const suggested = runCombo(2.5, 0.15, 200, 42, 0.45, 0.9);
    expect(suggested.advanceRate).toBeGreaterThan(0.9);
    const suggestedCap = 1 + 0.012 * 20;
    expect(suggestedCap).toBeCloseTo(1.24, 10);
  });
});
