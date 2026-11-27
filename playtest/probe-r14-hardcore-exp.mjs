// R14 硬核玩家探针（探索用）：只用引擎函数，只读 src/
// 运行：node_modules/.bin/vite-node playtest/probe-r14-hardcore-exp.mjs
import { initialState } from "../src/engine/state.ts";
import { UPGRADES, costOf, marginalEffect, effectOf, stationIdleOf, stationIdleScaled } from "../src/engine/upgrades.ts";
import { clickPowerOf } from "../src/engine/actions.ts";
import { DECOR, decorEffects, buyDecor, canBuyDecor } from "../src/engine/decor.ts";
import { ENERGY_ACTIONS, ENERGY_PER_DAY, emptyEnergy, ensureEnergy, energyEffects, useEnergy } from "../src/engine/energy.ts";
import { COLLEAGUES, recruit, upgradeColleague, teamFixedRate, teamShareRatio } from "../src/engine/team.ts";
import { offlineEfficiency } from "../src/engine/progression.ts";
import { offlineEarn, capForElapsed } from "../src/engine/offline.ts";
import { prestigeMultiplier } from "../src/engine/prestige.ts";

const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toLocaleString("en-US", { maximumFractionDigits: d }) : String(x));
const sci = (x) => (x === 0 ? "0" : x >= 1e6 || x <= 1e-4 ? x.toExponential(2) : x.toFixed(2));

// ---------- 1) 纯挂机进度模拟：按 ROI 买升级/同事 ----------
function incomeRate(s) {
  return effectOf(s).idleRate;
}

function colleagueDelta(s, id, isRecruit) {
  let after;
  if (isRecruit) after = recruit(s, id);
  else after = upgradeColleague(s, id);
  if (!after) return null;
  const cost = isRecruit
    ? COLLEAGUES.find((c) => c.id === id).cost
    : Math.ceil(COLLEAGUES.find((c) => c.id === id).cost * 0.4 * 1.35 ** s.team.colleagues[id].level);
  return { after, cost, delta: incomeRate(after) - incomeRate(s) };
}

function upgradeDelta(s, u) {
  const lv = s.levels[u.id] ?? 0;
  const cost = costOf(u.id, lv);
  const m = marginalEffect(u.id, lv);
  return { cost, delta: u.idleRate ? m.idleRate : 0, after: null, isClick: !!u.clickPower };
}

function nextCandidates(s) {
  const out = [];
  for (const u of UPGRADES) {
    const lv = s.levels[u.id] ?? 0;
    // 纯挂机党不买点击项
    if (!u.idleRate) continue;
    const m = marginalEffect(u.id, lv);
    out.push({ kind: "upgrade", id: u.id, cost: costOf(u.id, lv), delta: m.idleRate });
  }
  for (const c of COLLEAGUES) {
    const cur = s.team.colleagues[c.id];
    if (!cur) out.push({ kind: "recruit", id: c.id, cost: c.cost, delta: colleagueDelta(s, c.id, true)?.delta ?? 0 });
    else if (cur.level < 5) out.push({ kind: "colleagueUp", id: c.id, cost: Math.ceil(c.cost * 0.4 * 1.35 ** cur.level), delta: colleagueDelta(s, c.id, false)?.delta ?? 0 });
  }
  return out.filter((x) => x.delta > 0);
}

function buy(s, c) {
  if (c.kind === "upgrade") return { ...s, moyu: s.moyu - c.cost, levels: { ...s.levels, [c.id]: (s.levels[c.id] ?? 0) + 1 } };
  if (c.kind === "recruit") return recruit(s, c.id);
  return upgradeColleague(s, c.id);
}

function simulate(opts = {}) {
  let s = { ...initialState(), moyu: opts.moyu ?? 0, totalEarned: opts.moyu ?? 0, lifetimeEarned: opts.moyu ?? 0 };
  for (const [k, v] of Object.entries(opts.levels ?? {})) s.levels[k] = v;
  let t = 0;
  const buyLog = [];
  const decorAt = {}; // id -> {t, income, station, ...}
  const pending = new Set(DECOR.map((d) => d.id));
  const MAXT = 200 * 86400;
  let gu = 0;
  while (t < MAXT && pending.size > 0) {
    // 记录新达成可买的家具
    for (const id of [...pending]) {
      const def = DECOR.find((d) => d.id === id);
      if (s.moyu >= def.cost) {
        decorAt[id] = snapshot(s, t);
        pending.delete(id);
      }
    }
    // 买 ROI 最优且买得起的
    const cands = nextCandidates(s).filter((c) => c.cost <= s.moyu);
    if (cands.length) {
      cands.sort((a, b) => a.cost / a.delta - b.cost / b.delta);
      const best = cands[0];
      s = buy(s, best);
      buyLog.push({ t, kind: best.kind, id: best.id, cost: best.cost, delta: best.delta, payback: best.cost / best.delta, income: incomeRate(s) });
      gu++;
      if (gu > 20000) break;
      continue;
    }
    // 等钱：跳到下一件买得起
    const all = nextCandidates(s);
    if (!all.length) break;
    const need = Math.min(...all.map((c) => c.cost)) - s.moyu;
    const rate = incomeRate(s);
    if (rate <= 0) break;
    const dt = Math.max(need / rate, 0.05);
    t += dt;
    s = { ...s, moyu: s.moyu + rate * dt, totalEarned: s.totalEarned + rate * dt, lifetimeEarned: s.lifetimeEarned + rate * dt };
  }
  return { s, t, buyLog, decorAt };
}

function snapshot(s, t) {
  const eff = effectOf(s);
  return {
    t,
    income: eff.idleRate,
    station: stationIdleScaled(s),
    clickPower: clickPowerOf(s),
    levels: { ...s.levels },
    colleagues: Object.fromEntries(Object.entries(s.team.colleagues).map(([k, v]) => [k, v.level])),
    teamFixed: teamFixedRate(s),
    teamShare: teamShareRatio(s),
  };
}

// ---------- 输出 ----------
const res = simulate();
console.log("=== 纯挂机进度模拟（ROI 贪心，不买点击/家具） ===");
console.log("到达各家具可买时刻：");
for (const d of DECOR) {
  const st = res.decorAt[d.id];
  if (!st) { console.log(`${d.name}: 未到达（200天内）`); continue; }
  console.log(
    `${d.name.padEnd(4)} cost=${fmt(d.cost)} t=${fmt(st.t / 86400, 2)}天 income=${sci(st.income)}/s station=${sci(st.station)} click=${sci(st.clickPower)} teamFixed=${sci(st.teamFixed)} ratio=${(st.teamShare * 100).toFixed(1)}%`,
  );
}
console.log("\n模拟结束 t=", fmt(res.t / 86400, 2), "天 income=", sci(incomeRate(res.s)), "lifetime=", sci(res.s.lifetimeEarned));
console.log("买升级次数:", res.buyLog.length);
console.log("\n最后 15 次购买:");
for (const b of res.buyLog.slice(-15)) console.log(`t=${fmt(b.t / 86400, 2)}d ${b.kind}:${b.id} cost=${sci(b.cost)} delta=${sci(b.delta)}s payback=${fmt(b.payback, 1)}s income=${sci(b.income)}`);

// ---------- 家具 ROI（在各自可买时点） ----------
console.log("\n=== 家具 ROI（在可买时点；纯挂机口径） ===");
for (const d of DECOR) {
  const st = res.decorAt[d.id];
  if (!st) continue;
  const eff = d.effects;
  let deltaIdle = 0;
  if (eff.idleMult) deltaIdle = st.station * (eff.idleMult - 1);
  const pct = deltaIdle / st.income;
  console.log(
    `${d.name.padEnd(4)} cost=${fmt(d.cost)} Δidle/s=${sci(deltaIdle)} 占总收入=${(pct * 100).toFixed(2)}% payback=${sci(d.cost / deltaIdle)}s(${fmt(d.cost / deltaIdle / 3600, 2)}h) station占比=${((st.station / st.income) * 100).toFixed(0)}%`,
  );
}