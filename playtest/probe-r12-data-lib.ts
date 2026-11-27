/**
 * R12 数据党探针库（只读 src/，不改 src/）
 *
 * 目标：用引擎真函数（advance/doClick/offlineEarn/finishPatrol/recruit/dispatch/claimMission...）
 * 复算：回本时间、派遣 vs 挂机、三流派收益、面板一致性。
 */
import { initialState, type GameState } from "../src/engine/state";
import { doClick, buyUpgrade, clickPowerOf, comboCapOf } from "../src/engine/actions";
import { talentEffects } from "../src/engine/talents";
import {
  costOf,
  marginalEffect,
  effectOf,
  stationIdleScaled,
  UPGRADES,
} from "../src/engine/upgrades";
import { advance } from "../src/engine/tick";
import { offlineEarn } from "../src/engine/offline";
import { ensureVisits, offlineEfficiency } from "../src/engine/progression";
import { prestigeMultiplier } from "../src/engine/prestige";
import { newEventState, finishPatrol, onMemeTap } from "../src/engine/events";
import {
  COLLEAGUES,
  MISSIONS,
  AWAY_IDLE_FACTOR,
  recruit,
  upgradeColleague,
  dispatch,
  claimMission,
  missionDone,
  colleagueDef,
  missionDef,
  missionSecondsFor,
  dispatchReward,
  upgradeCostOf,
  MAX_COLLEAGUE_LEVEL,
  favorTier,
  teamFixedRate,
  teamShareRatio,
  claimableTotal,
} from "../src/engine/team";
import { TALENTS } from "../src/engine/talents";

export const DAY = 86400;
export const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

export const fmt = (x: number): string => {
  const a = Math.abs(x);
  if (a >= 1e12) return (x / 1e12).toFixed(2) + "e12";
  if (a >= 1e8) return (x / 1e8).toFixed(2) + "e8";
  if (a >= 1e4) return (x / 1e4).toFixed(2) + "万";
  return x.toFixed(0);
};
export const pct = (x: number): string => (x * 100).toFixed(1) + "%";
export const secs = (s: number): string => {
  if (!Number.isFinite(s)) return "∞";
  if (s >= DAY) return (s / DAY).toFixed(1) + "天";
  if (s >= 3600) return (s / 3600).toFixed(2) + "h";
  if (s >= 60) return (s / 60).toFixed(1) + "分";
  return s.toFixed(1) + "秒";
};

/** 当前全部倍率（转生×图鉴），口径解释用 */
export function multOf(state: GameState): number {
  const n = state.collected.quotes.length + state.collected.flavors.length;
  const collection = 1 + Math.min(0.2, 0.02 * Math.floor(n / 5));
  return prestigeMultiplier(state.prestige) * collection;
}

/** 直接点亮天赋（无视点数，模拟满点 build） */
export function withTalents(state: GameState, ids: string[]): GameState {
  let s = state;
  for (const id of ids) {
    s = { ...s, talents: { ...s.talents, unlocked: [...s.talents.unlocked, id], points: 0 } };
  }
  return s;
}
/** 该流派的线性天赋（tier 1-4，不含互斥终极） */
export function branchLinearIds(branch: "click" | "idle" | "event"): string[] {
  return TALENTS.filter((t) => t.branch === branch && t.tier < 5).map((t) => t.id);
}
/** 该流派两个互斥终极 id */
export function ultimateIds(branch: "click" | "idle" | "event"): string[] {
  return TALENTS.filter((t) => t.branch === branch && t.tier >= 5).map((t) => t.id);
}
/** 一条完整流派 = 4 线性 + 指定终极 */
export function branchBuild(branch: "click" | "idle" | "event", ult = 0): string[] {
  return [...branchLinearIds(branch), ultimateIds(branch)[ult]!];
}
export function allTalentIds(): string[] {
  return TALENTS.map((t) => t.id);
}
export function talentsOfTier(tiers: { branch: "click" | "idle" | "event"; tier: number }[]): string[] {
  return tiers.map(({ branch, tier }) => TALENTS.find((t) => t.branch === branch && t.tier === tier)!.id);
}

// ---------------------------------------------------------------------------
// 贪心购买（"最优玩家"：按 收益/价格 买；点击力按 cps 折算）
// ---------------------------------------------------------------------------

export function greedySpend(state: GameState, cps: number): GameState {
  let s = state;
  for (let guard = 0; guard < 10000; guard++) {
    let bestId: string | null = null;
    let bestScore = -1;
    for (const u of UPGRADES) {
      const lv = s.levels[u.id] ?? 0;
      const price = costOf(u.id, lv);
      if (price > s.moyu) continue;
      const m = marginalEffect(u.id, lv);
      const score = (m.idleRate + m.clickPower * cps) / price;
      // 纯挂机玩家不买点击升级（避免把点击力抬高后靠丢梗返利虚增收益）
      if (score <= 0) continue;
      if (score > bestScore) {
        bestScore = score;
        bestId = u.id;
      }
    }
    if (bestId === null) break;
    const next = buyUpgrade(s, bestId);
    if (!next) break;
    s = next;
  }
  return s;
}

// ---------------------------------------------------------------------------
// 会话模拟（真实引擎推进）
// ---------------------------------------------------------------------------

export interface SimOpts {
  days: number;
  /** 每日回访小时（本地 24h） */
  visitHours: number[];
  /** 每次在线秒数 */
  sessionSeconds: number;
  /** 每秒点击数（0 = 纯挂机） */
  cps: number;
  /** 小队策略：none 不招；recruit 买得起就招；full 招+升；smart 攒钱招（ROI 玩家） */
  team: "none" | "recruit" | "full" | "smart";
  /** smart 攒钱阈值：余额 ≥ ratio×下一个招募价时停买升级攒钱（默认 0.5） */
  teamSaveRatio?: number;
  /** 只招募表序前 N 个（默认全部） */
  recruitLimit?: number;
  /** 是否派遣（默认 true，用于归因） */
  dispatchEnabled?: boolean;
  /** 已点亮天赋 id */
  talents?: string[];
  /** 巡逻间隔秒（引擎窗口 90-150s 均值 120） */
  patrolEvery?: number;
  /** 丢梗间隔秒（引擎 45-75s 均值 60） */
  memeEvery?: number;
  /** 保存每天快照（默认 true；大批量对比可关） */
  snapshots?: boolean;
}

export interface SimDay {
  day: number;
  lifetime: number;
  balance: number;
  idleRate: number;
  station: number;
  teamIdle: number;
  cumClick: number;
  cumIdle: number;
  cumEvent: number;
  cumDispatch: number;
}

export interface SimResult {
  byDay: SimDay[];
  totals: { lifetime: number; click: number; idle: number; event: number; dispatch: number };
  final: {
    idleRate: number;
    station: number;
    teamIdle: number;
    clickPower: number;
    teamSize: number;
    totalClicks: number;
    patrolSurvives: number;
    favorTier: number;
    balance: number;
  };
  /** 每个同事"累计收入首次 ≥ 招募价"的时刻与当时工位挂机（保守：假设玩家攒钱不买升级） */
  firstAfford: Record<
    string,
    { atDay: number; station: number; cumIncome: number; upgradePayback: number; state: GameState | null }
  >;
  log: { recruits: string[]; upgrades: string[]; dispatches: number; claims: number };
  /** 一键领取显示值/实际到账 的最大倍率（快照 vs 现价的偏差） */
  claimMismatchMax: number;
  /** 期末状态（用于同一钱包下的 ROI 对照） */
  state: GameState;
}

/** 可稳定维持的连击数：3cps+ 每拍 0.33s 可一路连到上限；1cps 间隔≈1s 不涨连 */
function comboFor(cps: number, cap: number): number {
  if (cps >= 3) return cap;
  if (cps >= 2) return Math.min(12, cap);
  return 0;
}

/**
 * 会话模拟：每天若干次"离线 + 在线(点击/巡逻/丢梗/贪心购买/小队)"。
 * 引擎真函数：offlineEarn / advance / doClick / finishPatrol / onMemeTap / recruit / upgrade / dispatch / claimMission。
 */
export function simulate(o: SimOpts): SimResult {
  const patrolEvery = o.patrolEvery ?? 120;
  const memeEvery = o.memeEvery ?? 60;
  const visitHours = [...o.visitHours].sort((a, b) => a - b);
  let state = initialState();
  if (o.talents?.length) state = withTalents(state, o.talents);
  const log = { recruits: [] as string[], upgrades: [] as string[], dispatches: 0, claims: 0 };
  const firstAfford: SimResult["firstAfford"] = {};
  for (const def of COLLEAGUES)
    firstAfford[def.id] = { atDay: -1, station: 0, cumIncome: 0, upgradePayback: 0, state: null };
  const byDay: SimDay[] = [];
  const acc = { click: 0, idle: 0, event: 0, dispatch: 0 };
  let lifeBefore = 0;
  let lastAt = 0;
  const es = newEventState();
  let gameTime = 0;

  const checkAfford = (day: number): void => {
    const cum = state.lifetimeEarned;
    for (const def of COLLEAGUES) {
      const rec = firstAfford[def.id]!;
      if (rec.atDay >= 0) continue;
      if (cum >= def.cost) {
        rec.atDay = day;
        rec.station = stationIdleScaled(state);
        rec.cumIncome = cum;
        rec.upgradePayback = bestUpgradePayback(state).payback;
        rec.state = state;
      }
    }
  };

  /** smart 策略：快攒够下一个招募价时停买升级（模拟玩家"攒钱买同事"） */
  let saveTarget = 0;
  const updateSaveTarget = (): void => {
    if (o.team !== "smart") return;
    const limit = o.recruitLimit ?? COLLEAGUES.length;
    const nextDef = COLLEAGUES.slice(0, limit).find((d) => !state.team.colleagues[d.id]);
    saveTarget = nextDef ? nextDef.cost * (o.teamSaveRatio ?? 0.5) : 0;
  };
  const maybeSpend = (): void => {
    updateSaveTarget();
    if (o.team === "smart" && saveTarget > 0 && state.moyu >= saveTarget) return; // 攒钱中
    state = greedySpend(state, o.cps);
  };

  let claimMismatchMax = 1;
  const teamTick = (nowMs: number): void => {
    if (o.team === "none") return;
    // 面板"一键领取"总额 vs 实际（都应按快照求和，应为 1.00）
    {
      const station = stationIdleScaled(state);
      const panel = claimableTotal(state, nowMs, station); // 面板实际调用的函数（一次）
      let actual = 0;
      for (const def of COLLEAGUES) {
        if (!missionDone(state, def.id, nowMs)) continue;
        const cur = state.team.colleagues[def.id]!;
        actual += cur.rewardSnapshot > 0 ? cur.rewardSnapshot : dispatchReward(state, def.id, station);
      }
      if (actual > 0) claimMismatchMax = Math.max(claimMismatchMax, panel / actual);
    }
    for (const def of COLLEAGUES) {
      if (missionDone(state, def.id, nowMs)) {
        const r = claimMission(state, def.id, nowMs, stationIdleScaled(state));
        if (r) {
          state = r.state;
          acc.dispatch += r.reward;
          log.claims += 1;
        }
      }
    }
    const limit = o.recruitLimit ?? COLLEAGUES.length;
    for (const def of COLLEAGUES.slice(0, limit)) {
      if (state.team.colleagues[def.id]) continue;
      if (state.moyu < def.cost) continue;
      const next = recruit(state, def.id);
      if (next) {
        state = next;
        log.recruits.push(def.id);
      }
    }
    if (o.team === "full" || o.team === "smart") {
      for (const def of COLLEAGUES) {
        for (let guard = 0; guard < MAX_COLLEAGUE_LEVEL; guard++) {
          const cur = state.team.colleagues[def.id];
          if (!cur || cur.level >= MAX_COLLEAGUE_LEVEL) break;
          if (state.moyu < upgradeCostOf(def, cur.level)) break;
          const next = upgradeColleague(state, def.id);
          if (!next) break;
          state = next;
          log.upgrades.push(def.id);
        }
      }
    }
    if (o.dispatchEnabled === false) return;
    for (const def of COLLEAGUES) {
      const cur = state.team.colleagues[def.id];
      if (!cur || cur.missionId) continue;
      const m = bestMissionByHour(state, def.id);
      const next = dispatch(state, def.id, m.id, nowMs, stationIdleScaled(state));
      if (next) {
        state = next;
        log.dispatches += 1;
      }
    }
  };

  const dt = 5;
  for (let day = 0; day < o.days; day++) {
    for (const h of visitHours) {
      const nowMs = day * DAY_MS + h * 3600_000;
      const gap = (nowMs - lastAt) / 1000;
      state = ensureVisits(state, nowMs);
      if (gap > 0) {
        const rate = offlineEfficiency(state, 0, nowMs);
        const before = state.lifetimeEarned;
        state = offlineEarn(state, gap, rate).state;
        acc.idle += state.lifetimeEarned - before;
      }
      lastAt = nowMs;
      teamTick(nowMs);
      gameTime = 0;
      const combo = comboFor(o.cps, comboCapOf(state));
      for (let t = 0; t < o.sessionSeconds; t += dt) {
        gameTime += dt;
        if (o.cps > 0) {
          const n = Math.round(o.cps * dt);
          const before = state.lifetimeEarned;
          const critEvery = talentEffects(state.talents).critEvery;
          for (let i = 0; i < n; i++) {
            // click_4：每 N 次点击必暴击 ×5（与 main.ts 同口径：按即将累加的点击序号判定）
            const isCrit = critEvery > 0 && (state.totalClicks + 1) % critEvery === 0;
            state = doClick(state, combo, isCrit ? 5 : 1);
          }
          acc.click += state.lifetimeEarned - before;
        }
        if (gameTime % patrolEvery < dt) {
          es.surviveStreak = state.surviveStreak;
          es.bossVariant = "hold";
          es.bossCaught = false;
          const before = state.lifetimeEarned;
          const r = finishPatrol(state, es);
          state = r.state;
          acc.event += state.lifetimeEarned - before;
        }
        if (gameTime % memeEvery < dt) {
          es.memeUntil = gameTime + 5;
          const before = state.lifetimeEarned;
          const r = onMemeTap(state, es);
          state = r.state;
          acc.event += state.lifetimeEarned - before;
        }
        const beforeIdle = state.lifetimeEarned;
        state = advance(state, dt);
        acc.idle += state.lifetimeEarned - beforeIdle;
        maybeSpend();
        checkAfford(day);
      }
      maybeSpend();
      teamTick(nowMs);
      checkAfford(day);
      if (o.snapshots !== false) {
        lifeBefore = state.lifetimeEarned;
        const eff = effectOf(state);
        const station = stationIdleScaled(state);
        byDay.push({
          day,
          lifetime: lifeBefore,
          balance: state.moyu,
          idleRate: eff.idleRate,
          station,
          teamIdle: eff.idleRate - station,
          cumClick: acc.click,
          cumIdle: acc.idle,
          cumEvent: acc.event,
          cumDispatch: acc.dispatch,
        });
      }
    }
  }

  const eff = effectOf(state);
  const station = stationIdleScaled(state);
  return {
    byDay,
    totals: { lifetime: state.lifetimeEarned, ...acc },
    final: {
      idleRate: eff.idleRate,
      station,
      teamIdle: eff.idleRate - station,
      clickPower: clickPowerOf(state),
      teamSize: COLLEAGUES.filter((d) => state.team.colleagues[d.id]).length,
      totalClicks: state.totalClicks,
      patrolSurvives: state.patrolSurvives,
      favorTier: favorTier(state),
      balance: state.moyu,
    },
    firstAfford,
    log,
    state,
    claimMismatchMax,
  };
}

/** 该同事留岗时的挂机/秒（固定值×倍率×好感 + 工位×share） */
export function ownIdleRate(state: GameState, colleagueId: string, level?: number): number {
  const def = colleagueDef(colleagueId)!;
  const cur = state.team.colleagues[colleagueId];
  const lv = level ?? cur?.level ?? 1;
  const M = multOf(state);
  const favorIdleBonus = favorTier(state) >= 4 ? 1.1 : 1;
  return def.idlePerLevel * lv * M * favorIdleBonus + stationIdleScaled(state) * def.sharePerLevel * lv;
}

/** 派这一单的净收益（奖励 − 派遣在外损失的 50% 挂机），含任务时长 */
export function netDispatchProfit(state: GameState, colleagueId: string, missionId: string): number {
  const def = colleagueDef(colleagueId)!;
  const cur = state.team.colleagues[colleagueId];
  const m = missionDef(missionId)!;
  const probe: GameState = {
    ...state,
    team: { colleagues: { ...state.team.colleagues, [colleagueId]: { ...cur!, missionId } } },
  };
  const reward = dispatchReward(probe, colleagueId, stationIdleScaled(state));
  const loss = (1 - AWAY_IDLE_FACTOR) * ownIdleRate(state, colleagueId) * m.seconds;
  return reward - loss;
}

/** 派遣：按"净收益/小时"选最优任务（含 300 地板 + 50% 挂机代价） */
export function bestMissionByHour(state: GameState, colleagueId: string): (typeof MISSIONS)[number] {
  let best = MISSIONS[0]!;
  let bestRate = -Infinity;
  for (const m of MISSIONS) {
    const sec = missionSecondsFor(colleagueId, m.id);
    const rate = netDispatchProfit(state, colleagueId, m.id) / sec;
    if (rate > bestRate) {
      bestRate = rate;
      best = m;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 回本 / ROI 静态计算
// ---------------------------------------------------------------------------

/** 同事在岗挂机/秒（引擎口径：固定值×倍率×好感 + 工位 × share/级） */
export function colleagueIdleAt(state: GameState, id: string, level = 1): number {
  return ownIdleRate(state, id, level);
}

/** 招募回本秒数（按招募瞬间 engine 口径） */
export function recruitPaybackSeconds(state: GameState, id: string): number {
  return colleagueDef(id)!.cost / colleagueIdleAt(state, id, 1);
}

/** 同级升级回本秒数 */
export function upgradePaybackSeconds(state: GameState, id: string): number {
  const def = colleagueDef(id)!;
  const cur = state.team.colleagues[id];
  const lv = cur?.level ?? 1;
  if (lv >= MAX_COLLEAGUE_LEVEL) return Infinity;
  const price = upgradeCostOf(def, lv);
  const M = multOf(state);
  const station = stationIdleScaled(state);
  const gain = def.idlePerLevel * M + station * def.sharePerLevel;
  return price / Math.max(1e-9, gain);
}

/** "最便宜的下一次挂机升级"的回本秒数（对照组） */
export function bestUpgradePayback(state: GameState): {
  id: string;
  level: number;
  price: number;
  gain: number;
  payback: number;
} {
  let best = { id: "", level: 0, price: 0, gain: 0, payback: Infinity };
  const M = multOf(state);
  for (const u of UPGRADES) {
    if (!u.idleRate) continue;
    const lv = state.levels[u.id] ?? 0;
    const price = costOf(u.id, lv);
    const m = marginalEffect(u.id, lv);
    if (m.idleRate <= 0) continue;
    const gain = m.idleRate * M;
    const payback = price / gain;
    if (payback < best.payback) best = { id: u.id, level: lv, price, gain, payback };
  }
  return best;
}

/** 某个同事全套投入（招募 + 升满） */
export function fullCostOf(id: string): number {
  const def = colleagueDef(id)!;
  let sum = def.cost;
  for (let lv = 1; lv < MAX_COLLEAGUE_LEVEL; lv++) sum += upgradeCostOf(def, lv);
  return sum;
}

/**
 * 同一笔预算投升级的挂机增益（公平对照）：
 * 在给定 state 下，用 budget 贪心买"每秒增益/价格"最高的挂机升级，返回 Δ工位挂机/秒（未乘倍率→已乘 M）。
 */
export function idleGainForBudget(state: GameState, budget: number): { gain: number; spent: number; levels: number } {
  let s = state;
  let remain = budget;
  let levels = 0;
  for (let guard = 0; guard < 5000; guard++) {
    let bestId: string | null = null;
    let bestScore = -1;
    for (const u of UPGRADES) {
      if (!u.idleRate) continue;
      const lv = s.levels[u.id] ?? 0;
      const price = costOf(u.id, lv);
      if (price > remain) continue;
      const m = marginalEffect(u.id, lv);
      const score = m.idleRate / price;
      if (score > bestScore) {
        bestScore = score;
        bestId = u.id;
      }
    }
    if (bestId === null) break;
    const price = costOf(bestId, s.levels[bestId] ?? 0);
    const next = buyUpgrade(s, bestId);
    if (!next) break;
    remain -= price;
    s = next;
    levels += 1;
  }
  // stationIdleScaled 已乘倍率，差值即真实 Δ/秒
  return { gain: stationIdleScaled(s) - stationIdleScaled(state), spent: budget - remain, levels };
}

/** 派遣：单次奖励（含等级/好感/匹配/独特被动；不依赖 state.team） */
export function dispatchRewardOf(
  stationIdle: number,
  colleagueId: string,
  missionId: string,
  level: number,
  favor = 0,
): number {
  const def = colleagueDef(colleagueId)!;
  const m = missionDef(missionId)!;
  const base = Math.max(300, stationIdle * m.seconds * 0.011);
  const match = def.skill === m.type ? 1.5 : 1;
  const lvF = 1 + 0.5 * ((level - 1) / (MAX_COLLEAGUE_LEVEL - 1));
  const favorF = favor >= 100 ? 1.5 : 1;
  let traitMult = 1;
  if (def.trait === "短任务加成" && m.seconds <= 3600) traitMult += def.traitValue;
  if (def.trait === "长任务加成" && m.seconds >= 4 * 3600) traitMult += def.traitValue;
  return Math.floor(base * m.mult * match * lvF * favorF * traitMult);
}
