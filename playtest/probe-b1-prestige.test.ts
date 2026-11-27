import { describe, it } from "vitest";
import { DRAFT_TEAM, NO_TALENT, simulate, type SimOpts } from "./probe-b1-lib";
import { RANKS, rankFor } from "../src/engine/titles";

const base = (over: Partial<SimOpts>): SimOpts => ({
  days: 7, visitHours: [9, 13, 20], sessionSeconds: 600, cps: 0,
  recruit: true, dispatch: true, levelColleagues: true,
  team: DRAFT_TEAM, talent: NO_TALENT, prestige: false, dailyClaim: true, events: true,
  ...over,
});
const TALENT_RANKS = [3, 5, 7, 9, 11, 13]; // 第 3/5/7/9/11/13 档段位各 +1 天赋点

describe("B1 转生 / 天赋点节奏", () => {
  it("段位到达时刻（3 次回访/天，不转生）", () => {
    for (const cps of [0, 2, 3]) {
      const r = simulate(base({ cps }));
      const rows = TALENT_RANKS.map((n) => `${n}档(${RANKS[n - 1]!.name})=${(r.rankTimes[RANKS[n - 1]!.name] ?? NaN).toFixed(0)}min`);
      console.log(`cps=${cps}: ${rows.join(" ")}`);
    }
  });

  it("含转生：首转 / 天赋点累计时间（7 天窗口）", () => {
    for (const cps of [0, 3]) {
      const r = simulate(base({ cps, prestige: true, days: 7 }));
      const times = Object.entries(r.rankTimes).filter(([k]) => k.startsWith("prestige_")).map(([, v]) => v).sort((a, b) => a - b);
      console.log(
        `cps=${cps}: 转生 ${r.prestiges} 次，前 5 次=${times.slice(0, 5).map((t) => (t / 60).toFixed(0) + "min").join("/")} 首转后${times[0] ? ((times[0] / 60)).toFixed(0) : "-"}min`,
      );
      const ranksReached = TALENT_RANKS.filter((n) => r.rankTimes[RANKS[n - 1]!.name] !== undefined);
      console.log(`   段位天赋点已解锁 ${ranksReached.length} 个：${ranksReached.join(",")}`);
    }
  });

  it("参考：不转生 7 天 lifetime 与段位", () => {
    for (const cps of [0, 3]) {
      const r = simulate(base({ cps }));
      console.log(`cps=${cps}: lifetime=${(r.final.lifetime / 1e8).toFixed(0)}e8 段位=${r.final.rank} rankTimes=${JSON.stringify(Object.fromEntries(Object.entries(r.rankTimes).map(([k, v]) => [k, Math.round(v) + "min"])))}`);
    }
  });
});
