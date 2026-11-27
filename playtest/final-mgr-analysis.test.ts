/**
 * 终验·管理/策略党专属引擎探针（v0.5.0，HEAD 9760eab）
 * 目的：资源流向图（各来源占比）、倍率叠加矩阵（协同/冲突）、ROI/投资顺序、
 * 精力/卡牌/天赋/转生的决策是否"真取舍"、假选择验证。
 * 运行：PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" npx vitest run --config playtest/vitest.final-mgr.config.ts
 */
import { describe, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { initialState, type GameState, gain } from "../src/engine/state";
import {
  UPGRADES, costOf, effectOf, stationIdleScaled, stationIdleOf,
} from "../src/engine/upgrades";
import { clickPowerOf } from "../src/engine/actions";
import { DECOR, decorEffects, buyDecor, DECOR_COMPLETE_BONUS } from "../src/engine/decor";
import {
  COLLEAGUES, MISSIONS, dispatchReward, missionSecondsFor, teamFixedRate, teamShareRatio,
  recruit, upgradeColleague, upgradeCostOf, favorBonuses, MAX_COLLEAGUE_LEVEL,
} from "../src/engine/team";
import { ENERGY_ACTIONS, useEnergy, ENERGY_PER_DAY } from "../src/engine/energy";
import { CARDS, cardEffects } from "../src/engine/cards";
import {
  TALENTS, talentEffects, unlockTalent, costOfTalent, TALENT_POINT_CAP,
} from "../src/engine/talents";
import { dailyReward } from "../src/engine/daily";
import { bossSurviveReward } from "../src/engine/events";
import { offlineEfficiency } from "../src/engine/progression";
import { prestigeMultiplier, prestigeGain, prestigeThreshold, canPrestige, doPrestige, PRESTIGE_TUNING } from "../src/engine/prestige";
import { buyUpgrade } from "../src/engine/actions";

const OUT_DIR = "playtest/final-mgr";
mkdirSync(OUT_DIR, { recursive: true });
const NOW = Date.now();
const DAY = 86400;

function mk(over: Partial<GameState> = {}): GameState {
  return { ...initialState(), ...over } as GameState;
}
function withLevels(levels: Record<string, number>, over: Partial<GameState> = {}): GameState {
  return mk({ levels, ...over });
}
function collected(n: number): { quotes: number[]; flavors: number[] } {
  const quotes = Array.from({ length: Math.min(n, 10) }, (_, i) => i);
  const rest = Math.max(0, n - quotes.length);
  const flavors = Array.from({ length: Math.min(rest, 45) }, (_, i) => i);
  return { quotes, flavors };
}
function emptyEnergy(): GameState["energy"] {
  return { date: "", left: ENERGY_PER_DAY, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } };
}
function withEnergy(state: GameState, actions: string[]): GameState {
  let s: GameState = { ...state, energy: emptyEnergy() };
  for (const a of actions) s = useEnergy(s, a as never) ?? s;
  return s;
}
function emptyCards(): GameState["cards"] {
  return { date: "", offers: [], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: false, chosenDate: "" };
}
function withCard(state: GameState, cardId: string | null): GameState {
  if (!cardId) return { ...state, cards: emptyCards() };
  return { ...state, cards: { ...emptyCards(), offers: [cardId], chosen: cardId, until: NOW + 24 * 3600 * 1000 } };
}
function talentState(state: GameState, ids: string[], freePoints = TALENT_POINT_CAP): GameState {
  let s: GameState = { ...state, talents: { unlocked: [], points: freePoints, rankGranted: 12, dailyGiftDate: "", overflow: 0 } };
  for (const id of ids) {
    const next = unlockTalent(s, id);
    if (!next) throw new Error(`talent unlock failed: ${id} (need ${costOfTalent(id)}, have ${s.talents.points})`);
    s = next;
  }
  return s;
}

/* ---------------- 快照：各收入通道的瞬时速率 ---------------- */
interface Channels {
  station: number; teamFixed: number; teamShare: number; idleRate: number;
  clickPower: number; dispatchPerHour: number; dispatchRound: number;
  arcadePerGame: number; dailyPerClaim: number; patrolPerEvent: number; memePerHour: number;
  offlinePerSec: number; offlineEff: number;
}
function bestMission(state: GameState, id: string, station: number, mode: "hour" | "round"): number {
  let best = 0;
  for (const m of MISSIONS) {
    const probe: GameState = {
      ...state,
      team: { colleagues: { ...state.team.colleagues, [id]: { ...state.team.colleagues[id]!, missionId: m.id } } },
    };
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
  const teamPart = Math.max(0, idleRate - station);
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
  const arcadePerGame = Math.max(Math.floor(station * 25), 30);
  const dailyPerClaim = dailyReward(state);
  const patrolPerEvent = bossSurviveReward(state, { surviveStreak: 5 } as never);
  const memePerHour = 60 * 5 * clickPower * talent.memeRewardMult * favor.memeMult;
  const offlineEff = offlineEfficiency(state, NOW - 3 * DAY, NOW);
  const offlinePerSec = (station + teamPart * 0.5) * offlineEff;
  return { station, teamFixed, teamShare, idleRate, clickPower, dispatchPerHour, dispatchRound, arcadePerGame, dailyPerClaim, patrolPerEvent, memePerHour, offlinePerSec, offlineEff };
}

interface Profile {
  name: string; activeHours: number; clicksPerDay: number; offlineHours: number;
  arcadeGames: number; dailyClaims: number; patrolPerHour: number;
}
const P_IDLE: Profile = { name: "摸鱼管理型(在线1h/0点击/离线12h)", activeHours: 1, clicksPerDay: 0, offlineHours: 12, arcadeGames: 3, dailyClaims: 4, patrolPerHour: 30 };
const P_CLICK: Profile = { name: "点击党(在线2h/5400点击/离线10h)", activeHours: 2, clicksPerDay: 5400, offlineHours: 10, arcadeGames: 3, dailyClaims: 4, patrolPerHour: 30 };

function dailyBreakdown(state: GameState, p: Profile) {
  const c = channels(state);
  const clickIncome = p.clicksPerDay * c.clickPower * 1.1;
  const station = c.station * p.activeHours * 3600;
  const teamFixed = c.teamFixed * p.activeHours * 3600;
  const teamShare = c.teamShare * p.activeHours * 3600;
  const dispatchOnline = c.dispatchPerHour * p.activeHours;
  const dispatchOffline = c.dispatchRound;
  const patrol = c.patrolPerEvent * p.patrolPerHour * p.activeHours;
  const meme = c.memePerHour * p.activeHours;
  const arcade = c.arcadePerGame * p.arcadeGames;
  const daily = c.dailyPerClaim * p.dailyClaims;
  const offline = c.offlinePerSec * p.offlineHours * 3600;
  const total = clickIncome + station + teamFixed + teamShare + dispatchOnline + dispatchOffline + patrol + meme + arcade + daily + offline;
  return { total, clickIncome, station, teamFixed, teamShare, dispatch: dispatchOnline + dispatchOffline, dispatchOnline, dispatchOffline, patrol, meme, arcade, daily, offline };
}
function sharePct(b: ReturnType<typeof dailyBreakdown>) {
  const keys = ["clickIncome", "station", "teamFixed", "teamShare", "dispatch", "patrol", "meme", "arcade", "daily", "offline"] as const;
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = b.total > 0 ? ((b[k] / b.total) * 100).toFixed(1) + "%" : "0%";
  return out;
}

/* ---------------- 状态样板 ---------------- */
function stateEarly(): GameState {
  return withLevels({ coffee: 3, water: 1, phone: 4, toilet: 1 }, { totalClicks: 1200, lifetimeEarned: 1500, totalEarned: 1500, patrolSurvives: 3 });
}
function stateMid(): GameState {
  const levels = { coffee: 12, water: 10, chair: 6, phone: 25, toilet: 22, group: 18, meeting: 12, deep: 4, retire: 0 };
  const base = withLevels(levels, {
    totalClicks: 9000, lifetimeEarned: 3.2e7, totalEarned: 2.1e7, moyu: 8e5, patrolSurvives: 120,
    collected: collected(30), prestige: 0,
    decor: ["plant", "lamp", "rug", "fridge", "chair"],
    team: {
      colleagues: {
        zhou: { level: 2, missionId: null, startedAt: 0, endsAt: 0, favor: 30, autoRepeat: true, rewardSnapshot: 0 },
        mei: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 10, autoRepeat: true, rewardSnapshot: 0 },
      },
    },
    energy: emptyEnergy(),
  });
  return talentState(base, ["idle_1", "idle_2", "idle_3"]);
}
function stateLate(): GameState {
  const levels: Record<string, number> = {};
  for (const u of UPGRADES) levels[u.id] = 45;
  const base = withLevels(levels, {
    totalClicks: 20000, lifetimeEarned: 4e11, totalEarned: 6e9, moyu: 3e9, patrolSurvives: 400,
    collected: collected(55), prestige: 6,
    decor: DECOR.map((d) => d.id),
    team: { colleagues: Object.fromEntries(COLLEAGUES.map((c) => [c.id, { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 100, autoRepeat: true, rewardSnapshot: 0 }])) },
    energy: emptyEnergy(),
  });
  return talentState(base, ["idle_1", "idle_2", "idle_3", "idle_4", "idle_5b", "event_1", "event_2", "event_3", "event_4", "event_5b", "click_1", "click_2", "click_3", "click_4"]);
}

describe("终验·管理党 / 资源流向与决策深度", () => {
  it("1) 各阶段收入来源占比", () => {
    const stages: Record<string, GameState> = { early: stateEarly(), mid: stateMid(), late: stateLate() };
    const out: Record<string, unknown> = {};
    for (const [name, st] of Object.entries(stages)) {
      const b1 = dailyBreakdown(st, P_IDLE);
      const b2 = dailyBreakdown(st, P_CLICK);
      out[name] = {
        profileIdle: { totalPerDay: Math.round(b1.total), share: sharePct(b1), raw: Object.fromEntries(Object.entries(b1).map(([k, v]) => [k, Math.round(v as number)])) },
        profileClick: { totalPerDay: Math.round(b2.total), share: sharePct(b2) },
        channels: Object.fromEntries(Object.entries(channels(st)).map(([k, v]) => [k, +v.toFixed(4)])),
      };
    }
    writeFileSync(`${OUT_DIR}/flow.json`, JSON.stringify(out, null, 2));
    for (const [k, v] of Object.entries(out)) console.log("[flow]", k, "idle-share", JSON.stringify((v as any).profileIdle.share), "click-share", JSON.stringify((v as any).profileClick.share));
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
      { id: "decor:绿萝 工位挂机+5%", apply: (s) => (s.decor.includes("plant") ? s : { ...s, decor: [...s.decor, "plant"] }) },
      { id: "decor:投影仪 派遣+30%", apply: (s) => (s.decor.includes("projector") ? s : { ...s, decor: [...s.decor, "projector"] }) },
      { id: "decor:地毯 离线+5%", apply: (s) => (s.decor.includes("rug") ? s : { ...s, decor: [...s.decor, "rug"] }) },
      { id: "talent:idle_5a 工位挂机+20%", apply: (s) => talentState(s, [...s.talents.unlocked, "idle_5a"]) },
      { id: "talent:idle_5b 同事挂机+70%", apply: (s) => talentState(s, [...s.talents.unlocked, "idle_5b"]) },
      { id: "talent:event_5a 每次安然+1%挂机(当前120次)", apply: (s) => talentState(s, [...s.talents.unlocked, "event_5a"]) },
      { id: "talent:event_5b 巡逻/梗×2,离线+20%", apply: (s) => talentState(s, [...s.talents.unlocked, "event_5b"]) },
      { id: "talent:click_5b 挂机+12%+点击+60%", apply: (s) => talentState(s, ["idle_1", "idle_2", "idle_3", "idle_4", "event_1", "event_2", "event_3", "event_4", "click_1", "click_2", "click_3", "click_4", "click_5b"]) },
      { id: "prestige:+1点 总倍率+0.75", apply: (s) => ({ ...s, prestige: s.prestige + 1 }) },
      { id: "collection:+5格 挂机+2%", apply: (s) => ({ ...s, collected: collected(35) }) },
      { id: "组合:投影仪+slack+咖啡卡", apply: (s) => withCard(withEnergy((s.decor.includes("projector") ? s : { ...s, decor: [...s.decor, "projector"] }), ["slack"]), "coffee_day") },
    ];
    const rows: unknown[] = [];
    for (const c of cases) {
      const s = c.apply(base);
      const b = channels(s);
      const rel = (a: number, o: number) => (o > 0 ? +((a / o - 1) * 100).toFixed(2) : null);
      rows.push({
        id: c.id, station: rel(b.station, b0.station), teamFixed: rel(b.teamFixed, b0.teamFixed), teamShare: rel(b.teamShare, b0.teamShare),
        idleTotal: rel(b.idleRate, b0.idleRate), dispatch: rel(b.dispatchPerHour, b0.dispatchPerHour), arcade: rel(b.arcadePerGame, b0.arcadePerGame),
        daily: rel(b.dailyPerClaim, b0.dailyPerClaim), patrol: rel(b.patrolPerEvent, b0.patrolPerEvent), offline: rel(b.offlinePerSec, b0.offlinePerSec),
        click: rel(b.clickPower, b0.clickPower), meme: rel(b.memePerHour, b0.memePerHour),
      });
    }
    writeFileSync(`${OUT_DIR}/stack-matrix.json`, JSON.stringify({ base: { station: b0.station, teamFixed: b0.teamFixed, teamShare: b0.teamShare, idleRate: b0.idleRate, clickPower: b0.clickPower }, rows }, null, 2));
    console.log("[stack] base", JSON.stringify({ station: Math.round(b0.station), teamFixed: Math.round(b0.teamFixed), teamShare: Math.round(b0.teamShare), idle: Math.round(b0.idleRate) }));
    for (const r of rows as any[]) console.log("[stack]", r.id, "| station", r.station, "| teamShare", r.teamShare, "| dispatch", r.dispatch, "| arcade", r.arcade, "| daily", r.daily, "| patrol", r.patrol, "| offline", r.offline, "| click", r.click);
  });

  it("3) ROI：升级/家具/同事的回本时间与投资顺序", () => {
    const st = stateMid();
    const base = channels(st);
    const totalDaily = dailyBreakdown(st, P_IDLE).total;
    // 升级 ROI
    const rows: unknown[] = [];
    for (const u of UPGRADES) {
      const lv = st.levels[u.id] ?? 0;
      const targets = Array.from(new Set([0, 5, 10, 15, 19, 20, 25, 39, 40, 45, Math.max(0, lv - 1), lv])).sort((a, b) => a - b);
      for (const target of targets) {
        const price = costOf(u.id, target);
        const s2 = { ...st, levels: { ...st.levels, [u.id]: target + 1 } };
        const c2 = channels(s2);
        const dIdle = c2.station - base.station + (c2.teamShare - base.teamShare) + (c2.teamFixed - base.teamFixed);
        const dClick = c2.clickPower - base.clickPower;
        rows.push({
          kind: "upgrade", id: u.id, name: u.name, line: u.clickPower ? "click" : "idle", atLevel: target, cost: price,
          deltaIdlePerSec: +dIdle.toFixed(4), deltaClick: +dClick.toFixed(4),
          paybackSecIdle: dIdle > 0 ? Math.round(price / dIdle) : null,
          paybackSecClickAt2cps: dClick > 0 ? Math.round(price / (dClick * 2)) : null,
        });
      }
    }
    // 家具 ROI
    const decorRows: unknown[] = [];
    for (const d of DECOR) {
      const alreadyOwned = st.decor.includes(d.id);
      const s2 = alreadyOwned ? st : { ...st, decor: [...st.decor, d.id] };
      const c2 = channels(s2);
      const dIdle = c2.station - base.station; // 家具只放大工位（teamShare 不吃 decor）
      const dClick = c2.clickPower - base.clickPower;
      const dDispatch = c2.dispatchPerHour - base.dispatchPerHour;
      const dOffline = c2.offlinePerSec - base.offlinePerSec;
      void dIdle;
      const rateGain = (c2.offlineEff > 0 ? dOffline : 0) * (12 / 24) + (dIdle > 0 ? dIdle * 0.5 : 0) + dClick * (P_CLICK.clicksPerDay / 86400) * 0.5 + dDispatch / 3600 * 0.33;
      decorRows.push({
        id: d.id, name: d.name, cost: d.cost, alreadyOwned,
        deltaIdlePerSec: +(c2.station - base.station).toFixed(3), deltaClick: +(c2.clickPower - base.clickPower).toFixed(3),
        deltaDispatchPerHour: +dDispatch.toFixed(1),
        paybackSecApprox: rateGain > 0 ? Math.round(d.cost / rateGain) : null,
        paybackDaysApprox: rateGain > 0 ? +(d.cost / rateGain / 86400).toFixed(2) : null,
      });
    }
    // 同事 ROI（招募 或 下一级升级）
    const colRows: unknown[] = [];
    for (const def of COLLEAGUES) {
      const cur = st.team.colleagues[def.id];
      if (cur && cur.level >= MAX_COLLEAGUE_LEVEL) continue;
      const price = cur ? upgradeCostOf(def, cur.level) : def.cost;
      const next = cur ? upgradeColleague(st, def.id) : recruit(st, def.id);
      if (!next) continue;
      const c2 = channels(next);
      const dIdle = c2.teamFixed + c2.teamShare - base.teamFixed - base.teamShare;
      const dDispatch = c2.dispatchPerHour - base.dispatchPerHour;
      const rateGain = dIdle + dDispatch / 3600 * 8; // 派遣按一天约 8h 折算
      colRows.push({
        id: def.id, name: def.name, action: cur ? `升级 Lv.${cur.level}→${cur.level + 1}` : "招募 Lv.1", cost: price,
        deltaIdlePerSec: +dIdle.toFixed(2), deltaDispatchPerHour: +dDispatch.toFixed(0),
        paybackSecApprox: rateGain > 0 ? Math.round(price / rateGain) : null,
        paybackDaysApprox: rateGain > 0 ? +(price / rateGain / 86400).toFixed(2) : null,
        affordableNow: price <= st.moyu,
      });
    }
    writeFileSync(`${OUT_DIR}/roi.json`, JSON.stringify({ stateMid: { moyu: st.moyu, channels: base, totalDaily: Math.round(totalDaily) }, upgrades: rows, decor: decorRows, colleagues: colRows }, null, 2));
    console.log("[roi] decor:", decorRows.map((r: any) => `${r.name}(${r.cost}):${r.paybackDaysApprox}d`).join(" | "));
    console.log("[roi] colleagues:", colRows.map((r: any) => `${r.name}/${r.action}(${r.cost}):${r.paybackDaysApprox}d`).join(" | "));
    const idleLine = rows.filter((r: any) => r.line === "idle");
    console.log("[roi] idle upgrades payback sec:", idleLine.map((r: any) => `${r.name}@${r.atLevel}:${r.paybackSecIdle}`).join(" | "));
  });

  it("4) 每日精力：单档价值/最优子集是否随状态与画像变化", () => {
    const stages: Record<string, GameState> = { early: stateEarly(), mid: stateMid(), late: stateLate() };
    const out: unknown[] = [];
    for (const [name, st] of Object.entries(stages)) {
      for (const prof of [P_IDLE, P_CLICK]) {
        const baseDaily = dailyBreakdown(st, prof).total;
        const singles: Record<string, number> = {};
        for (const a of ENERGY_ACTIONS) {
          const s2 = withEnergy(st, [a.id]);
          singles[a.id] = +((dailyBreakdown(s2, prof).total / baseDaily - 1) * 100).toFixed(2);
        }
        const subsets: { set: string[]; cost: number; valuePct: number }[] = [];
        const ids = ENERGY_ACTIONS.map((a) => a.id);
        for (let mask = 1; mask < 16; mask++) {
          const set = ids.filter((_, i) => mask & (1 << i));
          const cost = set.reduce((s, id) => s + ENERGY_ACTIONS.find((a) => a.id === id)!.cost, 0);
          if (cost > ENERGY_PER_DAY) continue;
          const s2 = withEnergy(st, set);
          subsets.push({ set, cost, valuePct: +((dailyBreakdown(s2, prof).total / baseDaily - 1) * 100).toFixed(2) });
        }
        subsets.sort((a, b) => b.valuePct - a.valuePct);
        const comboIdx = subsets.findIndex((x) => x.set.join(",") === "slack,fake-work,social");
        out.push({ stage: name, profile: prof.name, baseDaily: Math.round(baseDaily), singles, bestSubset: subsets[0], comboValuePct: comboIdx >= 0 ? subsets[comboIdx].valuePct : null, comboRank: comboIdx >= 0 ? comboIdx + 1 : null, topSubsets: subsets.slice(0, 5) });
      }
    }
    const scope: unknown[] = [];
    for (const [name, st] of Object.entries(stages)) {
      const c = channels(st);
      scope.push({
        stage: name, station: Math.round(c.station), teamFixed: Math.round(c.teamFixed), teamShare: Math.round(c.teamShare), idleRate: Math.round(c.idleRate),
        stationShareOfIdle: +(c.station / c.idleRate).toFixed(3),
        trueSlackGainOfTotalIdlePct: +((c.station / c.idleRate) * 0.25 * 100).toFixed(2),
        trueSocialGainOfTotalIdlePct: +((c.station / c.idleRate) * 0.05 * 100).toFixed(2),
        trueFocusIdleGainPct: +((c.station / c.idleRate) * 0.08 * 100).toFixed(2),
      });
    }
    writeFileSync(`${OUT_DIR}/energy.json`, JSON.stringify({ out, scope }, null, 2));
    for (const r of out as any[]) console.log("[energy]", r.stage, r.profile, "singles%", JSON.stringify(r.singles), "| best", JSON.stringify(r.bestSubset), "| combo%", r.comboValuePct, "rank", r.comboRank);
    console.log("[energy-scope]", JSON.stringify(scope));
  });

  it("5) 每日卡：每张卡的日价值、风险卡是否真是风险", () => {
    const stages: Record<string, GameState> = { early: stateEarly(), mid: stateMid(), late: stateLate() };
    const rows: unknown[] = [];
    for (const [name, st] of Object.entries(stages)) {
      for (const prof of [P_IDLE, P_CLICK]) {
        const baseDaily = dailyBreakdown(st, prof).total;
        for (const card of CARDS) {
          const s2 = withCard(st, card.id);
          const eff = cardEffects(s2, NOW);
          const p2 = { ...prof, patrolPerHour: prof.patrolPerHour * (eff.eventRateMult ?? 1) };
          rows.push({ stage: name, profile: prof.name, id: card.id, name: card.name, rarity: card.rarity, effects: card.effects, valuePct: +((dailyBreakdown(s2, p2).total / baseDaily - 1) * 100).toFixed(2) });
        }
      }
    }
    writeFileSync(`${OUT_DIR}/cards.json`, JSON.stringify(rows, null, 2));
    const sort = (stage: string, prof: string) => (rows as any[]).filter((r) => r.stage === stage && r.profile === prof).sort((a, b) => b.valuePct - a.valuePct);
    for (const stage of ["early", "mid", "late"]) {
      for (const prof of [P_IDLE.name, P_CLICK.name]) console.log("[cards]", stage, prof, sort(stage, prof).map((r) => `${r.name}:${r.valuePct}%`).join(" | "));
    }
    // 随机 3 张的期望：取最好一张
    console.log("[cards] risk cards:", sort("mid", P_IDLE.name).filter((r) => ["通宵摸鱼", "截止日逼近", "空调坏了", "HR 约谈", "部门搬家"].includes(r.name)).map((r) => `${r.name}:${r.valuePct}%`).join(" | "));
  });

  it("6) 天赋：24 点上限下的最优分配（是否真有互斥取舍）", () => {
    const branchOptions: { branch: string; ids: string[]; cost: number }[] = [];
    for (const b of ["click", "idle", "event"] as const) {
      branchOptions.push({ branch: b, ids: [], cost: 0 });
      const tiers = TALENTS.filter((t) => t.branch === b);
      const low = tiers.filter((t) => t.tier < 5).sort((x, y) => x.tier - y.tier);
      for (let k = 1; k <= 4; k++) {
        const ids = low.slice(0, k).map((t) => t.id);
        branchOptions.push({ branch: b, ids, cost: ids.reduce((s, id) => s + costOfTalent(id), 0) });
      }
      for (const ult of tiers.filter((t) => t.tier === 5)) {
        const ids = [...low.map((t) => t.id), ult.id];
        branchOptions.push({ branch: b, ids, cost: ids.reduce((s, id) => s + costOfTalent(id), 0) });
      }
    }
    const combos: { ids: string[]; cost: number }[] = [];
    for (const a of branchOptions.filter((x) => x.branch === "click"))
      for (const b of branchOptions.filter((x) => x.branch === "idle"))
        for (const c of branchOptions.filter((x) => x.branch === "event")) {
          const ids = [...a.ids, ...b.ids, ...c.ids];
          combos.push({ ids, cost: a.cost + b.cost + c.cost });
        }
    const stages: Record<string, GameState> = { mid: stateMid(), late: stateLate() };
    const rows: unknown[] = [];
    for (const [name, st] of Object.entries(stages)) {
      for (const prof of [P_IDLE, P_CLICK]) {
        const baseDaily = dailyBreakdown(talentState(st, ["idle_1", "idle_2", "idle_3", "idle_4", "event_1", "event_2", "event_3", "event_4"]), prof).total;
        let best: any = null;
        let bestCost = 0;
        for (const cb of combos) {
          if (cb.cost > TALENT_POINT_CAP) continue;
          const s2 = talentState(st, cb.ids);
          // 与"12 点基线"比较，衡量这套 24 点相对基线的增益
          const daily = dailyBreakdown(s2, prof).total;
          const gainPct = +((daily / baseDaily - 1) * 100).toFixed(2);
          if (!best || gainPct > best.gainPct) { best = { ids: cb.ids.join(","), gainPct }; bestCost = cb.cost; }
        }
        rows.push({ stage: name, profile: prof.name, best, bestCost, combosEvaluated: combos.length });
      }
    }
    writeFileSync(`${OUT_DIR}/talents.json`, JSON.stringify({ rows, pointsTimeline: { rankPoints: 6, perPrestige: 1, perDay: 1, cap: TALENT_POINT_CAP } }, null, 2));
    for (const r of rows as any[]) console.log("[talent]", r.stage, r.profile, "best:", r.best.ids, "cost", r.bestCost, "+" + r.best.gainPct + "%");
  });

  it("7) 转生：攒够再转是否最优？重置成本与倍率收益", () => {
    const mathRows: unknown[] = [];
    for (const k of [1, 1.25, 1.5, 2, 3, 5, 10]) {
      const points = Math.max(1, Math.min(20, Math.floor(PRESTIGE_TUNING.gainA * Math.pow(k, PRESTIGE_TUNING.gainB))));
      mathRows.push({ waitMultiple: k, pointsPerRun: points, pointsPer1xTime: +(points / k).toFixed(3) });
    }
    // 重置成本：不同等级档位 reset 后的产能保留率
    const resetCost = [5, 10, 15, 19, 20, 21, 22, 25, 30, 35, 39, 40, 41, 45, 48, 50, 55, 59, 60].map((L) => {
      const levels: Record<string, number> = {};
      for (const u of UPGRADES) levels[u.id] = L;
      const st = withLevels(levels, { prestige: 3, collected: collected(40), decor: ["plant", "fridge"], team: { colleagues: {} } });
      const before = channels(st);
      const threshold = prestigeThreshold(st);
      const pr = doPrestige({ ...st, totalEarned: threshold, moyu: 0 });
      if (!pr) return { level: L, error: "cannot prestige" };
      const after = channels(pr.state);
      return {
        level: L, keptLevel: Math.floor(L * PRESTIGE_TUNING.keepLevelRatio),
        stationRetained: +(after.station / before.station).toFixed(3),
        idleRetained: +(after.idleRate / before.idleRate).toFixed(3),
        gainedPoints: pr.gained,
        multBefore: +prestigeMultiplier(st.prestige).toFixed(2), multAfter: +prestigeMultiplier(pr.state.prestige).toFixed(2),
        netProdAfter: +((after.idleRate / before.idleRate) * (prestigeMultiplier(pr.state.prestige) / prestigeMultiplier(st.prestige))).toFixed(3),
      };
    });
    // 7 天策略模拟（贪心 ROI；收入=挂机+团队+派遣，按画像折算）
    function quickRate(st: GameState) {
      const stationMult = stationIdleScaled(st) / Math.max(1e-9, stationIdleOf(st));
      const rawMult = prestigeMultiplier(st.prestige) * (1 + Math.min(0.2, 0.02 * Math.floor((st.collected.quotes.length + st.collected.flavors.length) / 5)));
      const talent = talentEffects(st.talents);
      const share = teamShareRatio(st);
      return { stationMult, rawMult, talent, share, stationOf: stationIdleOf(st) };
    }
    function purchase(st: GameState): { st: GameState; gain: number; cost: number } | null {
      const q = quickRate(st);
      const idleFactor = q.stationMult + q.rawMult * q.share * q.talent.teamIdleMult;
      let best: { st: GameState; gain: number; cost: number; score: number } | null = null;
      for (const u of UPGRADES) {
        if (u.clickPower) continue; // 该模拟假定点击党收益为 0
        const lv = st.levels[u.id] ?? 0;
        const price = costOf(u.id, lv);
        if (price > st.moyu) continue;
        const before = stationIdleOf(st);
        const after = stationIdleOf({ ...st, levels: { ...st.levels, [u.id]: lv + 1 } });
        const gain = (after - before) * idleFactor;
        const score = gain / price;
        if (!best || score > (best as any).score) best = { st: buyUpgrade(st, u.id)!, gain, cost: price, score };
      }
      for (const d of DECOR) {
        if (st.decor.includes(d.id) || d.cost > st.moyu) continue;
        const next = buyDecor(st, d.id)!;
        const gain = channels(next).idleRate - channels(st).idleRate;
        const score = gain / d.cost;
        if (!best || score > (best as any).score) best = { st: next, gain, cost: d.cost, score };
      }
      for (const def of COLLEAGUES) {
        const cur = st.team.colleagues[def.id];
        if (cur && cur.level >= MAX_COLLEAGUE_LEVEL) continue;
        const price = cur ? upgradeCostOf(def, cur.level) : def.cost;
        if (price > st.moyu) continue;
        const next = cur ? upgradeColleague(st, def.id)! : recruit(st, def.id)!;
        const gain = channels(next).idleRate - channels(st).idleRate + (channels(next).dispatchPerHour - channels(st).dispatchPerHour) / 3600;
        const score = gain / price;
        if (!best || score > (best as any).score) best = { st: next, gain, cost: price, score };
      }
      return best;
    }
    function simulate(policy: "never" | "asap" | "x2" | "x5", days = 7) {
      let st = withLevels({ phone: 1 }, { totalClicks: 300, prestige: 0, lifetimeEarned: 2e4, totalEarned: 2e4, moyu: 30 });
      let t = 0;
      const DT = 120;
      let prestiges = 0;
      let maxIdle = 0;
      while (t < days * DAY) {
        const daily = dailyBreakdown(st, P_IDLE);
        st = gain(st, (daily.total / DAY) * DT);
        maxIdle = Math.max(maxIdle, channels(st).idleRate);
        for (let i = 0; i < 3; i++) {
          const b = purchase(st);
          if (!b) break;
          st = b.st;
        }
        if (canPrestige(st)) {
          const k = policy === "never" ? Infinity : policy === "asap" ? 1 : policy === "x2" ? 2 : 5;
          if (k !== Infinity && st.totalEarned >= prestigeThreshold(st) * k) {
            const r = doPrestige(st);
            if (r) { st = r.state; prestiges++; }
          }
        }
        t += DT;
      }
      return { policy, lifetime: Math.round(st.lifetimeEarned), prestige: st.prestige, mult: +prestigeMultiplier(st.prestige).toFixed(2), prestiges, maxIdle: Math.round(maxIdle) };
    }
    const sims = (["never", "asap", "x2", "x5"] as const).map((p) => simulate(p, 7));
    writeFileSync(`${OUT_DIR}/prestige.json`, JSON.stringify({ mathRows, resetCost, sims, tuning: PRESTIGE_TUNING }, null, 2));
    console.log("[prestige] math:", JSON.stringify(mathRows));
    console.log("[prestige] reset:", resetCost.map((r: any) => `L${r.level}→${r.keptLevel}:idleRetain ${r.idleRetained} net ${r.netProdAfter}`).join(" | "));
    console.log("[prestige] sims:", JSON.stringify(sims));
  });

  it("8) 假选择清单验证", () => {
    const st = stateMid();
    const daily = (s: GameState) => dailyBreakdown(s, P_IDLE).total;
    const base = daily(st);
    const combo = daily(withEnergy(st, ["social", "fake-work", "slack"]));
    const subsets: any[] = [];
    const ids = ENERGY_ACTIONS.map((a) => a.id);
    for (let mask = 1; mask < 16; mask++) {
      const set = ids.filter((_, i) => mask & (1 << i));
      const cost = set.reduce((s, id) => s + ENERGY_ACTIONS.find((a) => a.id === id)!.cost, 0);
      if (cost > ENERGY_PER_DAY) continue;
      subsets.push({ set, cost, v: daily(withEnergy(st, set)) });
    }
    subsets.sort((a, b) => b.v - a.v);
    // 派遣：每个同事最优任务 vs 擅长任务
    const station = stationIdleScaled(st);
    const dispatchTable: unknown[] = [];
    for (const def of COLLEAGUES) {
      if (!st.team.colleagues[def.id]) continue;
      const rows = MISSIONS.map((m) => {
        const probe: GameState = { ...st, team: { colleagues: { ...st.team.colleagues, [def.id]: { ...st.team.colleagues[def.id]!, missionId: m.id } } } };
        const secs = missionSecondsFor(def.id, m.id);
        const reward = dispatchReward(probe, def.id, station);
        return { mission: m.name, secs, reward: Math.round(reward), perHour: Math.round((reward / secs) * 3600), skillMatch: def.skill === m.type };
      }).sort((a, b) => b.perHour - a.perHour);
      dispatchTable.push({ colleague: def.name, best: rows[0], skillMatchIsBest: rows[0].skillMatch, all: rows });
    }
    const arcadeShare: unknown[] = [];
    for (const [name, s] of Object.entries({ mid: stateMid(), late: stateLate() })) {
      const b = dailyBreakdown(s, P_IDLE);
      arcadeShare.push({ stage: name, arcadePerDay: Math.round(b.arcade), dailyTotal: Math.round(b.total), sharePct: +((b.arcade / b.total) * 100).toFixed(3) });
    }
    const noCard = dailyBreakdown(withCard(stateMid(), null), P_IDLE).total;
    const overtime = dailyBreakdown(withCard(stateMid(), "overtime"), P_IDLE).total;
    const c = channels(st);
    const out = {
      energy: {
        baseDaily: Math.round(base),
        comboGainPct: +((combo / base - 1) * 100).toFixed(2),
        bestSubset: subsets[0] ? { set: subsets[0].set, cost: subsets[0].cost, gainPct: +((subsets[0].v / base - 1) * 100).toFixed(2) } : null,
        comboRank: subsets.findIndex((x) => x.set.join(",") === "slack,fake-work,social") + 1,
        top3: subsets.slice(0, 3).map((x) => ({ set: x.set, cost: x.cost, gainPct: +((x.v / base - 1) * 100).toFixed(2) })),
      },
      dispatchTable,
      arcadeShare,
      riskCardOvertime: { noCard: Math.round(noCard), overtime: Math.round(overtime), gainPct: +((overtime / noCard - 1) * 100).toFixed(2) },
      autoRepeatCatchUp: { dispatchRound: Math.round(c.dispatchRound), note: "自动重复开启时，离线回来会补领 1 轮并续班；关闭则这轮要多等" },
      dailyAutoGoals: { autoGoalCount: 2, totalGoals: 3, note: "rollDaily 固定 2 个自动目标（visit/idle），无需任何操作即可 2/3" },
      talentRespec: { cost: 0, refund: "全部返还", note: "resetTalents 免费全额返还，无承诺成本" },
      decorStructure: { count: DECOR.length, slots: null, exclusivity: false, completionBonus: DECOR_COMPLETE_BONUS, maintenance: null },
    };
    writeFileSync(`${OUT_DIR}/false-choices.json`, JSON.stringify(out, null, 2));
    console.log("[false] energy:", JSON.stringify(out.energy));
    console.log("[false] dispatch:", JSON.stringify(dispatchTable.map((d: any) => `${d.colleague}→${d.best.mission}(${d.best.perHour}/h) 擅长最优=${d.skillMatchIsBest}`)));
    console.log("[false] arcade share:", JSON.stringify(arcadeShare), "overtime:", out.riskCardOvertime.gainPct + "%");
  });
});