/**
 * 终验·管理/策略党专属引擎探针 v3（v0.5.0，HEAD 9760eab）
 * 修正：离线效率用 ms 时间戳（DAY_MS）；状态来自真实 ROI 贪心推进模拟，量级自洽。
 * 输出：playtest/final-mgr/*.json
 */
import { describe, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { initialState, type GameState, gain } from "../src/engine/state";
import { UPGRADES, costOf, effectOf, stationIdleScaled, stationIdleOf, valueScoreOf } from "../src/engine/upgrades";
import { clickPowerOf, buyUpgrade } from "../src/engine/actions";
import { DECOR, decorEffects, buyDecor, DECOR_COMPLETE_BONUS } from "../src/engine/decor";
import { COLLEAGUES, MISSIONS, dispatchReward, missionSecondsFor, teamFixedRate, teamShareRatio, recruit, upgradeColleague, upgradeCostOf, favorBonuses, MAX_COLLEAGUE_LEVEL } from "../src/engine/team";
import { ENERGY_ACTIONS, useEnergy, ENERGY_PER_DAY } from "../src/engine/energy";
import { CARDS, cardEffects } from "../src/engine/cards";
import { TALENTS, talentEffects, unlockTalent, costOfTalent, TALENT_POINT_CAP } from "../src/engine/talents";
import { dailyReward, ensureDaily, claimDaily } from "../src/engine/daily";
import { bossSurviveReward } from "../src/engine/events";
import { offlineEfficiency } from "../src/engine/progression";
import { prestigeMultiplier, prestigeGain, prestigeThreshold, canPrestige, doPrestige, PRESTIGE_TUNING } from "../src/engine/prestige";

const OUT_DIR = "playtest/final-mgr";
mkdirSync(OUT_DIR, { recursive: true });
const NOW = Date.now();
const DAY_MS = 86_400_000;
const TD = new Date(NOW).toLocaleDateString("sv-SE");

function mk(over: Partial<GameState> = {}): GameState { return { ...initialState(), ...over } as GameState; }
function collected(n: number) {
  const quotes = Array.from({ length: Math.min(n, 10) }, (_, i) => i);
  return { quotes, flavors: Array.from({ length: Math.min(Math.max(0, n - quotes.length), 45) }, (_, i) => i) };
}
function emptyEnergy(): GameState["energy"] { return { date: "", left: ENERGY_PER_DAY, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } }; }
function withEnergy(state: GameState, actions: string[]): GameState {
  let s: GameState = { ...state, energy: emptyEnergy() };
  for (const a of actions) s = useEnergy(s, a as never) ?? s;
  return s;
}
function emptyCards(): GameState["cards"] { return { date: "", offers: [], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: false, chosenDate: "" }; }
function withCard(state: GameState, cardId: string | null): GameState {
  if (!cardId) return { ...state, cards: emptyCards() };
  return { ...state, cards: { ...emptyCards(), offers: [cardId], chosen: cardId, until: NOW + 24 * 3600 * 1000 } };
}
const VISITS3 = () => ({ date: TD, count: 3 });
function emptyDaily(): GameState["daily"] { return { date: TD, goals: [], streak: 0, lastCompleteDate: null, claimed: false, window: 0, claimsToday: 0 }; }

/* ---------- 通道 ---------- */
function bestMission(state: GameState, id: string, station: number, mode: "hour" | "round"): number {
  let best = 0;
  for (const m of MISSIONS) {
    const probe: GameState = { ...state, team: { colleagues: { ...state.team.colleagues, [id]: { ...state.team.colleagues[id]!, missionId: m.id } } } };
    const secs = missionSecondsFor(id, m.id);
    const r = dispatchReward(probe, id, station);
    const v = mode === "hour" ? (secs > 0 ? (r / secs) * 3600 : 0) : r;
    if (v > best) best = v;
  }
  return best;
}
function channels(state: GameState) {
  const station = stationIdleScaled(state);
  const idleRate = effectOf(state).idleRate;
  const collectionBonus = 1 + Math.min(0.2, 0.02 * Math.floor((state.collected.quotes.length + state.collected.flavors.length) / 5));
  const rawMult = prestigeMultiplier(state.prestige) * collectionBonus;
  const favor = favorBonuses(state);
  const talent = talentEffects(state.talents);
  const teamFixed = teamFixedRate(state) * rawMult * favor.idleMult * talent.teamIdleMult;
  const teamShare = stationIdleOf(state) * rawMult * teamShareRatio(state) * talent.teamIdleMult;
  const clickPower = clickPowerOf(state);
  let dispatchPerHour = 0;
  let dispatchRound = 0;
  for (const def of COLLEAGUES) {
    if (!state.team.colleagues[def.id]) continue;
    dispatchPerHour += bestMission(state, def.id, station, "hour");
    dispatchRound += bestMission(state, def.id, station, "round");
  }
  const offlineEff = offlineEfficiency(state, NOW - 3 * DAY_MS, NOW);
  const teamPart = Math.max(0, idleRate - station);
  return { station, teamFixed, teamShare, idleRate, clickPower, dispatchPerHour, dispatchRound, offlineEff, arcadePerGame: Math.max(Math.floor(station * 25), 30), dailyPerClaim: dailyReward(state), patrolPerEvent: bossSurviveReward(state, { surviveStreak: 5 } as never), memePerHour: 60 * 5 * clickPower * talent.memeRewardMult * favor.memeMult, offlinePerSec: (station + teamPart * 0.5) * offlineEff };
}
interface Profile { name: string; activeHours: number; clicksPerDay: number; offlineHours: number; arcadeGames: number; dailyClaims: number; patrolPerHour: number; }
const P_FRAG: Profile = { name: "碎片3访(在线0.5h/0点击/离线23h)", activeHours: 0.5, clicksPerDay: 0, offlineHours: 23, arcadeGames: 3, dailyClaims: 4, patrolPerHour: 30 };
const P_HEAVY: Profile = { name: "重度(在线2h/5400点击/离线21h)", activeHours: 2, clicksPerDay: 5400, offlineHours: 21, arcadeGames: 3, dailyClaims: 4, patrolPerHour: 30 };
function dailyBreakdown(state: GameState, p: Profile) {
  const c = channels(state);
  const o = {
    clickIncome: p.clicksPerDay * c.clickPower * 1.1, station: c.station * p.activeHours * 3600,
    teamFixed: c.teamFixed * p.activeHours * 3600, teamShare: c.teamShare * p.activeHours * 3600,
    dispatchOnline: c.dispatchPerHour * p.activeHours, dispatchOffline: c.dispatchRound,
    patrol: c.patrolPerEvent * p.patrolPerHour * p.activeHours, meme: c.memePerHour * p.activeHours,
    arcade: c.arcadePerGame * p.arcadeGames, daily: c.dailyPerClaim * p.dailyClaims,
    offline: c.offlinePerSec * p.offlineHours * 3600,
  };
  const dispatch = o.dispatchOnline + o.dispatchOffline;
  return { ...o, dispatch, total: o.clickIncome + o.station + o.teamFixed + o.teamShare + dispatch + o.patrol + o.meme + o.arcade + o.daily + o.offline };
}
function sharePct(b: ReturnType<typeof dailyBreakdown>) {
  const keys = ["clickIncome", "station", "teamFixed", "teamShare", "dispatch", "patrol", "meme", "arcade", "daily", "offline"] as const;
  const o: Record<string, string> = {};
  for (const k of keys) o[k] = b.total > 0 ? ((b[k] / b.total) * 100).toFixed(1) + "%" : "0%";
  return o;
}

/* ---------- 推进模拟（ROI 贪心） ---------- */
function emptyState(): GameState {
  return mk({ visits: VISITS3(), daily: emptyDaily(), totalClicks: 600, lifetimeEarned: 0, totalEarned: 0, moyu: 30, prestige: 0 });
}
interface Snap { days: number; state: GameState; note: string }
/** 真实玩家节奏：每天 3 次会话（09/13/20，每次 20 分钟），离线按 12h 封顶结算；
 *  只在会话内购买（每 60s 最多 3 次），避免"离线期间无限购买"的非现实复利。 */
function simulate(days: number, opts: { prestigeMultiple?: number; checkpoints?: number[] } = {}): Snap[] {
  let st = emptyState();
  const checkpoints = opts.checkpoints ?? [];
  const snaps: Snap[] = [];
  const SESSIONS: [number, number][] = [[9 * 3600, 1200], [13 * 3600, 1200], [20 * 3600, 1200]];
  const eff = () => offlineEfficiency(st, NOW - 10 * DAY_MS, NOW);
  const cap = 12 * 3600;
  let lastEnd = 0; // 从 day0 00:00 起算
  const buy = () => {
    for (let k = 0; k < 3; k++) {
      const b0 = channels(st);
      let best: { next: GameState; score: number } | null = null;
      const consider = (next: GameState | null, cost: number) => {
        if (!next || cost > st.moyu) return;
        const c1 = channels(next);
        const d = c1.idleRate - b0.idleRate + (c1.dispatchPerHour - b0.dispatchPerHour) / 3600;
        if (d <= 0) return;
        const score = d / cost;
        if (!best || score > best.score) best = { next, score };
      };
      for (const u of UPGRADES) consider(buyUpgrade(st, u.id), costOf(u.id, st.levels[u.id] ?? 0));
      for (const d of DECOR) consider(buyDecor(st, d.id), d.cost);
      for (const def of COLLEAGUES) {
        const cur = st.team.colleagues[def.id];
        if (cur && cur.level >= MAX_COLLEAGUE_LEVEL) continue;
        consider(cur ? upgradeColleague(st, def.id) : recruit(st, def.id), cur ? upgradeCostOf(def, cur.level) : def.cost);
      }
      if (!best) break;
      st = (best as any).next;
    }
  };
  for (let d = 0; d < days; d++) {
    for (const [startOff, dur] of SESSIONS) {
      const tStart = d * 86400 + startOff;
      // 会话前离线结算
      const gap = Math.min(Math.max(0, tStart - lastEnd), cap);
      if (gap > 0) {
        const c = channels(st);
        const earn = (c.offlinePerSec) * gap;
        st = gain(st, earn);
      }
      // 会话开始：先花掉攒的钱（最多 9 次），之后每 60s 3 次
      buy();
      for (let t = 0; t < dur; t += 60) {
        st = gain(st, effectOf(st).idleRate * 60);
        st = gain(st, channels(st).dispatchPerHour / 3600 * 60 * 0.3); // 会话内派遣约 30% 时间覆盖
        buy();
      }
      lastEnd = tStart + dur;
      const k = opts.prestigeMultiple ?? Infinity;
      if (k !== Infinity && canPrestige(st) && st.totalEarned >= prestigeThreshold(st) * k) {
        const r = doPrestige(st);
        if (r) st = r.state;
      }
      const dayFrac = (tStart + dur - d * 86400) / 86400; // 用于 checkpoints
      void dayFrac;
    }
    const tEnd = (d + 1) * 86400;
    if (checkpoints.includes(d + 1)) snaps.push({ days: d + 1, state: st, note: `snapshot@D${d + 1}` });
  }
  return snaps;
}

describe("终验·管理党 v3 · 资源流向 / 协同 / 决策深度", () => {
  let S: Record<string, GameState> = {};
  let snapsMeta: unknown = {};
  it("0) 推进生成阶段状态（D0.1/D1/D2/D4/D7；另出 D7 带转生）", () => {
    const noP = simulate(7, { checkpoints: [1, 2, 4, 7] });
    const withP = simulate(7, { prestigeMultiple: 10, checkpoints: [7] });
    const byDay = (d: number) => noP.find((s) => Math.abs(s.days - d) < 1e-6)!.state;
    S = { d1: byDay(1), d2: byDay(2), d4: byDay(4), d7: byDay(7), d7p: withP[0]!.state };
    snapsMeta = Object.fromEntries(Object.entries(S).map(([k, v]) => [k, {
      levels: v.levels, decor: v.decor, colleagues: Object.fromEntries(Object.entries(v.team.colleagues).map(([id, c]) => [id, c.level])),
      moyu: Math.round(v.moyu), lifetime: Math.round(v.lifetimeEarned), prestige: v.prestige,
      idleRate: Math.round(effectOf(v).idleRate), station: Math.round(stationIdleScaled(v)), clickPower: Math.round(clickPowerOf(v)),
      collection: v.collected.quotes.length + v.collected.flavors.length,
    }]));
    writeFileSync(`${OUT_DIR}/snapshots.json`, JSON.stringify(snapsMeta, null, 2));
    for (const [k, v] of Object.entries(snapsMeta)) console.log("[snap]", k, JSON.stringify({ idle: (v as any).idleRate, station: (v as any).station, lifetime: (v as any).lifetime, levels: Object.entries((v as any).levels).map(([a, b]) => `${a}:${b}`).join(","), decor: (v as any).decor.length, cols: (v as any).colleagues }));
  });

  it("1) 资源流向：各阶段来源占比", () => {
    const stages: Record<string, GameState> = { d1: S.d1, d2: S.d2, d4: S.d4, d7p: S.d7p };
    const out: Record<string, unknown> = {};
    for (const [name, st] of Object.entries(stages)) {
      const prof = {} as Record<string, unknown>;
      for (const p of [P_FRAG, P_HEAVY]) {
        const b = dailyBreakdown(st, p);
        prof[p.name] = { totalPerDay: Math.round(b.total), share: sharePct(b), raw: Object.fromEntries(Object.entries(b).filter(([k]) => k !== "total").map(([k, v]) => [k, Math.round(v as number)])) };
      }
      out[name] = { profiles: prof, channels: Object.fromEntries(Object.entries(channels(st)).map(([k, v]) => [k, +v.toFixed(3)])) };
    }
    writeFileSync(`${OUT_DIR}/flow.json`, JSON.stringify(out, null, 2));
    for (const [k, v] of Object.entries(out)) {
      const f = ((v as any).profiles)[P_FRAG.name];
      console.log("[flow]", k, "total", f.totalPerDay, JSON.stringify(f.share));
    }
  });

  it("2) 倍率叠加矩阵（D2 状态，基底天赋=4 系全 6 点）", () => {
    const st = S.d2;
    const base = { ...st, talents: { unlocked: ["idle_1", "idle_2", "idle_3", "idle_4", "event_1", "event_2", "event_3", "event_4"], points: 0, rankGranted: 12, dailyGiftDate: "", overflow: 0 } };
    const b0 = channels(base);
    const toggleTalent = (ids: string[]) => { let s = base; for (const id of ids) { const n = unlockTalent({ ...s, talents: { ...s.talents, points: 24 } }, id); if (n) s = n; } return s; };
    const cases: { id: string; apply: (s: GameState) => GameState; baseline?: (s: GameState) => GameState }[] = [
      { id: "energy:slack 工位挂机+25%", apply: (s) => withEnergy(s, ["slack"]) },
      { id: "energy:social 工位挂机+5%/好感+5", apply: (s) => withEnergy(s, ["social"]) },
      { id: "energy:focus 点击×2/工位挂机+8%", apply: (s) => withEnergy(s, ["focus"]) },
      { id: "energy:fake-work 巡逻×2.2", apply: (s) => withEnergy(s, ["fake-work"]) },
      { id: "card:咖啡管够 工位挂机+15%", apply: (s) => withCard(s, "coffee_day") },
      { id: "card:团建吃饭 派遣+40%", apply: (s) => withCard(s, "team_bond") },
      { id: "card:提前下班 离线+15%", apply: (s) => withCard(s, "early_leave") },
      { id: "card:手速上头 点击+80%", apply: (s) => withCard(s, "click_frenzy") },
      { id: "card:通宵摸鱼 工位挂机+60%/离线-20%", apply: (s) => withCard(s, "overtime") },
      { id: "card:老板出差 巡逻+50%/频率+30%", apply: (s) => withCard(s, "quiet_day") },
      { id: "decor:投影仪 派遣+30%（基线=未购）", apply: (s) => ({ ...s, decor: [...s.decor.filter((x) => x !== "projector"), "projector"] }), baseline: (s: GameState) => ({ ...s, decor: s.decor.filter((x) => x !== "projector") }) },
      { id: "decor:鱼缸 工位挂机+10%/点击+10%（基线=未购）", apply: (s) => ({ ...s, decor: [...s.decor.filter((x) => x !== "aquarium"), "aquarium"] }), baseline: (s: GameState) => ({ ...s, decor: s.decor.filter((x) => x !== "aquarium") }) },
      { id: "decor:猫窝 工位挂机+15%/离线+10%", apply: (s) => ({ ...s, decor: [...s.decor.filter((x) => x !== "catbed"), "catbed"] }) },
      { id: "decor:鱼缸+投影仪+猫窝（一起）", apply: (s) => ({ ...s, decor: [...new Set([...s.decor, "aquarium", "projector", "catbed"])] }) },
      { id: "talent:idle_5a 工位挂机+20%", apply: (s) => toggleTalent(["idle_5a"]) },
      { id: "talent:idle_5b 同事挂机+70%", apply: (s) => toggleTalent(["idle_5b"]) },
      { id: "talent:event_5a 安然转化+1%/次(封顶30%)", apply: (s) => toggleTalent(["event_5a"]) },
      { id: "talent:event_5b 巡逻/梗×2+离线+20%", apply: (s) => toggleTalent(["event_5b"]) },
      { id: "talent:click_5b 工位+12%+点击+60%", apply: (s) => toggleTalent(["click_1", "click_2", "click_3", "click_4", "click_5b"]) },
      { id: "prestige:+1 点（总倍率+0.75）", apply: (s) => ({ ...s, prestige: s.prestige + 1 }) },
      { id: "collection:+5 格（挂机+2%）", apply: (s) => ({ ...s, collected: collected(Math.min(55, s.collected.quotes.length + s.collected.flavors.length + 5)) }) },
      { id: "组合:投影仪+slack+咖啡卡", apply: (s) => withCard(withEnergy({ ...s, decor: [...s.decor.filter((x) => x !== "projector"), "projector"] }, ["slack"]), "coffee_day") },
    ];
    const rows: unknown[] = [];
    for (const c of cases) {
      const baseForCase = c.baseline ? channels(c.baseline(base)) : b0;
      const bb = c.baseline ? channels(c.baseline(base)) : b0;
      const b = channels(c.apply(c.baseline ? c.baseline(base) : base));
      const rel = (a: number, o: number) => (o > 0 ? +((a / o - 1) * 100).toFixed(2) : null);
      void baseForCase;
      rows.push({ id: c.id, station: rel(b.station, b0.station), teamFixed: rel(b.teamFixed, b0.teamFixed), teamShare: rel(b.teamShare, b0.teamShare), idleTotal: rel(b.idleRate, b0.idleRate), dispatch: rel(b.dispatchPerHour, b0.dispatchPerHour), arcade: rel(b.arcadePerGame, b0.arcadePerGame), daily: rel(b.dailyPerClaim, b0.dailyPerClaim), patrol: rel(b.patrolPerEvent, b0.patrolPerEvent), offline: rel(b.offlinePerSec, b0.offlinePerSec), click: rel(b.clickPower, b0.clickPower), meme: rel(b.memePerHour, b0.memePerHour) });
    }
    writeFileSync(`${OUT_DIR}/stack-matrix.json`, JSON.stringify({ base: { station: b0.station, teamFixed: b0.teamFixed, teamShare: b0.teamShare, idleRate: b0.idleRate, clickPower: b0.clickPower, offlineEff: b0.offlineEff }, rows }, null, 2));
    console.log("[stack] base", JSON.stringify({ station: Math.round(b0.station), teamFixed: Math.round(b0.teamFixed), teamShare: Math.round(b0.teamShare), idle: Math.round(b0.idleRate), offlineEff: b0.offlineEff }));
    for (const r of rows as any[]) console.log("[stack]", r.id, "| station", r.station, "teamShare", r.teamShare, "idle", r.idleTotal, "| dispatch", r.dispatch, "arcade", r.arcade, "daily", r.daily, "patrol", r.patrol, "offline", r.offline, "click", r.click);
  });

  it("3) ROI：升级回本/家具/同事（D2、D7）", () => {
    const out: Record<string, unknown> = {};
    function upgradeRoi(st: GameState) {
      const base = channels(st);
      return UPGRADES.map((u) => {
        const lv = st.levels[u.id] ?? 0;
        const price = costOf(u.id, lv);
        const s2 = { ...st, levels: { ...st.levels, [u.id]: lv + 1 } };
        const c2 = channels(s2);
        const dIdle = c2.station - base.station + c2.teamShare - base.teamShare + c2.teamFixed - base.teamFixed;
        const dClick = c2.clickPower - base.clickPower;
        return { id: u.id, name: u.name, line: u.clickPower ? "click" : "idle", lv, cost: price, nextEffect: u.clickPower ? `+${dClick.toFixed(3)}点击` : `+${dIdle.toFixed(3)}/s`, dIdlePerSec: +dIdle.toFixed(4), dClick: +dClick.toFixed(3), paybackSec: dIdle > 0 ? Math.round(price / dIdle) : null, paybackSecClick2cps: dClick > 0 ? Math.round(price / (dClick * 2)) : null, star: valueScoreOf(u.id, lv), milestoneGap: undefined };
      });
    }
    function decorRoi(st: GameState) {
      const b0 = channels(st);
      const d0 = dailyBreakdown(st, P_FRAG).total;
      return DECOR.map((d) => {
        const owned = st.decor.includes(d.id);
        const next = { ...st, decor: [...st.decor.filter((x) => x !== d.id), d.id] };
        const c1 = channels(next);
        const d1 = dailyBreakdown(next, P_FRAG).total;
        return {
          id: d.id, name: d.name, desc: d.desc, cost: d.cost, owned,
          deltaIdlePerSec: +(c1.station - b0.station).toFixed(3), deltaClick: +(c1.clickPower - b0.clickPower).toFixed(3), deltaDispatchPerHour: Math.round(c1.dispatchPerHour - b0.dispatchPerHour),
          deltaDailyPct: +((d1 / d0 - 1) * 100).toFixed(2),
          gainPerSec: +((d1 - d0) / 86400).toFixed(3),
          paybackDays: d1 > d0 ? +((d.cost / (d1 - d0)) / 1).toFixed(3) : null,
        };
      });
    }
    function colRoi(st: GameState) {
      const b0 = channels(st);
      const d0 = dailyBreakdown(st, P_FRAG).total;
      const rows: unknown[] = [];
      for (const def of COLLEAGUES) {
        const cur = st.team.colleagues[def.id];
        if (cur && cur.level >= MAX_COLLEAGUE_LEVEL) continue;
        const price = cur ? upgradeCostOf(def, cur.level) : def.cost;
        const rich: GameState = { ...st, moyu: Math.max(st.moyu, price) };
        const next = cur ? upgradeColleague(rich, def.id) : recruit(rich, def.id);
        if (!next) continue;
        const c1 = channels(next);
        const d1 = dailyBreakdown(next, P_FRAG).total;
        rows.push({ id: def.id, name: def.name, action: cur ? `升级 Lv${cur.level}→${cur.level + 1}` : "招募 Lv1", cost: price, deltaDailyPct: +((d1 / d0 - 1) * 100).toFixed(2), deltaDispatchPerHour: Math.round(c1.dispatchPerHour - b0.dispatchPerHour), paybackDays: d1 > d0 ? +((price / (d1 - d0))).toFixed(3) : null });
      }
      return rows;
    }
    out.d2 = { upgrades: upgradeRoi(S.d2), decor: decorRoi(S.d2), colleagues: colRoi(S.d2) };
    out.d7p = { upgrades: upgradeRoi(S.d7p), decor: decorRoi(S.d7p), colleagues: colRoi(S.d7p) };
    // 家具 ROI 排序 vs 成本排序
    for (const k of ["d2", "d7p"] as const) {
      const decor = (out[k] as any).decor as any[];
      const unowned = decor.filter((d) => !d.owned).sort((a, b) => (a.paybackDays ?? 1e9) - (b.paybackDays ?? 1e9));
      (out[k] as any).decorByRoi = unowned.map((d) => d.name);
      (out[k] as any).decorByCost = decor.filter((d) => !d.owned).sort((a, b) => a.cost - b.cost).map((d) => d.name);
    }
    writeFileSync(`${OUT_DIR}/roi.json`, JSON.stringify(out, null, 2));
    for (const k of ["d2", "d7p"] as const) {
      const o = out[k] as any;
      console.log("[roi]", k, "upgrades:", o.upgrades.map((u: any) => `${u.name}@${u.lv}:${u.paybackSec}s`).join(" "));
      console.log("[roi]", k, "decor:", o.decor.map((d: any) => `${d.name}${d.owned ? "(已买)" : ""}:+${d.deltaDailyPct}%/回本${d.paybackDays}d`).join(" "));
      console.log("[roi]", k, "decor ROI 顺序:", o.decorByRoi.join(">"), "| 成本顺序:", o.decorByCost.join(">"));
      console.log("[roi]", k, "colleagues:", o.colleagues.map((c: any) => `${c.name}/${c.action}:${c.cost}:+${c.deltaDailyPct}%/回本${c.paybackDays}d`).join(" "));
    }
  });

  it("4) 每日精力：单档/子集价值（各阶段 × 2 画像）", () => {
    const stages: Record<string, GameState> = { d1: S.d1, d2: S.d2, d4: S.d4, d7p: S.d7p };
    const rows: unknown[] = [];
    const ids = ENERGY_ACTIONS.map((a) => a.id);
    for (const [name, st] of Object.entries(stages)) for (const p of [P_FRAG, P_HEAVY]) {
      const baseDaily = dailyBreakdown(st, p).total;
      const singles: Record<string, number> = {};
      for (const a of ENERGY_ACTIONS) singles[a.id] = +((dailyBreakdown(withEnergy(st, [a.id]), p).total / baseDaily - 1) * 100).toFixed(2);
      const subsets: any[] = [];
      for (let mask = 1; mask < 16; mask++) {
        const set = ids.filter((_, i) => mask & (1 << i));
        const cost = set.reduce((s, id) => s + ENERGY_ACTIONS.find((a) => a.id === id)!.cost, 0);
        if (cost > ENERGY_PER_DAY) continue;
        subsets.push({ set, cost, valuePct: +((dailyBreakdown(withEnergy(st, set), p).total / baseDaily - 1) * 100).toFixed(2) });
      }
      subsets.sort((a, b) => b.valuePct - a.valuePct);
      const comboIdx = subsets.findIndex((x) => x.set.join(",") === "slack,fake-work,social");
      rows.push({ stage: name, profile: p.name, baseDaily: Math.round(baseDaily), singles, best: subsets[0], combo: subsets[comboIdx], comboRank: comboIdx + 1, top: subsets.slice(0, 4) });
    }
    const scope: unknown[] = [];
    for (const [name, st] of Object.entries(stages)) {
      const c = channels(st);
      scope.push({ stage: name, stationShareOfIdle: +(c.station / c.idleRate).toFixed(3), slackActualIdlePct: +((c.station / c.idleRate) * 25).toFixed(2), socialActualIdlePct: +((c.station / c.idleRate) * 5).toFixed(2), focusActualIdlePct: +((c.station / c.idleRate) * 8).toFixed(2) });
    }
    writeFileSync(`${OUT_DIR}/energy.json`, JSON.stringify({ rows, scope }, null, 2));
    for (const r of rows as any[]) console.log("[energy]", r.stage, r.profile, "singles", JSON.stringify(r.singles), "| best", JSON.stringify(r.best), "| combo", r.combo.valuePct, "rank", r.comboRank);
    console.log("[energy-scope]", JSON.stringify(scope));
  });


  it("4b) 精力：在线时长/巡逻密度敏感性（省心组合何时才不亏）", () => {
    const st = S.d2;
    const rows: unknown[] = [];
    const ids = ENERGY_ACTIONS.map((a) => a.id);
    for (const activeHours of [0.5, 2, 5, 8, 12, 24]) {
      const offlineHours = Math.max(0, 24 - activeHours);
      const p: Profile = { name: `在线${activeHours}h`, activeHours, clicksPerDay: 0, offlineHours, arcadeGames: 3, dailyClaims: 2, patrolPerHour: 30 };
      const base = dailyBreakdown(st, p).total;
      const subs: any[] = [];
      for (let mask = 1; mask < 16; mask++) {
        const set = ids.filter((_, i) => mask & (1 << i));
        const cost = set.reduce((s, id) => s + ENERGY_ACTIONS.find((a) => a.id === id)!.cost, 0);
        if (cost > ENERGY_PER_DAY) continue;
        subs.push({ set: set.join("+"), cost, gainPct: +((dailyBreakdown(withEnergy(st, set), p).total / base - 1) * 100).toFixed(2) });
      }
      subs.sort((a, b) => b.gainPct - a.gainPct);
      rows.push({ activeHours, best: subs[0], combo: subs.find((x) => x.set === "slack+fake-work+social"), comboRank: subs.findIndex((x) => x.set === "slack+fake-work+social") + 1, top3: subs.slice(0, 3) });
    }
    writeFileSync(`${OUT_DIR}/energy-online-sensitivity.json`, JSON.stringify(rows, null, 2));
    for (const r of rows as any[]) console.log("[energy-online]", r.activeHours + "h", "best", r.best.set, r.best.gainPct + "%", "| combo", r.combo.gainPct + "%", "rank", r.comboRank);
  });
  it("5) 每日卡日价值 + 离线机制（回访/首日/卡上限）", () => {
    // 回访与离线效率（正确 ms）
    const visits: unknown[] = [];
    for (const v of [0, 1, 2, 3]) visits.push({ visits: v, offlineEff: +offlineEfficiency({ ...S.d2, visits: { date: TD, count: v } }, NOW - 3 * DAY_MS, NOW).toFixed(3) });
    firstDay: {
      const eff = offlineEfficiency(S.d2, NOW - 3600_000, NOW);
      console.log("[cards] first-day offlineEff:", eff.toFixed(3));
    }
    const stageNames = ["d1", "d2", "d4", "d7p"] as const;
    const rows: unknown[] = [];
    for (const name of stageNames) for (const p of [P_FRAG, P_HEAVY]) {
      const st = S[name];
      const baseDaily = dailyBreakdown(st, p).total;
      for (const card of CARDS) {
        const s2 = withCard(st, card.id);
        const eff = cardEffects(s2, NOW);
        const p2 = { ...p, patrolPerHour: p.patrolPerHour * (eff.eventRateMult ?? 1) };
        rows.push({ stage: name, profile: p.name, id: card.id, name: card.name, rarity: card.rarity, desc: card.desc, effects: card.effects, valuePct: +((dailyBreakdown(s2, p2).total / baseDaily - 1) * 100).toFixed(2) });
      }
    }
    writeFileSync(`${OUT_DIR}/cards.json`, JSON.stringify({ visits, firstDayOfflineEff: +offlineEfficiency(S.d2, NOW - 3600_000, NOW).toFixed(3), rows }, null, 2));
    for (const name of stageNames) for (const p of [P_FRAG.name, P_HEAVY.name]) {
      const list = (rows as any[]).filter((r) => r.stage === name && r.profile === p).sort((a, b) => b.valuePct - a.valuePct);
      console.log("[cards]", name, p, list.map((r) => `${r.name}:${r.valuePct}%`).join(" | "));
    }
    console.log("[cards] visits:", JSON.stringify(visits));
  });

  it("6) 天赋：24 点最优分配（随点击/安然存量变化）", () => {
    const branchOptions: { branch: string; ids: string[]; cost: number }[] = [];
    for (const b of ["click", "idle", "event"] as const) {
      branchOptions.push({ branch: b, ids: [], cost: 0 });
      const tiers = TALENTS.filter((t) => t.branch === b);
      const low = tiers.filter((t) => t.tier < 5).sort((x, y) => x.tier - y.tier);
      for (let k = 1; k <= 4; k++) { const ids = low.slice(0, k).map((t) => t.id); branchOptions.push({ branch: b, ids, cost: ids.reduce((s, id) => s + costOfTalent(id), 0) }); }
      for (const ult of tiers.filter((t) => t.tier === 5)) { const ids = [...low.map((t) => t.id), ult.id]; branchOptions.push({ branch: b, ids, cost: ids.reduce((s, id) => s + costOfTalent(id), 0) }); }
    }
    const combos: { ids: string[]; cost: number }[] = [];
    for (const a of branchOptions.filter((x) => x.branch === "click")) for (const b of branchOptions.filter((x) => x.branch === "idle")) for (const c of branchOptions.filter((x) => x.branch === "event")) combos.push({ ids: [...a.ids, ...b.ids, ...c.ids], cost: a.cost + b.cost + c.cost });
    const mkState = (s: GameState, ids: string[]): GameState => {
      let x: GameState = { ...s, talents: { unlocked: [], points: TALENT_POINT_CAP, rankGranted: 12, dailyGiftDate: "", overflow: 0 } };
      for (const id of ids) { const n = unlockTalent(x, id); if (!n) throw new Error("talent " + id); x = n; }
      return x;
    };
    const variants: { name: string; st: GameState }[] = [
      { name: "D2 点击9000/安然120", st: { ...S.d2, totalClicks: 9000, patrolSurvives: 120 } },
      { name: "D2 点击3000/安然30", st: { ...S.d2, totalClicks: 3000, patrolSurvives: 30 } },
      { name: "D2 点击0/安然0", st: { ...S.d2, totalClicks: 0, patrolSurvives: 0 } },
      { name: "D7转生 点击20000/安然400", st: { ...S.d7p, totalClicks: 20000, patrolSurvives: 400 } },
    ];
    const baselineIds = ["idle_1", "idle_2", "idle_3", "idle_4", "event_1", "event_2", "event_3", "event_4"];
    const rows: unknown[] = [];
    for (const v of variants) for (const p of [P_FRAG]) {
      const baseDaily = dailyBreakdown(mkState(v.st, baselineIds), p).total;
      const scored: any[] = [];
      for (const cb of combos) {
        if (cb.cost > TALENT_POINT_CAP) continue;
        const daily = dailyBreakdown(mkState(v.st, cb.ids), p).total;
        scored.push({ ids: cb.ids.join(","), cost: cb.cost, gain: +((daily / baseDaily - 1) * 100).toFixed(2) });
      }
      scored.sort((a, b) => b.gain - a.gain);
      rows.push({ variant: v.name, profile: p.name, top: scored.slice(0, 3) });
    }
    writeFileSync(`${OUT_DIR}/talents.json`, JSON.stringify({ rows, pointsTimeline: { rankPoints: 6, perPrestige: 1, perDay: 1, cap: TALENT_POINT_CAP, fullTree: 27 } }, null, 2));
    for (const r of rows as any[]) console.log("[talent]", r.variant, "|", r.top.map((t: any) => `+${t.gain}%(${t.cost}pt) ${t.ids}`).join("  ||  "));
  });

  it("7) 转生：策略模拟 3/7/14 天 × 等待倍数 + 重置成本", () => {
    const mathRows: unknown[] = [];
    for (const k of [1, 2, 3, 5, 8, 10, 20]) {
      const points = Math.max(1, Math.min(20, Math.floor(PRESTIGE_TUNING.gainA * Math.pow(k, PRESTIGE_TUNING.gainB))));
      mathRows.push({ waitMultiple: k, pointsPerRun: points, pointsPerTime: +(points / k).toFixed(3) });
    }
    const resetCost = [5, 10, 15, 19, 20, 21, 22, 25, 30, 35, 39, 40, 41, 45, 48, 50, 55, 59, 60].map((L) => {
      const levels: Record<string, number> = {};
      for (const u of UPGRADES) levels[u.id] = L;
      const st = mk({ levels, prestige: 3, collected: collected(40), decor: ["plant", "fridge"], visits: VISITS3(), daily: emptyDaily() });
      const before = channels(st);
      const pr = doPrestige({ ...st, totalEarned: prestigeThreshold(st), moyu: 0 });
      if (!pr) return { level: L, error: "cannot" };
      const afterSameMult = channels({ ...pr.state, prestige: st.prestige }); // 只看等级损失
      const after = channels(pr.state);
      const multRatio = prestigeMultiplier(pr.state.prestige) / prestigeMultiplier(st.prestige);
      return { level: L, keptLevel: Math.floor(L * PRESTIGE_TUNING.keepLevelRatio), levelRetained: +(afterSameMult.idleRate / before.idleRate).toFixed(3), gained: pr.gained, multBefore: +prestigeMultiplier(st.prestige).toFixed(2), multAfter: +prestigeMultiplier(pr.state.prestige).toFixed(2), netAfter: +((afterSameMult.idleRate / before.idleRate) * multRatio).toFixed(3) };
    });
    function run(days: number, policyMultiple: number) {
      const snaps = simulate(days, { prestigeMultiple: policyMultiple, checkpoints: [days] });
      const st = snaps[0].state;
      return { days, waitMultiple: policyMultiple, lifetime: Math.round(st.lifetimeEarned), prestigePoints: st.prestige, mult: +prestigeMultiplier(st.prestige).toFixed(2), idleRate: Math.round(effectOf(st).idleRate), levels: st.levels, decorCount: st.decor.length, colleagues: Object.keys(st.team.colleagues).length };
    }
    const sims: unknown[] = [];
    for (const days of [3, 7, 14]) {
      sims.push(run(days, Infinity));
      for (const k of [1, 2, 5, 10, 20]) sims.push(run(days, k));
    }
    writeFileSync(`${OUT_DIR}/prestige.json`, JSON.stringify({ mathRows, resetCost, sims, tuning: PRESTIGE_TUNING }, null, 2));
    console.log("[prestige] math:", JSON.stringify(mathRows));
    console.log("[prestige] reset:", resetCost.map((r: any) => `L${r.level}→${r.keptLevel} 等级保留${r.levelRetained} 转完净×${r.netAfter}`).join(" | "));
    for (const s of sims as any[]) console.log("[prestige]", s.days + "d", s.waitMultiple === Infinity ? "never" : "x" + s.waitMultiple, "lifetime", s.lifetime, "pts", s.prestigePoints, "mult", s.mult, "idle", s.idleRate);
  });

  it("8) 交互细节：派遣任务/自动重复/小游戏/省心组合/转生门槛/离线卡", () => {
    const dispatchRows: unknown[] = [];
    for (const [stage, st] of Object.entries({ d2: S.d2, d7p: S.d7p })) {
      const station = stationIdleScaled(st);
      for (const def of COLLEAGUES) {
        if (!st.team.colleagues[def.id]) continue;
        const rows = MISSIONS.map((m) => {
          const probe: GameState = { ...st, team: { colleagues: { ...st.team.colleagues, [def.id]: { ...st.team.colleagues[def.id]!, missionId: m.id } } } };
          const secs = missionSecondsFor(def.id, m.id);
          const r = dispatchReward(probe, def.id, station);
          return { mission: m.name, secs, reward: Math.round(r), perHour: Math.round((r / secs) * 3600), skillMatch: def.skill === m.type };
        }).sort((a, b) => b.perHour - a.perHour);
        dispatchRows.push({ stage, colleague: def.name, best: rows[0], skillMatchIsBest: rows[0].skillMatch, skillBest: rows.find((r) => r.skillMatch) ?? null, all: rows });
      }
    }
    const arcade: unknown[] = [];
    for (const [name, st] of Object.entries({ d1: S.d1, d2: S.d2, d4: S.d4 })) {
      const c = channels(st);
      const b = dailyBreakdown(st, P_FRAG);
      arcade.push({ stage: name, stationIdlePerSec: Math.round(c.station), arcadePerGame: Math.round(c.arcadePerGame), arcade3PerDay: Math.round(c.arcadePerGame * 3), dailyTotal: Math.round(b.total), sharePct: +((c.arcadePerGame * 3 / b.total) * 100).toFixed(3) });
    }
    const autoRepeat: unknown[] = [];
    for (const [name, st] of Object.entries({ d2: S.d2, d7p: S.d7p })) {
      const c = channels(st); const b = dailyBreakdown(st, P_FRAG);
      autoRepeat.push({ stage: name, dispatchRound: Math.round(c.dispatchRound), dispatchPerDay: Math.round(b.dispatch), catchUpSharePct: +((c.dispatchRound / b.dispatch) * 100).toFixed(1) });
    }
    const b0 = dailyBreakdown(S.d2, P_FRAG).total;
    const subsets: any[] = [];
    const ids = ENERGY_ACTIONS.map((a) => a.id);
    for (let mask = 1; mask < 16; mask++) {
      const set = ids.filter((_, i) => mask & (1 << i));
      const cost = set.reduce((s, id) => s + ENERGY_ACTIONS.find((a) => a.id === id)!.cost, 0);
      if (cost > ENERGY_PER_DAY) continue;
      subsets.push({ set, cost, gainPct: +((dailyBreakdown(withEnergy(S.d2, set), P_FRAG).total / b0 - 1) * 100).toFixed(2) });
    }
    subsets.sort((a, b) => b.gainPct - a.gainPct);
    const thresholds: unknown[] = [];
    for (const P of [0, 1, 3, 6, 10]) {
      const s = { ...S.d2, prestige: P };
      thresholds.push({ prestige: P, mult: +prestigeMultiplier(P).toFixed(2), threshold: Math.round(prestigeThreshold(s)), gainAtThreshold: prestigeGain({ ...s, totalEarned: prestigeThreshold(s), lifetimeEarned: 1e12 }) });
    }
    // 离线卡在"3 回访老玩家"下是否失效（对比首日）
    const cardEff: unknown[] = [];
    for (const cid of ["early_leave", "canteen_gift", "overtime", "deadline", "hr_talk", "ac_broken", "office_move"]) {
      const s = withCard(S.d2, cid);
      const firstDay = offlineEfficiency(s, NOW - 3600_000, NOW);
      const idle = dailyBreakdown(s, P_FRAG).total / dailyBreakdown(withCard(S.d2, null), P_FRAG).total - 1;
      cardEff.push({ id: cid, firstDayOfflineEff: +firstDay.toFixed(3), dailyValuePct: +(idle * 100).toFixed(2) });
    }
    // 里程碑 ROI：D2 状态每条挂机线上，距 ×2 还差 k 级时的下一级回本
    const milestone: unknown[] = [];
    {
      const st = S.d2;
      const b0 = channels(st);
      for (const u of UPGRADES) {
        if (u.clickPower) continue;
        const lv = st.levels[u.id] ?? 0;
        const offset = (UPGRADES.findIndex((x) => x.id === u.id) % 4) * 5;
        const nextMilestone = Math.ceil((lv + offset + 1) / 20) * 20 - offset;
        const gap = nextMilestone - lv;
        if (gap > 6) continue;
        const price = costOf(u.id, lv);
        const s2 = { ...st, levels: { ...st.levels, [u.id]: lv + 1 } };
        const c2 = channels(s2);
        milestone.push({ line: u.name, level: lv, nextMilestone, gap, cost: price, deltaIdle: +(c2.station - b0.station + c2.teamShare - b0.teamShare).toFixed(0), paybackSec: Math.round(price / Math.max(1e-9, c2.station - b0.station + c2.teamShare - b0.teamShare)) });
      }
    }
    // 商店 ★ 推荐是否等于真正最高 ROI（挂机维度）
    const starCheck: unknown[] = [];
    {
      const st = S.d2;
      const b0 = channels(st);
      const scored = UPGRADES.filter((u) => !u.clickPower).map((u) => {
        const lv = st.levels[u.id] ?? 0;
        const price = costOf(u.id, lv);
        const c2 = channels({ ...st, levels: { ...st.levels, [u.id]: lv + 1 } });
        const d = c2.station - b0.station + c2.teamShare - b0.teamShare;
        return { id: u.id, name: u.name, roi: d / price, star: u.id === UPGRADES.filter((x) => !x.clickPower).reduce((best, x) => (valueScoreOf(x.id, st.levels[x.id] ?? 0).idle > valueScoreOf(best.id, st.levels[best.id] ?? 0).idle ? x : best)).id };
      }).sort((a, b) => b.roi - a.roi);
      starCheck.push({ starPick: scored.find((x) => x.star)?.name ?? null, trueBest: scored[0].name, top3: scored.slice(0, 3).map((x) => `${x.name}(ROI ${x.roi.toExponential(2)})`) });
    }
    // 日报：同一天跨 6h 窗口后 claimed 是否重置（决定每天最多领 4 次）
    const dailyClaim: unknown[] = [];
    {
      let st = { ...S.d2, daily: emptyDaily() };
      const ed = ensureDaily, cd = claimDaily;
      st = ed(st, TD, Math.random, 0);
      st = { ...st, daily: { ...st.daily!, goals: st.daily!.goals.map((g) => ({ ...g, progress: g.target, done: true })) } };
      const r1 = cd(st, TD);
      st = r1.state;
      const after1 = { claimed: st.daily!.claimed, claimsToday: st.daily!.claimsToday };
      st = ed(st, TD, Math.random, 1); // 下一个 6h 窗口
      const r2 = cd(st, TD);
      dailyClaim.push({ firstClaim: r1.claimedReward !== null, claimedAfter1: after1, window2Claimable: r2.claimedReward !== null, claimsTodayAfter2: r2.state.daily!.claimsToday });
    }
    const out = {
      milestone, starCheck, dailyClaim,
      dispatchRows, arcade, autoRepeat,
      energyBest: subsets.slice(0, 4), energyCombo: subsets.find((x) => x.set.join(",") === "slack,fake-work,social"),
      prestigeThresholdGain: thresholds, cardOfflineMechanism: cardEff,
      constants: { cardDismissCost: 0, talentRespecCost: 0, decorSlots: null, decorExclusive: false, decorCompleteBonus: DECOR_COMPLETE_BONUS, autoRepeatDefault: false, energyPerDay: ENERGY_PER_DAY, cardDurationH: 24 },
    };
    writeFileSync(`${OUT_DIR}/interactions.json`, JSON.stringify(out, null, 2));
    console.log("[interact] dispatch:", JSON.stringify(dispatchRows.map((d: any) => `${d.stage}/${d.colleague}:best=${d.best.mission}(${d.best.perHour}/h) 擅长最优=${d.skillMatchIsBest} 擅长角=${d.skillBest?.mission}(${d.skillBest?.perHour}/h)`)));
    console.log("[interact] arcade:", JSON.stringify(arcade));
    console.log("[interact] autoRepeat:", JSON.stringify(autoRepeat));
    console.log("[interact] energy:", JSON.stringify(out.energyBest), "combo:", JSON.stringify(out.energyCombo));
    console.log("[interact] thresholds:", JSON.stringify(thresholds));
    console.log("[interact] cardOfflineMechanism:", JSON.stringify(cardEff));
  });
});