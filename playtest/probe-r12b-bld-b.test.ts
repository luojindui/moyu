/**
 * R12 复验 B：18 天赋树的三流派强度、8 种终局取舍价值、点数节奏（只读 src/）。
 */
import { describe, it } from "vitest";
import { DRAFT_TEAM, NO_TALENT, simulate, type SimOpts, type TalentCfg } from "./probe-b1-lib";
import { RANKS } from "../src/engine/titles";
import { TALENT_RANK_TIERS, TALENT_POINT_CAP } from "../src/engine/talents";

const pct = (x: number) => (x * 100).toFixed(1) + "%";
const base = (over: Partial<SimOpts>): SimOpts => ({
  days: 7,
  visitHours: [9, 13, 20],
  sessionSeconds: 600,
  cps: 0,
  recruit: true,
  dispatch: true,
  levelColleagues: true,
  team: DRAFT_TEAM,
  talent: NO_TALENT,
  prestige: false,
  dailyClaim: true,
  events: true,
  ...over,
});

// 实装口径（按当前 src 真实效果；未接线的效果一律不计）
const C_CLICK_5A: TalentCfg = { ...NO_TALENT, clickMult: 1.25, comboMaxBonus: 10, clickToIdlePer1k: 1 / 30, clickToIdleCap: 0.35 };
const C_CLICK_5B: TalentCfg = { ...NO_TALENT, clickMult: 1.25 * 1.6, comboMaxBonus: 10 }; // 连击每层翻倍未实装
const C_IDLE_5A: TalentCfg = { ...NO_TALENT, idleMult: 1.2, offlineCapBonus: 7200, offlineBaseBonus: 0.08 };
const C_IDLE_5B: TalentCfg = { ...NO_TALENT, idleMult: 1.12, offlineCapBonus: 7200, offlineBaseBonus: 0.08 }; // 同事+40% 未接线
const C_EVENT_5A: TalentCfg = {
  ...NO_TALENT,
  patrolRewardMult: 1.2,
  memeRewardMult: 1.15,
  patrolIdlePerPatrol: 0.01,
  patrolIdleCap: 0.3,
};
const C_EVENT_5B: TalentCfg = { ...NO_TALENT, patrolRewardMult: 1.2 * 2, memeRewardMult: 1.15 * 2 };
const merge = (...cs: TalentCfg[]): TalentCfg => {
  const out: TalentCfg = { ...NO_TALENT };
  for (const c of cs) {
    out.idleMult *= c.idleMult;
    out.clickMult *= c.clickMult;
    out.patrolRewardMult *= c.patrolRewardMult;
    out.memeRewardMult *= c.memeRewardMult;
    out.offlineCapBonus = Math.max(out.offlineCapBonus, c.offlineCapBonus);
    out.offlineBaseBonus = Math.max(out.offlineBaseBonus, c.offlineBaseBonus);
    out.comboMaxBonus = Math.max(out.comboMaxBonus, c.comboMaxBonus);
    out.patrolIdlePerPatrol = Math.max(out.patrolIdlePerPatrol, c.patrolIdlePerPatrol);
    out.patrolIdleCap = Math.max(out.patrolIdleCap, c.patrolIdleCap);
    out.clickToIdlePer1k = Math.max(out.clickToIdlePer1k, c.clickToIdlePer1k);
    out.clickToIdleCap = Math.max(out.clickToIdleCap, c.clickToIdleCap);
  }
  return out;
};

describe("R12B-B1 三流派强度（各 6 点，实装口径）", () => {
  it("流派满级 vs 无天赋（7/30 天 × 0/3cps）", () => {
    for (const days of [7, 30]) {
      for (const cps of [0, 3]) {
        const none = simulate(base({ days, cps }));
        const row = (label: string, tal: TalentCfg) => {
          const r = simulate(base({ days, cps, talent: tal }));
          return `${label} ${pct(r.totals.total / none.totals.total - 1)}`;
        };
        console.log(
          `\n[${days}天 cps=${cps}] ${row("点击流5a", C_CLICK_5A)}｜${row("点击流5b", C_CLICK_5B)}｜${row("挂机流5a", C_IDLE_5A)}｜${row("挂机流5b", C_IDLE_5B)}｜${row("事件流5a", C_EVENT_5A)}｜${row("事件流5b", C_EVENT_5B)}`,
        );
      }
    }
  });

  it("终局 8 种终极组合（18 点满树，实装口径）", () => {
    const none = simulate(base({ days: 30, cps: 3 }));
    const C = { a: C_CLICK_5A, b: C_CLICK_5B };
    const I = { a: C_IDLE_5A, b: C_IDLE_5B };
    const E = { a: C_EVENT_5A, b: C_EVENT_5B };
    const rows: { k: string; v: number }[] = [];
    for (const c of ["a", "b"] as const)
      for (const i of ["a", "b"] as const)
        for (const e of ["a", "b"] as const) {
          const r = simulate(base({ days: 30, cps: 3, talent: merge(C[c], I[i], E[e]) }));
          rows.push({ k: `点击${c} / 挂机${i} / 事件${e}`, v: r.totals.total / none.totals.total - 1 });
        }
    rows.sort((x, y) => y.v - x.v);
    console.log("\n30 天 3cps 终局 8 组合（相对无天赋）：");
    for (const r of rows) console.log(`  ${r.k} = ${pct(r.v)}`);
    const best = rows[0]!.v;
    console.log(`  与最优差 <1% 的组合数=${rows.filter((r) => r.v >= best * 0.99).length}（若=1 说明终极"没得选"）`);
  });

  it("早期收入结构：点击占比是否撑得起 click_5b", () => {
    for (const days of [1, 3, 7, 30]) {
      const r = simulate(base({ days, cps: 3 }));
      const t = r.totals;
      console.log(
        `\n${days} 天 3cps：点击占比 ${pct(t.click / t.total)}｜事件占比 ${pct(t.event / t.total)}｜挂机+派遣+日报 ${pct((t.idleBase + t.dispatch + t.daily) / t.total)}`,
      );
    }
  });
});

describe("R12B-B2 构建枚举（18 点上限下的真实取舍）", () => {
  // 权重：来自 30 天收入结构（点击 0.4% / 站桩+派遣 82.9% / 同事 17% / 事件 0.1% / 日报 0.6%）
  const W = { click: 0.004, station: 0.829, team: 0.161, event: 0.001, daily: 0.005 };
  type Opt = { cost: number; name: string; click?: number; station?: number; team?: number; event?: number };
  const OPTS: Record<string, Opt[]> = {
    click: [
      { cost: 0, name: "-" },
      { cost: 1, name: "click_1", click: 1.25 },
      { cost: 2, name: "click_1/2", click: 1.25 },
      { cost: 3, name: "click_1/2/3", click: 1.25 * 1.0968 },
      { cost: 4, name: "click_1/2/3/4", click: 1.25 * 1.0968 }, // 暴击未接线
      { cost: 6, name: "click_1-4+5a", click: 1.25 * 1.0968, station: 1.35 },
      { cost: 6, name: "click_1-4+5b", click: 1.25 * 1.0968 * 1.6 },
    ],
    idle: [
      { cost: 0, name: "-" },
      { cost: 1, name: "idle_1", station: 1.06 },
      { cost: 2, name: "idle_1/2", station: 1.06 },
      { cost: 3, name: "idle_1/2/3", station: 1.12 },
      { cost: 4, name: "idle_1/2/3/4", station: 1.12 },
      { cost: 6, name: "idle_1-4+5a", station: 1.2 },
      { cost: 6, name: "idle_1-4+5b", station: 1.12 }, // 同事+40% 未接线
    ],
    event: [
      { cost: 0, name: "-" },
      { cost: 1, name: "event_1", event: 1.15 },
      { cost: 2, name: "event_1/2", event: 1.15 },
      { cost: 3, name: "event_1/2/3", event: 1.15 * 1.15 },
      { cost: 4, name: "event_1-4", event: 1.2 * 1.15 },
      { cost: 6, name: "event_1-4+5a", station: 1.3, event: 1.2 * 1.15 },
      { cost: 6, name: "event_1-4+5b", event: 1.2 * 1.15 * 2 },
    ],
  };
  const val = (opts: Opt[]): number => {
    let v = 0;
    let click = 1,
      station = 1,
      team = 1,
      event = 1;
    for (const o of opts) {
      click *= o.click ?? 1;
      station *= o.station ?? 1;
      team *= o.team ?? 1;
      event *= o.event ?? 1;
    }
    v += W.click * click + W.station * station + W.daily * station + W.team * (0.55 * station + 0.45 * team) + W.event * event;
    return v;
  };
  it("各预算下有多少跟最优差<2%的构筑", () => {
    for (const budget of [3, 6, 9, 12, 15, 18]) {
      const rows: { k: string; v: number; cost: number }[] = [];
      for (const a of OPTS.click!)
        for (const b of OPTS.idle!)
          for (const c of OPTS.event!) {
            const cost = a.cost + b.cost + c.cost;
            if (cost > budget) continue;
            rows.push({ k: `${a.name} | ${b.name} | ${c.name}`, v: val([a, b, c]), cost });
          }
      rows.sort((x, y) => y.v - x.v);
      const best = rows[0]!;
      const within2 = rows.filter((x) => x.v >= best.v * 0.98).length;
      console.log(
        `\n预算${String(budget).padStart(2)}点：可行分配=${String(rows.length).padStart(3)}　最优=${best.k}(${best.v.toFixed(4)})　差<2%的=${within2}`,
      );
      if (budget === 18) {
        console.log(`  18 点前 4 名：${rows.slice(0, 4).map((x) => `${x.k}=${x.v.toFixed(4)}`).join("  ")}`);
      }
    }
  });
});

describe("R12B-B3 点数节奏（上限 18，仍靠转生 + 段位）", () => {
  const TALENT_RANK_NAMES = TALENT_RANK_TIERS.map((i) => RANKS[i]!.name);
  const pointsAt = (r: ReturnType<typeof simulate>, tMin: number): number => {
    let p = 0;
    for (const n of TALENT_RANK_NAMES) {
      const at = r.rankTimes[n];
      if (at !== undefined && at <= tMin) p += 1;
    }
    for (const [k, v] of Object.entries(r.rankTimes)) if (k.startsWith("prestige_") && v <= tMin) p += 1;
    return p;
  };
  it("3 次回访/天：到 1/6/12/18 点", () => {
    for (const cps of [0, 3]) {
      const r = simulate(base({ days: 30, cps, prestige: true }));
      const out: string[] = [];
      for (const m of [1, 6, 12, 18]) {
        let t = Infinity;
        for (let mm = 0; mm <= 30 * 1440; mm += 5)
          if (pointsAt(r, mm) >= m) {
            t = mm;
            break;
          }
        out.push(`${m}点=${t === Infinity ? "未到" : (t / 24 / 60).toFixed(1) + "天"}`);
      }
      console.log(`\ncps=${cps}（30 天转生 ${r.prestiges} 次 + 段位 6 点）：${out.join("　")}`);
      const total = r.prestiges + 6;
      console.log(`  总点数 ${total} vs 上限 ${TALENT_POINT_CAP} → 仍溢出 ${Math.max(0, total - TALENT_POINT_CAP)} 点`);
    }
  });
  it("纯离线党（1 次/天）", () => {
    const r = simulate(base({ days: 30, cps: 0, visitHours: [21], sessionSeconds: 600, prestige: true }));
    const out: string[] = [];
    for (const m of [1, 6, 12, 18]) {
      let t = Infinity;
      for (let mm = 0; mm <= 30 * 1440; mm += 5)
        if (pointsAt(r, mm) >= m) {
          t = mm;
          break;
        }
      out.push(`${m}点=${t === Infinity ? "未到" : (t / 1440).toFixed(1) + "天"}`);
    }
    console.log(`\n纯离线党(1次/天)：${out.join("　")}　30 天转生 ${r.prestiges} 次`);
  });
});
