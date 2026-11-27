import { describe, it } from "vitest";
import { rankFor } from "../src/engine/titles";
import { simulate, DRAFT_TEAM, NO_TALENT } from "./probe-b1-lib";
describe("dbg", () => {
  it("rank", () => {
    console.log("直接调用", JSON.stringify(rankFor(1e6)));
    const r = simulate({ days: 1, visitHours: [9, 13, 20], sessionSeconds: 60, cps: 0, recruit: false, dispatch: false, levelColleagues: false, team: DRAFT_TEAM, talent: NO_TALENT, prestige: false, dailyClaim: true, events: false });
    console.log("final", JSON.stringify(r.final));
    console.log("byDay", JSON.stringify(r.byDay));
  });
});
