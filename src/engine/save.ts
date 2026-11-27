import type { GameState } from "./state";
import { initialState } from "./state";
import { sanitizeCollected, type Collected } from "./collection";
import { restoreDaily, type DailyState } from "./daily";

export const SAVE_KEY = "moyu-save";
export const SAVE_VERSION = 1;
/** 单升级等级上限（防 Infinity 污染） */
export const MAX_LEVEL = 1000;

/** 存储适配（localStorage 或测试内存实现） */
export interface SaveAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface SaveBlob {
  v: number;
  moyu: number;
  totalEarned?: number;
  levels: Record<string, number>;
  savedAt: number;
  /** 建档时间（首日判定用）；旧档缺省补当前时间 */
  createdAt?: number;
  /** 图鉴收集（旧档缺省为空） */
  collected?: Collected;
  /** 每日日报（旧档/非法形状为 null） */
  daily?: DailyState | null;
  /** 连续安然连胜（旧档为 0） */
  surviveStreak?: number;
  /** 累计点击（点击线彩蛋解锁用；旧档为 0） */
  totalClicks?: number;
  /** 今日回访计数 */
  visits?: { date: string; count: number };
  /** 历史累计（跨转生） */
  lifetimeEarned?: number;
  /** 转生点 */
  prestige?: number;
}

/** 序列化并写入（savedAt=毫秒时间戳） */
export function serialize(state: GameState, adapter: SaveAdapter, savedAt: number): void {
  const prevRaw = (() => {
    try {
      return adapter.getItem(SAVE_KEY);
    } catch {
      return null;
    }
  })();
  let createdAt = savedAt;
  try {
    const prev = JSON.parse(prevRaw ?? "null") as { createdAt?: number } | null;
    if (typeof prev?.createdAt === "number") createdAt = prev.createdAt;
  } catch {
    /* 损坏旧档：建档时间重置 */
  }
  const blob: SaveBlob = {
    v: SAVE_VERSION,
    moyu: state.moyu,
    totalEarned: state.totalEarned,
    levels: state.levels,
    savedAt,
    createdAt,
    collected: state.collected,
    daily: state.daily,
    surviveStreak: state.surviveStreak,
    totalClicks: state.totalClicks,
    visits: state.visits,
    lifetimeEarned: state.lifetimeEarned,
    prestige: state.prestige,
  };
  try {
    adapter.setItem(SAVE_KEY, JSON.stringify(blob));
  } catch {
    /* 存储满/禁用时静默失败，游戏继续 */
  }
}

export interface RestoreResult {
  state: GameState | null;
  /** 距上次存档的秒数（无有效存档为 0） */
  offlineSeconds: number;
  /** 建档毫秒时间戳（旧档补当前时间） */
  createdAt: number;
}

/** 读取存档：损坏/版本不符/缺失 → 初始状态，绝不抛错 */
export function restore(adapter: SaveAdapter, now: number): RestoreResult {
  let raw: string | null = null;
  try {
    raw = adapter.getItem(SAVE_KEY);
  } catch {
    return { state: initialState(), offlineSeconds: 0, createdAt: now };
  }
  if (!raw) return { state: initialState(), offlineSeconds: 0, createdAt: now };
  try {
    const blob = JSON.parse(raw) as Partial<SaveBlob>;
    if (blob.v !== SAVE_VERSION || typeof blob.moyu !== "number" || typeof blob.savedAt !== "number") {
      return { state: initialState(), offlineSeconds: 0, createdAt: now };
    }
    // levels 字段非法（非普通对象）→ 整档作废（规格：字段非法以初始状态开始）
    if (blob.levels === undefined || blob.levels === null || typeof blob.levels !== "object" || Array.isArray(blob.levels)) {
      return { state: initialState(), offlineSeconds: 0, createdAt: now };
    }
    const levels: Record<string, number> = {};
    for (const [k, v] of Object.entries(blob.levels)) {
      // 只接受正整数且不超上限，其余键丢弃
      if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_LEVEL) levels[k] = v;
    }
    const moyu = Number.isFinite(blob.moyu) && blob.moyu >= 0 ? blob.moyu : 0;
    const totalEarned =
      typeof blob.totalEarned === "number" && Number.isFinite(blob.totalEarned) && blob.totalEarned >= 0
        ? blob.totalEarned
        : 0;
    const savedAtMs: number = blob.savedAt;
    const offlineSeconds = Math.max(0, (now - savedAtMs) / 1000);
    // 图鉴：去重 + 上限裁剪
    const collected = sanitizeCollected(blob.collected as { quotes?: unknown; flavors?: unknown } | undefined);
    // 日报：严格形状校验（3 目标/数值/streak 整数）
    const daily: DailyState | null = restoreDaily(blob.daily);
    const surviveStreak =
      typeof blob.surviveStreak === "number" && Number.isInteger(blob.surviveStreak) && blob.surviveStreak >= 0
        ? blob.surviveStreak
        : 0;
    const totalClicks =
      typeof blob.totalClicks === "number" && Number.isInteger(blob.totalClicks) && blob.totalClicks >= 0
        ? blob.totalClicks
        : 0;
    const v = blob.visits as { date?: unknown; count?: unknown } | undefined;
    const visits =
      v && typeof v.date === "string" && typeof v.count === "number" && Number.isInteger(v.count) && v.count >= 0
        ? { date: v.date, count: v.count }
        : { date: "", count: 0 };
    const numOr0 = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);
    // 历史累计至少等于本局累计（旧档迁移）
    const lifetimeEarned = Math.max(numOr0(blob.lifetimeEarned), totalEarned);
    const prestige = Math.floor(numOr0(blob.prestige));
    // createdAt 钳制：缺失默认 savedAt（不重发首日）；越界（未来/NaN）按 savedAt收敛，堵离线分级绕过
    const clampCreatedAt = (ca: unknown): number => {
      if (typeof ca !== "number" || !Number.isFinite(ca) || ca > now) return savedAtMs;
      return Math.max(ca, savedAtMs - 365 * 86_400_000);
    };
    return {
      state: { moyu, levels, totalEarned, collected, daily, surviveStreak, totalClicks, visits, lifetimeEarned, prestige },
      offlineSeconds,
      createdAt: clampCreatedAt(blob.createdAt),
    };
  } catch {
    return { state: initialState(), offlineSeconds: 0, createdAt: now };
  }
}

/** 清空存档（调试钩子用） */
export function clearSave(adapter: SaveAdapter): void {
  try {
    adapter.removeItem(SAVE_KEY);
  } catch {
    /* 忽略 */
  }
}
