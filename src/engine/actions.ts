import type { GameState } from "./state";
import { gain } from "./state";
import { effectOf, costOf, UPGRADES } from "./upgrades";

/** 初始点击力（未买任何升级时） */
export const BASE_CLICK_POWER = 1;

/** 当前总点击力 */
export function clickPowerOf(state: GameState): number {
  return BASE_CLICK_POWER + effectOf(state).clickPower;
}

/** 点击一次：返回新状态（摸鱼值 + 总点击力） */
export function doClick(state: GameState): GameState {
  return gain(state, clickPowerOf(state));
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
