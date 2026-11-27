/**
 * R8 speedrun 探针（只读 src/，不改 src/）：
 * 用真实引擎函数精确复现「从 0 到 lifetimeEarned=3.2e11」的时间，
 * 对比 ①纯挂机不转生 ②转生只挂机 ③转生+点击，并量化捷径。
 *
 * 运行：node_modules/.bin/vite-node playtest/probe-r8-sim.ts
 */
import { type GameState } from "../src/engine/state";
import { UPGRADES, costOf, marginalEffect, effectOf } from "../src/engine/upgrades";
import { clickPowerOf } from "../src/engine/actions";
import { prestigeMultiplier, prestigeGain, PRESTIGE_UNLOCK } from "../src/engine/prestige";

export const TOTAL_TARGET = 3.2e11; // 终档 lifetimeEarned
export const COMBO = 1.24; // 持续点击 ≥2.5cps 时的连击上限 ×1.24
const IDLE_IDS = ["phone", "toilet", "group", "meeting", "deep", "retire"];
const CLICK_IDS = ["coffee", "water", "chair"];

type Item = { id: string; click: boolean };

interface RunOpts {
  prestige: number; // 起始转生点
  cps: number; // 每秒点击次数（0 = 纯挂机）
  collectFull: boolean; // 图鉴 55/55（挂机 ×1.2）
  target: number; // 本局累计目标
  policy?: "affordable" | "roiSave" | "cheapest";
  maxSeconds?: number;
}

interface RunResult {
  time: number;
  purchases: number;
  levels: Record<string, number>;
  endRate: number;
  idleRate: number;
  clickRate: number;
  totalSpent: number;
  reached: boolean;
}

function freshState(prestige: number, collectFull: boolean): GameState {
  const allFlavors: number[] = [];
  for (let i = 0; i < 45; i++) allFlavors.push(i);
  return {
    moyu: 0,
    totalEarned: 0,
    levels: {},
    collected: collectFull ? { quotes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], flavors: allFlavors } : { quotes: [], flavors: [] },
    daily: null,
    surviveStreak: 0,
    totalClicks: 0,
    visits: { date: "", count: 0 },
    lifetimeEarned: 0,
    prestige,
  };
}

/** 单局模拟：自融资买升级，直到本局 totalEarned 达到 target */
export function simulateRun(o: RunOpts): RunResult {
  const policy = o.policy ?? "affordable";
  const state = freshState(o.prestige, o.collectFull);
  const M = prestigeMultiplier(o.prestige);
  const collMul = o.collectFull ? 1.2 : 1;
  const combo = o.cps >= 2.5 ? COMBO : 1;
  const items: Item[] = [];
  for (const id of IDLE_IDS) items.push({ id, click: false });
  if (o.cps > 0) for (const id of CLICK_IDS) items.push({ id, click: true });
  const maxT = o.maxSeconds ?? 400 * 86400;
  let t = 0;
  let moyu = 0;
  let earned = 0;
  let spent = 0;
  let purchases = 0;
  const levels: Record<string, number> = {};

  const clickPower = (): number => {
    // 与 actions.clickPowerOf 一致：底薪点击力只吃转生倍率；升级点击力吃转生×图鉴
    let cp = 0;
    for (const it of items) if (it.click) {
      const lv = levels[it.id] ?? 0;
      if (lv > 0) cp += marginalEffect(it.id, 0).clickPower * 0; // placeholder, real calc below
    }
    return cp;
  };
  void clickPower;

  while (earned < o.target && t < maxT) {
    // 当前速率（直接复用引擎）
    state.levels = levels;
    state.moyu = moyu;
    state.totalEarned = earned;
    const eff = effectOf(state);
    const cp = 1 * M + eff.clickPower;
    const clickRate = o.cps > 0 ? o.cps * cp * combo : 0;
    const rate = eff.idleRate + clickRate;
    const H = (o.target - earned) / Math.max(rate, 1e-12);

    // 计算每个候选的 cost / 边际收入速率 / payback
    const cands = items.map((it) => {
      const lv = levels[it.id] ?? 0;
      const c = costOf(it.id, lv);
      const m = marginalEffect(it.id, lv);
      const g = it.click ? m.clickPower * M * collMul * o.cps * combo : m.idleRate * M * collMul;
      return { ...it, lv, c, g, p: g > 0 ? c / g : Infinity };
    });

    const affordable = cands.filter((c) => c.c <= moyu);
    let choice: (typeof cands)[number] | null = null;
    if (policy === "cheapest") {
      affordable.sort((a, b) => a.c - b.c);
      choice = affordable[0] ?? null;
      if (choice && choice.p > H) choice = null;
    } else if (policy === "roiSave") {
      // 全局最低 payback，攒够再买
      const best = cands.slice().sort((a, b) => a.p - b.p)[0]!;
      if (moyu >= best.c && best.p <= H) choice = best;
      else if (best.p > H) choice = null;
      else {
        // 等待
        const wait = (best.c - moyu) / rate;
        t += wait;
        moyu += rate * wait;
        earned += rate * wait;
        continue;
      }
    } else {
      // affordable：在买得起的里面挑 payback 最小，且值得买
      affordable.sort((a, b) => a.p - b.p);
      choice = affordable[0] ?? null;
      if (choice && choice.p > H) choice = null;
      if (!choice) {
        // 等最早变得买得起的那一项（含 payback 值得的）
        const worth = cands.filter((c) => c.p <= H);
        const pool = worth.length > 0 ? worth : cands;
        let next = pool[0]!;
        for (const c of pool) if (c.c - moyu < next.c - moyu) next = c;
        const wait = Math.max(0, (next.c - moyu) / rate);
        t += wait;
        moyu += rate * wait;
        earned += rate * wait;
        continue;
      }
    }

    if (!choice) {
      // 没有任何值得买的：纯等到目标
      t += H;
      earned = o.target;
      break;
    }
    // 买下
    moyu -= choice.c;
    spent += choice.c;
    levels[choice.id] = (levels[choice.id] ?? 0) + 1;
    purchases++;
  }

  state.levels = levels;
  state.moyu = moyu;
  state.totalEarned = earned;
  const eff = effectOf(state);
  const cp = 1 * M + eff.clickPower;
  return {
    time: t,
    purchases,
    levels,
    endRate: eff.idleRate + (o.cps > 0 ? o.cps * cp * combo : 0),
    idleRate: eff.idleRate,
    clickRate: o.cps > 0 ? o.cps * cp * combo : 0,
    totalSpent: spent,
    reached: earned >= o.target,
  };
}

// ---------------- 快速冒烟：M=1 的里程碑耗时 ----------------
const targets = [1e7, 1e8, 1e9, 1e10, 3.16e10, 1e11, 3.2e11];
const policies: RunOpts["policy"][] = ["affordable", "roiSave", "cheapest"];
for (const policy of policies) {
  const rows: string[] = [];
  for (const target of targets) {
    const t0 = Date.now();
    const r = simulateRun({ prestige: 0, cps: 0, collectFull: false, target, policy });
    rows.push(
      `  ${(target / 1e8).toFixed(2)}e8: ${(r.time / 60).toFixed(1)}min  buys=${r.purchases} idle=${r.endRate.toFixed(1)}/s (${Date.now() - t0}ms)`,
    );
  }
  console.log(`[idle M=1 policy=${policy}]`);
  console.log(rows.join("\n"));
}
