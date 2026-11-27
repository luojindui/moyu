import type { GameState } from "./state";
import { effectOf, costOf, UPGRADES } from "./upgrades";
import { rankFor } from "./titles";
import { prestigeMultiplier } from "./prestige";
import { collectionCount, TOTAL_ITEMS } from "./collection";

/** 统计面板数据（全部由现有字段推导，零新增存档字段） */
export interface Stats {
  lifetime: number;
  run: number;
  previous: number;
  balance: number;
  invested: number;
  idleRate: number;
  clickPower: number;
  totalClicks: number;
  visits: number;
  streak: number;
  rank: string;
  rankProgress: number;
  collection: number;
  collectionTotal: number;
  prestige: number;
  prestigeMult: number;
}

/** 已投入摸鱼值 = Σ 每个升级历次购买价格 */
export function investedOf(state: GameState): number {
  let sum = 0;
  for (const u of UPGRADES) {
    const lv = state.levels[u.id] ?? 0;
    for (let i = 0; i < lv; i++) sum += costOf(u.id, i);
  }
  return sum;
}

export function computeStats(state: GameState): Stats {
  const rank = rankFor(state.lifetimeEarned);
  const eff = effectOf(state);
  return {
    lifetime: state.lifetimeEarned,
    run: state.totalEarned,
    previous: Math.max(0, state.lifetimeEarned - state.totalEarned),
    balance: state.moyu,
    invested: investedOf(state),
    idleRate: eff.idleRate,
    clickPower: eff.clickPower + 1,
    totalClicks: state.totalClicks,
    visits: state.visits.count,
    streak: state.daily?.streak ?? 0,
    rank: rank.current,
    rankProgress: rank.progress,
    collection: collectionCount(state),
    collectionTotal: TOTAL_ITEMS,
    prestige: state.prestige,
    prestigeMult: prestigeMultiplier(state.prestige),
  };
}
