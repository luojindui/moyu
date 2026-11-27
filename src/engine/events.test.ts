import { describe, it, expect } from "vitest";
import {
  newEventState,
  scheduleEvents,
  onBossTap,
  finishPatrol,
  bossSurviveReward,
  onMemeTap,
  BOSS_INTERVAL_MIN,
  BOSS_INTERVAL_MAX,
  BOSS_DURATION,
  MEME_INTERVAL_MIN,
  MEME_DURATION,
  MEME_REWARD_CLICKS,
  BOSS_PENALTY_RATE,
  BOSS_PENALTY_MIN,
  BOSS_REWARD_IDLE_SECONDS,
  BOSS_VARIANTS,
  BOSS_TYPE_TARGET,
  BOSS_BLITZ_TARGET,
  BOSS_BLITZ_REWARD_MULT,
  BOSS_STEAL_CAP_IDLE_SECONDS,
  BOSS_REWARD_MIN,
  type EventState,
} from "./events";
import { initialState } from "./state";
import { effectOf } from "./upgrades";

/** 可复现的 LCG 随机源 */
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function seededRng3(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("随机事件调度", () => {
  it("首次调度落在设计区间且与巡逻窗口互斥", () => {
    const es = newEventState();
    const rng = seededRng(42);
    scheduleEvents(es, 0, rng);
    expect(es.nextBossAt).toBeGreaterThanOrEqual(BOSS_INTERVAL_MIN);
    expect(es.nextBossAt).toBeLessThanOrEqual(BOSS_INTERVAL_MAX);
    expect(es.nextMemeAt).toBeGreaterThanOrEqual(MEME_INTERVAL_MIN);
    // 梗窗口 [nextMemeAt, +5s) 与巡逻窗口 [nextBossAt, +8s) 不相交
    const overlap = es.nextMemeAt < es.nextBossAt + BOSS_DURATION && es.nextMemeAt + MEME_DURATION > es.nextBossAt;
    expect(overlap).toBe(false);
    // 纯函数：调度后未提前开窗
    expect(es.bossUntil).toBe(-1);
  });

  it("一小时模拟（只经 scheduleEvents 驱动）：互斥 + 频率符合设计", () => {
    const es = newEventState();
    const rng = seededRng(7);
    let bosses = 0;
    let memes = 0;
    let overlaps = 0;
    let wasBoss = false;
    let wasMeme = false;
    for (let t = 0; t <= 3600; t += 0.25) {
      scheduleEvents(es, t, rng);
      const bossActive = es.bossUntil > t;
      const memeActive = es.memeUntil > t;
      if (bossActive && !wasBoss) bosses++;
      if (memeActive && !wasMeme) memes++;
      if (bossActive && memeActive) overlaps++;
      wasBoss = bossActive;
      wasMeme = memeActive;
    }
    expect(overlaps).toBe(0);
    // 120±30s 间隔 → 1h 约 25-35 次巡逻
    expect(bosses).toBeGreaterThan(15);
    expect(bosses).toBeLessThan(50);
    // 60±15s 间隔 → 1h 约 50 次丢梗（巡逻错峰略减）
    expect(memes).toBeGreaterThan(30);
    expect(memes).toBeLessThan(100);
  });
});

describe("老板巡逻结算", () => {
  it("巡逻中手滑：扣 5%（下限 10），并标记被逮", () => {
    const s = initialState();
    s.moyu = 1000;
    const es: EventState = { nextBossAt: Infinity, bossUntil: 10, nextMemeAt: Infinity, memeUntil: -1, bossCaught: false, bossStartAt: 2, surviveStreak: 0, bossVariant: "hold", bossTaps: 0, bossPenaltyTotal: 0 };
    const r = onBossTap(s, es, 5);
    // 偷点语义：收入 +1（基础点击力），罚款 raw=max(10,50)、cap=10 → lost=10 → 净 -9
    expect(r.income).toBe(1);
    expect(r.state.moyu).toBe(991);
    expect(r.caught).toBe(true);
    expect(r.state.levels).toBe(s.levels); // 升级不受影响
  });

  it("反应宽限期（巡逻开启 0.8s 内）点击免罚免逮", () => {
    const s = initialState();
    s.moyu = 1000;
    const es: EventState = { nextBossAt: Infinity, bossUntil: 10, nextMemeAt: Infinity, memeUntil: -1, bossCaught: false, bossStartAt: 2, surviveStreak: 0, bossVariant: "hold", bossTaps: 0, bossPenaltyTotal: 0 };
    // 巡逻 2s 开启，2.5s 点击 → 宽限内（0.5s < 0.8s）
    const r = onBossTap(s, es, 2.5);
    expect(r.caught).toBe(false);
    expect(r.income).toBe(0); // R5：宽限内不再给收入（消除零风险白嫖）
    expect(r.state.moyu).toBe(1000); // 无罚款
    expect(es.bossCaught).toBe(false);
  });

  it("罚款封顶：min(raw, max(10, 10×idleRate))，后期不洗劫", () => {
    const s = initialState();
    s.moyu = 800_000;
    s.levels["retire" as string] = 1; // 700/s + 底薪 0.2
    const es: EventState = { nextBossAt: Infinity, bossUntil: 10, nextMemeAt: Infinity, memeUntil: -1, bossCaught: false, bossStartAt: 2, surviveStreak: 0, bossVariant: "hold", bossTaps: 0, bossPenaltyTotal: 0 };
    const r = onBossTap(s, es, 5);
    // 每击 = max(10, 0.6×700.2)=420.12；整段封顶 = max(10, 10×700.2)=7002
    expect(r.lost).toBeCloseTo(420.12, 1);
  });

  it("小额时按下限扣 10", () => {
    const s = initialState();
    s.moyu = 50;
    const es: EventState = { nextBossAt: Infinity, bossUntil: 10, nextMemeAt: Infinity, memeUntil: -1, bossCaught: false, bossStartAt: 2, surviveStreak: 0, bossVariant: "hold", bossTaps: 0, bossPenaltyTotal: 0 };
    const r = onBossTap(s, es, 5);
    // 收入 +1，罚款 10 → 41
    expect(r.state.moyu).toBe(50 + 1 - BOSS_PENALTY_MIN);
  });

  it("R5：同一巡逻内连续偷点逐次加罚（不再是罚一次就免费）", () => {
    const s = initialState();
    s.moyu = 100000;
    s.levels["phone" as string] = 50; // idleRate ≈ 200 → 每击罚 600、整段封顶 4800
    const es: EventState = { nextBossAt: Infinity, bossUntil: 10, nextMemeAt: Infinity, memeUntil: -1, bossCaught: false, bossStartAt: 2, surviveStreak: 0, bossVariant: "hold", bossTaps: 0, bossPenaltyTotal: 0 };
    const first = onBossTap(s, es, 5);
    expect(first.caught).toBe(true);
    const second = onBossTap(first.state, es, 5.1);
    expect(second.caught).toBe(true); // 仍然被抓/被罚（逐次加罚，直到封顶）
    expect(second.lost).toBeGreaterThan(0);
    expect(second.state.moyu).toBe(first.state.moyu + second.income - second.lost);
  });

  it("安然度过：奖励 = max(50, 5 × idleRate)（克制，不喧宾夺主）", () => {
    const s = initialState();
    s.levels["phone" as string] = 5; // 偏移15 → 10.2/秒
    const reward = bossSurviveReward(s);
    expect(reward).toBeCloseTo(50, 1); // max(50, 4×10.2=40.8) → 50 下限
    expect(reward).toBeGreaterThanOrEqual(BOSS_REWARD_MIN);
  });

  it("被逮过的巡逻不给奖励", () => {
    const s = initialState();
    s.levels["phone" as string] = 5;
    const caughtEs: EventState = { nextBossAt: Infinity, bossUntil: -1, nextMemeAt: Infinity, memeUntil: -1, bossCaught: true, bossStartAt: 2, surviveStreak: 0, bossVariant: "hold", bossTaps: 0, bossPenaltyTotal: 0 };
    expect(bossSurviveReward(s, caughtEs)).toBe(0);
  });
});

describe("同事丢梗", () => {
  it("有效期内点击：奖励 5 × 点击力", () => {
    const s = initialState();
    s.levels["coffee" as string] = 2; // 点击力 1+2=3
    const es: EventState = { nextBossAt: Infinity, bossUntil: -1, nextMemeAt: Infinity, memeUntil: 10, bossCaught: false, bossStartAt: 2, surviveStreak: 0, bossVariant: "hold", bossTaps: 0, bossPenaltyTotal: 0 };
    const r = onMemeTap(s, es);
    expect(r.earned).toBe(MEME_REWARD_CLICKS * 3);
    expect(r.state.moyu).toBe(15);
  });

  it("过期点击无效", () => {
    const s = initialState();
    const es: EventState = { nextBossAt: Infinity, bossUntil: -1, nextMemeAt: Infinity, memeUntil: -1, bossCaught: false, bossStartAt: 2, surviveStreak: 0, bossVariant: "hold", bossTaps: 0, bossPenaltyTotal: 0 };
    const r = onMemeTap(s, es);
    expect(r.earned).toBe(0);
  });

  it("巡逻期间丢梗点击按被抓处理（boss 优先）", () => {
    const s = initialState();
    s.moyu = 1000;
    const es: EventState = { nextBossAt: Infinity, bossUntil: 10, nextMemeAt: Infinity, memeUntil: 10, bossCaught: false, bossStartAt: 2, surviveStreak: 0, bossVariant: "hold", bossTaps: 0, bossPenaltyTotal: 0 };
    const caught = onBossTap(s, es, 5);
    expect(caught.caught).toBe(true);
    // 偷点收入 +1，罚款 10 → 991
    expect(caught.state.moyu).toBe(991);
  });

  it("常数合理：巡逻 8s、梗 5s、惩罚率 5%、安然奖 5 秒挂机", () => {
    expect(BOSS_DURATION).toBe(8);
    expect(MEME_DURATION).toBe(5);
    expect(BOSS_PENALTY_RATE).toBeCloseTo(0.05);
    expect(MEME_REWARD_CLICKS).toBe(5);
    expect(BOSS_REWARD_IDLE_SECONDS).toBe(4); // 事件经济红线：4×挂机秒
  });

  it("偷点（challenger #1）：巡逻期点击照常获得点击收入，同时承担罚款", () => {
    const s = initialState();
    s.moyu = 5000;
    s.levels["coffee" as string] = 4; // 点击力 1+4=5
    const es: EventState = { ...newEventState(), bossUntil: 10, bossStartAt: 0 };
    const r = onBossTap(s, es, 5); // 过宽限，被抓
    // 每击罚款 max(10, 0.6×0.2)=10；收入 +5 → 净 -5
    expect(r.income).toBe(5);
    expect(r.lost).toBe(10);
    expect(r.state.moyu).toBe(5000 + 5 - 10);
    // 罚款同时扣回累计值（防零余额刷段位）：5 - 10 → 0
    expect(r.state.totalEarned).toBe(0);
  });

  it("偷点在高点击力时正期望（cps 越高越值得赌）", () => {
    const s = initialState();
    s.moyu = 5000;
    s.levels["chair" as string] = 2; // 点击力 1+10=11
    const es: EventState = { ...newEventState(), bossUntil: 10, bossStartAt: 0 };
    const r = onBossTap(s, es, 5);
    expect(r.income).toBe(11);
    expect(r.lost).toBe(10); // cap = 10
    expect(r.state.moyu).toBe(5000 + 11 - 10); // 净 +1，赌得划算
  });

  it("宽限期内点击：无收入、无罚款、不算被抓（R5 消除白嫖）", () => {
    const s = initialState();
    s.moyu = 5000;
    s.levels["coffee" as string] = 4;
    const es: EventState = { ...newEventState(), bossUntil: 10, bossStartAt: 5 };
    const r = onBossTap(s, es, 5.3); // 宽限内
    expect(r.income).toBe(0);
    expect(r.lost).toBe(0);
    expect(r.caught).toBe(false);
    expect(es.bossCaught).toBe(false);
    expect(r.state.moyu).toBe(5000);
  });

  it("finishPatrol：安然结束发奖并推进连胜，被抓则清零不给奖", () => {
    const s = initialState();
    s.levels["phone" as string] = 5; // 10.2/s
    const es: EventState = { ...newEventState(), bossUntil: 10, bossStartAt: 0 };
    const r1 = finishPatrol(s, es);
    expect(r1.reward).toBeCloseTo(50, 1); // max(50, 4×10.2) = 50
    expect(es.surviveStreak).toBe(1);
    const r2 = finishPatrol(r1.state, es);
    expect(r2.reward).toBeCloseTo(50 * 1.1, 0); // streak 1 → ×1.1
    expect(es.surviveStreak).toBe(2);
    // 被抓后
    const es2: EventState = { ...newEventState(), bossUntil: 10, bossStartAt: 0, surviveStreak: 5 };
    onBossTap({ ...s, moyu: 1e6 }, es2, 5);
    const r3 = finishPatrol(s, es2);
    expect(r3.reward).toBe(0);
    expect(es2.surviveStreak).toBe(0);
  });

  it("安然连胜：奖励 ×(1+0.1N) 封顶 ×1.5，被抓清零", () => {
    const s = initialState();
    s.levels["retire" as string] = 1; // 700.2/s → 基础奖励 max(50, 4×700.2)=2800.8
    const base = bossSurviveReward(s, newEventState());
    expect(base).toBeCloseTo(2800.8, 1);
    // 连续安然 3 次后（streak=3）→ ×1.3
    const es3: EventState = { ...newEventState(), surviveStreak: 3, bossVariant: "hold", bossTaps: 0, bossPenaltyTotal: 0 };
    expect(bossSurviveReward(s, es3)).toBeCloseTo(2800.8 * 1.3, 0);
    // 封顶 ×1.5（streak 10 与 50 相同）
    expect(bossSurviveReward(s, { ...newEventState(), surviveStreak: 10 })).toBeCloseTo(2800.8 * 1.5, 0);
    expect(bossSurviveReward(s, { ...newEventState(), surviveStreak: 50 })).toBeCloseTo(2800.8 * 1.5, 0);
    // 被抓 → 清零
    const es = newEventState();
    onBossTap({ ...s, moyu: 100000 }, es, 5);
    expect(es.surviveStreak).toBe(0);
  });
});

describe("巡逻变体（variety #1：拆掉同 pattern 重复）", () => {
  it("三种变体：hold 忍住 / type 假装工作 / blitz 连点冲刺", () => {
    expect(BOSS_VARIANTS).toEqual(["hold", "type", "blitz"]);
    // type：8s 内点满 5 次达标
    expect(BOSS_TYPE_TARGET).toBe(5);
    // blitz：8s 内点满 12 次，奖励 ×1.5
    expect(BOSS_BLITZ_TARGET).toBe(20); // R5 差异化：需 ≥2.5cps
    expect(BOSS_BLITZ_REWARD_MULT).toBe(1.5);
  });

  it("巡逻开启时按权重抽变体（hold 40% / type 35% / blitz 25%）", () => {
    const counts = { hold: 0, type: 0, blitz: 0 };
    const rng = seededRng3(9);
    for (let i = 0; i < 4000; i++) {
      const es = newEventState();
      // 直接把巡逻排到当前时刻
      es.nextBossAt = 0;
      es.nextMemeAt = Infinity;
      scheduleEvents(es, 0, rng);
      counts[es.bossVariant] += 1;
      if (counts.hold + counts.type + counts.blitz >= 4000) break;
    }
    expect(counts.hold / 4000).toBeGreaterThan(0.3);
    expect(counts.hold / 4000).toBeLessThan(0.5);
    expect(counts.type / 4000).toBeGreaterThan(0.25);
    expect(counts.blitz / 4000).toBeGreaterThan(0.15);
  });

  it("type 变体：点击计数、不罚、达标给奖励", () => {
    const s = initialState();
    s.levels["phone" as string] = 5; // 10.2/s
    const es: EventState = { ...newEventState(), bossUntil: 10, bossStartAt: 0, bossVariant: "type" };
    let state = s;
    for (let i = 0; i < BOSS_TYPE_TARGET; i++) {
      const r = onBossTap(state, es, 1 + i * 0.1);
      state = r.state;
      expect(r.caught).toBe(false); // type 变体点击不罚
      expect(r.income).toBeGreaterThan(0); // 但照给收入
    }
    const fin = finishPatrol(state, es);
    expect(fin.reward).toBeGreaterThan(0); // 达标有奖
  });

  it("type 变体：未达标无奖励（也不罚）", () => {
    const s = initialState();
    const es: EventState = { ...newEventState(), bossUntil: 10, bossStartAt: 0, bossVariant: "type" };
    let state = s;
    for (let i = 0; i < BOSS_TYPE_TARGET - 1; i++) state = onBossTap(state, es, 1 + i * 0.1).state;
    const fin = finishPatrol(state, es);
    expect(fin.reward).toBe(0);
  });

  it("blitz 变体：达标奖励 ×1.5，未达标为 0", () => {
    const s = initialState();
    s.levels["phone" as string] = 5;
    const base = bossSurviveReward(s, newEventState()); // 51
    const es: EventState = { ...newEventState(), bossUntil: 10, bossStartAt: 0, bossVariant: "blitz" };
    let state = s;
    for (let i = 0; i < BOSS_BLITZ_TARGET; i++) state = onBossTap(state, es, 1 + i * 0.05).state;
    expect(finishPatrol(state, es).reward).toBeCloseTo(base * BOSS_BLITZ_REWARD_MULT, 0);
    // 未达标
    const es2: EventState = { ...newEventState(), bossUntil: 10, bossStartAt: 0, bossVariant: "blitz" };
    let s2 = s;
    for (let i = 0; i < 3; i++) s2 = onBossTap(s2, es2, 1 + i * 0.05).state;
    expect(finishPatrol(s2, es2).reward).toBe(0);
  });

  it("hold 变体维持偷点语义（有收入 + 罚款风险）", () => {
    const s = initialState();
    s.moyu = 1000;
    const es: EventState = { ...newEventState(), bossUntil: 10, bossStartAt: 0, bossVariant: "hold" };
    const r = onBossTap(s, es, 5);
    expect(r.caught).toBe(true);
    expect(r.income).toBe(1);
  });
});

describe("R5 机制修正（challenger 验收 P0/P1/P3）", () => {
  it("宽限期点击不再白嫖收入（P3）：无收入、无罚款、不算被抓", () => {
    const s = initialState();
    s.moyu = 1000;
    const es: EventState = { ...newEventState(), bossUntil: 10, bossStartAt: 5 };
    const r = onBossTap(s, es, 5.3);
    expect(r.income).toBe(0); // 修：不再零风险拿钱
    expect(r.lost).toBe(0);
    expect(r.caught).toBe(false);
    expect(r.state.moyu).toBe(1000);
  });

  it("罚款按偷点次数递增且不随余额（P0/P1）：无关余额、每点一次加罚、整段封顶", () => {
    const s = { ...initialState(), moyu: 1_000_000 };
    s.levels["phone" as string] = 50; // idleRate = 1×50×2^2=200 + 0.2
    const idleRate = effectOf(s).idleRate;
    const es: EventState = { ...newEventState(), bossUntil: 10, bossStartAt: 0 };
    const r1 = onBossTap(s, es, 1); // 首次越宽限
    // 每击罚 0.5×idleRate（早期按下限 10）
    expect(r1.lost).toBeCloseTo(Math.max(10, 0.6 * idleRate), 5);
    const r2 = onBossTap(r1.state, es, 1.1); // 第二次
    expect(r2.lost).toBeCloseTo(Math.max(10, 0.6 * idleRate), 5);
    // 连续点到整段封顶后不再增罚
    let st = r2.state;
    let total = 0;
    for (let i = 0; i < 20; i++) {
      const r = onBossTap(st, es, 2 + i * 0.1);
      st = r.state;
      total += r.lost;
    }
    const cap = Math.max(10, BOSS_STEAL_CAP_IDLE_SECONDS * idleRate);
    expect(total).toBeLessThanOrEqual(cap + 1e-6);
    expect(cap).toBeCloseTo(10 * idleRate, 5);
  });

  it("余额很少时罚款不超过余额（不产生负值）", () => {
    const s = initialState();
    s.moyu = 5;
    const es: EventState = { ...newEventState(), bossUntil: 10, bossStartAt: 0 };
    const r = onBossTap(s, es, 1);
    expect(r.state.moyu).toBeGreaterThanOrEqual(0);
    expect(r.lost).toBeLessThanOrEqual(5 + r.income);
  });

  it("高点击力连续偷点不再稳定占优（≥3cps 应回到忍侧）", () => {
    // 模拟：idleRate 大、点击力小的挂机型（点击收入 < 每击罚款）
    const s = initialState();
    s.moyu = 100000;
    s.levels["retire" as string] = 2; // idleRate ≈ 1400
    s.levels["coffee" as string] = 3; // 点击力 4
    const es: EventState = { ...newEventState(), bossUntil: 8, bossStartAt: 0 };
    let st = s;
    let income = 0;
    let penalty = 0;
    for (let t = 0.1; t < 8; t += 0.125) {
      // 8cps
      const r = onBossTap(st, es, 1 + t);
      st = r.state;
      income += r.income;
      penalty += r.lost;
    }
    // 修后：罚款封顶 24×idleRate 应压过 8s 点击收入
    expect(penalty).toBeGreaterThan(income);
  });

  it("连胜入档（P4）：GameState 持 surviveStreak，finishPatrol 推进并持久化", () => {
    const s = initialState();
    expect(s.surviveStreak).toBe(0);
    const es: EventState = { ...newEventState(), bossUntil: 10, bossStartAt: 0 };
    const r = finishPatrol(s, es);
    expect(r.state.surviveStreak).toBe(1);
    expect(es.surviveStreak).toBe(1);
  });
});
