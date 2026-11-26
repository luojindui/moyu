import type { GameState } from "./state";
import { offlineEarn, OFFLINE_CAP_SECONDS } from "./offline";

/**
 * 切后台回归结算（visibilitychange → visible 时调用）。
 * rAF 在后台被浏览器暂停，dt 钳制会吞掉离开时长——必须按真实时钟差补算。
 */
export const RESUME_SETTLE_THRESHOLD_SECONDS = 5;

export interface ResumeResult {
  /** 实际结算秒数（0 = 无需结算） */
  applied: number;
  /** 结算获得的摸鱼值 */
  earned: number;
  /** 是否弹"欢迎回来"面板（仅明显离场时） */
  showPanel: boolean;
  /** 结算后的新状态（未结算时为原引用） */
  state: GameState;
}

/** lastActiveMs/nowMs 均为 Date.now() 毫秒时钟 */
export function settleReturn(state: GameState, lastActiveMs: number, nowMs: number): ResumeResult {
  const gap = Math.max(0, (nowMs - lastActiveMs) / 1000);
  if (gap < RESUME_SETTLE_THRESHOLD_SECONDS) {
    return { applied: 0, earned: 0, showPanel: false, state };
  }
  const r = offlineEarn(state, gap);
  return {
    applied: r.applied,
    earned: r.earned,
    showPanel: r.earned > 0,
    state: r.state,
  };
}

export { OFFLINE_CAP_SECONDS };
