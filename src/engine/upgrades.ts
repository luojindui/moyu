import type { GameState } from "./state";

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  baseCost: number;
  clickPower?: number;
  idleRate?: number;
}

/** 摸鱼主题升级表（纯数据） */
export const UPGRADES: UpgradeDef[] = [
  { id: "coffee", name: "咖啡续命", desc: "点击力 +1", baseCost: 15, clickPower: 1 },
  { id: "water", name: "带薪喝水", desc: "点击力 +2", baseCost: 100, clickPower: 2 },
  { id: "phone", name: "刷手机", desc: "挂机 +1/秒", baseCost: 50, idleRate: 1 },
  { id: "toilet", name: "带薪蹲坑", desc: "挂机 +3/秒", baseCost: 300, idleRate: 3 },
  { id: "group", name: "摸鱼群聊", desc: "挂机 +8/秒", baseCost: 1200, idleRate: 8 },
  { id: "meeting", name: "无用会议", desc: "挂机 +25/秒", baseCost: 6000, idleRate: 25 },
];

/** 当前等级的购买价：base × 1.15^level，向上取整 */
export function costOf(id: string, level: number): number {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) return 0;
  return Math.ceil(u.baseCost * 1.15 ** level);
}

/** 状态合计加成 */
export function effectOf(state: GameState): { clickPower: number; idleRate: number } {
  let clickPower = 0;
  let idleRate = 0;
  for (const u of UPGRADES) {
    const lv = state.levels[u.id] ?? 0;
    if (lv <= 0) continue;
    clickPower += (u.clickPower ?? 0) * lv;
    idleRate += (u.idleRate ?? 0) * lv;
  }
  return { clickPower, idleRate };
}
