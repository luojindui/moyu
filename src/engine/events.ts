import type { GameState } from "./state";
import { gain } from "./state";
import { clickPowerOf, doClick, comboMultiplier } from "./actions";
import { effectOf } from "./upgrades";

/** 随机事件数值（视觉层读取同一份） */
export const BOSS_INTERVAL_MIN = 90;
export const BOSS_INTERVAL_MAX = 150;
export const BOSS_DURATION = 8;
export const BOSS_PENALTY_RATE = 0.05;
export const BOSS_PENALTY_MIN = 10;
/** 罚款封顶：10 秒挂机收益（防后期洗劫，保"早期罚轻、后期不伤筋骨"） */
export const BOSS_PENALTY_CAP_IDLE_SECONDS = 10;
export const BOSS_REWARD_IDLE_SECONDS = 5;
export const BOSS_REWARD_MIN = 50;
/** 反应宽限：横幅弹出到此时间内点击免罚（半空中的手指不算顶风作案） */
export const BOSS_GRACE_SECONDS = 0.8;
/** 安然连胜：连续安然 N 次奖励 ×(1+0.1N)，封顶 ×2 */
export const SURVIVE_STREAK_CAP = 10;

export function surviveStreakMult(n: number): number {
  return 1 + 0.1 * Math.min(n, SURVIVE_STREAK_CAP);
}

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
  /** 本次巡逻开启时刻（宽限判定用） */
  bossStartAt: number;
  /** 连续安然次数（被抓清零，奖励乘 ×(1+0.1N) 封顶 ×2） */
  surviveStreak: number;
}

/** 事件为运行时状态，不入存档 */
export function newEventState(): EventState {
  return {
    nextBossAt: Infinity,
    bossUntil: -1,
    nextMemeAt: Infinity,
    memeUntil: -1,
    bossCaught: false,
    bossStartAt: 0,
    surviveStreak: 0,
  };
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
    es.bossStartAt = now;
    es.bossCaught = false;
    es.nextBossAt = Infinity;
    // 巡逻开启时丢梗必然已结束（互斥条件 memeUntil < 0），无需清场
  } else if (now >= es.nextMemeAt && es.memeUntil < 0 && es.bossUntil < 0) {
    es.memeUntil = now + MEME_DURATION;
    es.nextMemeAt = Infinity;
  }
}

/**
 * 巡逻中点击「偷点」（challenger #1 真赌点）：
 * ①照常获得点击收入（含连击加成）；②过了宽限期且本巡逻未被抓 → 扣罚款一次。
 * 盈亏线约在点击力 > 罚款封顶时（高点击力流派赌得划算），低点击力自动落在"忍"侧。
 */
export function onBossTap(
  state: GameState,
  es: EventState,
  now: number,
  combo = 0,
): { state: GameState; caught: boolean; lost: number; income: number } {
  if (es.bossUntil <= 0) {
    return { state: doClick(state, combo), caught: false, lost: 0, income: clickPowerOf(state) * comboMultiplier(combo) };
  }
  const income = clickPowerOf(state) * comboMultiplier(combo);
  const afterIncome = gain(state, income); // 偷点收入照给
  if (es.bossCaught) return { state: afterIncome, caught: false, lost: 0, income };
  if (now < es.bossStartAt + BOSS_GRACE_SECONDS) {
    return { state: afterIncome, caught: false, lost: 0, income };
  }
  const raw = Math.max(BOSS_PENALTY_MIN, afterIncome.moyu * BOSS_PENALTY_RATE);
  const cap = Math.max(BOSS_PENALTY_MIN, BOSS_PENALTY_CAP_IDLE_SECONDS * effectOf(afterIncome).idleRate);
  const lost = Math.min(raw, cap, afterIncome.moyu); // 汇报口径 = 实扣金额
  es.bossCaught = true;
  es.surviveStreak = 0; // 被抓清零连胜
  return { state: { ...afterIncome, moyu: afterIncome.moyu - lost }, caught: true, lost, income };
}

/**
 * 巡逻窗口结束结算：安然 → 发奖（含连胜乘数）并推进连胜；被抓 → 0 奖且连胜清零。
 * 同时复位本巡逻状态，供下一次巡逻使用。
 */
export function finishPatrol(state: GameState, es: EventState): { state: GameState; reward: number } {
  const reward = bossSurviveReward(state, es);
  const next = gain(state, reward);
  if (reward > 0 && !es.bossCaught) es.surviveStreak += 1;
  es.bossCaught = false;
  es.bossUntil = -1;
  return { state: next, reward };
}

/** 巡逻安然结束奖励：max(50, 5×idleRate) × 连胜乘数（连续安然 N 次 ×(1+0.1N) 封顶 ×2）；被抓过不给 */
export function bossSurviveReward(state: GameState, es?: EventState): number {
  if (es?.bossCaught) return 0;
  const { idleRate } = effectOf(state);
  const base = Math.max(BOSS_REWARD_MIN, BOSS_REWARD_IDLE_SECONDS * idleRate);
  return base * surviveStreakMult(es?.surviveStreak ?? 0);
}

/** 丢梗点击奖励：5 × 点击力（仅窗口内有效） */
export function onMemeTap(state: GameState, es: EventState): { state: GameState; earned: number } {
  if (es.memeUntil <= 0) return { state, earned: 0 };
  const earned = MEME_REWARD_CLICKS * clickPowerOf(state);
  es.memeUntil = -1; // 一梗一奖
  return { state: gain(state, earned), earned };
}
