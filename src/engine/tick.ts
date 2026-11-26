import type { GameState } from "./state";
import { gain } from "./state";
import { effectOf } from "./upgrades";

/** 推进 dt 秒的被动收益（dt<=0 不变化） */
export function advance(state: GameState, dt: number): GameState {
  if (dt <= 0) return state;
  const { idleRate } = effectOf(state);
  if (idleRate === 0) return state;
  return gain(state, idleRate * dt);
}
