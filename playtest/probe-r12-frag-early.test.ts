import { describe, it } from "vitest";
import { DRAFT_TEAM, NO_TALENT, simulate } from "./probe-b1-lib";
import { RANKS } from "../src/engine/titles";
import { TALENT_RANK_TIERS } from "../src/engine/talents";

/** 碎片党节奏：一天 4 次、每次 2.5 分钟（通勤/排队），从不专门坐 30 分钟 */
const FRAG_VISITS = [8, 12, 19, 22];

function talentPointsAt(lifetime: number): number {
  const idx = RANKS.reduce((acc, r, i) => (lifetime >= r.at ? i : acc), 0);
  return TALENT_RANK_TIERS.filter((t) => idx >= t).length;
}

describe("R12 碎片党：新系统（老周/天赋）在第几天可摸到", () => {
  it("4×2.5min/天，首招老周时间 & 天赋点发放", () => {
    for (const cps of [0.5, 1, 2]) {
      const r = simulate({
        days: 4,
        visitHours: FRAG_VISITS,
        sessionSeconds: 150,
        cps,
        recruit: true,
        dispatch: true,
        levelColleagues: true,
        team: DRAFT_TEAM,
        talent: NO_TALENT,
        prestige: false,
        dailyClaim: true,
        events: true,
      });
      console.log(`\n=== cps=${cps}（碎片党 4×2.5min/天，点击 ${cps}/秒）===`);
      console.log(`首招老周：${r.firstRecruitMinute === null ? "4 天内没招到" : `第 ${(r.firstRecruitMinute / 1440).toFixed(2)} 天（从开局算 ${r.firstRecruitMinute.toFixed(0)} 分钟）`}`);
      const SESSION_MARK = [8, 12, 19, 22];
      console.log(
        `招募时间点（v 为秒）：` +
          Object.entries(r.recruitTimes)
            .map(([k, v]) => {
              const day = Math.floor(v / 86400) + 1;
              const hour = (v % 86400) / 3600;
              const openIdx = SESSION_MARK.filter((h) => h <= hour + 0.01).length;
              return `${k}=D${day} ${hour.toFixed(1)}h（当天第${openIdx}次打开，总第${(day - 1) * 4 + openIdx}次）`;
            })
            .join("，"),
      );
      for (const d of r.byDay) {
        console.log(
          `D${d.day}: 日入=${(d.total / 1e3).toFixed(1)}k 累计=${(d.lifetime / 1e6).toFixed(2)}M idle=${d.idleRate.toFixed(2)}/s 段位=${d.rank} 小队=${JSON.stringify(d.teamLevels)} 天赋点=${talentPointsAt(d.lifetime)}`,
        );
      }
    }
  }, 120_000);

  it("纯挂机不点（cps=0）时老周要几天", () => {
    for (const cps of [0]) {
      const r = simulate({
        days: 7,
        visitHours: FRAG_VISITS,
        sessionSeconds: 150,
        cps,
        recruit: true,
        dispatch: true,
        levelColleagues: true,
        team: DRAFT_TEAM,
        talent: NO_TALENT,
        prestige: false,
        dailyClaim: true,
        events: true,
      });
      console.log(`\n=== cps=${cps} 不点击 ===`);
      console.log(`首招老周：${r.firstRecruitMinute === null ? "7 天内没招到" : `${r.firstRecruitMinute} 分钟（= ${(r.firstRecruitMinute / 60).toFixed(1)} 小时后）`}`);
      for (const d of r.byDay) console.log(`D${d.day}: 累计=${(d.lifetime / 1e6).toFixed(3)}M idle=${d.idleRate.toFixed(2)}/s`);
    }
  }, 120_000);
});
