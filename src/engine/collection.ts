import type { GameState } from "./state";
import { UPGRADES } from "./upgrades";
import { MEME_QUOTES } from "./flavor";

/** 图鉴：丢梗语录 + 升级彩蛋 统一收集册 */
export interface Collected {
  quotes: number[];
  flavors: number[];
}

export function emptyCollected(): Collected {
  return { quotes: [], flavors: [] };
}

/** 语录/彩蛋总量（图鉴分母） */
export const TOTAL_ITEMS: number = MEME_QUOTES.length + UPGRADES.length * 5;

/** 升级表序 × 档位 → 全局彩蛋索引（0..44） */
export function flavorIndex(upgradeId: string, tier: number): number {
  const idx = UPGRADES.findIndex((u) => u.id === upgradeId);
  return idx * 5 + tier;
}

/** 档位阈值（Lv.1/5/10/20/50）对应的 tier 序号 */
const TIER_LEVELS = [1, 5, 10, 20, 50];

function tierFor(level: number): number {
  let t = -1;
  TIER_LEVELS.forEach((lv, i) => {
    if (level >= lv) t = i;
  });
  return t;
}

/** 收集一条语录（重复不重复计） */
export function collectQuote(state: GameState, quoteIdx: number): { state: GameState; isNew: boolean } {
  if (state.collected.quotes.includes(quoteIdx)) return { state, isNew: false };
  return {
    state: { ...state, collected: { ...state.collected, quotes: [...state.collected.quotes, quoteIdx] } },
    isNew: true,
  };
}

/** 收集一条彩蛋（重复不重复计） */
export function collectFlavor(state: GameState, upgradeId: string, tier: number): { state: GameState; isNew: boolean } {
  const idx = flavorIndex(upgradeId, tier);
  if (state.collected.flavors.includes(idx)) return { state, isNew: false };
  return {
    state: { ...state, collected: { ...state.collected, flavors: [...state.collected.flavors, idx] } },
    isNew: true,
  };
}

/** 按当前等级补齐历史彩蛋档（读档迁移/购买后调用，幂等） */
export function syncFlavorCollection(state: GameState): GameState {
  const missing: number[] = [];
  for (const u of UPGRADES) {
    const lv = state.levels[u.id] ?? 0;
    const maxTier = tierFor(lv);
    for (let t = 0; t <= maxTier; t++) {
      const idx = flavorIndex(u.id, t);
      if (!state.collected.flavors.includes(idx)) missing.push(idx);
    }
  }
  if (missing.length === 0) return state;
  return { ...state, collected: { ...state.collected, flavors: [...state.collected.flavors, ...missing] } };
}

/** 已收集总数（图鉴 x/55） */
export function collectionCount(state: GameState): number {
  return state.collected.quotes.length + state.collected.flavors.length;
}
