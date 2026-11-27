/**
 * R17 终验-收集成就党：引擎侧证据（只读 src/，不修改）
 * 针对当前 v0.6.1（线上已部署）：
 * 1) 成就数量/分类校验（22/10）
 * 2) v0.6.1 可达性修复验证：rank_14（rankIndex 改 1 基）、talent_18（target 18→13）、
 *    boss 成就改 bestSurviveStreak（转生不清）→ 22/22 可达、Lv.6
 * 3) 成就等级奖励：每级 +2% 挂机（achEffects 内）→ 验证 Lv.2 起确实有收益
 * 4) 与 live 探针一致的 seeded 状态 → 输出预期 clickPower / idleRate 供 HUD 对照
 * 5) 点击系成就"重复计入"检查（v0.6.1 仍未修）：effectOf.clickPower 内一次 + clickPowerOf 外一次
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
import { offlineEarn } from "../src/engine/offline";

const fullCollected = () => ({
  quotes: Array.from({ length: MEME_QUOTES.length }, (_, i) => i),
  flavors: Array.from({ length: UPGRADES.length * 5 }, (_, i) => i),
});

/** seeded 基础：咖啡 Lv.100 + 手机 Lv.40 + 全图鉴（3 条图鉴成就） */
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

/** 全 22 条可达的"数学上限"状态（按 v0.6.1 的 1 基 rankIndex 与 24 点天赋上限） */
const allReachable = (): GameState => {
  let s: GameState = {
    ...initialState(),
    moyu: 1e13,
    totalEarned: 1e13,
    lifetimeEarned: 4e11,
    totalClicks: 100_000,
    bestIdleRate: 1_000_000,
    rankIndex: 14, // v0.6.1：1 基，14 = 最高档
    surviveStreak: 10,
    bestSurviveStreak: 10,
    decor: ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"],
    collected: fullCollected(),
    arcade: { date: "x", played: 0, best: { findboss: 2000 } },
    cardsChosenTotal: 5,
  };
  const team = { ...s.team.colleagues };
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

/** 24 点最多能点亮的天赋节点数（穷举贪心） */
function maxTalentNodes(): { n: number; order: string[] } {
  const ts0 = { unlocked: [] as string[], points: TALENT_POINT_CAP, rankGranted: -1, dailyGiftDate: "", overflow: 0 };
  let ts = ts0;
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
    const r = unlockTalent({ ...initialState(), talents: ts }, best);
    if (!r) break;
    ts = r.talents;
    order.push(best);
  }
  return { n: ts.unlocked.length, order };
}

describe("R17 收集成就党 / 引擎侧（v0.6.1）", () => {
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
        }),
    );
  });

  it("新鲜号：0/22，Lv.1，无等级奖励", () => {
    const s = initialState();
    expect(achPoints(s)).toBe(0);
    expect(achLevel(s)).toBe(1);
    expect(achEffects(s).idleMult).toBe(1);
  });

  it("v0.6.1 rank_14 已可达：rankIndex 1 基，最高 14，达到末档即完成", () => {
    const def = achById("rank_14")!;
    expect(RANKS).toHaveLength(14);
    expect(def.target).toBe(14);
    expect(def.progress({ ...initialState(), rankIndex: 14 })).toBe(14);
    expect(achDone(def, { ...initialState(), rankIndex: 14 })).toBe(true);
    // 旧存档（0 基 13）+ main.ts 的 +1 迁移后可到 14：
    expect(achDone(def, { ...initialState(), rankIndex: 13 + 1 })).toBe(true);
    console.log(
      "RANK14_FIXED " +
        JSON.stringify({
          ranks: RANKS.length,
          finalRankName: RANKS[RANKS.length - 1]!.name,
          target: def.target,
          desc: def.desc,
          doneAtMax1Based: achDone(def, { ...initialState(), rankIndex: 14 }),
          doneAt13: achDone(def, { ...initialState(), rankIndex: 13 }),
        }),
    );
  });

  it("v0.6.1 talent_18 已可达：target 18→13，24 点最多点 14 个节点", () => {
    const def = achById("talent_18")!;
    const max = maxTalentNodes();
    expect(TALENT_POINT_CAP).toBe(24);
    expect(max.n).toBe(14);
    expect(def.target).toBe(13);
    expect(def.desc).toContain("13");
    expect(achDone(def, { ...initialState(), talents: { unlocked: max.order.slice(0, 13), points: 0, rankGranted: -1, dailyGiftDate: "", overflow: 0 } })).toBe(true);
    console.log(
      "TALENT_FIXED " +
        JSON.stringify({
          cap: TALENT_POINT_CAP,
          maxNodes: max.n,
          order: max.order,
          target: def.target,
          desc: def.desc,
          doneAt13: achDone(def, { ...initialState(), talents: { unlocked: max.order.slice(0, 13), points: 0, rankGranted: -1, dailyGiftDate: "", overflow: 0 } }),
        }),
    );
  });

  it("v0.6.1 boss 成就用 bestSurviveStreak：转生/当前连胜清零不掉成就", () => {
    const s = { ...initialState(), surviveStreak: 0, bestSurviveStreak: 10 };
    expect(achDone(achById("boss_3")!, s)).toBe(true);
    expect(achDone(achById("boss_10")!, s)).toBe(true);
    // 旧档（v0.6.0 无 bestSurviveStreak）→ restore 补 0；main.ts 首个 150ms tick 会把当前连胜写进 bestSurviveStreak，
    // 因此迁移后当前连胜会被"兜底"为历史值（之后转生不再回退）。
    const restored = { ...initialState(), surviveStreak: 4 } as GameState;
    const afterFirstTick = { ...restored, bestSurviveStreak: Math.max(restored.bestSurviveStreak, restored.surviveStreak) };
    expect(achDone(achById("boss_3")!, afterFirstTick)).toBe(true);
    expect(achDone(achById("boss_10")!, afterFirstTick)).toBe(false);
    console.log("BOSS_FIXED " + JSON.stringify({ best10: s.bestSurviveStreak, legacyStreak: 4 }));
  });

  it("全系统拉满后 22/22 全成就可达，等级 Lv.6（+10% 挂机）", () => {
    const s = allReachable();
    const doneList = ACHIEVEMENTS.filter((a) => achDone(a, s)).map((a) => a.id);
    const undone = ACHIEVEMENTS.filter((a) => !achDone(a, s)).map((a) => ({ id: a.id, p: a.progress(s), t: a.target }));
    expect(doneList).toHaveLength(22);
    expect(undone).toEqual([]);
    expect(achPoints(s)).toBe(22);
    expect(achLevel(s)).toBe(6);
    // Lv.6 → 等级奖励 +2%×5 = +10% 挂机（在 idleMult 内）
    const noLvl = achEffects({ ...s, totalClicks: 0, bestIdleRate: 0, surviveStreak: 0, bestSurviveStreak: 0, rankIndex: 0 });
    console.log(
      "ALL22 " +
        JSON.stringify({
          done: doneList.length,
          level: achLevel(s),
          effects: achEffects(s),
          cats: achByCategory(s).map((c) => `${c.cat} ${c.done}/${c.total}`),
          levelBonusApplied: Number((achEffects(s).idleMult / Math.max(1e-9, 1)).toFixed(4)),
          compare: { noAchievementsIdleMult: noLvl.idleMult },
        }),
    );
  });

  it("成就「挂机 +X%」在离线结算里只兑现一半（teamPart 才吃 50% 份额）", () => {
    const A = seedBase({ totalClicks: 0 });
    const B = seedBase({ totalClicks: 1000 }); // Lv.2：等级奖励 +2% 挂机
    const online = effectOf(B).idleRate / effectOf(A).idleRate;
    const offA = offlineEarn(A, 12 * 3600, 0.95).earned;
    const offB = offlineEarn(B, 12 * 3600, 0.95).earned;
    const offlineRatio = offB / offA;
    console.log(
      "ACH_OFFLINE " +
        JSON.stringify({
          onlineIdleA: effectOf(A).idleRate,
          onlineIdleB: effectOf(B).idleRate,
          onlineRatio: Number(online.toFixed(4)),
          offline12hA: offA,
          offline12hB: offB,
          offlineRatio: Number(offlineRatio.toFixed(4)),
          note: "成就/等级给的挂机加成进入 effectOf 的 station，但离线基数用 stationIdleScaled（不含 achEffects）→ 差额落到 teamPart×0.5",
        }),
    );
    // 在线是 +2%，离线只拿到约 +1%（一半），说明"永久挂机加成"对离线党打折
    expect(online).toBeCloseTo(1.02, 3);
    expect(offlineRatio).toBeGreaterThan(1.0);
    expect(offlineRatio).toBeLessThan(online);
  });

  it("live seeded 变体预期值（v0.6.1，HUD 对照用）", () => {
    const A = seedBase({ totalClicks: 0 }); // codex 3 条 = Lv.1
    const B = seedBase({ totalClicks: 1000 }); // + click_1k = 4 条 = Lv.2
    const C = seedBase({ levels: { coffee: 100, phone: 80 }, bestIdleRate: 0 }); // 4 条 = Lv.2（idle_1k 自动）
    const D = seedBase({ rankIndex: 7 }); // + rank_7 = 4 条 = Lv.2
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
    const Cpre = { ...C, bestIdleRate: effectOf(C).idleRate };
    const Dpre = { ...D, bestIdleRate: effectOf(D).idleRate };
    console.log(
      "SEEDED " +
        JSON.stringify({
          A: rows.A,
          B: rows.B,
          C_after: { achPoints: achPoints(Cpre), achLevel: achLevel(Cpre), hud: eff(Cpre) },
          D_after: { achPoints: achPoints(Dpre), achLevel: achLevel(Dpre), hud: eff(Dpre) },
          note: "C/D 的 bestIdleRate 由 tick 自然记录 → idle_1k 自动完成；B/C/D 达到 4 条 → Lv.2 等级奖励 +2% 挂机",
        }),
    );
    // B/A 点击比 → 仍应 ≈1.0404（重复计入未修）而不是 1.02
    const clickUpgrade = 3200; // coffee Lv.100
    const ratio = clickPowerOf(B) / clickPowerOf(A);
    const single = (1 + clickUpgrade * 1.2 * 1.02) / (1 + clickUpgrade * 1.2);
    console.log(
      "DOUBLE_DIP " +
        JSON.stringify({
          clickA: clickPowerOf(A),
          clickB: clickPowerOf(B),
          ratioActual: Number(ratio.toFixed(6)),
          expectedIfSingle: Number(single.toFixed(6)),
          singleHud: formatMoyu(1 + clickUpgrade * 1.2 * 1.02),
          hudA: formatMoyu(clickPowerOf(A)),
          hudB: formatMoyu(clickPowerOf(B)),
        }),
    );
    // 等级奖励：B 新增的是点击成就，但空闲倍率也应因 Lv.2 上升 2%
    expect(achEffects(B).idleMult / achEffects(A).idleMult).toBeCloseTo(1.02, 6);
    console.log(
      "LEVEL_REWARD " +
        JSON.stringify({
          idleMultA: achEffects(A).idleMult,
          idleMultB: achEffects(B).idleMult,
          ratio: Number((achEffects(B).idleMult / achEffects(A).idleMult).toFixed(4)),
          idleHudA: formatMoyu(effectOf(A).idleRate),
          idleHudB: formatMoyu(effectOf(B).idleRate),
        }),
    );
  });
});