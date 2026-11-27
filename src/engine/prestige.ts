import type { GameState } from "./state";

/**
 * 离职再就业（转生层，R7）：
 * 单局累计 ≥1e8 可转生；转生点 = floor(2 × (本局累计/1e8)^0.4)，单局封顶 20；
 * 每点永久 ×1.08 复利。转生重置本局（余额/等级/本局累计），保留图鉴、日报、历史累计、点击数。
 */
export const PRESTIGE_UNLOCK = 1e8;
export const PRESTIGE_POINT_CAP = 20;
export const PRESTIGE_GAIN_PER_POINT = 0.08;

export function canPrestige(state: GameState): boolean {
  return state.totalEarned >= PRESTIGE_UNLOCK;
}

/** 本次转生可得点数（未达标 0） */
export function prestigeGain(state: GameState): number {
  if (!canPrestige(state)) return 0;
  const raw = Math.floor(2 * Math.pow(state.totalEarned / PRESTIGE_UNLOCK, 0.4));
  return Math.max(1, Math.min(PRESTIGE_POINT_CAP, raw));
}

/** 转生点 → 永久收益倍率（1.08^points） */
export function prestigeMultiplier(points: number): number {
  return Math.pow(1 + PRESTIGE_GAIN_PER_POINT, Math.max(0, points));
}

/** 执行转生：返回新状态与本次获得点数（不可转生返回 null） */
export function doPrestige(state: GameState): { state: GameState; gained: number } | null {
  const gained = prestigeGain(state);
  if (gained <= 0) return null;
  return {
    gained,
    state: {
      // 本局重置（不依赖 state.ts 的运行时导出，避免模块循环）
      moyu: 0,
      totalEarned: 0,
      levels: {},
      surviveStreak: 0,
      // 保留跨局资产
      lifetimeEarned: state.lifetimeEarned,
      prestige: state.prestige + gained,
      collected: state.collected,
      daily: state.daily,
      totalClicks: state.totalClicks,
      visits: state.visits,
    },
  };
}
