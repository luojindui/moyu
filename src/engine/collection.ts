import type { GameState } from "./state";
import { UPGRADES } from "./upgrades";
import { MEME_QUOTES, UPGRADE_FLAVOR } from "./flavor";

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
/** 点击线彩蛋改用累计点击数解锁（解除"后期点击力无用→彩蛋死锁"） */
export const CLICK_TIER_THRESHOLDS = [100, 500, 3000, 8000, 20000];
/** 点击线（有 clickPower 的升级）判定 */
export function isClickLine(id: string): boolean {
  const u = UPGRADES.find((x) => x.id === id);
  return !!u?.clickPower;
}

function tierFor(level: number): number {
  let t = -1;
  TIER_LEVELS.forEach((lv, i) => {
    if (level >= lv) t = i;
  });
  return t;
}

/** 收集一条语录（越界拒绝；重复不重复计） */
export function collectQuote(state: GameState, quoteIdx: number): { state: GameState; isNew: boolean } {
  if (!Number.isInteger(quoteIdx) || quoteIdx < 0 || quoteIdx >= MEME_QUOTES.length) return { state, isNew: false };
  if (state.collected.quotes.includes(quoteIdx)) return { state, isNew: false };
  return {
    state: { ...state, collected: { ...state.collected, quotes: [...state.collected.quotes, quoteIdx] } },
    isNew: true,
  };
}

/** 收集一条彩蛋（未知 id / 越界档位拒绝；重复不重复计） */
export function collectFlavor(state: GameState, upgradeId: string, tier: number): { state: GameState; isNew: boolean } {
  const up = UPGRADES.find((u) => u.id === upgradeId);
  if (!up || !Number.isInteger(tier) || tier < 0 || tier >= 5) return { state, isNew: false };
  const idx = flavorIndex(upgradeId, tier);
  if (state.collected.flavors.includes(idx)) return { state, isNew: false };
  return {
    state: { ...state, collected: { ...state.collected, flavors: [...state.collected.flavors, idx] } },
    isNew: true,
  };
}

/** 按当前进度补齐历史彩蛋档（读档迁移/点击/购买后调用，幂等）：
 *  点击线按累计点击数阈值解锁（修复后期纯挂机导致的高档彩蛋死锁）；挂机线按等级解锁。 */
export function syncFlavorCollection(state: GameState): GameState {
  const missing: number[] = [];
  for (const u of UPGRADES) {
    const maxTier = isClickLine(u.id)
      ? CLICK_TIER_THRESHOLDS.filter((th) => state.totalClicks >= th).length - 1
      : tierFor(state.levels[u.id] ?? 0);
    for (let t = 0; t <= maxTier; t++) {
      const idx = flavorIndex(u.id, t);
      if (!state.collected.flavors.includes(idx)) missing.push(idx);
    }
  }
  const collected = missing.length === 0 ? state.collected : { ...state.collected, flavors: [...state.collected.flavors, ...missing] };
  return collected === state.collected ? state : { ...state, collected };
}

/** 已收集总数（图鉴 x/55）：按去重后的合法条目计数，篡改档自动收敛 */
export function collectionCount(state: GameState): number {
  const quotes = new Set(state.collected.quotes.filter((i) => Number.isInteger(i) && i >= 0 && i < MEME_QUOTES.length));
  const flavors = new Set(
    state.collected.flavors.filter(
      (i) => Number.isInteger(i) && i >= 0 && i < UPGRADES.length * 5, // 彩蛋上界 45（不是 55）
    ),
  );
  return quotes.size + Math.min(flavors.size, UPGRADES.length * 5);
}

/** 存档净化：去重 + 上限裁剪（restore 调用） */
export function sanitizeCollected(raw: { quotes?: unknown; flavors?: unknown } | undefined): Collected {
  const toSet = (arr: unknown, max: number): number[] =>
    Array.isArray(arr)
      ? [...new Set(arr.filter((x): x is number => Number.isInteger(x) && x >= 0 && x < max))].sort((a, b) => a - b)
      : [];
  return {
    quotes: toSet(raw?.quotes, MEME_QUOTES.length),
    flavors: toSet(raw?.flavors, UPGRADES.length * 5),
  };
}

/** 图鉴可浏览列表行（UI 渲染用；未解锁显示 ???） */
export interface CollectionRow {
  group: "quote" | "flavor";
  index: number;
  /** 展示名：语录序号 / 「升级名 · Lv档」 */
  label: string;
  unlocked: boolean;
  text: string;
}

const TIER_LABEL = ["Lv.1", "Lv.5", "Lv.10", "Lv.20", "Lv.50"];

/** 生成 55 格图鉴列表（语录在前、彩蛋在后，各自按索引排序） */
export function collectionRows(state: GameState): CollectionRow[] {
  const rows: CollectionRow[] = [];
  const quotes = new Set(state.collected.quotes);
  MEME_QUOTES.forEach((q, i) => {
    rows.push({
      group: "quote",
      index: i,
      label: `语录 ${i + 1}`,
      unlocked: quotes.has(i),
      text: quotes.has(i) ? q : "???",
    });
  });
  const flavors = new Set(state.collected.flavors);
  UPGRADES.forEach((u, ui) => {
    for (let tier = 0; tier < 5; tier++) {
      const idx = ui * 5 + tier;
      rows.push({
        group: "flavor",
        index: idx,
        label: `${u.name} · ${TIER_LABEL[tier]}`,
        unlocked: flavors.has(idx),
        text: flavors.has(idx) ? (UPGRADE_FLAVOR[u.id]?.[tier] ?? "???") : "???",
      });
    }
  });
  return rows;
}
