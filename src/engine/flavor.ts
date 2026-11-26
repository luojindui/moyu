/** 摸鱼文案池（纯数据；显示层按轮转/概率取用） */

/** 点击飘字：数字为主，偶尔蹦梗 */
export const CLICK_MEMES = ["摸了一条鱼", "带薪如厕中", "老板没看见", "工资照发", "又水了一格", "这波不亏"] as const;

/** 升级彩蛋文案：按等级里程碑解锁（Lv.1 / Lv.5 / Lv.10） */
export const UPGRADE_FLAVOR: Record<string, [string, string, string]> = {
  coffee: ["第一杯，回魂", "心脏和 KPI 一起狂跳", "咖啡因已注入静脉"],
  water: ["工位饮水机守望者", "今日饮水 KPI 达成", "水利万物而不争"],
  phone: ["屏幕亮度调到最低", "购物车已加购 37 件", "刷到根本停不下来"],
  toilet: ["带薪蹲坑，人间清醒", "厕所隔间是避难所", "一蹲解千愁"],
  group: ["群里正在斗图", "已读，故意不回", "摸鱼情报交换中"],
  meeting: ["会议纪念品：一堆 TODO", "发言=加班，沉默=摸鱼", "散会即是摸鱼开始"],
};

/** 等级对应的彩蛋文案（不足里程碑返回 null） */
export function flavorFor(id: string, level: number): string | null {
  const lines = UPGRADE_FLAVOR[id];
  if (!lines || level < 1) return null;
  if (level >= 10) return lines[2]!;
  if (level >= 5) return lines[1]!;
  return lines[0]!;
}
