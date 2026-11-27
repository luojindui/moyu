import type { GameState } from "./state";

/**
 * 成就墙（第 5 批）：给"收集/长线"目标。
 * 每条成就 = 条件 + 进度 + 完成后的一点永久奖励；成就点数累积成"成就等级"。
 * 纯函数：progressOf 只读状态，UI 负责展示。
 */

export type AchCategory = "click" | "idle" | "collect" | "decor" | "team" | "talent" | "rank" | "arcade" | "card" | "boss";

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  category: AchCategory;
  /** 目标值 */
  target: number;
  /** 当前进度（以 target 为满分） */
  progress: (state: GameState) => number;
  /** 完成后奖励：挂机永久 +X（小数） */
  reward?: { idleBonus?: number; clickBonus?: number; offlineBonus?: number };
}

export const ACH_CATEGORY_NAME: Record<AchCategory, string> = {
  click: "点击",
  idle: "挂机",
  collect: "图鉴",
  decor: "工位",
  team: "小队",
  talent: "天赋",
  rank: "段位",
  arcade: "摸鱼站",
  card: "摸鱼卡",
  boss: "老板",
};

const collCount = (s: GameState): number => (s.collected?.quotes.length ?? 0) + (s.collected?.flavors.length ?? 0);
const maxColleagueLevel = (s: GameState): number =>
  Math.max(0, ...Object.values(s.team.colleagues).map((c) => c.level));
const arcadeBest = (s: GameState): number => Math.max(0, ...Object.values(s.arcade.best).map((v) => v ?? 0));

export const ACHIEVEMENTS: AchievementDef[] = [
  // 点击
  { id: "click_1k", name: "手速入门", desc: "累计点击 1,000 次", category: "click", target: 1_000, progress: (s) => s.totalClicks, reward: { clickBonus: 0.02 } },
  { id: "click_10k", name: "键盘杀手", desc: "累计点击 10,000 次", category: "click", target: 10_000, progress: (s) => s.totalClicks, reward: { clickBonus: 0.05 } },
  { id: "click_100k", name: "鼠标终结者", desc: "累计点击 100,000 次", category: "click", target: 100_000, progress: (s) => s.totalClicks, reward: { clickBonus: 0.1 } },
  // 挂机
  { id: "idle_1k", name: "躺平起步", desc: "挂机收益达到 1,000/秒", category: "idle", target: 1_000, progress: (s) => s.bestIdleRate ?? 0, reward: { idleBonus: 0.02 } },
  { id: "idle_1m", name: "摸鱼自由", desc: "挂机收益达到 100万/秒", category: "idle", target: 1_000_000, progress: (s) => s.bestIdleRate ?? 0, reward: { idleBonus: 0.05 } },
  // 图鉴
  { id: "codex_20", name: "收集癖", desc: "解锁 20 格图鉴", category: "collect", target: 20, progress: collCount, reward: { idleBonus: 0.02 } },
  { id: "codex_40", name: "博物学家", desc: "解锁 40 格图鉴", category: "collect", target: 40, progress: collCount, reward: { idleBonus: 0.04 } },
  { id: "codex_55", name: "全图鉴", desc: "解锁全部 55 格图鉴", category: "collect", target: 55, progress: collCount, reward: { idleBonus: 0.08 } },
  // 工位
  { id: "decor_3", name: "开始装修", desc: "装修 3 件工位家具", category: "decor", target: 3, progress: (s) => s.decor.length, reward: { idleBonus: 0.02 } },
  { id: "decor_8", name: "工位大户", desc: "集齐 8 件工位家具", category: "decor", target: 8, progress: (s) => s.decor.length, reward: { idleBonus: 0.05 } },
  // 小队
  { id: "team_1", name: "第一个同事", desc: "招募 1 位同事", category: "team", target: 1, progress: (s) => Object.keys(s.team.colleagues).length, reward: { idleBonus: 0.01 } },
  { id: "team_5", name: "满编小队", desc: "招募全部 5 位同事", category: "team", target: 5, progress: (s) => Object.keys(s.team.colleagues).length, reward: { idleBonus: 0.04 } },
  { id: "team_lv5", name: "资深团队", desc: "任一同事升到 5 级", category: "team", target: 5, progress: maxColleagueLevel, reward: { idleBonus: 0.03 } },
  // 天赋
  { id: "talent_6", name: "初窥门径", desc: "解锁 6 个天赋", category: "talent", target: 6, progress: (s) => s.talents.unlocked.length, reward: { idleBonus: 0.02 } },
  { id: "talent_18", name: "天赋满树", desc: "解锁 13 个天赋（24 点数可达上限）", category: "talent", target: 13, progress: (s) => s.talents.unlocked.length, reward: { idleBonus: 0.05 } },
  // 段位
  { id: "rank_7", name: "中层摸鱼", desc: "达到第 7 段位", category: "rank", target: 7, progress: (s) => s.rankIndex ?? 0, reward: { idleBonus: 0.02 } },
  { id: "rank_14", name: "宇宙尽头", desc: "达到第 14 段位（最高档）", category: "rank", target: 14, progress: (s) => s.rankIndex ?? 0, reward: { idleBonus: 0.05 } },
  // 摸鱼站
  { id: "arcade_500", name: "街机新手", desc: "任一游戏最高分 500", category: "arcade", target: 500, progress: arcadeBest, reward: { clickBonus: 0.02 } },
  { id: "arcade_2000", name: "街机高手", desc: "任一游戏最高分 2,000", category: "arcade", target: 2_000, progress: arcadeBest, reward: { idleBonus: 0.03 } },
  // 摸鱼卡
  { id: "card_5", name: "今日宜摸鱼", desc: "累计选卡 5 次", category: "card", target: 5, progress: (s) => s.cardsChosenTotal ?? 0, reward: { idleBonus: 0.01 } },
  // 老板
  { id: "boss_3", name: "老油条", desc: "巡逻连胜 3 次", category: "boss", target: 3, progress: (s) => s.bestSurviveStreak ?? s.surviveStreak, reward: { idleBonus: 0.02 } },
  { id: "boss_10", name: "摸鱼之王", desc: "巡逻连胜 10 次", category: "boss", target: 10, progress: (s) => s.bestSurviveStreak ?? s.surviveStreak, reward: { idleBonus: 0.04 } },
];

export function achById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** 成就是否完成 */
export function achDone(def: AchievementDef, state: GameState): boolean {
  return def.progress(state) >= def.target;
}

/** 已完成数量 */
export function achDoneCount(state: GameState): number {
  return ACHIEVEMENTS.filter((a) => achDone(a, state)).length;
}

/** 成就点数（每条 1 分） */
export function achPoints(state: GameState): number {
  return achDoneCount(state);
}

/** 成就等级：每 4 条 1 级 */
export function achLevel(state: GameState): number {
  return Math.floor(achPoints(state) / 4) + 1;
}

export interface AchEffects {
  idleMult: number;
  clickMult: number;
  offlineBonus: number;
}

/** 已完成成就的永久加成汇总 */
export function achEffects(state: GameState): AchEffects {
  const out: AchEffects = { idleMult: 1, clickMult: 1, offlineBonus: 0 };
  // 成就等级本身也给收益：每级 +2% 挂机（Lv.1 起算），避免"等级只是好看的数字"
  out.idleMult *= 1 + 0.02 * (achLevel(state) - 1);
  for (const a of ACHIEVEMENTS) {
    if (!achDone(a, state) || !a.reward) continue;
    if (a.reward.idleBonus) out.idleMult *= 1 + a.reward.idleBonus;
    if (a.reward.clickBonus) out.clickMult *= 1 + a.reward.clickBonus;
    if (a.reward.offlineBonus) out.offlineBonus += a.reward.offlineBonus;
  }
  return out;
}

/** 分类进度（用于成就墙分组显示） */
export function achByCategory(state: GameState): Array<{ cat: AchCategory; done: number; total: number }> {
  const cats = [...new Set(ACHIEVEMENTS.map((a) => a.category))];
  return cats.map((cat) => {
    const list = ACHIEVEMENTS.filter((a) => a.category === cat);
    return { cat, done: list.filter((a) => achDone(a, state)).length, total: list.length };
  });
}
