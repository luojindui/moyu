/** 游戏状态（纯数据，engine 层的唯一事实来源） */
export interface GameState {
  /** 摸鱼值（可花费余额） */
  moyu: number;
  /** 累计获得摸鱼值（含已花费，用于段位） */
  totalEarned: number;
  /** 各升级已购次数 */
  levels: Record<string, number>;
}

export function initialState(): GameState {
  return { moyu: 0, totalEarned: 0, levels: {} };
}

/** 统一的进账入口：余额与累计同步增加（惩罚只扣余额） */
export function gain(state: GameState, amount: number): GameState {
  if (amount <= 0) return state;
  return { ...state, moyu: state.moyu + amount, totalEarned: state.totalEarned + amount };
}
