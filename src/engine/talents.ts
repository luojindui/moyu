import type { GameState } from "./state";

/**
 * 天赋树（批次 1）：三条流派，每流派 4 个线性天赋 + 2 个**互斥终极**（二选一）。
 * 共 18 个天赋，满树需 27 点，但上限 24 → 终局必须放弃一条流派的一部分。
 *
 * 点数来源：每次转生 +1；段位第 3/5/7/9/11/13 档各 +1。可免费重置。
 * 数值由 balance-owner 决策，见 playtest/b1-balance-decision.md。
 */

export type TalentBranch = "click" | "idle" | "event";

export interface TalentDef {
  id: string;
  branch: TalentBranch;
  /** 流派内等级（1-5） */
  tier: number;
  name: string;
  desc: string;
  /** 效果参数，含义由各分支读取 */
  value: number;
  /** 互斥组：同组只能选择一个 */
  exclusive?: string;
}

/** 每级天赋需要的点数（tier1-4 = 1 点，终极 = 2 点） */
export const TALENT_COST = 1;
export const ULTIMATE_COST = 3;
/** 各级花费：tier1-2 = 1 点，tier3-4 = 2 点，终极 = 3 点（每流派 9 点，全树 27 点） */
export function talentCostOf(tier: number): number {
  if (tier >= MAX_TIER) return ULTIMATE_COST;
  if (tier >= 3) return 2;
  return 1;
}
/** 每流派最大等级 */
export const MAX_TIER = 5;
/** 每次转生获得的天赋点 */
export const TALENT_POINTS_PER_PRESTIGE = 1;
/** 全树点数上限（3 流派 × 6 点 = 18） */
export const TALENT_POINT_CAP = 24; // 满树需 27 点（3 流派 × 9），上限 24 → 终局必须放弃一条流派
/** 发放天赋点的段位档位（第 3/5/7/9/11/13 档，索引 2/4/6/8/10/12） */
export const TALENT_RANK_TIERS = [2, 4, 6, 8, 10, 12];

export const TALENTS: TalentDef[] = [
  // ---------- 点击流 ----------
  { id: "click_1", branch: "click", tier: 1, name: "手速", desc: "点击力 +25%", value: 0.25 },
  { id: "click_2", branch: "click", tier: 2, name: "连击窗口", desc: "连击窗口 0.5s → 0.65s", value: 0.15 },
  { id: "click_3", branch: "click", tier: 3, name: "连击上限", desc: "连击上限 20 → 30（最高 ×1.36）", value: 10 },
  { id: "click_4", branch: "click", tier: 4, name: "暴击", desc: "每 20 次点击必暴击 ×5（巡逻偷点不触发）", value: 20 },
  { id: "click_5a", branch: "click", tier: 5, name: "摸鱼转正", desc: "每 300 次累计点击 → 挂机 +1%（封顶 +35%）", value: 300, exclusive: "click_ult" },
  { id: "click_5b", branch: "click", tier: 5, name: "指尖风暴", desc: "立即 +12% 挂机；此后每 1000 次累计点击再 +1%（封顶 +32%）+ 点击力 +60%", value: 0.12, exclusive: "click_ult" },

  // ---------- 挂机流 ----------
  { id: "idle_1", branch: "idle", tier: 1, name: "稳", desc: "挂机收益 +6%", value: 0.06 },
  { id: "idle_2", branch: "idle", tier: 2, name: "离线扩容", desc: "离线封顶 +2h（12→14h）", value: 2 },
  { id: "idle_3", branch: "idle", tier: 3, name: "更稳", desc: "挂机收益 +6%", value: 0.06 },
  { id: "idle_4", branch: "idle", tier: 4, name: "离线效率", desc: "离线效率上限 +0.08（可超过 100%）", value: 0.08 },
  { id: "idle_5a", branch: "idle", tier: 5, name: "最稳", desc: "挂机收益 +8%", value: 0.08, exclusive: "idle_ult" },
  { id: "idle_5b", branch: "idle", tier: 5, name: "带队摸鱼", desc: "同事提供的挂机收益 +40%", value: 0.4, exclusive: "idle_ult" },

  // ---------- 事件流 ----------
  { id: "event_1", branch: "event", tier: 1, name: "情报", desc: "安然巡逻奖励 +15%", value: 0.15 },
  { id: "event_2", branch: "event", tier: 2, name: "反侦察", desc: "偷点罚款 -35%", value: 0.35 },
  { id: "event_3", branch: "event", tier: 3, name: "人脉", desc: "丢梗奖励 +15%", value: 0.15 },
  { id: "event_4", branch: "event", tier: 4, name: "预警", desc: "巡逻横幅提前 2s + 奖励再 +5%", value: 0.05 },
  { id: "event_5a", branch: "event", tier: 5, name: "摸鱼气场", desc: "每次安然巡逻 → 挂机 +1%（封顶 +30%）", value: 1, exclusive: "event_ult" },
  { id: "event_5b", branch: "event", tier: 5, name: "老板眼线", desc: "巡逻与丢梗奖励 ×2，且离线结算效率 +20%", value: 2, exclusive: "event_ult" },
];

export interface TalentState {
  /** 已点亮的天赋 id */
  unlocked: string[];
  /** 当前可用天赋点 */
  points: number;
  /** 已发放到第几个段位档（防重复发点） */
  rankGranted: number;
  /** 最近一次"每日签到天赋点"的日期（YYYY-MM-DD） */
  dailyGiftDate: string;
}

export function emptyTalents(): TalentState {
  return { unlocked: [], points: 0, rankGranted: -1, dailyGiftDate: "" };
}

export function talentDef(id: string): TalentDef | undefined {
  return TALENTS.find((t) => t.id === id);
}

/** 该天赋的花费 */
export function costOfTalent(id: string): number {
  const def = talentDef(id);
  return def ? talentCostOf(def.tier) : TALENT_COST;
}

/** 某流派已点到第几级（终极算 5 级） */
export function branchTier(talents: TalentState, branch: TalentBranch): number {
  let max = 0;
  for (const id of talents.unlocked) {
    const def = talentDef(id);
    if (def?.branch === branch) max = Math.max(max, def.tier);
  }
  return max;
}

/** 该互斥组已选的天赋 id */
export function exclusiveTaken(talents: TalentState, group: string): string | undefined {
  return talents.unlocked.find((id) => talentDef(id)?.exclusive === group);
}

/** 该天赋是否可点（前置等级已点、点数够、未点过、互斥组未占用） */
export function canUnlock(talents: TalentState, id: string): boolean {
  const def = talentDef(id);
  if (!def) return false;
  if (talents.unlocked.includes(id)) return false;
  if (talents.points < costOfTalent(id)) return false;
  if (def.exclusive && exclusiveTaken(talents, def.exclusive)) return false;
  if (def.tier === 1) return true;
  // 前置：同流派上一级（终极的前置是 tier 4）
  const prevTier = def.tier >= MAX_TIER ? MAX_TIER - 1 : def.tier - 1;
  const prev = TALENTS.filter((t) => t.branch === def.branch && t.tier === prevTier);
  return prev.some((t) => talents.unlocked.includes(t.id));
}

/** 点亮天赋 */
export function unlockTalent(state: GameState, id: string): GameState | null {
  if (!canUnlock(state.talents, id)) return null;
  return {
    ...state,
    talents: {
      unlocked: [...state.talents.unlocked, id],
      points: state.talents.points - costOfTalent(id),
      rankGranted: state.talents.rankGranted,
      dailyGiftDate: state.talents.dailyGiftDate,
    },
  };
}

/** 重置天赋：返还全部已用点数 */
export function resetTalents(state: GameState): GameState {
  const refunded = state.talents.unlocked.reduce((sum, id) => sum + costOfTalent(id), 0);
  return {
    ...state,
    talents: {
      unlocked: [],
      points: Math.min(TALENT_POINT_CAP, state.talents.points + refunded),
      rankGranted: state.talents.rankGranted,
      dailyGiftDate: state.talents.dailyGiftDate,
    },
  };
}

/** 转生时加天赋点 */
export function grantPrestigeTalentPoints(talents: TalentState, count = TALENT_POINTS_PER_PRESTIGE): TalentState {
  return { ...talents, points: Math.min(TALENT_POINT_CAP, talents.points + count) };
}

/** 每日首次打开送 1 点（保证碎片党每次打开都有 1 个决策；上限内） */
export function grantDailyTalentPoint(
  talents: TalentState,
  today: string,
): { talents: TalentState; granted: number } {
  if (talents.dailyGiftDate === today) return { talents, granted: 0 };
  if (talents.points >= TALENT_POINT_CAP) {
    return { talents: { ...talents, dailyGiftDate: today }, granted: 0 };
  }
  return {
    granted: 1,
    talents: { ...talents, dailyGiftDate: today, points: Math.min(TALENT_POINT_CAP, talents.points + 1) },
  };
}

/** 按生涯累计检查应发放的段位天赋点（幂等） */
export function grantRankTalents(talents: TalentState, rankIndex: number): { talents: TalentState; granted: number } {
  let granted = 0;
  let rankGranted = talents.rankGranted;
  for (const tier of TALENT_RANK_TIERS) {
    if (rankIndex >= tier && tier > rankGranted) {
      granted += 1;
      rankGranted = tier;
    }
  }
  if (granted === 0) return { talents, granted: 0 };
  return {
    granted,
    talents: { ...talents, rankGranted, points: Math.min(TALENT_POINT_CAP, talents.points + granted) },
  };
}

export interface TalentEffects {
  /** 点击力倍率 */
  clickMult: number;
  /** 连击窗口增加（秒） */
  comboWindowBonus: number;
  /** 连击上限增加 */
  comboMaxBonus: number;
  /** 每 N 次点击必暴击（0 = 无） */
  critEvery: number;
  /** 每 N 次累计点击 → 挂机 +1%（0 = 无） */
  clickToIdleStep: number;
  /** 挂机收益倍率（工位） */
  idleMult: number;
  /** 同事挂机收益倍率 */
  teamIdleMult: number;
  /** 离线封顶增加（小时） */
  offlineCapBonusHours: number;
  /** 离线效率上限增加 */
  offlineBaseBonus: number;
  /** 巡逻/丢梗奖励倍率 */
  patrolRewardMult: number;
  /** 偷点罚款减免 */
  penaltyReduction: number;
  /** 丢梗奖励倍率 */
  memeRewardMult: number;
  /** 巡逻横幅提前秒数 */
  patrolWarnSeconds: number;
  /** 每次安然巡逻 → 挂机 +1%（Lv5a） */
  surviveToIdle: boolean;
  /** click_5b：立即挂机加成（0.12） */
  clickUltBase: number;
  /** click_5b：每 1000 点击再 +1%（封顶 0.08） */
  clickUltPerK: number;
  /** event_5b：每次安然巡逻额外给的挂机秒数 */
  surviveBonusIdleSeconds: number;
  /** event_5b：离线效率加成 */
  offlineEfficiencyBonus: number;
}

/** 汇总当前已点天赋的效果 */
export function talentEffects(talents: TalentState): TalentEffects {
  const has = (id: string): boolean => talents.unlocked.includes(id);
  const v = (id: string): number => talentDef(id)?.value ?? 0;
  const idleLinear = (has("idle_1") ? v("idle_1") : 0) + (has("idle_3") ? v("idle_3") : 0) + (has("idle_5a") ? v("idle_5a") : 0);
  return {
    clickMult: (has("click_1") ? 1 + v("click_1") : 1) * (has("click_5b") ? 1.6 : 1), // 5b 点击力 +60%（固定）
    comboWindowBonus: has("click_2") ? v("click_2") : 0,
    comboMaxBonus: has("click_3") ? v("click_3") : 0,
    critEvery: has("click_4") ? v("click_4") : 0,
    clickToIdleStep: has("click_5a") ? v("click_5a") : 0,
    idleMult: 1 + idleLinear,
    teamIdleMult: has("idle_5b") ? 1 + v("idle_5b") : 1,
    offlineCapBonusHours: has("idle_2") ? v("idle_2") : 0,
    offlineBaseBonus: has("idle_4") ? v("idle_4") : 0,
    patrolRewardMult: (1 + (has("event_1") ? v("event_1") : 0) + (has("event_4") ? v("event_4") : 0)) * (has("event_5b") ? v("event_5b") : 1),
    penaltyReduction: has("event_2") ? v("event_2") : 0,
    memeRewardMult: (1 + (has("event_3") ? v("event_3") : 0)) * (has("event_5b") ? v("event_5b") : 1),
    patrolWarnSeconds: has("event_4") ? 2 : 0,
    surviveToIdle: has("event_5a"),
    clickUltBase: has("click_5b") ? v("click_5b") : 0,
    clickUltPerK: has("click_5b") ? 0.01 : 0,
    surviveBonusIdleSeconds: has("event_5b") ? 10 : 0,
    offlineEfficiencyBonus: has("event_5b") ? 0.2 : 0,
  };
}
