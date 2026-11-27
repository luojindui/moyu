import { describe, it } from "vitest";
import { DRAFT_TEAM, simulate, type TalentCfg } from "./probe-b1-lib";

const NO_TALENT: TalentCfg = {
  idleMult: 1, offlineCapBonus: 0, offlineBaseBonus: 0, clickMult: 1, comboMaxBonus: 0,
  critChance: 0, critMult: 1, clickToIdlePer1k: 0, clickToIdleCap: 0, patrolRewardMult: 1,
  penaltyReduction: 0, memeRewardMult: 1, patrolIntervalCut: 0, patrolIdlePerPatrol: 0, patrolIdleCap: 0,
};

describe("B1 收入曲线（无小队，不转生）", () => {
  it("日累计 lifetime（用来定招募价）", () => {
    for (const cps of [0, 1, 3]) {
      const r = simulate({
        days: 7, visitHours: [9, 13, 20], sessionSeconds: 600, cps,
        recruit: false, dispatch: false, levelColleagues: false,
        team: DRAFT_TEAM, talent: NO_TALENT, prestige: false, dailyClaim: true, events: true,
      });
      console.log(`cps=${cps}:`);
      console.log(
        r.byDay.map((d) => `D${d.day}: 日入=${(d.total / 1e6).toFixed(1)}M 累计=${(d.lifetime / 1e6).toFixed(0)}M idle=${d.idleRate.toFixed(0)}/s 段位=${d.rank}`).join("\n"),
      );
    }
  });
});
