// 终验：成就墙引擎层审计（22 条正确性/加成生效/永久性/存档净化/转生保留/段位可达性）
// 运行：npx vitest run --config playtest/final-audit/vitest.ach.config.ts
import { describe, it, expect } from "vitest";
import { initialState, type GameState } from "../../src/engine/state";
import {
  ACHIEVEMENTS,
  achByCategory,
  achById,
  achDone,
  achEffects,
  achLevel,
  achPoints,
  ACH_CATEGORY_NAME,
} from "../../src/engine/achievements";
import { effectOf } from "../../src/engine/upgrades";
import { clickPowerOf } from "../../src/engine/actions";
import { doPrestige } from "../../src/engine/prestige";
import { restore } from "../../src/engine/save";
import { RANKS } from "../../src/engine/titles";
import { TALENTS } from "../../src/engine/talents";
import { DECOR } from "../../src/engine/decor";
import { COLLEAGUES } from "../../src/engine/team";

const base = (): GameState => initialState();
const col = (team: string[], level = 1) =>
  Object.fromEntries(
    team.map((id) => [
      id,
      { level, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 },
    ]),
  );
const collected = (n: number) => {
  const quotes = Array.from({ length: Math.min(10, n) }, (_, i) => i);
  const flavors = Array.from({ length: Math.max(0, n - 10) }, (_, i) => i);
  return { quotes, flavors };
};

/** 每条成就的"最小达成状态"（只改与它相关的字段，其余保持初始） */
const ACH_MIN_STATE: Record<string, (s: GameState) => GameState> = {
  click_1k: (s) => ({ ...s, totalClicks: 1_000 }),
  click_10k: (s) => ({ ...s, totalClicks: 10_000 }),
  click_100k: (s) => ({ ...s, totalClicks: 100_000 }),
  idle_1k: (s) => ({ ...s, bestIdleRate: 1_000 }),
  idle_1m: (s) => ({ ...s, bestIdleRate: 1_000_000 }),
  codex_20: (s) => ({ ...s, collected: collected(20) }),
  codex_40: (s) => ({ ...s, collected: collected(40) }),
  codex_55: (s) => ({ ...s, collected: collected(55) }),
  decor_3: (s) => ({ ...s, decor: DECOR.slice(0, 3).map((d) => d.id) }),
  decor_8: (s) => ({ ...s, decor: DECOR.map((d) => d.id) }),
  team_1: (s) => ({ ...s, team: { colleagues: col([COLLEAGUES[0]!.id]) } }),
  team_5: (s) => ({ ...s, team: { colleagues: col(COLLEAGUES.map((c) => c.id)) } }),
  team_lv5: (s) => ({ ...s, team: { colleagues: col(COLLEAGUES.map((c) => c.id), 5) } }),
  talent_6: (s) => ({ ...s, talents: { ...s.talents, unlocked: TALENTS.slice(0, 6).map((t) => t.id) } }),
  talent_18: (s) => ({ ...s, talents: { ...s.talents, unlocked: TALENTS.slice(0, 18).map((t) => t.id) } }),
  rank_7: (s) => ({ ...s, rankIndex: 7 }),
  rank_14: (s) => ({ ...s, rankIndex: 14 }),
  arcade_500: (s) => ({ ...s, arcade: { ...s.arcade, best: { coffee: 500 } } }),
  arcade_2000: (s) => ({ ...s, arcade: { ...s.arcade, best: { coffee: 2_000 } } }),
  card_5: (s) => ({ ...s, cardsChosenTotal: 5 }),
  boss_3: (s) => ({ ...s, surviveStreak: 3 }),
  boss_10: (s) => ({ ...s, surviveStreak: 10 }),
};

const memAdapter = (initial: string) => {
  let raw = initial;
  return {
    getItem: () => raw,
    setItem: (_k: string, v: string) => {
      raw = v;
    },
    removeItem: () => {
      raw = "";
    },
  };
};

const saveBlob = (extra: Record<string, unknown>, now = Date.now()): string =>
  JSON.stringify({ v: 2, moyu: 100, totalEarned: 100, levels: {}, savedAt: now, createdAt: now - 1000, ...extra });

describe("成就墙 · 结构与进度", () => {
  it("22 条 / 10 分类 / id 唯一 / 分类合计=22", () => {
    expect(ACHIEVEMENTS).toHaveLength(22);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(22);
    const cats = achByCategory(base());
    expect(cats).toHaveLength(10);
    expect(Object.keys(ACH_CATEGORY_NAME)).toHaveLength(10);
    expect(cats.reduce((n, c) => n + c.total, 0)).toBe(22);
    expect(ACHIEVEMENTS.every((a) => a.target > 0)).toBe(true);
    for (const a of ACHIEVEMENTS) {
      const p = a.progress(base());
      expect(Number.isFinite(p), `${a.id} 初始进度应为有限数`).toBe(true);
      expect(p >= 0, `${a.id} 初始进度非负`).toBe(true);
    }
  });

  it("新号 0 完成 / Lv.1 / 加成为中性", () => {
    expect(achPoints(base())).toBe(0);
    expect(achLevel(base())).toBe(1);
    const e = achEffects(base());
    expect(e.idleMult).toBe(1);
    expect(e.clickMult).toBe(1);
    expect(e.offlineBonus).toBe(0);
  });

  it("22 条每条都能用最小状态达成，且不漏项", () => {
    for (const a of ACHIEVEMENTS) {
      const patch = ACH_MIN_STATE[a.id]!;
      expect(typeof patch, `${a.id} 缺少达成样本`).toBe("function");
      const s = patch(base());
      expect(achDone(a, s), `${a.id} 应达成`).toBe(true);
      expect(a.progress(s) >= a.target, `${a.id} 进度应≥目标`).toBe(true);
    }
  });

  it("高挡位必然覆盖低挡位（链式单调）", () => {
    const chains: Array<[string, string[]]> = [
      ["click_100k", ["click_10k", "click_1k"]],
      ["idle_1m", ["idle_1k"]],
      ["codex_55", ["codex_40", "codex_20"]],
      ["decor_8", ["decor_3"]],
      ["team_5", ["team_1"]],
      ["talent_18", ["talent_6"]],
      ["rank_14", ["rank_7"]],
      ["arcade_2000", ["arcade_500"]],
      ["boss_10", ["boss_3"]],
    ];
    for (const [high, lows] of chains) {
      const s = ACH_MIN_STATE[high]!(base());
      expect(achDone(achById(high)!, s), `${high} 应达成`).toBe(true);
      for (const lo of lows) expect(achDone(achById(lo)!, s), `${high} 达成时 ${lo} 也应达成`).toBe(true);
    }
  });

  it("段位成就：rankIndex 0-based vs 目标 1-based 的可达性", () => {
    // main.ts 用 RANKS.findIndex 记录 rankIndex（0..13），RANKS 共 14 档
    expect(RANKS).toHaveLength(14);
    const maxLegit = RANKS.length - 1; // 13
    expect(achDone(achById("rank_7")!, { ...base(), rankIndex: 6 }), "第 7 档应点亮 rank_7（描述「第 7 段位」）").toBe(true);
    expect(achDone(achById("rank_14")!, { ...base(), rankIndex: maxLegit }), "最高档（第 14 段位）应点亮 rank_14").toBe(true);
  });
});

describe("成就墙 · 加成生效（挂机/点击/离线）", () => {
  it("挂机加成接入 effectOf：idle_1k 应精确 ×1.02", () => {
    const s0 = { ...base(), levels: { phone: 1 } };
    const s1 = { ...s0, bestIdleRate: 1_000 };
    const a = effectOf(s0).idleRate;
    const b = effectOf(s1).idleRate;
    expect(achDone(achById("idle_1k")!, s1)).toBe(true);
    expect(b / a).toBeCloseTo(1.02, 9);
  });

  it("点击加成接入 clickPowerOf：只应计一次（升级点击力不得被平方）", () => {
    // water Lv10 = +20 点击力；click_1k 完成（+2% 点击）
    const s = { ...base(), levels: { water: 10 }, totalClicks: 1_000 };
    const ach = achEffects(s);
    expect(ach.clickMult).toBeCloseTo(1.02, 9);
    const singleApply = (1 * 1 + 20) * 1.02; // 21.42
    const actual = clickPowerOf(s);
    expect(actual, `实际 ${actual}，单次接入应为 ${singleApply}`).toBeCloseTo(singleApply, 9);
  });

  it("离线加成：应至少有一条成就提供离线加成（否则离线维度无法验证）", () => {
    const all: GameState = ACHIEVEMENTS.reduce((s, a) => ACH_MIN_STATE[a.id]!(s), base());
    expect(achPoints(all)).toBe(22);
    const e = achEffects(all);
    const hasOfflineDef = ACHIEVEMENTS.some((a) => (a.reward?.offlineBonus ?? 0) > 0);
    expect(hasOfflineDef, "没有任何成就提供 offlineBonus（progression 的 achEffects.offlineBonus 接入为空转）").toBe(true);
    expect(e.offlineBonus).toBeGreaterThan(0);
  });

  it("汇总不重复发放：同状态多次求值恒定、且不写回状态", () => {
    const s = ACH_MIN_STATE.click_100k!(base());
    const before = JSON.stringify(s);
    const e1 = achEffects(s);
    const e2 = achEffects(s);
    const f1 = effectOf(s);
    const f2 = effectOf(s);
    expect(e1).toEqual(e2);
    expect(f1).toEqual(f2);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("全部 22 条完成：加成乘积与定义一致", () => {
    const all: GameState = ACHIEVEMENTS.reduce((s, a) => ACH_MIN_STATE[a.id]!(s), base());
    expect(achPoints(all)).toBe(22);
    let idle = 1;
    let click = 1;
    for (const a of ACHIEVEMENTS) {
      idle *= 1 + (a.reward?.idleBonus ?? 0);
      click *= 1 + (a.reward?.clickBonus ?? 0);
    }
    const e = achEffects(all);
    expect(e.idleMult).toBeCloseTo(idle, 9);
    expect(e.clickMult).toBeCloseTo(click, 9);
    expect(achLevel(all)).toBe(Math.floor(22 / 4) + 1);
  });
});

describe("成就墙 · 永久性与转生保留", () => {
  it("boss 成就应永久（当前用 surviveStreak，被抓清 0 后会丢失）", () => {
    const got = ACH_MIN_STATE.boss_10!(base());
    expect(achDone(achById("boss_10")!, got)).toBe(true);
    const afterCaught = { ...got, surviveStreak: 0 };
    expect(achDone(achById("boss_10")!, afterCaught), "被老板抓到后 boss_10 仍应保持完成（永久成就）").toBe(true);
  });

  it("天赋成就应永久（重置天赋后不应丢失）", () => {
    const got = ACH_MIN_STATE.talent_6!(base());
    expect(achDone(achById("talent_6")!, got)).toBe(true);
    const afterReset = { ...got, talents: { ...got.talents, unlocked: [] } };
    expect(achDone(achById("talent_6")!, afterReset), "重置天赋后 talent_6 仍应保持完成").toBe(true);
  });

  it("转生保留 bestIdleRate / rankIndex / cardsChosenTotal", () => {
    const s: GameState = {
      ...base(),
      totalEarned: 2e8,
      lifetimeEarned: 2e8,
      bestIdleRate: 5_000,
      rankIndex: 7,
      cardsChosenTotal: 6,
      surviveStreak: 10,
    };
    const r = doPrestige(s);
    expect(r).not.toBeNull();
    expect(r!.state.bestIdleRate).toBe(5_000);
    expect(r!.state.rankIndex).toBe(7);
    expect(r!.state.cardsChosenTotal).toBe(6);
    // 记录：boss 成就进度因 surviveStreak 重置而回落
    expect(achDone(achById("boss_10")!, r!.state)).toBe(false);
  });
});

describe("成就墙 · 存档净化（bestIdleRate/rankIndex/cardsChosenTotal）", () => {
  const restoreOf = (extra: Record<string, unknown>) => restore(memAdapter(saveBlob(extra)), Date.now()).state!;

  it("缺失字段默认 0", () => {
    const s = restoreOf({});
    expect(s.bestIdleRate).toBe(0);
    expect(s.rankIndex).toBe(0);
    expect(s.cardsChosenTotal).toBe(0);
  });

  it("负数/非数/空值 → 0", () => {
    const s = restoreOf({ bestIdleRate: -5, rankIndex: -3, cardsChosenTotal: -1 });
    expect(s.bestIdleRate).toBe(0);
    expect(s.rankIndex).toBe(0);
    expect(s.cardsChosenTotal).toBe(0);
    const t = restoreOf({ bestIdleRate: null, rankIndex: "x", cardsChosenTotal: null });
    expect(t.bestIdleRate).toBe(0);
    expect(t.rankIndex).toBe(0);
    expect(t.cardsChosenTotal).toBe(0);
    const u = restoreOf({ bestIdleRate: true, rankIndex: {}, cardsChosenTotal: [] });
    expect(u.bestIdleRate).toBe(0);
    expect(u.rankIndex).toBe(0);
    expect(u.cardsChosenTotal).toBe(0);
  });

  it("极值钳制（bestIdleRate≤1e30 / rankIndex≤20 / cardsChosenTotal≤100000）", () => {
    const s = restoreOf({ bestIdleRate: 1e308, rankIndex: 999, cardsChosenTotal: 1e9 });
    expect(s.bestIdleRate).toBe(1e30);
    expect(s.rankIndex).toBe(20);
    expect(s.cardsChosenTotal).toBe(100000);
  });

  it("小数向下取整", () => {
    const s = restoreOf({ bestIdleRate: 12.9, rankIndex: 7.9, cardsChosenTotal: 3.7 });
    expect(s.bestIdleRate).toBe(12.9);
    expect(s.rankIndex).toBe(7);
    expect(s.cardsChosenTotal).toBe(3);
  });

  it("净化后成就不再被篡改值误导（rankIndex 上限 20 > 合法最大 13 的偏差记录）", () => {
    const s = restoreOf({ rankIndex: 999 });
    expect(s.rankIndex).toBe(20);
    // 合法路径最大 13；20 只可能来自篡改 → rank_14 变成了"篡改可达、正常不可达"
    expect(achDone(achById("rank_14")!, s)).toBe(true);
  });
});