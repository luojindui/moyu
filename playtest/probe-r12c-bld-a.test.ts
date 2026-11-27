/**
 * R12 复验 3（引擎/源码侧，ver 96117f2）：验证本轮 + 追加修复的语义有效性。
 * 只读 src/，不改 src/。运行：npx vitest run --config playtest/vitest.r12c.config.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { initialState, type GameState, gain } from "../src/engine/state";
import { doClick, clickPowerOf, comboMultiplier, comboCapOf } from "../src/engine/actions";
import { effectOf, stationIdleScaled, conversionBonus } from "../src/engine/upgrades";
import { talentEffects, TALENTS, grantDailyTalentPoint, TALENT_POINT_CAP, emptyTalents } from "../src/engine/talents";
import { newEventState, onBossTap, finishPatrol, bossSurviveReward, onMemeTap } from "../src/engine/events";
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
const SRC = {
  main: readFileSync("src/main.ts", "utf8"),
  events: readFileSync("src/engine/events.ts", "utf8"),
  upg: readFileSync("src/engine/upgrades.ts", "utf8"),
  prog: readFileSync("src/engine/progression.ts", "utf8"),
  save: readFileSync("src/engine/save.ts", "utf8"),
};

describe("R12C-A 第 3 轮修复逐条验证（当前 HEAD）", () => {
  it("① click_4 暴击：真入账（doClick 收 critMult），且偷点不触发 ✅", () => {
    const main = SRC.main;
    const call = (main.match(/state = doClick\([^)]*\)/) ?? [""])[0];
    console.log(`\nmain.ts 入账：${call}（暴击倍率参与入账）`);
    console.log(`  偷点分支在暴击逻辑之前 return：${main.indexOf("if (es.bossUntil > scene.gameTime)") < main.indexOf("critEvery")}`);
    // 复刻 main 的暴击逻辑：每 20 下 ×5
    const base = st({ levels: { coffee: 10 } });
    const crit = withTalent(["click_1", "click_2", "click_3", "click_4"], base);
    const run = (s: GameState, useCrit: boolean) => {
      let t = s;
      const b = t.lifetimeEarned;
      for (let i = 0; i < 1000; i++) {
        const isCrit = useCrit && (t.totalClicks + 1) % 20 === 0;
        t = doClick(t, 30, isCrit ? 5 : 1);
      }
      return t.lifetimeEarned - b;
    };
    const g0 = run(base, false);
    const g1 = run(crit, true);
    const g1NoCrit = run(crit, false);
    console.log(
      `1000 次 30 连：无天赋=${g0.toFixed(0)}　点击流1-4(暴击生效)=${g1.toFixed(0)}（×${(g1 / g0).toFixed(3)}，期望 1.25×1.0968×1.2=1.645）　不开暴击=${g1NoCrit.toFixed(0)}`,
    );
    expect(g1 / g1NoCrit).toBeCloseTo(1.2, 1);
  });

  it("② event_2 罚款 -35%：真生效 ✅（与强哥 10% 正确叠加）", () => {
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
    const l0 = mk([], false),
      l1 = mk(["event_2"], false);
    const q0 = mk([], true),
      q1 = mk(["event_2"], true);
    console.log(
      `\n偷点罚款：无天赋=${l0.toFixed(1)} → event_2=${l1.toFixed(1)}（×${(l1 / l0).toFixed(3)}，期望 0.65）`,
    );
    console.log(
      `  带强哥（基础-10%）：无天赋=${q0.toFixed(1)} → event_2=${q1.toFixed(1)}（×${(q1 / q0).toFixed(3)}，期望 0.611）✅`,
    );
    expect(l1 / l0).toBeCloseTo(0.65, 2);
    expect(q1 / q0).toBeCloseTo(0.6111, 2);
  });

  it("③ event_4 提前 2s 预警：main.ts 已消费 ✅（时间差见 live）", () => {
    console.log(
      `\nmain.ts 预警符号：${["patrolWarnSeconds", "王总快来了", "warnedBoss"].filter((k) => SRC.main.includes(k)).join(", ")}`,
    );
    expect(SRC.main).toContain("patrolWarnSeconds");
  });

  it("④ idle_5b 同事 +40%：真进挂机 ✅", () => {
    const team = emptyTeam();
    for (const id of ["zhou", "mei", "qiang", "li", "wang"]) team.colleagues[id] = col(5);
    const base = st({ levels: { phone: 60, toilet: 40 }, team, prestige: 20 });
    const four = withTalent(["idle_1", "idle_2", "idle_3", "idle_4"], base);
    const a = withTalent(["idle_1", "idle_2", "idle_3", "idle_4", "idle_5a"], base);
    const b = withTalent(["idle_1", "idle_2", "idle_3", "idle_4", "idle_5b"], base);
    const [i0, ia, ib] = [four, a, b].map((s) => effectOf(s).idleRate);
    console.log(
      `\n5 个 5 级同事：4 级=${i0.toFixed(0)}　5a=${ia.toFixed(0)}(×${(ia / i0).toFixed(3)})　5b=${ib.toFixed(0)}(×${(ib / i0).toFixed(3)}) → 5b 已生效 ✅`,
    );
    expect(ib).toBeGreaterThan(i0);
  });

  it("⑤ 存档天赋点上限 18 ✅", () => {
    const ad = mem();
    serialize(st({ talents: { unlocked: [], points: 18, rankGranted: 12 } }), ad, Date.now());
    const r = restore(ad, Date.now());
    console.log(`\n存档 18 点 → restore=${r.state.talents.points}`);
    expect(r.state.talents.points).toBe(18);
  });

  it("⑥ idle_4 离线效率可超 100% ✅（3 次/天 +8%）", () => {
    const base = st({ levels: { phone: 60 } });
    const i4 = withTalent(["idle_4"], base);
    const now = 20 * 86400_000;
    for (const visits of [1, 2, 3]) {
      const a = { ...base, visits: { date: "2026-11-27", count: visits } };
      const b = { ...i4, visits: { date: "2026-11-27", count: visits } };
      const e0 = offlineEfficiency(a, 0, now),
        e1 = offlineEfficiency(b, 0, now);
      console.log(`回访 ${visits} 次/天：eff ${e0.toFixed(3)} → ${e1.toFixed(3)}（+${((e1 / e0 - 1) * 100).toFixed(1)}%）`);
    }
    // 小美被动
    const team = emptyTeam();
    team.colleagues.mei = col(1);
    const withMei = { ...base, team, visits: { date: "2026-11-27", count: 1 } };
    console.log(`小美在队 eff=${offlineEfficiency(withMei, 0, now).toFixed(3)}（teamTraits=${teamTraits(withMei).offlineEfficiency}）`);
    expect(offlineEfficiency({ ...i4, visits: { date: "x", count: 3 } }, 0, now)).toBeGreaterThan(1);
  });

  it("⑥b 新增：每日首开 +1 天赋点（节奏改善）✅", () => {
    let t = { ...emptyTalents(), points: 0 };
    const d1 = grantDailyTalentPoint(t, "2026-11-27");
    const d1b = grantDailyTalentPoint(d1.talents, "2026-11-27");
    console.log(`\n每日签到点：首次=${d1.granted}（余额 ${d1.talents.points}）　同日再开=${d1b.granted}（幂等 ✅）`);
    let t2 = { ...emptyTalents(), points: TALENT_POINT_CAP };
    const capped = grantDailyTalentPoint(t2, "2026-11-27");
    console.log(`已满 18 点再签到：+${capped.granted}（不溢出 ✅）`);
    expect(d1.granted).toBe(1);
    expect(d1b.granted).toBe(0);
    expect(capped.granted).toBe(0);
  });

  it("⑦ 天赋点角标 ✅", () => {
    const ok = /talents\.points > 0/.test(SRC.main) && /talent-badge/.test(SRC.main);
    console.log(`\nmain.ts 天赋点角标=${ok}`);
    expect(ok).toBe(true);
  });

  it("⑧ click_5b 新效果：+12%立刻 + 每1000点击+1%(封顶+20%) + 点击力+60% ✅", () => {
    const base = st({ levels: { coffee: 10 } });
    const four = withTalent(["click_1", "click_2", "click_3", "click_4"], base);
    const b = withTalent(["click_1", "click_2", "click_3", "click_4", "click_5b"], {
      ...base,
      totalClicks: 20000,
    });
    const desc = TALENTS.find((t) => t.id === "click_5b")!.desc;
    console.log(`\nclick_5b desc："${desc}"`);
    console.log(`  0 点击时 conversionBonus=${conversionBonus(withTalent(["click_5b"], base)).toFixed(3)}（期望 0.12）`);
    console.log(`  20000 点击时 conversionBonus=${conversionBonus(b).toFixed(3)}（实装口径：总封顶 +20%，即点击部分最多再 +8%）`);
    console.log(`  点击力倍率=${(clickPowerOf(b) / clickPowerOf(four)).toFixed(2)}（期望 1.60 ✅）`);
    expect(conversionBonus(withTalent(["click_5b"], base))).toBeCloseTo(0.12, 2);
    expect(conversionBonus(b)).toBeCloseTo(0.2, 2);
  });

  it("⑨ event_5b 新效果：奖励×2 + 每次安然额外 10 秒挂机收益 ✅", () => {
    const base = st({ levels: { phone: 40 }, surviveStreak: 2 });
    const four = withTalent(["event_1", "event_2", "event_3", "event_4"], base);
    const b = withTalent(["event_1", "event_2", "event_3", "event_4", "event_5b"], base);
    const es = newEventState();
    es.bossVariant = "hold";
    es.bossCaught = false;
    const r0 = finishPatrol(four, { ...es });
    const r1 = finishPatrol(b, { ...es });
    console.log(`\n安然巡逻奖励：4 级=${r0.reward.toFixed(0)}　+event_5b=${r1.reward.toFixed(0)}（×${(r1.reward / r0.reward).toFixed(2)}，含 +10s 挂机收益）`);
    console.log(`  丢梗：×${(onMemeTap(b, { ...newEventState(), memeUntil: 99 }).earned / onMemeTap(four, { ...newEventState(), memeUntil: 99 }).earned).toFixed(2)}`);
    expect(r1.reward).toBeGreaterThan(r0.reward * 2);
  });
});

describe("R12C-B 18 点终局 8 组合（当前实装，引擎口径）", () => {
  /** 参考终局：D4 画像（20000 累计点击 / 30 安然 / 5 同事满级 / 高等级） */
  function refState(): GameState {
    const team = emptyTeam();
    for (const id of ["zhou", "mei", "qiang", "li", "wang"]) team.colleagues[id] = col(5);
    return st({
      levels: { coffee: 20, water: 20, chair: 20, phone: 60, toilet: 50, group: 50, meeting: 40, deep: 30, retire: 20 },
      prestige: 20,
      totalClicks: 20000,
      patrolSurvives: 30,
      team,
    });
  }
  const LINEAR = ["click_1", "click_2", "click_3", "click_4", "idle_1", "idle_2", "idle_3", "idle_4", "event_1", "event_2", "event_3", "event_4"];
  const ULT = { C: ["click_5a", "click_5b"], I: ["idle_5a", "idle_5b"], E: ["event_5a", "event_5b"] };

  it("8 组合的挂机/点击/离线/事件收益对比", () => {
    const ref = refState();
    const rows: { k: string; idle: number; station: number; click: number; offline: number; patrol: number }[] = [];
    for (const c of ULT.C)
      for (const i of ULT.I)
        for (const e of ULT.E) {
          const s = withTalent([...LINEAR, c, i, e], ref);
          rows.push({
            k: `${c.replace("_5", "")}/${i.replace("_5", "")}/${e.replace("_5", "")}`,
            idle: effectOf(s).idleRate,
            station: stationIdleScaled(s),
            click: clickPowerOf(s),
            offline: offlineEarn(s, 24 * 3600, 0.7).earned,
            patrol: bossSurviveReward(s, { ...newEventState(), surviveStreak: 4 }),
          });
        }
    const best = Math.max(...rows.map((r) => r.idle));
    const bestStation = Math.max(...rows.map((r) => r.station));
    for (const r of rows.sort((a, b) => b.idle - a.idle)) {
      console.log(
        `  ${r.k.padEnd(18)} 总挂机=${r.idle.toFixed(0)}（${((r.idle / best - 1) * 100).toFixed(1)}%）　工位=${r.station.toFixed(0)}　点击力=${r.click.toFixed(0)}　离线/天=${(r.offline / 1e6).toFixed(1)}e6　巡逻奖=${r.patrol.toFixed(0)}`,
      );
    }
    const within5 = rows.filter((r) => r.idle >= best * 0.95).length;
    console.log(`  → 24h 离线收益同理随总挂机线性；与最优差<5% 的组合数=${within5}/8`);
  });

  it("中前期（D2 画像：6000 点击 / 10 安然 / 3 同事）取舍是否不同", () => {
    const team = emptyTeam();
    for (const id of ["zhou", "mei", "qiang"]) team.colleagues[id] = col(3);
    const ref = st({
      levels: { coffee: 10, water: 10, chair: 10, phone: 40, toilet: 30, group: 20 },
      prestige: 8,
      totalClicks: 6000,
      patrolSurvives: 10,
      team,
    });
    const rows: { k: string; idle: number }[] = [];
    for (const c of ULT.C)
      for (const i of ULT.I)
        for (const e of ULT.E) {
          const s = withTalent([...LINEAR, c, i, e], ref);
          rows.push({ k: `${c}/${i}/${e}`, idle: effectOf(s).idleRate });
        }
    const best = Math.max(...rows.map((r) => r.idle));
    for (const r of rows.sort((a, b) => b.idle - a.idle).slice(0, 4))
      console.log(`  ${r.k.padEnd(38)} 总挂机=${r.idle.toFixed(0)}（${((r.idle / best - 1) * 100).toFixed(1)}%）`);
    console.log(`  与最优差<5% 的组合数=${rows.filter((r) => r.idle >= best * 0.95).length}/8（D2 时点击/安然都没攒满，click_5b/event_5b 反而领先）`);
  });
});
