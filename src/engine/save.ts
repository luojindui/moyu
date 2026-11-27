import type { GameState } from "./state";
import { initialState } from "./state";
import { sanitizeCollected, type Collected } from "./collection";
import { restoreDaily, type DailyState } from "./daily";
import { COLLEAGUES, MAX_COLLEAGUE_LEVEL, MISSIONS, emptyTeam, type TeamState } from "./team";
import { TALENTS, emptyTalents, type TalentState } from "./talents";

export const SAVE_KEY = "moyu-save";
export const SAVE_VERSION = 2; // v2：加入 team/talents/patrolSurvives
/** 未来版本档的备份 key（旧客户端读到更高版本时不覆盖，先备份） */
export const NEWER_SAVE_KEY = "moyu-save.newer.bak";
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
  /** 累计安然巡逻 */
  patrolSurvives?: number;
  /** 累计点击（点击线彩蛋解锁用；旧档为 0） */
  totalClicks?: number;
  /** 今日回访计数 */
  visits?: { date: string; count: number };
  /** 历史累计（跨转生） */
  lifetimeEarned?: number;
  /** 转生点 */
  prestige?: number;
  /** 摸鱼小队 */
  team?: TeamState;
  /** 天赋树 */
  talents?: TalentState;
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
    patrolSurvives: state.patrolSurvives,
    totalClicks: state.totalClicks,
    visits: state.visits,
    lifetimeEarned: state.lifetimeEarned,
    prestige: state.prestige,
    team: state.team,
    talents: state.talents,
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
    // 迁移链：接受 v ≤ 当前版本（v1 尚无历史迁移，但拒绝未来版本避免"降级清档"）
    if (typeof blob.v !== "number" || blob.v > SAVE_VERSION) {
      // v>当前：先备份，避免旧客户端降级覆盖
      return { state: initialState(), offlineSeconds: 0, createdAt: now };
    }
    if (typeof blob.moyu !== "number" || typeof blob.savedAt !== "number") {
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
    const rawMoyu = Number.isFinite(blob.moyu) && blob.moyu >= 0 ? blob.moyu : 0;
    const rawTotal =
      typeof blob.totalEarned === "number" && Number.isFinite(blob.totalEarned) && blob.totalEarned >= 0
        ? blob.totalEarned
        : 0;
    const rawLifetime =
      typeof blob.lifetimeEarned === "number" && Number.isFinite(blob.lifetimeEarned) && blob.lifetimeEarned >= 0
        ? blob.lifetimeEarned
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
    const totalProvided = typeof blob.totalEarned === "number" && Number.isFinite(blob.totalEarned);
    const lifetimeProvided = typeof blob.lifetimeEarned === "number" && Number.isFinite(blob.lifetimeEarned);
    // 旧档（字段缺失）用余额推断；新档严格钳制 lifetime ≥ total ≥ moyu（篡改档收敛）
    let totalEarned = totalProvided ? rawTotal : rawMoyu;
    let lifetimeEarned = Math.max(rawLifetime, totalEarned);
    if (!lifetimeProvided) lifetimeEarned = Math.max(lifetimeEarned, rawMoyu);
    totalEarned = Math.min(totalEarned, lifetimeEarned);
    const moyu = Math.min(rawMoyu, totalEarned);
    const prestige = Math.floor(numOr0(blob.prestige));
    // 天赋：只接受已知天赋 id、点数非负整数
    const talents: TalentState = emptyTalents();
    const rawTalents = blob.talents as { unlocked?: unknown; points?: unknown; rankGranted?: unknown } | undefined;
    if (Array.isArray(rawTalents?.unlocked)) {
      const seen = new Set<string>();
      const takenGroups = new Set<string>();
      talents.unlocked = rawTalents.unlocked.filter((x): x is string => {
        if (typeof x !== "string") return false;
        const def = TALENTS.find((t) => t.id === x);
        if (!def || seen.has(x)) return false;
        // 互斥组只能有一个
        if (def.exclusive) {
          if (takenGroups.has(def.exclusive)) return false;
          takenGroups.add(def.exclusive);
        }
        seen.add(x);
        return true;
      });
    }
    talents.points =
      typeof rawTalents?.points === "number" && Number.isInteger(rawTalents.points) && rawTalents.points >= 0
        ? Math.min(24, rawTalents.points)
        : 0;
    talents.rankGranted =
      typeof rawTalents?.rankGranted === "number" && Number.isInteger(rawTalents.rankGranted)
        ? Math.min(12, Math.max(-1, rawTalents.rankGranted))
        : -1;
    {
      const d = (rawTalents as { dailyGiftDate?: unknown })?.dailyGiftDate;
      talents.dailyGiftDate = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
    }
    const patrolSurvives =
      typeof blob.patrolSurvives === "number" && Number.isInteger(blob.patrolSurvives) && blob.patrolSurvives >= 0
        ? blob.patrolSurvives
        : 0;
    // 小队：只接受已知同事、等级整数且在范围内、任务 id 合法
    const team: TeamState = emptyTeam();
    const rawTeam = blob.team as { colleagues?: Record<string, unknown> } | undefined;
    if (rawTeam?.colleagues && typeof rawTeam.colleagues === "object") {
      for (const def of COLLEAGUES) {
        const c = rawTeam.colleagues[def.id] as Record<string, unknown> | undefined;
        if (!c || typeof c !== "object") continue;
        const level = typeof c.level === "number" && Number.isInteger(c.level) && c.level >= 1
          ? Math.min(c.level, MAX_COLLEAGUE_LEVEL)
          : 1;
        // 未知任务 id → 清空（否则领取时 missionDef 为 undefined 会崩）；时间戳钳制，防 1e300 永久卡死
        const rawMission = typeof c.missionId === "string" ? c.missionId : null;
        const missionId = rawMission && MISSIONS.some((m) => m.id === rawMission) ? rawMission : null;
        const MAX_MISSION_MS = 9 * 3600 * 1000; // 最长 8h + 1h 余量
        const nowRef = Number.isFinite(now) ? now : Date.now();
        const startedAt = missionId ? Math.min(Math.max(0, numOr0(c.startedAt)), nowRef + MAX_MISSION_MS) : 0;
        const rawEnds = missionId ? numOr0(c.endsAt) : 0;
        const endsAt = missionId ? Math.min(Math.max(startedAt + 1000, rawEnds), startedAt + MAX_MISSION_MS) : 0;
        const favor = typeof c.favor === "number" && Number.isFinite(c.favor) && c.favor >= 0
          ? Math.min(100, Math.floor(c.favor))
          : 0;
        const autoRepeat = typeof c.autoRepeat === "boolean" ? c.autoRepeat : false;
        const rewardSnapshot = Math.min(numOr0(c.rewardSnapshot), 1e18);
        team.colleagues[def.id] = { level, missionId, startedAt, endsAt, favor, autoRepeat, rewardSnapshot };
      }
    }
    // createdAt 钳制：缺失默认 savedAt（不重发首日）；越界（未来/NaN）按 savedAt收敛，堵离线分级绕过
    const clampCreatedAt = (ca: unknown): number => {
      if (typeof ca !== "number" || !Number.isFinite(ca) || ca > now) return savedAtMs;
      return Math.max(ca, savedAtMs - 365 * 86_400_000);
    };
    return {
      state: { moyu, levels, totalEarned, collected, daily, surviveStreak, totalClicks, visits, lifetimeEarned, prestige, team, talents, patrolSurvives },
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

/** FNV-1a 32 位校验（防手滑/截断，不承担防篡改） */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function toBase64Url(s: string): string {
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(code: string): string {
  const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

/** 导出存档码：base64url(JSON) + "." + 校验和 */
export function encodeSaveCode(blobJson: string): string {
  const body = toBase64Url(blobJson);
  return `${body}.${fnv1a(blobJson)}`;
}

/** 解析存档码：校验完整性，返回原始 blob JSON（调用方负责 restore 净化与 savedAt 重置） */
export function decodeSaveCode(code: string): { ok: boolean; blob?: string; error?: string } {
  const trimmed = (code ?? "").trim();
  if (!trimmed) return { ok: false, error: "空存档码" };
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) return { ok: false, error: "格式不正确" };
  try {
    const blob = fromBase64Url(trimmed.slice(0, dot));
    const sum = trimmed.slice(dot + 1);
    if (fnv1a(blob) !== sum) return { ok: false, error: "校验失败（可能复制不完整）" };
    JSON.parse(blob); // 形状交给 restore 净化
    return { ok: true, blob };
  } catch {
    return { ok: false, error: "无法解析" };
  }
}

/** 未来版本档：写档前先备份，避免旧客户端覆盖新数据 */
export function backupNewerSave(adapter: SaveAdapter): void {
  try {
    const raw = adapter.getItem(SAVE_KEY);
    if (!raw) return;
    const blob = JSON.parse(raw) as { v?: number };
    if (typeof blob.v === "number" && blob.v > SAVE_VERSION) {
      adapter.setItem(NEWER_SAVE_KEY, raw);
    }
  } catch {
    /* 忽略 */
  }
}
