/**
 * probe-r4v-variety-impact.test.ts — 验收 1/2 的行为层：变体比例、同 pattern 重复下降、
 * type/blitz 是否真的改变玩家行为（点击率差异）、横幅文案、连击链收益。
 * 只 import playtest 库 + src/engine + src/render（不改 src/）。
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import {
  PERSONAS,
  simulate,
  patrolVariantSequence,
  lcg,
  type SimResult,
  type VarietyPersona,
} from "./probe-r4v-variety-lib";

/** 极慢画像：验证 blitz 目标 12 次的真实难度下限（>1.5 次/秒才达标） */
const SLOW: VarietyPersona = {
  name: "slow(单手慢速党)",
  baseTps: 0.7,
  burstTps: 0.9,
  reactionSec: 0.6,
  buyEverySec: 40,
  pick: "cheapest",
  tapMemes: true,
  dodgeHold: true,
  jitter: 0.6,
};
import { bossBannerText } from "../src/render/scene";
import { BOSS_VARIANTS, BOSS_TYPE_TARGET, BOSS_BLITZ_TARGET, BOSS_DURATION, type BossVariant } from "../src/engine/events";
import { comboMultiplier, doClick, COMBO_MAX } from "../src/engine/actions";
import { initialState } from "../src/engine/state";

const MINUTES = 30;
const SEEDS = [1000, 8919, 16838, 24757, 32676, 40595];

function summarizeSeq(seq: BossVariant[]) {
  const counts: Record<BossVariant, number> = { hold: 0, type: 0, blitz: 0 };
  for (const v of seq) counts[v] += 1;
  const n = seq.length;
  let repeats = 0;
  const bigrams: Record<string, number> = {};
  let maxRun = 1;
  let run = 1;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      if (seq[i] === seq[i - 1]) {
        repeats += 1;
        run += 1;
        maxRun = Math.max(maxRun, run);
      } else {
        run = 1;
      }
      const g = `${seq[i - 1]}→${seq[i]}`;
      bigrams[g] = (bigrams[g] ?? 0) + 1;
    }
  }
  const entropy = -BOSS_VARIANTS.reduce((acc, v) => {
    const p = counts[v] / n;
    return acc + (p > 0 ? p * Math.log2(p) : 0);
  }, 0);
  // 理论同 pattern 重复率 = Σp² = 0.4²+0.35²+0.25²
  const expectedRepeat = 0.4 ** 2 + 0.35 ** 2 + 0.25 ** 2;
  return {
    windows: n,
    ratio: { hold: +(counts.hold / n).toFixed(3), type: +(counts.type / n).toFixed(3), blitz: +(counts.blitz / n).toFixed(3) },
    repeatRate: +(repeats / Math.max(1, n - 1)).toFixed(3),
    expectedRepeatRate: +expectedRepeat.toFixed(3),
    distinctBigrams: Object.keys(bigrams).length,
    bigramPool: 9,
    maxRun,
    entropy: +entropy.toFixed(3),
    entropyMax: +Math.log2(3).toFixed(3),
    normalizedEntropy: +(entropy / Math.log2(3)).toFixed(3),
  };
}

describe("R4V 多样性 · 变体比例与同 pattern 重复", () => {
  it("3 小时 × 20 种子：三变体比例贴近 40/35/25，同 pattern 重复率从 100% 降到 ~34.5%", () => {
    const runs = Array.from({ length: 20 }, (_, i) => summarizeSeq(patrolVariantSequence(1000 + i * 7919, 180)));
    const avg = (f: (r: (typeof runs)[number]) => number): number =>
      +(runs.reduce((a, r) => a + f(r), 0) / runs.length).toFixed(3);
    const summary = {
      seeds: runs.length,
      windowsPerSeed: runs[0]!.windows,
      ratioHold: avg((r) => r.ratio.hold),
      ratioType: avg((r) => r.ratio.type),
      ratioBlitz: avg((r) => r.ratio.blitz),
      baselineRepeatRate: 1.0,
      currentRepeatRate: avg((r) => r.repeatRate),
      theoreticalRepeatRate: runs[0]!.expectedRepeatRate,
      distinctBigramsAvg: avg((r) => r.distinctBigrams),
      baselineDistinctBigrams: 1,
      maxRunAvg: avg((r) => r.maxRun),
      baselineMaxRun: runs[0]!.windows,
      entropy: avg((r) => r.entropy),
      entropyMax: runs[0]!.entropyMax,
      normalizedEntropy: avg((r) => r.normalizedEntropy),
    };
    console.log("[r4v-impact] 变体比例/重复", JSON.stringify(summary, null, 1));
    expect(summary.ratioHold).toBeGreaterThan(0.375);
    expect(summary.ratioHold).toBeLessThan(0.425);
    expect(summary.ratioType).toBeGreaterThan(0.325);
    expect(summary.ratioType).toBeLessThan(0.375);
    expect(summary.ratioBlitz).toBeGreaterThan(0.225);
    expect(summary.ratioBlitz).toBeLessThan(0.275);
    // 同 pattern 重复率显著低于上线前的 100%
    expect(summary.currentRepeatRate).toBeLessThan(0.4);
    expect(summary.currentRepeatRate).toBeGreaterThan(0.3);
    // 9 种 pattern 转移全部出现过（上线前只有 1 种 hold→hold）
    expect(summary.distinctBigramsAvg).toBeGreaterThan(8);
    expect(summary.entropy).toBeGreaterThan(1.5);
    writeFileSync("playtest/r4v-variety-variants.json", JSON.stringify({ probe: "r4v-variety-variants", perSeed: runs, summary }, null, 2));
  });

  it("type/blitz 真的改变了玩家行为：巡逻窗口内点击率 hold≈0、type/blitz 明显 >0，且达标率分层", () => {
    const results: SimResult[] = [];
    const allPersonas = [...PERSONAS, SLOW];
    for (const p of allPersonas) for (const seed of SEEDS) results.push(simulate({ persona: p, mode: "current", minutes: MINUTES, seed }));
    const byPersona = allPersonas.map((p) => {
      const rs = results.filter((r) => r.persona === p.name);
      const behavior = {} as Record<BossVariant, { windows: number; tapsPerWindow: number; winRatePct: number; clicksPerSec: number }>;
      for (const v of BOSS_VARIANTS) {
        const ws = rs.flatMap((r) => r.windows.filter((w) => w.variant === v));
        const taps = ws.reduce((a, w) => a + w.taps, 0);
        const wins = ws.filter((w) => w.won).length;
        behavior[v] = {
          windows: ws.length,
          tapsPerWindow: +(taps / Math.max(1, ws.length)).toFixed(2),
          winRatePct: +((wins / Math.max(1, ws.length)) * 100).toFixed(1),
          clicksPerSec: +(taps / Math.max(1, ws.length * BOSS_DURATION)).toFixed(2),
        };
      }
      return { persona: p.name, baseTps: p.baseTps, burstTps: p.burstTps, behavior };
    });
    console.log("[r4v-impact] 变体行为", JSON.stringify(byPersona, null, 1));
    for (const row of byPersona) {
      // hold：多玩法党停手 → 窗口内几乎零点击
      expect(row.behavior.hold.tapsPerWindow).toBeLessThan(0.2);
      // type/blitz：真的开始点 → 窗口内点击率显著 > 0（至少 1 次/秒量级）
      // ≥1 次/秒量级（工作区 r5 改动让 0.8s 宽限期点击不计入 type/blitz，故放宽到 0.5）
      expect(row.behavior.type.clicksPerSec).toBeGreaterThan(0.5);
      expect(row.behavior.blitz.clicksPerSec).toBeGreaterThan(0.5);
      // 行为分层：blitz 需要的点击数更多
      expect(row.behavior.blitz.tapsPerWindow).toBeGreaterThan(row.behavior.type.tapsPerWindow);
      // 变体达标率：type 应基本必达（简单），blitz 对休闲党是难点
      expect(row.behavior.type.winRatePct).toBeGreaterThan(90);
    }
    // 难度门槛实测：正常画像（≥1 次/秒）三变体 100% 达标 → 变体目前无失败风险；
    // 只有极慢画像（burst 0.9 次/秒 < 12 次/8s = 1.5 次/秒）才会 blitz 失败，而 type（5 次）仍可达。
    const slow = byPersona.find((r) => r.persona.includes("慢速"))!;
    const varietyRow = byPersona.find((r) => r.persona.includes("多玩法"))!;
    expect(varietyRow.behavior.blitz.winRatePct).toBeGreaterThan(95);
    expect(slow.behavior.blitz.winRatePct).toBeLessThan(varietyRow.behavior.blitz.winRatePct);
    expect(slow.behavior.blitz.winRatePct).toBeLessThan(20);
    expect(slow.behavior.type.winRatePct).toBeGreaterThan(70);
    console.log(
      "[r4v-impact] 难度门槛：blitz 12次/8s=1.5次/秒；极慢画像(0.9次/秒) blitz 达标率",
      slow.behavior.blitz.winRatePct,
      "% / type",
      slow.behavior.type.winRatePct,
      "%",
    );
    writeFileSync("playtest/r4v-variety-behavior.json", JSON.stringify({ probe: "r4v-variety-behavior", byPersona }, null, 2));
  });

  it("横幅文案三变体齐全且带进度（type 5 / blitz 20 / hold 忍住）", () => {
    const texts = {
      hold: bossBannerText("hold", 5, 0),
      type: bossBannerText("type", 5, 3),
      blitz: bossBannerText("blitz", 5, 9),
      typeFull: bossBannerText("type", 0, 99),
      blitzFull: bossBannerText("blitz", 0, 99),
    };
    console.log("[r4v-impact] 横幅", JSON.stringify(texts, null, 1));
    expect(texts.hold).toContain("忍住别点");
    expect(texts.hold).toContain("5s");
    expect(texts.type).toContain(`3/${BOSS_TYPE_TARGET}`);
    expect(texts.blitz).toContain(`9/${BOSS_BLITZ_TARGET}`);
    // 进度不越界（点满后仍显示 5/5、20/20）
    expect(texts.typeFull).toContain(`5/${BOSS_TYPE_TARGET}`);
    expect(texts.blitzFull).toContain(`${BOSS_BLITZ_TARGET}/${BOSS_BLITZ_TARGET}`);
    // 三个变体文案互不相同（不会一眼同 pattern）
    expect(new Set([texts.hold, texts.type, texts.blitz]).size).toBe(3);
  });
});

describe("R4V 多样性 · 连击链（收益增幅 + 行为门槛）", () => {
  it("连击乘数：0→1.00、6→1.12、12→1.24，封顶 12 后不再涨", () => {
    const vals = [0, 1, 6, 11, 12, 13, 50].map((c) => +comboMultiplier(c).toFixed(2));
    console.log("[r4v-impact] 连击乘数", JSON.stringify({ combo: [0, 1, 6, 11, 12, 13, 50], mult: vals }));
    expect(vals[0]).toBe(1);
    expect(vals[2]).toBe(1.12);
    expect(vals[4]).toBe(1.24);
    expect(vals[5]).toBe(1.24);
    expect(vals[6]).toBe(1.24);
    // 实际收入：combo=12 的一次点击 = 点击力 ×1.24
    const s = initialState();
    const m = doClick(s, 12);
    expect(m.moyu).toBeCloseTo(1.24, 5);
    expect(comboMultiplier(COMBO_MAX)).toBe(1.24);
  });

  it("连击链确实带来收入提升，且门槛（>2.5 次/秒）让画像间有差异", () => {
    const rows = PERSONAS.map((p) => {
      const withCombo = SEEDS.map((seed) => simulate({ persona: p, mode: "current", minutes: MINUTES, seed }));
      const noCombo = SEEDS.map((seed) => simulate({ persona: p, mode: "current", minutes: MINUTES, seed, comboEnabled: false }));
      const med = (xs: number[]): number => {
        const s = [...xs].sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
      };
      const tWith = med(withCombo.map((r) => r.end.totalEarned));
      const tWithout = med(noCombo.map((r) => r.end.totalEarned));
      const avg = (arr: number[]): number => arr.reduce((a, b) => a + b, 0) / arr.length;
      return {
        persona: p.name,
        baseTps: p.baseTps,
        comboUpliftPct: +(((tWith - tWithout) / tWithout) * 100).toFixed(2),
        avgCombo: +avg(withCombo.map((r) => r.combo.avgCombo)).toFixed(2),
        pctComboGE6: +avg(withCombo.map((r) => r.combo.pctComboGE6)).toFixed(1),
        maxCombo: Math.max(...withCombo.map((r) => r.combo.maxCombo)),
      };
    });
    console.log("[r4v-impact] 连击收益", JSON.stringify(rows, null, 1));
    for (const r of rows) {
      expect(r.comboUpliftPct).toBeGreaterThanOrEqual(0);
      expect(r.comboUpliftPct).toBeLessThan(24); // 理论上限 ×1.24
    }
    // 高点击率画像吃到的连击收益 > 低点击率画像（0.4s 窗口是真实门槛）
    const clicker = rows.find((r) => r.persona.includes("狂点"))!;
    const casual = rows.find((r) => r.persona.includes("休闲"))!;
    expect(clicker.comboUpliftPct).toBeGreaterThan(casual.comboUpliftPct);
    expect(clicker.pctComboGE6).toBeGreaterThan(casual.pctComboGE6);
    writeFileSync("playtest/r4v-variety-combo.json", JSON.stringify({ probe: "r4v-variety-combo", rows }, null, 2));
  });
});

describe("R4V 多样性 · 事件经济占比（应仍 <10%）", () => {
  it("事件收入（巡逻奖+丢梗）占总收入比例：主画像 <10%，全画像给出实测", () => {
    const rows = PERSONAS.map((p) => {
      const runs = SEEDS.map((seed) => simulate({ persona: p, mode: "current", minutes: MINUTES, seed }));
      const med = (xs: number[]): number => {
        const s = [...xs].sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
      };
      return {
        persona: p.name,
        medianEventSharePct: +med(runs.map((r) => r.economy.eventSharePct)).toFixed(2),
        medianEventNetSharePct: +med(runs.map((r) => r.economy.eventNetSharePct)).toFixed(2),
        bossRewards: Math.round(med(runs.map((r) => r.economy.bossRewards))),
        memeEarnings: Math.round(med(runs.map((r) => r.economy.memeEarnings))),
        penalties: Math.round(med(runs.map((r) => r.economy.penalties))),
        blitzBonus: Math.round(med(runs.map((r) => r.economy.blitzBonus))),
        bossWindows: med(runs.map((r) => r.economy.bossWindows)),
        memeWindows: med(runs.map((r) => r.economy.memeWindows)),
        totalEarned: Math.round(med(runs.map((r) => r.economy.totalEarned))),
      };
    });
    console.log("[r4v-impact] 事件经济占比", JSON.stringify(rows, null, 1));
    const primary = rows.find((r) => r.persona.includes("多玩法"))!;
    expect(primary.medianEventSharePct).toBeLessThan(10);
    // 变量加成（blitz×1.5 + 连胜）存在但不至于把事件变成主要收入
    for (const r of rows) expect(r.medianEventSharePct).toBeLessThan(15);
    writeFileSync("playtest/r4v-variety-economy.json", JSON.stringify({ probe: "r4v-variety-economy", rows }, null, 2));
  });
});
