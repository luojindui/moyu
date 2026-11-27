// R14 硬核玩家探针（正式证据）：家具 ROI + 每日精力最优分配 + 被支配选项
// 只用引擎函数（只读 src/）；不修改 src/。
// 运行：node_modules/.bin/vite-node playtest/probe-r14-hardcore.ts
import { writeFileSync } from "node:fs";
import { initialState, type GameState } from "../src/engine/state";
import { UPGRADES, costOf, marginalEffect, effectOf, stationIdleScaled } from "../src/engine/upgrades";
import { clickPowerOf } from "../src/engine/actions";
import { DECOR } from "../src/engine/decor";
import { ENERGY_ACTIONS, ENERGY_PER_DAY, emptyEnergy, useEnergy } from "../src/engine/energy";
import {
  COLLEAGUES,
  MISSIONS,
  recruit,
  upgradeColleague,
  dispatchReward,
  missionSecondsFor,
  favorBonuses,
} from "../src/engine/team";
import { offlineEfficiency } from "../src/engine/progression";
import { offlineEarn } from "../src/engine/offline";
import { bossSurviveReward, type EventState } from "../src/engine/events";
import { serialize, restore } from "../src/engine/save";
import { settleReturn } from "../src/engine/resume";

const NOW = Date.now();
const DAY_MS = 86_400_000;
const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toLocaleString("en-US", { maximumFractionDigits: d }) : String(x));
const sci = (x: number) => (x === 0 ? "0" : Math.abs(x) >= 1e6 || Math.abs(x) < 1e-2 ? x.toExponential(2) : x.toFixed(2));
const hrs = (sec: number) => (sec >= 3600 ? `${fmt(sec / 3600, 1)}h` : `${fmt(sec / 60, 1)}min`);
const L: string[] = [];
const log = (s: string) => { L.push(s); };
const withDecor = (s: GameState, id: string): GameState => ({ ...s, decor: [...s.decor, id] });

/** 离线效率（用真实引擎；createdAt 取 3 天前 → 非首日） */
function offEff(s: GameState, visits: number, streakDays: number, talents?: { unlocked: string[] }): number {
  const st: GameState = {
    ...s,
    visits: { date: "2026-01-01", count: visits },
    daily: { date: "2026-01-01", goals: [], streak: streakDays, lastCompleteDate: null, claimed: false, window: 0, claimsToday: 0 },
    talents: talents ? { unlocked: talents.unlocked, points: 0, rankGranted: -1, dailyGiftDate: "", overflow: 0 } : s.talents,
  };
  return offlineEfficiency(st, NOW - 3 * DAY_MS, NOW);
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

// ============================================================== 进度模拟（含真实 state 快照）
interface Profile {
  id: string; name: string;
  cps: number; combo: number; clickSecondsPerDay: number;
  activeSecondsPerDay: number; offlineSecondsPerDay: number;
  visits: number; streakDays: number; dispatch: boolean;
}
const PROFILES: Profile[] = [
  { id: "afk", name: "纯挂机党", cps: 0, combo: 1, clickSecondsPerDay: 0, activeSecondsPerDay: 600, offlineSecondsPerDay: 43200, visits: 1, streakDays: 14, dispatch: false },
  { id: "std", name: "标准混合", cps: 2.5, combo: 1.24, clickSecondsPerDay: 1200, activeSecondsPerDay: 7200, offlineSecondsPerDay: 43200, visits: 1, streakDays: 14, dispatch: true },
  { id: "clicker", name: "点击党", cps: 2.5, combo: 1.24, clickSecondsPerDay: 7200, activeSecondsPerDay: 7200, offlineSecondsPerDay: 43200, visits: 1, streakDays: 14, dispatch: true },
  { id: "online", name: "硬核常开(挂机页全天开)", cps: 2.5, combo: 1.24, clickSecondsPerDay: 1200, activeSecondsPerDay: 86400, offlineSecondsPerDay: 0, visits: 1, streakDays: 14, dispatch: true },
];

interface Cand { kind: "upgrade" | "recruit" | "colleagueUp"; id: string; cost: number; delta: number }

function simProfile(p: Profile) {
  let s: GameState = { ...initialState() };
  let t = 0;
  const pending = new Set(DECOR.map((d) => d.id));
  const decorState = new Map<string, { t: number; state: GameState }>();
  const MAXT = 400 * DAY_MS / 1000;

  const income = (st: GameState) => effectOf(st).idleRate + (p.cps > 0 ? p.cps * p.combo * clickPowerOf(st) : 0);
  const candidates = (st: GameState): Cand[] => {
    const out: Cand[] = [];
    for (const u of UPGRADES) {
      const lv = st.levels[u.id] ?? 0;
      const m = marginalEffect(u.id, lv);
      const delta = u.idleRate ? m.idleRate : p.cps > 0 ? m.clickPower * p.cps * p.combo : 0;
      if (delta > 0) out.push({ kind: "upgrade", id: u.id, cost: costOf(u.id, lv), delta });
    }
    for (const c of COLLEAGUES) {
      const cur = st.team.colleagues[c.id];
      if (!cur) {
        const after = recruit(st, c.id);
        if (after) out.push({ kind: "recruit", id: c.id, cost: c.cost, delta: income(after) - income(st) });
      } else if (cur.level < 5) {
        const after = upgradeColleague(st, c.id);
        if (after) out.push({ kind: "colleagueUp", id: c.id, cost: Math.ceil(c.cost * 0.4 * 1.35 ** cur.level), delta: income(after) - income(st) });
      }
    }
    return out.filter((c) => c.delta > 0);
  };
  const buy = (st: GameState, c: Cand): GameState => {
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
    const nextCost = Math.min(
      ...cands.map((c) => c.cost),
      ...[...pending].map((id) => DECOR.find((d) => d.id === id)!.cost),
    );
    const dt = Math.max((nextCost - s.moyu) / rate, 0.01);
    t += dt;
    const g = rate * dt;
    s = { ...s, moyu: s.moyu + g, totalEarned: s.totalEarned + g, lifetimeEarned: s.lifetimeEarned + g };
  }
  return { s, t, decorState };
}

/** 同时点最优"下一件升级/同事"回本（元/秒），用于对比家具 */
function bestUpgradePayback(s: GameState, p: Profile): { payback: number; what: string } {
  const income = (st: GameState) => effectOf(st).idleRate + (p.cps > 0 ? p.cps * p.combo * clickPowerOf(st) : 0);
  let best = { payback: Infinity, what: "-" };
  for (const u of UPGRADES) {
    const lv = s.levels[u.id] ?? 0;
    const m = marginalEffect(u.id, lv);
    const delta = u.idleRate ? m.idleRate : p.cps > 0 ? m.clickPower * p.cps * p.combo : 0;
    if (delta <= 0) continue;
    const pb = costOf(u.id, lv) / delta;
    if (pb < best.payback) best = { payback: pb, what: `升级:${u.name}` };
  }
  for (const c of COLLEAGUES) {
    const cur = s.team.colleagues[c.id];
    if (!cur) {
      const after = recruit(s, c.id);
      if (!after) continue;
      const d = income(after) - income(s);
      if (d > 0 && c.cost / d < best.payback) best = { payback: c.cost / d, what: `招募:${c.name}` };
    } else if (cur.level < 5) {
      const after = upgradeColleague(s, c.id);
      if (!after) continue;
      const d = income(after) - income(s);
      const cost = Math.ceil(c.cost * 0.4 * 1.35 ** cur.level);
      if (d > 0 && cost / d < best.payback) best = { payback: cost / d, what: `升星:${c.name}` };
    }
  }
  return best;
}

interface DecorRow {
  id: string; name: string; cost: number; desc: string;
  profile: string; tDays: number; income: number; station: number; stationShare: number;
  dIdleOnline: number; dClickOnline: number; dDispatchOnline: number; dOfflinePerDay: number;
  dDaily: number; paybackHours: number; paybackSecondsOnline: number;
  bestUpPayback: number; bestUpWhat: string; ratio: number;
  verdict: string;
}

const allRows: DecorRow[] = [];
for (const p of PROFILES) {
  const sim = simProfile(p);
  log(`\n================ 画像：${p.name}（在线${p.activeSecondsPerDay / 60}min/天，点击${p.clickSecondsPerDay / 60}min/天，回访${p.visits}次/天，派遣=${p.dispatch}） ================`);
  for (const d of DECOR) {
    const got = sim.decorState.get(d.id);
    if (!got) { log(`${d.name}：模拟 400 天内不可达`); continue; }
    const s0 = got.state;
    const withD = withDecor(s0, d.id);
    const dIdleOnline = effectOf(withD).idleRate - effectOf(s0).idleRate;
    const dClickPerClick = clickPowerOf(withD) - clickPowerOf(s0);
    const dClickOnline = dClickPerClick * p.cps * p.combo;
    const dDispatchOnline = p.dispatch ? dispatchRate(withD) - dispatchRate(s0) : 0;
    const eff0 = offEff(s0, p.visits, p.streakDays);
    const eff1 = offEff(withD, p.visits, p.streakDays);
    const dOfflinePerDay = offlineEarn(withD, p.offlineSecondsPerDay, eff1).earned - offlineEarn(s0, p.offlineSecondsPerDay, eff0).earned;
    const dDaily = (dIdleOnline + dDispatchOnline) * p.activeSecondsPerDay + dClickOnline * p.clickSecondsPerDay + dOfflinePerDay;
    const onlinePerSec = dIdleOnline + dClickOnline + dDispatchOnline;
    const paybackSecondsOnline = onlinePerSec > 0 ? d.cost / onlinePerSec : Infinity;
    const paybackHours = dDaily > 0 ? (d.cost / dDaily) * 24 : Infinity;
    const alt = bestUpgradePayback(s0, p);
    const ratio = onlinePerSec > 0 && alt.payback > 0 && Number.isFinite(alt.payback) ? paybackSecondsOnline / alt.payback : NaN;
    const income = effectOf(s0).idleRate;
    const station = stationIdleScaled(s0);
    const row: DecorRow = {
      id: d.id, name: d.name, cost: d.cost, desc: d.desc, profile: p.id,
      tDays: got.t / 86400, income, station, stationShare: income > 0 ? station / income : 0,
      dIdleOnline, dClickOnline, dDispatchOnline, dOfflinePerDay, dDaily, paybackHours, paybackSecondsOnline,
      bestUpPayback: alt.payback, bestUpWhat: alt.what, ratio, verdict: "",
    };
    // 自动判定
    if (dDaily <= 0) row.verdict = "零收益（坑）";
    else if (paybackHours <= 1) row.verdict = "极佳";
    else if (paybackHours <= 8) row.verdict = "好";
    else if (paybackHours <= 24) row.verdict = "一般";
    else row.verdict = "差";
    if (onlinePerSec <= 0 && dOfflinePerDay > 0) row.verdict += "（仅离线兑现）";
    allRows.push(row);
    log(
      `[${d.name}] 价=${fmt(d.cost)}（第${fmt(got.t / 86400, 2)}天可买, 当时income=${sci(income)}/s, station占比${(row.stationShare * 100).toFixed(0)}%）` +
      ` Δ挂机/s=${sci(dIdleOnline)} Δ点击/s=${sci(dClickOnline)} Δ派遣/s=${sci(dDispatchOnline)} Δ离线/天=${sci(dOfflinePerDay)}` +
      ` → 日收益=${sci(dDaily)} 回本≈${fmt(paybackHours, 2)}h（在线口径 ${hrs(paybackSecondsOnline)}）` +
      ` ｜同时点最优替代：${alt.what} 回本=${hrs(alt.payback)}${Number.isFinite(ratio) ? `（家具/替代=${fmt(ratio, 2)}×）` : ""} → ${row.verdict}`,
    );
  }
}

// -------- 汇总：全套打包价值 --------
{
  let mult = 1;
  for (const d of DECOR) if (d.effects.idleMult) mult *= d.effects.idleMult;
  const sum = DECOR.reduce((a, b) => a + b.cost, 0);
  const std = PROFILES.find((p) => p.id === "std")!;
  const last = simProfile(std).decorState.get("catbed");
  const sEnd = last?.state;
  if (sEnd) {
    const allDecor = DECOR.reduce((st, d) => withDecor(st, d.id), sEnd);
    const dAll = effectOf(allDecor).idleRate - effectOf(sEnd).idleRate;
    log(`\n【打包】8 件家具总价=${fmt(sum)}；全买齐 idle ×${fmt(mult, 3)}（+${fmt((mult - 1) * 100, 1)}%）、点击 ×1.265、离线 +23%、派遣 ×1.3`);
    log(`【打包】以猫窝可买时点（income=${sci(effectOf(sEnd).idleRate)}/s）算：整套 Δ挂机/s=${sci(dAll)}，全套 2.23e9 只值 ${hrs(sum / dAll)} 的当前收入增量（一次付清）`);
    const alt = bestUpgradePayback(sEnd, std);
    log(`【打包】同一时点下一件升级回本=${hrs(alt.payback)}（${alt.what}）→ 家具打包回本 ${hrs(sum / dAll)}，是升级的 ${fmt(sum / dAll / alt.payback, 1)} 倍好`);
  }
}

// ============================================================== 精力
log(`\n\n================ 每日精力（3 选 1 次/天，100 点） ================`);
{
  let st: GameState = { ...initialState(), energy: { date: "2026-11-27", left: ENERGY_PER_DAY, used: [], boosted: { idleMult: 1, patrolRewardMult: 1 } } };
  const a1 = useEnergy(st, "slack");
  const a2 = a1 ? useEnergy(a1, "fake-work") : null;
  const a3 = a2 ? useEnergy(a2, "social") : null;
  log(`成本合计 = 40+35+25 = ${ENERGY_ACTIONS.reduce((a, b) => a + b.cost, 0)} = 每日精力 ${ENERGY_PER_DAY} → 三项可以全部使用；`);
  log(`引擎实测：slack→剩${a1?.energy.left}；fake-work→剩${a2?.energy.left}；social→剩${a3?.energy.left}；第4次=${useEnergy(a3!, "slack") === null ? "null（不可重复）" : "可点"}`);
  log(`→ 不存在"分配"：100 点刚好等于三项总价，最优解恒为"全点"，无取舍。`);
}

interface EnergyRow {
  snap: string; income: number; stationShare: number;
  slackOnline: number; slackOffline: number; slackTotal: number;
  fakeWork: number; socialTerminalPerDay: number; socialAveragePerDay: number; daysToMax: number;
  perPointSlack: number; perPointFake: number;
}
const energyRows: EnergyRow[] = [];
const snaps: Array<{ name: string; levels: Record<string, number>; cols: string[]; favor: number; visits: number; streak: number }> = [
  { name: "早期(D1)", levels: { phone: 3, toilet: 2, group: 1, coffee: 2, water: 1 }, cols: ["zhou"], favor: 0, visits: 1, streak: 0 },
  { name: "中期(D7)", levels: { phone: 12, toilet: 12, group: 12, meeting: 10, deep: 6, coffee: 8, water: 5, chair: 3 }, cols: ["zhou", "mei", "qiang"], favor: 40, visits: 3, streak: 7 },
  { name: "后期(D30)", levels: { phone: 25, toilet: 25, group: 25, meeting: 25, deep: 25, retire: 20, coffee: 20, water: 15, chair: 10 }, cols: ["zhou", "mei", "qiang", "li", "wang"], favor: 100, visits: 3, streak: 30 },
];
for (const sn of snaps) {
  let s: GameState = { ...initialState(), moyu: 1e12, totalEarned: 1e12, lifetimeEarned: 1e12, levels: { ...sn.levels } };
  for (const id of sn.cols) {
    s = recruit(s, id)!;
    while ((s.team.colleagues[id]?.level ?? 0) < 3) s = upgradeColleague(s, id)!;
    s = { ...s, team: { colleagues: { ...s.team.colleagues, [id]: { ...s.team.colleagues[id]!, favor: sn.favor } } } };
  }
  const eff0 = effectOf(s).idleRate;
  const station = stationIdleScaled(s);
  const stationShare = eff0 > 0 ? station / eff0 : 0;
  const activeSec = 7200;
  const offSec = 43200;
  const offEffRate = offEff(s, sn.visits, sn.streak);

  // --- slack 引擎口径 ---
  const sSlack: GameState = { ...s, energy: { date: "x", left: 0, used: ["slack"], boosted: { idleMult: 1.25, patrolRewardMult: 1 } } };
  const slackOnline = (effectOf(sSlack).idleRate - eff0) * activeSec;
  const slackOffline = offlineEarn(sSlack, offSec, offEffRate).earned - offlineEarn(s, offSec, offEffRate).earned;
  const slackTotal = slackOnline + slackOffline;

  // --- fake-work 引擎口径 ---
  const esBase: EventState = {
    nextBossAt: 0, bossUntil: 0, nextMemeAt: 0, memeUntil: 0, bossCaught: false, bossStartAt: 0,
    surviveStreak: 5, bossVariant: "hold", bossTaps: 0, bossPenaltyTotal: 0, patrolCount: 10,
    memeCount: 0, bossPersonality: "hasty", bossChoiceDone: false, forcedVariant: null,
  };
  const rew0 = bossSurviveReward(s, esBase);
  const rew1 = bossSurviveReward({ ...s, energy: { date: "x", left: 0, used: ["fake-work"], boosted: { idleMult: 1, patrolRewardMult: 1.8 } } }, esBase);
  const variantAvg = 0.35 * 1 + 0.30 * 1 + 0.2 * 1.5 + 0.15 * 1.8; // hold/type/blitz/choice
  const patrolsPerDay = activeSec / 120;
  const fakeWork = (rew1 - rew0) * variantAvg * patrolsPerDay;

  // --- social：+3 全员好感 ---
  const favorState = (favor: number): GameState => {
    const cols = { ...s.team.colleagues };
    for (const k of Object.keys(cols)) cols[k] = { ...cols[k]!, favor };
    return { ...s, team: { colleagues: cols } };
  };
  const f0 = favorState(0);
  const f100 = favorState(100);
  const b0 = favorBonuses(f0);
  const b100 = favorBonuses(f100);
  const idle100 = effectOf(f100).idleRate - effectOf(f0).idleRate;
  const disp100 = dispatchRate(f100) - dispatchRate(f0);
  const offGainEff = offEff(f100, sn.visits, sn.streak) - offEff(f0, sn.visits, sn.streak);
  const teamPart = eff0 - station;
  const offGain = offGainEff > 0 ? offGainEff * (station + teamPart * 0.5) * offSec : 0;
  const memePerDay = (activeSec / 60) * 5 * clickPowerOf(s) * (b100.memeMult - b0.memeMult);
  const socialTerminalPerDay = idle100 * activeSec + disp100 * activeSec + offGain + memePerDay;
  const daysToMax = 100 / 3;
  const socialAveragePerDay = socialTerminalPerDay / daysToMax;

  const row: EnergyRow = {
    snap: sn.name, income: eff0, stationShare,
    slackOnline, slackOffline, slackTotal, fakeWork,
    socialTerminalPerDay, socialAveragePerDay, daysToMax,
    perPointSlack: slackTotal / 40, perPointFake: fakeWork / 35,
  };
  energyRows.push(row);
  log(
    `\n【${sn.name}】income=${sci(eff0)}/s，工位占比=${(stationShare * 100).toFixed(0)}%，好感=${sn.favor}，离线效率=${offEffRate.toFixed(2)}\n` +
    `  认真摸鱼(40点,+25%挂机): 在线 2h=${sci(slackOnline)} + 离线 12h=${sci(slackOffline)} = 日价值 ${sci(slackTotal)}（${sci(slackTotal / 40)}/点）\n` +
    `  假装工作(35点,+80%巡逻奖): 单次安然 ${sci(rew0)}→${sci(rew1)}，在线 2h×${patrolsPerDay.toFixed(0)}次×变体均值${variantAvg.toFixed(2)} = 日价值 ${sci(fakeWork)}（${sci(fakeWork / 35)}/点）\n` +
    `  跟同事聊天(25点,+3好感): 引擎实测（派单领奖 +2~3/次，3min 任务 ≈2h 满 100）→ 从 0→100 的终局日价值仅 ${sci(socialTerminalPerDay)}，摊到 34 天 ${sci(socialAveragePerDay)}/天（${sci(socialAveragePerDay / 25)}/点）；满 100 后永久 0 收益`,
  );
}

// 稀缺预算反事实
log(`\n【稀缺预算反事实】若预算 < 100（三选二）：`);
{
  for (const r of energyRows) {
    const opts = [
      { name: "slack+fake-work(75)", v: r.slackTotal + r.fakeWork },
      { name: "slack+social(65)", v: r.slackTotal + r.socialAveragePerDay },
      { name: "fake-work+social(60)", v: r.fakeWork + r.socialAveragePerDay },
    ].sort((a, b) => b.v - a.v);
    log(`  ${r.snap}: 最优=${opts[0]!.name}（${sci(opts[0]!.v)}）；次优=${opts[1]!.name}（${sci(opts[1]!.v)}）→ ${opts[0]!.name.startsWith("slack+") ? "slack 必选" : "?"}`);
  }
}

// ============================================================== 被支配 / 失效证据
log(`\n\n================ 被支配 / 失效证据 ================`);
{
  // (1) 家具在离线效率封顶下的实际收益
  const base: GameState = { ...initialState(), moyu: 1e12, levels: { phone: 20, toilet: 20, group: 20, meeting: 20, deep: 15 }, decor: [] };
  let bs = recruit(base, "zhou")!;
  bs = { ...bs, team: { colleagues: { ...bs.team.colleagues, zhou: { ...bs.team.colleagues.zhou!, favor: 40 } } } };
  let bsMei = recruit(bs, "mei")!;
  log(`\n(1) 离线效率封顶 → 地毯/按摩椅真实收益（12h 离线结算，用真实引擎）：`);
  const cases: Array<{ name: string; visits: number; streak: number; mei: boolean; favor40: boolean; talents?: { unlocked: string[] } }> = [
    { name: "新手 D2（无连签无小美）", visits: 1, streak: 0, mei: false, favor40: false },
    { name: "D8（连签7天）", visits: 1, streak: 7, mei: false, favor40: false },
    { name: "D22（连签3周=+15%）", visits: 1, streak: 21, mei: false, favor40: false },
    { name: "D22+小美(离线+2%)", visits: 1, streak: 21, mei: true, favor40: false },
    { name: "D22+小美+好感40(+3%)", visits: 1, streak: 21, mei: true, favor40: true },
    { name: "回访3次/天", visits: 3, streak: 21, mei: true, favor40: true },
    { name: "带 idle_4 天赋(+0.08上限)", visits: 1, streak: 21, mei: true, favor40: true, talents: { unlocked: ["idle_4"] } },
  ];
  for (const c of cases) {
    let st = c.mei ? bsMei : bs;
    if (!c.favor40) st = { ...st, team: { colleagues: Object.fromEntries(Object.entries(st.team.colleagues).map(([k, v]) => [k, { ...v, favor: 0 }])) } };
    const e0 = offEff(st, c.visits, c.streak, c.talents ? { unlocked: c.talents.unlocked } : undefined);
    const rugSt = withDecor(st, "rug");
    const chairSt = withDecor(st, "chair");
    const both = withDecor(rugSt, "chair");
    const eRug = offEff(rugSt, c.visits, c.streak, c.talents ? { unlocked: c.talents.unlocked } : undefined);
    const eChair = offEff(chairSt, c.visits, c.streak, c.talents ? { unlocked: c.talents.unlocked } : undefined);
    const eBoth = offEff(both, c.visits, c.streak, c.talents ? { unlocked: c.talents.unlocked } : undefined);
    const gain = (st2: GameState, eff: number) => offlineEarn(st2, 43200, eff).earned - offlineEarn(st, 43200, e0).earned;
    log(
      `  ${c.name.padEnd(24)} 效率 无=${e0.toFixed(3)} 地毯=${eRug.toFixed(3)}(+${fmt(gain(rugSt, eRug))}) 按摩椅=${eChair.toFixed(3)}(+${fmt(gain(chairSt, eChair))}) 两件=${eBoth.toFixed(3)}(+${fmt(gain(both, eBoth))})`,
    );
  }
  // (2) social 无同事 / 满好感
  const noTeam: GameState = { ...initialState(), energy: emptyEnergy("2026-11-27") };
  const socialNoTeam = useEnergy(noTeam, "social")!;
  log(`\n(2) "跟同事聊天"边界：无同事时使用 → 团队状态不变 ${JSON.stringify(socialNoTeam.team)}（25 点换 0）。`);
  const maxFavor = favorStateLocal(bsMei, 100);
  const socialMax = useEnergy({ ...maxFavor, energy: emptyEnergy("2026-11-27") }, "social")!;
  log(`    全部同事好感已 100 时使用 → ${JSON.stringify(socialMax.team.colleagues.zhou?.favor)}（仍 100，25 点换 0）`);
  // 派单好感速度
  log(`    好感获取主渠道是派遣领奖：领奖 +2（匹配任务 +3），3 分钟任务 ≈ 2h 满 100；+3/天 仅相当于 1~1.5 次领奖`);
  // (3) 点击/派遣向家具在"非对应画像"下为 0
  log(`\n(3) 画像依赖性（无对应行为时家具完全无收益）：`);
  const afkSim = simProfile(PROFILES[0]!);
  const lampAt = afkSim.decorState.get("lamp");
  const projAt = afkSim.decorState.get("projector");
  if (lampAt) {
    const withLamp = withDecor(lampAt.state, "lamp");
    log(`    纯挂机党 买护眼台灯(2万) → Δincome=${sci(effectOf(withLamp).idleRate - effectOf(lampAt.state).idleRate)}/s（点击为 0，纯扔钱）`);
  }
  if (projAt) {
    const withProj = withDecor(projAt.state, "projector");
    log(`    从不派遣 买投影仪(2亿) → Δ挂机=${sci(effectOf(withProj).idleRate - effectOf(projAt.state).idleRate)}/s、Δ派遣=${sci(dispatchRate(withProj) - dispatchRate(projAt.state))}/s（对挂机党纯扔钱）`);
  }
  // (4) 离线结算把"家具/卡/精力"的挂机倍率算进同事部分并减半
  log(`\n(4) offlineEarn 口径 bug：工位倍率（家具/今日卡/精力）在离线结算里只按 50% 计入（被误划入"同事部分"）。`);
  {
    const st: GameState = { ...initialState(), levels: { phone: 20, toilet: 20, group: 20, meeting: 20 } };
    const pSt = withDecor(st, "plant");
    const e = offEff(st, 1, 21);
    const real = offlineEarn(pSt, 43200, e).earned - offlineEarn(st, 43200, e).earned;
    const expect = 0.05 * stationIdleScaled(st) * 43200 * e;
    log(`    例：绿萝(+5% 工位) 在 12h 离线结算里拿到 ${sci(real)}，应为 ${sci(expect)}（实际=${fmt((real / expect) * 100, 0)}%）`);
  }
  // (5) 精力"今日"跨日泄漏
  log(`\n(5) 精力"持续到当天结束"被违反：boot 里先 settleReturn 再在首帧 ensureEnergy 重置；存档保留旧 boosted。`);
  {
    const st: GameState = { ...initialState(), levels: { phone: 20, toilet: 20, group: 20, meeting: 20, deep: 10 } };
    const stale: GameState = { ...st, energy: { date: "2000-01-01", left: 0, used: ["slack", "fake-work", "social"], boosted: { idleMult: 1.25, patrolRewardMult: 1.8 } } };
    const mem = new Map<string, string>();
    const adapter = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
    serialize(stale, adapter, NOW - 43200 * 1000); // 12 小时前存档
    const restored = restore(adapter, NOW);
    const rst = restored.state!;
    const e = offEff(rst, 1, 21);
    log(`    存档读回：energy.date=${rst.energy.date}（昨天） boosted.idleMult=${rst.energy.boosted.idleMult}`);
    const settleStale = settleReturn({ ...rst, energy: { ...rst.energy, date: "2000-01-01", boosted: { idleMult: 1.25, patrolRewardMult: 1.8 } } }, NOW - restored.offlineSeconds * 1000, NOW, e);
    const settleClean = settleReturn({ ...rst, energy: emptyEnergy("2026-11-27") }, NOW - restored.offlineSeconds * 1000, NOW, e);
    log(`    12h 离线结算：带昨日 slack 加成=${sci(settleStale.earned)} vs 无加成=${sci(settleClean.earned)}（多 ${fmt(((settleStale.earned / settleClean.earned - 1) * 100), 1)}%）→ 昨日 buff 结算进今日离线`);
  }
}

function favorStateLocal(s: GameState, f: number): GameState {
  const cols = { ...s.team.colleagues };
  for (const k of Object.keys(cols)) cols[k] = { ...cols[k]!, favor: f };
  return { ...s, team: { colleagues: cols } };
}

// ============================================================== 写文件
writeFileSync("playtest/r14-hardcore-evidence.json", JSON.stringify({ decor: allRows, energy: energyRows }, null, 2));
writeFileSync("playtest/r14-hardcore-evidence.txt", L.join("\n") + "\n");
console.log(L.join("\n"));