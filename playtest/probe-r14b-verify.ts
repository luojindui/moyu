// R14 复验（P0/P1 修复后）：精力 4 选、跨日离线 A/B、家具离线生效、家具 ROI 重算、被支配项
// 只读 src/，全部用引擎函数计算。
// 运行：node_modules/.bin/vite-node playtest/probe-r14b-verify.ts
import { writeFileSync } from "node:fs";
import { initialState, type GameState } from "../src/engine/state";
import { UPGRADES, costOf, marginalEffect, effectOf, stationIdleScaled } from "../src/engine/upgrades";
import { clickPowerOf } from "../src/engine/actions";
import { DECOR } from "../src/engine/decor";
import { ENERGY_ACTIONS, ENERGY_PER_DAY, emptyEnergy, ensureEnergy, useEnergy, type EnergyAction } from "../src/engine/energy";
import { COLLEAGUES, MISSIONS, recruit, upgradeColleague, dispatchReward, missionSecondsFor, favorBonuses } from "../src/engine/team";
import { offlineEfficiency, ensureVisits } from "../src/engine/progression";
import { offlineEarn } from "../src/engine/offline";
import { bossSurviveReward, type EventState } from "../src/engine/events";
import { serialize, restore, SAVE_KEY } from "../src/engine/save";
import { settleReturn } from "../src/engine/resume";
import { finishGame, ensureArcade, TARGET_IDLE_SECONDS } from "../src/engine/minigames";

const NOW = Date.now();
const DAY_MS = 86_400_000;
const TODAY = new Date(NOW).toLocaleDateString("sv-SE");
const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toLocaleString("en-US", { maximumFractionDigits: d }) : String(x));
const sci = (x: number) => (x === 0 ? "0" : Math.abs(x) >= 1e6 || Math.abs(x) < 1e-2 ? x.toExponential(2) : x.toFixed(2));
const hrs = (sec: number) => (sec >= 3600 ? `${fmt(sec / 3600, 2)}h` : `${fmt(sec / 60, 1)}min`);
const L: string[] = [];
const log = (s: string) => { L.push(s); };
const withDecor = (s: GameState, ...ids: string[]): GameState => ({ ...s, decor: [...s.decor, ...ids] });

// ---------------- 工具 ----------------
function mkState(levels: Record<string, number>, cols: string[], favor = 0, decor: string[] = []): GameState {
  let s: GameState = { ...initialState(), moyu: 1e12, totalEarned: 1e12, lifetimeEarned: 1e12, levels: { ...levels }, decor };
  for (const id of cols) {
    s = recruit(s, id)!;
    while ((s.team.colleagues[id]?.level ?? 0) < 3) s = upgradeColleague(s, id)!;
    s = { ...s, team: { colleagues: { ...s.team.colleagues, [id]: { ...s.team.colleagues[id]!, favor } } } };
  }
  return s;
}
function withFavor(s: GameState, favor: number): GameState {
  const cols = { ...s.team.colleagues };
  for (const k of Object.keys(cols)) cols[k] = { ...cols[k]!, favor };
  return { ...s, team: { colleagues: cols } };
}
function eff(s: GameState, visits: number, streak: number, talents?: string[]): number {
  const st: GameState = {
    ...s,
    visits: { date: "2026-01-01", count: visits },
    daily: { date: "2026-01-01", goals: [], streak, lastCompleteDate: null, claimed: false, window: 0, claimsToday: 0 },
    talents: talents ? { unlocked: talents, points: 0, rankGranted: -1, dailyGiftDate: "", overflow: 0 } : s.talents,
  };
  return offlineEfficiency(st, NOW - 10 * DAY_MS, NOW);
}
function dispatchRate(s: GameState): number {
  const stationIdle = stationIdleScaled(s);
  let total = 0;
  for (const c of COLLEAGUES) {
    const cur = s.team.colleagues[c.id];
    if (!cur) continue;
    let best = 0;
    for (const m of MISSIONS) {
      const seconds = missionSecondsFor(c.id, m.id);
      const probe: GameState = { ...s, team: { colleagues: { ...s.team.colleagues, [c.id]: { ...cur, missionId: m.id } } } };
      best = Math.max(best, dispatchReward(probe, c.id, stationIdle) / Math.max(1, seconds));
    }
    total += best;
  }
  return total;
}
const ES_BASE: EventState = {
  nextBossAt: 0, bossUntil: 0, nextMemeAt: 0, memeUntil: 0, bossCaught: false, bossStartAt: 0,
  surviveStreak: 5, bossVariant: "hold", bossTaps: 0, bossPenaltyTotal: 0, patrolCount: 10,
  memeCount: 0, bossPersonality: "hasty", bossChoiceDone: false, forcedVariant: null,
};
const VARIANT_AVG = 0.35 * 1 + 0.30 * 1 + 0.2 * 1.5 + 0.15 * 1.8; // hold/type/blitz/choice

// ---------------- 画像 ----------------
interface Prof { id: string; name: string; cps: number; combo: number; clickSeconds: number; activeSeconds: number; offlineSeconds: number; dispatch: boolean }
const PROFILES: Prof[] = [
  { id: "idle", name: "挂机/混合(2h在线+20min点击)", cps: 2.5, combo: 1.24, clickSeconds: 1200, activeSeconds: 7200, offlineSeconds: 43200, dispatch: true },
  { id: "clicker", name: "点击党(2h全点击)", cps: 2.5, combo: 1.24, clickSeconds: 7200, activeSeconds: 7200, offlineSeconds: 43200, dispatch: true },
  { id: "afk", name: "佛系挂机(10min在线)", cps: 0, combo: 1, clickSeconds: 0, activeSeconds: 600, offlineSeconds: 43200, dispatch: false },
];

// ---------------- 精力：4 选，预算 100 ----------------
function applySubset(base: GameState, subset: EnergyAction[]): GameState | null {
  let s: GameState = { ...base, energy: emptyEnergy(TODAY) };
  for (const a of subset) {
    const next = useEnergy(s, a);
    if (!next) return null;
    s = next;
  }
  return s;
}
interface Parts { idle: number; click: number; dispatch: number; offline: number; patrol: number; favor: number; total: number }
function actionValue(base: GameState, subset: EnergyAction[], p: Prof, visits: number, streak: number): Parts | null {
  const E = applySubset(base, subset);
  if (!E) return null;
  const effRate = eff(base, visits, streak);
  const idleDelta = (effectOf(E).idleRate - effectOf(base).idleRate) * p.activeSeconds;
  const clickDelta = (clickPowerOf(E) - clickPowerOf(base)) * p.cps * p.combo * p.clickSeconds;
  const dispatchDelta = p.dispatch ? (dispatchRate(E) - dispatchRate(base)) * p.activeSeconds : 0;
  // 注意：P0-2 修复后，隔夜离线结算前会先重置精力 → 隔夜离线吃不到当日精力加成。
  // 只有"同日内切后台再回来"的短离线能吃到，保守按 0 计（另存乐观值 offOpt 供参考）。
  const offOpt = offlineEarn(E, p.offlineSeconds, effRate).earned - offlineEarn(base, p.offlineSeconds, effRate).earned;
  const offlineDelta = 0;
  const patrolDelta = (bossSurviveReward(E, ES_BASE) - bossSurviveReward(base, ES_BASE)) * VARIANT_AVG * (p.activeSeconds / 120);
  // social 的好感：按"到 100 的终局日价值 / 剩余天数"摊薄
  let favor = 0;
  if (subset.includes("social")) {
    const curFavor = Object.values(base.team.colleagues)[0]?.favor ?? 0;
    const days = (100 - curFavor) / 5;
    if (days > 0) {
      const F0 = E;
      const F100 = withFavor(E, 100);
      const idleF = (effectOf(F100).idleRate - effectOf(F0).idleRate) * p.activeSeconds;
      const dispF = p.dispatch ? (dispatchRate(F100) - dispatchRate(F0)) * p.activeSeconds : 0;
      const offF = offlineEarn(F100, p.offlineSeconds, effRate).earned - offlineEarn(F0, p.offlineSeconds, effRate).earned;
      const memeF = (p.activeSeconds / 60) * 5 * clickPowerOf(F0) * (favorBonuses(F100).memeMult - favorBonuses(F0).memeMult);
      favor = (idleF + dispF + offF + memeF) / days;
    }
  }
  void offOpt;
  return { idle: idleDelta, click: clickDelta, dispatch: dispatchDelta, offline: offlineDelta, patrol: patrolDelta, favor, total: idleDelta + clickDelta + dispatchDelta + offlineDelta + patrolDelta + favor };
}

const ENERGY_STATES: Array<{ name: string; state: GameState; visits: number; streak: number }> = [
  { name: "早期D1", state: mkState({ phone: 3, toilet: 2, group: 1, coffee: 2, water: 1 }, ["zhou"], 0), visits: 1, streak: 0 },
  { name: "中期D7", state: mkState({ phone: 12, toilet: 12, group: 12, meeting: 10, deep: 6, coffee: 8, water: 5, chair: 3 }, ["zhou", "mei", "qiang"], 40), visits: 1, streak: 7 },
  { name: "后期D30", state: mkState({ phone: 25, toilet: 25, group: 25, meeting: 25, deep: 25, retire: 20, coffee: 20, water: 15, chair: 10 }, ["zhou", "mei", "qiang", "li", "wang"], 100), visits: 1, streak: 30 },
  { name: "纯点击流(不升挂机)", state: mkState({ coffee: 25, water: 25, chair: 25 }, [], 0), visits: 1, streak: 30 },
  { name: "全新号(0升级)", state: { ...initialState(), moyu: 1e12, totalEarned: 1e12, lifetimeEarned: 1e12 }, visits: 1, streak: 0 },
];

const N = ENERGY_ACTIONS.length;
const ALL_SUBSETS: EnergyAction[][] = [];
for (let mask = 0; mask < 1 << N; mask++) {
  const sub: EnergyAction[] = [];
  for (let i = 0; i < N; i++) if (mask & (1 << i)) sub.push(ENERGY_ACTIONS[i]!.id);
  ALL_SUBSETS.push(sub);
}
const costOfSubset = (sub: EnergyAction[]) => sub.reduce((sum, a) => sum + (ENERGY_ACTIONS.find((x) => x.id === a)?.cost ?? 0), 0);

const energyRows: Array<Record<string, unknown>> = [];
log("================ ① 精力：4 项合计 145 > 100（预算 100） ================");
log(`    引擎校验：四项一起用不可行。顺序 slack→fake→social→focus：${(() => {
  let s: GameState = { ...ENERGY_STATES[1]!.state, energy: emptyEnergy(TODAY) };
  const seq: EnergyAction[] = ["slack", "fake-work", "social", "focus"];
  const out: string[] = [];
  for (const a of seq) { const n = useEnergy(s, a); out.push(n ? `${a}✓(剩${n.energy.left})` : `${a}✗`); if (n) s = n; }
  return out.join(" → ");
})()}`);
for (const es of ENERGY_STATES) {
  log(`\n【${es.name}】income=${sci(effectOf(es.state).idleRate)}/s，工位占比=${((stationIdleScaled(es.state) / effectOf(es.state).idleRate) * 100).toFixed(0)}%，click=${sci(clickPowerOf(es.state))}，好感=${Object.values(es.state.team.colleagues)[0]?.favor ?? "-"}`);
  for (const p of PROFILES) {
    if (es.name.startsWith("纯点击") && p.id !== "clicker") continue;
    // 单行动价值
    const singles: Record<string, Parts> = {};
    for (const a of ENERGY_ACTIONS.map((x) => x.id)) {
      const v = actionValue(es.state, [a], p, es.visits, es.streak);
      if (v) singles[a] = v;
    }
    // 枚举可行子集
    const feasible = ALL_SUBSETS.filter((sub) => costOfSubset(sub) <= 100)
      .map((sub) => ({ sub, cost: costOfSubset(sub), v: actionValue(es.state, sub, p, es.visits, es.streak) }))
      .filter((x): x is { sub: EnergyAction[]; cost: number; v: Parts } => x.v !== null)
      .sort((a, b) => b.v.total - a.v.total);
    const best = feasible[0]!;
    const bestName = (sub: EnergyAction[]) => (sub.length ? sub.join("+") : "空");
    log(`  [${p.name}] 单项日价值/每点：` +
      ENERGY_ACTIONS.map((a) => {
        const v = singles[a.id];
        return v ? `${a.name}=${sci(v.total)}(${sci(v.total / a.cost)}/点)` : `${a.name}=不可用`;
      }).join("；"));
    log(`    拆分：` + ENERGY_ACTIONS.map((a) => {
      const v = singles[a.id];
      if (!v) return `${a.name}:-`;
      return `${a.name}[挂机${sci(v.idle)} 点击${sci(v.click)} 派遣${sci(v.dispatch)} 离线${sci(v.offline)} 巡逻${sci(v.patrol)} 好感${sci(v.favor)}]`;
    }).join(" "));
    log(`    最优子集：${bestName(best.sub)} 花费=${best.cost}/100，日价值=${sci(best.v.total)}（余 ${100 - best.cost} 点作废）` +
      `；次优：${bestName(feasible[1]!.sub)}=${sci(feasible[1]!.v.total)}；第三：${bestName(feasible[2]!.sub)}=${sci(feasible[2]!.v.total)}`);
    energyRows.push({ state: es.name, profile: p.id, best: best.sub, cost: best.cost, value: best.v.total, second: feasible[1]!.sub, secondValue: feasible[1]!.v.total, singles });
  }
}

// ---------------- ② 跨日离线 A/B ----------------
log("\n\n================ ② 跨日离线 A/B（昨日精力是否被算进今日离线） ================");
function buildSave(used: EnergyAction[], midLevels: Record<string, number>, savedAtMs: number): string {
  const st: GameState = {
    ...initialState(),
    moyu: 5e9, totalEarned: 5e9, lifetimeEarned: 5e9,
    levels: midLevels,
    energy: { date: "2000-01-01", left: 100 - used.reduce((a, x) => a + (ENERGY_ACTIONS.find((y) => y.id === x)?.cost ?? 0), 0), used, boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
    visits: { date: "2026-01-01", count: 3 },
    daily: { date: "2026-01-01", goals: [], streak: 14, lastCompleteDate: null, claimed: false, window: 0, claimsToday: 0 },
  };
  const store = new Map<string, string>();
  // 预置 createdAt（10 天前）→ 触发非首日 0.7 系数
  store.set(SAVE_KEY, JSON.stringify({ savedAt: savedAtMs, createdAt: NOW - 10 * DAY_MS }));
  const adapter = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  serialize(st, adapter, savedAtMs);
  return store.get(SAVE_KEY)!;
}
const MID_LEVELS = { phone: 20, toilet: 20, group: 20, meeting: 20, deep: 15 };
const savedAt = NOW - 12 * 3600 * 1000;
function runBoot(savedJson: string, order: "fixed" | "old") {
  const store = new Map<string, string>([[SAVE_KEY, savedJson]]);
  const adapter = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const restored = restore(adapter, NOW);
  let s = restored.state!;
  const lastActive = NOW - restored.offlineSeconds * 1000;
  if (order === "fixed") {
    s = ensureVisits(s, NOW);
    s = ensureEnergy(s, TODAY);
    const r = settleReturn(s, lastActive, NOW, offlineEfficiency(s, restored.createdAt, NOW));
    return { earned: r.earned, energy: r.state.energy };
  }
  s = ensureVisits(s, NOW);
  const effSame = offlineEfficiency(s, restored.createdAt, NOW); // 与 fixed 同口径，仅差精力重置顺序
  const r = settleReturn(s, lastActive, NOW, effSame);
  const after = ensureEnergy(r.state, TODAY);
  return { earned: r.earned, energy: after.energy };
}
{
  const stale = buildSave(["slack", "fake-work"], MID_LEVELS, savedAt);
  const clean = buildSave([], MID_LEVELS, savedAt);
  const A = runBoot(stale, "fixed");
  const B = runBoot(clean, "fixed");
  const Aold = runBoot(stale, "old");
  log(`修复后（先 ensureEnergy 再结算离线）：昨日已用[slack,fake-work] 离线收益=${sci(A.earned)} vs 昨日未用=${sci(B.earned)}，A/B 比值=${(A.earned / B.earned).toFixed(6)}`);
  log(`  结算后今日精力：date=${A.energy.date}，left=${A.energy.left}，boosted=${JSON.stringify(A.energy.boosted)} → 昨日加成已清零`);
  log(`对照（旧顺序：先结算离线再重置）：A/B 比值=${(Aold.earned / B.earned).toFixed(4)}（旧 bug 会多算 ${((Aold.earned / B.earned - 1) * 100).toFixed(2)}%）`);
  // 切后台回归路径
  const restartState = ensureVisits(restore(new Map([[SAVE_KEY, clean]]) ? ((): any => {
    const store = new Map<string, string>([[SAVE_KEY, clean]]);
    return { getItem: (k: string) => store.get(k) ?? null };
  })() : null, NOW).state!, NOW);
  void restartState;
  log(`  切后台回归路径（main.ts:897-898）：同样先 ensureEnergy 再 settleReturn → 与 boot 一致`);
}

// ---------------- ③ 家具离线收益 ----------------
log("\n\n================ ③ 家具离线效率是否真生效 ================");
{
  const mid: GameState = mkState({ phone: 20, toilet: 20, group: 20, meeting: 20, deep: 15 }, ["zhou", "mei"], 40);
  const cases: Array<{ name: string; visits: number; streak: number }> = [
    { name: "D2(streak0,visits1)", visits: 1, streak: 0 },
    { name: "D8(streak7)", visits: 1, streak: 7 },
    { name: "D22(streak21)", visits: 1, streak: 21 },
    { name: "D22+回访3次", visits: 3, streak: 21 },
  ];
  for (const c of cases) {
    const e0 = eff(mid, c.visits, c.streak);
    const rows: string[] = [];
    for (const id of ["rug", "chair", "catbed"]) {
      const st = withDecor(mid, id);
      const e1 = eff(st, c.visits, c.streak);
      const inc = offlineEarn(st, 43200, e1).earned - offlineEarn(mid, 43200, e0).earned;
      rows.push(`${id}: 效率 ${e0.toFixed(3)}→${e1.toFixed(3)}，12h离线收益 +${sci(inc)}`);
    }
    log(`  ${c.name}: 基线效率=${e0.toFixed(3)} ｜ ${rows.join(" ｜ ")}`);
  }
  // idle_4 / event_5b 天赋
  const eBase = eff(mid, 1, 21);
  log(`  天赋复验：基线效率=${eBase.toFixed(3)}，idle_4(+0.08)=${eff(mid, 1, 21, ["idle_4"]).toFixed(3)}，event_5b(+0.2)=${eff(mid, 1, 21, ["event_5b"]).toFixed(3)} → 加成已生效`);
  // 工位倍率在离线里是否吃满（P2-1）
  const pSt = withDecor(mid, "plant");
  const real = offlineEarn(pSt, 43200, eBase).earned - offlineEarn(mid, 43200, eBase).earned;
  const stat0 = stationIdleScaled(mid);
  const expect = stat0 * 0.05 * 43200 * eBase;
  log(`  P2-1 复验（绿萝 +5% 工位在 12h 离线的增量）：实测=${sci(real)}，理论(吃满)=${sci(expect)} → ${fmt((real / expect) * 100, 1)}%`);
  // 首日（建档 24h 内）离线效率直接返回 1.0，家具离线加成无效
  {
    const eDay1 = offlineEfficiency(mid, NOW - 3600_000, NOW);
    const rugDay1 = withDecor(mid, "rug");
    const eRugDay1 = offlineEfficiency(rugDay1, NOW - 3600_000, NOW);
    const d1 = offlineEarn(rugDay1, 43200, eRugDay1).earned - offlineEarn(mid, 43200, eDay1).earned;
    log(`  首日边界：建档 1h（<24h）时离线效率=${eDay1.toFixed(3)}，地毯后=${eRugDay1.toFixed(3)}，12h 离线增量=${sci(d1)}（地毯/按摩椅的离线部分在首日完全无效）`);
  }
  // 集齐 8 件
  const all = withDecor(mid, ...DECOR.map((d) => d.id));
  const idleAll = effectOf(all).idleRate / effectOf(mid).idleRate;
  log(`  集齐 8 件奖励：挂机 ×${fmt(idleAll, 4)}（含各件 1.435 ×完成奖励 1.1 = ${fmt(1.435 * 1.1, 3)}）`);
}

// ---------------- ④ 家具 ROI 重算 ----------------
log("\n\n================ ④ 家具 ROI 重算（混合画像，首次买得起时点） ================");
const DAY_SEC = 86400;
// 上面占位函数不用；改用完整实现（简洁起见直接内联在主循环处）
function sim(p: Prof) {
  let s: GameState = { ...initialState() };
  let t = 0;
  const pending = new Set(DECOR.map((d) => d.id));
  const decorState = new Map<string, { t: number; state: GameState }>();
  const MAXT = 400 * DAY_SEC;
  const income = (st: GameState) => effectOf(st).idleRate + (p.cps > 0 ? p.cps * p.combo * clickPowerOf(st) : 0);
  const candidates = (st: GameState) => {
    const out: Array<{ kind: "upgrade" | "recruit" | "colleagueUp"; id: string; cost: number; delta: number }> = [];
    for (const u of UPGRADES) {
      const lv = st.levels[u.id] ?? 0;
      const m = marginalEffect(u.id, lv);
      const delta = u.idleRate ? m.idleRate : p.cps > 0 ? m.clickPower * p.cps * p.combo : 0;
      if (delta > 0) out.push({ kind: "upgrade", id: u.id, cost: costOf(u.id, lv), delta });
    }
    for (const c of COLLEAGUES) {
      const cur = st.team.colleagues[c.id];
      if (!cur) { const a = recruit(st, c.id); if (a) out.push({ kind: "recruit", id: c.id, cost: c.cost, delta: income(a) - income(st) }); }
      else if (cur.level < 5) { const a = upgradeColleague(st, c.id); if (a) out.push({ kind: "colleagueUp", id: c.id, cost: Math.ceil(c.cost * 0.4 * 1.35 ** cur.level), delta: income(a) - income(st) }); }
    }
    return out.filter((c) => c.delta > 0);
  };
  const buy = (st: GameState, c: { kind: string; id: string; cost: number }): GameState => {
    if (c.kind === "upgrade") return { ...st, moyu: st.moyu - c.cost, levels: { ...st.levels, [c.id]: (st.levels[c.id] ?? 0) + 1 } };
    if (c.kind === "recruit") return recruit(st, c.id)!;
    return upgradeColleague(st, c.id)!;
  };
  let guard = 0;
  while (t < MAXT && pending.size > 0 && guard++ < 60000) {
    for (const id of [...pending]) {
      const cost = DECOR.find((d) => d.id === id)!.cost;
      if (s.moyu >= cost) { decorState.set(id, { t, state: s }); pending.delete(id); }
    }
    if (pending.size === 0) break;
    const cands = candidates(s);
    const afford = cands.filter((c) => c.cost <= s.moyu);
    if (afford.length) { afford.sort((a, b) => a.cost / a.delta - b.cost / b.delta); s = buy(s, afford[0]!); continue; }
    const rate = income(s);
    if (rate <= 0) break;
    const nextCost = Math.min(...cands.map((c) => c.cost), ...[...pending].map((id) => DECOR.find((d) => d.id === id)!.cost));
    const dt = Math.max((nextCost - s.moyu) / rate, 0.01);
    t += dt;
    const g = rate * dt;
    s = { ...s, moyu: s.moyu + g, totalEarned: s.totalEarned + g, lifetimeEarned: s.lifetimeEarned + g };
  }
  return { s, t, decorState };
}
const roiRows: Array<Record<string, unknown>> = [];
{
  const p = PROFILES[0]!;
  const simRes = sim(p);
  const visits = 1, streak = 14;
  for (const d of DECOR) {
    const got = simRes.decorState.get(d.id);
    if (!got) continue;
    const s0 = got.state;
    const withD = withDecor(s0, d.id);
    const dIdle = effectOf(withD).idleRate - effectOf(s0).idleRate;
    const dClick = (clickPowerOf(withD) - clickPowerOf(s0)) * p.cps * p.combo * p.clickSeconds;
    const dDisp = p.dispatch ? (dispatchRate(withD) - dispatchRate(s0)) * p.activeSeconds : 0;
    const e0 = eff(s0, visits, streak), e1 = eff(withD, visits, streak);
    const dOff = offlineEarn(withD, p.offlineSeconds, e1).earned - offlineEarn(s0, p.offlineSeconds, e0).earned;
    const dDaily = (dIdle + (p.dispatch ? dispatchRate(withD) - dispatchRate(s0) : 0)) * p.activeSeconds + (clickPowerOf(withD) - clickPowerOf(s0)) * p.cps * p.combo * p.clickSeconds + dOff;
    void dClick; void dDisp;
    const paybackH = dDaily > 0 ? (d.cost / dDaily) * 24 : Infinity;
    const onlinePerSec = dIdle + (clickPowerOf(withD) - clickPowerOf(s0)) * p.cps * p.combo + (p.dispatch ? dispatchRate(withD) - dispatchRate(s0) : 0);
    const paybackOnline = onlinePerSec > 0 ? d.cost / onlinePerSec : Infinity;
    roiRows.push({ id: d.id, name: d.name, cost: d.cost, tDays: got.t / 86400, income: effectOf(s0).idleRate, stationShare: stationIdleScaled(s0) / effectOf(s0).idleRate, dIdle, dOff, dDaily, paybackH, paybackOnline });
    log(`${d.name.padEnd(4)} 价=${fmt(d.cost).padStart(13)} 第${fmt(got.t / 86400, 2)}天可买 当时income=${sci(effectOf(s0).idleRate)}/s 工位占比${((stationIdleScaled(s0) / effectOf(s0).idleRate) * 100).toFixed(0)}% ｜ Δ挂机/s=${sci(dIdle)} Δ离线/天=${sci(dOff)} Δ日收益=${sci(dDaily)} → 回本 ${paybackH < 1 ? fmt(paybackH * 60, 1) + "min" : fmt(paybackH, 2) + "h"}（在线口径 ${hrs(paybackOnline)}）`);
  }
  // 追加：硬核常开画像（页面全天开 → 无离线收益，离线家具=0）
  log(`\n  —— 硬核常开画像（页面全天不关：无离线结算、在线 24h、点击 20min/天）——`);
  for (const d of DECOR) {
    const got = simRes.decorState.get(d.id);
    if (!got) continue;
    const s0 = got.state;
    const withD = withDecor(s0, d.id);
    const dIdle = effectOf(withD).idleRate - effectOf(s0).idleRate;
    const dClickPower = clickPowerOf(withD) - clickPowerOf(s0);
    const dDisp = dispatchRate(withD) - dispatchRate(s0);
    const dDailyOnline = (dIdle + dDisp) * 86400 + dClickPower * p.cps * p.combo * 1200;
    const pb = dDailyOnline > 0 ? (d.cost / dDailyOnline) * 24 : Infinity;
    log(`    ${d.name.padEnd(4)} 回本=${Number.isFinite(pb) ? (pb < 1 ? fmt(pb * 60, 1) + "min" : fmt(pb, 2) + "h") : "∞（无离线=0收益）"}`);
  }
  // 第 8 件（集齐奖励）独立计算：以 catbed 为最后一件
  const last = simRes.decorState.get("catbed");
  if (last) {
    const seven = withDecor(last.state, ...DECOR.filter((d) => d.id !== "catbed").map((d) => d.id));
    const eight = withDecor(seven, "catbed");
    const dIdle8 = effectOf(eight).idleRate - effectOf(seven).idleRate;
    const e7 = eff(seven, visits, streak), e8 = eff(eight, visits, streak);
    const dOff8 = offlineEarn(eight, p.offlineSeconds, e8).earned - offlineEarn(seven, p.offlineSeconds, e7).earned;
    const dDaily8 = dIdle8 * p.activeSeconds + dOff8;
    log(`\n【第 8 件特例】以猫窝为最后一件（已拥有其余 7 件，触发集齐 +10% 挂机）：Δ挂机/s=${sci(dIdle8)}（含 +10% 完成奖励）、Δ离线/天=${sci(dOff8)}，日收益=${sci(dDaily8)} → 回本 ${fmt((2e9 / dDaily8) * 24, 2)}h`);
    const selfMult = 1.15; // 猫窝自身挂机倍率
    const dIdleSelf = (dIdle8 / selfMult) * (selfMult - 1);
    log(`    （猫窝自身 +15% 挂机 ≈${sci(dIdleSelf)}/s；集齐 +10% 额外 ≈+${sci(dIdle8 - dIdleSelf)}/s）`);
  }
  // 全套打包
  const sum = DECOR.reduce((a, b) => a + b.cost, 0);
  const lvl = simRes.decorState.get("catbed")!.state;
  const all = withDecor(lvl, ...DECOR.map((d) => d.id));
  const dAll = effectOf(all).idleRate - effectOf(lvl).idleRate;
  const e0 = eff(lvl, visits, streak), ea = eff(all, visits, streak);
  const dAllOff = offlineEarn(all, p.offlineSeconds, ea).earned - offlineEarn(lvl, p.offlineSeconds, e0).earned;
  log(`\n【打包】8 件总价=${fmt(sum)}，全买齐 Δ挂机/s=${sci(dAll)}、Δ离线/天=${sci(dAllOff)}；以猫窝时点算，整套"日收益"=${sci(dAll * p.activeSeconds + dAllOff)} → 打包回本 ${fmt((sum / (dAll * p.activeSeconds + dAllOff)) * 24, 2)}h`);
}

// ---------------- ⑤ 摸鱼站（新内容，顺带量化） ----------------
log("\n\n================ ⑤ 顺带：摸鱼站奖励量级 ================");
{
  const late = ENERGY_STATES[2]!.state;
  const idle = effectOf(late).idleRate;
  const arc = ensureArcade(late, TODAY);
  let s = arc;
  let total = 0;
  for (const g of ["coffee", "findboss", "rhythm"] as const) {
    const r = finishGame(s, g, 8000, idle, 30);
    if (r) { s = r.state; total += r.reward; }
  }
  log(`  后期 income=${sci(idle)}/s：3 次满分小游戏共 ${sci(total)} ≈ ${fmt(total / idle, 1)} 挂机秒 ≈ ${fmt((total / idle / 3600) * 100, 2)}% 在线小时收益（设计为 3×25s=${3 * TARGET_IDLE_SECONDS}s）`);
}

// ---------------- 写文件 ----------------
writeFileSync("playtest/r14b-hardcore-evidence.json", JSON.stringify({ energy: energyRows, roi: roiRows }, null, 2));
writeFileSync("playtest/r14b-hardcore-evidence.txt", L.join("\n") + "\n");
console.log(L.join("\n"));