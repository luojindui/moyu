import { initialState, type GameState } from "../src/engine/state";
import { recruit } from "../src/engine/team";
import { offlineEfficiency } from "../src/engine/progression";

const NOW = Date.now();
const DAY = 86400;
function offlineState(s: GameState, opts: { visits: number; streakDays: number }): number {
  const st: GameState = {
    ...s,
    visits: { date: "2026-01-01", count: opts.visits },
    daily: { date: "2026-01-01", goals: [], streak: opts.streakDays, lastCompleteDate: null, claimed: false, window: 0, claimsToday: 0 },
  };
  const createdAt = NOW - 3 * DAY;
  return offlineEfficiency(st, createdAt, NOW);
}
let s: GameState = { ...initialState(), moyu: 1e12, levels: { phone: 20, toilet: 20, group: 20, meeting: 20, deep: 15 }, decor: [] };
s = recruit(s, "zhou")!;
console.log("visits1 eff", offlineState(s, { visits: 1, streakDays: 14 }));
console.log("visits0 eff", offlineState(s, { visits: 0, streakDays: 14 }));
// 早期：streak 0
console.log("streak0 visits1", offlineState(s, { visits: 1, streakDays: 0 }));
console.log("streak0 visits3", offlineState(s, { visits: 3, streakDays: 0 }));
