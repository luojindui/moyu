import { describe, it } from "vitest";
import { simulate, branchLinearIds, ultimateIds, branchBuild, pct, fmt, secs } from "./probe-r12-data-lib";
import { TALENTS, talentEffects, costOfTalent, TALENT_POINT_CAP, ULTIMATE_COST } from "../src/engine/talents";

const VISITS = [9, 13, 20];

const CLICK_A = branchBuild("click", 0); // 摸鱼转正（转化）
const CLICK_B = branchBuild("click", 1); // 指尖风暴（点击）
const IDLE_A = branchBuild("idle", 0); // 最稳 +8%
const IDLE_B = branchBuild("idle", 1); // 带队摸鱼 +40% 同事
const EVENT_A = branchBuild("event", 0); // 摸鱼气场（转化）
const EVENT_B = branchBuild("event", 1); // 老板眼线（事件奖励×2）
const MIXED = [...CLICK_A, ...EVENT_A];
const MAX18 = [...CLICK_A, ...IDLE_A, ...EVENT_A];

const costOfBuild = (ids: string[]) => ids.reduce((s, id) => s + costOfTalent(id), 0);

function run(days: number, cps: number, ids: string[], team = false) {
  return simulate({
    days,
    visitHours: VISITS,
    sessionSeconds: 600,
    cps,
    talents: ids,
    team: team ? "smart" : "none",
    snapshots: false,
  });
}

describe("R12R2-3 三流派（18 树 + 互斥终极）", () => {
  it("① 天赋树结构 & 点数", () => {
    console.log(`\n### 树：${TALENTS.length} 个天赋，上限 ${TALENT_POINT_CAP} 点；终极 ${ULTIMATE_COST} 点互斥`);
    for (const branch of ["click", "idle", "event"] as const) {
      const lin = branchLinearIds(branch);
      const ult = ultimateIds(branch);
      console.log(
        `${branch}: 线性 ${lin.map((id) => TALENTS.find((t) => t.id === id)!.desc).join("；")}｜终极 ${ult
          .map((id) => `${TALENTS.find((t) => t.id === id)!.name}(${costOfTalent(id)}点)`)
          .join(" or ")}`,
      );
    }
    console.log(`单流派满配 = 4 线性 + 1 终极 = 6 点；三条全满 = 18 点（每次转生 +1，段位 6 点）`);
  });

  it("② 各流派收益（7 天 / 30 天，3 画像；单流派 6 点 & 混搭 12 点 & 全 18 点）", () => {
    const cfgs: [string, string[]][] = [
      ["无天赋", []],
      ["点击A(转化)", CLICK_A],
      ["点击B(点击)", CLICK_B],
      ["挂机A(+20%挂机)", IDLE_A],
      ["挂机B(带队)", IDLE_B],
      ["事件A(转化)", EVENT_A],
      ["事件B(事件×2)", EVENT_B],
      ["点+事A(12点)", MIXED],
      ["全18(三A)", MAX18],
    ];
    for (const days of [7, 30]) {
      for (const cps of [0, 1, 3]) {
        const base = run(days, cps, []);
        const rows = cfgs.map(([name, ids]) => {
          const r = ids.length ? run(days, cps, ids) : base;
          const d = r.totals.lifetime / base.totals.lifetime - 1;
          return `${name.padEnd(14)}: ${d >= 0 ? "+" : ""}${pct(d)}（${costOfBuild(ids)}点）期末挂机=${fmt(r.final.idleRate)}/s 点击=${r.final.totalClicks}`;
        });
        console.log(`\n### ${days} 天 · cps=${cps}\n` + rows.join("\n"));
      }
    }
  });

  it("③ 每点效率（30 天 cps=1）", () => {
    const base = run(30, 1, []);
    const list: [string, string[]][] = [
      ["点击A", CLICK_A],
      ["点击B", CLICK_B],
      ["挂机A", IDLE_A],
      ["挂机B", IDLE_B],
      ["事件A", EVENT_A],
      ["事件B", EVENT_B],
      ["点+事A", MIXED],
      ["全18(三A)", MAX18],
    ];
    for (const [name, ids] of list) {
      const r = run(30, 1, ids);
      const gain = r.totals.lifetime / base.totals.lifetime - 1;
      console.log(`${name}: 收益 ${pct(gain)} / ${costOfBuild(ids)} 点 = ${pct(gain / costOfBuild(ids))}/点`);
    }
  });

  it("④ 逐天赋边际（各自流派内，尊重互斥）", () => {
    const builds: [string, string[]][] = [
      ["点击A", CLICK_A],
      ["点击B", CLICK_B],
      ["挂机A", IDLE_A],
      ["挂机B", IDLE_B],
      ["事件A", EVENT_A],
      ["事件B", EVENT_B],
    ];
    for (const [label, ids] of builds) {
      const cps = label.startsWith("点击") ? 3 : 1;
      const full = run(7, cps, ids);
      const rows: string[] = [];
      for (const id of ids) {
        const def = TALENTS.find((t) => t.id === id)!;
        const less = run(7, cps, ids.filter((x) => x !== id));
        rows.push(`  ${def.name}(${def.desc}): 该天赋贡献 ${pct(full.totals.lifetime / less.totals.lifetime - 1)}`);
      }
      console.log(`\n### ${label} · cps=${cps}\n` + rows.join("\n"));
    }
  });

  it("⑤ 互斥终极二选一：同价格下选哪个更赚（7 天）", () => {
    for (const [branch, a, b] of [
      ["点击", CLICK_A, CLICK_B],
      ["挂机", IDLE_A, IDLE_B],
      ["事件", EVENT_A, EVENT_B],
    ] as const) {
      const cps = branch === "点击" ? 3 : 1;
      const ra = run(7, cps, a);
      const rb = run(7, cps, b);
      const label = (ids: string[]) => TALENTS.find((t) => t.id === ids[4]!)!.name;
      console.log(
        `${branch}：${label(a)} 总入=${fmt(ra.totals.lifetime)} vs ${label(b)} 总入=${fmt(rb.totals.lifetime)} → 优 ${ra.totals.lifetime > rb.totals.lifetime ? label(a) : label(b)}（${pct(Math.max(ra.totals.lifetime, rb.totals.lifetime) / Math.min(ra.totals.lifetime, rb.totals.lifetime) - 1)}）`,
      );
    }
  });

  it("⑥ 有队时挂机B（带队摸鱼 +40%）到底有没有生效", () => {
    // 同一小队状态，比较 idle_5b 点/不点
    const a = simulate({ days: 3, visitHours: VISITS, sessionSeconds: 600, cps: 1, team: "smart", talents: branchBuild("idle", 1), snapshots: false });
    const b = simulate({ days: 3, visitHours: VISITS, sessionSeconds: 600, cps: 1, team: "smart", talents: branchLinearIds("idle"), snapshots: false });
    console.log(
      `\n### 队内挂机B：总入=${fmt(a.totals.lifetime)} vs 仅线性=${fmt(b.totals.lifetime)}（差 ${pct(a.totals.lifetime / b.totals.lifetime - 1)}）；期末 idle=${fmt(a.final.idleRate)} vs ${fmt(b.final.idleRate)}`,
    );
    console.log("（若 +40% 生效，期末 idle 应显著更高；无差异即为未接线）");
  });
});

describe("R12R2-3b 终极二选一在「满级小队/高工位」下是否翻转", () => {
  it("挂机A vs 挂机B（满级 5 同事，工位≈100万/s）", async () => {
    const { initialState, gain } = await import("../src/engine/state");
    const { buyUpgrade } = await import("../src/engine/actions");
    const { effectOf, stationIdleScaled } = await import("../src/engine/upgrades");
    const { recruit, upgradeColleague, COLLEAGUES, MAX_COLLEAGUE_LEVEL } = await import("../src/engine/team");
    const { withTalents } = await import("./probe-r12-data-lib");
    let s = gain(initialState(), 1e18);
    for (let i = 0; i < 400; i++) {
      const n = buyUpgrade(s, "phone");
      if (!n) break;
      s = n;
      if (stationIdleScaled(s) > 1e6) break;
    }
    for (const d of COLLEAGUES) {
      s = recruit(s, d.id)!;
      for (let lv = 1; lv < MAX_COLLEAGUE_LEVEL; lv++) s = upgradeColleague(s, d.id)!;
    }
    const station = stationIdleScaled(s);
    const teamPart = effectOf(s).idleRate - station;
    console.log(`\n工位=${fmt(station)}/s 同事贡献=${fmt(teamPart)}/s（占 ${pct(teamPart / effectOf(s).idleRate)}）`);
    const lin = branchLinearIds("idle");
    for (const [name, ids] of [
      ["只线性", lin],
      ["线性+最稳(5a)", [...lin, "idle_5a"]],
      ["线性+带队(5b)", [...lin, "idle_5b"]],
    ] as const) {
      const r = withTalents(s, ids);
      console.log(`${name}: idleRate=${fmt(effectOf(r).idleRate)}/s`);
    }
  });

  it("点击流里的点击收入占比（决定 5b 是否有用）", () => {
    for (const cps of [1, 3]) {
      const r = simulate({ days: 30, visitHours: [9, 13, 20], sessionSeconds: 600, cps, team: "none", snapshots: false });
      console.log(
        `cps=${cps} 30 天：点击收入=${fmt(r.totals.click)} 占 ${pct(r.totals.click / r.totals.lifetime)}｜事件收入=${fmt(r.totals.event)} 占 ${pct(r.totals.event / r.totals.lifetime)}`,
      );
    }
  });
});
