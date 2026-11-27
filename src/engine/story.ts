/**
 * 最小剧情层（R10 剧情党建议，零新美术/零经济）：
 * 用"工位便签 + 角色台词前缀 + 换配色"给现有机制加情感钩子。
 * 章节完全由进度推导（不新增存档字段）。
 */
export interface Chapter {
  id: string;
  /** 解锁所需生涯总收入 */
  at: number;
  /** 便签标题（工位号 + 日期感） */
  title: string;
  /** 便签正文（第一人称，主角小余） */
  note: string;
  /** 该章的场地配色索引（0-3，对应 4 套职员配色） */
  palette: number;
}

export const CHAPTERS: Chapter[] = [
  { id: "c1", at: 0, title: "302 · 第 1 天", note: "八点了，先摸五分钟再说。", palette: 0 },
  { id: "c2", at: 10_000, title: "302 · 转正", note: "实习牌换成工卡，摸鱼也要摸出名堂。", palette: 1 },
  { id: "c3", at: 1_000_000, title: "302 · 月度之星", note: "王总说：年轻人很有干劲。我点头，继续点屏幕。", palette: 2 },
  { id: "c4", at: 100_000_000, title: "303 · 新的工位", note: "离职再就业：换个工位号，人还是那个人。", palette: 3 },
  { id: "c5", at: 10_000_000_000, title: "303 · 架构调整", note: "组织架构又变了，我的摸鱼值没变。", palette: 0 },
  { id: "c6", at: 320_000_000_000, title: "顶层 · 摸鱼宇宙尽头", note: "老周说他要写小说了。我也想。再摸五分钟。", palette: 1 },
];

export function chapterFor(lifetimeEarned: number): Chapter {
  let cur = CHAPTERS[0]!;
  for (const c of CHAPTERS) if (lifetimeEarned >= c.at) cur = c;
  return cur;
}

/** 角色台词（复用现有系统：老周丢梗/王总巡逻/HR 转生） */
export const VOICES = {
  zhou: "老周",
  boss: "王总",
  hr: "小美",
  self: "小余",
} as const;

/** 老周语录前缀（10 条现有语录归属到角色） */
export function zhouLine(text: string): string {
  return `${VOICES.zhou}：${text}`;
}

/** 王总巡逻横幅（带角色名） */
export function bossLine(variant: "hold" | "type" | "blitz" | "choice", remain: number, taps: number): string {
  if (variant === "choice") return `回合制老板来了！看线索选应对（${remain}s）`;
  if (variant === "type") return `${VOICES.boss}路过！假装工作 点 ${taps}/5（${remain}s）`;
  if (variant === "blitz") return `${VOICES.boss}盯着你！连点 ${taps}/16 奖×1.5（${remain}s）`;
  return `${VOICES.boss}巡逻中！忍住别点（${remain}s）`;
}

/** 巡逻结算台词 */
export function bossOutcome(caught: boolean): string {
  return caught ? `${VOICES.boss}：年轻人，眼神这么飘。` : `${VOICES.boss}今天心情不错。`;
}

/** HR 转生台词 */
export const HR_PRESTIGE_LINE = `${VOICES.hr}：离职再就业流程走一下？换工位号，工龄保留。`;
