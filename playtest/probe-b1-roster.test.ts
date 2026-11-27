import { describe, it } from "vitest";
import { DRAFT_TEAM, simulate, type TalentCfg } from "./probe-b1-lib";

const NO_TALENT: TalentCfg = {
  idleMult: 1, offlineCapBonus: 0, offlineBaseBonus: 0, clickMult: 1, comboMaxBonus: 0,
  critChance: 0, critMult: 1, clickToIdlePer1k: 0, clickToIdleCap: 0, patrolRewardMult: 1,
  penaltyReduction: 0, memeRewardMult: 1, patrolIntervalCut: 0, patrolIdlePerPatrol: 0, patrolIdleCap: 0,
};

/** 5 个同事的招募时间（3 次回访/天，每次 10 分钟） */
describe("B1 招募节奏", () => {
  it("各同事招募时刻（天/小时）", () => {
    for (const cps of [0, 1, 2, 3]) {
      const r = simulate({
        days: 3, visitHours: [9, 13, 20], sessionSeconds: 600, cps,
        recruit: true, dispatch: true, levelColleagues: true,
        team: DRAFT_TEAM, talent: NO_TALENT, prestige: false, dailyClaim: true, events: true,
      });
      const rows = Object.entries(r.recruitTimes).map(([id, sec]) => {
        const d = Math.floor(sec / 86400);
        const h = (sec % 86400) / 3600;
        return `${DRAFT_TEAM.colleagues.find((c) => c.id === id)!.name}:D${d + 1}+${h.toFixed(1)}h`;
      });
      console.log(`cps=${cps}: ${rows.join(" ") || "（0-3 天内未招满）"} | D1 idle=${r.byDay[0]!.idleRate.toFixed(0)}/s D2=${r.byDay[1]!.idleRate.toFixed(0)}/s D3=${r.byDay[2]!.idleRate.toFixed(0)}/s teamLv=${JSON.stringify(r.final.teamLevels)}`);
    }
  });
});
