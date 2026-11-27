import type { GameState } from "./state";
import { prestigeMultiplier } from "./prestige";

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  baseCost: number;
  clickPower?: number;
  idleRate?: number;
}

/** 里程碑：每满 20 级该项效果 ×2，错峰偏移 (表序%4)×5 级（脉冲错开空谷） */
export const MILESTONE_LEVELS = 20;
export const MILESTONE_OFFSET_STEP = 5;

/** 工位底薪：无条件基础挂机（修纯挂机党死局，对点击党零副作用） */
export const BASE_IDLE_RATE = 0.2;

/**
 * 摸鱼主题升级表（optimizer 批次3 方案）：
 * 点击线 咖啡15/喝水100/老板椅800；挂机线 刷手机50/蹲坑600/群聊4000/会议25000/深摸150000/躺平1000000
 */
export const UPGRADES: UpgradeDef[] = [
  { id: "coffee", name: "咖啡续命", desc: "点击力 +1", baseCost: 15, clickPower: 1 },
  { id: "water", name: "带薪喝水", desc: "点击力 +2", baseCost: 100, clickPower: 2 },
  { id: "chair", name: "人体工学椅", desc: "点击力 +5", baseCost: 800, clickPower: 5 },
  { id: "phone", name: "刷手机", desc: "挂机 +1/秒", baseCost: 50, idleRate: 1 },
  { id: "toilet", name: "带薪蹲坑", desc: "挂机 +5/秒", baseCost: 600, idleRate: 5 },
  { id: "group", name: "摸鱼群聊", desc: "挂机 +15/秒", baseCost: 4000, idleRate: 15 },
  { id: "meeting", name: "无用会议", desc: "挂机 +50/秒", baseCost: 25000, idleRate: 50 },
  { id: "deep", name: "深度摸鱼", desc: "挂机 +180/秒", baseCost: 150000, idleRate: 180 },
  { id: "retire", name: "退休式躺平", desc: "挂机 +700/秒", baseCost: 1000000, idleRate: 700 },
];

/** 各升级的里程碑偏移（表序 %4 × 5，脉冲错峰） */
const MILESTONE_OFFSET: Record<string, number> = {};
UPGRADES.forEach((u, i) => {
  MILESTONE_OFFSET[u.id] = (i % 4) * MILESTONE_OFFSET_STEP;
});

/** 当前等级的购买价：base × 1.15^level，向上取整 */
export function costOf(id: string, level: number): number {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) return 0;
  return Math.ceil(u.baseCost * 1.15 ** level);
}

function milestoneMult(level: number, offset: number): number {
  return 2 ** Math.floor((level + offset) / MILESTONE_LEVELS);
}

/** 等级 → 该项当前效果（base × lv × 2^⌊(lv+偏移)/20⌋） */
function effectAt(u: UpgradeDef, level: number): number {
  if (level <= 0) return 0;
  return (u.clickPower ?? u.idleRate ?? 0) * level * milestoneMult(level, MILESTONE_OFFSET[u.id] ?? 0);
}

/** 图鉴集满 55/55 的永久挂机加成（1.2×） */
const COLLECTION_TOTAL = 55;
function collectionBonus(state: GameState): number {
  const n = state.collected.quotes.length + state.collected.flavors.length;
  return n >= COLLECTION_TOTAL ? 1.2 : 1;
}

/** 状态合计加成（含底薪） */
export function effectOf(state: GameState): { clickPower: number; idleRate: number } {
  let clickPower = 0;
  let idleRate = BASE_IDLE_RATE;
  for (const u of UPGRADES) {
    const lv = state.levels[u.id] ?? 0;
    if (lv <= 0) continue;
    if (u.clickPower) clickPower += effectAt(u, lv);
    if (u.idleRate) idleRate += effectAt(u, lv);
  }
  const mult = prestigeMultiplier(state.prestige) * collectionBonus(state);
  return { clickPower: clickPower * mult, idleRate: idleRate * mult };
}

/** 下一级（level → level+1）的即时效果增量（含里程碑跳变） */
export function marginalEffect(id: string, level: number): { clickPower: number; idleRate: number } {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) return { clickPower: 0, idleRate: 0 };
  const before = effectAt(u, level);
  const after = effectAt(u, level + 1);
  return {
    clickPower: u.clickPower ? after - before : 0,
    idleRate: u.idleRate ? after - before : 0,
  };
}

/** 距离下次里程碑 ×2 还差几级（含错峰偏移） */
export function milestoneGap(id: string, level: number): number {
  if (!UPGRADES.some((u) => u.id === id)) return 0;
  const offset = MILESTONE_OFFSET[id] ?? 0;
  return MILESTONE_LEVELS - ((level + offset) % MILESTONE_LEVELS);
}

/**
 * 性价比：每 1 万摸鱼值换到的边际效果。
 * 点击项与挂机项是两个维度（点击向/挂机向），同维度内可横向比较。
 */
export function valueScoreOf(id: string, level: number): { click: number; idle: number } {
  const price = costOf(id, level);
  if (price <= 0) return { click: 0, idle: 0 };
  const m = marginalEffect(id, level);
  return { click: (m.clickPower / price) * 10_000, idle: (m.idleRate / price) * 10_000 };
}
