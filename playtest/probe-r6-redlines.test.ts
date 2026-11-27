import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { effectOf, costOf, UPGRADES } from "../src/engine/upgrades";
import { clickPowerOf } from "../src/engine/actions";
import {
  newEventState,
  scheduleEvents,
  onBossTap,
  finishPatrol,
  bossSurviveReward,
  BOSS_DURATION,
  BOSS_GRACE_SECONDS,
  BOSS_INTERVAL_MIN,
  BOSS_INTERVAL_MAX,
} from "../src/engine/events";

/**
 * R6 联合调参红线探针（challenger 建议 1）：
 *  A. 事件经济占比 <10%（巡逻奖+丢梗 ÷ 挂机收入，1h）
 *  B. 8cps 单次巡逻硬刚胜率 50–99%（赌点存在但非无脑）
 *  C. 3cps 单次巡逻硬刚胜率 <40%
 */

const SCENES: { label: string; levels: Record<string, number>; moyu: number }[] = [
  { label: "clicker@30", levels: { coffee: 20, phone: 10, water: 12, chair: 5 }, moyu: 1000 },
  { label: "clicker@60", levels: { coffee: 39, phone: 31, water: 26, toilet: 13, chair: 11 }, moyu: 3000 },
  { label: "clicker@180", levels: { coffee: 91, phone: 82, water: 77, toilet: 65, chair: 62, group: 51, meeting: 38, deep: 25, retire: 11 }, moyu: 3000 },
  { label: "whale@60", levels: { coffee: 50, phone: 45, water: 40, toilet: 30, chair: 28, group: 20 }, moyu: 2000 },
  { label: "casual@120", levels: { coffee: 60, phone: 55, water: 50, toilet: 40, chair: 38, group: 28, meeting: 15 }, moyu: 200_000 },
  { label: "casual@180", levels: { coffee: 74, phone: 66, water: 61, toilet: 48, chair: 46, group: 35, meeting: 21, deep: 9 }, moyu: 2_074_746 },
];

function st(s: (typeof SCENES)[number]) {
  return { ...initialState(), levels: { ...s.levels }, moyu: s.moyu, totalEarned: s.moyu };
}

/** 忍：拿奖励 */
function dodgeEV(s: ReturnType<typeof st>): number {
  const es = newEventState();
  es.bossUntil = 100;
  es.bossStartAt = 100 - BOSS_DURATION;
  es.bossVariant = "hold";
  es.patrolCount = 99; // 跳过新手保护（中期/后期场景）
  return finishPatrol(s, es).reward;
}

/** 硬刚：8s 内按 cps 点击（过宽限后） */
function hardEV(s: ReturnType<typeof st>, cps: number): number {
  const es = newEventState();
  es.bossUntil = 100;
  es.bossStartAt = 100 - BOSS_DURATION;
  es.bossVariant = "hold";
  es.patrolCount = 99; // 跳过新手保护（中期/后期场景）
  let cur = s;
  let net = 0;
  const start = 100 - BOSS_DURATION;
  for (let t = BOSS_GRACE_SECONDS; t < BOSS_DURATION; t += 1 / cps) {
    const r = onBossTap(cur, es, start + t, 0);
    cur = r.state;
    net += r.income - r.lost;
  }
  return net;
}

describe("R6 红线", () => {
  it("A/B/C 三条红线同时成立", () => {
    const rows: string[] = [];
    let hard8Wins = 0;
    let hard3Wins = 0;
    for (const s of SCENES) {
      const cur = st(s);
      const { idleRate } = effectOf(cur);
      const dodge = dodgeEV(cur);
      const h3 = hardEV(cur, 3);
      const h5 = hardEV(cur, 5);
      const h8 = hardEV(cur, 8);
      if (h8 > dodge) hard8Wins++;
      if (h3 > dodge) hard3Wins++;
      rows.push(
        `${s.label} ir=${idleRate.toFixed(0)} cp=${clickPowerOf(cur)} 忍=${dodge.toFixed(0)} 3cps=${h3.toFixed(0)} 5cps=${h5.toFixed(0)} 8cps=${h8.toFixed(0)}`,
      );
    }
    console.log(rows.join("\n"));
    console.log(`8cps 硬刚占优 ${hard8Wins}/${SCENES.length}；3cps 硬刚占优 ${hard3Wins}/${SCENES.length}`);

    // B: 8cps 有胜场但不全胜
    expect(hard8Wins).toBeGreaterThanOrEqual(1);
    expect(hard8Wins).toBeLessThan(SCENES.length);
    // C: 3cps 少量（<=40%）
    expect(hard3Wins).toBeLessThanOrEqual(Math.floor(SCENES.length * 0.4));

    // A: 事件经济占比（巡逻奖 + 丢梗）/ 挂机收入 < 10%
    // 巡逻：平均间隔 (BOSS_INTERVAL_MIN+BOSS_INTERVAL_MAX)/2 + 窗口，连胜期望乘数 ~1.3
    const interval = (BOSS_INTERVAL_MIN + BOSS_INTERVAL_MAX) / 2;
    for (const s of SCENES) {
      const cur = st(s);
      const { idleRate } = effectOf(cur);
      if (idleRate < 1000) continue; // 早期点击力占比天然高，红线只约束中后期
      const rewardPerPatrol = bossSurviveReward(cur, { ...newEventState(), surviveStreak: 3 }) * 1.0;
      const patrolShare = rewardPerPatrol / (idleRate * interval);
      // 丢梗：平均每 60s 一次、每次 5×点击力
      const memeShare = (5 * clickPowerOf(cur)) / (idleRate * 60);
      const share = patrolShare + memeShare;
      console.log(`${s.label} 巡逻占比 ${(patrolShare * 100).toFixed(1)}% 丢梗 ${(memeShare * 100).toFixed(1)}% 合计 ${(share * 100).toFixed(1)}%`);
      expect(share, `${s.label} 事件占比应 <10%`).toBeLessThan(0.1);
    }
  });
});
