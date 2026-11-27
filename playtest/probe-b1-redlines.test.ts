import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { effectOf, UPGRADES } from "../src/engine/upgrades";
import { clickPowerOf } from "../src/engine/actions";
import { onBossTap, finishPatrol, newEventState, BOSS_DURATION, BOSS_GRACE_SECONDS, BOSS_INTERVAL_MIN, BOSS_INTERVAL_MAX, BOSS_REWARD_IDLE_SECONDS } from "../src/engine/events";
import { COLLEAGUES } from "../src/engine/team";

/**
 * B1 红线复跑：同事挂机收益 + 三条天赋流派满级后，重新验证
 *  A. 事件经济占比（巡逻奖 + 丢梗）< 挂机收入 10%
 *  B. 8cps 硬刚单次巡逻胜率 50–99%
 *  C. 3cps 硬刚胜率 < 40%
 *
 * 方法：场景仍用 R6 的 6 个画像；同事收益/挂机天赋通过往 state.team 注入等级来精确抬 idleRate
 * （src 的 COLLEAGUES 每级 2/8/30/120/500，组合可精确合成任意偶数 idle）。
 * 点击天赋按点击收入倍率计入；罚款减免按 onBossTap 返回值缩放。
 */

const SCENES: { label: string; levels: Record<string, number>; moyu: number }[] = [
  { label: "clicker@30", levels: { coffee: 20, phone: 10, water: 12, chair: 5 }, moyu: 1000 },
  { label: "clicker@60", levels: { coffee: 39, phone: 31, water: 26, toilet: 13, chair: 11 }, moyu: 3000 },
  { label: "clicker@180", levels: { coffee: 91, phone: 82, water: 77, toilet: 65, chair: 62, group: 51, meeting: 38, deep: 25, retire: 11 }, moyu: 3000 },
  { label: "whale@60", levels: { coffee: 50, phone: 45, water: 40, toilet: 30, chair: 28, group: 20 }, moyu: 2000 },
  { label: "casual@120", levels: { coffee: 60, phone: 55, water: 50, toilet: 40, chair: 38, group: 28, meeting: 15 }, moyu: 200_000 },
  { label: "casual@180", levels: { coffee: 74, phone: 66, water: 61, toilet: 48, chair: 46, group: 35, meeting: 21, deep: 9 }, moyu: 2_074_746 },
];

/** 用 src 的同事表合成"额外 idle"（偶数） */
function withIdle(s: ReturnType<typeof initialState>, extraIdle: number) {
  let left = Math.max(0, Math.round(extraIdle / 2) * 2);
  const team: Record<string, { level: number; missionId: string | null; startedAt: number; endsAt: number }> = {};
  // 贪心：500 / 120 / 30 / 8 / 2，每档最多 1 个同事
  const plan: [string, number][] = [
    [COLLEAGUES[4]!.id, 500],
    [COLLEAGUES[3]!.id, 120],
    [COLLEAGUES[2]!.id, 30],
    [COLLEAGUES[1]!.id, 8],
    [COLLEAGUES[0]!.id, 2],
  ];
  for (const [id, per] of plan) {
    const lv = Math.floor(left / per);
    if (lv > 0) {
      team[id] = { level: lv, missionId: null, startedAt: 0, endsAt: 0 };
      left -= lv * per;
    }
  }
  return { ...s, team: { colleagues: team } };
}

interface Variant {
  name: string;
  /** 挂机收益倍率（同事 + 挂机天赋 + 转化） */
  idleFactor: number;
  /** 点击力倍率（点击天赋，作用于点击收入与丢梗奖励） */
  clickMult: number;
  /** 点击收入倍率（含暴击期望，不含连击；巡逻场景按 combo=0） */
  clickIncomeMult: number;
  /** 巡逻奖励倍率（事件天赋） */
  patrolMult: number;
  /** 罚款倍率（事件天赋减免） */
  penaltyMult: number;
  /** 丢梗奖励倍率（事件天赋/好感） */
  memeMult: number;
}

const VARIANTS: Variant[] = [
  { name: "基线(无新系统)", idleFactor: 1, clickMult: 1, clickIncomeMult: 1, patrolMult: 1, penaltyMult: 1, memeMult: 1 },
  { name: "同事满配(+15% idle)", idleFactor: 1.15, clickMult: 1, clickIncomeMult: 1, patrolMult: 1, penaltyMult: 1, memeMult: 1 },
  { name: "挂机流满级(+25% idle)", idleFactor: 1.25, clickMult: 1, clickIncomeMult: 1, patrolMult: 1, penaltyMult: 1, memeMult: 1 },
  { name: "点击流满级(点击力×1.25+暴击(巡逻不生效)+转化)", idleFactor: 1.35, clickMult: 1.25, clickIncomeMult: 1.25, patrolMult: 1, penaltyMult: 1, memeMult: 1 },
  { name: "事件流满级", idleFactor: 1.3, clickMult: 1, clickIncomeMult: 1, patrolMult: 1.15, penaltyMult: 0.65, memeMult: 1.1 },
  { name: "三流全满+好感满", idleFactor: 1.15 * 1.35 * 1.3, clickMult: 1.25, clickIncomeMult: 1.25, patrolMult: 1.15, penaltyMult: 0.65, memeMult: 1.1 * 1.1 },
];

const INTERVAL = (BOSS_INTERVAL_MIN + BOSS_INTERVAL_MAX) / 2;
const STREAK_AVG = 1.35; // 连胜期望乘数（1+0.1×平均连胜 3.5）
const MEME_INTERVAL = 60;
const MEME_REWARD_CLICKS = 5;

function dodgeOf(s: ReturnType<typeof initialState>, v: Variant): number {
  const es = newEventState();
  es.bossUntil = 100;
  es.bossVariant = "hold";
  es.patrolCount = 99;
  es.surviveStreak = 3;
  return finishPatrol(s, es).reward * v.patrolMult;
}

function hardOf(s: ReturnType<typeof initialState>, v: Variant, cps: number): { net: number; income: number; lost: number } {
  const es = newEventState();
  es.bossUntil = 100;
  es.bossStartAt = 100 - BOSS_DURATION;
  es.bossVariant = "hold";
  es.patrolCount = 99;
  let cur = s;
  let income = 0;
  let lost = 0;
  for (let t = BOSS_GRACE_SECONDS; t < BOSS_DURATION; t += 1 / cps) {
    const r = onBossTap(cur, es, 100 - BOSS_DURATION + t, 0);
    cur = r.state;
    income += r.income;
    lost += r.lost;
  }
  const net = income * v.clickIncomeMult - lost * v.penaltyMult;
  return { net, income, lost };
}

function pct(x: number): string {
  return (x * 100).toFixed(1) + "%";
}

describe("B1 红线（同事 + 天赋）", () => {
  it("A/B/C 全部成立", () => {
    const fail: string[] = [];
    for (const v of VARIANTS) {
      let hard8Wins = 0;
      let hard3Wins = 0;
      const sceneRows: string[] = [];
      const evRows: string[] = [];
      for (const sc of SCENES) {
        const s0 = { ...initialState(), levels: { ...sc.levels }, moyu: sc.moyu, totalEarned: sc.moyu };
        const idle0 = effectOf(s0).idleRate;
        const cp0 = clickPowerOf(s0);
        const s = withIdle(s0, idle0 * (v.idleFactor - 1));
        const idle = effectOf(s).idleRate;
        const dodge = dodgeOf(s, v);
        const h3 = hardOf(s, v, 3).net;
        const h8 = hardOf(s, v, 8).net;
        if (h8 > dodge) hard8Wins++;
        if (h3 > dodge) hard3Wins++;
        // A：事件经济占比
        if (idle >= 1000) {
          const patrolShare = (BOSS_REWARD_IDLE_SECONDS * STREAK_AVG * v.patrolMult) / (INTERVAL + 8);
          const memeShare = (MEME_REWARD_CLICKS * cp0 * v.clickMult * v.memeMult) / (MEME_INTERVAL * idle);
          const share = patrolShare + memeShare;
          evRows.push(`${sc.label} 巡逻${pct(patrolShare)} 丢梗${pct(memeShare)} 合${pct(share)}${share < 0.1 ? "" : " ✗"}`);
          if (share >= 0.1) fail.push(`${v.name}/${sc.label} 事件占比 ${pct(share)}`);
        }
        sceneRows.push(`${sc.label} idle=${idle.toFixed(0)} cp=${(cp0 * v.clickMult).toFixed(0)} 点击收入x${v.clickIncomeMult} 忍=${dodge.toFixed(0)} 3cps=${h3.toFixed(0)} 8cps=${h8.toFixed(0)}`);
      }
      const okB = hard8Wins >= 3 && hard8Wins <= 5;
      const okC = hard3Wins <= Math.floor(SCENES.length * 0.4);
      if (!okB) fail.push(`${v.name} 8cps 胜率 ${hard8Wins}/6`);
      if (!okC) fail.push(`${v.name} 3cps 胜率 ${hard3Wins}/6`);
      console.log(`\n## ${v.name}｜8cps 胜 ${hard8Wins}/6，3cps 胜 ${hard3Wins}/6`);
      console.log(sceneRows.join("\n"));
      console.log(evRows.join("\n"));
    }
    expect(fail, fail.join("；")).toEqual([]);
  });
});
