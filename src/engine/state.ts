import type { Collected } from "./collection";
import { emptyCollected } from "./collection";
import type { DailyState } from "./daily";

/** 游戏状态（纯数据，engine 层的唯一事实来源） */
export interface GameState {
  /** 摸鱼值（可花费余额） */
  moyu: number;
  /** 累计获得摸鱼值（含已花费，用于段位） */
  totalEarned: number;
  /** 各升级已购次数 */
  levels: Record<string, number>;
  /** 图鉴收集（语录索引 + 彩蛋索引） */
  collected: Collected;
  /** 每日日报（null = 今日尚未生成） */
  daily: DailyState | null;
  /** 连续安然巡逻次数（入档持久化，被抓清零） */
  surviveStreak: number;
}

export function initialState(): GameState {
  return { moyu: 0, totalEarned: 0, levels: {}, collected: emptyCollected(), daily: null, surviveStreak: 0 };
}

/** 统一的进账入口：余额与累计同步增加（惩罚只扣余额） */
export function gain(state: GameState, amount: number): GameState {
  if (amount <= 0) return state;
  return { ...state, moyu: state.moyu + amount, totalEarned: state.totalEarned + amount };
}
