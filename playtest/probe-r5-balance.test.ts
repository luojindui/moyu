import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { effectOf } from "../src/engine/upgrades";
import { onBossTap, finishPatrol, bossSurviveReward, newEventState, BOSS_DURATION } from "../src/engine/events";

/**
 * R5 平衡验证（challenger 验收 P0）：
 * 新罚款（每击 3×idleRate、整段封顶 24×idleRate、与余额脱钩）下，
 * 硬刚不应在 ≥3cps 稳定占优——目标交叉点回到 4-6cps 人类边缘。
 */

function stateFrom(levels: Record<string, number>, moyu: number) {
  return { ...initialState(), levels: { ...levels }, moyu, totalEarned: moyu };
}

function evDodge(s: ReturnType<typeof stateFrom>): number {
  const es = newEventState();
  es.bossUntil = 100;
  es.bossStartAt = 100 - BOSS_DURATION;
  es.bossVariant = "hold";
  return finishPatrol(s, es).reward;
}

function evClickThrough(s: ReturnType<typeof stateFrom>, cps: number): number {
  const es = newEventState();
  es.bossUntil = 100;
  es.bossStartAt = 100 - BOSS_DURATION;
  es.bossVariant = "hold";
  let st = s;
  let gained = 0;
  const step = 1 / cps;
  for (let t = 0; t < BOSS_DURATION; t += step) {
    const r = onBossTap(st, es, 100 - BOSS_DURATION + 1 + t); // 跳过 0.8s 宽限
    st = r.state;
    gained += r.income - r.lost;
  }
  return gained;
}

const CASES: { label: string; levels: Record<string, number>; moyu: number }[] = [
  { label: "casual@180", levels: { coffee: 74, phone: 66, water: 61, toilet: 48, chair: 46, group: 35, meeting: 21, deep: 9 }, moyu: 2_074_746 },
  { label: "clicker@180", levels: { coffee: 91, phone: 82, water: 77, toilet: 65, chair: 62, group: 51, meeting: 38, deep: 25, retire: 11 }, moyu: 3_000 },
  { label: "idle@180", levels: { coffee: 40, phone: 70, water: 30, toilet: 60, chair: 20, group: 50, meeting: 40, deep: 20 }, moyu: 5_000_000 },
  { label: "early@5min", levels: { coffee: 8, phone: 3 }, moyu: 500 },
];

describe("R5 平衡：偷点交叉点", () => {
  it("1cps 与 3cps 忍仍占优；8cps 才可能硬刚占优（交叉点回到人类边缘）", () => {
    const rows: string[] = [];
    const verdict: Record<string, { dodge: number; click3: number; click8: number }> = {};
    for (const c of CASES) {
      const s = stateFrom(c.levels, c.moyu);
      const { idleRate } = effectOf(s);
      const dodge = evDodge(s);
      const c1 = evClickThrough(s, 1);
      const c3 = evClickThrough(s, 3);
      const c5 = evClickThrough(s, 5);
      const c8 = evClickThrough(s, 8);
      verdict[c.label] = { dodge, click3: c3, click8: c8 };
      rows.push(
        `${c.label} idle=${idleRate.toFixed(1)} 忍=${dodge.toFixed(0)} | 1cps=${c1.toFixed(0)} 3cps=${c3.toFixed(0)} 5cps=${c5.toFixed(0)} 8cps=${c8.toFixed(0)}`,
      );
    }
    console.log(rows.join("\n"));
    // 核心断言：中后期（idleRate ≥ 1000）3cps 下"忍"占优（无脑连点不再最优）
    for (const c of CASES) {
      const s = stateFrom(c.levels, c.moyu);
      const { idleRate } = effectOf(s);
      if (idleRate < 1000) continue; // 早期点击本就是主要收入来源，允许硬刚（奖励也小）
      const v = verdict[c.label]!;
      expect(v.click3, `${c.label} 3cps 硬刚不应优于忍`).toBeLessThanOrEqual(v.dodge + 1);
    }
    // 至少存在一个 8cps 硬刚占优的场景（真赌点仍存在）
    const any8 = Object.values(verdict).some((v) => v.click8 > v.dodge);
    expect(any8).toBe(true);
    // 交叉点落在人类手速边缘（4-8cps 之间至少一档翻转）
    const casual = verdict["casual@180"];
    if (casual) {
      expect(casual.click3).toBeLessThanOrEqual(casual.dodge);
      expect(casual.click8).toBeGreaterThan(casual.dodge);
    }
  });
});
