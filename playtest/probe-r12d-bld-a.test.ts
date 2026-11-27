/**
 * R12 第四次复验（引擎侧，HEAD bcb2a7b/62f1486）：
 * ① 27 点 + 分级花费下的构筑枚举（预算 6/12/18/24/27）
 * ② click_5b(32% cap) vs click_5a 终局对比
 * ③ event_5b 离线 +20% 的真实价值（3 次/天 vs 1 次/天）
 * ④ 三流派强度差距
 * ⑤ 描述/UI 与实装一致性（含面板花费标签）
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
  return { ...base, talents: { unlocked: [...ids], points: 0, rankGranted: 12, dailyGiftDate: "" } };
}
const NOW = Date.UTC(2026, 10, 27);

/** 参考终局状态（D5 画像：20000 点击 / 30 安然 / 5 同事满级） */
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

/** 真实引擎口径的"日收入"估值（离线 3 段 + 在线 30 分钟 + 点击） */
function dailyValue(s: GameState): number {
  const eff = offlineEfficiency(s, 0, NOW);
  const gaps = [4, 7, 13];
  const offline = gaps.reduce((sum, h) => sum + offlineEarn(s, h * 3600, eff).earned, 0);
  const online = effectOf(s).idleRate * 1800;
  const click = clickPowerOf(s) * 3 * 1800 * 1.2;
  // 派遣 ≈ 工位挂机 × 任务秒 × 0.011 × 倍率（≈ 每日 2% 小时量级）
  const dispatch = stationIdleScaled(s) * 120;
  return offline + online + click + dispatch;
}

describe("R12D-A 树结构 / 花费 / 描述一致性", () => {
  it("① 27 点树 + 分级花费", () => {
    console.log(`\n天赋数=${TALENTS.length}　点数上限=${TALENT_POINT_CAP}`);
    const costs = [1, 2, 3, 4, 5].map((t) => talentCostOf(t));
    console.log(`  talentCostOf(1..5)=[${costs.join(",")}]（期望 [1,1,2,2,3]）`);
    console.log(`  每流派满配 = t1(1)+t2(1)+t3(2)+t4(2)+终极(3) = 9；三流派 27 = 上限`);
    expect(costs).toEqual([1, 1, 2, 2, 3]);
    console.log(`  单流派遣生（4 线性+1 终极）= ${1 + 1 + 2 + 2 + 3} 点；三流派 = 27 = 上限`);
  });

  it("② 面板花费标签 vs 实装花费（疑似不一致）", () => {
    const panel = readFileSync("src/ui/team-panel.ts", "utf8");
    const stale = panel.includes('t.tier >= 5 ? 2 : 1');
    const staleCap = panel.includes("上限 18");
    const costs = TALENTS.map((t) => `${t.id}:${costOfTalent(t.id)}`);
    console.log(`\n面板标签逻辑 still "tier>=5 ? 2 : 1" = ${stale}　底部文案"上限 18" = ${staleCap}`);
    console.log(`  实装花费：${costs.join(" ")}`);
    console.log(`  → UI 会在 tier3/tier4（实装 2 点）显示"点亮"、终极（实装 3 点）显示"点亮 2"${stale ? " ❌ 不一致" : " ✅"}`);
    console.log(`  → 底部文案写"上限 18"，实装 27${staleCap ? " ❌ 不一致" : " ✅"}`);
  });

  it("③ click_5b 32% cap 与描述一致", () => {
    const ref = refState();
    for (const clicks of [0, 10000, 20000, 30000]) {
      const s = withTalent(["click_5a"], { ...ref, totalClicks: clicks });
      const b = withTalent(["click_5b"], { ...ref, totalClicks: clicks });
      console.log(
        `点击 ${String(clicks).padStart(5)}：5a conversion=${(conversionBonus(s) * 100).toFixed(1)}%　5b conversion=${(conversionBonus(b) * 100).toFixed(1)}%　5b 点击力×${(clickPowerOf(b) / clickPowerOf(withTalent(["click_1"], ref))).toFixed(2)}`,
      );
    }
    const desc = TALENTS.find((t) => t.id === "click_5b")!.desc;
    console.log(`  desc="${desc}"（应写 32% 且实装封顶 0.32）`);
    console.log(`  实装 cap：${(conversionBonus(withTalent(["click_5b"], { ...ref, totalClicks: 40000 })) * 100).toFixed(1)}%（期望 32%）`);
    expect(conversionBonus(withTalent(["click_5b"], { ...ref, totalClicks: 40000 }))).toBeCloseTo(0.32, 2);
  });

  it("④ event_5b 离线 +20%：对 3 次/天是否被 cap 吃掉", () => {
    const base = refState();
    const noB = withTalent(["event_1", "event_2", "event_3", "event_4"], base);
    const withB = withTalent(["event_1", "event_2", "event_3", "event_4", "event_5b"], base);
    const withBIdle4 = withTalent(["event_1", "event_2", "event_3", "event_4", "event_5b", "idle_4"], base);
    for (const visits of [1, 2, 3]) {
      const mk = (s: GameState) => ({ ...s, visits: { date: "2026-11-27", count: visits }, team: emptyTeam() });
      const e0 = offlineEfficiency(mk(noB), 0, NOW);
      const e1 = offlineEfficiency(mk(withB), 0, NOW);
      const e2 = offlineEfficiency(mk(withBIdle4), 0, NOW);
      console.log(
        `回访 ${visits} 次/天：无 5b=${e0.toFixed(2)} → 有 5b=${e1.toFixed(2)}（+${((e1 / e0 - 1) * 100).toFixed(1)}%）　再加 idle_4=${e2.toFixed(2)}（+${((e2 / e0 - 1) * 100).toFixed(1)}%）`,
      );
    }
    console.log("  → 3 次/天时 0.7+0.2+0.3=1.2 被 Math.min(1+talentBase) 截到 1.0：5b 的离线 +20% 完全无效 ❌");
  });

  it("⑤ 存档上限 27 + 互斥去重", () => {
    const ad = mem();
    const s = st({ talents: { unlocked: ["click_5a", "click_5b"], points: 27, rankGranted: 12, dailyGiftDate: "" } });
    serialize(s, ad, NOW);
    const r = restore(ad, NOW);
    console.log(`\n存档 points=27 → restore=${r.state.talents.points}；互斥双选存档 → unlocked=${JSON.stringify(r.state.talents.unlocked)}（应只留一个）`);
    expect(r.state.talents.points).toBe(27);
    expect(r.state.talents.unlocked.length).toBe(1);
  });

  it("⑥ 重置返还分级花费", () => {
    let s: GameState = st({ talents: { unlocked: [], points: TALENT_POINT_CAP, rankGranted: 12, dailyGiftDate: "" } });
    for (const id of ["click_1", "click_2", "click_3", "click_4", "click_5a"]) s = unlockTalent(s, id)!;
    const spent = TALENT_POINT_CAP - s.talents.points;
    const reset = resetTalents(s);
    console.log(`\n点亮 click 1-4+5a 花费 ${spent} 点（期望 1+1+2+2+3=9）；重置返还后 ${reset.talents.points}（期望 27）`);
    expect(spent).toBe(9);
    expect(reset.talents.points).toBe(27);
  });
});

const OPTIONS: Record<"click" | "idle" | "event", { cost: number; name: string; ids: string[] }[]> = {
  click: [
    { cost: 0, name: "-", ids: [] },
    { cost: 1, name: "t1", ids: ["click_1"] },
    { cost: 2, name: "t1-2", ids: ["click_1", "click_2"] },
    { cost: 4, name: "t1-3", ids: ["click_1", "click_2", "click_3"] },
    { cost: 6, name: "t1-4", ids: ["click_1", "click_2", "click_3", "click_4"] },
    { cost: 9, name: "t1-4+5a", ids: ["click_1", "click_2", "click_3", "click_4", "click_5a"] },
    { cost: 9, name: "t1-4+5b", ids: ["click_1", "click_2", "click_3", "click_4", "click_5b"] },
  ],
  idle: [
    { cost: 0, name: "-", ids: [] },
    { cost: 1, name: "t1", ids: ["idle_1"] },
    { cost: 2, name: "t1-2", ids: ["idle_1", "idle_2"] },
    { cost: 4, name: "t1-3", ids: ["idle_1", "idle_2", "idle_3"] },
    { cost: 6, name: "t1-4", ids: ["idle_1", "idle_2", "idle_3", "idle_4"] },
    { cost: 9, name: "t1-4+5a", ids: ["idle_1", "idle_2", "idle_3", "idle_4", "idle_5a"] },
    { cost: 9, name: "t1-4+5b", ids: ["idle_1", "idle_2", "idle_3", "idle_4", "idle_5b"] },
  ],
  event: [
    { cost: 0, name: "-", ids: [] },
    { cost: 1, name: "t1", ids: ["event_1"] },
    { cost: 2, name: "t1-2", ids: ["event_1", "event_2"] },
    { cost: 4, name: "t1-3", ids: ["event_1", "event_2", "event_3"] },
    { cost: 6, name: "t1-4", ids: ["event_1", "event_2", "event_3", "event_4"] },
    { cost: 9, name: "t1-4+5a", ids: ["event_1", "event_2", "event_3", "event_4", "event_5a"] },
    { cost: 9, name: "t1-4+5b", ids: ["event_1", "event_2", "event_3", "event_4", "event_5b"] },
  ],
};

describe("R12D-B 27 点树构筑枚举（真实日收入估值）", () => {
  it("预算 6/12/18/24/27：与最优差 <5% 的构筑数", () => {
    const ref = refState();
    const rows: { k: string; cost: number; v: number }[] = [];
    for (const c of OPTIONS.click)
      for (const i of OPTIONS.idle)
        for (const e of OPTIONS.event) {
          const ids = [...c.ids, ...i.ids, ...e.ids];
          const s = withTalent(ids, ref);
          rows.push({ k: `${c.name} | ${i.name} | ${e.name}`, cost: c.cost + i.cost + e.cost, v: dailyValue(s) });
        }
    for (const budget of [6, 12, 18, 24, 27]) {
      const at = rows.filter((r) => r.cost <= budget).sort((a, b) => b.v - a.v);
      const best = at[0]!;
      const within5 = at.filter((r) => r.v >= best.v * 0.95).length;
      const within10 = at.filter((r) => r.v >= best.v * 0.9).length;
      console.log(
        `\n预算${String(budget).padStart(2)}点：可行=${String(at.length).padStart(3)}　最优=${best.k}(${best.cost}点)　差<5%的=${within5}　差<10%的=${within10}`,
      );
      console.log(`  前3：${at.slice(0, 3).map((r) => `${r.k}(${r.cost}点)=${(r.v / 1e9).toFixed(1)}e9`).join("  ")}`);
    }
  });

  it("终局 8 终极组合（27 点满树）", () => {
    const ref = refState();
    const rows: { k: string; v: number }[] = [];
    for (const c of OPTIONS.click.slice(5))
      for (const i of OPTIONS.idle.slice(5))
        for (const e of OPTIONS.event.slice(5)) {
          const s = withTalent([...c.ids, ...i.ids, ...e.ids], ref);
          rows.push({ k: `${c.name}/${i.name}/${e.name}`, v: dailyValue(s) });
        }
    const best = Math.max(...rows.map((r) => r.v));
    for (const r of rows.sort((a, b) => b.v - a.v))
      console.log(`  ${r.k.padEnd(36)} 日收入=${(r.v / 1e9).toFixed(2)}e9（${((r.v / best - 1) * 100).toFixed(1)}%）`);
  });

  it("三流派各 9 点的边际强度（差距是否 <15%）", () => {
    const ref = refState();
    const none = dailyValue(withTalent([], ref));
    const base = (name: string, ids: string[]) => {
      const v = dailyValue(withTalent(ids, ref));
      console.log(`  ${name.padEnd(26)} 相对无天赋 +${((v / none - 1) * 100).toFixed(1)}%`);
      return v / none - 1;
    };
    console.log("\n3 次/天画像，单流派投满 9 点：");
    const res = [
      base("点击 5a", OPTIONS.click[5]!.ids),
      base("点击 5b", OPTIONS.click[6]!.ids),
      base("挂机 5a", OPTIONS.idle[5]!.ids),
      base("挂机 5b", OPTIONS.idle[6]!.ids),
      base("事件 5a", OPTIONS.event[5]!.ids),
      base("事件 5b", OPTIONS.event[6]!.ids),
    ];
    const spread = (Math.max(...res) - Math.min(...res)) * 100;
    console.log(`  最强-最弱差=${spread.toFixed(1)}pp（<15pp 为达标）`);
  });
});

describe("R12D-C 27 点节奏（含每日签到点）", () => {
  const RANK_NAMES = TALENT_RANK_TIERS.map((i) => RANKS[i]!.name);
  const simBase = (over: Partial<SimOpts>): SimOpts => ({
    days: 30, visitHours: [9, 13, 20], sessionSeconds: 600, cps: 0,
    recruit: true, dispatch: true, levelColleagues: true, team: DRAFT_TEAM,
    talent: NO_TALENT, prestige: true, dailyClaim: true, events: true, ...over,
  });
  const pointsAt = (r: ReturnType<typeof simulate>, tMin: number): number => {
    let p = 0;
    for (const n of RANK_NAMES) {
      const at = r.rankTimes[n];
      if (at !== undefined && at <= tMin) p += 1;
    }
    for (const [k, v] of Object.entries(r.rankTimes)) if (k.startsWith("prestige_") && v <= tMin) p += 1;
    p += Math.floor(tMin / 1440) + 1; // 每日签到点
    return Math.min(p, TALENT_POINT_CAP);
  };
  it("3 次/天 & 1 次/天：满 27 点时间 / 30 天溢出", () => {
    for (const cfg of [
      { name: "3次/天 cps=3", o: null },
      { name: "1次/天 cps=0", o: { visitHours: [21] } as Partial<SimOpts> },
    ]) {
      const r = simulate(cfg.o ? simBase({ ...cfg.o }) : simBase({ cps: 3 }));
      let full = Infinity;
      for (let mm = 0; mm <= 30 * 1440; mm += 60) if (pointsAt(r, mm) >= TALENT_POINT_CAP) { full = mm; break; }
      const total = r.prestiges + 6 + 30; // 转生 + 段位 + 每日
      console.log(`\n${cfg.name}：27 点满树 ≈ ${full === Infinity ? "未到" : (full / 1440).toFixed(1) + " 天"}　30 天总点数≈${total} → 溢出 ${total - TALENT_POINT_CAP}`);
    }
  });
});
