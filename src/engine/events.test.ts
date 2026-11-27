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
  BOSS_REWARD_MIN,
  type EventState,
} from "./events";
import { initialState } from "./state";

/** 可复现的 LCG 随机源 */
function seededRng(seed: number): () => number {
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
    const es: EventState = { nextBossAt: Infinity, bossUntil: 10, nextMemeAt: Infinity, memeUntil: -1, bossCaught: false, bossStartAt: 2, surviveStreak: 0 };
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
    const es: EventState = { nextBossAt: Infinity, bossUntil: 10, nextMemeAt: Infinity, memeUntil: -1, bossCaught: false, bossStartAt: 2, surviveStreak: 0 };
    // 巡逻 2s 开启，2.5s 点击 → 宽限内（0.5s < 0.8s）
    const r = onBossTap(s, es, 2.5);
    expect(r.caught).toBe(false);
    expect(r.income).toBe(1); // 收入照给
    expect(r.state.moyu).toBe(1001); // 无罚款
    expect(es.bossCaught).toBe(false);
  });

  it("罚款封顶：min(raw, max(10, 10×idleRate))，后期不洗劫", () => {
    const s = initialState();
    s.moyu = 800_000;
    s.levels["retire" as string] = 1; // 700/s + 底薪 0.2
    const es: EventState = { nextBossAt: Infinity, bossUntil: 10, nextMemeAt: Infinity, memeUntil: -1, bossCaught: false, bossStartAt: 2, surviveStreak: 0 };
    const r = onBossTap(s, es, 5);
    // 独立推定：raw = max(10, 40000)；cap = max(10, 10×700.2=7002)；lost = min(40000, 7002) = 7002
    expect(r.lost).toBeCloseTo(7002, 0);
  });

  it("小额时按下限扣 10", () => {
    const s = initialState();
    s.moyu = 50;
    const es: EventState = { nextBossAt: Infinity, bossUntil: 10, nextMemeAt: Infinity, memeUntil: -1, bossCaught: false, bossStartAt: 2, surviveStreak: 0 };
    const r = onBossTap(s, es, 5);
    // 收入 +1，罚款 10 → 41
    expect(r.state.moyu).toBe(50 + 1 - BOSS_PENALTY_MIN);
  });

  it("同一巡逻内被抓一次后不再重复扣（连点无额外伤）", () => {
    const s = initialState();
    s.moyu = 1000;
    const es: EventState = { nextBossAt: Infinity, bossUntil: 10, nextMemeAt: Infinity, memeUntil: -1, bossCaught: false, bossStartAt: 2, surviveStreak: 0 };
    const first = onBossTap(s, es, 5);
    expect(first.caught).toBe(true);
    const second = onBossTap(first.state, es, 5);
    expect(second.caught).toBe(false);
    expect(second.income).toBe(1); // 仍有收入
    expect(second.state.moyu).toBe(first.state.moyu + 1); // 但不再罚款
  });

  it("安然度过：奖励 = max(50, 5 × idleRate)（克制，不喧宾夺主）", () => {
    const s = initialState();
    s.levels["phone" as string] = 5; // 偏移15 → 10.2/秒
    const reward = bossSurviveReward(s);
    expect(reward).toBe(51); // max(50, 5×10.2)
    expect(reward).toBeGreaterThanOrEqual(BOSS_REWARD_MIN);
  });

  it("被逮过的巡逻不给奖励", () => {
    const s = initialState();
    s.levels["phone" as string] = 5;
    const caughtEs: EventState = { nextBossAt: Infinity, bossUntil: -1, nextMemeAt: Infinity, memeUntil: -1, bossCaught: true, bossStartAt: 2, surviveStreak: 0 };
    expect(bossSurviveReward(s, caughtEs)).toBe(0);
  });
});

describe("同事丢梗", () => {
  it("有效期内点击：奖励 5 × 点击力", () => {
    const s = initialState();
    s.levels["coffee" as string] = 2; // 点击力 1+2=3
    const es: EventState = { nextBossAt: Infinity, bossUntil: -1, nextMemeAt: Infinity, memeUntil: 10, bossCaught: false, bossStartAt: 2, surviveStreak: 0 };
    const r = onMemeTap(s, es);
    expect(r.earned).toBe(MEME_REWARD_CLICKS * 3);
    expect(r.state.moyu).toBe(15);
  });

  it("过期点击无效", () => {
    const s = initialState();
    const es: EventState = { nextBossAt: Infinity, bossUntil: -1, nextMemeAt: Infinity, memeUntil: -1, bossCaught: false, bossStartAt: 2, surviveStreak: 0 };
    const r = onMemeTap(s, es);
    expect(r.earned).toBe(0);
  });

  it("巡逻期间丢梗点击按被抓处理（boss 优先）", () => {
    const s = initialState();
    s.moyu = 1000;
    const es: EventState = { nextBossAt: Infinity, bossUntil: 10, nextMemeAt: Infinity, memeUntil: 10, bossCaught: false, bossStartAt: 2, surviveStreak: 0 };
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
    expect(BOSS_REWARD_IDLE_SECONDS).toBe(5);
  });

  it("偷点（challenger #1）：巡逻期点击照常获得点击收入，同时承担罚款", () => {
    const s = initialState();
    s.moyu = 5000;
    s.levels["coffee" as string] = 4; // 点击力 1+4=5
    const es: EventState = { ...newEventState(), bossUntil: 10, bossStartAt: 0 };
    const r = onBossTap(s, es, 5); // 过宽限，被抓
    // 独立推定：收入 +5；罚款 raw=max(10,5050×5%=252.5)；cap=max(10,10×0.2)=10 → lost=10
    // 净变化 = +5 - 10 = -5
    expect(r.income).toBe(5);
    expect(r.lost).toBe(10);
    expect(r.state.moyu).toBe(5000 + 5 - 10);
    expect(r.state.totalEarned).toBe(5); // 收入进 totalEarned（罚款不扣）
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

  it("宽限期内点击：有收入、无罚款、不算被抓", () => {
    const s = initialState();
    s.moyu = 5000;
    s.levels["coffee" as string] = 4;
    const es: EventState = { ...newEventState(), bossUntil: 10, bossStartAt: 5 };
    const r = onBossTap(s, es, 5.3); // 宽限内
    expect(r.income).toBe(5);
    expect(r.lost).toBe(0);
    expect(r.caught).toBe(false);
    expect(es.bossCaught).toBe(false);
    expect(r.state.moyu).toBe(5005);
  });

  it("finishPatrol：安然结束发奖并推进连胜，被抓则清零不给奖", () => {
    const s = initialState();
    s.levels["phone" as string] = 5; // 10.2/s
    const es: EventState = { ...newEventState(), bossUntil: 10, bossStartAt: 0 };
    const r1 = finishPatrol(s, es);
    expect(r1.reward).toBeCloseTo(51, 0); // max(50, 5×10.2)
    expect(es.surviveStreak).toBe(1);
    const r2 = finishPatrol(r1.state, es);
    expect(r2.reward).toBeCloseTo(51 * 1.1, 0); // 连胜 2 → ×1.2? 不：streak 已 1，奖励用 streak=1 → ×1.1
    expect(es.surviveStreak).toBe(2);
    // 被抓后
    const es2: EventState = { ...newEventState(), bossUntil: 10, bossStartAt: 0, surviveStreak: 5 };
    onBossTap({ ...s, moyu: 1e6 }, es2, 5);
    const r3 = finishPatrol(s, es2);
    expect(r3.reward).toBe(0);
    expect(es2.surviveStreak).toBe(0);
  });

  it("安然连胜：奖励 ×(1+0.1N) 封顶 ×2，被抓清零", () => {
    const s = initialState();
    s.levels["retire" as string] = 1; // 700.2/s → 基础奖励 max(50, 5×700.2)=3501
    const base = bossSurviveReward(s, newEventState());
    expect(base).toBeCloseTo(3501, 0);
    // 连续安然 3 次后（streak=3）→ ×1.3
    const es3: EventState = { ...newEventState(), surviveStreak: 3 };
    expect(bossSurviveReward(s, es3)).toBeCloseTo(3501 * 1.3, 0);
    // 封顶 ×2（streak 10 与 50 相同）
    expect(bossSurviveReward(s, { ...newEventState(), surviveStreak: 10 })).toBeCloseTo(3501 * 2, 0);
    expect(bossSurviveReward(s, { ...newEventState(), surviveStreak: 50 })).toBeCloseTo(3501 * 2, 0);
    // 被抓 → 清零
    const es = newEventState();
    onBossTap({ ...s, moyu: 100000 }, es, 5);
    expect(es.surviveStreak).toBe(0);
  });
});
