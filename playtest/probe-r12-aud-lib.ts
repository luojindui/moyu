/**
 * R12 批次 1 审计探针公共库（只读 src/，不修改任何源码）。
 * 用途：构造任意 GameState / SaveAdapter，静态扫描 src 中的消费点。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initialState, type GameState } from "../src/engine/state";
import { COLLEAGUES, MAX_COLLEAGUE_LEVEL, recruit, upgradeColleague, dispatch } from "../src/engine/team";
import type { TalentState } from "../src/engine/talents";
import type { SaveAdapter } from "../src/engine/save";

export const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

export function rich(money = 1e12): GameState {
  return {
    ...initialState(),
    moyu: money,
    totalEarned: money,
    lifetimeEarned: money,
  };
}

/** 招募指定同事并升到指定等级（默认满级） */
export function withColleagues(
  state: GameState,
  ids: string[],
  level = MAX_COLLEAGUE_LEVEL,
): GameState {
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

export function withTalents(state: GameState, ids: string[]): GameState {
  const talents: TalentState = {
    unlocked: [...ids],
    points: 0,
    rankGranted: state.talents.rankGranted,
  };
  return { ...state, talents };
}

export function withLevels(state: GameState, levels: Record<string, number>): GameState {
  return { ...state, levels: { ...levels } };
}

/** 派遣并直接推进到任务完成，返回 {state, reward}（不走 UI） */
export function dispatchToDone(
  state: GameState,
  id: string,
  missionId: string,
): { state: GameState; doneAt: number } {
  const s = dispatch(state, id, missionId, 0)!;
  const m = s.team.colleagues[id]!;
  return { state: s, doneAt: m.endsAt };
}

/** 内存存档适配器 */
export function memoryAdapter(prefill: Record<string, string> = {}): SaveAdapter & {
  store: Map<string, string>;
} {
  const store = new Map(Object.entries(prefill));
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
}

/** 读 src 下所有 .ts（排除测试）文本 */
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

/** 某标识符在 src 中的消费点（排除其定义所在文件） */
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

/** 提取 `favorTier(state) >= N` 中的 N 列表 */
export function favorTierThresholds(): number[] {
  const found: number[] = [];
  for (const f of readSrcFiles()) {
    const re = /favorTier\([^)]*\)\s*>=\s*(\d+)/g;
    for (const m of f.text.matchAll(re)) found.push(Number(m[1]));
  }
  return found;
}
