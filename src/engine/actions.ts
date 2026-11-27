import type { GameState } from "./state";
import { gain } from "./state";
import { effectOf, costOf, UPGRADES } from "./upgrades";

/** 初始点击力（未买任何升级时） */
export const BASE_CLICK_POWER = 1;

/** 连击链：间隔 <0.4s 累积，1.5s 断点清零；收入 ×(1+0.02×combo) 封顶 ×1.24（12 连击） */
export const COMBO_WINDOW_S = 0.4;
export const COMBO_BREAK_S = 1.5;
export const COMBO_MAX = 12;

export function comboMultiplier(combo: number): number {
  return 1 + 0.02 * Math.min(Math.max(0, combo), COMBO_MAX);
}

/** 当前总点击力 */
export function clickPowerOf(state: GameState): number {
  return BASE_CLICK_POWER + effectOf(state).clickPower;
}

/** 点击一次（combo 为当前连击数）：返回新状态 */
export function doClick(state: GameState, combo = 0): GameState {
  return gain(state, clickPowerOf(state) * comboMultiplier(combo));
}

/**
 * 购买升级：成功返回新状态（扣当前价、等级+1）；
 * 余额不足或未知 id 返回 null（状态不变）。
 */
export function buyUpgrade(state: GameState, id: string): GameState | null {
  const price = costOf(id, state.levels[id] ?? 0);
  if (!UPGRADES_HAS(id) || price <= 0) return null;
  if (state.moyu < price) return null;
  return {
    ...state,
    moyu: state.moyu - price,
    levels: { ...state.levels, [id]: (state.levels[id] ?? 0) + 1 },
  };
}

function UPGRADES_HAS(id: string): boolean {
  return UPGRADES.some((u) => u.id === id);
}
