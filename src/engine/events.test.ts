import { describe, it, expect } from "vitest";
import {
  newEventState,
  scheduleEvents,
  onBossTap,
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
    const es: EventState = { nextBossAt: Infinity, bossUntil: 10, nextMemeAt: Infinity, memeUntil: -1, bossCaught: false, bossStartAt: 2 };
    const r = onBossTap(s, es, 5);
    // 独立推定：raw = max(10, 50)；cap = max(10, 10×0.2=2)=10；lost = min(50, 10) = 10（早期温和）
    expect(r.state.moyu).toBe(990);
    expect(r.caught).toBe(true);
    expect(r.state.levels).toBe(s.levels); // 升级不受影响
  });

  it("反应宽限期（巡逻开启 0.8s 内）点击免罚免逮", () => {
    const s = initialState();
    s.moyu = 1000;
    const es: EventState = { nextBossAt: Infinity, bossUntil: 10, nextMemeAt: Infinity, memeUntil: -1, bossCaught: false, bossStartAt: 2 };
    // 巡逻 2s 开启，2.5s 点击 → 宽限内（0.5s < 0.8s）
    const r = onBossTap(s, es, 2.5);
    expect(r.caught).toBe(false);
    expect(r.state.moyu).toBe(1000);
    expect(es.bossCaught).toBe(false);
  });

  it("罚款封顶：min(raw, max(10, 10×idleRate))，后期不洗劫", () => {
    const s = initialState();
    s.moyu = 800_000;
    s.levels["retire" as string] = 1; // 700/s + 底薪 0.2
    const es: EventState = { nextBossAt: Infinity, bossUntil: 10, nextMemeAt: Infinity, memeUntil: -1, bossCaught: false, bossStartAt: 2 };
    const r = onBossTap(s, es, 5);
    // 独立推定：raw = max(10, 40000)；cap = max(10, 10×700.2=7002)；lost = min(40000, 7002) = 7002
    expect(r.lost).toBeCloseTo(7002, 0);
  });

  it("小额时按下限扣 10", () => {
    const s = initialState();
    s.moyu = 50;
    const es: EventState = { nextBossAt: Infinity, bossUntil: 10, nextMemeAt: Infinity, memeUntil: -1, bossCaught: false, bossStartAt: 2 };
    const r = onBossTap(s, es, 5);
    expect(r.state.moyu).toBe(50 - BOSS_PENALTY_MIN);
  });

  it("同一巡逻内被抓一次后不再重复扣（连点无额外伤）", () => {
    const s = initialState();
    s.moyu = 1000;
    const es: EventState = { nextBossAt: Infinity, bossUntil: 10, nextMemeAt: Infinity, memeUntil: -1, bossCaught: false, bossStartAt: 2 };
    const first = onBossTap(s, es, 5);
    expect(first.caught).toBe(true);
    const second = onBossTap(first.state, es, 5);
    expect(second.caught).toBe(false);
    expect(second.state.moyu).toBe(first.state.moyu);
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
    const caughtEs: EventState = { nextBossAt: Infinity, bossUntil: -1, nextMemeAt: Infinity, memeUntil: -1, bossCaught: true, bossStartAt: 2 };
    expect(bossSurviveReward(s, caughtEs)).toBe(0);
  });
});

describe("同事丢梗", () => {
  it("有效期内点击：奖励 5 × 点击力", () => {
    const s = initialState();
    s.levels["coffee" as string] = 2; // 点击力 1+2=3
    const es: EventState = { nextBossAt: Infinity, bossUntil: -1, nextMemeAt: Infinity, memeUntil: 10, bossCaught: false, bossStartAt: 2 };
    const r = onMemeTap(s, es);
    expect(r.earned).toBe(MEME_REWARD_CLICKS * 3);
    expect(r.state.moyu).toBe(15);
  });

  it("过期点击无效", () => {
    const s = initialState();
    const es: EventState = { nextBossAt: Infinity, bossUntil: -1, nextMemeAt: Infinity, memeUntil: -1, bossCaught: false, bossStartAt: 2 };
    const r = onMemeTap(s, es);
    expect(r.earned).toBe(0);
  });

  it("巡逻期间丢梗点击按被抓处理（boss 优先）", () => {
    const s = initialState();
    s.moyu = 1000;
    const es: EventState = { nextBossAt: Infinity, bossUntil: 10, nextMemeAt: Infinity, memeUntil: 10, bossCaught: false, bossStartAt: 2 };
    const caught = onBossTap(s, es, 5);
    expect(caught.caught).toBe(true);
    expect(caught.state.moyu).toBe(990);
  });

  it("常数合理：巡逻 8s、梗 5s、惩罚率 5%、安然奖 5 秒挂机", () => {
    expect(BOSS_DURATION).toBe(8);
    expect(MEME_DURATION).toBe(5);
    expect(BOSS_PENALTY_RATE).toBeCloseTo(0.05);
    expect(MEME_REWARD_CLICKS).toBe(5);
    expect(BOSS_REWARD_IDLE_SECONDS).toBe(5);
  });
});
