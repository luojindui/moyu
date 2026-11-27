import { describe, it } from "vitest";
import { initialState, type GameState } from "../src/engine/state";
import { UPGRADES } from "../src/engine/upgrades";
import { offlineEfficiency, FIRST_DAY_MS } from "../src/engine/progression";
import { talentEffects } from "../src/engine/talents";
import { decorEffects } from "../src/engine/decor";
import { cardEffects } from "../src/engine/cards";
import { favorTier, teamTraits } from "../src/engine/team";
import { offlineEarn } from "../src/engine/offline";

const DAY = 86400;
const NOW = Date.now();
const TD = new Date(NOW).toLocaleDateString("sv-SE");

function mk(over: Partial<GameState> = {}): GameState { return { ...initialState(), ...over } as GameState; }
function talentState(state: GameState, ids: string[]): GameState {
  return { ...state, talents: { unlocked: ids, points: 0, rankGranted: 0, dailyGiftDate: "", overflow: 0 } };
}

describe("dbg", () => {
  it("offline efficiency internals", () => {
    const levels: Record<string, number> = { coffee: 12, water: 10, chair: 6, phone: 25, toilet: 22, group: 18, meeting: 12, deep: 4 };
    const base = mk({
      levels, totalClicks: 9000, collected: { quotes: [0,1,2,3,4,5,6,7,8,9], flavors: Array.from({length:20},(_,i)=>i) },
      decor: ["plant", "lamp", "rug", "fridge", "chair"],
      team: { colleagues: { zhou: { level: 2, missionId: null, startedAt: 0, endsAt: 0, favor: 30, autoRepeat: true, rewardSnapshot: 0 }, mei: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 10, autoRepeat: true, rewardSnapshot: 0 } } },
    });
    const st = talentState(base, ["idle_1","idle_2","idle_3"]);
    const t = talentEffects(st.talents);
    console.log("talents:", JSON.stringify({ offlineBase: t.offlineBaseBonus, offlineEff: t.offlineEfficiencyBonus, overflow: t.overflowIdleBonus }));
    console.log("decor offline:", decorEffects(st).offlineBonus, "favTier:", favorTier(st), "teamTraits:", JSON.stringify(teamTraits(st)));
    for (const v of [0,1,2,3]) {
      const s = { ...st, visits: { date: TD, count: v } };
      const ce = cardEffects(s, NOW);
      const raise = t.offlineBaseBonus + t.offlineEfficiencyBonus + decorEffects(s).offlineBonus;
      const teamBase = teamTraits(s).offlineEfficiency + ce.offlineBonus - ce.riskPenalty;
      const raw = 0.7 + (favorTier(s) >= 2 ? 0.03 : 0) + teamBase + Math.min(v,3)*0.1 + 0;
      console.log("visits", v, "offlineEff", offlineEfficiency(s, NOW - 3*DAY, NOW).toFixed(4), "raw+raise calc", (raw + raise).toFixed(4), "cap", (1+raise).toFixed(4), "createdAt3d=first?", NOW - (NOW-3*DAY) < FIRST_DAY_MS);
    }
    // card early_leave
    const ce = { ...st, cards: { date: TD, offers: ["early_leave"], chosen: "early_leave", until: NOW + 86400000, nextDayGuaranteed: null, dismissed: false, chosenDate: "" } };
    console.log("early_leave offlineEff:", offlineEfficiency(ce, NOW - 3*DAY, NOW).toFixed(4), "card eff:", JSON.stringify(cardEffects(ce, NOW)));
    const ot = { ...st, cards: { date: TD, offers: ["overtime"], chosen: "overtime", until: NOW + 86400000, nextDayGuaranteed: null, dismissed: false, chosenDate: "" } };
    console.log("overtime offlineEff:", offlineEfficiency(ot, NOW - 3*DAY, NOW).toFixed(4));
    // 24h offline earn magnitude check
    console.log("offlineEarn 12h:", JSON.stringify(offlineEarn(st, 12*3600, offlineEfficiency(st, NOW-3*DAY, NOW)).earned));
  });
});
