import type { GameState } from "./state";
import { gain } from "./state";
import { clickPowerOf } from "./actions";
import { effectOf } from "./upgrades";

/** 随机事件数值（视觉层读取同一份） */
export const BOSS_INTERVAL_MIN = 90;
export const BOSS_INTERVAL_MAX = 150;
export const BOSS_DURATION = 8;
export const BOSS_PENALTY_RATE = 0.05;
export const BOSS_PENALTY_MIN = 10;
export const BOSS_REWARD_IDLE_SECONDS = 5;
export const BOSS_REWARD_MIN = 50;

export const MEME_INTERVAL_MIN = 45;
export const MEME_INTERVAL_MAX = 75;
export const MEME_DURATION = 5;
export const MEME_REWARD_CLICKS = 5;

export interface EventState {
  nextBossAt: number;
  bossUntil: number;
  nextMemeAt: number;
  memeUntil: number;
  /** 本次巡逻是否已被抓（抓过则无安然奖励） */
  bossCaught: boolean;
}

/** 事件为运行时状态，不入存档 */
export function newEventState(): EventState {
  return { nextBossAt: Infinity, bossUntil: -1, nextMemeAt: Infinity, memeUntil: -1, bossCaught: false };
}

function nextWindow(now: number, min: number, max: number, rng: () => number): number {
  return now + min + rng() * (max - min);
}

/**
 * 每帧调度：窗口结束后排下一次；到期开启窗口。
 * 巡逻与丢梗互斥：仅当自然窗口与巡逻重叠时才推迟丢梗。
 */
export function scheduleEvents(es: EventState, now: number, rng: () => number): void {
  if (es.bossUntil > 0 && now >= es.bossUntil) es.bossUntil = -1;
  if (es.memeUntil > 0 && now >= es.memeUntil) es.memeUntil = -1;
  if (es.nextBossAt === Infinity && es.bossUntil < 0) es.nextBossAt = nextWindow(now, BOSS_INTERVAL_MIN, BOSS_INTERVAL_MAX, rng);
  if (es.nextMemeAt === Infinity && es.memeUntil < 0) {
    let memeAt = nextWindow(now, MEME_INTERVAL_MIN, MEME_INTERVAL_MAX, rng);
    if (es.bossUntil > 0) {
      // 巡逻进行中：推迟到巡逻结束后
      memeAt = Math.max(memeAt, es.bossUntil + MEME_DURATION);
    } else if (Number.isFinite(es.nextBossAt)) {
      const bossStart = es.nextBossAt;
      const overlapsBoss = memeAt < bossStart + BOSS_DURATION && memeAt + MEME_DURATION > bossStart;
      if (overlapsBoss) memeAt = bossStart + BOSS_DURATION + MEME_DURATION;
    }
    es.nextMemeAt = memeAt;
  }
  if (now >= es.nextBossAt && es.bossUntil < 0 && es.memeUntil < 0) {
    es.bossUntil = now + BOSS_DURATION;
    es.bossCaught = false;
    es.nextBossAt = Infinity;
    // 巡逻开启时丢梗必然已结束（互斥条件 memeUntil < 0），无需清场
  } else if (now >= es.nextMemeAt && es.memeUntil < 0 && es.bossUntil < 0) {
    es.memeUntil = now + MEME_DURATION;
    es.nextMemeAt = Infinity;
  }
}

/** 巡逻中点击 = 被逮：扣 max(10, 5% 摸鱼值)；同一巡逻只扣一次（连点无额外伤） */
export function onBossTap(state: GameState, es: EventState): { state: GameState; caught: boolean; lost: number } {
  if (es.bossUntil <= 0) return { state, caught: false, lost: 0 };
  if (es.bossCaught) return { state, caught: false, lost: 0 };
  const lost = Math.max(BOSS_PENALTY_MIN, state.moyu * BOSS_PENALTY_RATE);
  es.bossCaught = true;
  return { state: { ...state, moyu: Math.max(0, state.moyu - lost) }, caught: true, lost };
}

/** 巡逻安然结束奖励：max(50, 20 × idleRate)；被抓过不给 */
export function bossSurviveReward(state: GameState, es?: EventState): number {
  if (es?.bossCaught) return 0;
  const { idleRate } = effectOf(state);
  return Math.max(BOSS_REWARD_MIN, BOSS_REWARD_IDLE_SECONDS * idleRate);
}

/** 丢梗点击奖励：5 × 点击力（仅窗口内有效） */
export function onMemeTap(state: GameState, es: EventState): { state: GameState; earned: number } {
  if (es.memeUntil <= 0) return { state, earned: 0 };
  const earned = MEME_REWARD_CLICKS * clickPowerOf(state);
  es.memeUntil = -1; // 一梗一奖
  return { state: gain(state, earned), earned };
}
