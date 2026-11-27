/**
 * R8 竞速党（speedrun）主探针：三条路线时长、图鉴路线、捷径量化、转生曲线。
 * 只读 src/；不改游戏文件。运行：node_modules/.bin/vite-node playtest/probe-r8-speedrun.ts
 *
 * 覆盖两个转生模型：
 *  - CURRENT = 当前 HEAD（线性 +75%/点、3×(x/1e8)^0.4 封顶 20、保留 80% 等级）
 *  - LEGACY  = 任务简报 HEAD 06041a1（×1.08 复利、2×(x/1e8)^0.4 封顶 20、本局全重置）
 */
import { writeFileSync } from "node:fs";
import { effectOf as _effectOf, costOf as _costOf, marginalEffect as _marginalEffect } from "../src/engine/upgrades";
import { execSync } from "node:child_process";
import {
  CURRENT,
  LEGACY,
  runFrom,
  applyPrestige,
  noPrestigeRoute,
  TOTAL_TARGET,
  IDLE_IDS,
  costToLevel,
  COLLECTION_LEVEL,
  collectionIdleCost,
  type Levels,
  type PrestigeModel,
} from "./probe-r8-speedrun-lib";

const H = (s: number): number => Math.round((s / 3600) * 100) / 100; // 小时
const M_ = (s: number): number => Math.round((s / 60) * 10) / 10; // 分钟

const HEAD = execSync("git rev-parse --short HEAD", { cwd: process.cwd() }).toString().trim();

// ---------------------------------------------------------------------------
// farm + finish 搜索
// ---------------------------------------------------------------------------
interface FarmRun {
  index: number;
  startPrestige: number;
  multiplier: number;
  target: number;
  time: number;
  points: number;
  cumulativeTime: number;
  lifetimeAfter: number;
  idleRate: number;
}
interface FarmBest {
  theta: number;
  n: number;
  total: number;
  farmTime: number;
  finalTime: number;
  prestige: number;
  multiplier: number;
  finalIdle: number;
  runs: FarmRun[];
}

function farmCurve(model: PrestigeModel, cps: number, theta: number, N: number, collectFull = false): FarmBest | null {
  let levels: Levels = {};
  let P = 0;
  let life = 0;
  let t = 0;
  const runs: FarmRun[] = [];
  let best: FarmBest | null = null;
  for (let n = 0; n <= N; n++) {
    const remaining = TOTAL_TARGET - life;
    if (remaining <= 0) break;
    const fr = runFrom({ model, prestige: P, levels0: levels, target: remaining, cps, collectFull });
    const total = t + fr.time;
    if (!best || total < best.total) {
      best = {
        theta,
        n,
        total,
        farmTime: t,
        finalTime: fr.time,
        prestige: P,
        multiplier: model.mult(P),
        finalIdle: fr.idleRate,
        runs: runs.slice(),
      };
    }
    // 只靠 farm 已经比当前最优还慢 → 后面不可能更好
    if (best && t > best.total) break;
    if (remaining <= theta) break;
    const r = runFrom({ model, prestige: P, levels0: levels, target: theta, cps, collectFull });
    const pts = model.gain(theta);
    runs.push({
      index: n + 1,
      startPrestige: P,
      multiplier: model.mult(P),
      target: theta,
      time: r.time,
      points: pts,
      cumulativeTime: t,
      lifetimeAfter: life + theta,
      idleRate: r.idleRate,
    });
    life += theta;
    t += r.time;
    P += pts;
    levels = applyPrestige(r.levels, model);
  }
  return best;
}

const THETAS = [1e8, 2e8, 3e8, 5e8, 7e8, 1e9, 1.5e9, 2e9, 3e9, 5e9, 7e9, 1e10, 1.15e10];
function maxN(theta: number): number {
  if (theta <= 2e8) return 800;
  if (theta <= 5e8) return 500;
  if (theta <= 2e9) return 260;
  if (theta <= 5e9) return 160;
  return 90;
}

function bestRoute(model: PrestigeModel, cps: number, collectFull = false): FarmBest {
  let best: FarmBest | null = null;
  for (const th of THETAS) {
    const b = farmCurve(model, cps, th, maxN(th), collectFull);
    if (b && (!best || b.total < best.total)) best = b;
  }
  return best!;
}

const t0 = Date.now();
const out: Record<string, unknown> = { meta: { head: HEAD, generatedAt: new Date().toISOString() } };

// ---------------------------------------------------------------------------
// 1) 三条路线（当前 HEAD 机制）
// ---------------------------------------------------------------------------
const routeA_idle = noPrestigeRoute({ model: CURRENT });
const routeB_idle = bestRoute(CURRENT, 0);
const routeC_c5 = bestRoute(CURRENT, 5);
const routeC_c8 = bestRoute(CURRENT, 8);
const routeC_c20 = bestRoute(CURRENT, 20);
const routeC_c100 = bestRoute(CURRENT, 100);
const routeC_c1000 = bestRoute(CURRENT, 1000);
const routeA_c5 = noPrestigeRoute({ model: CURRENT, cps: 5 });
const routeA_c8 = noPrestigeRoute({ model: CURRENT, cps: 8 });
const routeA_c1000 = noPrestigeRoute({ model: CURRENT, cps: 1000 });

console.log(`HEAD=${HEAD}  (${Date.now() - t0}ms)`);
console.log(`A 纯挂机不转生:        ${H(routeA_idle.time)}h = ${M_(routeA_idle.time)}min`);
console.log(`A 纯点击5cps不转生:    ${H(routeA_c5.time)}h`);
console.log(`A 纯点击1000cps不转生: ${H(routeA_c1000.time)}h`);
console.log(`B 转生+纯挂机:         ${H(routeB_idle.total)}h  θ=${routeB_idle.theta.toExponential(1)} n=${routeB_idle.n} P=${routeB_idle.prestige} M=${routeB_idle.multiplier.toFixed(1)} (farm ${M_(routeB_idle.farmTime)}min + final ${M_(routeB_idle.finalTime)}min)`);
console.log(`C 转生+点击5cps:       ${H(routeC_c5.total)}h  θ=${routeC_c5.theta.toExponential(1)} n=${routeC_c5.n} P=${routeC_c5.prestige} (farm ${M_(routeC_c5.farmTime)}min + final ${M_(routeC_c5.finalTime)}min)`);
console.log(`C 转生+点击8cps:       ${H(routeC_c8.total)}h  θ=${routeC_c8.theta.toExponential(1)} n=${routeC_c8.n} P=${routeC_c8.prestige}`);
console.log(`C 转生+点击20cps:      ${H(routeC_c20.total)}h  n=${routeC_c20.n}`);
console.log(`C 转生+点击100cps:     ${H(routeC_c100.total)}h  n=${routeC_c100.n}`);
console.log(`C 转生+点击1000cps:    ${H(routeC_c1000.total)}h  n=${routeC_c1000.n}`);
console.log(`[对照] 简报 06041a1 机制（×1.08/点、全重置）:`);
const legacyB = bestRoute(LEGACY, 0);
const legacyC5 = bestRoute(LEGACY, 5);
const legacyC8 = bestRoute(LEGACY, 8);
const legacyA = noPrestigeRoute({ model: LEGACY });
console.log(`  A ${H(legacyA.time)}h | B ${H(legacyB.total)}h (θ=${legacyB.theta.toExponential(1)}, n=${legacyB.n}, P=${legacyB.prestige}) | C5 ${H(legacyC5.total)}h | C8 ${H(legacyC8.total)}h`);

// 关键节点表（当前 HEAD，B/C）
function nodes(best: FarmBest, totals: number[]): Record<string, string> {
  const spans = best.runs.map((r) => ({
    t0: r.cumulativeTime,
    t1: r.cumulativeTime + r.time,
    l0: r.lifetimeAfter - r.target,
    l1: r.lifetimeAfter,
  }));
  const lastLife = spans.length > 0 ? spans[spans.length - 1]!.l1 : 0;
  spans.push({ t0: best.farmTime, t1: best.farmTime + best.finalTime, l0: lastLife, l1: TOTAL_TARGET });
  const map: Record<string, string> = {};
  for (const target of totals) {
    let found: number | null = null;
    for (const sp of spans) {
      if (sp.l1 >= target) {
        const span = sp.l1 - sp.l0;
        const frac = span > 0 ? (target - sp.l0) / span : 1;
        found = sp.t0 + (sp.t1 - sp.t0) * Math.min(1, Math.max(0, frac));
        break;
      }
    }
    map[target.toExponential(1)] = found === null ? "未达" : `${M_(found)}min`;
  }
  return map;
}

const nodeTotals = [1e8, 1e9, 1e10, 1e11, 3.2e11];
// 不转生路线的段位节点（同一次跑到 3.2e11 内跨段位的时间）
const RANK_ATS = [1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 2.5e9, 5e9, 1e10, 2e10, 4e10, 8e10, 1.6e11, 3.2e11];
const aIdleCheck = runFrom({ model: CURRENT, prestige: 0, target: TOTAL_TARGET, checkpoints: RANK_ATS });
const aNodesIdle: Record<string, string> = {};
RANK_ATS.forEach((x, i) => { aNodesIdle[x.toExponential(1)] = `${M_(aIdleCheck.checkpointTimes?.[i] ?? NaN)}min`; });
const humanFirst = runFrom({ model: CURRENT, prestige: 0, target: 1e8, cps: 5 });
const humanFirstIdle = runFrom({ model: CURRENT, prestige: 0, target: 1e8 });
out.routes = {
  A_idle: { timeH: H(routeA_idle.time), timeMin: M_(routeA_idle.time), nodes: aNodesIdle, notes: "单局直达，无转生" },
  A_c5: { timeH: H(routeA_c5.time) },
  A_c1000: { timeH: H(routeA_c1000.time) },
  B_idle: {
    timeH: H(routeB_idle.total),
    theta: routeB_idle.theta,
    n: routeB_idle.n,
    prestige: routeB_idle.prestige,
    multiplier: routeB_idle.multiplier,
    farmMin: M_(routeB_idle.farmTime),
    finalMin: M_(routeB_idle.finalTime),
    nodes: nodes(routeB_idle, nodeTotals),
  },
  C_c5: { timeH: H(routeC_c5.total), theta: routeC_c5.theta, n: routeC_c5.n, prestige: routeC_c5.prestige, farmMin: M_(routeC_c5.farmTime), finalMin: M_(routeC_c5.finalTime), nodes: nodes(routeC_c5, nodeTotals) },
  C_c8: { timeH: H(routeC_c8.total), theta: routeC_c8.theta, n: routeC_c8.n, prestige: routeC_c8.prestige },
  C_c20: { timeH: H(routeC_c20.total) },
  C_c100: { timeH: H(routeC_c100.total) },
  C_c1000: { timeH: H(routeC_c1000.total) },
  legacy: { A: H(legacyA.time), B: H(legacyB.total), C5: H(legacyC5.total), C8: H(legacyC8.total), B_theta: legacyB.theta, B_n: legacyB.n },
};

// ---------------------------------------------------------------------------
// 2) 图鉴 55/55 最快路线
// ---------------------------------------------------------------------------
const cCost = collectionIdleCost();
console.log(`\n图鉴 Lv50 成本: 总 ${(cCost.total / 1e8).toFixed(2)}e8 = ${(cCost.total / 1e9).toFixed(2)}e9`);
console.log("  " + JSON.stringify(Object.fromEntries(Object.entries(cCost.per).map(([k, v]) => [k, +(v / 1e9).toFixed(2) + "e9"]))));

const allIdle50 = (lv: Levels): boolean => IDLE_IDS.every((id) => (lv[id] ?? 0) >= COLLECTION_LEVEL);

interface CollectBest {
  theta: number;
  n: number;
  time: number;
  farmTime: number;
  finalTime: number;
  prestige: number;
}
function collectionCurve(model: PrestigeModel, cps: number, theta: number, N: number): CollectBest | null {
  let levels: Levels = {};
  let P = 0;
  let t = 0;
  let best: CollectBest | null = null;
  for (let n = 0; n <= N; n++) {
    if (allIdle50(levels)) {
      return best; // 已达图鉴
    }
    // 终段：一路买到 6 个挂机项 Lv50 为止（本局累计不设上限）
    const fr = runFrom({ model, prestige: P, levels0: levels, target: 1e15, cps, stopWhen: allIdle50 });
    const total = t + fr.time;
    if (!best || total < best.time) best = { theta, n, time: total, farmTime: t, finalTime: fr.time, prestige: P };
    if (best && t > best.time) break;
    // farm 一轮
    const r = runFrom({ model, prestige: P, levels0: levels, target: theta, cps });
    t += r.time;
    P += model.gain(theta);
    levels = applyPrestige(r.levels, model);
    if (t > (best?.time ?? Infinity)) break;
  }
  return best;
}
function bestCollection(model: PrestigeModel, cps: number): CollectBest {
  let best: CollectBest | null = null;
  for (const th of THETAS) {
    const b = collectionCurve(model, cps, th, maxN(th));
    if (b && (!best || b.time < best.time)) best = b;
  }
  return best!;
}
const collIdle = bestCollection(CURRENT, 0);
const collC5 = bestCollection(CURRENT, 5);
const CLICKS_NEEDED = 20000;
console.log(`图鉴 55/55 最快: 纯挂机 ${H(collIdle.time)}h (θ=${collIdle.theta.toExponential(1)}, n=${collIdle.n}, farm ${M_(collIdle.farmTime)}min)`);
console.log(`图鉴 55/55 最快: 点击5cps ${H(collC5.time)}h (θ=${collC5.theta.toExponential(1)}, n=${collC5.n})；20000点击@5cps=${M_(CLICKS_NEEDED / 5)}min`);

// 报价收集：10 条语录，梗窗口 45-75s 出现一次（互斥/顺延），5s 内点击有效
function couponCollectorTrials(trials: number): { mean: number; p50: number; p90: number } {
  let seed = 12345;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const times: number[] = [];
  for (let i = 0; i < trials; i++) {
    const seen = new Set<number>();
    let t = 0;
    let guard = 0;
    while (seen.size < 10 && guard++ < 500) {
      t += 45 + rng() * 30;
      seen.add(Math.floor(rng() * 10));
    }
    times.push(t);
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  return { mean, p50: times[Math.floor(trials * 0.5)]!, p90: times[Math.floor(trials * 0.9)]! };
}
const quoteT = couponCollectorTrials(20000);
console.log(`10 条语录期望 ${M_(quoteT.mean)}min (P90 ${M_(quoteT.p90)}min)`);
out.collection = {
  idleCost: cCost.total,
  idleCostPer: cCost.per,
  bestIdle: { timeH: H(collIdle.time), theta: collIdle.theta, n: collIdle.n, farmMin: M_(collIdle.farmTime) },
  bestClick5: { timeH: H(collC5.time), theta: collC5.theta, n: collC5.n },
  clicksNeeded: CLICKS_NEEDED,
  clickMinAt5cps: M_(CLICKS_NEEDED / 5),
  clickMinAt8cps: M_(CLICKS_NEEDED / 8),
  quote: { meanMin: M_(quoteT.mean), p90Min: M_(quoteT.p90) },
};

// ---------------------------------------------------------------------------
// 3) 捷径量化
// ---------------------------------------------------------------------------
// 3.1 rewindSave 离线循环：每次回拨 8h + 刷新，实际耗时按 ~3s/轮（余额跨轮保留）
const RELOAD_SECONDS = 3;
function rewindRoute(model: PrestigeModel, eff = 1): { cycles: number; wallSeconds: number; gameHours: number; finalRate: number } {
  let levels: Levels = {};
  const P = 0;
  let life = 0;
  let moyu = 0;
  let cycles = 0;
  const st = {
    moyu: 0,
    totalEarned: 0,
    levels,
    collected: { quotes: [] as number[], flavors: [] as number[] },
    daily: null,
    surviveStreak: 0,
    totalClicks: 0,
    visits: { date: "", count: 0 },
    lifetimeEarned: 0,
    prestige: 0,
  };
  let finalRate = 0;
  while (life < TOTAL_TARGET && cycles < 5000) {
    st.levels = levels;
    st.prestige = P;
    st.moyu = moyu;
    st.totalEarned = 0;
    const rate = _effectOf(st).idleRate;
    finalRate = rate;
    const lump = rate * 28800 * eff;
    life += lump;
    moyu += lump;
    st.moyu = moyu;
    // 8h 离线是一次性到账：把钱换成 payback < 8h 的升级
    for (let guard = 0; guard < 20000; guard++) {
      let best: { id: string; c: number; p: number } | null = null;
      for (const id of IDLE_IDS) {
        const lv = levels[id] ?? 0;
        const c = _costOf(id, lv);
        if (c > moyu) continue;
        const g = _marginalEffect(id, lv).idleRate * model.mult(P);
        const p = g > 0 ? c / g : Infinity;
        if (p <= 28800 && (!best || p < best.p)) best = { id, c, p };
      }
      if (!best) break;
      moyu -= best.c;
      levels[best.id] = (levels[best.id] ?? 0) + 1;
    }
    cycles++;
  }
  return { cycles, wallSeconds: cycles * RELOAD_SECONDS, gameHours: cycles * 8, finalRate };
}
let rewind: { cycles: number; wallSeconds: number; gameHours: number; finalRate: number } | null = null;
try {
  rewind = rewindRoute(CURRENT, 1);
} catch (e) {
  console.log("rewind sim failed", e);
}
if (rewind) console.log(`\n[捷径] rewindSave 离线循环: ${rewind.cycles} 轮 × 8h = ${rewind.gameHours}h 游戏时间, 实际 ${M_(rewind.wallSeconds)}min (3s/轮), 终局 idle=${rewind.finalRate.toExponential(2)}/s`);

// 3.2 点击线（autoclicker/合成 pointerdown）: 已算 cps 20/100/1000
// 3.3 图鉴 ×1.2 的价值：全图鉴时最优路线时间 vs 无
const routeB_collect = bestRoute(CURRENT, 0, true);
const collBonusSaving = routeB_idle.total - routeB_collect.total;
console.log(`[捷径] 图鉴 ×1.2 若白拿: ${H(routeB_idle.total)}h → ${H(routeB_collect.total)}h，省 ${M_(collBonusSaving)}min`);

// 3.4 事件奖励（巡逻/丢梗）：按公式估算相对收入占比
function eventBonusEstimate(idleRate: number, clickPower: number, cps: number): number {
  const patrol = (Math.max(50, 4 * idleRate) * 1.5) / 120; // 安然奖励 ×连胜 1.5 / 平均间隔 120s
  const meme = (5 * clickPower) / 60; // 每 60s 一个梗
  const click = cps > 0 ? cps * clickPower * 1.24 : 0;
  return (patrol + (cps > 0 ? meme : 0)) / (idleRate + click);
}
const evIdle = eventBonusEstimate(1e6, 1e6, 0);
const evClick = eventBonusEstimate(1e4, 1e4, 5);
console.log(`[捷径] 事件奖励占比: 纯挂机 +${(evIdle * 100).toFixed(1)}% → 约省 ${M_(routeB_idle.total * evIdle)}min；点击期 +${(evClick * 100).toFixed(1)}%`);

// 3.5 日报奖励：600×idleRate，相当于 10 分钟挂机收益
// 3.6 回访/离线效率：首日 1.0，之后 0.7+3 次回访 0.3 → 1.0

out.shortcuts = {
  rewind: rewind ? { cycles: rewind.cycles, wallMin: M_(rewind.wallSeconds), gameHours: rewind.gameHours, perCycleSeconds: RELOAD_SECONDS } : null,
  autoclicker: { cps20: H(routeC_c20.total), cps100: H(routeC_c100.total), cps1000: H(routeC_c1000.total), noPrestige1000: H(routeA_c1000.time) },
  collectionBonus: { withCollectH: H(routeB_collect.total), withoutH: H(routeB_idle.total), savedMin: M_(collBonusSaving) },
  eventBonus: { idlePct: +(evIdle * 100).toFixed(1), clickPct: +(evClick * 100).toFixed(1), savedMin: M_(routeB_idle.total * evIdle) },
  dailyReward: { note: "600×idleRate ≈ 10 分钟挂机收益/天；claim 时可在大 idleRate 时领" },
  offlineEff: { note: "首日 1.0；之后 0.7 + 3 回访 +0.1 + streak +0.15 → 封顶 1.0" },
};

// ---------------------------------------------------------------------------
// 4) 转生曲线表（1-10 转，当前 HEAD 最优路线；及简报机制最优路线）
// ---------------------------------------------------------------------------
function prestigeCurve(best: FarmBest): { index: number; runMin: number; points: number; cumPoints: number; mult: number; cumMin: number }[] {
  return best.runs.slice(0, 10).map((r, i) => ({
    index: i + 1,
    runMin: M_(r.time),
    points: r.points,
    cumPoints: r.startPrestige + r.points,
    mult: r.multiplier,
    cumMin: M_(r.cumulativeTime + r.time),
  }));
}
const curveCurrent = prestigeCurve(routeB_idle);
const curveLegacy = prestigeCurve(legacyB);
console.log("\n转生曲线（当前 HEAD 最优：1e8 阈值 spam）");
for (const c of curveCurrent) console.log(`  #${c.index} 本转 ${c.runMin}min +${c.points}pts → 累计 ${c.cumPoints}pts M→${(1 + 0.75 * c.cumPoints).toFixed(1)} 累计 ${c.cumMin}min`);
console.log("转生曲线（简报 06041a1 机制）");
for (const c of curveLegacy) console.log(`  #${c.index} 本转 ${c.runMin}min +${c.points}pts → 累计 ${c.cumPoints}pts M→${Math.pow(1.08, c.cumPoints).toFixed(1)} 累计 ${c.cumMin}min`);
out.prestigeCurve = { current: { model: "linear+75%/pt, keep80%", rows: curveCurrent, bestTheta: routeB_idle.theta, n: routeB_idle.n }, legacy: { rows: curveLegacy, bestTheta: legacyB.theta, n: legacyB.n } };

// 每转平均：前 10 转时长/点数趋势
// ---------------------------------------------------------------------------
// 5) 人类手点版：只在第一局狂点 5cps 冲首转，之后纯挂机
// ---------------------------------------------------------------------------
const humanSaving = routeB_idle.total - (routeB_idle.total - humanFirstIdle.time + humanFirst.time);
console.log(`\n[人手点击] 首局 5cps 到 1e8: ${M_(humanFirst.time)}min vs 纯挂机 ${M_(humanFirstIdle.time)}min → 之后纯挂机，B 路线约 ${H(routeB_idle.total - humanFirstIdle.time + humanFirst.time)}h（约省 ${M_(routeB_idle.total - routeB_idle.total + humanFirstIdle.time - humanFirst.time)}min）`);

// 6) 「先集满图鉴再冲终档」净代价（含 ×1.2）
function collectionThenFinish(theta: number, n: number, cps: number): { collectMin: number; finishMin: number; totalMin: number } | null {
  let levels: Levels = {};
  let P = 0;
  let t = 0;
  for (let i = 0; i < n; i++) {
    const r = runFrom({ model: CURRENT, prestige: P, levels0: levels, target: theta, cps });
    t += r.time; P += CURRENT.gain(theta); levels = applyPrestige(r.levels, CURRENT);
  }
  const r1 = runFrom({ model: CURRENT, prestige: P, levels0: levels, target: 1e15, cps, stopWhen: allIdle50 });
  const life1 = n * theta + r1.earned;
  const tCol = t + r1.time;
  if (!allIdle50(r1.levels)) return null;
  const r2 = runFrom({ model: CURRENT, prestige: P, levels0: r1.levels, target: TOTAL_TARGET - life1, cps, collectFull: true });
  return { collectMin: M_(tCol), finishMin: M_(r2.time), totalMin: M_(tCol + r2.time) };
}
const ctf = collectionThenFinish(collIdle.theta, collIdle.n, 0);
const ctfC5 = collectionThenFinish(collC5.theta, collC5.n, 5);
console.log(`[图鉴 x1.2 净代价/纯挂机] 集满 ${ctf?.collectMin}min + 终档收尾 ${ctf?.finishMin}min = ${ctf?.totalMin}min (vs 不收集 ${M_(routeB_idle.total)}min)`);
console.log(`[图鉴 x1.2 净代价/点击5cps] 集满 ${ctfC5?.collectMin}min + 收尾 ${ctfC5?.finishMin}min = ${ctfC5?.totalMin}min (vs ${M_(routeC_c5.total)}min)`);
out.humanClick = { firstRunClickMin: M_(humanFirst.time), firstRunIdleMin: M_(humanFirstIdle.time), estimatedH: H(routeB_idle.total - humanFirstIdle.time + humanFirst.time) };
out.collectionThenFinish = { idle: ctf, click5: ctfC5 };

// ---------------------------------------------------------------------------
// 7) 转生 UI 摩擦 + 日报窗口
// ---------------------------------------------------------------------------
out.friction = {
  prestigesB: routeB_idle.n,
  prestigesC5: routeC_c5.n,
  prestigesC1000: routeC_c1000.n,
  uiSecondsPerPrestige: 1.5,
  uiOverheadMinB: M_(routeB_idle.n * 1.5),
  uiOverheadMinC1000: M_(routeC_c1000.n * 1.5),
  dailyWindowsPerDay: 4,
  dailyClaimsInRoute: 2,
  journalOpenIncomeThrottle: "open journal → frameSkip 1/3, dt discarded (income ~1/3 while panel open)",
};
console.log(`\n[摩擦] B 需 ${routeB_idle.n} 次转生（每次开日报+点按钮 ~1.5s ≈ ${M_(routeB_idle.n * 1.5)}min）`);

// ---------------------------------------------------------------------------
// 8) 政策敏感性（可复现性）：换 buy 策略的偏差
// ---------------------------------------------------------------------------
writeFileSync("playtest/r8-speedrun.json", JSON.stringify(out, null, 2));
console.log(`\nwrote playtest/r8-speedrun.json  elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`);
