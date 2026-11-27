import type { GameState } from "./state";

/**
 * 每日事件卡（批次 2）：每天抽 3 张，选 1 张生效到当天结束。
 * 卡有增益/风险两种，部分卡带剧情后续（明天可能出新卡）。
 * 设计目标：给玩家"每天打开时的一次决策"，而不是纯挂机。
 */

export type CardRarity = "common" | "rare" | "event";

export interface CardDef {
  id: string;
  name: string;
  desc: string;
  rarity: CardRarity;
  /** 持续秒数（默认到当天结束，这里用固定 24h） */
  duration: number;
  /** 效果：挂机倍率 / 点击倍率 / 离线效率加成 / 巡逻奖励倍率 / 派遣奖励倍率 / 事件频率倍率 */
  effects: Partial<{
    idleMult: number;
    clickMult: number;
    offlineBonus: number;
    patrolRewardMult: number;
    dispatchRewardMult: number;
    eventRateMult: number;
    riskPenalty: number;
  }>;
  /** 剧情提示（显示在卡面） */
  flavor: string;
}

export const CARD_DURATION = 24 * 3600;

export const CARDS: CardDef[] = [
  // ---------- 稳健（纯增益，小幅） ----------
  {
    id: "coffee_day",
    name: "咖啡管够",
    desc: "今天挂机 +15%",
    rarity: "common",
    duration: CARD_DURATION,
    effects: { idleMult: 1.15 },
    flavor: "行政说咖啡机修好了，全组沸腾。",
  },
  {
    id: "quiet_day",
    name: "老板出差",
    desc: "今天巡逻奖励 +50%，且巡逻来得多 30%",
    rarity: "common",
    duration: CARD_DURATION,
    effects: { patrolRewardMult: 1.5, eventRateMult: 1.3 },
    flavor: "王总的工位空了，但没人敢摸得太明显。",
  },
  {
    id: "early_leave",
    name: "提前下班",
    desc: "今天离线效率 +15%",
    rarity: "common",
    duration: CARD_DURATION,
    effects: { offlineBonus: 0.15 },
    flavor: "今天可以准点走——这种事要记下来。",
  },
  {
    id: "click_frenzy",
    name: "手速上头",
    desc: "今天点击力 +80%",
    rarity: "common",
    duration: CARD_DURATION,
    effects: { clickMult: 1.8 },
    flavor: "键盘声比平时快了三个度，隔壁老周抬头看了你一眼。",
  },
  {
    id: "team_bond",
    name: "团建吃饭",
    desc: "今天派遣奖励 +40%",
    rarity: "common",
    duration: CARD_DURATION,
    effects: { dispatchRewardMult: 1.4 },
    flavor: "饭桌上大家聊得很开心，任务也好派了。",
  },

  // ---------- 稀有（强增益） ----------
  {
    id: "overtime",
    name: "通宵摸鱼",
    desc: "今天挂机 +60%，代价是接下来 24h 离线效率 -20%",
    rarity: "rare",
    duration: CARD_DURATION,
    effects: { idleMult: 1.6, riskPenalty: 0.2 },
    flavor: "公司网速最快的时段，只有你知道。",
  },
  {
    id: "big_meeting",
    name: "全员大会",
    desc: "今天巡逻奖励 ×2，且巡逻明显变密",
    rarity: "rare",
    duration: CARD_DURATION,
    effects: { patrolRewardMult: 2, eventRateMult: 2 },
    flavor: "会议室里没人听，全在底下摸鱼。",
  },
  {
    id: "secret_project",
    name: "秘密项目",
    desc: "今天点击力 ×2，派遣奖励 +30%",
    rarity: "rare",
    duration: CARD_DURATION,
    effects: { clickMult: 2, dispatchRewardMult: 1.3 },
    flavor: "没人知道你在做什么，但看起来很重要。",
  },

  // ---------- 剧情事件（有后续） ----------
  {
    id: "hr_talk",
    name: "HR 约谈",
    desc: "今天挂机 -10%，明天卡池保证出一张稀有卡",
    rarity: "event",
    duration: CARD_DURATION,
    effects: { idleMult: 0.9 },
    flavor: "小美说：别紧张，就是随便聊聊。",
  },
  {
    id: "old_zhou_secret",
    name: "老周的秘密",
    desc: "今天派遣奖励 ×1.8，且领奖好感 +1",
    rarity: "event",
    duration: CARD_DURATION,
    effects: { dispatchRewardMult: 1.8 },
    flavor: "他说他其实写过一个小说，主角是我们部门。",
  },
];

export interface CardState {
  /** 当天日期（YYYY-MM-DD） */
  date: string;
  /** 今天可选的三张卡 */
  offers: string[];
  /** 已选卡（null = 未选） */
  chosen: string | null;
  /** 选卡生效截止时间（ms） */
  until: number;
  /** 明天的保底卡（剧情链） */
  nextDayGuaranteed: string | null;
  /** 当天是否已被玩家"今天先不选"（防止每帧重开） */
  dismissed: boolean;
}

export function emptyCardState(date = ""): CardState {
  return { date, offers: [], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: false };
}

function rngPick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

/** 抽取当天 3 张卡（稀有度加权；同一天不重复） */
export function rollOffers(date: string, rng: () => number, guaranteed?: string | null): CardState {
  const picks: string[] = [];
  if (guaranteed) {
    const g = CARDS.find((c) => c.id === guaranteed);
    if (g) picks.push(g.id);
  }
  const pool = CARDS.filter((c) => !picks.includes(c.id));
  while (picks.length < 3 && pool.length > 0) {
    // 稀有/剧情卡权重 1，普通卡权重 3
    const weighted: CardDef[] = [];
    for (const c of pool) {
      const w = c.rarity === "common" ? 3 : 1;
      for (let i = 0; i < w; i++) weighted.push(c);
    }
    const pick = rngPick(weighted, rng);
    const idx = pool.indexOf(pick);
    if (idx >= 0) pool.splice(idx, 1);
    if (!picks.includes(pick.id)) picks.push(pick.id);
  }
  return {
    date,
    offers: picks,
    chosen: null,
    until: 0,
    nextDayGuaranteed: guaranteed === "hr_talk" ? "secret_project" : null,
    dismissed: false,
  };
}

/** 选卡（一天只能选一次）；返回新状态 */
export function chooseCard(state: GameState, id: string, nowMs: number): GameState | null {
  const cs = state.cards;
  if (!cs || cs.chosen) return null;
  if (!cs.offers.includes(id)) return null;
  const def = CARDS.find((c) => c.id === id);
  if (!def) return null;
  // 剧情链：选了 HR 约谈 → 明天保底「升职机会」（promotion 卡在扩展池里，这里先用 big_meeting 代替）
  return {
    ...state,
    cards: {
      ...cs,
      chosen: id,
      until: nowMs + CARD_DURATION * 1000,
      nextDayGuaranteed: id === "hr_talk" ? "secret_project" : null,
    },
  };
}

/** 玩家选择"今天先不选" */
export function dismissCards(state: GameState): GameState {
  if (!state.cards) return state;
  return { ...state, cards: { ...state.cards, dismissed: true } };
}

/** 当天生效的卡（过期返回 null） */
export function activeCard(state: GameState, nowMs: number): CardDef | null {
  const cs = state.cards;
  if (!cs || !cs.chosen) return null;
  if (nowMs >= cs.until) return null;
  return CARDS.find((c) => c.id === cs.chosen) ?? null;
}

/** 卡效果汇总（供 engine 各系统读取） */
export interface CardEffects {
  idleMult: number;
  clickMult: number;
  offlineBonus: number;
  patrolRewardMult: number;
  dispatchRewardMult: number;
  eventRateMult: number;
  riskPenalty: number;
}

export function cardEffects(state: GameState, nowMs: number): CardEffects {
  const card = activeCard(state, nowMs);
  const e = card?.effects ?? {};
  return {
    idleMult: e.idleMult ?? 1,
    clickMult: e.clickMult ?? 1,
    offlineBonus: e.offlineBonus ?? 0,
    patrolRewardMult: e.patrolRewardMult ?? 1,
    dispatchRewardMult: e.dispatchRewardMult ?? 1,
    eventRateMult: e.eventRateMult ?? 1,
    riskPenalty: e.riskPenalty ?? 0,
  };
}

/** 每天首次打开时刷新卡池（幂等） */
export function ensureCards(state: GameState, today: string, rng: () => number, nowMs: number): GameState {
  const cs = state.cards;
  // 同一张已选卡 24h 内跨天仍有效：只更新 date，不重抽
  if (cs?.chosen && cs.until > nowMs) {
    if (cs.date === today) return state;
    return { ...state, cards: { ...cs, date: today } };
  }
  if (cs && cs.date === today) return state; // 同日不重抽
  const guaranteed = cs?.nextDayGuaranteed ?? null;
  return { ...state, cards: rollOffers(today, rng, guaranteed) };
}
