/**
 * R12 构筑党探针 B：三流派真实口径收益 + 天赋点获取节奏。
 * 复用 probe-b1-lib 的会话模拟器（引擎纯函数 + 同事表），只读 src/。
 */
import { describe, it } from "vitest";
import { DRAFT_TEAM, NO_TALENT, TAL_CLICK, TAL_IDLE, TAL_EVENT, simulate, type SimOpts, type TalentCfg } from "./probe-b1-lib";
import { RANKS, rankFor } from "../src/engine/titles";
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

/** 实装口径（严格按 src/engine/talents.ts 接线后的真实效果）：click 流没有暴击/连击上限 */
const REAL_CLICK: TalentCfg = { ...NO_TALENT, clickMult: 1.25, clickToIdlePer1k: 1 / 30, clickToIdleCap: 0.35 };
const REAL_IDLE: TalentCfg = { ...NO_TALENT, idleMult: 1.15, offlineCapBonus: 2 * 3600, offlineBaseBonus: 0.05 };
const REAL_EVENT: TalentCfg = { ...NO_TALENT, patrolRewardMult: 1.2, memeRewardMult: 1.1, patrolIdlePerPatrol: 0.01, patrolIdleCap: 0.3 };
/** 15 点满树（实装口径） */
const REAL_ALL: TalentCfg = {
  ...NO_TALENT,
  clickMult: 1.25,
  clickToIdlePer1k: 1 / 30,
  clickToIdleCap: 0.35,
  idleMult: 1.15,
  offlineCapBonus: 7200,
  offlineBaseBonus: 0.05,
  patrolRewardMult: 1.2,
  memeRewardMult: 1.1,
  patrolIdlePerPatrol: 0.01,
  patrolIdleCap: 0.3,
};

describe("R12-B1 三流派实测收益（实装口径 vs 设计口径）", () => {
  it("7/30 天 × 0/1/3cps：单流派满级与满树对比", () => {
    for (const days of [7, 30]) {
      for (const cps of [0, 1, 3]) {
        const none = simulate(base({ days, cps }));
        const cl = simulate(base({ days, cps, talent: REAL_CLICK }));
        const id = simulate(base({ days, cps, talent: REAL_IDLE }));
        const ev = simulate(base({ days, cps, talent: REAL_EVENT }));
        const all = simulate(base({ days, cps, talent: REAL_ALL }));
        console.log(
          `\n[${days}天 cps=${cps}] 无天赋=${(none.totals.total / 1e8).toFixed(0)}e8　点击流(5点) ${pct(cl.totals.total / none.totals.total - 1)}｜挂机流 ${pct(id.totals.total / none.totals.total - 1)}｜事件流 ${pct(ev.totals.total / none.totals.total - 1)}｜满树(15点) ${pct(all.totals.total / none.totals.total - 1)}`,
        );
        if (days === 30 && cps === 3) {
          const t = none.totals;
          console.log(
            `  30天 3cps 基线收入结构：点击 ${pct(t.click / t.total)}｜挂机(含离线) ${pct(t.idleBase / t.total)}｜事件 ${pct(t.event / t.total)}｜派遣 ${pct(t.dispatch / t.total)}｜日报 ${pct(t.daily / t.total)}`,
          );
        }
        if (days === 7 && cps === 3) {
          const t = none.totals;
          console.log(
            `  7天 3cps 基线收入结构：点击 ${pct(t.click / t.total)}｜挂机(含离线) ${pct(t.idleBase / t.total)}｜事件 ${pct(t.event / t.total)}｜派遣 ${pct(t.dispatch / t.total)}｜日报 ${pct(t.daily / t.total)}`,
          );
        }
        if (days === 7 && cps === 0) {
          const t = none.totals;
          console.log(
            `  7天 0cps 基线收入结构：点击 ${pct(t.click / t.total)}｜挂机(含离线) ${pct(t.idleBase / t.total)}｜事件 ${pct(t.event / t.total)}｜派遣 ${pct(t.dispatch / t.total)}｜日报 ${pct(t.daily / t.total)}`,
          );
        }
        if (days === 30 && cps === 0) {
          const t = none.totals;
          console.log(
            `  30天 0cps 基线收入结构：点击 ${pct(t.click / t.total)}｜挂机(含离线) ${pct(t.idleBase / t.total)}｜事件 ${pct(t.event / t.total)}｜派遣 ${pct(t.dispatch / t.total)}｜日报 ${pct(t.daily / t.total)}`,
          );
        }
      }
    }
  });

  it("设计口径（探针库原设计，含暴击/连击上限/罚款减免）vs 实装口径", () => {
    for (const days of [7, 30]) {
      const none = simulate(base({ days, cps: 3 }));
      const libClick = simulate(base({ days, cps: 3, talent: TAL_CLICK }));
      const realClick = simulate(base({ days, cps: 3, talent: REAL_CLICK }));
      const idle = simulate(base({ days, cps: 0 }));
      const libIdle = simulate(base({ days, cps: 0, talent: TAL_IDLE }));
      const realIdle = simulate(base({ days, cps: 0, talent: REAL_IDLE }));
      const libEv = simulate(base({ days, cps: 0, talent: TAL_EVENT }));
      const realEv = simulate(base({ days, cps: 0, talent: REAL_EVENT }));
      console.log(
        `\n[${days}天] 点击流 3cps：设计 ${pct(libClick.totals.total / none.totals.total - 1)} → 实装 ${pct(realClick.totals.total / none.totals.total - 1)}`,
      );
      console.log(
        `[${days}天] 挂机流 0cps：设计 ${pct(libIdle.totals.total / idle.totals.total - 1)} → 实装 ${pct(realIdle.totals.total / idle.totals.total - 1)}`,
      );
      console.log(
        `[${days}天] 事件流 0cps：设计 ${pct(libEv.totals.total / idle.totals.total - 1)} → 实装 ${pct(realEv.totals.total / idle.totals.total - 1)}`,
      );
    }
  });

  it("点击流在'重度在线点击'画像下的上限（cps=5，每天 2h）", () => {
    const heavy: SimOpts = base({ days: 7, cps: 5, visitHours: [20], sessionSeconds: 7200 });
    const none = simulate(heavy);
    const cl = simulate({ ...heavy, talent: REAL_CLICK });
    const all = simulate({ ...heavy, talent: REAL_ALL });
    console.log(
      `\n重度点击(7天 5cps 每天2h)：点击收入占比 ${pct(none.totals.click / none.totals.total)}　点击流 ${pct(cl.totals.total / none.totals.total - 1)}　满树 ${pct(all.totals.total / none.totals.total - 1)}`,
    );
  });
});

describe("R12-B2 天赋点获取节奏（段位点 + 转生点）", () => {
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
  const hoursOf = (min: number) => (min / 60).toFixed(1) + "h";

  it("7 天窗口：首点 / 5 点 / 15 点的到达时刻", () => {
    for (const cps of [0, 1, 3]) {
      const r = simulate(base({ days: 7, cps, prestige: true }));
      const marks = [1, 2, 3, 5, 8, 10, 15];
      const out: string[] = [];
      for (const m of marks) {
        let t = Infinity;
        // 以 10 分钟为步长扫
        for (let mm = 0; mm <= 7 * 1440; mm += 5) {
          if (pointsAt(r, mm) >= m) {
            t = mm;
            break;
          }
        }
        out.push(`${m}点=${t === Infinity ? "7天内未到" : hoursOf(t)}`);
      }
      console.log(`\n3次回访/天 cps=${cps}（7天共转生 ${r.prestiges} 次 + 段位点）：${out.join("　")}`);
      const rk = TALENT_RANK_NAMES.map((n) => `${n}=${r.rankTimes[n] === undefined ? "未到" : hoursOf(r.rankTimes[n])}`);
      console.log(`  段位天赋点时刻：${rk.join(" ")}`);
    }
  });

  it("30 天窗口：点数是否被 15 点上限锁死（多转生是否浪费）", () => {
    for (const cps of [0, 3]) {
      const r = simulate(base({ days: 30, cps, prestige: true }));
      const rankPts = TALENT_RANK_NAMES.length;
      const totalPts = r.prestiges + rankPts;
      console.log(
        `\n30天 cps=${cps}：转生 ${r.prestiges} 次 + 段位 ${rankPts} 点 = ${totalPts} 点，上限 ${TALENT_POINT_CAP} → 溢出 ${Math.max(0, totalPts - TALENT_POINT_CAP)} 点（${totalPts > TALENT_POINT_CAP ? "后期转生不再给天赋点" : "未溢出"}）`,
      );
      let first15 = Infinity;
      for (let mm = 0; mm <= 30 * 1440; mm += 5) {
        if (pointsAt(r, mm) >= TALENT_POINT_CAP) {
          first15 = mm;
          break;
        }
      }
      console.log(`  15 点满树时刻 ≈ ${first15 === Infinity ? "30天内未满" : hoursOf(first15)}；30 天终局点数(有效)=${Math.min(TALENT_POINT_CAP, totalPts)}`);
    }
  });

  it("纯离线党（每天 1 次回访，10 分钟）：首点 / 满一条", () => {
    const o = base({ days: 14, cps: 0, visitHours: [21], sessionSeconds: 600, prestige: true });
    const r = simulate(o);
    const marks = [1, 2, 3, 5, 8, 15];
    const out: string[] = [];
    for (const m of marks) {
      let t = Infinity;
      for (let mm = 0; mm <= 14 * 1440; mm += 5)
        if (pointsAt(r, mm) >= m) {
          t = mm;
          break;
        }
      out.push(`${m}点=${t === Infinity ? "14天内未到" : (t / 1440).toFixed(1) + "天"}`);
    }
    console.log(`\n纯离线党(1次/天)：${out.join("　")}　14天转生 ${r.prestiges} 次 段位=${rankFor(r.final.lifetime).current}`);
  });
});
