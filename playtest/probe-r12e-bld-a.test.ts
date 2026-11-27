/**
 * R12 第五次复验（引擎侧，HEAD 5a26f62）：24 点上限 / 花费标签 / event_5b 离线 / 终局取舍枚举。
 * 只读 src/。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { initialState, type GameState } from "../src/engine/state";
import { clickPowerOf } from "../src/engine/actions";
import { effectOf, stationIdleScaled, conversionBonus } from "../src/engine/upgrades";
import {
  TALENTS,
  TALENT_POINT_CAP,
  costOfTalent,
  talentCostOf,
  canUnlock,
  unlockTalent,
  resetTalents,
  emptyTalents,
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
function withTalent(ids: string[], base: GameState): GameState {
  return { ...base, talents: { unlocked: [...ids], points: 0, rankGranted: 12, dailyGiftDate: "2026-11-27" } };
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

describe("R12E-A 本轮三项修复", () => {
  it("① 面板花费标签 / 上限文案与实装一致", () => {
    const panel = readFileSync("src/ui/team-panel.ts", "utf8");
    const usesCost = panel.includes("const need = costOfTalent(t.id)");
    const oldLogic = panel.includes("t.tier >= 5 ? 2 : 1");
    const capText = panel.includes("上限 24");
    const ultLabel = panel.includes("终极·${need}点");
    console.log(`\nneed=costOfTalent=${usesCost}　旧逻辑残留=${oldLogic}　底部上限 24=${capText}　终极·N点=${ultLabel}`);
    console.log(`  实装花费：t1=${talentCostOf(1)} t2=${talentCostOf(2)} t3=${talentCostOf(3)} t4=${talentCostOf(4)} 终极=${talentCostOf(5)}`);
    expect(usesCost).toBe(true);
    expect(oldLogic).toBe(false);
    expect(capText).toBe(true);
  });

  it("② 上限 24 < 满树 27：确实点不满全树", () => {
    const branchCosts = (branch: string) =>
      TALENTS.filter((t) => t.branch === branch && t.tier <= 4).reduce((s, t) => s + costOfTalent(t.id), 0) + 3;
    const per = branchCosts("click");
    console.log(`\n每流派满配=${per} 点（t1-4=${per - 3}+终极 3）　三流派=${per * 3}　上限=${TALENT_POINT_CAP}`);
    // 贪心：用 24 点点满 click(9)+idle(9)，event 只剩 6 点
    let s: GameState = st({ talents: { unlocked: [], points: TALENT_POINT_CAP, rankGranted: 12, dailyGiftDate: "2026-11-27" } });
    for (const id of ["click_1", "click_2", "click_3", "click_4", "click_5a", "idle_1", "idle_2", "idle_3", "idle_4", "idle_5a"]) s = unlockTalent(s, id)!;
    console.log(`点满点击+挂机后剩 ${s.talents.points} 点；event 只能点 t1+t2（1+1）+t3（2）+t4（2）=6 → 终极需 3 点，余额不足=${!canUnlock(s.talents, "event_5a")}`);
    expect(s.talents.points).toBe(6);
    expect(canUnlock(s.talents, "event_5a")).toBe(false);
    // 再点 event t1-4 耗尽
    for (const id of ["event_1", "event_2", "event_3", "event_4"]) s = unlockTalent(s, id)!;
    console.log(`再点 event t1-4 后余额=${s.talents.points}（=0，无法点终极）`);
    expect(s.talents.points).toBe(0);
    expect(s.talents.unlocked.length).toBe(14); // 15 个位子里少了那个终极
  });

  it("③ event_5b 离线 +20%：3 次/天也能吃到", () => {
    const base = refState();
    const without = withTalent(["event_1", "event_2", "event_3", "event_4"], base);
    const withB = withTalent(["event_1", "event_2", "event_3", "event_4", "event_5b"], base);
    const withBIdle4 = withTalent(["event_1", "event_2", "event_3", "event_4", "event_5b", "idle_1", "idle_2", "idle_3", "idle_4"], base);
    for (const visits of [1, 2, 3]) {
      const mk = (s: GameState) => ({ ...s, visits: { date: "2026-11-27", count: visits }, team: emptyTeam() });
      const e0 = offlineEfficiency(mk(without), 0, NOW);
      const e1 = offlineEfficiency(mk(withB), 0, NOW);
      const e2 = offlineEfficiency(mk(withBIdle4), 0, NOW);
      console.log(
        `回访 ${visits} 次/天：无 5b=${e0.toFixed(2)} → 有 5b=${e1.toFixed(2)}（+${((e1 / e0 - 1) * 100).toFixed(1)}%）　再加 idle_4=${e2.toFixed(2)}`,
      );
    }
    const v0 = dailyValue(without);
    const v1 = dailyValue(withB);
    console.log(`日收入（3 次/天画像）：无 5b=${(v0 / 1e9).toFixed(1)}e9 → 有 5b=${(v1 / 1e9).toFixed(1)}e9（+${((v1 / v0 - 1) * 100).toFixed(1)}%）`);
    expect(offlineEfficiency({ ...withB, visits: { date: "x", count: 3 }, team: emptyTeam() }, 0, NOW)).toBeCloseTo(1.2, 2);
  });

  it("④ 存档上限 24 + 重置返还分级花费", () => {
    const ad = mem();
    serialize(st({ talents: { unlocked: [], points: 24, rankGranted: 12, dailyGiftDate: "" } }), ad, NOW);
    const r = restore(ad, NOW);
    let s: GameState = st({ talents: { unlocked: [], points: TALENT_POINT_CAP, rankGranted: 12, dailyGiftDate: "" } });
    for (const id of ["click_1", "click_2", "click_3"]) s = unlockTalent(s, id)!; // 1+1+2=4
    const reset = resetTalents(s);
    console.log(`\n存档 24 → restore=${r.state.talents.points}；点 click1-3 花 ${TALENT_POINT_CAP - s.talents.points} 点，重置返还 ${reset.talents.points}`);
    expect(r.state.talents.points).toBe(24);
    expect(TALENT_POINT_CAP - s.talents.points).toBe(4);
    expect(reset.talents.points).toBe(24);
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

describe("R12E-B 24 点终局构筑枚举", () => {
  const rows = () => {
    const ref = refState();
    const out: { k: string; cost: number; v: number; ids: string[] }[] = [];
    for (const c of OPTIONS.click)
      for (const i of OPTIONS.idle)
        for (const e of OPTIONS.event) {
          const ids = [...c.ids, ...i.ids, ...e.ids];
          out.push({ k: `${c.name} | ${i.name} | ${e.name}`, cost: c.cost + i.cost + e.cost, v: dailyValue(withTalent(ids, ref)), ids });
        }
    return out;
  };
  it("预算 6/12/18/21/24 的可行构筑数", () => {
    const all = rows();
    for (const budget of [6, 12, 18, 21, 24]) {
      const at = all.filter((r) => r.cost <= budget).sort((a, b) => b.v - a.v);
      const best = at[0]!;
      console.log(
        `\n预算${String(budget).padStart(2)}点：可行=${String(at.length).padStart(3)}　最优=${best.k}(${best.cost}点)　差<5%的=${at.filter((r) => r.v >= best.v * 0.95).length}　差<10%的=${at.filter((r) => r.v >= best.v * 0.9).length}`,
      );
      if (budget === 24) console.log(`  前5：${at.slice(0, 5).map((r) => `${r.k}(${r.cost}点)=${(r.v / 1e9).toFixed(1)}e9`).join("  ")}`);
    }
  });

  it("终局 24 点：必须放弃什么？", () => {
    const all = rows().filter((r) => r.cost === 24);
    const best = all.sort((a, b) => b.v - a.v)[0]!;
    console.log(`\n恰好花 24 点的组合共 ${all.length} 种；最优=${best.k}`);
    // 各类"放弃"选项的价值
    const full = (c: string, i: string, e: string) => dailyValue(withTalent([...OPTIONS.click.find(x=>x.name===c)!.ids,...OPTIONS.idle.find(x=>x.name===i)!.ids,...OPTIONS.event.find(x=>x.name===e)!.ids], refState()));
    const ref = dailyValue(withTalent([...OPTIONS.click[5]!.ids, ...OPTIONS.idle[5]!.ids, ...OPTIONS.event[5]!.ids], refState())); // 27 点满树（超上限，仅估值参考）
    console.log(`  （参考）27 点满树 5a/5a/5a 日收入=${(ref / 1e9).toFixed(1)}e9`);
    for (const [name, c, i, e] of [
      ["放弃点击终极（click 6 + idle9 + event9）", "t1-4", "5a", "5a"],
      ["放弃挂机终极（click9 + idle 6 + event9）", "5a", "t1-4", "5a"],
      ["放弃事件终极（click9 + idle9 + event 6）", "5a", "5a", "t1-4"],
    ] as [string, string, string, string][]) {
      const v = full(c, i, e);
      console.log(`  ${name}：日收入=${(v / 1e9).toFixed(1)}e9（相对满树 ${((v / ref - 1) * 100).toFixed(1)}%）`);
    }
    // 互斥终极下的 12 种"选哪条流吃亏"组合
    const combos: { k: string; v: number }[] = [];
    for (const skip of ["click", "idle", "event"]) {
      const cs = skip === "click" ? ["t1-4"] : ["5a", "5b"];
      const is = skip === "idle" ? ["t1-4"] : ["5a", "5b"];
      const es = skip === "event" ? ["t1-4"] : ["5a", "5b"];
      for (const c of cs) for (const i of is) for (const e of es) {
        const ids = [...OPTIONS.click.find((x) => x.name === c)!.ids, ...OPTIONS.idle.find((x) => x.name === i)!.ids, ...OPTIONS.event.find((x) => x.name === e)!.ids];
        combos.push({ k: `放弃${skip}终极｜click=${c} idle=${i} event=${e}`, v: dailyValue(withTalent(ids, refState())) });
      }
    }
    const bestC = Math.max(...combos.map((c) => c.v));
    console.log(`\n24 点终局共 ${combos.length} 种（3 种放弃 × 2×2 终极）；差<5% 的=${combos.filter((c) => c.v >= bestC * 0.95).length}`);
    for (const c of combos.sort((a, b) => b.v - a.v).slice(0, 6)) console.log(`  ${c.k} = ${(c.v / 1e9).toFixed(1)}e9（${((c.v / bestC - 1) * 100).toFixed(1)}%）`);
  });
});

describe("R12E-C 节奏（24 点）", () => {
  const RANK_NAMES = TALENT_RANK_TIERS.map((i) => RANKS[i]!.name);
  const simBase = (over: Partial<SimOpts>): SimOpts => ({
    days: 30, visitHours: [9, 13, 20], sessionSeconds: 600, cps: 0,
    recruit: true, dispatch: true, levelColleagues: true, team: DRAFT_TEAM,
    talent: NO_TALENT, prestige: true, dailyClaim: true, events: true, ...over,
  });
  const pointsAt = (r: ReturnType<typeof simulate>, tMin: number): number => {
    let p = 0;
    for (const n of RANK_NAMES) if ((r.rankTimes[n] ?? Infinity) <= tMin) p += 1;
    for (const [k, v] of Object.entries(r.rankTimes)) if (k.startsWith("prestige_") && v <= tMin) p += 1;
    p += Math.floor(tMin / 1440) + 1;
    return Math.min(p, TALENT_POINT_CAP);
  };
  it("3 次/天 & 1 次/天：满 24 点时间", () => {
    for (const cfg of [{ name: "3次/天 cps=3", o: null }, { name: "1次/天 cps=0", o: { visitHours: [21] } as Partial<SimOpts> }]) {
      const r = simulate(cfg.o ? simBase({ ...cfg.o }) : simBase({ cps: 3 }));
      let full = Infinity;
      for (let mm = 0; mm <= 30 * 1440; mm += 60) if (pointsAt(r, mm) >= TALENT_POINT_CAP) { full = mm; break; }
      console.log(`\n${cfg.name}：24 点满树 ≈ ${full === Infinity ? "未到" : (full / 1440).toFixed(1) + " 天"}；30 天总点数≈${r.prestiges + 6 + 30} → 溢出 ${r.prestiges + 6 + 30 - TALENT_POINT_CAP}`);
    }
  });
});
