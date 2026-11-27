import { initialState, type GameState } from "../src/engine/state";
import { effectOf } from "../src/engine/upgrades";
import { recruit, upgradeColleague, favorBonuses, teamTraits } from "../src/engine/team";
import { offlineEfficiency } from "../src/engine/progression";
import { talentEffects } from "../src/engine/talents";

const NOW = Date.now();
let s: GameState = { ...initialState(), moyu: 1e12, levels: { phone: 20 }, decor: [] };
s = recruit(s, "zhou")!;
const col = s.team.colleagues.zhou!;
const st = { ...s, team: { colleagues: { zhou: { ...col, level: 3 } } } };
const inc = (x: GameState) => effectOf(x).idleRate;
console.log("income", inc(st), "moyu", st.moyu);
const up = upgradeColleague(st, "zhou");
console.log("up delta", up ? inc(up) - inc(st) : "null", "cost", Math.ceil(12000 * 0.4 * 1.35 ** 3));

const s2: GameState = {
  ...st,
  visits: { date: "x", count: 1 },
  daily: { date: "x", goals: [], streak: 14, lastCompleteDate: null, claimed: false, window: 0, claimsToday: 0 },
};
const t = talentEffects(s2.talents);
console.log("talent", { offlineBaseBonus: t.offlineBaseBonus, offlineEfficiencyBonus: t.offlineEfficiencyBonus });
console.log("teamTraits", teamTraits(s2));
console.log("favorTier", favorBonuses(s2));
console.log("off eff visits1", offlineEfficiency(s2, NOW - 3 * 86400_000, NOW));
console.log("off eff visits0", offlineEfficiency({ ...s2, visits: { date: "x", count: 0 } }, NOW - 3 * 86400_000, NOW));
console.log("off eff createdAt 1h", offlineEfficiency(s2, NOW - 3600_000, NOW));
