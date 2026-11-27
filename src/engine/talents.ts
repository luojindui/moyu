import type { GameState } from "./state";

/**
 * 天赋树（批次 1，第二玩法维度之二）：
 * 三条流派——点击 / 挂机 / 事件，每流派 5 级，逐级解锁。
 * 天赋点来自转生（每次 +1），可免费重置。
 *
 * 数值常量集中在 TALENTS 表，便于 balance-owner 决策后调整。
 */

export type TalentBranch = "click" | "idle" | "event";

export interface TalentDef {
  id: string;
  branch: TalentBranch;
  /** 流派内等级（1-5） */
  tier: number;
  name: string;
  desc: string;
  /** 效果参数，含义由各流派读取 */
  value: number;
}

/** 每级天赋需要的点数 */
export const TALENT_COST = 1;
/** 每流派最大等级 */
export const MAX_TIER = 5;
/** 每次转生获得的天赋点 */
export const TALENT_POINTS_PER_PRESTIGE = 1;

/** 天赋表（数值待 balance-owner 决策，当前为规格草案值） */
export const TALENTS: TalentDef[] = [
  // 点击流
  { id: "click_1", branch: "click", tier: 1, name: "手速", desc: "点击力 +25%", value: 0.25 },
  { id: "click_2", branch: "click", tier: 2, name: "连击窗口", desc: "连击窗口 0.5s → 0.6s", value: 0.1 },
  { id: "click_3", branch: "click", tier: 3, name: "连击上限", desc: "连击上限 20 → 30", value: 10 },
  { id: "click_4", branch: "click", tier: 4, name: "暴击", desc: "点击 5% 概率 ×5 点击力", value: 0.05 },
  { id: "click_5", branch: "click", tier: 5, name: "转化", desc: "点击收入 10% 转为挂机收益", value: 0.1 },
  // 挂机流
  { id: "idle_1", branch: "idle", tier: 1, name: "稳", desc: "挂机收益 +20%", value: 0.2 },
  { id: "idle_2", branch: "idle", tier: 2, name: "离线扩容", desc: "离线封顶 +4h", value: 4 },
  { id: "idle_3", branch: "idle", tier: 3, name: "更稳", desc: "挂机收益 +30%", value: 0.3 },
  { id: "idle_4", branch: "idle", tier: 4, name: "离线效率", desc: "离线基础效率 0.7 → 0.8", value: 0.1 },
  { id: "idle_5", branch: "idle", tier: 5, name: "最稳", desc: "挂机收益 +50%", value: 0.5 },
  // 事件流
  { id: "event_1", branch: "event", tier: 1, name: "情报", desc: "巡逻奖励 +50%", value: 0.5 },
  { id: "event_2", branch: "event", tier: 2, name: "反侦察", desc: "偷点罚款 -30%", value: 0.3 },
  { id: "event_3", branch: "event", tier: 3, name: "人脉", desc: "丢梗奖励 ×2", value: 2 },
  { id: "event_4", branch: "event", tier: 4, name: "高频", desc: "巡逻间隔 -20%", value: 0.2 },
  { id: "event_5", branch: "event", tier: 5, name: "暴富", desc: "事件奖励 5% 概率翻倍", value: 0.05 },
];

export interface TalentState {
  /** 已点亮的天赋 id */
  unlocked: string[];
  /** 当前可用天赋点 */
  points: number;
}

export function emptyTalents(): TalentState {
  return { unlocked: [], points: 0 };
}

export function talentDef(id: string): TalentDef | undefined {
  return TALENTS.find((t) => t.id === id);
}

/** 某流派已点到第几级 */
export function branchTier(talents: TalentState, branch: TalentBranch): number {
  let max = 0;
  for (const id of talents.unlocked) {
    const def = talentDef(id);
    if (def?.branch === branch) max = Math.max(max, def.tier);
  }
  return max;
}

/** 该天赋是否可点（前置等级已点、点数够、未点过） */
export function canUnlock(talents: TalentState, id: string): boolean {
  const def = talentDef(id);
  if (!def) return false;
  if (talents.unlocked.includes(id)) return false;
  if (talents.points < TALENT_COST) return false;
  if (def.tier === 1) return true;
  // 前置：同流派上一级
  const prev = TALENTS.find((t) => t.branch === def.branch && t.tier === def.tier - 1);
  return !!prev && talents.unlocked.includes(prev.id);
}

/** 点亮天赋 */
export function unlockTalent(state: GameState, id: string): GameState | null {
  if (!canUnlock(state.talents, id)) return null;
  return {
    ...state,
    talents: { unlocked: [...state.talents.unlocked, id], points: state.talents.points - TALENT_COST },
  };
}

/** 重置天赋：返还全部已用点数 */
export function resetTalents(state: GameState): GameState {
  const refunded = state.talents.unlocked.length * TALENT_COST;
  return { ...state, talents: { unlocked: [], points: state.talents.points + refunded } };
}

/** 转生时加天赋点 */
export function grantPrestigeTalentPoints(talents: TalentState, count = TALENT_POINTS_PER_PRESTIGE): TalentState {
  return { ...talents, points: talents.points + count };
}

export interface TalentEffects {
  /** 点击力倍率（1 + 25%） */
  clickMult: number;
  /** 连击窗口增加（秒） */
  comboWindowBonus: number;
  /** 连击上限增加 */
  comboMaxBonus: number;
  /** 暴击概率 */
  critChance: number;
  /** 点击转挂机比例 */
  clickToIdle: number;
  /** 挂机收益倍率 */
  idleMult: number;
  /** 离线封顶增加（小时） */
  offlineCapBonusHours: number;
  /** 离线基础效率增加 */
  offlineBaseBonus: number;
  /** 巡逻奖励倍率 */
  patrolRewardMult: number;
  /** 偷点罚款减免 */
  penaltyReduction: number;
  /** 丢梗奖励倍率 */
  memeRewardMult: number;
  /** 巡逻间隔缩短比例 */
  patrolIntervalCut: number;
  /** 事件翻倍概率 */
  eventDoubleChance: number;
}

/** 汇总当前已点天赋的效果 */
export function talentEffects(talents: TalentState): TalentEffects {
  const has = (id: string): boolean => talents.unlocked.includes(id);
  const v = (id: string): number => talentDef(id)?.value ?? 0;
  return {
    clickMult: has("click_1") ? 1 + v("click_1") : 1,
    comboWindowBonus: has("click_2") ? v("click_2") : 0,
    comboMaxBonus: has("click_3") ? v("click_3") : 0,
    critChance: has("click_4") ? v("click_4") : 0,
    clickToIdle: has("click_5") ? v("click_5") : 0,
    idleMult: 1 + (has("idle_1") ? v("idle_1") : 0) + (has("idle_3") ? v("idle_3") : 0) + (has("idle_5") ? v("idle_5") : 0),
    offlineCapBonusHours: has("idle_2") ? v("idle_2") : 0,
    offlineBaseBonus: has("idle_4") ? v("idle_4") : 0,
    patrolRewardMult: has("event_1") ? 1 + v("event_1") : 1,
    penaltyReduction: has("event_2") ? v("event_2") : 0,
    memeRewardMult: has("event_3") ? v("event_3") : 1,
    patrolIntervalCut: has("event_4") ? v("event_4") : 0,
    eventDoubleChance: has("event_5") ? v("event_5") : 0,
  };
}
