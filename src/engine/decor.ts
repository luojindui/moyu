import type { GameState } from "./state";

/**
 * 工位经营（批次 3）：花摸鱼值装修工位，每件家具给一点永久加成，并在场景里画出来。
 * 目标：给"看得见的成长"，且不依赖点击。
 */

export type DecorShape = "plant" | "lamp" | "rug" | "fridge" | "chair" | "aquarium" | "projector" | "catbed";

export interface DecorDef {
  id: string;
  name: string;
  desc: string;
  cost: number;
  /** 永久加成：挂机倍率 / 点击倍率 / 离线效率 / 派遣奖励 */
  effects: Partial<{ idleMult: number; clickMult: number; offlineBonus: number; dispatchRewardMult: number }>;
  /** 场景绘制形状 */
  shape: DecorShape;
  /** 解锁段位要求（0 = 一开始就能买） */
  minRank?: number;
}

export const DECOR: DecorDef[] = [
  { id: "plant", name: "绿萝", desc: "工位挂机 +5%", cost: 3_000, effects: { idleMult: 1.05 }, shape: "plant" },
  { id: "lamp", name: "护眼台灯", desc: "点击力 +15%", cost: 20_000, effects: { clickMult: 1.15 }, shape: "lamp" },
  { id: "rug", name: "毛绒地毯", desc: "离线效率 +5%", cost: 120_000, effects: { offlineBonus: 0.05 }, shape: "rug" },
  { id: "fridge", name: "迷你冰箱", desc: "工位挂机 +8%", cost: 600_000, effects: { idleMult: 1.08 }, shape: "fridge" },
  { id: "chair", name: "按摩椅", desc: "离线效率 +8%", cost: 4_000_000, effects: { offlineBonus: 0.08 }, shape: "chair" },
  { id: "aquarium", name: "鱼缸", desc: "挂机 +10%、点击 +10%", cost: 30_000_000, effects: { idleMult: 1.1, clickMult: 1.1 }, shape: "aquarium" },
  { id: "projector", name: "投影仪", desc: "派遣奖励 +30%", cost: 200_000_000, effects: { dispatchRewardMult: 1.3 }, shape: "projector" },
  { id: "catbed", name: "工位猫窝", desc: "挂机 +15%、离线 +10%", cost: 2_000_000_000, effects: { idleMult: 1.15, offlineBonus: 0.1 }, shape: "catbed" },
];

export function decorDef(id: string): DecorDef | undefined {
  return DECOR.find((d) => d.id === id);
}

export function ownsDecor(state: GameState, id: string): boolean {
  return state.decor.includes(id);
}

export function canBuyDecor(state: GameState, id: string): boolean {
  const def = decorDef(id);
  if (!def || ownsDecor(state, id)) return false;
  return state.moyu >= def.cost;
}

export function buyDecor(state: GameState, id: string): GameState | null {
  if (!canBuyDecor(state, id)) return null;
  const def = decorDef(id)!;
  return { ...state, moyu: state.moyu - def.cost, decor: [...state.decor, def.id] };
}

export interface DecorEffects {
  idleMult: number;
  clickMult: number;
  offlineBonus: number;
  dispatchRewardMult: number;
}

/** 已购家具的加成汇总 */
export function decorEffects(state: GameState): DecorEffects {
  const out: DecorEffects = { idleMult: 1, clickMult: 1, offlineBonus: 0, dispatchRewardMult: 1 };
  for (const id of state.decor) {
    const def = decorDef(id);
    if (!def) continue;
    if (def.effects.idleMult) out.idleMult *= def.effects.idleMult;
    if (def.effects.clickMult) out.clickMult *= def.effects.clickMult;
    if (def.effects.offlineBonus) out.offlineBonus += def.effects.offlineBonus;
    if (def.effects.dispatchRewardMult) out.dispatchRewardMult *= def.effects.dispatchRewardMult;
  }
  return out;
}

/** 工位装修数量（用于"看得见的成长"统计） */
export function decorCount(state: GameState): number {
  return state.decor.filter((id) => DECOR.some((d) => d.id === id)).length;
}
