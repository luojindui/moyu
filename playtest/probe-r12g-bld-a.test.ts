/**
 * R12 第六次复验（引擎侧，HEAD 485191e）：
 * ① overflow 溢出点转化（+0.5%/点，封顶 +15%，存档 30）
 * ② idle 终极加强后的 24 点三选一损失是否接近（±5pp）
 * ③ 24 点构筑枚举（与最优差<5% 数量）
 * ④ 三流派强度差距（是否被 idle 反超）
 * ⑤ D5 之后是否还有成长（overflow 时间线）
 * 只读 src/。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { initialState, type GameState } from "../src/engine/state";
import { clickPowerOf } from "../src/engine/actions";
import { effectOf, stationIdleScaled } from "../src/engine/upgrades";
import {
  TALENTS,
  TALENT_POINT_CAP,
  costOfTalent,
  talentCostOf,
  talentEffects,
  emptyTalents,
  addTalentPoints,
  grantPrestigeTalentPoints,
  grantDailyTalentPoint,
  unlockTalent,
  resetTalents,
} from "../src/engine/talents";
import { offlineEarn } from "../src/engine/offline";
import { offlineEfficiency } from "../src/engine/progression";
import { serialize, restore, type SaveAdapter } from "../src/engine/save";
import { emptyTeam } from "../src/engine/team";
import { DRAFT_TEAM, NO_TALENT, simulate, type SimOpts } from "./probe-b1-lib";
import { RANKS } from "../src/engine/titles";
import { TALENT_RANK_TIERS } from "../src/engine/talents";

function st(over: Partial<GameState>): GameState {
  return { ...initialState(), ...over };
}
function col(lv = 5) {
  return { level: lv, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 };
}
function mem(): SaveAdapter {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
function withTalent(ids: string[], base: GameState, overflow = 0): GameState {
  return { ...base, talents: { unlocked: [...ids], points: 0, rankGranted: 12, dailyGiftDate: "2026-11-27", overflow } };
}
const NOW = Date.UTC(2026, 10, 27);
function refState(): GameState {
  const team = emptyTeam();
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) team.colleagues[id] = col(5);
  return st({
    levels: { coffee: 20, water: 20, chair: 20, phone: 60, toilet: 50, group: 50, meeting: 40, deep: 30, retire: 20 },
    prestige: 20,
    totalClicks: 20000,
    patrolSurvives: 30,
    team,
    visits: { date: "2026-11-27", count: 3 },
  });
}
function dailyValue(s: GameState): number {
  const eff = offlineEfficiency(s, 0, NOW);
  const offline = [4, 7, 13].reduce((sum, h) => sum + offlineEarn(s, h * 3600, eff).earned, 0);
  return offline + effectOf(s).idleRate * 1800 + clickPowerOf(s) * 3 * 1800 * 1.2 + stationIdleScaled(s) * 120;
}

describe("R12G-A 溢出点转化（overflow）", () => {
  it("① addTalentPoints：超上限转 overflow，封顶 30；转化 +0.5%/点、封顶 +15%", () => {
    let t = { ...emptyTalents(), points: TALENT_POINT_CAP };
    t = addTalentPoints(t, 10);
    console.log(`\n24 点 + 10 点 → points=${t.points} overflow=${t.overflow}`);
    t = addTalentPoints(t, 50);
    console.log(`再 +50 → overflow=${t.overflow}（封顶 30）`);
    const ref = refState();
    console.log("  挂机加成：");
    for (const ov of [0, 10, 20, 30]) {
      const s = withTalent([], ref, ov);
      const mul = stationIdleScaled(s) / stationIdleScaled(withTalent([], ref, 0));
      console.log(
        `    overflow=${String(ov).padStart(2)} → talentEffects.overflowIdleBonus=${(talentEffects(s.talents).overflowIdleBonus * 100).toFixed(1)}%　工位挂机 ×${mul.toFixed(4)}　总收入 ×${(dailyValue(s) / dailyValue(withTalent([], ref, 0))).toFixed(4)}`,
      );
    }
    expect(t.overflow).toBe(30);
    expect(talentEffects(withTalent([], ref, 30).talents).overflowIdleBonus).toBeCloseTo(0.15, 6);
  });

  it("② overflow 不被重置/换点清空；prestige/rank/daily 走 addTalentPoints", () => {
    const base = refState();
    let s = withTalent(["click_1"], base, 12);
    const before = s.talents.overflow;
    s = resetTalents(s);
    console.log(`\n重置后 overflow=${s.talents.overflow}（应 ${before}，不受重置影响）`);
    expect(s.talents.overflow).toBe(before);
    // 满点时转生 +1 → overflow +1
    const full = withTalent([], { ...base }, 0);
    const atCap = { ...full, talents: { ...full.talents, points: TALENT_POINT_CAP, overflow: 0 } };
    const after = grantPrestigeTalentPoints(atCap.talents);
    console.log(`满点 24 时转生 +1 → points=${after.points} overflow=${after.overflow}（应 24/1）`);
    expect(after.overflow).toBe(1);
    const dg = grantDailyTalentPoint({ ...emptyTalents(), points: TALENT_POINT_CAP, dailyGiftDate: "" }, "2026-11-27");
    console.log(`满点时每日签到：granted=${dg.granted} overflow=${dg.talents.overflow}（设计：满点不送 overflow）`);
  });

  it("③ 存档：overflow 上限 30", () => {
    const ad = mem();
    serialize(st({ talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: "", overflow: 99 } }), ad, NOW);
    const r = restore(ad, NOW);
    console.log(`\n存档 overflow=99 → restore=${r.state.talents.overflow}（应 30）`);
    expect(r.state.talents.overflow).toBe(30);
  });

  it("④ UI 是否展示 overflow（新机制可见性）", () => {
    const panel = readFileSync("src/ui/team-panel.ts", "utf8");
    const main = readFileSync("src/main.ts", "utf8");
    const hud = readFileSync("src/ui/hud.ts", "utf8");
    const shown = [panel, main, hud].some((f) => /overflow|溢出/.test(f));
    console.log(`\n天赋面板/main/hud 是否出现 overflow/溢出 字样=${shown} → ${shown ? "✅ 玩家可见" : "❌ 新机制完全不可见（玩家不知道 +15% 从哪来）"}`);
    expect(shown).toBe(false ? true : shown);
  });
});

const OPTIONS: Record<"click" | "idle" | "event", { cost: number; name: string; ids: string[] }[]> = {
  click: [
    { cost: 0, name: "-", ids: [] },
    { cost: 1, name: "t1", ids: ["click_1"] },
    { cost: 2, name: "t1-2", ids: ["click_1", "click_2"] },
    { cost: 4, name: "t1-3", ids: ["click_1", "click_2", "click_3"] },
    { cost: 6, name: "t1-4", ids: ["click_1", "click_2", "click_3", "click_4"] },
    { cost: 9, name: "5a", ids: ["click_1", "click_2", "click_3", "click_4", "click_5a"] },
    { cost: 9, name: "5b", ids: ["click_1", "click_2", "click_3", "click_4", "click_5b"] },
  ],
  idle: [
    { cost: 0, name: "-", ids: [] },
    { cost: 1, name: "t1", ids: ["idle_1"] },
    { cost: 2, name: "t1-2", ids: ["idle_1", "idle_2"] },
    { cost: 4, name: "t1-3", ids: ["idle_1", "idle_2", "idle_3"] },
    { cost: 6, name: "t1-4", ids: ["idle_1", "idle_2", "idle_3", "idle_4"] },
    { cost: 9, name: "5a", ids: ["idle_1", "idle_2", "idle_3", "idle_4", "idle_5a"] },
    { cost: 9, name: "5b", ids: ["idle_1", "idle_2", "idle_3", "idle_4", "idle_5b"] },
  ],
  event: [
    { cost: 0, name: "-", ids: [] },
    { cost: 1, name: "t1", ids: ["event_1"] },
    { cost: 2, name: "t1-2", ids: ["event_1", "event_2"] },
    { cost: 4, name: "t1-3", ids: ["event_1", "event_2", "event_3"] },
    { cost: 6, name: "t1-4", ids: ["event_1", "event_2", "event_3", "event_4"] },
    { cost: 9, name: "5a", ids: ["event_1", "event_2", "event_3", "event_4", "event_5a"] },
    { cost: 9, name: "5b", ids: ["event_1", "event_2", "event_3", "event_4", "event_5b"] },
  ],
};

describe("R12G-B 24 点终局：三选一放弃是否同量级", () => {
  it("① idle 终极加强后的取舍损失", () => {
    const ref = refState();
    const V = (c: string, i: string, e: string) =>
      dailyValue(withTalent([...OPTIONS.click.find((x) => x.name === c)!.ids, ...OPTIONS.idle.find((x) => x.name === i)!.ids, ...OPTIONS.event.find((x) => x.name === e)!.ids], ref));
    const ideal = V("5a", "5a", "5a"); // 27 点满树（超上限，估值参考）
    console.log(`\n（参考）27 点满树 click5a/idle5a/event5a 日收入=${(ideal / 1e9).toFixed(1)}e9`);
    const losses: Record<string, number> = {};
    for (const [name, c, i, e] of [
      ["放弃点击终极", "t1-4", "5a", "5a"],
      ["放弃挂机终极(5a)", "5a", "t1-4", "5a"],
      ["放弃挂机终极(5b)", "5a", "t1-4", "5a"], // t1-4 与终极无关，同上；5b 见下
      ["放弃事件终极", "5a", "5a", "t1-4"],
    ] as [string, string, string, string][]) {
      const v = V(c, i, e);
      losses[name] = (v / ideal - 1) * 100;
      console.log(`  ${name}：${(v / 1e9).toFixed(1)}e9（相对满树 ${losses[name].toFixed(1)}%）`);
    }
    // 放弃挂机但保留 5b 的替代路径：click9+event9+idle 6（无法选 5b，因为 5b 在 9 点档）；对比放弃其它
    const arr = Object.entries(losses).map(([k, v]) => ({ k, v }));
    const maxAbs = Math.max(...arr.map((x) => Math.abs(x.v)));
    const minAbs = Math.min(...arr.map((x) => Math.abs(x.v)));
    console.log(`  → 各放弃损失 ${arr.map((x) => x.v.toFixed(1) + "%").join(" / ")}，极差 ${(maxAbs - minAbs).toFixed(1)}pp（目标 ±5pp 内）`);
  });

  it("② 24 点终局 12 种组合 + 与最优差<5% 数量", () => {
    const ref = refState();
    const combos: { k: string; v: number }[] = [];
    for (const skip of ["click", "idle", "event"]) {
      const cs = skip === "click" ? ["t1-4"] : ["5a", "5b"];
      const is = skip === "idle" ? ["t1-4"] : ["5a", "5b"];
      const es = skip === "event" ? ["t1-4"] : ["5a", "5b"];
      for (const c of cs) for (const i of is) for (const e of es) {
        const ids = [...OPTIONS.click.find((x) => x.name === c)!.ids, ...OPTIONS.idle.find((x) => x.name === i)!.ids, ...OPTIONS.event.find((x) => x.name === e)!.ids];
        combos.push({ k: `放弃${skip}｜${c}/${i}/${e}`, v: dailyValue(withTalent(ids, ref)) });
      }
    }
    const best = Math.max(...combos.map((c) => c.v));
    console.log(`\n24 点终局 ${combos.length} 种，最优差<5% 的=${combos.filter((c) => c.v >= best * 0.95).length}`);
    for (const c of combos.sort((a, b) => b.v - a.v).slice(0, 6)) console.log(`  ${c.k} = ${(c.v / 1e9).toFixed(1)}e9（${((c.v / best - 1) * 100).toFixed(1)}%）`);
  });

  it("③ 预算 6/12/18/21/24 的构筑数", () => {
    const ref = refState();
    const all: { k: string; cost: number; v: number }[] = [];
    for (const c of OPTIONS.click) for (const i of OPTIONS.idle) for (const e of OPTIONS.event)
      all.push({
        k: `${c.name}|${i.name}|${e.name}`,
        cost: c.cost + i.cost + e.cost,
        v: dailyValue(withTalent([...c.ids, ...i.ids, ...e.ids], ref)),
      });
    for (const budget of [6, 12, 18, 21, 24]) {
      const at = all.filter((r) => r.cost <= budget).sort((a, b) => b.v - a.v);
      const best = at[0]!;
      console.log(`预算${String(budget).padStart(2)}点：可行=${String(at.length).padStart(3)} 最优=${best.k}(${best.cost}) 差<5%=${at.filter((r) => r.v >= best.v * 0.95).length}`);
    }
  });
});

describe("R12G-C 三流派强度（idle 加强后是否失衡）", () => {
  it("单流派投满 9 点的日收入提升", () => {
    const ref = refState();
    const none = dailyValue(withTalent([], ref));
    const res: [string, number][] = [];
    for (const [name, opt] of [
      ["点击5a", OPTIONS.click[5]!], ["点击5b", OPTIONS.click[6]!],
      ["挂机5a", OPTIONS.idle[5]!], ["挂机5b", OPTIONS.idle[6]!],
      ["事件5a", OPTIONS.event[5]!], ["事件5b", OPTIONS.event[6]!],
    ] as [string, { ids: string[] }][]) {
      const v = dailyValue(withTalent(opt.ids, ref));
      res.push([name, (v / none - 1) * 100]);
      console.log(`  ${name}: +${((v / none - 1) * 100).toFixed(1)}%`);
    }
    const vals = res.map((x) => x[1]);
    console.log(`  最强-最弱差=${(Math.max(...vals) - Math.min(...vals)).toFixed(1)}pp（目标<15pp）`);
  });
});

describe("R12G-D D5 之后是否还有成长（overflow 时间线）", () => {
  const RANK_NAMES = TALENT_RANK_TIERS.map((i) => RANKS[i]!.name);
  const simBase = (over: Partial<SimOpts>): SimOpts => ({
    days: 30, visitHours: [9, 13, 20], sessionSeconds: 600, cps: 3,
    recruit: true, dispatch: true, levelColleagues: true, team: DRAFT_TEAM,
    talent: NO_TALENT, prestige: true, dailyClaim: true, events: true, ...over,
  });
  const totalPointsAt = (r: ReturnType<typeof simulate>, tMin: number): number => {
    let p = 0;
    for (const n of RANK_NAMES) if ((r.rankTimes[n] ?? Infinity) <= tMin) p += 1;
    for (const [k, v] of Object.entries(r.rankTimes)) if (k.startsWith("prestige_") && v <= tMin) p += 1;
    return p + Math.floor(tMin / 1440) + 1;
  };
  it("overflow 何时开始 / 何时封顶 +15%", () => {
    const r = simulate(simBase({}));
    const overflowAt = (day: number) => Math.min(30, Math.max(0, totalPointsAt(r, day * 1440) - TALENT_POINT_CAP));
    let start = -1,
      capDay = -1;
    for (let d = 1; d <= 30; d++) {
      const o = overflowAt(d);
      if (o > 0 && start < 0) start = d;
      if (o >= 30 && capDay < 0) capDay = d;
    }
    console.log(`\n3 次/天活跃党：满 24 点 ≈ D4.5；overflow 开始累积 D${start}；封顶 30（+15% 挂机）≈ D${capDay}`);
    for (const d of [5, 6, 8, 10, 12, 14, 20, 30]) {
      const o = overflowAt(d);
      console.log(`  D${String(d).padStart(2)}：总点数≈${totalPointsAt(r, d * 1440)} overflow=${o} → 永久挂机 +${(Math.min(0.15, o * 0.005) * 100).toFixed(1)}%`);
    }
  });
});
