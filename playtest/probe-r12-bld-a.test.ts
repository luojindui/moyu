/**
 * R12 构筑党探针 A：真实引擎下的天赋树审计（接线情况 / 每点实际收益 / 构筑枚举）。
 * 只读 src/，不改 src/。
 */
import { describe, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { initialState, type GameState } from "../src/engine/state";
import { clickPowerOf, doClick, comboMultiplier } from "../src/engine/actions";
import { effectOf, stationIdleScaled, conversionBonus } from "../src/engine/upgrades";
import {
  TALENTS,
  TALENT_POINT_CAP,
  canUnlock,
  unlockTalent,
  resetTalents,
  grantRankTalents,
  grantPrestigeTalentPoints,
} from "../src/engine/talents";
import { newEventState, onBossTap, bossSurviveReward, onMemeTap } from "../src/engine/events";
import { offlineEarn, capForElapsed } from "../src/engine/offline";
import { offlineEfficiency } from "../src/engine/progression";

function withTalent(ids: string[], base: GameState = initialState(), points = 15): GameState {
  return { ...base, talents: { unlocked: [...ids], points, rankGranted: -1 } };
}
function st(over: Partial<GameState>): GameState {
  return { ...initialState(), ...over };
}

describe("R12-A1 接线审计（哪些天赋真的在跑）", () => {
  it("静态：每个天赋效果字段的实际消费点", () => {
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        if (f.isDirectory()) walk(`${d}/${f.name}`);
        else if (f.name.endsWith(".ts")) files.push(`${d}/${f.name}`);
      }
    };
    walk("src");
    const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
    const tokens = [
      "critEvery",
      "comboWindowBonus",
      "comboMaxBonus",
      "patrolWarnSeconds",
      "penaltyReduction",
      "clickToIdleStep",
      "surviveToIdle",
      "offlineCapBonusHours",
      "offlineBaseBonus",
      "patrolRewardMult",
      "memeRewardMult",
      "idleMult",
    ];
    console.log("");
    for (const tk of tokens) {
      const hits = [...sources.entries()]
        .filter(([f]) => !f.endsWith("talents.ts") && !f.endsWith(".test.ts"))
        .filter(([, src]) => new RegExp(`\\b${tk}\\b`).test(src))
        .map(([f]) => f.replace("src/", ""));
      console.log(`  ${tk.padEnd(22)} → ${hits.length ? hits.join(", ") : "❌ 全项目无人消费"}`);
    }
    const main = sources.get("src/main.ts")!;
    const actions = sources.get("src/engine/actions.ts")!;
    console.log(
      `  main.ts 连击：硬编码 COMBO_WINDOW_S=${main.includes("COMBO_WINDOW_S")} COMBO_MAX=${main.includes("COMBO_MAX")}；暴击分支=${/crit/i.test(main)}`,
    );
    console.log(
      `  actions.ts 连击：comboMultiplier 固定 0.012/连，封顶 COMBO_MAX=20（${/COMBO_MAX/.test(actions)}），无天赋入口`,
    );
  });

  it("点击流：只有 click_1 生效；click_2/3/4 点了等于没点", () => {
    const base = st({ levels: { coffee: 10, phone: 40 } });
    const with1 = withTalent(["click_1"], base);
    console.log(
      `\n点击力：无天赋=${clickPowerOf(base).toFixed(2)} 点手速=${clickPowerOf(with1).toFixed(2)}（×${(clickPowerOf(with1) / clickPowerOf(base)).toFixed(3)}）✔ 生效`,
    );
    console.log(
      `连击倍率：20连=${comboMultiplier(20).toFixed(3)}　30连=${comboMultiplier(30).toFixed(3)} → 连击上限+10 后仍封顶 ×${comboMultiplier(30).toFixed(3)}（无变化）`,
    );
    const dead = withTalent(["click_1", "click_2", "click_3", "click_4"], base);
    const a = doClick(base, 20),
      b = doClick(dead, 20);
    console.log(
      `单次点击（20连）：无天赋 +${(a.lifetimeEarned - base.lifetimeEarned).toFixed(2)}　点满点击流 +${(b.lifetimeEarned - dead.lifetimeEarned).toFixed(2)}`,
    );
    let s = base;
    const l0 = s.lifetimeEarned;
    for (let i = 0; i < 1000; i++) s = doClick(s, 20);
    const g0 = s.lifetimeEarned - l0;
    let t = dead;
    const l1 = t.lifetimeEarned;
    for (let i = 0; i < 1000; i++) t = doClick(t, 20);
    const g1 = t.lifetimeEarned - l1;
    console.log(
      `1000 次点击总收益：无天赋=${g0.toFixed(0)}　点满点击流(含暴击)=${g1.toFixed(0)}　比值=${(g1 / g0).toFixed(4)}（设计期望 ×1.24 手速×1.2 暴击≈1.5）`,
    );
  });

  it("事件流：event_1/3 生效；event_2 罚款减免无消费点；event_4 只剩奖励半条", () => {
    const s = st({ levels: { phone: 40 }, surviveStreak: 4 });
    const no = bossSurviveReward(s);
    const e1 = bossSurviveReward(withTalent(["event_1"], s));
    const e14 = bossSurviveReward(withTalent(["event_1", "event_4"], s));
    console.log(
      `\n安然奖励：无=${no.toFixed(0)}　event_1=${e1.toFixed(0)}(×${(e1 / no).toFixed(2)})　event_1+4=${e14.toFixed(0)}(×${(e14 / no).toFixed(2)}) ✔`,
    );
    const m0 = newEventState();
    m0.memeUntil = 99;
    const m1 = newEventState();
    m1.memeUntil = 99;
    const memeNo = onMemeTap(s, m0).earned;
    const meme1 = onMemeTap(withTalent(["event_3"], s), m1).earned;
    console.log(`丢梗奖励：无=${memeNo.toFixed(0)}　event_3=${meme1.toFixed(0)}(×${(meme1 / memeNo).toFixed(2)}) ✔`);

    const mk = (ids: string[]): { lost: number; perTap: number } => {
      const state = withTalent(ids, st({ levels: { phone: 40 }, moyu: 1e7 }));
      const e = newEventState();
      e.bossUntil = 100;
      e.bossStartAt = 0;
      e.patrolCount = 9;
      const r = onBossTap(state, e, 5, 0);
      const idle = effectOf({ ...state, surviveStreak: 0 }).idleRate;
      return { lost: r.lost, perTap: Math.max(10, 0.6 * idle) };
    };
    const p0 = mk([]);
    const p1 = mk(["event_2"]);
    console.log(
      `偷点罚款：无 event_2 实扣=${p0.lost.toFixed(1)}（公式 0.6×idle=${p0.perTap.toFixed(1)}）　有 event_2 实扣=${p1.lost.toFixed(1)}　若接线应为 ×0.65=${(p0.lost * 0.65).toFixed(1)} → ❌ 减免未接线（${p1.lost === p0.lost}）`,
    );
    console.log(`巡逻预警：event_4 的 patrolWarnSeconds 无任何消费点（场景横幅仍按原时刻弹出）→ ❌ 预告半条死`);
  });

  it("Lv5 转化：click_5 / event_5 生效，但需要多少活跃操作", () => {
    const base = st({ levels: { phone: 40 } });
    const rows: string[] = [];
    for (const clicks of [0, 3000, 10500, 20000]) {
      rows.push(`点击${clicks}→+${(conversionBonus(withTalent(["click_5"], { ...base, totalClicks: clicks })) * 100).toFixed(0)}%`);
    }
    console.log(`\nclick_5：${rows.join("　")}（封顶 35%，需 10,500 累计点击）`);
    const rows2: string[] = [];
    for (const n of [0, 10, 30, 50]) {
      rows2.push(`安然${n}→+${(conversionBonus(withTalent(["event_5"], { ...base, patrolSurvives: n })) * 100).toFixed(0)}%`);
    }
    console.log(`event_5：${rows2.join("　")}（封顶 30%，需 30 次安然）`);
    const s5 = withTalent(["click_5"], { ...base, totalClicks: 10500 });
    const idleFull = withTalent(["idle_1", "idle_2", "idle_3", "idle_4", "idle_5"], base);
    const both = withTalent(["click_5", "event_5", "idle_1", "idle_3", "idle_5"], {
      ...base,
      totalClicks: 10500,
      patrolSurvives: 30,
    });
    console.log(
      `工位挂机/秒：无天赋=${stationIdleScaled(base).toFixed(1)}｜click_5(1点)=${stationIdleScaled(s5).toFixed(1)}｜挂机流5点=${stationIdleScaled(idleFull).toFixed(1)}｜click5+event5+挂机3点=15点满配=${stationIdleScaled(both).toFixed(1)}`,
    );
  });

  it("挂机流：idle_4（离线效率+0.05）在 3 次回访/天时被上限吃掉", () => {
    const base = st({ levels: { phone: 60 } });
    const now = 20 * 86400_000;
    for (const visits of [1, 2, 3]) {
      const s0 = { ...base, visits: { date: "2026-11-27", count: visits } };
      const s4 = withTalent(["idle_4"], s0);
      const e0 = offlineEfficiency(s0, 0, now);
      const e4 = offlineEfficiency(s4, 0, now);
      console.log(
        `回访 ${visits} 次/天：无天赋 eff=${e0.toFixed(3)} → idle_4 eff=${e4.toFixed(3)}（离线收入 +${((e4 / e0 - 1) * 100).toFixed(1)}%）`,
      );
    }
    console.log("  ↑ 每天 3 次回访即 0.7+0.3=1.0 封顶：idle_4 对目标画像玩家收益为 0");
  });

  it("挂机流：idle_2/idle_4 只在离线兑现，回访频率决定价值", () => {
    const base = st({ levels: { phone: 60 } });
    const idle2 = withTalent(["idle_2"], base);
    const idle4 = withTalent(["idle_4"], base);
    const now = 20 * 86400_000;
    const eff0 = offlineEfficiency(base, 0, now);
    const eff4 = offlineEfficiency(idle4, 0, now);
    console.log(
      `\n离线效率（首日后）：无天赋=${eff0.toFixed(2)}　idle_4=${eff4.toFixed(2)}（离线收入 +${((eff4 / eff0 - 1) * 100).toFixed(1)}%）`,
    );
    for (const gapH of [4, 7, 13, 24]) {
      const gap = gapH * 3600;
      const e0 = offlineEarn(base, gap, 0.7).earned;
      const e2 = offlineEarn(idle2, gap, 0.7).earned;
      console.log(
        `离线 ${String(gapH).padStart(2)}h：封顶 ${(capForElapsed(gap) / 3600).toFixed(0)}h → 加 idle_2 后 ${((e2 / e0 - 1) * 100).toFixed(1)}%（3 次/天的最长间隔 13h 只吃到一半效果）`,
      );
    }
  });
});

describe("R12-A2 构筑枚举（点数上限下的真实可选空间）", () => {
  const ref: GameState = st({
    levels: { coffee: 20, water: 20, chair: 20, phone: 60, toilet: 50, group: 50, meeting: 40, deep: 30, retire: 20 },
    totalClicks: 10500,
    patrolSurvives: 30,
  });
  const stationBase = stationIdleScaled(ref);
  const clickBase = clickPowerOf(ref);
  const offlineBase = offlineEarn(ref, 24 * 3600, 0.7).earned;

  // 事件奖励基数 ≈ 4×idleRate：再乘 stationMul
  function evalBuild2(a: number, b: number, c: number, W: { click: number; onlineIdle: number; offline: number; event: number }): number {
    const ids = [
      ...Array.from({ length: a }, (_, i) => `click_${i + 1}`),
      ...Array.from({ length: b }, (_, i) => `idle_${i + 1}`),
      ...Array.from({ length: c }, (_, i) => `event_${i + 1}`),
    ];
    const s = withTalent(ids, ref);
    const clickMul = ids.includes("click_1") ? 1.25 : 1;
    const stationMul = stationIdleScaled(s) / stationBase;
    const offlineMul = offlineEarn(s, 24 * 3600, 0.7).earned / offlineBase;
    const eventMul = (ids.includes("event_4") ? 1.2 : ids.includes("event_1") ? 1.15 : 1) * (ids.includes("event_3") ? 1.05 : 1);
    return W.click * clickMul + W.onlineIdle * stationMul + W.offline * offlineMul + W.event * eventMul * stationMul;
  }

  const PROFILES = {
    "点击/在线党（点击35% 在线挂机25% 离线38% 事件2%）": { click: 0.35, onlineIdle: 0.25, offline: 0.38, event: 0.02 },
    "挂机/离线党（点击3% 在线挂机12% 离线82% 事件3%）": { click: 0.03, onlineIdle: 0.12, offline: 0.82, event: 0.03 },
  } as const;

  it("各预算下有多少构筑彼此差 <3%", () => {
    for (const [name, W] of Object.entries(PROFILES)) {
      console.log(`\n=== ${name} ===`);
      for (const budget of [3, 5, 8, 10, 15]) {
        const rows: { k: string; v: number }[] = [];
        for (let a = 0; a <= 5; a++)
          for (let b = 0; b <= 5; b++)
            for (let c = 0; c <= 5; c++) if (a + b + c === budget) rows.push({ k: `${a}/${b}/${c}`, v: evalBuild2(a, b, c, W) });
        rows.sort((x, y) => y.v - x.v);
        const best = rows[0]!;
        const within3 = rows.filter((x) => x.v >= best.v * 0.97).length;
        const within8 = rows.filter((x) => x.v >= best.v * 0.92).length;
        console.log(
          `  ${String(budget).padStart(2)}点：分配=${String(rows.length).padStart(2)} 最优=${best.k}(${best.v.toFixed(3)}) 差<3%的=${within3} 差<8%的=${within8}　前3=${rows.slice(0, 3).map((x) => `${x.k}:${x.v.toFixed(3)}`).join(" ")}`,
        );
      }
    }
  });

  it("点数上限 = 全树点数：15 点档只有一种终局", () => {
    const all = TALENTS.length;
    console.log(`\n全树天赋数=${all}　点数上限=${TALENT_POINT_CAP}　→ 上限刚好等于全树：终局把 15 个全点亮，不存在取舍`);
    console.log(`15 点档的分配只有 (5,5,5) 能拿满；任何少点的分配都比它弱（无替代收益），因此终局构筑数=1`);
  });

  it("重置/补发行为：免费重置无损、点数来源上限", () => {
    let full = st({ talents: { unlocked: [], points: TALENT_POINT_CAP, rankGranted: -1 } });
    for (const def of TALENTS) full = unlockTalent(full, def.id)!;
    const reset = resetTalents(full);
    console.log(`\n点满 ${full.talents.unlocked.length} 个后点重置：返还点数=${reset.talents.points}（无损，立刻可重新分配）`);
    const g = grantRankTalents({ unlocked: [], points: 0, rankGranted: -1 }, 12);
    console.log(`段位到 13 档：一次补发 ${g.granted} 点，余额 ${g.talents.points}`);
    let t = g.talents;
    for (let i = 0; i < 30; i++) t = grantPrestigeTalentPoints(t);
    console.log(`再转生 30 次：点数=${t.points}（封顶 ${TALENT_POINT_CAP}，多转的 15 次完全无产出）`);
    const one = st({ talents: { unlocked: [], points: 1, rankGranted: -1 } });
    console.log(`1 点时可点：${TALENTS.filter((x) => canUnlock(one.talents, x.id)).map((x) => x.name).join(" / ")}`);
  });
});
