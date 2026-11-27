import type { GameState } from "./state";
import { grantPrestigeTalentPoints } from "./talents";

/**
 * 离职再就业（转生层，R7 / R8 调参）：
 * 7 天模拟对比：不转 620e8 < 见转 1184e8 < 攒够（≥8 点）再转 2574e8 → 转生应"攒够再转"才划算。
 * 单局累计 ≥1e8 可转生；转生点 = floor(2 × (本局累计/1e8)^0.4)，单局封顶 20；
 * 每点永久 ×1.08 复利。转生重置本局（余额/等级/本局累计），保留图鉴、日报、历史累计、点击数。
 */
export const PRESTIGE_UNLOCK = 1e8;
export const PRESTIGE_POINT_CAP = 20;
/** 可调参数（默认值即产品参数；探针可临时改写做扫描） */
export const PRESTIGE_TUNING = {
  /** 每点永久收益：总倍率 = 1 + perPoint × 累计点数（线性，避免指数爆炸） */
  perPoint: 0.75,
  /** 点数 = floor(gainA × (本局/1e8)^gainB) */
  gainA: 3,
  gainB: 0.4,
  /** 转生保留的等级比例（降低重置损失，避免"越早转越亏"） */
  keepLevelRatio: 0.8,
};
export const PRESTIGE_GAIN_PER_POINT = 0.5;

/** 解锁门槛随当前倍率增长：倍率越高，一次转生需要赚得越多（防止 1e8 无限刷） */
export function prestigeThreshold(state: GameState): number {
  return PRESTIGE_UNLOCK * prestigeMultiplier(state.prestige);
}

export function canPrestige(state: GameState): boolean {
  return state.totalEarned >= prestigeThreshold(state);
}

/** 本次转生可得点数（未达标 0）：floor(3×(本局/1e8)^0.3)，早期就给足，避免"越早转越亏" */
export function prestigeGain(state: GameState): number {
  if (!canPrestige(state)) return 0;
  // 归一化本局收入（除以当前倍率），使"刷到刚好解锁就转"只能拿到 0~1 点
  const normalized = state.totalEarned / (PRESTIGE_UNLOCK * prestigeMultiplier(state.prestige));
  const raw = Math.floor(PRESTIGE_TUNING.gainA * Math.pow(normalized, PRESTIGE_TUNING.gainB));
  return Math.max(1, Math.min(PRESTIGE_POINT_CAP, raw));
}

/** 转生点 → 永久收益倍率（1.08^points） */
export function prestigeMultiplier(points: number): number {
  return 1 + PRESTIGE_TUNING.perPoint * Math.max(0, points);
}

/** 执行转生：返回新状态与本次获得点数（不可转生返回 null） */
export function doPrestige(state: GameState): { state: GameState; gained: number } | null {
  const gained = prestigeGain(state);
  if (gained <= 0) return null;
  return {
    gained,
    state: {
      // 本局重置（保留一半等级，降低重置损失；不依赖 state.ts 运行时导出，避免模块循环）
      moyu: 0,
      totalEarned: 0,
      levels: Object.fromEntries(
        Object.entries(state.levels).map(([k, v]) => [k, Math.floor((v as number) * PRESTIGE_TUNING.keepLevelRatio)]),
      ),
      surviveStreak: 0,
      // 保留跨局资产
      lifetimeEarned: state.lifetimeEarned,
      prestige: state.prestige + gained,
      collected: state.collected,
      daily: state.daily,
      totalClicks: state.totalClicks,
      visits: state.visits,
      // 转生保留小队与天赋，并按次给天赋点
      team: state.team,
      talents: grantPrestigeTalentPoints(state.talents),
      patrolSurvives: state.patrolSurvives,
    },
  };
}
