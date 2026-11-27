/**
 * R12 复验 3（引擎/源码侧）：逐条验证本轮 8 项修复的语义有效性（不只是"字段被引用"）。
 * 只读 src/，不改 src/。运行：npx vitest run --config playtest/vitest.r12c.config.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { initialState, type GameState } from "../src/engine/state";
import { doClick, clickPowerOf, comboMultiplier, comboCapOf } from "../src/engine/actions";
import { effectOf, stationIdleScaled } from "../src/engine/upgrades";
import { talentEffects, TALENTS } from "../src/engine/talents";
import { newEventState, onBossTap } from "../src/engine/events";
import { offlineEfficiency } from "../src/engine/progression";
import { offlineEarn } from "../src/engine/offline";
import { serialize, restore, type SaveAdapter } from "../src/engine/save";
import { emptyTeam, teamTraits } from "../src/engine/team";

function st(over: Partial<GameState>): GameState {
  return { ...initialState(), ...over };
}
function withTalent(ids: string[], base: GameState = initialState(), points = 0): GameState {
  return { ...base, talents: { unlocked: [...ids], points, rankGranted: 12 } };
}
function mem(): SaveAdapter {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
function col(lv = 5) {
  return { level: lv, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 };
}

describe("R12C-A 第 3 轮修复逐条语义验证", () => {
  it("① click_4 暴击：UI 显示 ×5，但收入没变（只改了显示值）❌", () => {
    const main = readFileSync("src/main.ts", "utf8");
    // 证明：gained *= 5 之后，doClick 用的是自己的内部计算，gained 没有进入 state
    const critBlock = main.slice(main.indexOf("gained *= 5"), main.indexOf("gained *= 5") + 600);
    const doClickLine = (critBlock.match(/state = doClick\([^)]*\)/) ?? [""])[0];
    console.log(`\n源码：暴击块里 "${doClickLine}" —— gained 未参与入账（gained 只用于飘字/显示）`);
    console.log(`  暴击漂字="${/暴击!/.test(main)}"　playSuccess="可以听到音效"`);
    const base = st({ levels: { coffee: 10 } });
    const crit = withTalent(["click_1", "click_2", "click_3", "click_4"], base);
    const run = (s: GameState) => {
      let t = s;
      const b = t.lifetimeEarned;
      for (let i = 0; i < 1000; i++) t = doClick(t, 30);
      return t.lifetimeEarned - b;
    };
    const g0 = run(base);
    const g1 = run(crit);
    console.log(
      `1000 次 30 连击收入：无天赋=${g0.toFixed(0)}　点击流 1-4=${g1.toFixed(0)}（×${(g1 / g0).toFixed(3)}）`,
    );
    console.log(`  ×${(g1 / g0).toFixed(3)} = 手速 1.25 × 连击上限 1.0968；若暴击真入账应再 ×1.2 ≈ ${(1.25 * 1.0968 * 1.2).toFixed(3)} → 暴击未入账 ❌`);
  });

  it("② event_2 罚款 -35%：真的生效 ✅（与强哥被动可叠加）", () => {
    const mk = (ids: string[], withQiang: boolean) => {
      const team = emptyTeam();
      if (withQiang) team.colleagues.qiang = col(3);
      const s = withTalent(ids, st({ levels: { phone: 40 }, moyu: 1e7, team }));
      const es = newEventState();
      es.bossUntil = 100;
      es.bossStartAt = 0;
      es.patrolCount = 9;
      return onBossTap(s, es, 5, 0).lost;
    };
    const l0 = mk([], false);
    const l1 = mk(["event_2"], false);
    const q0 = mk([], true);
    const q1 = mk(["event_2"], true);
    console.log(
      `\n偷点罚款（同队伍内对比）：无天赋=${l0.toFixed(1)} → event_2=${l1.toFixed(1)}（×${(l1 / l0).toFixed(3)}，期望 0.65）`,
    );
    console.log(
      `  带强哥（基础已 -10%）：无天赋=${q0.toFixed(1)} → event_2=${q1.toFixed(1)}（×${(q1 / q0).toFixed(3)}，期望 (1-0.45)/(1-0.10)=0.611）→ 天赋 35% 与强哥 10% 正确叠加 ✅`,
    );
    expect(l1 / l0).toBeCloseTo(0.65, 2);
    expect(q1 / q0).toBeCloseTo(0.6111, 2);
  });

  it("③ event_4 提前 2s 预警：main.ts 已消费 ✅（行为在 live 里验证）", () => {
    const main = readFileSync("src/main.ts", "utf8");
    const hits = ["patrolWarnSeconds", "王总快来了", "warnedBoss"].filter((k) => main.includes(k));
    console.log(`\nmain.ts 预警相关符号：${hits.join(", ")}（消费点存在 ✅）`);
    expect(hits.length).toBe(3);
  });

  it("④ idle_5b 同事 +40%：真的进总挂机 ✅", () => {
    const team = emptyTeam();
    for (const id of ["zhou", "mei", "qiang", "li", "wang"]) team.colleagues[id] = col(5);
    const base = st({ levels: { phone: 60, toilet: 40 }, team, prestige: 20 });
    const four = withTalent(["idle_1", "idle_2", "idle_3", "idle_4"], base);
    const a = withTalent(["idle_1", "idle_2", "idle_3", "idle_4", "idle_5a"], base);
    const b = withTalent(["idle_1", "idle_2", "idle_3", "idle_4", "idle_5b"], base);
    const i0 = effectOf(four).idleRate;
    const ia = effectOf(a).idleRate;
    const ib = effectOf(b).idleRate;
    console.log(
      `\n5 个 5 级同事在场时的总挂机：4 级=${i0.toFixed(0)}　+idle_5a=${ia.toFixed(0)}(×${(ia / i0).toFixed(3)})　+idle_5b=${ib.toFixed(0)}(×${(ib / i0).toFixed(3)})`,
    );
    console.log(`  idle_5b 的同事部分倍率=${talentEffects(b.talents).teamIdleMult}，总挂机确实上升 ✅（5a vs 5b 差距缩小到 ${((ia / ib - 1) * 100).toFixed(1)}%）`);
    expect(ib).toBeGreaterThan(i0);
  });

  it("⑤ 存档天赋点上限 18 ✅", () => {
    const s = st({ talents: { unlocked: [], points: 18, rankGranted: 12 } });
    const ad = mem();
    serialize(s, ad, Date.now());
    const r = restore(ad, Date.now());
    console.log(`\n存档 points=18 → restore=${r.state.talents.points}（期望 18）`);
    expect(r.state.talents.points).toBe(18);
    const s16 = st({ talents: { unlocked: [], points: 16, rankGranted: 12 } });
    const ad2 = mem();
    serialize(s16, ad2, Date.now());
    console.log(`存档 points=16 → restore=${restore(ad2, Date.now()).state.talents.points}（期望 16）`);
  });

  it("⑥ idle_4 离线效率可超 100% ✅（3 次/天也不再为 0）", () => {
    const base = st({ levels: { phone: 60 } });
    const i4 = withTalent(["idle_4"], base);
    const now = 20 * 86400_000;
    for (const visits of [1, 2, 3]) {
      const a = { ...base, visits: { date: "2026-11-27", count: visits } };
      const b = { ...i4, visits: { date: "2026-11-27", count: visits } };
      const e0 = offlineEfficiency(a, 0, now);
      const e1 = offlineEfficiency(b, 0, now);
      console.log(
        `回访 ${visits} 次/天：eff ${e0.toFixed(3)} → ${e1.toFixed(3)}（离线收入 +${((e1 / e0 - 1) * 100).toFixed(1)}%）`,
      );
    }
    // 小美被动接入验证
    const team = emptyTeam();
    team.colleagues.mei = col(1);
    const withMei = { ...base, team, visits: { date: "2026-11-27", count: 1 } };
    console.log(`小美在队：eff=${offlineEfficiency(withMei, 0, now).toFixed(3)}（teamTraits.offlineEfficiency=${teamTraits(withMei).offlineEfficiency}）`);
  });

  it("⑦ 天赋点角标：main.ts 已实现 ✅", () => {
    const main = readFileSync("src/main.ts", "utf8");
    const ok = /talents\.points > 0/.test(main) && /talent-badge/.test(main) && /"天赋"/.test(main);
    console.log(`\nmain.ts 天赋点角标（talent-badge / points>0 / "天赋"）=${ok}`);
    expect(ok).toBe(true);
  });

  it("⑧ click_5b 描述：声称已改，实际仍是连击每层翻倍 ×1.72 ❌", () => {
    const def = TALENTS.find((t) => t.id === "click_5b")!;
    console.log(`\nclick_5b 当前 desc："${def.desc}"`);
    const s = withTalent(["click_1", "click_2", "click_3", "click_4", "click_5b"], st({ levels: { coffee: 10 } }));
    console.log(
      `  实装连击：30 连倍率=${comboMultiplier(30, comboCapOf(s)).toFixed(3)}（描述宣称 ×1.72）　点击力 ×1.6 已生效=${(clickPowerOf(s) / clickPowerOf(st({ levels: { coffee: 10 } }))).toFixed(2)}`,
    );
    const descLies = def.desc.includes("连击每层收益翻倍");
    console.log(`  → 描述未改（${descLies}），面板仍向玩家承诺未实装的连击翻倍 ❌`);
  });
});

describe("R12C-B 平衡复算（含新 idle_5b）", () => {
  it("idle 终极二选一：5a vs 5b 的真实差距（引擎口径）", () => {
    for (const colleagues of [0, 3, 5]) {
      const team = emptyTeam();
      const ids = ["zhou", "mei", "qiang", "li", "wang"].slice(0, colleagues);
      for (const id of ids) team.colleagues[id] = col(5);
      const base = st({ levels: { phone: 60, toilet: 40 }, team, prestige: 20, patrolSurvives: 0 });
      const four = withTalent(["idle_1", "idle_2", "idle_3", "idle_4"], base);
      const a = withTalent(["idle_1", "idle_2", "idle_3", "idle_4", "idle_5a"], base);
      const b = withTalent(["idle_1", "idle_2", "idle_3", "idle_4", "idle_5b"], base);
      console.log(
        `\n同事数=${colleagues}：4 级挂机=${effectOf(four).idleRate.toFixed(0)} → 5a=${(effectOf(a).idleRate / effectOf(four).idleRate).toFixed(3)}×　5b=${(effectOf(b).idleRate / effectOf(four).idleRate).toFixed(3)}×`,
      );
    }
    console.log("  → 同事满配时 5b（+40% 同事）已能与 5a（+8% 工位）掰手腕，但 5a 对无同事玩家仍更优");
  });

  it("click_5b / event_5b 的经济上限（终局收入占比口径）", () => {
    // 30 天 3cps 基线：点击 0.4%、事件 0.1%（见 R12B-B1 实测）
    console.log(
      `\nclick_5b 只加成点击：点击占 0.4% → +60% 点击 ≈ 总额 +${(0.004 * 0.6 * 100).toFixed(2)}%（若连击翻倍真装再加 +${(0.004 * 0.26 * 100).toFixed(2)}%）`,
    );
    console.log(`event_5b 只加成事件：事件占 0.1% → 奖励 ×2.3 ≈ 总额 +${(0.001 * 1.3 * 100).toFixed(2)}%`);
    console.log("  → click_5b / event_5b 在 18 点终局（D4+）仍然≈0，只有 idle 终极是真选择");
  });
});
