import type { GameState } from "./state";

/**
 * 每日精力（批次 3）：每天 100 点精力，4 种行为合计 145 → 每天必须放弃至少 1 项。
 * 目标：给"每天一次资源分配"的决策，与点击/挂机都无关。
 */

export type EnergyAction = "slack" | "fake-work" | "social" | "focus";

export interface EnergyActionDef {
  id: EnergyAction;
  name: string;
  desc: string;
  cost: number;
}

export const ENERGY_PER_DAY = 100;

export const ENERGY_ACTIONS: EnergyActionDef[] = [
  { id: "slack", name: "认真摸鱼", desc: "今天挂机 +25%", cost: 40 },
  { id: "fake-work", name: "假装工作", desc: "今天巡逻奖励 ×2.2", cost: 35 },
  { id: "social", name: "跟同事聊天", desc: "全体好感 +5，且今天挂机 +5%", cost: 25 },
  { id: "focus", name: "专注点击", desc: "今天点击力 ×2，且挂机 +8%", cost: 45 },
];
/** 四项合计 145 > 100 精力 → 每天必须取舍（不是"全点"） */

export function energyActionDef(id: EnergyAction): EnergyActionDef | undefined {
  return ENERGY_ACTIONS.find((a) => a.id === id);
}

export interface EnergyState {
  date: string;
  /** 剩余精力 */
  left: number;
  /** 今天已使用的行为 */
  used: EnergyAction[];
  /** 今天是否已领过精力（领取后生效） */
  boosted: { idleMult: number; patrolRewardMult: number; clickMult: number };
}

export function emptyEnergy(date = ""): EnergyState {
  return { date, left: ENERGY_PER_DAY, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } };
}

/** 每天首次打开重置精力（幂等） */
export function ensureEnergy(state: GameState, today: string): GameState {
  if (state.energy.date === today) return state;
  return { ...state, energy: emptyEnergy(today) };
}

/** 使用精力：返回新状态；精力不足或当天已用过该行为返回 null */
export function useEnergy(state: GameState, action: EnergyAction): GameState | null {
  const def = energyActionDef(action);
  if (!def) return null;
  if (state.energy.left < def.cost) return null;
  if (state.energy.used.includes(action)) return null;
  // 社交需要有同事，否则纯属浪费
  if (action === "social" && Object.keys(state.team.colleagues).length === 0) return null;

  const next: typeof state = {
    ...state,
    energy: {
      ...state.energy,
      left: state.energy.left - def.cost,
      used: [...state.energy.used, action],
      boosted: {
        idleMult:
          state.energy.boosted.idleMult *
          (action === "slack" ? 1.25 : 1) *
          (action === "social" ? 1.05 : 1) *
          (action === "focus" ? 1.08 : 1),
        patrolRewardMult: state.energy.boosted.patrolRewardMult * (action === "fake-work" ? 2.2 : 1),
        clickMult: state.energy.boosted.clickMult * (action === "focus" ? 2 : 1),
      },
    },
  };
  // 社交：全体同事好感 +3
  if (action === "social") {
    const cols = { ...next.team.colleagues };
    for (const key of Object.keys(cols)) {
      const c = cols[key]!;
      cols[key] = { ...c, favor: Math.min(100, c.favor + 5) };
    }
    return { ...next, team: { colleagues: cols } };
  }
  return next;
}

/** 精力加成（供系统读取） */
export function energyEffects(state: GameState): { idleMult: number; patrolRewardMult: number; clickMult: number } {
  return state.energy.boosted;
}
