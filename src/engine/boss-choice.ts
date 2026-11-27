import type { GameState } from "./state";

/**
 * 回合制老板（批次 2）：巡逻的第三种形态——限时 3 选 1。
 * 老板有性格，横幅给出"观察线索"，选对应对 → 奖励；选错 → 记过（小罚）。
 */

export type BossPersonality = "hasty" | "suspicious" | "forgetful";
export type BossChoice = "act-busy" | "switch-screen" | "keep-slacking";

export interface PersonalityDef {
  id: BossPersonality;
  name: string;
  /** 线索（玩家据此推断） */
  tell: string;
  /** 正确应对 */
  correct: BossChoice;
}

export const PERSONALITIES: PersonalityDef[] = [
  { id: "hasty", name: "急性子·安总", tell: "他走路带风，两三步就到工位", correct: "act-busy" },
  { id: "suspicious", name: "多疑·王总", tell: "他一路盯着别人屏幕走过来", correct: "switch-screen" },
  { id: "forgetful", name: "健忘·老李", tell: "他边走边看手机，眼神是散的", correct: "keep-slacking" },
];

export const CHOICES: { id: BossChoice; label: string }[] = [
  { id: "act-busy", label: "立刻装忙" },
  { id: "switch-screen", label: "切到工作界面" },
  { id: "keep-slacking", label: "继续摸鱼" },
];

/** 决策窗口（秒）：3 秒决策 + 1 秒缓冲（移动端可读性） */
export const CHOICE_SECONDS = 5;
/** 选对奖励 = 安然巡逻奖励 × 该倍率 */
export const CHOICE_CORRECT_MULT = 2.2;
/** 选错罚款 = 安然奖励的该比例（比被抓好一点） */
export const CHOICE_WRONG_PENALTY_RATIO = 0.6;

export function personalityDef(id: BossPersonality): PersonalityDef {
  return PERSONALITIES.find((p) => p.id === id) ?? PERSONALITIES[0]!;
}

export function choiceLabel(id: BossChoice): string {
  return CHOICES.find((c) => c.id === id)?.label ?? id;
}

/** 该应对是否对应该老板 */
export function isCorrect(personality: BossPersonality, choice: BossChoice): boolean {
  return personalityDef(personality).correct === choice;
}

export interface ChoiceOutcome {
  correct: boolean;
  /** 正数奖励 / 负数罚款（调用方已入账） */
  delta: number;
  state: GameState;
}

/**
 * 结算回合制选择。
 * @param baseReward 同条件下的"安然巡逻"基础奖励（由调用方算好）
 */
export function resolveBossChoice(
  state: GameState,
  personality: BossPersonality,
  choice: BossChoice,
  baseReward: number,
  rookieGrace = false,
): ChoiceOutcome {
  if (isCorrect(personality, choice)) {
    const delta = Math.floor(baseReward * CHOICE_CORRECT_MULT);
    return {
      correct: true,
      delta,
      state: {
        ...state,
        moyu: state.moyu + delta,
        totalEarned: state.totalEarned + delta,
        lifetimeEarned: state.lifetimeEarned + delta,
      },
    };
  }
  // 新手宽限：第一次选错不扣钱（只丢连胜），避免新玩家被清空余额
  const penalty = rookieGrace ? 0 : Math.floor(baseReward * CHOICE_WRONG_PENALTY_RATIO);
  const paid = Math.min(penalty, state.moyu);
  return {
    correct: false,
    delta: -paid,
    state: {
      ...state,
      moyu: state.moyu - paid,
      totalEarned: Math.max(0, state.totalEarned - paid),
    },
  };
}
