import { initialState, type GameState } from "../src/engine/state";
import { recruit } from "../src/engine/team";
import { offlineEfficiency, FIRST_DAY_MS } from "../src/engine/progression";
import { cardEffects } from "../src/engine/cards";
import { decorEffects } from "../src/engine/decor";
import { talentEffects } from "../src/engine/talents";
import { favorTier, teamTraits } from "../src/engine/team";

const NOW = Date.now();
let s: GameState = { ...initialState(), moyu: 1e12, levels: { phone: 20 }, decor: [] };
s = recruit(s, "zhou")!;
const s2: GameState = {
  ...s,
  visits: { date: "2026-01-01", count: 1 },
  daily: { date: "2026-01-01", goals: [], streak: 14, lastCompleteDate: null, claimed: false, window: 0, claimsToday: 0 },
};
const createdAt = NOW - 3 * 86400_000;
console.log("FIRST_DAY_MS", FIRST_DAY_MS, "elapsed", NOW - createdAt);
console.log("talent", talentEffects(s2.talents));
console.log("card", cardEffects(s2, NOW));
console.log("decor", decorEffects(s2));
console.log("favorTier", favorTier(s2), "teamTraits", teamTraits(s2));
console.log("state.cards", JSON.stringify(s2.cards));
console.log("eff", offlineEfficiency(s2, createdAt, NOW));
// 换 levels 看是否影响
const s3: GameState = { ...s2, levels: { phone: 20, toilet: 20, group: 20, meeting: 20, deep: 15 } };
console.log("eff with big levels", offlineEfficiency(s3, createdAt, NOW));
const s4: GameState = { ...s2, levels: {} };
console.log("eff with no levels", offlineEfficiency(s4, createdAt, NOW));
