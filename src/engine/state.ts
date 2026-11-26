/** 游戏状态（纯数据，engine 层的唯一事实来源） */
export interface GameState {
  /** 摸鱼值 */
  moyu: number;
  /** 各升级已购次数 */
  levels: Record<string, number>;
}

export function initialState(): GameState {
  return { moyu: 0, levels: {} };
}
