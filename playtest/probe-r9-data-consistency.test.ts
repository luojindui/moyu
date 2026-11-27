/**
 * R9 数据控探针：统计/一致性核对（只读 src，不改 src）
 * 目标：
 *  ① lifetimeEarned 与 totalEarned 的关系（转生前后）
 *  ② 离线收益是否计入两本账、罚款是否同步扣减
 *  ③ 哪些数据「记了没展示」/「想分析没记」/ 有哪些双口径不一致
 * 运行：npx vitest run --config playtest/vitest.r9-data.config.ts
 */
import { describe, expect, it } from "vitest";
import { initialState, gain, lose } from "../src/engine/state";
import { offlineEarn } from "../src/engine/offline";
import { settleReturn } from "../src/engine/resume";
import {
  doPrestige,
  canPrestige,
  prestigeGain,
  prestigeThreshold,
  prestigeMultiplier,
} from "../src/engine/prestige";
import { rankFor } from "../src/engine/titles";
import { finishPatrol, newEventState, onBossTap, onMemeTap, BOSS_GRACE_SECONDS } from "../src/engine/events";
import { buyUpgrade, clickPowerOf } from "../src/engine/actions";
import { costOf, effectOf } from "../src/engine/upgrades";
import { restore, type SaveAdapter } from "../src/engine/save";
import { rollDaily, claimDaily } from "../src/engine/daily";

const EVIDENCE = (name: string, data: unknown): void => console.log(`EVIDENCE ${name} ${JSON.stringify(data)}`);

const memAdapter = (blob: unknown): SaveAdapter => {
  let raw = JSON.stringify(blob);
  return {
    getItem: () => raw,
    setItem: (_k, v) => {
      raw = v;
    },
    removeItem: () => {
      raw = "";
    },
  };
};

describe("R9 数据一致性", () => {
  it("A. gain/离线/罚款：两本账同步；罚款会让段位倒退", () => {
    const s1 = gain(initialState(), 100);
    expect([s1.moyu, s1.totalEarned, s1.lifetimeEarned]).toEqual([100, 100, 100]);
    EVIDENCE("A1_gain", { moyu: s1.moyu, total: s1.totalEarned, lifetime: s1.lifetimeEarned });

    const off = offlineEarn(initialState(), 2 * 3600, 0.7);
    expect(off.applied).toBe(7200);
    expect(off.earned).toBeCloseTo(1008); // 0.2/s × 7200 × 0.7
    expect(off.state.totalEarned).toBeCloseTo(1008);
    expect(off.state.lifetimeEarned).toBeCloseTo(1008);
    EVIDENCE("A2_offline_2h_rate0.7", {
      applied: off.applied,
      earned: off.earned,
      total: off.state.totalEarned,
      lifetime: off.state.lifetimeEarned,
    });

    const capped = offlineEarn(initialState(), 24 * 3600, 1);
    expect(capped.applied).toBe(8 * 3600);
    EVIDENCE("A3_offline_24h_cap", { applied: capped.applied, earned: capped.earned });

    const f1 = lose(gain(initialState(), 1000), 300);
    expect([f1.lost, f1.state.totalEarned, f1.state.lifetimeEarned, f1.state.moyu]).toEqual([300, 700, 700, 700]);

    const poor = { ...initialState(), moyu: 5, totalEarned: 500, lifetimeEarned: 500 };
    const f2 = lose(poor, 50);
    expect([f2.lost, f2.state.totalEarned, f2.state.lifetimeEarned]).toEqual([5, 495, 495]);
    EVIDENCE("A4_lose_sync", { lost: f2.lost, total: f2.state.totalEarned, lifetime: f2.state.lifetimeEarned });

    // 段位按 lifetimeEarned：罚款 200 后 10000 → 9800，段位倒退
    const rankBefore = rankFor(10_000).current;
    const rankAfter = rankFor(9_800).current;
    EVIDENCE("A5_rank_regression", { before: rankBefore, after: rankAfter });
    expect(rankBefore).not.toBe(rankAfter);
  });

  it("B. 转生账本：total=本局，lifetime=Σ各局净收入，转生前后不变量成立", () => {
    const run1 = gain(initialState(), 1e8);
    expect(canPrestige(run1)).toBe(true);
    const p1 = doPrestige(run1)!;
    expect([p1.gained, p1.state.totalEarned, p1.state.lifetimeEarned, p1.state.prestige]).toEqual([3, 0, 1e8, 3]);
    EVIDENCE("B1_prestige1", {
      gained: p1.gained,
      total: p1.state.totalEarned,
      lifetime: p1.state.lifetimeEarned,
      points: p1.state.prestige,
      keepLevels: p1.state.levels,
    });

    // 门槛随倍率上涨：1e8 × (1 + 0.75×3) = 3.25e8
    expect(prestigeThreshold(p1.state)).toBeCloseTo(3.25e8);
    expect(prestigeMultiplier(3)).toBeCloseTo(3.25);
    const run2 = gain(p1.state, 3.25e8);
    expect(prestigeGain(run2)).toBe(3);
    const p2 = doPrestige(run2)!;
    expect([p2.state.totalEarned, p2.state.lifetimeEarned, p2.state.prestige]).toEqual([0, 4.25e8, 6]);
    // 往期各局合计 = lifetime - total（转生后恒为 0 差值）
    expect(p2.state.lifetimeEarned - p2.state.totalEarned).toBe(4.25e8);
    EVIDENCE("B2_prestige2", {
      threshold: prestigeThreshold(p1.state),
      total: p2.state.totalEarned,
      lifetime: p2.state.lifetimeEarned,
      points: p2.state.prestige,
      pastRuns: p2.state.lifetimeEarned - p2.state.totalEarned,
    });
    // 不变量
    expect(p2.state.lifetimeEarned).toBeGreaterThanOrEqual(p2.state.totalEarned);
  });

  it("C. 罚款后「毛收入 / 罚款额」不可重建（gain1000-lose300+gain200 ≡ gain900）", () => {
    let a = gain(initialState(), 1000);
    a = lose(a, 300).state;
    a = gain(a, 200);
    const b = gain(initialState(), 900);
    expect(a.moyu).toBe(900);
    expect(a.totalEarned).toBe(900);
    expect(a.lifetimeEarned).toBe(900);
    // 两段完全不同历史的终态完全一致 → 状态里没有罚款总额/毛收入字段
    expect([a.moyu, a.totalEarned, a.lifetimeEarned]).toEqual([b.moyu, b.totalEarned, b.lifetimeEarned]);
    EVIDENCE("C_gross_unrecoverable", {
      realGross: 1200,
      realFines: 300,
      stored: { moyu: a.moyu, total: a.totalEarned, lifetime: a.lifetimeEarned },
      sameAsNoFineRunOf900: true,
    });
  });

  it("D. 转生后事件连胜「复活」：prestige 不清 es.surviveStreak，下一次 finishPatrol 把旧连胜写回 state", () => {
    const run = gain(initialState(), 1e8);
    const p = doPrestige(run)!;
    expect(p.state.surviveStreak).toBe(0);
    // main.ts 的转生回调只重置 bossUntil/memeUntil/nextBossAt/... 未重置 es.surviveStreak
    const es = newEventState();
    es.surviveStreak = 5; // 转生前的连胜残留
    es.bossVariant = "hold";
    es.bossCaught = false;
    const f = finishPatrol(p.state, es);
    EVIDENCE("D_streak_resurrect", {
      afterPrestigeState: p.state.surviveStreak,
      esCarriedStreak: 5,
      afterNextPatrolState: f.state.surviveStreak,
      reward: f.reward,
    });
    expect(f.state.surviveStreak).toBe(6);
    expect(p.state.surviveStreak).toBe(0);
  });

  it("E. totalClicks 漏记事件点击：巡逻偷点 / 丢梗只加钱不 +totalClicks", () => {
    const s = gain(initialState(), 1000);
    const es = newEventState();
    es.bossUntil = 100;
    es.bossStartAt = 0;
    es.patrolCount = 5; // 过新手保护
    es.bossVariant = "hold";
    const steal = onBossTap(s, es, BOSS_GRACE_SECONDS + 0.1, 0);
    expect(steal.state.totalClicks).toBe(0); // 普通 doClick 会 +1，这里没有
    const memo = onMemeTap(steal.state, { ...newEventState(), memeUntil: 100 });
    expect(memo.state.totalClicks).toBe(0);
    EVIDENCE("E_clicks_undercount", {
      normalClicksAfterStealTap: steal.state.totalClicks,
      afterMemeTap: memo.state.totalClicks,
      clickLineThresholds: [100, 500, 3000, 8000, 20000],
    });
  });

  it("F. 读档不做跨字段钳制：余额 1e9 / 累计 0 可载入；lifetime 仅单向 max 兜底", () => {
    const now = Date.now();
    const tampered = {
      v: 1,
      moyu: 1e9,
      totalEarned: 0,
      levels: {},
      savedAt: now,
      createdAt: now,
      collected: { quotes: [], flavors: [] },
      daily: null,
      surviveStreak: 0,
      totalClicks: 0,
      visits: { date: "", count: 0 },
      lifetimeEarned: 0,
      prestige: 0,
    };
    const r = restore(memAdapter(tampered), now);
    expect(r.state!.moyu).toBe(1e9);
    expect(r.state!.totalEarned).toBe(0);
    expect(r.state!.lifetimeEarned).toBe(0);
    EVIDENCE("F_tampered", {
      moyu: r.state!.moyu,
      total: r.state!.totalEarned,
      lifetime: r.state!.lifetimeEarned,
      invariant_moyu_lte_total: r.state!.moyu <= r.state!.totalEarned,
    });

    // 旧档缺 lifetime → 迁移补成 max(lifetime, total)
    const legacy = { ...tampered, moyu: 10, totalEarned: 500, lifetimeEarned: undefined };
    delete (legacy as Record<string, unknown>).lifetimeEarned;
    const r2 = restore(memAdapter(legacy), now);
    EVIDENCE("F2_legacy_lifetime", { total: r2.state!.totalEarned, lifetime: r2.state!.lifetimeEarned });
    expect(r2.state!.lifetimeEarned).toBe(500);
  });

  it("G. 段位双口径：HUD 用 lifetimeEarned（hud.ts:22），转生 toast 用 totalEarned（main.ts:261）", () => {
    const run = gain(initialState(), 1e8);
    const p = doPrestige(run)!;
    const byLifetime = rankFor(p.state.lifetimeEarned).current; // HUD 口径
    const byRun = rankFor(p.state.totalEarned).current; // toast 口径
    EVIDENCE("G_rank_dual_source", {
      lifetime: p.state.lifetimeEarned,
      total: p.state.totalEarned,
      hudRank: byLifetime,
      toastRank: byRun,
    });
    expect(byLifetime).toBe("带薪摸鱼传说");
    expect(byRun).toBe("摸鱼实习生");
  });

  it("H. 离线结算路径同样进两本账；但结算明细 applied/earned 不落档（state 无字段）", () => {
    const base = gain(initialState(), 100);
    const res = settleReturn(base, 0, 3600 * 1000, 1);
    expect(res.applied).toBe(3600);
    const dTotal = res.state.totalEarned - base.totalEarned;
    const dLife = res.state.lifetimeEarned - base.lifetimeEarned;
    expect(dTotal).toBeCloseTo(720);
    expect(dLife).toBeCloseTo(720);
    // 4s < 阈值 5s 不结算
    expect(settleReturn(base, 0, 4000).applied).toBe(0);
    const keys = Object.keys(res.state).sort();
    EVIDENCE("H_offline_settle", {
      applied: res.applied,
      earned: res.earned,
      dTotal,
      dLife,
      stateKeys: keys,
      hasOfflineHistoryField: keys.some((k) => /offline|history|session/i.test(k)),
    });
  });

  it("I. 每日奖励进两本账；本局门槛可达性（prestige 动态门槛）", () => {
    const date = "2026-11-27";
    const rolled = rollDaily(date, () => 0.5, 3);
    const done = { ...rolled, goals: rolled.goals.map((g) => ({ ...g, progress: g.target, done: true })) };
    const s = { ...gain(initialState(), 1000), daily: done };
    const c = claimDaily(s, date);
    expect(c.claimedReward).not.toBeNull();
    expect(c.state.lifetimeEarned - s.lifetimeEarned).toBeCloseTo(c.claimedReward!);
    EVIDENCE("I_daily_claim", {
      reward: c.claimedReward,
      totalDelta: c.state.totalEarned - s.totalEarned,
      lifetimeDelta: c.state.lifetimeEarned - s.lifetimeEarned,
      streak: c.state.daily!.streak,
      claimsToday: c.state.daily!.claimsToday,
    });
  });

  it("J. 总投入可从 levels 推导（无需新增字段）；idleRate 可即时算出", () => {
    let s = gain(initialState(), 100_000);
    let spent = 0;
    for (let i = 0; i < 200; i++) {
      const lv = s.levels.phone ?? 0;
      const next = buyUpgrade(s, "phone");
      if (!next) break;
      spent += costOf("phone", lv);
      s = next;
    }
    EVIDENCE("J_spent_derivable", {
      boughtLevels: s.levels.phone,
      spent,
      balance: s.moyu,
      spentPlusBalance: spent + s.moyu,
      idleRate: effectOf(s).idleRate,
      clickPower: clickPowerOf(s),
    });
    expect(spent + s.moyu).toBeCloseTo(100_000);
    expect(s.totalEarned).toBe(100_000);
  });
});
