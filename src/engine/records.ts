/**
 * 本地生涯纪录（R10，独立 localStorage key，不动存档 schema）：
 * 最佳单日收入、最长连签、最高生涯、最多点击、图鉴最高。用于"数据/竞技型"缺少参照的补位。
 */
export interface Records {
  bestDayEarned: number;
  bestDayDate: string;
  maxStreak: number;
  bestLifetime: number;
  maxClicks: number;
  bestCollection: number;
}

export const RECORDS_KEY = "moyu-records";

export function emptyRecords(): Records {
  return { bestDayEarned: 0, bestDayDate: "", maxStreak: 0, bestLifetime: 0, maxClicks: 0, bestCollection: 0 };
}

export function parseRecords(raw: string | null): Records {
  if (!raw) return emptyRecords();
  try {
    const r = JSON.parse(raw) as Partial<Records>;
    const n = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);
    return {
      bestDayEarned: n(r.bestDayEarned),
      bestDayDate: typeof r.bestDayDate === "string" ? r.bestDayDate : "",
      maxStreak: n(r.maxStreak),
      bestLifetime: n(r.bestLifetime),
      maxClicks: n(r.maxClicks),
      bestCollection: n(r.bestCollection),
    };
  } catch {
    return emptyRecords();
  }
}

/** 用当前进度更新纪录，返回新纪录与是否有变化 */
export function updateRecords(
  prev: Records,
  now: { date: string; dayEarned: number; streak: number; lifetime: number; clicks: number; collection: number },
): { records: Records; changed: boolean } {
  const r: Records = { ...prev };
  let changed = false;
  if (now.dayEarned > r.bestDayEarned) {
    r.bestDayEarned = now.dayEarned;
    r.bestDayDate = now.date;
    changed = true;
  }
  if (now.streak > r.maxStreak) {
    r.maxStreak = now.streak;
    changed = true;
  }
  if (now.lifetime > r.bestLifetime) {
    r.bestLifetime = now.lifetime;
    changed = true;
  }
  if (now.clicks > r.maxClicks) {
    r.maxClicks = now.clicks;
    changed = true;
  }
  if (now.collection > r.bestCollection) {
    r.bestCollection = now.collection;
    changed = true;
  }
  return { records: r, changed };
}
