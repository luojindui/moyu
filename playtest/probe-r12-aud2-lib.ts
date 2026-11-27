/**
 * R12 复验审计探针公共库（只读 src/）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initialState, type GameState } from "../src/engine/state";
import { COLLEAGUES, MAX_COLLEAGUE_LEVEL, dispatch, recruit, upgradeColleague } from "../src/engine/team";
import type { TalentState } from "../src/engine/talents";
import type { SaveAdapter } from "../src/engine/save";

export const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

export function rich(money = 1e12): GameState {
  return { ...initialState(), moyu: money, totalEarned: money, lifetimeEarned: money };
}

export function withColleagues(state: GameState, ids: string[], level = MAX_COLLEAGUE_LEVEL): GameState {
  let s = state;
  for (const id of ids) {
    s = recruit(s, id)!;
    while ((s.team.colleagues[id]?.level ?? 0) < level) {
      const n = upgradeColleague(s, id);
      if (!n) throw new Error("upgrade failed " + id);
      s = n;
    }
  }
  return s;
}

export function withTalents(state: GameState, ids: string[], points = 0, rankGranted = state.talents.rankGranted): GameState {
  const talents: TalentState = { unlocked: [...ids], points, rankGranted, dailyGiftDate: "" };
  return { ...state, talents };
}

export function withLevels(state: GameState, levels: Record<string, number>): GameState {
  return { ...state, levels: { ...levels } };
}

/** 派遣并把 endsAt 返回（不推进到完成，不动 nowMs=0 起点） */
export function dispatchAt(state: GameState, id: string, missionId: string, nowMs: number, stationIdle: number) {
  const s = dispatch(state, id, missionId, nowMs, stationIdle);
  if (!s) throw new Error("dispatch failed " + id + "/" + missionId);
  return { state: s, endsAt: s.team.colleagues[id]!.endsAt };
}

export function memoryAdapter(prefill: Record<string, string> = {}): SaveAdapter & { store: Map<string, string> } {
  const store = new Map(Object.entries(prefill));
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
}

export function readSrcFiles(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
        out.push({ path: p.replace(SRC_DIR, "src"), text: readFileSync(p, "utf8") });
      }
    }
  };
  walk(SRC_DIR);
  return out;
}

/** 某标识符在 src 中的消费点（可排除定义所在文件） */
export function consumers(identifier: string, excludeFile?: string): { path: string; line: number }[] {
  const hits: { path: string; line: number }[] = [];
  for (const f of readSrcFiles()) {
    if (excludeFile && f.path.endsWith(excludeFile)) continue;
    f.text.split("\n").forEach((line, i) => {
      if (line.includes(identifier)) hits.push({ path: f.path, line: i + 1 });
    });
  }
  return hits;
}

export function favorTierThresholds(): number[] {
  const found: number[] = [];
  for (const f of readSrcFiles()) {
    const re = /favorTier\([^)]*\)\s*>=\s*(\d+)/g;
    for (const m of f.text.matchAll(re)) found.push(Number(m[1]));
  }
  return found;
}

export const COSTS = COLLEAGUES.map((c) => c.cost);
