/** 摸鱼文案池（纯数据；显示层按轮转/概率取用） */

/** 点击飘字：数字为主，偶尔蹦梗 */
export const CLICK_MEMES = ["摸了一条鱼", "带薪如厕中", "老板没看见", "工资照发", "又水了一格", "这波不亏"] as const;

/** 同事丢梗命中时展示的打工人语录（收集感） */
export const MEME_QUOTES = [
  "在吗？帮个忙",
  "这个需求很简单",
  "下班前给我",
  "我提个思路啊",
  "对齐一下颗粒度",
  "形成闭环",
  "底层逻辑",
  "赋能",
  "抓手",
  "组合拳",
] as const;

/** 升级彩蛋文案：按等级里程碑解锁（Lv.1 / 5 / 10 / 20 / 50） */
export const UPGRADE_FLAVOR: Record<string, [string, string, string, string, string]> = {
  coffee: ["第一杯，回魂", "心脏和 KPI 一起狂跳", "咖啡因已注入静脉", "胃：我抗议但无效", "咖啡免疫体成形"],
  water: ["工位饮水机守望者", "今日饮水 KPI 达成", "水利万物而不争", "膀胱是第二闹钟", "喝出了品水师的舌头"],
  chair: ["腰不酸了，腿不麻了", "坐着就是赚钱", "工学椅是第二个床", "椅子上长出了人", "人体工学，人椅合一"],
  phone: ["屏幕亮度调到最低", "购物车已加购 37 件", "刷到根本停不下来", "手指有了肌肉记忆", "小说连载追完三部"],
  toilet: ["带薪蹲坑，人间清醒", "厕所隔间是避难所", "一蹲解千愁", "隔间是我的办公室", "蹲出了禅意"],
  group: ["群里正在斗图", "已读，故意不回", "摸鱼情报交换中", "群等级升到 LV6", "斗图未尝一败"],
  meeting: ["会议纪念品：一堆 TODO", "发言=加班，沉默=摸鱼", "散会即是摸鱼开始", "人在会场，魂在工位", "全程点头，一句没听"],
  deep: ["心流状态，勿扰", "看起来在 debug，其实在发呆", "一摸一整天", "深度摸鱼：八小时像八分钟", "摸出了哲学"],
  retire: ["工资？那是副业", "躺平即正义", "工位已是我的卧室", "梦里也在摸鱼", "摸鱼大师，返璞归真"],
};

/** 等级对应的彩蛋文案（不足里程碑返回 null） */
export function flavorFor(id: string, level: number): string | null {
  const lines = UPGRADE_FLAVOR[id];
  if (!lines || level < 1) return null;
  if (level >= 50) return lines[4]!;
  if (level >= 20) return lines[3]!;
  if (level >= 10) return lines[2]!;
  if (level >= 5) return lines[1]!;
  return lines[0]!;
}
