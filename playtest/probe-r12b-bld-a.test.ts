/**
 * R12 复验 A：逐条验证 round2 声称修复的 9 项（引擎/存档侧），只读 src/。
 * 运行：npx vitest run --config playtest/vitest.r12b.config.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { initialState, type GameState } from "../src/engine/state";
import { clickPowerOf, doClick, comboMultiplier, comboCapOf, comboWindowOf, COMBO_MAX } from "../src/engine/actions";
import { effectOf, stationIdleScaled } from "../src/engine/upgrades";
import {
  TALENTS,
  TALENT_POINT_CAP,
  ULTIMATE_COST,
  costOfTalent,
  talentEffects,
  canUnlock,
  unlockTalent,
  resetTalents,
  branchTier,
  exclusiveTaken,
} from "../src/engine/talents";
import { newEventState, onBossTap, bossSurviveReward, onMemeTap } from "../src/engine/events";
import { offlineEfficiency } from "../src/engine/progression";
import { serialize, restore, SAVE_KEY, type SaveAdapter } from "../src/engine/save";
import { emptyTeam } from "../src/engine/team";

function st(over: Partial<GameState>): GameState {
  return { ...initialState(), ...over };
}
function withTalent(ids: string[], base: GameState = initialState(), points = 0): GameState {
  return { ...base, talents: { unlocked: [...ids], points, rankGranted: 12 } };
}
function memAdapter(): SaveAdapter & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
}

describe("R12B-A 逐条复验（声称 vs 实装）", () => {
  it("① P0-1 接线静态审计：每个效果字段的消费点", () => {
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        if (f.isDirectory()) walk(`${d}/${f.name}`);
        else if (f.name.endsWith(".ts")) files.push(`${d}/${f.name}`);
      }
    };
    walk("src");
    const src = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
    for (const tk of [
      "critEvery",
      "comboWindowBonus",
      "comboMaxBonus",
      "penaltyReduction",
      "patrolWarnSeconds",
      "offlineBaseBonus",
      "teamIdleMult",
      "clickToIdleStep",
      "surviveToIdle",
    ]) {
      const hits = [...src.entries()]
        .filter(([f]) => !f.endsWith("talents.ts") && !f.endsWith(".test.ts"))
        .filter(([, s]) => new RegExp(`\\b${tk}\\b`).test(s))
        .map(([f]) => f.replace("src/", ""));
      console.log(`  ${tk.padEnd(20)} → ${hits.length ? hits.join(", ") : "❌ 无人消费"}`);
    }
    const main = src.get("src/main.ts")!;
    console.log(`  main.ts 暴击代码=${/crit|暴击/i.test(main)}；预警横幅代码=${/预警|warn/i.test(main)}`);
  });

  it("② click_2 连击窗口 / click_3 连击上限：已接线 ✅", () => {
    const base = st({ levels: { coffee: 10 } });
    const one = withTalent(["click_1", "click_2"], base);
    const three = withTalent(["click_1", "click_2", "click_3"], base);
    console.log(
      `\n连击窗口：无天赋=${comboWindowOf(base).toFixed(2)}s　click_2=${comboWindowOf(one).toFixed(2)}s（期望 0.65）`,
    );
    console.log(
      `连击上限：无天赋=${comboCapOf(base)}　click_3=${comboCapOf(three)}（期望 30）　doClick 内部同参数：${comboMultiplier(30, comboCapOf(three)).toFixed(3)} vs 20 连 ${comboMultiplier(20, comboCapOf(three)).toFixed(3)}`,
    );
    expect(comboWindowOf(one)).toBeCloseTo(0.65, 6);
    expect(comboCapOf(three)).toBe(30);
  });

  it("③ click_4 暴击：未接线 ❌", () => {
    const base = st({ levels: { coffee: 10 } });
    const crit = withTalent(["click_1", "click_2", "click_3", "click_4"], base);
    const run = (s: GameState, n: number): { gain: number } => {
      let t = s;
      const before = t.lifetimeEarned;
      for (let i = 0; i < n; i++) t = doClick(t, 30);
      return { gain: t.lifetimeEarned - before };
    };
    const g0 = run(base, 1000).gain;
    const g1 = run(crit, 1000).gain;
    console.log(
      `\n1000 次 30 连点击：无天赋=${g0.toFixed(0)}　点满点击流1-4=${g1.toFixed(0)}　比值=${(g1 / g0).toFixed(3)}（若无暴击应为 1.25=手速；若有暴击应≈1.25×1.2=1.5）`,
    );
    const e = talentEffects(crit.talents);
    console.log(`  talentEffects.critEvery=${e.critEvery}，但全项目无消费点 → 暴击未触发`);
  });

  it("④ event_2 罚款 -35%：未接线 ❌（含叠加强哥被动也未接）", () => {
    const mk = (ids: string[], withQiang: boolean) => {
      const team = emptyTeam();
      if (withQiang) team.colleagues.qiang = { level: 3, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 };
      const state = withTalent(ids, st({ levels: { phone: 40 }, moyu: 1e7, team }));
      const es = newEventState();
      es.bossUntil = 100;
      es.bossStartAt = 0;
      es.patrolCount = 9;
      const r = onBossTap(state, es, 5, 0);
      return r.lost;
    };
    const l0 = mk([], false);
    const l1 = mk(["event_2"], false);
    const l0q = mk([], true);
    const l1q = mk(["event_2"], true);
    console.log(
      `\n偷点罚款：基线=${l0.toFixed(1)}　event_2=${l1.toFixed(1)}（期望 ×0.65=${(l0 * 0.65).toFixed(1)}）→ event_2 无效=${l1 === l0}`,
    );
    console.log(
      `          带强哥：无 event_2=${l0q.toFixed(1)}　有 event_2=${l1q.toFixed(1)}（期望再 ×0.65=${(l0q * 0.65).toFixed(1)}）→ 强哥被动+天赋叠加未接=${l1q === l0q}`,
    );
    expect(l1).toBe(l0);
    expect(l1q).toBe(l0q);
  });

  it("⑤ event_4 提前 2s 预警：未接线 ❌（+5% 奖励已接线 ✅）", () => {
    const s = st({ levels: { phone: 40 }, surviveStreak: 4 });
    const e = newEventState();
    e.surviveStreak = 4;
    const r0 = bossSurviveReward(s);
    const r1 = bossSurviveReward(withTalent(["event_4"], s));
    console.log(
      `\n巡逻奖励：无=${r0.toFixed(0)}　event_4=${r1.toFixed(0)}(×${(r1 / r0).toFixed(2)})　预警秒数字段=${talentEffects(withTalent(["event_4"], s).talents).patrolWarnSeconds}（有值但无消费点）`,
    );
    expect(r1 / r0).toBeCloseTo(1.05, 3);
  });

  it("⑥ 新终极：click_5b / event_5b 生效，idle_5b 完全无效 ❌", () => {
    const team = emptyTeam();
    team.colleagues.zhou = { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 };
    team.colleagues.mei = { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 };
    const base = st({ levels: { coffee: 20, phone: 60, toilet: 40 }, team });
    const clickBase = withTalent(["click_1", "click_2", "click_3", "click_4"], base);
    const click5b = withTalent(["click_1", "click_2", "click_3", "click_4", "click_5b"], base);
    console.log(
      `\nclick_5b：点击力 ${clickPowerOf(clickBase).toFixed(1)} → ${clickPowerOf(click5b).toFixed(1)}（×${(clickPowerOf(click5b) / clickPowerOf(clickBase)).toFixed(2)}，期望 ×1.6 ✔）`,
    );
    console.log(
      `  但描述"连击每层翻倍（上限×1.72）"：30 连倍率=${comboMultiplier(30, comboCapOf(click5b)).toFixed(3)}（实装仍 1.36，perCombo 未接 → ❌ 描述半假）`,
    );
    const idleBase = withTalent(["idle_1", "idle_2", "idle_3", "idle_4"], base);
    const idle5a = withTalent(["idle_1", "idle_2", "idle_3", "idle_4", "idle_5a"], base);
    const idle5b = withTalent(["idle_1", "idle_2", "idle_3", "idle_4", "idle_5b"], base);
    console.log(
      `idle 线性：4 级=${stationIdleScaled(idleBase).toFixed(1)} → idle_5a=${stationIdleScaled(idle5a).toFixed(1)}（×${(stationIdleScaled(idle5a) / stationIdleScaled(idleBase)).toFixed(3)}）`,
    );
    console.log(
      `idle_5b（同事+40%）：总挂机 ${effectOf(idleBase).idleRate.toFixed(1)} → ${effectOf(idle5b).idleRate.toFixed(1)}（变化=${(effectOf(idle5b).idleRate / effectOf(idleBase).idleRate - 1).toFixed(4)}）→ teamIdleMult 无消费点 ❌`,
    );
    const evBase = withTalent(["event_1", "event_2", "event_3", "event_4"], base);
    const ev5b = withTalent(["event_1", "event_2", "event_3", "event_4", "event_5b"], base);
    const m0 = newEventState();
    m0.memeUntil = 99;
    const m1 = newEventState();
    m1.memeUntil = 99;
    console.log(
      `event_5b：巡逻奖 ×${(bossSurviveReward(ev5b) / bossSurviveReward(evBase)).toFixed(2)}　丢梗 ×${(onMemeTap(ev5b, m1).earned / onMemeTap(evBase, m0).earned).toFixed(2)}（期望 ×2/×2.3 ✔）`,
    );
  });

  it("⑦ 树扩容 18 + 互斥 + 2 点终极 ✅", () => {
    console.log(`\n天赋数=${TALENTS.length}　上限=${TALENT_POINT_CAP}　终极点数=${ULTIMATE_COST}`);
    const five = st({ talents: { unlocked: [], points: 10, rankGranted: 12 } });
    let s = five;
    for (const id of ["click_1", "click_2", "click_3", "click_4"]) s = unlockTalent(s, id)!;
    const before = s.talents.points;
    const a = unlockTalent(s, "click_5a");
    console.log(`点亮 4 级后余额=${before}；点 click_5a(2点) → ${a ? "成功，余额=" + a.talents.points : "失败"}`);
    console.log(`再点 click_5b（同互斥组）→ ${a && unlockTalent(a, "click_5b") === null ? "❌ 不可点（互斥生效 ✅）" : "⚠️ 可点（互斥失效）"}`);
    const full = a!;
    const reset = resetTalents(full);
    console.log(`重置返还=${reset.talents.points}（4×1+2=6 应返还 6）`);
    console.log(`每流派满级点数=4×1+2=6，3 流派=18=上限 → 必然做 3 次终极二选一，终局组合 2^3=8`);
  });

  it("⑧ 点上限 18 的存档往返：restore 仍按 15 截断 ❌", () => {
    const adapter = memAdapter();
    const s = st({
      talents: { unlocked: ["idle_1", "idle_2", "idle_3", "idle_4", "idle_5a"], points: 18, rankGranted: 12 },
    });
    serialize(s, adapter, Date.now());
    const r = restore(adapter, Date.now());
    console.log(
      `\n存档前 points=${s.talents.points} → restore 后 points=${r.state.talents.points}（期望 18；实际被 ${SAVE_KEY} 的 Math.min(15,…) 截断）`,
    );
    // 全树 18 点存档：unlocked 保留但点数被砍
    const full = st({ talents: { unlocked: TALENTS.filter((t) => ["click_1","click_2","click_3","click_4","idle_1","idle_2","idle_3","idle_4","event_1","event_2","event_3","event_4"].includes(t.id)).map(t=>t.id), points: 0, rankGranted: 12 } });
    const ad2 = memAdapter();
    serialize(full, ad2, Date.now());
    const r2 = restore(ad2, Date.now());
    console.log(`已点亮 12 个线性天赋的存档 restore：unlocked=${r2.state.talents.unlocked.length}（OK）points=${r2.state.talents.points}`);
  });

  it("⑨ idle_4「离线效率上限 +0.08 可超 100%」：未实现 ❌", () => {
    const base = st({ levels: { phone: 60 } });
    const s4 = withTalent(["idle_4"], base);
    const now = 20 * 86400_000;
    for (const visits of [1, 2, 3]) {
      const a = { ...base, visits: { date: "2026-11-27", count: visits } };
      const b = { ...s4, visits: { date: "2026-11-27", count: visits } };
      console.log(
        `\n回访 ${visits} 次/天：无=${offlineEfficiency(a, 0, now).toFixed(3)}　idle_4=${offlineEfficiency(b, 0, now).toFixed(3)}　离线收入 +${((offlineEfficiency(b, 0, now) / offlineEfficiency(a, 0, now) - 1) * 100).toFixed(1)}%`,
      );
    }
    console.log("  ↑ progression.ts 仍是 Math.min(1, …)：3 次/天时 idle_4 依旧 0 收益");
  });

  it("⑩ 天赋点角标 / 0 点引导 / 转化进度 / 重置确认", () => {
    const panel = readFileSync("src/ui/team-panel.ts", "utf8");
    const main = readFileSync("src/main.ts", "utf8");
    console.log(
      `\n0 点引导文案=${/还没有天赋点/.test(panel)}　转化进度=${/点击转化/.test(panel) && /安然转化/.test(panel)}　毕业文案=${/毕业/.test(panel) || /毕业/.test(main)}`,
    );
    console.log(`重置确认 confirm()=${/confirm\(/.test(main)}　天赋点角标：refresh() 里 badge 只统计 claimableCount=${/claimableCount\(state/.test(panel)}（talents.points 未参与）`);
  });
});
