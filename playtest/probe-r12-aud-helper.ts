/**
 * R12 审计探针小工具（只读 src/）。
 */
import { doClick, clickPowerOf } from "../src/engine/actions";
import { initialState, type GameState } from "../src/engine/state";
import { doPrestige } from "../src/engine/prestige";
import { COLLEAGUES, recruit } from "../src/engine/team";
import { emptyTalents } from "../src/engine/talents";
import type { EventState } from "../src/engine/events";

/** 点一下（combo=0），返回差额，供验证 doClick 行为 */
export function dotClick(): { state: GameState; delta: number } {
  const s = initialState();
  const next = doClick(s, 0);
  return { state: next, delta: next.moyu - s.moyu };
}

/** 驱动一次真实 doPrestige，返回天赋/小队是否保留、点数增量 */
export function doPrestigeCheck(): {
  gained: number;
  pointsBefore: number;
  pointsDelta: number;
  talentsBefore: string[];
  talentsAfter: { unlocked: string[] };
  teamKept: boolean;
} {
  let s: GameState = {
    ...initialState(),
    moyu: 1e10,
    totalEarned: 1e10,
    lifetimeEarned: 1e10,
    talents: { ...emptyTalents(), points: 3, unlocked: ["idle_1"] },
  };
  s = recruit(s, "zhou")!;
  const r = doPrestige(s);
  if (!r) throw new Error("doPrestige 返回 null（门槛/点数异常）");
  return {
    gained: r.gained,
    pointsBefore: s.talents.points,
    pointsDelta: r.state.talents.points - s.talents.points,
    talentsBefore: [...s.talents.unlocked],
    talentsAfter: { unlocked: [...r.state.talents.unlocked] },
    teamKept: !!r.state.team.colleagues["zhou"] && r.state.team.colleagues["zhou"]!.level === 1,
  };
}

/** 构造一个「巡逻 hold 中」的事件状态 */
export function holdEventState(patrolCount = 10): EventState {
  return {
    nextBossAt: Infinity,
    bossUntil: 100,
    nextMemeAt: Infinity,
    memeUntil: -1,
    bossCaught: false,
    bossStartAt: 0,
    surviveStreak: 0,
    bossVariant: "hold",
    bossTaps: 0,
    bossPenaltyTotal: 0,
    patrolCount,
    memeCount: 0,
  };
}

export const COST = COLLEAGUES[0]!.cost;
