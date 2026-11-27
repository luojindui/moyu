import type { GameState } from "./state";
import { gain } from "./state";
import { effectOf, costOf, UPGRADES } from "./upgrades";
import { prestigeMultiplier } from "./prestige";
import { talentEffects } from "./talents";
import { cardEffects } from "./cards";
import { decorEffects } from "./decor";

/** 初始点击力（未买任何升级时） */
export const BASE_CLICK_POWER = 1;

/** 连击链：间隔 <0.4s 累积，1.5s 断点清零；收入 ×(1+0.02×combo) 封顶 ×1.24（12 连击） */
export const COMBO_WINDOW_S = 0.5; // R9：0.4→0.5（2.5cps 抖动也能连上）
export const COMBO_BREAK_S = 1.0; // R9：漏两拍才断（1.5→1.0）
export const COMBO_MAX = 20; // R9：12→20 连

export function comboMultiplier(combo: number, maxCombo: number = COMBO_MAX, perCombo = 0.012): number {
  // 每连 0.012，封顶 ×1.24（天赋 click_3 可提到 30 连）
  return 1 + perCombo * Math.min(Math.max(0, combo), maxCombo);
}

/** 天赋感知的连击上限（click_3：+10） */
export function comboCapOf(state: GameState): number {
  return COMBO_MAX + talentEffects(state.talents).comboMaxBonus;
}

/** 天赋感知的连击窗口（click_2：+0.15s） */
export function comboWindowOf(state: GameState): number {
  return COMBO_WINDOW_S + talentEffects(state.talents).comboWindowBonus;
}

/** 当前总点击力（基础点击力也吃转生倍率） */
export function clickPowerOf(state: GameState): number {
  const base = BASE_CLICK_POWER * prestigeMultiplier(state.prestige) + effectOf(state).clickPower;
  // 天赋：点击流「手速」
  return (
    base *
    talentEffects(state.talents).clickMult *
    cardEffects(state, Date.now()).clickMult *
    decorEffects(state).clickMult
  );
}

/** 点击一次（combo 为当前连击数）：返回新状态 */
export function doClick(state: GameState, combo = 0, critMult = 1): GameState {
  const income = clickPowerOf(state) * comboMultiplier(combo, comboCapOf(state)) * Math.max(1, critMult);
  return { ...gain(state, income), totalClicks: state.totalClicks + 1 };
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
