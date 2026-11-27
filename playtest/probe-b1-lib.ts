/**
 * 批次 1（同事派遣 + 天赋树）平衡探针公共库 —— 只读 src/，不改 src/。
 *
 * 提供：
 *  - 升级性价比表 / 早期累计收入曲线（用来定"首个同事何时能招"）
 *  - 24h×N 天"3 次回访"会话模拟（离线结算 + 在线点击 + 贪心 ROI 购买 + 可选转生）
 *  - 同事招募/升级/派遣（数值全部由本库入参决定，方便做扫描）
 *  - 天赋加成（参数化，直接按最终建议数值注入）
 *
 * 说明：src 的 COLLEAGUES / DISPATCH 数值尚未定稿，本库自带一份可配置表；
 * 不把同事写进 state.team，避免和 src 的旧骨架数值耦合。
 */
import { type GameState, initialState, gain } from "../src/engine/state";
import { costOf, marginalEffect, effectOf, UPGRADES } from "../src/engine/upgrades";
import { doClick, clickPowerOf, comboMultiplier } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { prestigeGain, doPrestige, canPrestige, prestigeMultiplier } from "../src/engine/prestige";
import { ensureVisits, offlineEfficiency } from "../src/engine/progression";
import { rankFor } from "../src/engine/titles";

export const DAY_S = 86400;

// ----------------------------- 同事 / 任务配置 -----------------------------

export type TaskType = "chat" | "meeting" | "toilet" | "errand" | "coffee";

export interface ColleagueCfg {
  id: string;
  name: string;
  skill: TaskType;
  cost: number;
  idlePerLevel: number;
  /** 升级价 = cost × upgradeCoef × coefBase^level */
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
  /** 任务奖励：基数 = max(floor, baseIdle × seconds × coef) */
  dispatchCoef: number;
  dispatchFloor: number;
  /** 基数用"基地挂机收益（不含同事）"还是"同事自身挂机收益" */
  dispatchBase: "global" | "own";
  /** 同事挂机收益进离线结算的比例：0 / 0.5 / 1 */
  offlineTeamFactor: number;
}

// 草案表（用于对照，最后会被决策表替换）
export const DRAFT_TEAM: TeamCfg = {
  colleagues: [
    { id: "zhou", name: "老周", skill: "chat", cost: 150, idlePerLevel: 0.5, upgradeCoef: 0.4 },
    { id: "mei", name: "小美", skill: "meeting", cost: 1500, idlePerLevel: 2, upgradeCoef: 0.4 },
    { id: "qiang", name: "强哥", skill: "toilet", cost: 15000, idlePerLevel: 10, upgradeCoef: 0.4 },
    { id: "li", name: "小李", skill: "errand", cost: 120000, idlePerLevel: 50, upgradeCoef: 0.4 },
    { id: "wang", name: "王师傅", skill: "coffee", cost: 800000, idlePerLevel: 250, upgradeCoef: 0.4 },
  ],
  missions: [
    { id: "quick", type: "errand", seconds: 15 * 60, mult: 1.2 },
    { id: "chat", type: "chat", seconds: 30 * 60, mult: 1.3 },
    { id: "meeting", type: "meeting", seconds: 60 * 60, mult: 1.6 },
    { id: "toilet", type: "toilet", seconds: 4 * 3600, mult: 2.2 },
    { id: "coffee", type: "coffee", seconds: 8 * 3600, mult: 2.8 },
  ],
  maxLevel: 50,
  upgradeBase: 1.35,
  matchBonus: 0.5,
  dispatchCoef: 0.15,
  dispatchFloor: 500,
  dispatchBase: "global",
  offlineTeamFactor: 0.5,
};

/** 决策版（B1 最终建议）由 probe 内注入，见 DECIDED_TEAM */

// ----------------------------- 天赋配置 -----------------------------

export interface TalentCfg {
  /** 挂机收益倍率（idle_1/3/5 合计） */
  idleMult: number;
  /** 离线封顶加成（秒） */
  offlineCapBonus: number;
  /** 离线基础效率加成（0.7 → 0.7+x） */
  offlineBaseBonus: number;
  /** 点击力倍率 */
  clickMult: number;
  /** 连击窗口加成（秒） */
  comboWindowBonus: number;
  /** 连击上限加成 */
  comboMaxBonus: number;
  /** 暴击概率 / 倍率 */
  critChance: number;
  critMult: number;
  /** 每 1000 累计点击 → 挂机收益 +x（封顶 clickToIdleCap） */
  clickToIdlePer1k: number;
  clickToIdleCap: number;
  /** 巡逻奖励倍率 */
  patrolRewardMult: number;
  /** 偷点罚款减免 */
  penaltyReduction: number;
  /** 丢梗奖励倍率 */
  memeRewardMult: number;
  /** 巡逻间隔缩短比例 */
  patrolIntervalCut: number;
  /** 每次安然巡逻 → 挂机收益 +x（封顶 patrolIdleCap） */
  patrolIdlePerPatrol: number;
  patrolIdleCap: number;
}

export const NO_TALENT: TalentCfg = {
  idleMult: 1,
  offlineCapBonus: 0,
  offlineBaseBonus: 0,
  clickMult: 1,
  comboWindowBonus: 0,
  comboMaxBonus: 0,
  critChance: 0,
  critMult: 1,
  clickToIdlePer1k: 0,
  clickToIdleCap: 0,
  patrolRewardMult: 1,
  penaltyReduction: 0,
  memeRewardMult: 1,
  patrolIntervalCut: 0,
  patrolIdlePerPatrol: 0,
  patrolIdleCap: 0,
};

/** 点击流满级（草案效果，便于对照） */
export const CLICK_TALENT: TalentCfg = {
  ...NO_TALENT,
  clickMult: 1.25,
  comboWindowBonus: 0.1,
  comboMaxBonus: 10,
  critChance: 0.05,
  critMult: 5,
  clickToIdlePer1k: 0.01,
  clickToIdleCap: 0.4,
};
/** 挂机流满级（草案效果） */
export const IDLE_TALENT: TalentCfg = {
  ...NO_TALENT,
  idleMult: 2.0,
  offlineCapBonus: 4 * 3600,
  offlineBaseBonus: 0.1,
};
/** 事件流满级（草案效果） */
export const EVENT_TALENT: TalentCfg = {
  ...NO_TALENT,
  patrolRewardMult: 1.5,
  penaltyReduction: 0.3,
  memeRewardMult: 2,
  patrolIntervalCut: 0.2,
};

// ----------------------------- 早期曲线 / 性价比 -----------------------------

/** 离线状态下"下一级 +1 挂机/秒"的价格（不含转生/图鉴倍率） */
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

/** 不花钱的累计收入曲线（点击 cps、底薪 idle0.2、无事件无日报） */
export function earnCurve(cps: number, seconds: number, dt = 1): { t: number; earned: number }[] {
  let s = initialState();
  const marks = [30, 60, 120, 180, 300, 480, 600, 900, 1200, 1800, 2700, 3600, 7200, 14400, 28800];
  const out: { t: number; earned: number }[] = [];
  let tapCredit = 0;
  for (let t = 0; t <= seconds; t += dt) {
    tapCredit += cps * dt;
    while (tapCredit >= 1) {
      tapCredit -= 1;
      s = doClick(s);
    }
    s = advance(s, dt);
    if (marks.includes(Math.round(t))) out.push({ t: Math.round(t), earned: s.lifetimeEarned });
  }
  return out;
}

// ----------------------------- 会话模拟 -----------------------------

export interface SimOpts {
  days: number;
  /** 每天回访时刻（小时） */
  visitHours: number[];
  /** 每次会话在线秒数 */
  sessionSeconds: number;
  cps: number;
  /** 是否招募同事（否则完全无小队） */
  recruit: boolean;
  /** 是否派遣 */
  dispatch: boolean;
  /** 是否升级同事（ROI 与升级竞争） */
  levelColleagues: boolean;
  team: TeamCfg;
  talent: TalentCfg;
  /** 是否允许转生（能转就转） */
  prestige: boolean;
  /** 每日日报领取假设：true=每天领 1 次 */
  dailyClaim: boolean;
  /** 事件经济（在线时）：按期望折算，倍率含天赋 */
  events: boolean;
}

export interface SimResult {
  totals: {
    idle: number; // 基础挂机（含离线）
    teamIdle: number; // 同事挂机
    dispatch: number; // 派遣奖励
    click: number; // 点击收入
    event: number; // 巡逻+丢梗
    daily: number;
    total: number;
  };
  byDay: { day: number; total: number; lifetime: number; idleRate: number; teamIdle: number; rank: string; prestige: number; levels: Record<string, number>; teamLevels: Record<string, number> }[];
  prestiges: number;
  patrolCount: number;
  firstRecruitMinute: number | null;
  rankTimes: Record<string, number>; // 首次到达段位名的时间（分钟）
  final: { lifetime: number; totalEarned: number; idleRate: number; teamIdle: number; prestige: number; prestigeMult: number; levels: Record<string, number>; teamLevels: Record<string, number> };
}

function collMulFor(_state: GameState): number {
  // 图鉴加成：探针按 0 格算（所有策略一致，不影响相对结论）
  return 1;
}

function teamIdleOf(teamLevels: Record<string, number>, cfg: TeamCfg, M: number): number {
  let sum = 0;
  for (const c of cfg.colleagues) sum += (teamLevels[c.id] ?? 0) * c.idlePerLevel;
  return sum * M;
}

/** 同事升级价 */
export function colleagueUpgradeCost(c: ColleagueCfg, level: number, cfg: TeamCfg): number {
  return Math.ceil(c.cost * c.upgradeCoef * cfg.upgradeBase ** level);
}

/** 派遣奖励（base=当前基地挂机收益 或 该同事自身挂机收益） */
export function dispatchRewardOf(
  cfg: TeamCfg,
  colleague: ColleagueCfg,
  mission: MissionCfg,
  baseIdle: number,
  ownIdle: number,
): number {
  const base = cfg.dispatchBase === "own" ? ownIdle : baseIdle;
  const match = colleague.skill === mission.type ? 1 + cfg.matchBonus : 1;
  return Math.floor(Math.max(cfg.dispatchFloor, base * mission.seconds * cfg.dispatchCoef) * mission.mult * match);
}

export function simulate(o: SimOpts): SimResult {
  const dt = 1;
  const cfg = o.team;
  const tal = o.talent;
  let s: GameState = initialState();
  let teamLevels: Record<string, number> = {};
  let teamMission: Record<string, { missionId: string; endsAt: number } | null> = {};
  let patrolsSurvived = 0;
  let patrolCount = 0;
  let dispatchBusySeconds = 0;

  const totals = { idle: 0, teamIdle: 0, dispatch: 0, click: 0, event: 0, daily: 0, total: 0 };
  const byDay: SimResult["byDay"] = [];
  const firstRecruit: { t: number | null } = { t: null };
  const rankTimes: Record<string, number> = {};
  const visitedDays = new Set<number>();
  let streak = 0;
  let prestigeCount = 0;
  let day = 0;
  let dailyClaimed = 0;

  const M = (): number => prestigeMultiplier(s.prestige);
  const collectionBonus = (): number => collMulFor(s);

  /** 基地挂机收益（升级，不含同事；含转生/图鉴倍率） */
  const baseIdle = (): number => effectOf({ ...s, team: { colleagues: {} } }).idleRate * collectionBonus();
  /** 同事挂机收益（含转生/图鉴倍率） */
  const teamIdle = (): number => teamIdleOf(teamLevels, cfg, M() * collectionBonus());
  /** 挂机收益总倍率（天赋） */
  const idleTalentMult = (): number => tal.idleMult * clickIdleBonus() * patrolIdleBonus();
  function clickIdleBonus(): number {
    if (tal.clickToIdlePer1k <= 0) return 1;
    return 1 + Math.min(tal.clickToIdleCap, tal.clickToIdlePer1k * Math.floor(s.totalClicks / 1000));
  }
  function patrolIdleBonus(): number {
    if (tal.patrolIdlePerPatrol <= 0) return 1;
    return 1 + Math.min(tal.patrolIdleCap, tal.patrolIdlePerPatrol * patrolsSurvived);
  }
  /** 当前总挂机/秒（同事 × 天赋同理） */
  const totalIdle = (): number => (baseIdle() + teamIdle() * 0) * 1 + (baseIdle() + teamIdle()) * 0 + baseIdle() * idleTalentMult() + teamIdle() * tal.idleMult;

  /** 离线结算：基地 + 同事×offlineFactor，均吃 idle 天赋倍率；离线效率另算 */
  function offlineEarnCustom(seconds: number, efficiency: number, capBonus: number): number {
    const cap = Math.min(seconds, 12 * 3600 + capBonus);
    const applied = Math.max(0, Math.min(seconds, cap));
    const rate = (baseIdle() + teamIdle() * cfg.offlineTeamFactor) * idleTalentMult();
    return rate * applied * efficiency;
  }

  /** 购买（贪心 ROI：idle / click / 同事升级；同事招募按策略优先） */
  function buy(): void {
    const mult = collectionBonus() * M();
    for (let guard = 0; guard < 500; guard++) {
      const base = baseIdle();
      type Cand = { kind: "up"; id: string; cost: number; gain: number } | { kind: "team"; id: string; cost: number; gain: number };
      const cands: Cand[] = [];
      for (const u of UPGRADES) {
        const lv = s.levels[u.id] ?? 0;
        const c = costOf(u.id, lv);
        const m = marginalEffect(u.id, lv);
        const gain = (m.idleRate * mult + (o.cps > 0 ? m.clickPower * mult * o.cps * comboValue() : 0)) * idleTalentMult();
        if (gain > 0) cands.push({ kind: "up", id: u.id, cost: c, gain });
      }
      if (o.recruit) {
        for (const c of cfg.colleagues) {
          const lv = teamLevels[c.id] ?? 0;
          if (lv === 0) continue; // 招募单独处理
          if (lv >= cfg.maxLevel) continue;
          const cost = colleagueUpgradeCost(c, lv, cfg);
          const gain = c.idlePerLevel * M() * collectionBonus() * tal.idleMult;
          cands.push({ kind: "team", id: c.id, cost, gain });
        }
      }
      // 招募优先（新手能招就招）
      if (o.recruit) {
        for (const c of cfg.colleagues) {
          if (teamLevels[c.id]) continue;
          if (s.moyu >= c.cost) {
            s = { ...s, moyu: s.moyu - c.cost };
            teamLevels[c.id] = 1;
            if (firstRecruit.t === null) firstRecruit.t = day * 86400 + visitHour * 3600 + sessionElapsed;
          }
          break; // 只按顺序招一个
        }
      }
      const affordable = cands.filter((c) => c.cost <= s.moyu);
      affordable.sort((a, b) => b.gain / b.cost - a.gain / a.cost);
      const best = affordable[0];
      if (!best) break;
      s = { ...s, moyu: s.moyu - best.cost };
      if (best.kind === "up") s.levels = { ...s.levels, [best.id]: (s.levels[best.id] ?? 0) + 1 };
      else teamLevels[best.id] = (teamLevels[best.id] ?? 0) + 1;
    }
    // 钱不够任何东西时也尝试攒钱招下一个同事（保留余额由下方策略处理，这里不做）
  }

  let comboValue = (): number => 1.24;

  function comboValueForTal(): number {
    const max = 20 + tal.comboMaxBonus;
    return 1 + 0.012 * max; // 稳定连击取上限
  }
  comboValue = comboValueForTal;

  let visitHour = 0;
  let sessionElapsed = 0;

  for (day = 0; day < o.days; day++) {
    let dayTotal = 0;
    for (const h of o.visitHours) {
      visitHour = h;
      const nowMs = day * DAY_S * 1000 + h * 3600 * 1000;
      // 回访记录 + 离线结算
      s = ensureVisits(s, nowMs);
      const gap = day === 0 && h === o.visitHours[0] ? 0 : lastVisitMs === null ? 0 : (nowMs - lastVisitMs) / 1000;
      if (gap > 60 && day > 0) {
        const eff = Math.min(1, offlineEffBase() + 0.1 * Math.min(s.visits.count, 3) + streakBonus());
        const earned = offlineEarnCustom(gap, eff, tal.offlineCapBonus);
        if (earned > 0) {
          s = gain(s, earned);
          totals.idle += earned;
          dayTotal += earned;
        }
      }
      // 同事任务完成领取（到点即领）
      if (o.recruit && o.dispatch) {
        for (const c of cfg.colleagues) {
          const lv = teamLevels[c.id];
          if (!lv) continue;
          const m = teamMission[c.id];
          if (m && nowMs >= m.endsAt) {
            const mission = cfg.missions.find((x) => x.id === m.missionId)!;
            const base = baseIdle();
            const own = c.idlePerLevel * lv * M() * collectionBonus();
            const reward = dispatchRewardOf(cfg, c, mission, base, own);
            s = gain(s, reward);
            totals.dispatch += reward;
            dayTotal += reward;
            teamMission[c.id] = null;
          }
        }
      }
      // 在线会话
      sessionElapsed = 0;
      let tapCredit = 0;
      for (let t = 0; t < o.sessionSeconds; t += dt) {
        sessionElapsed = t;
        // 点击
        if (o.cps > 0) {
          tapCredit += o.cps * dt;
          while (tapCredit >= 1) {
            tapCredit -= 1;
            const crit = tal.critChance > 0 && Math.random() < tal.critChance;
            const cp = clickPowerOf(s) * tal.clickMult * (crit ? tal.critMult : 1);
            const income = cp * comboMultiplier(s.totalClicks % 2 === 0 ? 20 + tal.comboMaxBonus : 0);
            const before = s.lifetimeEarned;
            s = { ...s, moyu: s.moyu + income, totalEarned: s.totalEarned + income, lifetimeEarned: s.lifetimeEarned + income, totalClicks: s.totalClicks + 1 };
            totals.click += s.lifetimeEarned - before;
            dayTotal += s.lifetimeEarned - before;
          }
        }
        // 挂机（基地+同事）
        const rate = baseIdle() * idleTalentMult() + teamIdle() * tal.idleMult;
        s = gain(s, rate * dt);
        totals.idle += rate * dt;
        dayTotal += rate * dt;
        // 同事挂机单独统计
        const tRate = teamIdle() * tal.idleMult;
        totals.teamIdle += tRate * dt;
        dayTotal += 0; // 已在 idle 里
        // 事件期望（在线时才发生）：每 128s 一次巡逻，奖励 ≈ max(50,4*idle)*1.35*patrolRewardMult*（变体成功率）
        if (o.events) {
          const interval = 120 * (1 - tal.patrolIntervalCut) + 8;
          const idleNow = baseIdle() * idleTalentMult() + teamIdle() * tal.idleMult;
          const patrolEv = (4 * idleNow * 1.35 * tal.patrolRewardMult) / interval;
          const cp = clickPowerOf(s) * tal.clickMult;
          const memeEv = (5 * cp * tal.memeRewardMult) / (60 * (1 - tal.patrolIntervalCut));
          const evRate = patrolEv + memeEv;
          s = gain(s, evRate * dt);
          totals.event += evRate * dt;
          dayTotal += evRate * dt;
          // 安然次数（按成功率折算，用于事件流 Lv5 永久加成）
          if (tal.patrolIdlePerPatrol > 0) patrolsSurvived += (0.8 * dt) / interval;
        }
        if (t % 5 === 0) buy();
      }
      // 会话结束前购买
      buy();
      // 日报（每天最后一次回访领取）
      if (o.dailyClaim && h === o.visitHours[o.visitHours.length - 1] && day >= 0) {
        const reward = Math.max(500, 600 * effectOf({ ...s, team: { colleagues: {} } }).idleRate) * (1 + 0);
        s = gain(s, reward);
        totals.daily += reward;
        dayTotal += reward;
        dailyClaimed++;
      }
      // 派遣新任务（选择能在下次回访前完成的最长任务；否则最长任务）
      if (o.recruit && o.dispatch) {
        const nextGap =
          h === o.visitHours[o.visitHours.length - 1]
            ? (24 - h + o.visitHours[0]) * 3600
            : (o.visitHours[o.visitHours.indexOf(h) + 1]! - h) * 3600;
        for (const c of cfg.colleagues) {
          const lv = teamLevels[c.id];
          if (!lv) continue;
          if (teamMission[c.id]) continue;
          const avail = cfg.missions.filter((m) => m.seconds <= nextGap);
          const pick = (avail.length > 0 ? avail : cfg.missions).sort((a, b) => b.mult - a.mult)[0]!;
          teamMission[c.id] = { missionId: pick.id, endsAt: nowMs + pick.seconds * 1000 };
        }
      }
      lastVisitMs = nowMs;
      if (o.events) patrolCount += Math.floor(o.sessionSeconds / 128);
    }
    // 转生（能转就转）
    if (o.prestige && canPrestige(s) && prestigeGain(s) >= 1) {
      const r = doPrestige(s);
      if (r) {
        s = { ...r.state };
        prestigeCount++;
        // 同事等级跨转生保留（决策：招募是长期投资，不重置）
        rankTimes[`prestige_${prestigeCount}`] = day * 1440 + 1439;
      }
    }
    // 段位记录
    const rk = rankFor(s.lifetimeEarned);
    if (!(rk.current.name in rankTimes)) {
      rankTimes[rk.current.name] = day * 1440 + 1439;
    }
    byDay.push({
      day: day + 1,
      total: dayTotal,
      lifetime: s.lifetimeEarned,
      idleRate: baseIdle() * idleTalentMult() + teamIdle() * tal.idleMult,
      teamIdle: teamIdle() * tal.idleMult,
      rank: rk.current.name,
      prestige: s.prestige,
      levels: { ...s.levels },
      teamLevels: { ...teamLevels },
    });
    // 假设日 streak 增长（有日报领取）
    if (o.dailyClaim) streak += 1;
  }

  function offlineEffBase(): number {
    return 0.7 + tal.offlineBaseBonus;
  }
  function streakBonus(): number {
    return Math.min(0.15, 0.05 * Math.floor(streak / 7));
  }

  const total = totals.idle + totals.click + totals.event + totals.daily; // idle 含 teamIdle，dispatch 单独
  return {
    totals: { ...totals, total: total + totals.dispatch },
    byDay,
    prestiges: prestigeCount,
    patrolCount,
    firstRecruitMinute: firstRecruit.t === null ? null : firstRecruit.t / 60,
    rankTimes,
    final: {
      lifetime: s.lifetimeEarned,
      totalEarned: s.totalEarned,
      idleRate: baseIdle() * idleTalentMult() + teamIdle() * tal.idleMult,
      teamIdle: teamIdle() * tal.idleMult,
      prestige: s.prestige,
      prestigeMult: M(),
      levels: { ...s.levels },
      teamLevels: { ...teamLevels },
    },
  };
}

let lastVisitMs: number | null = null;
