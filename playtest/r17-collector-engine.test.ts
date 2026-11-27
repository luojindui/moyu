/**
 * R17 终验-收集成就党：引擎侧证据（只读 src/，不修改）
 * 1) 成就数量/分类校验（22/10）
 * 2) 可达性：rank_14 / talent_18 是否结构性不可达；全可达上限 20/22；成就等级上限
 * 3) 加成数学：与 live 探针同样的 seeded 状态，输出预期 clickPower / idleRate，供 HUD 对照
 * 4) 点击系成就"重复计入"检查：effectOf.clickPower 内一次 + clickPowerOf 外一次
 *
 * 运行：npx vitest run --config playtest/vitest.r17-collector.config.ts
 */
import { describe, it, expect } from "vitest";
import { initialState, type GameState } from "../src/engine/state";
import { ACHIEVEMENTS, achByCategory, achDone, achEffects, achLevel, achPoints, achById } from "../src/engine/achievements";
import { clickPowerOf } from "../src/engine/actions";
import { effectOf } from "../src/engine/upgrades";
import { RANKS } from "../src/engine/titles";
import { TALENTS, TALENT_POINT_CAP, canUnlock, costOfTalent, unlockTalent } from "../src/engine/talents";
import { COLLEAGUES } from "../src/engine/team";
import { MEME_QUOTES } from "../src/engine/flavor";
import { UPGRADES } from "../src/engine/upgrades";
import { formatMoyu } from "../src/engine/format";

const fullCollected = () => ({
  quotes: Array.from({ length: MEME_QUOTES.length }, (_, i) => i),
  flavors: Array.from({ length: UPGRADES.length * 5 }, (_, i) => i),
});

/** seeded 基础：咖啡 Lv.1 + 全图鉴（全图鉴成就 → 3 条 idle 加成，两份存档一致，可做差） */
const seedBase = (over: Partial<GameState> = {}): GameState => ({
  ...initialState(),
  levels: { coffee: 100, phone: 40 },
  collected: fullCollected(),
  ...over,
});

const eff = (s: GameState) => {
  const e = effectOf(s);
  return {
    clickPowerHud: clickPowerOf(s),
    clickPowerHudText: formatMoyu(clickPowerOf(s)),
    effectOfClickPower: e.clickPower,
    idleRate: e.idleRate,
    idleRateText: formatMoyu(e.idleRate),
  };
};

const allReachable = (): GameState => {
  let s: GameState = {
    ...initialState(),
    moyu: 1e13,
    totalEarned: 1e13,
    lifetimeEarned: 2e11,
    totalClicks: 100_000,
    bestIdleRate: 1_000_000,
    rankIndex: 13,
    decor: ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"],
    collected: fullCollected(),
    arcade: { date: "x", played: 0, best: { findboss: 2000 } },
    cardsChosenTotal: 5,
    surviveStreak: 10,
  };
  let team = { ...s.team.colleagues };
  for (const def of COLLEAGUES) {
    team[def.id] = { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 100, autoRepeat: false, rewardSnapshot: 0 };
  }
  s = { ...s, team: { colleagues: team } };
  // 24 点能点出的最大节点数（贪心：永远先点最便宜且可点的）
  let ts = { unlocked: [] as string[], points: TALENT_POINT_CAP, rankGranted: -1, dailyGiftDate: "", overflow: 0 };
  for (let i = 0; i < 40; i++) {
    let best: string | null = null;
    for (const t of TALENTS) {
      if (!canUnlock(ts, t.id)) continue;
      if (!best) best = t.id;
      else {
        const a = costOfTalent(t.id);
        const b = costOfTalent(best);
        if (a < b || (a === b && t.tier < (TALENTS.find((x) => x.id === best)?.tier ?? 9))) best = t.id;
      }
    }
    if (!best) break;
    const r = unlockTalent({ ...s, talents: ts } as GameState, best);
    if (!r) break;
    ts = r.talents;
  }
  return { ...s, talents: { ...ts, points: 0 } };
};

describe("R17 收集成就党 / 引擎侧", () => {
  it("成就规模：22 条 / 10 分类，id 唯一，分类合计 22", () => {
    const cats = achByCategory(initialState());
    expect(ACHIEVEMENTS).toHaveLength(22);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(22);
    expect(cats).toHaveLength(10);
    expect(cats.reduce((n, c) => n + c.total, 0)).toBe(22);
    console.log(
      "SCALE " +
        JSON.stringify({
          total: ACHIEVEMENTS.length,
          categories: cats.map((c) => ({ cat: c.cat, total: c.total })),
          levels: ACHIEVEMENTS.reduce<Record<string, number>>((m, a) => ((m[a.category] = (m[a.category] ?? 0) + 1), m), {}),
        }),
    );
  });

  it("新鲜号：0/22，Lv.1", () => {
    const s = initialState();
    expect(achPoints(s)).toBe(0);
    expect(achLevel(s)).toBe(1);
  });

  it("rank_14 不可达：rankIndex 最大 = RANKS.length-1 = 13", () => {
    const maxIdx = RANKS.length - 1;
    const def = achById("rank_14")!;
    expect(def.target).toBe(14);
    expect(maxIdx).toBe(13);
    expect(achDone(def, { ...initialState(), rankIndex: maxIdx })).toBe(false);
    console.log(
      "RANK14 " +
        JSON.stringify({
          ranks: RANKS.length,
          names: RANKS.map((r) => r.name),
          maxRankIndex: maxIdx,
          target: def.target,
          progressAtMax: def.progress({ ...initialState(), rankIndex: maxIdx }),
          doneAtMax: achDone(def, { ...initialState(), rankIndex: maxIdx }),
        }),
    );
  });

  it("talent_18 不可达：24 点上限最多点亮 14 个天赋节点", () => {
    const s = initialState();
    let ts = { unlocked: [] as string[], points: TALENT_POINT_CAP, rankGranted: -1, dailyGiftDate: "", overflow: 0 };
    const order: string[] = [];
    for (let i = 0; i < 40; i++) {
      let best: string | null = null;
      for (const t of TALENTS) {
        if (!canUnlock(ts, t.id)) continue;
        if (!best) best = t.id;
        else {
          const a = costOfTalent(t.id);
          const b = costOfTalent(best);
          if (a < b || (a === b && t.tier < (TALENTS.find((x) => x.id === best)?.tier ?? 9))) best = t.id;
        }
      }
      if (!best) break;
      const r = unlockTalent({ ...s, talents: ts } as GameState, best);
      if (!r) break;
      ts = r.talents;
      order.push(best);
    }
    const def = achById("talent_18")!;
    expect(TALENT_POINT_CAP).toBe(24);
    expect(ts.unlocked.length).toBe(14);
    expect(ts.points).toBe(0);
    expect(achDone(def, { ...s, talents: { ...ts, points: 0 } })).toBe(false);
    console.log(
      "TALENT18 " +
        JSON.stringify({
          cap: TALENT_POINT_CAP,
          maxNodes: ts.unlocked.length,
          order,
          target: def.target,
          progressAtMax: def.progress({ ...s, talents: { ...ts, points: 0 } }),
          doneAtMax: achDone(def, { ...s, talents: { ...ts, points: 0 } }),
          totalDefs: TALENTS.length,
          fullTreeCost: 27,
        }),
    );
  });

  it("全系统拉满后的可达上限：20/22，等级上限 Lv.6，2 条永远差 1 格", () => {
    const s = allReachable();
    const doneList = ACHIEVEMENTS.filter((a) => achDone(a, s)).map((a) => a.id);
    const undone = ACHIEVEMENTS.filter((a) => !achDone(a, s)).map((a) => ({ id: a.id, p: a.progress(s), t: a.target }));
    expect(doneList).toHaveLength(20);
    expect(undone.map((x) => x.id).sort()).toEqual(["rank_14", "talent_18"]);
    expect(achPoints(s)).toBe(20);
    expect(achLevel(s)).toBe(6);
    console.log(
      "MAXREACH " +
        JSON.stringify({
          done: doneList.length,
          total: ACHIEVEMENTS.length,
          undone,
          levelAtMax: achLevel(s),
          levelIfAll22: Math.floor(22 / 4) + 1,
          effectsAtMax: achEffects(s),
          cats: achByCategory(s).map((c) => `${c.cat} ${c.done}/${c.total}`),
        }),
    );
  });

  it("live seeded 变体预期值（HUD 对照用）", () => {
    const A = seedBase({ totalClicks: 0 });
    const B = seedBase({ totalClicks: 1000 }); // 点击成就 click_1k
    const C = seedBase({ levels: { coffee: 100, phone: 80 }, bestIdleRate: 0 }); // tick 后 bestIdleRate≈1760 → idle_1k
    const D = seedBase({ rankIndex: 7 }); // + rank_7（idle +2%）
    const rows: Record<string, unknown> = {};
    for (const [k, v] of Object.entries({ A, B, C, D })) {
      rows[k] = {
        achPoints: achPoints(v),
        achLevel: achLevel(v),
        achEffects: achEffects(v),
        hud: eff(v),
        cats: achByCategory(v).map((c) => `${c.cat} ${c.done}/${c.total}`),
      };
    }
    // C/D 的 bestIdleRate 由 tick 自动更新为 effectOf 当时值，live 侧用引擎公式推：
    const Cpre = { ...C, bestIdleRate: effectOf(C).idleRate };
    const Cpost = { ...Cpre };
    const Dpre = { ...D, bestIdleRate: effectOf(D).idleRate };
    console.log(
      "SEEDED " +
        JSON.stringify({
          A: rows.A,
          B: rows.B,
          C_observed: { achPoints: achPoints(Cpre), achLevel: achLevel(Cpre), hud: eff(Cpre), idleAfter: eff(Cpost) },
          D_observed: { achPoints: achPoints(Dpre), hud: eff(Dpre) },
          note: "live 中 bestIdleRate 由 tick 自动记录：C/D 第一帧记录 ≈1760，之后 idle_1k(+2%) 生效；D 再叠 rank_7(+2%)",
        }),
    );
    // B/A 点击比 → 应 ≈1.0404（重复计入）而不是 1.02（单次）
    const ratio = clickPowerOf(B) / clickPowerOf(A);
    const clickUpgrade = 3200; // coffee Lv.100 = 1×100×2^5
    const noAch = (1 + clickUpgrade * 1.2) / (1 + clickUpgrade * 1.2);
    const single = (1 + clickUpgrade * 1.2 * 1.02) / (1 + clickUpgrade * 1.2);
    void noAch;
    console.log(
      "DOUBLE_DIP " +
        JSON.stringify({
          clickA: clickPowerOf(A),
          clickB: clickPowerOf(B),
          ratioActual: Number(ratio.toFixed(6)),
          expectedIfSingle: Number(single.toFixed(6)),
          singleHud: formatMoyu(1 + clickUpgrade * 1.2 * 1.02),
          expectedIfDouble: Number((((1 + clickUpgrade * 1.2 * 1.02) * 1.02) / (1 + clickUpgrade * 1.2)).toFixed(6)),
          hudA: formatMoyu(clickPowerOf(A)),
          hudB: formatMoyu(clickPowerOf(B)),
        }),
    );
  });

  it("成就等级不参与任何加成（仅展示）", () => {
    // achLevel 只被 journal.ts 引用（展示）；引擎加成只走 achEffects
    const s1 = seedBase({ totalClicks: 0 });
    const s2 = seedBase({ totalClicks: 100_000 });
    expect(achLevel(s2)).toBeGreaterThan(achLevel(s1));
    expect(achEffects(s2).clickMult).toBeGreaterThan(achEffects(s1).clickMult);
    console.log(
      "LEVEL_ONLY_DISPLAY " +
        JSON.stringify({
          level1: achLevel(s1),
          level2: achLevel(s2),
          achEffectsA: achEffects(s1),
          achEffectsB: achEffects(s2),
        }),
    );
  });
});