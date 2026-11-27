import type { GameState } from "./state";
import { gain, lose } from "./state";
import { clickPowerOf, doClick, comboMultiplier } from "./actions";
import { effectOf } from "./upgrades";
import { talentEffects } from "./talents";
import { favorBonuses, teamTraits } from "./team";

/** 随机事件数值（视觉层读取同一份） */
export const BOSS_INTERVAL_MIN = 90;
export const BOSS_INTERVAL_MAX = 150;
export const BOSS_DURATION = 8;
export const BOSS_PENALTY_RATE = 0.05;
export const BOSS_PENALTY_MIN = 10;
/** 罚款封顶：10 秒挂机收益（防后期洗劫，保"早期罚轻、后期不伤筋骨"） */
export const BOSS_PENALTY_CAP_IDLE_SECONDS = 10;
export const BOSS_REWARD_IDLE_SECONDS = 4; // 事件经济红线 <10%：奖励回到 4×挂机秒
export const BOSS_REWARD_MIN = 50;
/** 新手保护：前 N 次巡逻不罚款（只提示） */
export const BOSS_ROOKIE_PATROLS = 3;
/** 反应宽限：横幅弹出到此时间内点击免罚（半空中的手指不算顶风作案）；宽限内不给收入 */
export const BOSS_GRACE_SECONDS = 0.8;
/** 偷点每击罚款 = 0.5 × 挂机秒收益（早期按下限 10）：轻罚但连续偷点会累积，交叉点落在 4-6cps */
export const BOSS_STEAL_PENALTY_IDLE_SECONDS = 0.6;
/** 单次巡逻偷点罚款总封顶 = 6 × 挂机秒收益（防无限罚，仍让 8cps 有赌点） */
export const BOSS_STEAL_CAP_IDLE_SECONDS = 10;
/** 安然连胜：连续安然 N 次奖励 ×(1+0.1N)，封顶 ×2 */
export const SURVIVE_STREAK_CAP = 5; // 连胜封顶 ×1.5（原 ×2 使事件占比超 10%）

/** 巡逻变体（variety #1）：拆掉"同 pattern 忍住 ×N"的重复感 */
export type BossVariant = "hold" | "type" | "blitz";
export const BOSS_VARIANTS: BossVariant[] = ["hold", "type", "blitz"];
/** type：8s 内点满 N 次 → 达标奖励（点击不罚） */
export const BOSS_TYPE_TARGET = 5;
/** blitz：8s 内点满 N 次 → 奖励 ×1.5（点击不罚） */
export const BOSS_BLITZ_TARGET = 16; // R9：20→16（实需 ≈2.3cps，2.5cps 抖动可达成） // 需 ≥2.5cps 才能达标（与 type 的 5 次区分难度）
export const BOSS_BLITZ_REWARD_MULT = 1.5;
/** 变体权重：hold 40% / type 35% / blitz 25% */
export function pickBossVariant(rng: () => number): BossVariant {
  const r = rng();
  if (r < 0.4) return "hold";
  if (r < 0.75) return "type";
  return "blitz";
}

export function surviveStreakMult(n: number): number {
  return 1 + 0.1 * Math.min(n, SURVIVE_STREAK_CAP);
}

export const FIRST_BOSS_MIN = 20;
export const FIRST_BOSS_MAX = 35;
export const FIRST_MEME_MIN = 12;
export const FIRST_MEME_MAX = 25;
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
  /** 本次巡逻变体 */
  bossVariant: BossVariant;
  /** 本次巡逻内的有效点击计数（type/blitz 变体用） */
  bossTaps: number;
  /** 本次巡逻已累计罚款（偷点递增罚的封顶用） */
  bossPenaltyTotal: number;
  /** 累计经历的巡逻次数（新手前 3 次免罚） */
  patrolCount: number;
  /** 累计丢梗次数（首次提前） */
  memeCount: number;
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
    bossVariant: "hold",
    bossTaps: 0,
    bossPenaltyTotal: 0,
    patrolCount: 0,
    memeCount: 0,
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
  if (es.nextBossAt === Infinity && es.bossUntil < 0) {
    // 首次巡逻提前到 20-35s（30 秒短会话也能遇到事件）
    es.nextBossAt =
      es.patrolCount === 0
        ? nextWindow(now, FIRST_BOSS_MIN, FIRST_BOSS_MAX, rng)
        : nextWindow(now, BOSS_INTERVAL_MIN, BOSS_INTERVAL_MAX, rng);
  }
  if (es.nextMemeAt === Infinity && es.memeUntil < 0) {
    let memeAt =
      es.memeCount === 0
        ? nextWindow(now, FIRST_MEME_MIN, FIRST_MEME_MAX, rng)
        : nextWindow(now, MEME_INTERVAL_MIN, MEME_INTERVAL_MAX, rng);
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
    es.bossVariant = pickBossVariant(rng);
    es.bossTaps = 0;
    es.bossPenaltyTotal = 0;
    es.patrolCount += 1;
    es.nextBossAt = Infinity;
    // 巡逻开启时丢梗必然已结束（互斥条件 memeUntil < 0），无需清场
  } else if (now >= es.nextMemeAt && es.memeUntil < 0 && es.bossUntil < 0) {
    es.memeUntil = now + MEME_DURATION;
    es.memeCount += 1;
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
  // 宽限只对 hold（忍住）生效；type/blitz 是"点击任务"，宽限内也要计数（否则玩家点了没反应）
  const isTask = es.bossVariant === "type" || es.bossVariant === "blitz";
  if (!isTask && now < es.bossStartAt + BOSS_GRACE_SECONDS) {
    return { state, caught: false, lost: 0, income: 0 };
  }
  const income = clickPowerOf(state) * comboMultiplier(combo);
  const afterIncome = { ...gain(state, income), totalClicks: state.totalClicks + 1 }; // 偷点也是一次点击
  // type / blitz：反向玩法——点击是任务，不罚，计数
  if (es.bossVariant === "type" || es.bossVariant === "blitz") {
    es.bossTaps += 1;
    return { state: afterIncome, caught: false, lost: 0, income };
  }
  // 新手保护：前 3 次巡逻只提示不罚款（降低"第一次遇到就扣钱"的流失）
  if (es.patrolCount <= BOSS_ROOKIE_PATROLS) {
    return { state: afterIncome, caught: false, lost: 0, income };
  }
  // hold：每偷点一次累加罚款，整段封顶；罚款与余额脱钩（防"花光规避"），只按挂机收益计
  const idleRate = effectOf(afterIncome).idleRate;
  const perTap = Math.max(BOSS_PENALTY_MIN, BOSS_STEAL_PENALTY_IDLE_SECONDS * idleRate);
  const cap = Math.max(BOSS_PENALTY_MIN, BOSS_STEAL_CAP_IDLE_SECONDS * idleRate);
  if (es.bossPenaltyTotal >= cap) {
    return { state: afterIncome, caught: false, lost: 0, income }; // 已罚满封顶
  }
  // 罚款减免：天赋 event_2(-35%) + 强哥被动(-10%)，合计封顶 -60%
  const penaltyCut = Math.min(
    0.6,
    talentEffects(state.talents).penaltyReduction + teamTraits(state).penaltyReduction,
  );
  const due = Math.min(perTap, cap - es.bossPenaltyTotal) * (1 - penaltyCut);
  // 扣款同时扣回累计值（防"零余额偷点刷段位"）；连胜清零立即写回 GameState（防刷新规避）
  const { state: paid, lost } = lose({ ...afterIncome, surviveStreak: 0 }, due);
  es.bossCaught = true;
  es.surviveStreak = 0;
  es.bossPenaltyTotal += lost; // 按实收累计封顶：余额不足时继续从后续收入抵扣（防零余额免罚）
  return { state: paid, caught: true, lost, income };
}

/**
 * 巡逻窗口结束结算：安然 → 发奖（含连胜乘数）并推进连胜；被抓 → 0 奖且连胜清零。
 * 同时复位本巡逻状态，供下一次巡逻使用。
 */
export function finishPatrol(state: GameState, es: EventState): { state: GameState; reward: number } {
  let reward = 0;
  if (es.bossVariant === "type") {
    // 点满 N 次算达标（不罚；没点满只是没奖）
    reward = es.bossTaps >= BOSS_TYPE_TARGET ? bossSurviveReward(state, { ...es, bossCaught: false }) : 0;
  } else if (es.bossVariant === "blitz") {
    reward =
      es.bossTaps >= BOSS_BLITZ_TARGET
        ? bossSurviveReward(state, { ...es, bossCaught: false }) * BOSS_BLITZ_REWARD_MULT
        : 0;
  } else {
    reward = bossSurviveReward(state, es); // hold：忍住才有奖，被抓为 0
  }
  // event_5b：安然额外给 10 秒挂机收益
  const bonusIdleSec = talentEffects(state.talents).surviveBonusIdleSeconds;
  if (reward > 0 && bonusIdleSec > 0) {
    reward += bonusIdleSec * effectOf(state).idleRate;
  }
  const next = gain(state, reward);
  if (reward > 0 && !es.bossCaught) es.surviveStreak += 1;
  es.bossCaught = false;
  es.bossUntil = -1;
  es.bossPenaltyTotal = 0;
  // 连胜入档（刷新/重开不丢）；安然次数累计（事件流 Lv5 转化用）
  const survived = reward > 0 && es.surviveStreak > 0 ? state.patrolSurvives + 1 : state.patrolSurvives;
  return { state: { ...next, surviveStreak: es.surviveStreak, patrolSurvives: survived }, reward };
}

/** 巡逻安然结束奖励：max(50, 5×idleRate) × 连胜乘数（连续安然 N 次 ×(1+0.1N) 封顶 ×2）；被抓过不给 */
export function bossSurviveReward(state: GameState, es?: EventState): number {
  if (es?.bossCaught) return 0;
  const { idleRate } = effectOf(state);
  const base = Math.max(BOSS_REWARD_MIN, BOSS_REWARD_IDLE_SECONDS * idleRate);
  const talent = talentEffects(state.talents);
  return base * surviveStreakMult(es?.surviveStreak ?? 0) * talent.patrolRewardMult;
}

/** 丢梗点击奖励：5 × 点击力（仅窗口内有效） */
export function onMemeTap(state: GameState, es: EventState): { state: GameState; earned: number } {
  if (es.memeUntil <= 0) return { state, earned: 0 };
  const earned =
    MEME_REWARD_CLICKS *
    clickPowerOf(state) *
    talentEffects(state.talents).memeRewardMult *
    favorBonuses(state).memeMult;
  es.memeUntil = -1; // 一梗一奖
  return { state: { ...gain(state, earned), totalClicks: state.totalClicks + 1 }, earned };
}
