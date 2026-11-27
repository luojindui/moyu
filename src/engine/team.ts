import type { GameState } from "./state";

/**
 * 摸鱼小队（第二玩法维度，R12）：招募同事 → 派遣任务 → 回来领奖励。
 * 数值由 balance-owner 决策（docs 内 playtest/b1-balance-decision.md）：
 *  - 招募价按指数经济上调（12k → 60 亿），等级上限 5
 *  - 同事挂机 = 固定值（吃转生/图鉴）+ 工位挂机 × 0.8%/级（防后期失效）
 *  - 派遣奖励 = 工位挂机 × 秒数 × 0.011（占比目标 10-18%）
 *  - 同事挂机仅 50% 进离线
 */

export type TaskType = "chat" | "meeting" | "toilet" | "errand" | "coffee";

export interface ColleagueDef {
  id: string;
  name: string;
  role: string;
  /** 擅长任务类型 */
  skill: TaskType;
  /** 招募价 */
  cost: number;
  /** 每级固定挂机（吃转生/图鉴倍率） */
  idlePerLevel: number;
  /** 每级占工位挂机的比例 */
  sharePerLevel: number;
  /** 独特被动（解决"派谁都一样"） */
  trait: string;
  /** 被动数值 */
  traitValue: number;
}

export interface MissionDef {
  id: string;
  name: string;
  type: TaskType;
  seconds: number;
  mult: number;
}

export interface ColleagueState {
  level: number;
  missionId: string | null;
  startedAt: number;
  endsAt: number;
  /** 好感度 0-100（领奖 +2，匹配任务 +3） */
  favor: number;
  /** 自动重复：领奖后自动再派同一任务（排班层） */
  autoRepeat: boolean;
  /** 派单时快照的奖励（防"先升级再领"放大） */
  rewardSnapshot: number;
}

export interface TeamState {
  colleagues: Record<string, ColleagueState>;
}

/** 等级上限（balance-owner：5） */
export const MAX_COLLEAGUE_LEVEL = 5;
/** 匹配任务加成 */
export const SKILL_MATCH_BONUS = 0.5;
/** 好感里程碑加成：20 预警（在 main 用 favorTier>=1）、60 丢梗 +10%、80 每同事 +2%（封顶 10%） */
export function favorBonuses(state: GameState): { dispatchMult: number; memeMult: number; idleMult: number } {
  const tier = favorTier(state);
  let highFavor = 0;
  for (const def of COLLEAGUES) {
    const cur = state.team.colleagues[def.id];
    if (cur && cur.favor >= 80) highFavor += 1;
  }
  return {
    dispatchMult: 1, // 20 档改为预警，不再影响奖励
    memeMult: tier >= 3 ? 1.1 : 1,
    idleMult: 1 + Math.min(0.1, highFavor * 0.02),
  };
}

/** 全队被动汇总（只算已招募的同事） */
export function teamTraits(state: GameState): { offlineEfficiency: number; penaltyReduction: number } {
  let offlineEfficiency = 0;
  let penaltyReduction = 0;
  for (const def of COLLEAGUES) {
    const cur = state.team.colleagues[def.id];
    if (!cur) continue;
    if (def.trait === "离线效率") offlineEfficiency += def.traitValue;
    if (def.trait === "罚款减免") penaltyReduction += def.traitValue;
  }
  return { offlineEfficiency, penaltyReduction };
}

/** 某任务在该同事手上的实际时长（老周 -15%） */
export function missionSecondsFor(id: string, missionId: string): number {
  const def = colleagueDef(id);
  const m = missionDef(missionId);
  if (!def || !m) return 0;
  const speed = def.trait === "派遣速度" ? 1 - def.traitValue : 1;
  return Math.round(m.seconds * speed);
}

/** 升级价 = cost × 0.4 × 1.35^当前等级 */
export const UPGRADE_COEF = 0.4;
export const UPGRADE_BASE = 1.35;
/** 派遣系数（以工位挂机/秒为基数，不含同事） */
export const DISPATCH_COEF = 0.011;
export const DISPATCH_FLOOR = 300;
/** 派遣等级系数斜率：1 + 0.5×(lv-1)/4 */
export const DISPATCH_LEVEL_FACTOR = 0.5;
/** 好感：领奖 +2，匹配任务 +3 */
export const FAVOR_PER_CLAIM = 2;
export const FAVOR_MATCH_BONUS = 1;
/** 同事挂机进离线比例 */
export const TEAM_OFFLINE_SHARE = 0.5;

/**
 * 5 个同事各有独特被动，且 sharePerLevel 递增（修正"只招老周最优"）：
 * 满级 share 合计 = (0.008+0.010+0.012+0.014+0.016)*5 = 30% 工位挂机
 */
export const COLLEAGUES: ColleagueDef[] = [
  {
    id: "zhou", name: "老周", role: "八年老员工·甩锅大师", skill: "chat",
    cost: 12_000, idlePerLevel: 20, sharePerLevel: 0.008,
    trait: "派遣速度", traitValue: 0.15, // 他的任务时长 -15%
  },
  {
    id: "mei", name: "小美", role: "HR·知道所有八卦", skill: "meeting",
    cost: 500_000, idlePerLevel: 100, sharePerLevel: 0.010,
    trait: "离线效率", traitValue: 0.02, // 在队期间离线基础效率 +2%
  },
  {
    id: "qiang", name: "强哥", role: "厕所隔间所长", skill: "toilet",
    cost: 8_000_000, idlePerLevel: 200, sharePerLevel: 0.012,
    trait: "罚款减免", traitValue: 0.1, // 在队期间偷点罚款 -10%
  },
  {
    id: "li", name: "小李", role: "实习生·精力旺盛", skill: "errand",
    cost: 60_000_000, idlePerLevel: 300, sharePerLevel: 0.014,
    trait: "短任务加成", traitValue: 0.6, // 1 小时以内任务奖励 +60%
  },
  {
    id: "wang", name: "王师傅", role: "快退休·深藏功与名", skill: "coffee",
    cost: 400_000_000, idlePerLevel: 400, sharePerLevel: 0.016,
    trait: "长任务加成", traitValue: 0.5, // 4 小时以上任务奖励 +50%
  },
];

export const MISSIONS: MissionDef[] = [
  // 3 分钟档：让"打开→派→领"能在一次碎片会话内闭环
  { id: "stroll", name: "就近溜达", type: "errand", seconds: 3 * 60, mult: 1.1 },
  { id: "quick", name: "溜一圈", type: "errand", seconds: 15 * 60, mult: 1.45 },
  { id: "chat", name: "茶水间聊八卦", type: "chat", seconds: 30 * 60, mult: 1.3 },
  { id: "meeting", name: "开个会", type: "meeting", seconds: 60 * 60, mult: 1.6 },
  { id: "toilet", name: "长线蹲点", type: "toilet", seconds: 4 * 60 * 60, mult: 2.2 },
  { id: "coffee", name: "楼下买咖啡", type: "coffee", seconds: 8 * 60 * 60, mult: 2.8 },
];

/** 内联扣钱（与商店 buyUpgrade 口径一致：只扣余额，totalEarned 是"本局累计毛收入"） */
function pay(state: GameState, amount: number): GameState {
  const paid = Math.min(amount, state.moyu);
  return { ...state, moyu: state.moyu - paid };
}

function earn(state: GameState, amount: number): GameState {
  if (amount <= 0) return state;
  return {
    ...state,
    moyu: state.moyu + amount,
    totalEarned: state.totalEarned + amount,
    lifetimeEarned: state.lifetimeEarned + amount,
  };
}

export function colleagueDef(id: string): ColleagueDef | undefined {
  return COLLEAGUES.find((c) => c.id === id);
}

export function missionDef(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}

export function emptyTeam(): TeamState {
  return { colleagues: {} };
}

export function upgradeCostOf(def: ColleagueDef, level: number): number {
  return Math.ceil(def.cost * UPGRADE_COEF * UPGRADE_BASE ** level);
}

/** 好感等级（按所有同事中的最高好感） */
export function favorTier(state: GameState): number {
  let max = 0;
  for (const def of COLLEAGUES) {
    const cur = state.team.colleagues[def.id];
    if (cur) max = Math.max(max, cur.favor);
  }
  if (max >= 100) return 5;
  if (max >= 80) return 4;
  if (max >= 60) return 3;
  if (max >= 40) return 2;
  if (max >= 20) return 1;
  return 0;
}

/** 派遣在外的挂机折损（制造"派他还是留他"的取舍） */
export const AWAY_IDLE_FACTOR = 0.85; // 离岗只损失 15% 挂机（原 0.5 会让升级后派遣净亏）

/** 已招募同事的固定挂机总和（未乘倍率；在外派遣的只算 50%） */
export function teamFixedRate(state: GameState): number {
  let sum = 0;
  for (const def of COLLEAGUES) {
    const c = state.team.colleagues[def.id];
    if (!c) continue;
    const away = c.missionId !== null && Date.now() < c.endsAt; // 完成后不再扣
    const factor = away ? AWAY_IDLE_FACTOR : 1;
    sum += def.idlePerLevel * c.level * factor;
  }
  return sum;
}

/** 已招募同事的工位占比总和（0.008 × 等级） */
export function teamShareRatio(state: GameState): number {
  let sum = 0;
  for (const def of COLLEAGUES) {
    const c = state.team.colleagues[def.id];
    if (!c) continue;
    const away = c.missionId !== null && Date.now() < c.endsAt;
    const factor = away ? AWAY_IDLE_FACTOR : 1;
    sum += def.sharePerLevel * c.level * factor;
  }
  return sum;
}

export function teamSize(state: GameState): number {
  return COLLEAGUES.filter((d) => state.team.colleagues[d.id]).length;
}

export function canRecruit(state: GameState, id: string): boolean {
  const def = colleagueDef(id);
  if (!def) return false;
  if (state.team.colleagues[id]) return false;
  return state.moyu >= def.cost;
}

export function recruit(state: GameState, id: string): GameState | null {
  if (!canRecruit(state, id)) return null;
  const def = colleagueDef(id)!;
  const paid = pay(state, def.cost);
  return {
    ...paid,
    team: {
      colleagues: {
        ...state.team.colleagues,
        [id]: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 },
      },
    },
  };
}

export function upgradeColleague(state: GameState, id: string): GameState | null {
  const def = colleagueDef(id);
  const cur = state.team.colleagues[id];
  if (!def || !cur || cur.level >= MAX_COLLEAGUE_LEVEL) return null;
  const price = upgradeCostOf(def, cur.level);
  if (state.moyu < price) return null;
  const paid = pay(state, price);
  return {
    ...paid,
    team: { colleagues: { ...state.team.colleagues, [id]: { ...cur, level: cur.level + 1 } } },
  };
}

export function canDispatch(state: GameState, id: string): boolean {
  const cur = state.team.colleagues[id];
  return !!cur && cur.missionId === null;
}

export function dispatch(
  state: GameState,
  id: string,
  missionId: string,
  nowMs: number,
  stationIdle: number,
): GameState | null {
  const cur = state.team.colleagues[id];
  const m = missionDef(missionId);
  if (!cur || !m || !canDispatch(state, id)) return null;
  const seconds = missionSecondsFor(id, missionId);
  // 快照：派遣瞬间按当前工位挂机率结算，之后升级不放大这笔奖励
  const probe: GameState = {
    ...state,
    team: { colleagues: { ...state.team.colleagues, [id]: { ...cur, missionId: m.id } } },
  };
  const snapshot = dispatchReward(probe, id, stationIdle);
  return {
    ...state,
    team: {
      colleagues: {
        ...state.team.colleagues,
        [id]: { ...cur, missionId: m.id, startedAt: nowMs, endsAt: nowMs + seconds * 1000, rewardSnapshot: snapshot },
      },
    },
  };
}

export function missionDone(state: GameState, id: string, nowMs: number): boolean {
  const cur = state.team.colleagues[id];
  return !!cur && cur.missionId !== null && nowMs >= cur.endsAt;
}

/**
 * 派遣奖励（balance-owner 公式）：
 * max(300, 工位挂机/秒(不含同事) × 秒数 × 0.011) × 任务倍率 × 匹配1.5 × 等级系数
 * 好感 100 的同事再 ×1.5。
 */
export function dispatchReward(state: GameState, id: string, stationIdle: number): number {
  const def = colleagueDef(id);
  const cur = state.team.colleagues[id];
  const m = cur?.missionId ? missionDef(cur.missionId) : undefined;
  if (!def || !cur || !m) return 0;
  // 同事自身挂机贡献也计入派遣产出（否则升级后"离岗损失"涨、奖励不涨 → 净亏）
  const colIdle = def.idlePerLevel * cur.level + stationIdle * def.sharePerLevel * cur.level;
  const base = Math.max(DISPATCH_FLOOR, (stationIdle + colIdle * 2) * m.seconds * DISPATCH_COEF);
  const match = def.skill === m.type ? 1 + SKILL_MATCH_BONUS : 1;
  const levelFactor = 1 + DISPATCH_LEVEL_FACTOR * ((cur.level - 1) / (MAX_COLLEAGUE_LEVEL - 1));
  const bonus = favorBonuses(state);
  const favorBonus = (cur.favor >= 100 ? 1.5 : 1) * bonus.dispatchMult;
  // 独特被动：小李短任务 +50% / 王师傅长任务 +50%
  let traitMult = 1;
  if (def.trait === "短任务加成" && m.seconds <= 3600) traitMult += def.traitValue;
  if (def.trait === "长任务加成" && m.seconds >= 4 * 3600) traitMult += def.traitValue;
  return Math.floor(base * m.mult * match * levelFactor * favorBonus * traitMult);
}

/** 领取派遣奖励（好感 +2，匹配任务 +3） */
export function claimMission(
  state: GameState,
  id: string,
  nowMs: number,
  stationIdle: number,
): { state: GameState; reward: number } | null {
  if (!missionDone(state, id, nowMs)) return null;
  const def = colleagueDef(id)!;
  const cur = state.team.colleagues[id]!;
  const m = missionDef(cur.missionId!)!;
  // 优先用派单时快照（防放大）；旧存档无快照则按当前结算
  const reward = cur.rewardSnapshot > 0 ? cur.rewardSnapshot : dispatchReward(state, id, stationIdle);
  const next = earn(state, reward);
  const favorGain = FAVOR_PER_CLAIM + (def.skill === m.type ? FAVOR_MATCH_BONUS : 0);
  const favor = Math.min(100, cur.favor + favorGain);
  // 排班层：开启自动重复则立刻再派同一任务（并用当前工位重算快照）
  let autoNext = { missionId: null as string | null, startedAt: 0, endsAt: 0, rewardSnapshot: 0 };
  if (cur.autoRepeat) {
    const probe: GameState = {
      ...state,
      team: { colleagues: { ...state.team.colleagues, [id]: { ...cur, missionId: m.id } } },
    };
    autoNext = {
      missionId: m.id,
      startedAt: nowMs,
      endsAt: nowMs + missionSecondsFor(id, m.id) * 1000,
      rewardSnapshot: dispatchReward(probe, id, stationIdle),
    };
  }
  return {
    reward,
    state: {
      ...next,
      team: {
        colleagues: {
          ...next.team.colleagues,
          [id]: { ...cur, ...autoNext, favor },
        },
      },
    },
  };
}

/** 开关自动重复（排班层） */
export function setAutoRepeat(state: GameState, id: string, on: boolean): GameState | null {
  const cur = state.team.colleagues[id];
  if (!cur) return null;
  return { ...state, team: { colleagues: { ...state.team.colleagues, [id]: { ...cur, autoRepeat: on } } } };
}

/** 当前可领奖励总和（一键领取用）：按各单快照求和，与逐单领取一致 */
export function claimableTotal(state: GameState, nowMs: number, stationIdle: number): number {
  let sum = 0;
  for (const def of COLLEAGUES) {
    if (!missionDone(state, def.id, nowMs)) continue;
    const cur = state.team.colleagues[def.id]!;
    sum += cur.rewardSnapshot > 0 ? cur.rewardSnapshot : dispatchReward(state, def.id, stationIdle);
  }
  return sum;
}

/** 可领任务数（HUD 红点） */
export function claimableCount(state: GameState, nowMs: number): number {
  return COLLEAGUES.filter((d) => missionDone(state, d.id, nowMs)).length;
}
