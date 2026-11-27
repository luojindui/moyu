import type { GameState } from "./state";

/** 内联扣钱（避免 state↔team 运行时循环依赖）：余额与累计同步扣减，余额不为负 */
function pay(state: GameState, amount: number): GameState {
  const paid = Math.min(amount, state.moyu);
  return {
    ...state,
    moyu: state.moyu - paid,
    totalEarned: Math.max(0, state.totalEarned - paid),
  };
}

/** 内联进账 */
function earn(state: GameState, amount: number): GameState {
  if (amount <= 0) return state;
  return {
    ...state,
    moyu: state.moyu + amount,
    totalEarned: state.totalEarned + amount,
    lifetimeEarned: state.lifetimeEarned + amount,
  };
}

/**
 * 摸鱼小队（第二玩法维度，R12）：
 * 招募同事 → 派遣任务（15min/1h/4h）→ 回来领奖励。
 * 决策点：派谁、派什么任务、派多久；同事有擅长领域，匹配加成 50%。
 * 时间用真实时钟（关页面也会走），回来可领。
 */

export type TaskType = "chat" | "meeting" | "toilet" | "coffee" | "errand";

export interface ColleagueDef {
  id: string;
  name: string;
  role: string;
  /** 擅长任务类型 */
  skill: TaskType;
  /** 招募价 */
  cost: number;
  /** 每级提供的挂机收益（招募后即有 1 级） */
  idlePerLevel: number;
}

export interface MissionDef {
  id: string;
  name: string;
  type: TaskType;
  /** 时长（秒） */
  seconds: number;
  /** 奖励倍率（长任务更划算） */
  mult: number;
}

export interface ColleagueState {
  level: number;
  /** 进行中的任务 id（null = 空闲） */
  missionId: string | null;
  /** 任务开始/结束时间（毫秒） */
  startedAt: number;
  endsAt: number;
}

export interface TeamState {
  colleagues: Record<string, ColleagueState>;
}

export const COLLEAGUES: ColleagueDef[] = [
  { id: "zhou", name: "老周", role: "八年老员工·甩锅大师", skill: "chat", cost: 2_000, idlePerLevel: 2 },
  { id: "mei", name: "小美", role: "HR·知道所有八卦", skill: "meeting", cost: 12_000, idlePerLevel: 8 },
  { id: "qiang", name: "强哥", role: "厕所隔间所长", skill: "toilet", cost: 60_000, idlePerLevel: 30 },
  { id: "li", name: "小李", role: "实习生·精力旺盛", skill: "errand", cost: 300_000, idlePerLevel: 120 },
  { id: "wang", name: "王师傅", role: "快退休·深藏功与名", skill: "coffee", cost: 1_500_000, idlePerLevel: 500 },
];

export const MISSIONS: MissionDef[] = [
  { id: "quick", name: "溜一圈", type: "errand", seconds: 15 * 60, mult: 1.2 },
  { id: "chat", name: "茶水间聊八卦", type: "chat", seconds: 30 * 60, mult: 1.3 },
  { id: "meeting", name: "开个会", type: "meeting", seconds: 60 * 60, mult: 1.6 },
  { id: "toilet", name: "长线蹲点", type: "toilet", seconds: 4 * 60 * 60, mult: 2.2 },
  { id: "coffee", name: "楼下买咖啡", type: "coffee", seconds: 8 * 60 * 60, mult: 2.8 },
];

/** 任务匹配加成 */
export const SKILL_MATCH_BONUS = 0.5;
/** 同事等级上限 */
export const MAX_COLLEAGUE_LEVEL = 50;
/** 升级价：招募价的 40% × 1.35^level */
export function upgradeCostOf(def: ColleagueDef, level: number): number {
  return Math.ceil(def.cost * 0.4 * 1.35 ** level);
}

export function colleagueDef(id: string): ColleagueDef | undefined {
  return COLLEAGUES.find((c) => c.id === id);
}

export function missionDef(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}

/** 已招募同事提供的挂机收益 */
export function teamIdleRate(state: GameState): number {
  let sum = 0;
  for (const def of COLLEAGUES) {
    const c = state.team.colleagues[def.id];
    if (!c) continue;
    sum += def.idlePerLevel * c.level;
  }
  return sum;
}

/** 已招募同事数量 */
export function teamSize(state: GameState): number {
  return COLLEAGUES.filter((d) => state.team.colleagues[d.id]).length;
}

/** 可招募（未招且钱够） */
export function canRecruit(state: GameState, id: string): boolean {
  const def = colleagueDef(id);
  if (!def) return false;
  if (state.team.colleagues[id]) return false;
  return state.moyu >= def.cost;
}

/** 招募同事（返回新状态，失败 null） */
export function recruit(state: GameState, id: string): GameState | null {
  if (!canRecruit(state, id)) return null;
  const def = colleagueDef(id)!;
  const paid = pay(state, def.cost);
  return {
    ...paid,
    team: {
      colleagues: {
        ...state.team.colleagues,
        [id]: { level: 1, missionId: null, startedAt: 0, endsAt: 0 },
      },
    },
  };
}

/** 升级同事（返回新状态，失败 null） */
export function upgradeColleague(state: GameState, id: string): GameState | null {
  const def = colleagueDef(id);
  const cur = state.team.colleagues[id];
  if (!def || !cur) return null;
  if (cur.level >= MAX_COLLEAGUE_LEVEL) return null;
  const price = upgradeCostOf(def, cur.level);
  if (state.moyu < price) return null;
  const paid = pay(state, price);
  return {
    ...paid,
    team: {
      colleagues: { ...state.team.colleagues, [id]: { ...cur, level: cur.level + 1 } },
    },
  };
}

/** 该同事当前是否可以派遣 */
export function canDispatch(state: GameState, id: string): boolean {
  const cur = state.team.colleagues[id];
  return !!cur && cur.missionId === null;
}

/** 派遣：记录开始/结束真实时间 */
export function dispatch(state: GameState, id: string, missionId: string, nowMs: number): GameState | null {
  const cur = state.team.colleagues[id];
  const m = missionDef(missionId);
  if (!cur || !m || !canDispatch(state, id)) return null;
  return {
    ...state,
    team: {
      colleagues: {
        ...state.team.colleagues,
        [id]: { ...cur, missionId: m.id, startedAt: nowMs, endsAt: nowMs + m.seconds * 1000 },
      },
    },
  };
}

/** 任务是否已完成 */
export function missionDone(state: GameState, id: string, nowMs: number): boolean {
  const cur = state.team.colleagues[id];
  return !!cur && cur.missionId !== null && nowMs >= cur.endsAt;
}

/**
 * 领取派遣奖励：
 * 基数 = 当前挂机收益 × 时长 × 任务倍率；技能匹配再 +50%。
 * 下限保证早期也有意义。
 */
export function dispatchReward(state: GameState, id: string, idleRate: number): number {
  const def = colleagueDef(id);
  const cur = state.team.colleagues[id];
  const m = cur?.missionId ? missionDef(cur.missionId) : undefined;
  if (!def || !cur || !m) return 0;
  const base = Math.max(200, idleRate * m.seconds);
  const match = def.skill === m.type ? 1 + SKILL_MATCH_BONUS : 1;
  return Math.floor(base * m.mult * match);
}

/** 领取（返回新状态与奖励，未完成 null） */
export function claimMission(
  state: GameState,
  id: string,
  nowMs: number,
  idleRate: number,
): { state: GameState; reward: number } | null {
  if (!missionDone(state, id, nowMs)) return null;
  const reward = dispatchReward(state, id, idleRate);
  const cur = state.team.colleagues[id]!;
  const next = earn(state, reward);
  return {
    reward,
    state: {
      ...next,
      team: {
        colleagues: { ...next.team.colleagues, [id]: { ...cur, missionId: null, startedAt: 0, endsAt: 0 } },
      },
    },
  };
}

/** 有任务可领的同事数量（用于 HUD 红点） */
export function claimableCount(state: GameState, nowMs: number): number {
  return COLLEAGUES.filter((d) => missionDone(state, d.id, nowMs)).length;
}

export function emptyTeam(): TeamState {
  return { colleagues: {} };
}
