/**
 * 批次 1（同事派遣 + 天赋树）平衡探针公共库 —— 只读 src/，不改 src/。
 *
 * 关键点：src/engine/team.ts 的数值尚未定稿，本库自带一份可配置表，
 * 不把同事写进 state.team（避免和旧骨架数值耦合），只用引擎的
 * costOf / marginalEffect / effectOf / clickPowerOf / prestige 等纯函数。
 */
import { type GameState, initialState } from "../src/engine/state";
import { costOf, marginalEffect, effectOf, UPGRADES } from "../src/engine/upgrades";
import { clickPowerOf } from "../src/engine/actions";
import { prestigeGain, doPrestige, canPrestige, prestigeMultiplier } from "../src/engine/prestige";
import { rankFor, RANKS } from "../src/engine/titles";

export const DAY_S = 86400;

// ----------------------------- 同事 / 任务配置 -----------------------------

export type TaskType = "chat" | "meeting" | "toilet" | "errand" | "coffee";

export interface ColleagueCfg {
  id: string;
  name: string;
  skill: TaskType;
  cost: number;
  /** 每级固定挂机收益（吃转生/图鉴倍率） */
  idlePerLevel: number;
  /** 每级额外提供"工位挂机收益"的百分比（0.0008 = +0.08%/级） */
  sharePerLevel: number;
  /** 升级价 = cost × upgradeCoef × upgradeBase^level */
  upgradeCoef: number;
}

export interface MissionCfg {
  id: string;
  type: TaskType;
  seconds: number;
  mult: number;
}

export interface TeamCfg {
  colleagues: ColleagueCfg[];
  missions: MissionCfg[];
  maxLevel: number;
  upgradeBase: number; // 1.35
  matchBonus: number; // 0.5
  /** 派遣奖励 = max(floor, 基准挂机 × 秒 × coef) × 任务倍率 × 匹配加成 */
  dispatchCoef: number;
  dispatchFloor: number;
  /** 基准 = 基地挂机收益（不含同事） 或 该同事自身挂机收益 */
  dispatchBase: "workstation" | "total" | "own";
  /** 同事挂机收益进离线结算比例 */
  offlineTeamFactor: number;
  /** 派遣期间同事是否继续产出挂机收益 */
  idleWhileDispatched: boolean;
  /** 派遣奖励是否随同事等级放大（0 = 不放大；>0 = 1 + x×(lv-1)/49） */
  dispatchLevelFactor: number;
}

export const DRAFT_TEAM: TeamCfg = {
  colleagues: [
    { id: "zhou", name: "老周", skill: "chat" as TaskType, cost: 12000, idlePerLevel: 20, sharePerLevel: 0.008, upgradeCoef: 0.4 },
    { id: "mei", name: "小美", skill: "meeting" as TaskType, cost: 800000, idlePerLevel: 100, sharePerLevel: 0.008, upgradeCoef: 0.4 },
    { id: "qiang", name: "强哥", skill: "toilet" as TaskType, cost: 15000000, idlePerLevel: 200, sharePerLevel: 0.008, upgradeCoef: 0.4 },
    { id: "li", name: "小李", skill: "errand" as TaskType, cost: 300000000, idlePerLevel: 300, sharePerLevel: 0.008, upgradeCoef: 0.4 },
    { id: "wang", name: "王师傅", skill: "coffee" as TaskType, cost: 6000000000, idlePerLevel: 400, sharePerLevel: 0.008, upgradeCoef: 0.4 },
  ],
  missions: [
    { id: "quick", type: "errand" as TaskType, seconds: 15 * 60, mult: 1.2 },
    { id: "chat", type: "chat" as TaskType, seconds: 30 * 60, mult: 1.3 },
    { id: "meeting", type: "meeting" as TaskType, seconds: 60 * 60, mult: 1.6 },
    { id: "toilet", type: "toilet" as TaskType, seconds: 4 * 3600, mult: 2.2 },
    { id: "coffee", type: "coffee" as TaskType, seconds: 8 * 3600, mult: 2.8 },
  ],
  maxLevel: 5,
  upgradeBase: 1.35,
  matchBonus: 0.5,
  dispatchCoef: 0.011,
  dispatchFloor: 300,
  dispatchBase: "global",
  offlineTeamFactor: 0.5,
  idleWhileDispatched: true,
  dispatchLevelFactor: 0.5,
};

// ----------------------------- 天赋配置 -----------------------------

export interface TalentCfg {
  idleMult: number;
  offlineCapBonus: number;
  offlineBaseBonus: number;
  clickMult: number;
  comboMaxBonus: number;
  critChance: number;
  critMult: number;
  clickToIdlePer1k: number;
  clickToIdleCap: number;
  patrolRewardMult: number;
  penaltyReduction: number;
  memeRewardMult: number;
  patrolIntervalCut: number;
  patrolIdlePerPatrol: number;
  patrolIdleCap: number;
}

export const NO_TALENT: TalentCfg = {
  idleMult: 1, offlineCapBonus: 0, offlineBaseBonus: 0, clickMult: 1, comboMaxBonus: 0,
  critChance: 0, critMult: 1, clickToIdlePer1k: 0, clickToIdleCap: 0, patrolRewardMult: 1,
  penaltyReduction: 0, memeRewardMult: 1, patrolIntervalCut: 0, patrolIdlePerPatrol: 0, patrolIdleCap: 0,
};

export const DRAFT_IDLE_TALENT: TalentCfg = {
  ...NO_TALENT, idleMult: 2.0, offlineCapBonus: 4 * 3600, offlineBaseBonus: 0.1,
};
export const DRAFT_CLICK_TALENT: TalentCfg = {
  ...NO_TALENT, clickMult: 1.25, comboMaxBonus: 10, critChance: 0.05, critMult: 5,
};
export const DRAFT_EVENT_TALENT: TalentCfg = {
  ...NO_TALENT, patrolRewardMult: 1.5, penaltyReduction: 0.3, memeRewardMult: 2, patrolIntervalCut: 0.2,
};

// ----------------------------- 基础经济学 -----------------------------

/** "下一级 +1 挂机/秒"的价格（不含转生/图鉴倍率） */
export function upgradePayback(id: string, level: number): number {
  const c = costOf(id, level);
  const m = marginalEffect(id, level);
  return m.idleRate > 0 ? c / m.idleRate : Infinity;
}

export function upgradeTable(): string[] {
  const rows: string[] = [];
  const focus = ["phone", "toilet", "group", "meeting", "deep", "retire"];
  for (const lv of [0, 3, 5, 10, 15, 20, 25, 30, 40, 50]) {
    rows.push(
      `Lv${lv}: ` +
        focus
          .map((id) => {
            const p = upgradePayback(id, lv);
            return `${id}=${p === Infinity ? "inf" : p.toFixed(0)}s`;
          })
          .join(" "),
    );
  }
  return rows;
}

/** 不花钱的累计收入（点击 cps、底薪 idle 0.2/秒、无事件无日报） */
export function earnCurve(cps: number, seconds: number, dt = 1): { t: number; earned: number }[] {
  const s0 = initialState();
  let s: GameState = s0;
  const marks = new Set([30, 60, 120, 180, 240, 300, 360, 480, 600, 900, 1200, 1800, 2700, 3600]);
  const out: { t: number; earned: number }[] = [];
  let tapCredit = 0;
  for (let t = 0; t <= seconds; t += dt) {
    tapCredit += cps * dt;
    while (tapCredit >= 1) {
      tapCredit -= 1;
      const cp = clickPowerOf(s);
      s = { ...s, moyu: s.moyu + cp, totalEarned: s.totalEarned + cp, lifetimeEarned: s.lifetimeEarned + cp, totalClicks: s.totalClicks + 1 };
    }
    const r = effectOf(s).idleRate;
    s = { ...s, moyu: s.moyu + r * dt, totalEarned: s.totalEarned + r * dt, lifetimeEarned: s.lifetimeEarned + r * dt };
    if (marks.has(Math.round(t))) out.push({ t: Math.round(t), earned: s.lifetimeEarned });
  }
  return out;
}

// ----------------------------- 会话模拟 -----------------------------

export interface SimOpts {
  days: number;
  visitHours: number[];
  sessionSeconds: number;
  cps: number;
  recruit: boolean;
  dispatch: boolean;
  levelColleagues: boolean;
  team: TeamCfg;
  talent: TalentCfg;
  prestige: boolean;
  dailyClaim: boolean;
  events: boolean;
  /** 招人时的攒钱行为：none=不预留（有整笔钱就招）；save=够得着就预留 */
  reserveMode?: "none" | "save";
  seed?: number;
}

export interface SimResult {
  totals: { idleBase: number; teamIdle: number; dispatch: number; click: number; event: number; daily: number; total: number };
  byDay: {
    day: number; total: number; lifetime: number; idleRate: number; teamIdle: number; rank: string;
    prestige: number; levels: Record<string, number>; teamLevels: Record<string, number>;
  }[];
  prestiges: number;
  firstRecruitMinute: number | null;
  recruitTimes: Record<string, number>;
  rankTimes: Record<string, number>;
  final: {
    lifetime: number; totalEarned: number; idleRate: number; teamIdle: number; baseIdle: number;
    prestige: number; prestigeMult: number; levels: Record<string, number>; teamLevels: Record<string, number>;
    rank: string;
  };
}

function collMul(): number {
  return 1; // 图鉴：所有策略一致，探针按 0 格
}

/** 同事升级价 */
export function colleagueUpgradeCost(c: ColleagueCfg, level: number, cfg: TeamCfg): number {
  return Math.ceil(c.cost * c.upgradeCoef * cfg.upgradeBase ** level);
}

/** 某同事满级总投入（1 级招募 + 2..50 级升级） */
export function colleagueMaxCost(c: ColleagueCfg, cfg: TeamCfg): number {
  let sum = c.cost;
  for (let lv = 1; lv < cfg.maxLevel; lv++) sum += colleagueUpgradeCost(c, lv, cfg);
  return sum;
}

/** 派遣奖励 */
export function dispatchRewardOf(
  cfg: TeamCfg,
  colleague: ColleagueCfg,
  mission: MissionCfg,
  baseRate: number,
  ownIdle: number,
  level = 1,
): number {
  const base = cfg.dispatchBase === "own" ? ownIdle : baseRate;
  const match = colleague.skill === mission.type ? 1 + cfg.matchBonus : 1;
  const lvFactor = cfg.dispatchLevelFactor > 0 ? 1 + cfg.dispatchLevelFactor * ((level - 1) / (cfg.maxLevel - 1)) : 1;
  return Math.floor(Math.max(cfg.dispatchFloor, base * mission.seconds * cfg.dispatchCoef) * mission.mult * match * lvFactor);
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulate(o: SimOpts): SimResult {
  const dt = 1;
  const cfg = o.team;
  const tal = o.talent;
  const rng = mulberry(o.seed ?? 12345);
  let s: GameState = initialState();
  let teamLevels: Record<string, number> = {};
  let teamMission: Record<string, { missionId: string; endsAt: number } | null> = {};
  let patrolsSurvived = 0;
  let dispatchEarned = 0;
  let lastVisitMs: number | null = null;
  let streak = 0;
  let prestigeCount = 0;
  let sessionAbsSec = 0; // 当天会话起始的绝对秒
  let dayIdx = 0;

  const totals = { idleBase: 0, teamIdle: 0, dispatch: 0, click: 0, event: 0, daily: 0, total: 0 };
  const byDay: SimResult["byDay"] = [];
  const firstRecruit: { t: number | null } = { t: null };
  const recruitTimes: Record<string, number> = {};
  const rankTimes: Record<string, number> = {};

  const M = (): number => prestigeMultiplier(s.prestige);
  const coll = (): number => collMul();
  /** 基地挂机/秒（升级+底薪，含转生/图鉴；不含同事与天赋） */
  const baseIdle = (): number => effectOf({ ...s, team: { colleagues: {} } }).idleRate * coll();
  /** 同事挂机/秒（含转生/图鉴） */
  const teamIdleRaw = (): number => {
    let flat = 0;
    let share = 0;
    for (const c of cfg.colleagues) {
      const lv = teamLevels[c.id] ?? 0;
      flat += lv * c.idlePerLevel;
      share += lv * c.sharePerLevel;
    }
    return flat * M() * coll() + baseIdle() * share;
  };
  /** 单个同事的挂机收益 */
  const colleagueIdle = (c: ColleagueCfg): number => {
    const lv = teamLevels[c.id] ?? 0;
    return lv * c.idlePerLevel * M() * coll() + baseIdle() * lv * c.sharePerLevel;
  };
  const clickIdleBonus = (): number =>
    tal.clickToIdlePer1k > 0 ? 1 + Math.min(tal.clickToIdleCap, tal.clickToIdlePer1k * Math.floor(s.totalClicks / 1000)) : 1;
  const patrolIdleBonus = (): number =>
    tal.patrolIdlePerPatrol > 0 ? 1 + Math.min(tal.patrolIdleCap, tal.patrolIdlePerPatrol * patrolsSurvived) : 1;
  const idleTalent = (): number => tal.idleMult * clickIdleBonus() * patrolIdleBonus();
  /** 当前总挂机/秒（基地吃挂机天赋；同事只吃 idleMult，不吃点击/事件流转换） */
  const totalIdleRate = (): number => baseIdle() * idleTalent() + teamIdleRaw() * tal.idleMult;
  const comboMult = (): number => 1 + 0.012 * (20 + tal.comboMaxBonus);

  /** 离线结算：基地 + 同事×offlineFactor，均吃挂机天赋；封顶 12h+天赋 */
  function offlineEarn(seconds: number, efficiency: number): number {
    const applied = Math.max(0, Math.min(seconds, 12 * 3600 + tal.offlineCapBonus));
    const rate = (baseIdle() + teamIdleRaw() * cfg.offlineTeamFactor) * idleTalent();
    return rate * applied * efficiency;
  }

  /** 下一次回访前会完成的任务（选择奖励最高者；否则选最长任务） */
  function pickMission(nextGapSec: number): MissionCfg {
    const avail = cfg.missions.filter((m) => m.seconds <= nextGapSec);
    const pool = avail.length > 0 ? avail : cfg.missions;
    // 按"奖励/秒"与"可完成"综合：可完成的里选期望奖励最高的（直接用 disp 公式粗估按倍率）
    return [...pool].sort((a, b) => b.mult * b.seconds - a.mult * a.seconds)[0]!;
  }

  function nextColleagueDef(): ColleagueCfg | null {
    for (const c of cfg.colleagues) if (!teamLevels[c.id]) return c;
    return null;
  }

  function buy(nowAbsSec: number): void {
    const mult = M() * coll();
    const reserveDef = nextColleagueDef();
    // 玩家行为模型（可切换）：reserveMode = "none"：不预留，离线大额到账时顺手招；
    // "save"：价格 ≤ saveWithin×余额时攒钱（默认 off，模拟"理性不攒钱"对照）
    const reserve =
      o.reserveMode === "save" && reserveDef && reserveDef.cost <= Math.max(1, 2 * s.moyu) ? reserveDef.cost : 0;
    for (let guard = 0; guard < 400; guard++) {
      // 招募
      if (o.recruit && reserveDef && s.moyu >= reserveDef.cost) {
        s = { ...s, moyu: s.moyu - reserveDef.cost, totalEarned: s.totalEarned };
        teamLevels[reserveDef.id] = 1;
        recruitTimes[reserveDef.id] = nowAbsSec;
        if (firstRecruit.t === null) firstRecruit.t = nowAbsSec;
        break; // 招完一轮后回到买升级
      }
      type Cand = { kind: "up"; id: string; cost: number; gain: number } | { kind: "team"; id: string; cost: number; gain: number };
      const cands: Cand[] = [];
      for (const u of UPGRADES) {
        const lv = s.levels[u.id] ?? 0;
        const c = costOf(u.id, lv);
        const m = marginalEffect(u.id, lv);
        const clickGain = o.cps > 0 ? m.clickPower * mult * o.cps * comboMult() * tal.clickMult : 0;
        const gain = (m.idleRate * mult + clickGain) * idleTalent();
        if (gain > 0) cands.push({ kind: "up", id: u.id, cost: c, gain });
      }
      if (o.recruit && o.levelColleagues) {
        for (const c of cfg.colleagues) {
          const lv = teamLevels[c.id] ?? 0;
          if (lv === 0 || lv >= cfg.maxLevel) continue;
          const cost = colleagueUpgradeCost(c, lv, cfg);
          const gain = c.idlePerLevel * M() * coll() * tal.idleMult;
          cands.push({ kind: "team", id: c.id, cost, gain });
        }
      }
      const budget = Math.max(0, s.moyu - reserve);
      const affordable = cands.filter((c) => c.cost <= budget);
      affordable.sort((a, b) => b.gain / b.cost - a.gain / a.cost);
      const best = affordable[0];
      if (!best) break;
      s = { ...s, moyu: s.moyu - best.cost };
      if (best.kind === "up") s.levels = { ...s.levels, [best.id]: (s.levels[best.id] ?? 0) + 1 };
      else teamLevels[best.id] = (teamLevels[best.id] ?? 0) + 1;
    }
  }

  for (dayIdx = 0; dayIdx < o.days; dayIdx++) {
    let dayTotal = 0;
    for (let vi = 0; vi < o.visitHours.length; vi++) {
      const h = o.visitHours[vi]!;
      const nowMs = dayIdx * DAY_S * 1000 + h * 3600 * 1000;
      const nowSec = nowMs / 1000;
      // 离线结算
      if (lastVisitMs !== null) {
        const gap = Math.max(0, (nowMs - lastVisitMs) / 1000);
        if (gap > 60) {
          const visitsToday = 1; // ensureVisits 后 count 含本次
          const eff = Math.min(1, 0.7 + tal.offlineBaseBonus + 0.1 * Math.min(visitsToday + 0, 3) + Math.min(0.15, 0.05 * Math.floor(streak / 7)));
          const earned = offlineEarn(gap, eff);
          if (earned > 0) { s = gain(s, earned); totals.idleBase += earned; dayTotal += earned; }
        }
      }
      // 领取已完成的派遣
      if (o.recruit && o.dispatch) {
        for (const c of cfg.colleagues) {
          const lv = teamLevels[c.id];
          if (!lv) continue;
          const m = teamMission[c.id];
          if (m && nowMs >= m.endsAt) {
            const mission = cfg.missions.find((x) => x.id === m.missionId)!;
            const own = colleagueIdle(c);
            const baseRate = cfg.dispatchBase === "total" ? totalIdleRate() : baseIdle();
            const reward = dispatchRewardOf(cfg, c, mission, baseRate, own, lv);
            s = gain(s, reward); totals.dispatch += reward; dayTotal += reward; dispatchEarned += reward;
            teamMission[c.id] = null;
          }
        }
      }
      // 在线会话
      let tapCredit = 0;
      for (let t = 0; t < o.sessionSeconds; t += dt) {
        if (o.cps > 0) {
          tapCredit += o.cps * dt;
          while (tapCredit >= 1) {
            tapCredit -= 1;
            const crit = tal.critChance > 0 && rng() < tal.critChance;
            const cp = clickPowerOf(s) * tal.clickMult * (crit ? tal.critMult : 1);
            const income = cp * comboMult();
            s = gain(s, income);
            totals.click += income; dayTotal += income;
            s = { ...s, totalClicks: s.totalClicks + 1 };
          }
        }
        const rate = totalIdleRate();
        s = gain(s, rate * dt);
        totals.idleBase += rate * dt; dayTotal += rate * dt;
        totals.teamIdle += teamIdleRaw() * tal.idleMult * dt; // 信息项（已含在 idleBase 统计里）
        if (t > 0 && t % 5 === 0) buy(nowSec + t);
        if (o.events) {
          const interval = 120 * (1 - tal.patrolIntervalCut) + 8;
          const idleNow = totalIdleRate();
          const patrolEv = (4 * idleNow * 1.35 * tal.patrolRewardMult) / interval;
          const cpNow = clickPowerOf(s) * tal.clickMult;
          const memeEv = (5 * cpNow * tal.memeRewardMult) / (60 * (1 - tal.patrolIntervalCut));
          const evRate = patrolEv + memeEv;
          s = gain(s, evRate * dt); totals.event += evRate * dt; dayTotal += evRate * dt;
          if (tal.patrolIdlePerPatrol > 0) patrolsSurvived += (0.75 * dt) / interval;
        }
      }
      // 会话末购买
      buy(nowSec + o.sessionSeconds);
      // 日报
      if (o.dailyClaim && vi === o.visitHours.length - 1) {
        const reward = Math.max(500, 600 * baseIdle());
        s = gain(s, reward); totals.daily += reward; dayTotal += reward;
      }
      // 派新任务（按到下次回访的间隔选任务）
      if (o.recruit && o.dispatch) {
        const nextGap =
          vi === o.visitHours.length - 1
            ? (24 - h + o.visitHours[0]!) * 3600
            : (o.visitHours[vi + 1]! - h) * 3600;
        for (const c of cfg.colleagues) {
          const lv = teamLevels[c.id];
          if (!lv || teamMission[c.id]) continue;
          const mission = pickMission(nextGap);
          teamMission[c.id] = { missionId: mission.id, endsAt: nowMs + mission.seconds * 1000 };
        }
      }
      // 转生（能转就转：每次回访检查）
      if (o.prestige && canPrestige(s) && prestigeGain(s) >= 1) {
        const r = doPrestige(s);
        if (r) {
          s = r.state;
          prestigeCount++;
          rankTimes[`prestige_${prestigeCount}`] = (nowSec + o.sessionSeconds) / 60 - 540;
        }
      }
      // 段位到达时刻（首次打开后分钟数；首访 9:00 → 0 起算）
      const gameMin = (nowSec + o.sessionSeconds) / 60 - 540;
      for (const rank of RANKS) {
        if (s.lifetimeEarned >= rank.at && rankTimes[rank.name] === undefined) rankTimes[rank.name] = gameMin;
      }
      lastVisitMs = nowMs;
    }
    const rk = rankFor(s.lifetimeEarned);
    if (!(rk.current.name in rankTimes)) rankTimes[rk.current] = dayIdx * 1440 + 1439;
    byDay.push({
      day: dayIdx + 1, total: dayTotal, lifetime: s.lifetimeEarned,
      idleRate: totalIdleRate(), teamIdle: teamIdleRaw() * tal.idleMult, rank: rk.current,
      prestige: s.prestige, levels: { ...s.levels }, teamLevels: { ...teamLevels },
    });
    if (o.dailyClaim) streak += 1;
  }

  totals.total = totals.idleBase + totals.click + totals.event + totals.daily + totals.dispatch;
  return {
    totals,
    byDay,
    prestiges: prestigeCount,
    firstRecruitMinute: firstRecruit.t === null ? null : firstRecruit.t / 60,
    recruitTimes,
    rankTimes,
    final: {
      lifetime: s.lifetimeEarned, totalEarned: s.totalEarned,
      idleRate: totalIdleRate(), teamIdle: teamIdleRaw() * tal.idleMult, baseIdle: baseIdle(),
      prestige: s.prestige, prestigeMult: M(), levels: { ...s.levels }, teamLevels: { ...teamLevels },
      rank: rankFor(s.lifetimeEarned).current,
    },
  };
}

function gain(s: GameState, amount: number): GameState {
  if (amount <= 0) return s;
  return { ...s, moyu: s.moyu + amount, totalEarned: s.totalEarned + amount, lifetimeEarned: s.lifetimeEarned + amount };
}

// ----------------------------- B1 决策版天赋常量 -----------------------------

/** 点击流满级（5 点）：点击 ×1.65，挂机转化封顶 +30% */
export const TAL_CLICK: TalentCfg = {
  ...NO_TALENT,
  clickMult: 1.25,
  comboMaxBonus: 10,
  critChance: 0.05,
  critMult: 5,
  clickToIdlePer1k: 1 / 30, // 每 300 次累计点击 → 挂机 +1%
  clickToIdleCap: 0.35,
};
/** 挂机流满级（5 点）：挂机 +45%、离线封顶 +4h、离线基础效率 +0.10 */
export const TAL_IDLE: TalentCfg = {
  ...NO_TALENT,
  idleMult: 1.15,
  offlineCapBonus: 2 * 3600,
  offlineBaseBonus: 0.05,
};
/** 事件流满级（5 点）：事件小加成 + 每 200 次安然巡逻挂机 +1%（封顶 +30%） */
export const TAL_EVENT: TalentCfg = {
  ...NO_TALENT,
  patrolRewardMult: 1.15,
  penaltyReduction: 0.35,
  memeRewardMult: 1.1,
  patrolIntervalCut: 0,
  patrolIdlePerPatrol: 0.01, // 每次安然巡逻 → 挂机 +1%
  patrolIdleCap: 0.3,
};
