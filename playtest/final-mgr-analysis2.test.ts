/**
 * 终验·管理/策略党专属引擎探针 v2（v0.5.0，HEAD 9760eab）
 * 输出证据：playtest/final-mgr/*.json
 */
import { describe, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { initialState, type GameState, gain } from "../src/engine/state";
import { UPGRADES, costOf, effectOf, stationIdleScaled, stationIdleOf } from "../src/engine/upgrades";
import { clickPowerOf, buyUpgrade } from "../src/engine/actions";
import { DECOR, decorEffects, buyDecor, DECOR_COMPLETE_BONUS } from "../src/engine/decor";
import { COLLEAGUES, MISSIONS, dispatchReward, missionSecondsFor, teamFixedRate, teamShareRatio, recruit, upgradeColleague, upgradeCostOf, favorBonuses, MAX_COLLEAGUE_LEVEL } from "../src/engine/team";
import { ENERGY_ACTIONS, useEnergy, ENERGY_PER_DAY } from "../src/engine/energy";
import { CARDS, cardEffects } from "../src/engine/cards";
import { TALENTS, talentEffects, unlockTalent, costOfTalent, TALENT_POINT_CAP } from "../src/engine/talents";
import { dailyReward } from "../src/engine/daily";
import { bossSurviveReward } from "../src/engine/events";
import { offlineEfficiency } from "../src/engine/progression";
import { prestigeMultiplier, prestigeGain, prestigeThreshold, canPrestige, doPrestige, PRESTIGE_TUNING } from "../src/engine/prestige";
import { valueScoreOf } from "../src/engine/upgrades";

const OUT_DIR = "playtest/final-mgr";
mkdirSync(OUT_DIR, { recursive: true });
const NOW = Date.now();
const DAY = 86400;
const TD = new Date(NOW).toLocaleDateString("sv-SE");

function mk(over: Partial<GameState> = {}): GameState { return { ...initialState(), ...over } as GameState; }
function withLevels(levels: Record<string, number>, over: Partial<GameState> = {}): GameState { return mk({ levels, ...over }); }
function collected(n: number) {
  const quotes = Array.from({ length: Math.min(n, 10) }, (_, i) => i);
  const rest = Math.max(0, n - quotes.length);
  return { quotes, flavors: Array.from({ length: Math.min(rest, 45) }, (_, i) => i) };
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
function talentState(state: GameState, ids: string[]): GameState {
  let s: GameState = { ...state, talents: { unlocked: [], points: TALENT_POINT_CAP, rankGranted: 12, dailyGiftDate: "", overflow: 0 } };
  for (const id of ids) {
    const next = unlockTalent(s, id);
    if (!next) throw new Error(`talent unlock failed: ${id}`);
    s = next;
  }
  return s;
}

/* ---------- 通道快照 ---------- */
interface Channels { station: number; teamFixed: number; teamShare: number; idleRate: number; clickPower: number; dispatchPerHour: number; dispatchRound: number; arcadePerGame: number; dailyPerClaim: number; patrolPerEvent: number; memePerHour: number; offlinePerSec: number; offlineEff: number; }
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
function channels(state: GameState): Channels {
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
  const offlineEff = offlineEfficiency(state, NOW - 3 * DAY, NOW);
  const teamPart = Math.max(0, idleRate - station);
  return {
    station, teamFixed, teamShare, idleRate, clickPower, dispatchPerHour, dispatchRound,
    arcadePerGame: Math.max(Math.floor(station * 25), 30), dailyPerClaim: dailyReward(state),
    patrolPerEvent: bossSurviveReward(state, { surviveStreak: 5 } as never),
    memePerHour: 60 * 5 * clickPower * talent.memeRewardMult * favor.memeMult,
    offlinePerSec: (station + teamPart * 0.5) * offlineEff, offlineEff,
  };
}

interface Profile { name: string; activeHours: number; clicksPerDay: number; offlineHours: number; arcadeGames: number; dailyClaims: number; patrolPerHour: number; }
const P_FRAG: Profile = { name: "碎片3访(在线0.5h/0点击/离线23h)", activeHours: 0.5, clicksPerDay: 0, offlineHours: 23, arcadeGames: 3, dailyClaims: 4, patrolPerHour: 30 };
const P_HEAVY: Profile = { name: "重度(在线2h/5400点击/离线21h)", activeHours: 2, clicksPerDay: 5400, offlineHours: 21, arcadeGames: 3, dailyClaims: 4, patrolPerHour: 30 };

function dailyBreakdown(state: GameState, p: Profile) {
  const c = channels(state);
  const out = {
    clickIncome: p.clicksPerDay * c.clickPower * 1.1,
    station: c.station * p.activeHours * 3600,
    teamFixed: c.teamFixed * p.activeHours * 3600,
    teamShare: c.teamShare * p.activeHours * 3600,
    dispatchOnline: c.dispatchPerHour * p.activeHours,
    dispatchOffline: c.dispatchRound,
    patrol: c.patrolPerEvent * p.patrolPerHour * p.activeHours,
    meme: c.memePerHour * p.activeHours,
    arcade: c.arcadePerGame * p.arcadeGames,
    daily: c.dailyPerClaim * p.dailyClaims,
    offline: c.offlinePerSec * p.offlineHours * 3600,
  };
  const dispatch = out.dispatchOnline + out.dispatchOffline;
  const total = out.clickIncome + out.station + out.teamFixed + out.teamShare + dispatch + out.patrol + out.meme + out.arcade + out.daily + out.offline;
  return { ...out, dispatch, total };
}
function shares(b: ReturnType<typeof dailyBreakdown>) {
  const keys = ["clickIncome", "station", "teamFixed", "teamShare", "dispatch", "patrol", "meme", "arcade", "daily", "offline"] as const;
  const o: Record<string, string> = {};
  for (const k of keys) o[k] = b.total > 0 ? ((b[k] / b.total) * 100).toFixed(1) + "%" : "0%";
  return o;
}

/* ---------- 状态样板 ---------- */
const VISITS3 = () => ({ date: TD, count: 3 });
const STREAK = { date: TD, goals: [], streak: 0, lastCompleteDate: null, claimed: false, window: 0, claimsToday: 0 } as never;
function stateEarly(): GameState {
  return withLevels({ coffee: 3, water: 1, phone: 4, toilet: 1 }, { totalClicks: 1200, lifetimeEarned: 1500, totalEarned: 1500, patrolSurvives: 3, visits: VISITS3(), daily: STREAK });
}
function stateMid(): GameState {
  const levels = { coffee: 12, water: 10, chair: 6, phone: 25, toilet: 22, group: 18, meeting: 12, deep: 4, retire: 0 };
  const base = withLevels(levels, {
    totalClicks: 9000, lifetimeEarned: 3.2e7, totalEarned: 2.1e7, moyu: 8e5, patrolSurvives: 120,
    collected: collected(30), prestige: 0, decor: ["plant", "lamp", "rug", "fridge", "chair"],
    visits: VISITS3(), daily: STREAK,
    team: { colleagues: { zhou: { level: 2, missionId: null, startedAt: 0, endsAt: 0, favor: 30, autoRepeat: true, rewardSnapshot: 0 }, mei: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 10, autoRepeat: true, rewardSnapshot: 0 } } },
    energy: emptyEnergy(),
  });
  return talentState(base, ["idle_1", "idle_2", "idle_3"]);
}
function stateLate(): GameState {
  const levels: Record<string, number> = {};
  for (const u of UPGRADES) levels[u.id] = 45;
  const base = withLevels(levels, {
    totalClicks: 20000, lifetimeEarned: 4e11, totalEarned: 6e9, moyu: 3e9, patrolSurvives: 400,
    collected: collected(55), prestige: 6, decor: DECOR.map((d) => d.id), visits: VISITS3(), daily: STREAK,
    team: { colleagues: Object.fromEntries(COLLEAGUES.map((c) => [c.id, { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 100, autoRepeat: true, rewardSnapshot: 0 }])) },
    energy: emptyEnergy(),
  });
  return talentState(base, ["idle_1", "idle_2", "idle_3", "idle_4", "idle_5b", "event_1", "event_2", "event_3", "event_4", "event_5b", "click_1", "click_2", "click_3", "click_4"]);
}
function stateMidNoDecor(): GameState { const s = stateMid(); return { ...s, decor: [] }; }

describe("终验·管理党 · 资源流向 / 协同冲突 / 决策深度", () => {
  it("1) 资源流向：各阶段各来源占比（2 种在线画像）", () => {
    const stages: Record<string, GameState> = { early: stateEarly(), mid: stateMid(), late: stateLate() };
    const out: Record<string, unknown> = {};
    for (const [name, st] of Object.entries(stages)) {
      const rows: Record<string, unknown> = {};
      for (const p of [P_FRAG, P_HEAVY]) {
        const b = dailyBreakdown(st, p);
        rows[p.name] = { totalPerDay: Math.round(b.total), share: shares(b), raw: Object.fromEntries(Object.entries(b).filter(([k]) => k !== "total").map(([k, v]) => [k, Math.round(v as number)])) };
      }
      out[name] = { profiles: rows, channels: Object.fromEntries(Object.entries(channels(st)).map(([k, v]) => [k, +v.toFixed(4)])) };
    }
    writeFileSync(`${OUT_DIR}/flow.json`, JSON.stringify(out, null, 2));
    for (const [k, v] of Object.entries(out)) for (const [pk, pv] of Object.entries((v as any).profiles)) console.log("[flow]", k, "|", pk, "| total", (pv as any).totalPerDay, "|", JSON.stringify((pv as any).share));
  });

  it("2) 倍率叠加矩阵：单个加成作用到哪些通道（相对增量 %）", () => {
    const mid = stateMid();
    const base = talentState(mid, ["idle_1", "idle_2", "idle_3", "idle_4", "event_1", "event_2", "event_3", "event_4"]);
    const b0 = channels(base);
    const cases: { id: string; apply: (s: GameState) => GameState }[] = [
      { id: "energy:slack 挂机+25%", apply: (s) => withEnergy(s, ["slack"]) },
      { id: "energy:social 挂机+5%/好感+5", apply: (s) => withEnergy(s, ["social"]) },
      { id: "energy:focus 点击×2/挂机+8%", apply: (s) => withEnergy(s, ["focus"]) },
      { id: "energy:fake-work 巡逻×2.2", apply: (s) => withEnergy(s, ["fake-work"]) },
      { id: "card:咖啡管够 挂机+15%", apply: (s) => withCard(s, "coffee_day") },
      { id: "card:团建吃饭 派遣+40%", apply: (s) => withCard(s, "team_bond") },
      { id: "card:提前下班 离线+15%", apply: (s) => withCard(s, "early_leave") },
      { id: "card:手速上头 点击+80%", apply: (s) => withCard(s, "click_frenzy") },
      { id: "card:通宵摸鱼 挂机+60%/离线-20%", apply: (s) => withCard(s, "overtime") },
      { id: "card:老板出差 巡逻+50%/频率+30%", apply: (s) => withCard(s, "quiet_day") },
      { id: "decor:投影仪 派遣+30%", apply: (s) => (s.decor.includes("projector") ? s : { ...s, decor: [...s.decor, "projector"] }) },
      { id: "decor:鱼缸 挂机+10%/点击+10%", apply: (s) => (s.decor.includes("aquarium") ? s : { ...s, decor: [...s.decor, "aquarium"] }) },
      { id: "decor:猫窝 挂机+15%/离线+10%", apply: (s) => (s.decor.includes("catbed") ? s : { ...s, decor: [...s.decor, "catbed"] }) },
      { id: "talent:idle_5a 工位挂机+20%", apply: (s) => talentState(s, [...s.talents.unlocked, "idle_5a"]) },
      { id: "talent:idle_5b 同事挂机+70%", apply: (s) => talentState(s, [...s.talents.unlocked, "idle_5b"]) },
      { id: "talent:event_5a 每次安然+1%挂机(120次)", apply: (s) => talentState(s, [...s.talents.unlocked, "event_5a"]) },
      { id: "talent:event_5b 巡逻/梗×2,离线+20%", apply: (s) => talentState(s, [...s.talents.unlocked, "event_5b"]) },
      { id: "talent:click_5b 挂机+12%+点击+60%", apply: (s) => talentState(s, ["idle_1", "idle_2", "idle_3", "idle_4", "event_1", "event_2", "event_3", "event_4", "click_1", "click_2", "click_3", "click_4", "click_5b"]) },
      { id: "prestige:+1点 总倍率+0.75", apply: (s) => ({ ...s, prestige: s.prestige + 1 }) },
      { id: "collection:+5格 挂机+2%", apply: (s) => ({ ...s, collected: collected(35) }) },
      { id: "组合:投影仪+slack+咖啡卡", apply: (s) => withCard(withEnergy((s.decor.includes("projector") ? s : { ...s, decor: [...s.decor, "projector"] }), ["slack"]), "coffee_day") },
    ];
    const rows: unknown[] = [];
    for (const c of cases) {
      const b = channels(c.apply(base));
      const rel = (a: number, o: number) => (o > 0 ? +((a / o - 1) * 100).toFixed(2) : null);
      rows.push({ id: c.id, station: rel(b.station, b0.station), teamFixed: rel(b.teamFixed, b0.teamFixed), teamShare: rel(b.teamShare, b0.teamShare), idleTotal: rel(b.idleRate, b0.idleRate), dispatch: rel(b.dispatchPerHour, b0.dispatchPerHour), arcade: rel(b.arcadePerGame, b0.arcadePerGame), daily: rel(b.dailyPerClaim, b0.dailyPerClaim), patrol: rel(b.patrolPerEvent, b0.patrolPerEvent), offline: rel(b.offlinePerSec, b0.offlinePerSec), click: rel(b.clickPower, b0.clickPower), meme: rel(b.memePerHour, b0.memePerHour) });
    }
    writeFileSync(`${OUT_DIR}/stack-matrix.json`, JSON.stringify({ base: { station: b0.station, teamFixed: b0.teamFixed, teamShare: b0.teamShare, idleRate: b0.idleRate, clickPower: b0.clickPower, offlineEff: b0.offlineEff }, rows }, null, 2));
    for (const r of rows as any[]) console.log("[stack]", r.id, "| station", r.station, "teamShare", r.teamShare, "idle", r.idleTotal, "| dispatch", r.dispatch, "arcade", r.arcade, "daily", r.daily, "patrol", r.patrol, "offline", r.offline, "click", r.click, "meme", r.meme);
  });

  it("3) ROI：升级曲线 / 家具 / 同事（中盘与后期）", () => {
    const st = stateMid();
    const base = channels(st);
    const out: Record<string, unknown> = {};
    // 升级 ROI 曲线：以 mid 为底，把该线设到 L，算 L→L+1 的回本秒数
    const curves: unknown[] = [];
    for (const u of UPGRADES) {
      const pts: any[] = [];
      for (const L of [0, 5, 10, 15, 18, 19, 20, 23, 24, 25, 35, 39, 40, 41, 45]) {
        const s1 = { ...st, levels: { ...st.levels, [u.id]: L } };
        const c1 = channels(s1);
        const s2 = { ...st, levels: { ...st.levels, [u.id]: L + 1 } };
        const c2 = channels(s2);
        const dIdle = c2.station - c1.station + c2.teamShare - c1.teamShare;
        const dClick = c2.clickPower - c1.clickPower;
        const price = costOf(u.id, L);
        pts.push({ L, cost: price, dIdle: +dIdle.toFixed(3), dClick: +dClick.toFixed(3), paybackSecIdle: dIdle > 0 ? Math.round(price / dIdle) : null, paybackSecClickAt2cps: dClick > 0 ? Math.round(price / (dClick * 2)) : null });
      }
      const lv = st.levels[u.id] ?? 0;
      curves.push({ id: u.id, name: u.name, line: u.clickPower ? "click" : "idle", currentLevel: lv, currentStar: valueScoreOf(u.id, lv), points: pts });
    }
    // 家具 ROI（中盘无家具 / 后期已全）
    function decorRoi(baseState: GameState, excludeOwned: boolean) {
      const b0 = channels(baseState);
      let bd0 = dailyBreakdown(baseState, P_FRAG);
      return DECOR.map((d) => {
        if (excludeOwned && baseState.decor.includes(d.id)) return { id: d.id, name: d.name, cost: d.cost, owned: true };
        const next = { ...baseState, decor: [...baseState.decor.filter((x) => x !== d.id), d.id] };
        const c1 = channels(next);
        const bd = dailyBreakdown(next, P_FRAG);
        return {
          id: d.id, name: d.name, desc: d.desc, cost: d.cost, owned: baseState.decor.includes(d.id),
          deltaIdlePerSec: +(c1.station - b0.station).toFixed(3), deltaClick: +(c1.clickPower - b0.clickPower).toFixed(3), deltaDispatchPerHour: +(c1.dispatchPerHour - b0.dispatchPerHour).toFixed(0),
          deltaDailyPct: +((bd.total / bd0.total - 1) * 100).toFixed(2),
          paybackDays: bd.total > bd0.total ? +((d.cost / (bd.total - bd0.total)) / 1).toFixed(2) : null,
        };
      });
    }
    const decorMid = decorRoi(stateMidNoDecor(), false);
    // 同事 ROI
    function colRoi(baseState: GameState) {
      const b0 = channels(baseState);
      const bd0 = dailyBreakdown(baseState, P_FRAG).total;
      const rows: unknown[] = [];
      for (const def of COLLEAGUES) {
        const cur = baseState.team.colleagues[def.id];
        if (cur && cur.level >= MAX_COLLEAGUE_LEVEL) continue;
        const price = cur ? upgradeCostOf(def, cur.level) : def.cost;
        const next = cur ? upgradeColleague(baseState, def.id) : recruit(baseState, def.id);
        if (!next) continue;
        const c1 = channels(next);
        const bd = dailyBreakdown(next, P_FRAG).total;
        rows.push({ id: def.id, name: def.name, action: cur ? `升级Lv${cur.level}→${cur.level + 1}` : "招募", cost: price, deltaIdlePerSec: +(c1.idleRate - b0.idleRate).toFixed(2), deltaDispatchPerHour: +(c1.dispatchPerHour - b0.dispatchPerHour).toFixed(0), deltaDailyPct: bd0 ? +((bd / bd0 - 1) * 100).toFixed(2) : 0, paybackDays: bd > bd0 ? +((price / (bd - bd0)) * 1).toFixed(2) : null });
      }
      return rows;
    }
    out.upgradeCurves = curves;
    out.decorMid = decorMid;
    out.colleaguesMid = colRoi(st);
    out.colleaguesLate = colRoi(stateLate());
    out.decorLate = decorRoi({ ...stateLate(), decor: [] }, false);
    writeFileSync(`${OUT_DIR}/roi.json`, JSON.stringify(out, null, 2));
    console.log("[roi] decor(mid no decor):", decorMid.map((r: any) => `${r.name}(${r.cost}):+${r.deltaDailyPct}%/回本${r.paybackDays}d`).join(" | "));
    console.log("[roi] colleagues(mid):", (out.colleaguesMid as any[]).map((r: any) => `${r.name}/${r.action}(${r.cost}):+${r.deltaDailyPct}%/回本${r.paybackDays}d`).join(" | "));
    console.log("[roi] colleagues(late):", (out.colleaguesLate as any[]).map((r: any) => `${r.name}(${r.cost}):+${r.deltaDailyPct}%/回本${r.paybackDays}d`).join(" | "));
    console.log("[roi] decor(late no decor):", (out.decorLate as any[]).map((r: any) => `${r.name}(${r.cost}):+${r.deltaDailyPct}%/回本${r.paybackDays}d`).join(" | "));
    const phone = curves.find((c: any) => c.id === "phone") as any;
    console.log("[roi] phone curve:", phone.points.map((p: any) => `${p.L}:${p.paybackSecIdle}s`).join(" "));
  });

  it("4) 每日精力：单档价值/最优子集是否随状态与画像变化", () => {
    const stages: Record<string, GameState> = { early: stateEarly(), mid: stateMid(), late: stateLate() };
    const rows: unknown[] = [];
    const ids = ENERGY_ACTIONS.map((a) => a.id);
    for (const [name, st] of Object.entries(stages)) {
      for (const p of [P_FRAG, P_HEAVY]) {
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
        rows.push({ stage: name, profile: p.name, baseDaily: Math.round(baseDaily), singles, bestSubset: subsets[0], comboValuePct: comboIdx >= 0 ? subsets[comboIdx].valuePct : null, comboRank: comboIdx + 1, top: subsets.slice(0, 4) });
      }
    }
    // 精力文案口径：挂机+n% 实际只乘工位
    const scope: unknown[] = [];
    for (const [name, st] of Object.entries(stages)) {
      const c = channels(st);
      scope.push({ stage: name, station: Math.round(c.station), teamFixed: Math.round(c.teamFixed), teamShare: Math.round(c.teamShare), idleRate: Math.round(c.idleRate), stationShareOfIdle: +(c.station / c.idleRate).toFixed(3), slackActualIdlePct: +((c.station / c.idleRate) * 25).toFixed(2), socialActualIdlePct: +((c.station / c.idleRate) * 5).toFixed(2), focusActualIdlePct: +((c.station / c.idleRate) * 8).toFixed(2) });
    }
    writeFileSync(`${OUT_DIR}/energy.json`, JSON.stringify({ rows, scope }, null, 2));
    for (const r of rows as any[]) console.log("[energy]", r.stage, r.profile, "singles", JSON.stringify(r.singles), "best", JSON.stringify(r.bestSubset), "combo", r.comboValuePct, "rank", r.comboRank);
    console.log("[energy-scope]", JSON.stringify(scope));
  });

  it("5) 每日卡：日价值 + 离线效率机制（回访 3 次后离线卡是否失效）", () => {
    const cold = { ...stateMid(), visits: { date: TD, count: 1 } };
    const visits: unknown[] = [];
    for (const v of [0, 1, 2, 3]) {
      const s = { ...stateMid(), visits: { date: TD, count: v } };
      visits.push({ visits: v, offlineEff: +offlineEfficiency(s, NOW - 3 * DAY, NOW).toFixed(3), channelOfflineEff: +channels(s).offlineEff.toFixed(3) });
    }
    const stages: Record<string, GameState> = { early: stateEarly(), mid: stateMid(), late: stateLate() };
    const rows: unknown[] = [];
    for (const [name, st] of Object.entries(stages)) {
      for (const p of [P_FRAG, P_HEAVY]) {
        const baseDaily = dailyBreakdown(st, p).total;
        for (const card of CARDS) {
          const s2 = withCard(st, card.id);
          const eff = cardEffects(s2, NOW);
          const p2 = { ...p, patrolPerHour: p.patrolPerHour * (eff.eventRateMult ?? 1) };
          rows.push({ stage: name, profile: p.name, id: card.id, name: card.name, rarity: card.rarity, desc: card.desc, effects: card.effects, valuePct: +((dailyBreakdown(s2, p2).total / baseDaily - 1) * 100).toFixed(2) });
        }
      }
    }
    writeFileSync(`${OUT_DIR}/cards.json`, JSON.stringify({ visits, rows }, null, 2));
    const sort = (stage: string, prof: string) => (rows as any[]).filter((r) => r.stage === stage && r.profile === prof).sort((a, b) => b.valuePct - a.valuePct);
    for (const stage of ["early", "mid", "late"]) for (const p of [P_FRAG.name, P_HEAVY.name]) console.log("[cards]", stage, p, sort(stage, p).map((r) => `${r.name}:${r.valuePct}%`).join(" | "));
    console.log("[cards] visits/offlineEff:", JSON.stringify(visits));
    console.log("[cards] cold(visits=1) offlineEff:", +offlineEfficiency(cold, NOW - 3 * DAY, NOW).toFixed(3));
  });

  it("6) 天赋：24 点最优分配（不同点击/巡逻存量的构筑是否不同）", () => {
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
    const variants = [
      { name: "点击9000/安然120(mid)", st: stateMid() },
      { name: "点击2000/安然30", st: withLevels(stateMid().levels, { ...stateMid(), totalClicks: 2000, patrolSurvives: 30 }) },
      { name: "点击0/安然0(纯挂机)", st: { ...stateMid(), totalClicks: 0, patrolSurvives: 0 } },
      { name: "点击20000/安然400(late)", st: stateLate() },
    ];
    const rows: unknown[] = [];
    for (const v of variants) {
      for (const p of [P_FRAG, P_HEAVY]) {
        const baselineIds = ["idle_1", "idle_2", "idle_3", "idle_4", "event_1", "event_2", "event_3", "event_4"];
        const baseDaily = dailyBreakdown(talentState(v.st, baselineIds), p).total;
        const scored: any[] = [];
        for (const cb of combos) {
          if (cb.cost > TALENT_POINT_CAP) continue;
          const daily = dailyBreakdown(talentState(v.st, cb.ids), p).total;
          scored.push({ ids: cb.ids.join(","), cost: cb.cost, gain: +((daily / baseDaily - 1) * 100).toFixed(2) });
        }
        scored.sort((a, b) => b.gain - a.gain);
        rows.push({ variant: v.name, profile: p.name, top: scored.slice(0, 4) });
      }
    }
    writeFileSync(`${OUT_DIR}/talents.json`, JSON.stringify({ rows, pointsTimeline: { rankPoints: 6, perPrestige: 1, perDay: 1, cap: TALENT_POINT_CAP, fullTree: 27 } }, null, 2));
    for (const r of rows as any[]) console.log("[talent]", r.variant, "|", r.profile, "|", r.top.map((t: any) => `+${t.gain}% [${t.cost}pt] ${t.ids}`).join("  ||  "));
  });

  it("7) 转生：策略模拟（何时转最优）+ 重置成本", () => {
    const mathRows: unknown[] = [];
    for (const k of [1, 1.25, 1.5, 2, 3, 5, 8, 10, 20]) {
      const points = Math.max(1, Math.min(20, Math.floor(PRESTIGE_TUNING.gainA * Math.pow(k, PRESTIGE_TUNING.gainB))));
      mathRows.push({ waitMultiple: k, pointsPerRun: points, pointsPerTime: +(points / k).toFixed(3) });
    }
    const resetCost = [5, 10, 15, 19, 20, 21, 22, 25, 30, 35, 39, 40, 41, 45, 48, 50, 55, 59, 60].map((L) => {
      const levels: Record<string, number> = {};
      for (const u of UPGRADES) levels[u.id] = L;
      const st = withLevels(levels, { prestige: 3, collected: collected(40), decor: ["plant", "fridge"], team: { colleagues: {} }, visits: VISITS3() });
      const before = channels(st);
      const pr = doPrestige({ ...st, totalEarned: prestigeThreshold(st), moyu: 0 });
      if (!pr) return { level: L, error: "cannot" };
      const after = channels(pr.state);
      return { level: L, keptLevel: Math.floor(L * PRESTIGE_TUNING.keepLevelRatio), idleRetained: +(after.idleRate / before.idleRate).toFixed(3), stationRetained: +(after.station / before.station).toFixed(3), gained: pr.gained, multBefore: +prestigeMultiplier(st.prestige).toFixed(2), multAfter: +prestigeMultiplier(pr.state.prestige).toFixed(2), netAfter: +((after.idleRate / before.idleRate) * (prestigeMultiplier(pr.state.prestige) / prestigeMultiplier(st.prestige))).toFixed(3) };
    });
    // 策略模拟
    function simulate(policy: "never" | "x1" | "x2" | "x5" | "x10" | "x20", days = 7) {
      let st = withLevels({ phone: 1 }, { totalClicks: 0, prestige: 0, lifetimeEarned: 0, totalEarned: 0, moyu: 20, visits: VISITS3(), daily: STREAK });
      let t = 0;
      const DT = 300;
      let prestiges = 0;
      let firstPrestigeMin = -1;
      let maxIdle = 0;
      while (t < days * DAY) {
        const daily = dailyBreakdown(st, P_FRAG);
        st = gain(st, (daily.total / DAY) * DT);
        maxIdle = Math.max(maxIdle, channels(st).idleRate);
        // 贪心购买（全局 ROI，最多 2 次/步）
        for (let k = 0; k < 2; k++) {
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
          for (const u of UPGRADES) if (!u.clickPower) consider(buyUpgrade(st, u.id), costOf(u.id, st.levels[u.id] ?? 0));
          for (const d of DECOR) if (!st.decor.includes(d.id)) consider(buyDecor(st, d.id), d.cost);
          for (const def of COLLEAGUES) {
            const cur = st.team.colleagues[def.id];
            if (cur && cur.level >= MAX_COLLEAGUE_LEVEL) continue;
            consider(cur ? upgradeColleague(st, def.id) : recruit(st, def.id), cur ? upgradeCostOf(def, cur.level) : def.cost);
          }
          if (!best) break;
          st = (best as any).next;
        }
        const k = policy === "never" ? Infinity : parseInt(policy.slice(1), 10);
        if (k !== Infinity && canPrestige(st) && st.totalEarned >= prestigeThreshold(st) * k) {
          const before = { mult: prestigeMultiplier(st.prestige) };
          const r = doPrestige(st);
          if (r) {
            st = r.state; prestiges++;
            if (firstPrestigeMin < 0) firstPrestigeMin = Math.round(t / 60);
            void before;
          }
        }
        t += DT;
      }
      return { policy, days, lifetime: Math.round(st.lifetimeEarned), prestigePoints: st.prestige, mult: +prestigeMultiplier(st.prestige).toFixed(2), prestiges, firstPrestigeMin, maxIdlePerSec: Math.round(maxIdle), levels: st.levels, decorCount: st.decor.length, colleagues: Object.keys(st.team.colleagues).length };
    }
    const sims = (["never", "x1", "x2", "x5", "x10", "x20"] as const).map((p) => simulate(p, 7));
    writeFileSync(`${OUT_DIR}/prestige.json`, JSON.stringify({ mathRows, resetCost, sims, tuning: PRESTIGE_TUNING }, null, 2));
    console.log("[prestige] math:", JSON.stringify(mathRows));
    console.log("[prestige] reset:", resetCost.map((r: any) => `L${r.level}→${r.keptLevel} retain ${r.idleRetained} net ${r.netAfter}`).join(" | "));
    for (const s of sims) console.log("[prestige]", JSON.stringify({ ...s, levels: undefined }));
  });

  it("8) 投资策略模拟：ROI贪心 vs 最便宜 vs 只买挂机 vs 只买装修（无转生 3 天）", () => {
    function simulate(policy: "roi" | "cheapest" | "idleOnly" | "decorOnly" | "clickOnly", days = 3) {
      let st = withLevels({}, { totalClicks: 0, prestige: 0, lifetimeEarned: 0, totalEarned: 0, moyu: 30, visits: VISITS3(), daily: STREAK });
      let t = 0;
      const DT = 300;
      while (t < days * DAY) {
        const daily = dailyBreakdown(st, P_FRAG);
        st = gain(st, (daily.total / DAY) * DT);
        for (let k = 0; k < 2; k++) {
          const b0 = channels(st);
          const cands: { cost: number; apply: () => GameState | null; d: number }[] = [];
          const push = (cost: number, apply: () => GameState | null, allow: boolean) => {
            if (!allow || cost > st.moyu) return;
            const next = apply();
            if (!next) return;
            const c1 = channels(next);
            const d = c1.idleRate - b0.idleRate + (c1.dispatchPerHour - b0.dispatchPerHour) / 3600;
            if (d > 0) cands.push({ cost, apply: () => next, d });
          };
          for (const u of UPGRADES) {
            const allow = policy === "cheapest" || (policy === "roi") || (policy === "idleOnly" && !u.clickPower) || (policy === "clickOnly" && !!u.clickPower);
            push(costOf(u.id, st.levels[u.id] ?? 0), () => buyUpgrade(st, u.id), allow);
          }
          for (const d of DECOR) push(d.cost, () => buyDecor(st, d.id), policy === "roi" || policy === "cheapest" || policy === "decorOnly");
          for (const def of COLLEAGUES) {
            const cur = st.team.colleagues[def.id];
            if (cur && cur.level >= MAX_COLLEAGUE_LEVEL) continue;
            const allow = policy === "roi" || policy === "cheapest";
            push(cur ? upgradeCostOf(def, cur.level) : def.cost, () => (cur ? upgradeColleague(st, def.id) : recruit(st, def.id)), allow);
          }
          if (cands.length === 0) break;
          let pick: any;
          if (policy === "cheapest") pick = cands.sort((a, b) => a.cost - b.cost)[0];
          else pick = cands.sort((a, b) => b.d / b.cost - a.d / a.cost)[0];
          const next = pick.apply();
          if (!next) break;
          st = next;
        }
        t += DT;
      }
      return { policy, days, lifetime: Math.round(st.lifetimeEarned), idleRate: Math.round(channels(st).idleRate), levels: st.levels, decor: st.decor.length, colleagues: Object.keys(st.team.colleagues).length };
    }
    const sims = (["roi", "cheapest", "idleOnly", "decorOnly", "clickOnly"] as const).map((p) => simulate(p, 3));
    writeFileSync(`${OUT_DIR}/investment-policies.json`, JSON.stringify(sims, null, 2));
    for (const s of sims) console.log("[invest]", JSON.stringify({ ...s, levels: undefined }));
  });

  it("9) 交互细节：回访/离线、自动重复、派遣任务、小游戏、省心组合", () => {
    const mid = stateMid();
    // 回访对离线效率的贡献
    const visits: unknown[] = [];
    for (const v of [0, 1, 2, 3]) visits.push({ visits: v, offlineEff: +offlineEfficiency({ ...mid, visits: { date: TD, count: v } }, NOW - 3 * DAY, NOW).toFixed(3) });
    // 离线卡在 visits=3 时是否失效
    const offlineCards: unknown[] = [];
    for (const id of ["early_leave", "canteen_gift", "overtime", "deadline", "hr_talk", "ac_move"]) {
      try {
        const s = withCard(mid, id);
        offlineCards.push({ id, eff: +channels(s).offlineEff.toFixed(3), deltaPct: +((channels(s).offlineEff / channels(mid).offlineEff - 1) * 100).toFixed(2) });
      } catch { /* ignore */ }
    }
    // 自动重复：离线补 1 轮占比（mid/late）
    const autoRepeat: unknown[] = [];
    for (const [name, st] of Object.entries({ mid: stateMid(), late: stateLate() })) {
      const c = channels(st);
      const b = dailyBreakdown(st, P_FRAG);
      autoRepeat.push({ stage: name, dispatchRound: Math.round(c.dispatchRound), dispatchPerDay: Math.round(b.dispatch), catchUpSharePct: +((c.dispatchRound / b.dispatch) * 100).toFixed(1) });
    }
    // 派遣任务：每个同事最优 per-hour vs 擅长
    const dispatchRows: unknown[] = [];
    for (const [name, st] of Object.entries({ mid: stateMid(), late: stateLate() })) {
      const station = stationIdleScaled(st);
      for (const def of COLLEAGUES) {
        if (!st.team.colleagues[def.id]) continue;
        const rows = MISSIONS.map((m) => {
          const probe: GameState = { ...st, team: { colleagues: { ...st.team.colleagues, [def.id]: { ...st.team.colleagues[def.id]!, missionId: m.id } } } };
          const secs = missionSecondsFor(def.id, m.id);
          const r = dispatchReward(probe, def.id, station);
          return { mission: m.name, secs, reward: Math.round(r), perHour: Math.round((r / secs) * 3600), skillMatch: def.skill === m.type };
        }).sort((a, b) => b.perHour - a.perHour);
        dispatchRows.push({ stage: name, colleague: def.name, best: rows[0], skillMatchIsBest: rows[0].skillMatch, skillMissionPerHour: rows.find((r) => r.skillMatch)?.perHour ?? null });
      }
    }
    // 小游戏：3 个游戏同一公式；奖励=25s 工位挂机
    const arcade: unknown[] = [];
    for (const [name, st] of Object.entries({ early: stateEarly(), mid: stateMid(), late: stateLate() })) {
      const c = channels(st);
      const b = dailyBreakdown(st, P_FRAG);
      arcade.push({ stage: name, stationIdlePerSec: Math.round(c.station), arcadePerGame: Math.round(c.arcadePerGame), arcade3PerDay: Math.round(c.arcadePerGame * 3), dailyTotal: Math.round(b.total), sharePct: +((c.arcadePerGame * 3 / b.total) * 100).toFixed(3), equivalentIdleSeconds: 25 * 3 });
    }
    // 省心组合 vs 最优
    const b0 = dailyBreakdown(mid, P_FRAG).total;
    const subsets: any[] = [];
    const ids = ENERGY_ACTIONS.map((a) => a.id);
    for (let mask = 1; mask < 16; mask++) {
      const set = ids.filter((_, i) => mask & (1 << i));
      const cost = set.reduce((s, id) => s + ENERGY_ACTIONS.find((a) => a.id === id)!.cost, 0);
      if (cost > ENERGY_PER_DAY) continue;
      subsets.push({ set, cost, gainPct: +((dailyBreakdown(withEnergy(mid, set), P_FRAG).total / b0 - 1) * 100).toFixed(2) });
    }
    subsets.sort((a, b) => b.gainPct - a.gainPct);
    // 转生 UI 文案验证：门槛随倍率涨
    const thresholds: unknown[] = [];
    for (const P of [0, 1, 3, 6, 10]) {
      const s = { ...mid, prestige: P };
      thresholds.push({ prestige: P, mult: +prestigeMultiplier(P).toFixed(2), threshold: Math.round(prestigeThreshold(s)), gainAtThreshold: prestigeGain({ ...s, totalEarned: prestigeThreshold(s), lifetimeEarned: 1e12 }) });
    }
    const out = {
      visits, offlineCards, autoRepeat, dispatchRows, arcade,
      energyBest: subsets.slice(0, 5),
      energyCombo: subsets.find((x) => x.set.join(",") === "slack,fake-work,social"),
      prestigeThresholdGain: thresholds,
      constantChecks: {
        cardDismissCosts: 0,
        talentRespecCosts: 0,
        decorSlots: null,
        decorMutualExclusion: false,
        decorCompletionBonus: DECOR_COMPLETE_BONUS,
        autoRepeatDefault: false,
      },
    };
    writeFileSync(`${OUT_DIR}/interactions.json`, JSON.stringify(out, null, 2));
    console.log("[interact] visits:", JSON.stringify(visits));
    console.log("[interact] offlineCards@visits3:", JSON.stringify(offlineCards));
    console.log("[interact] autoRepeat:", JSON.stringify(autoRepeat));
    console.log("[interact] dispatch:", JSON.stringify(dispatchRows.map((d: any) => `${d.stage}/${d.colleague}:${d.best.mission} ${d.best.perHour}/h matchBest=${d.skillMatchIsBest} skill=${d.skillMissionPerHour}/h`)));
    console.log("[interact] arcade:", JSON.stringify(arcade));
    console.log("[interact] energy:", JSON.stringify(out.energyBest), "combo:", JSON.stringify(out.energyCombo));
    console.log("[interact] prestigeThresholdGain:", JSON.stringify(thresholds));
  });
});