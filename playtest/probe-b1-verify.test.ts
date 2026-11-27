import { describe, it } from "vitest";
import { DRAFT_TEAM, NO_TALENT, TAL_CLICK, TAL_EVENT, TAL_IDLE, simulate, type SimOpts, type TalentCfg } from "./probe-b1-lib";

const ARCH = [
  { name: "纯挂机(0cps)", cps: 0, sessionSeconds: 600 },
  { name: "休闲点击(1cps)", cps: 1, sessionSeconds: 600 },
  { name: "点击党(3cps)", cps: 3, sessionSeconds: 600 },
];
const VISITS = [9, 13, 20];

const base = (over: Partial<SimOpts>): SimOpts => ({
  days: 7, visitHours: VISITS, sessionSeconds: 600, cps: 0,
  recruit: true, dispatch: true, levelColleagues: true,
  team: DRAFT_TEAM, talent: NO_TALENT, prestige: false, dailyClaim: true, events: true,
  ...over,
});

function run(o: SimOpts) { return simulate(o); }
const pct = (x: number) => (x * 100).toFixed(1) + "%";
const e8 = (x: number) => (x / 1e8).toFixed(1) + "e8";

describe("B1 验证", () => {
  it("① 7 天曲线：不招募 / 招募不派遣 / 招募+派遣", () => {
    for (const a of ARCH) {
      const rows: string[] = [];
      let baseTotal = 0;
      for (const stra of ["none", "noDispatch", "dispatch"] as const) {
        const r = run(base({ cps: a.cps, sessionSeconds: a.sessionSeconds, recruit: stra !== "none", dispatch: stra === "dispatch", levelColleagues: stra !== "none" }));
        const t = r.totals;
        if (stra === "none") baseTotal = t.total;
        const life = (d: number) => (r.byDay[d - 1]?.lifetime ?? 0).toFixed(0);
        rows.push(
          `${stra}: 7天总入=${e8(t.total)} 相对无小队=${pct(t.total / baseTotal - 1)} 派遣占比=${pct(t.dispatch / t.total)} 同事挂机占比=${pct(t.teamIdle / t.total)}  D1/D3/D7累计=${life(1)}/${life(3)}/${life(7)}  期末idle=${(r.final.idleRate).toFixed(0)}/s 同事占idle=${pct(r.final.teamIdle / r.final.idleRate)}`,
        );
      }
      console.log(`\n### ${a.name}（3 次回访/天，每次 ${a.sessionSeconds / 60}min）\n` + rows.join("\n"));
    }
  });

  it("② 30 天曲线", () => {
    for (const a of ARCH) {
      const rows: string[] = [];
      let baseTotal = 0;
      for (const stra of ["none", "noDispatch", "dispatch"] as const) {
        const r = run(base({ days: 30, cps: a.cps, sessionSeconds: a.sessionSeconds, recruit: stra !== "none", dispatch: stra === "dispatch", levelColleagues: stra !== "none" }));
        const t = r.totals;
        if (stra === "none") baseTotal = t.total;
        const life = (d: number) => (r.byDay[d - 1]?.lifetime ?? 0).toFixed(0);
        rows.push(
          `${stra}: 30天总入=${e8(t.total)} 相对无小队=${pct(t.total / baseTotal - 1)} 派遣占比=${pct(t.dispatch / t.total)}  D1/D7/D14/D30累计=${life(1)}/${life(7)}/${life(14)}/${life(30)}  期末idle=${(r.final.idleRate).toFixed(0)}/s 同事占idle=${pct(r.final.teamIdle / r.final.idleRate)}`,
        );
      }
      console.log(`\n### ${a.name} 30 天\n` + rows.join("\n"));
    }
  });

  it("③ 天赋三流派满级收益（7 天、无转生）", () => {
    for (const a of ARCH) {
      const none = run(base({ cps: a.cps, sessionSeconds: a.sessionSeconds }));
      const click = run(base({ cps: a.cps, sessionSeconds: a.sessionSeconds, talent: TAL_CLICK }));
      const idle = run(base({ cps: a.cps, sessionSeconds: a.sessionSeconds, talent: TAL_IDLE }));
      const event = run(base({ cps: a.cps, sessionSeconds: a.sessionSeconds, talent: TAL_EVENT }));
      console.log(
        `\n### ${a.name}：点击流 ${pct(click.totals.total / none.totals.total - 1)}｜挂机流 ${pct(idle.totals.total / none.totals.total - 1)}｜事件流 ${pct(event.totals.total / none.totals.total - 1)}｜事件流事件占比 ${pct(event.totals.event / event.totals.total)}（基线 ${pct(none.totals.event / none.totals.total)}）`,
      );
    }
  });

  it("④ 30 天天赋流派收益（转化类效果给足时间）", () => {
    for (const a of ARCH) {
      const none = run(base({ days: 30, cps: a.cps, sessionSeconds: a.sessionSeconds }));
      const click = run(base({ days: 30, cps: a.cps, sessionSeconds: a.sessionSeconds, talent: TAL_CLICK }));
      const idle = run(base({ days: 30, cps: a.cps, sessionSeconds: a.sessionSeconds, talent: TAL_IDLE }));
      const event = run(base({ days: 30, cps: a.cps, sessionSeconds: a.sessionSeconds, talent: TAL_EVENT }));
      console.log(
        `\n### ${a.name} 30 天：点击流 ${pct(click.totals.total / none.totals.total - 1)}｜挂机流 ${pct(idle.totals.total / none.totals.total - 1)}｜事件流 ${pct(event.totals.total / none.totals.total - 1)}`,
      );
    }
  });

  it("⑤ 30 天：重在线玩家（每天 2 小时连续）三流派", () => {
    const heavy: SimOpts = base({ days: 30, cps: 3, visitHours: [20], sessionSeconds: 7200 });
    const none = run(heavy);
    const click = run({ ...heavy, talent: TAL_CLICK });
    const idle = run({ ...heavy, talent: TAL_IDLE });
    const event = run({ ...heavy, talent: TAL_EVENT });
    console.log(
      `重在线：无天赋=${e8(none.totals.total)} 点击流 ${pct(click.totals.total / none.totals.total - 1)}｜挂机流 ${pct(idle.totals.total / none.totals.total - 1)}｜事件流 ${pct(event.totals.total / none.totals.total - 1)}｜点击收入占比 ${pct(none.totals.click / none.totals.total)}`,
    );
  });
});
