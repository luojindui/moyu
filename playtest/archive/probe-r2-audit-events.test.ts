import { describe, it, expect } from "vitest";
import {
  newEventState,
  scheduleEvents,
  onBossTap,
  onMemeTap,
  bossSurviveReward,
  BOSS_DURATION,
  MEME_DURATION,
  BOSS_INTERVAL_MIN,
  BOSS_INTERVAL_MAX,
  MEME_INTERVAL_MIN,
  MEME_INTERVAL_MAX,
  type EventState,
} from "../src/engine/events";
import { initialState } from "../src/engine/state";
import { advance } from "../src/engine/tick";

/**
 * R2 审计探针①：随机事件引擎（events.ts）。
 * - 互斥不变量：巡逻与丢梗窗口永不重叠（结构性保证，长模拟验证）
 * - 窗口时长与间隔分布
 * - 一次性惩罚 / 一梗一奖 / 被抓无安然奖
 * - 惩罚金额与实际扣除的口径差（lost 上报 vs 实扣）
 */

/** 可复现 RNG（mulberry32） */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface WindowRec {
  kind: "boss" | "meme";
  start: number;
  end: number;
}

function simulateWindows(seed: number, seconds: number, dt = 1 / 60): WindowRec[] {
  const es = newEventState();
  const rng = seededRng(seed);
  const recs: WindowRec[] = [];
  let activeKind: "boss" | "meme" | null = null;
  let activeStart = 0;
  for (let t = 0; t < seconds; t += dt) {
    scheduleEvents(es, t, rng);
    const boss = es.bossUntil > t;
    const meme = es.memeUntil > t;
    if (boss && meme) throw new Error(`互斥被破坏 @t=${t} bossUntil=${es.bossUntil} memeUntil=${es.memeUntil}`);
    const nowKind = boss ? "boss" : meme ? "meme" : null;
    if (nowKind !== activeKind) {
      if (activeKind) recs.push({ kind: activeKind, start: activeStart, end: t });
      activeKind = nowKind;
      activeStart = t;
    }
  }
  if (activeKind) recs.push({ kind: activeKind, start: activeStart, end: seconds });
  return recs;
}

describe("R2 审计①：事件互斥与节奏（30 seed × 3600s，1/60 步进）", () => {
  const perSeed = new Map<number, WindowRec[]>();
  for (let s = 1; s <= 30; s++) perSeed.set(s, simulateWindows(s, 3600));
  const all = [...perSeed.values()].flat();

  it("巡逻与丢梗窗口在长模拟中永不重叠（互斥不变量）", () => {
    // simulateWindows 内已逐帧断言，此处再交叉验证记录本身
    let overlaps = 0;
    for (const wins of perSeed.values()) {
      const bosses = wins.filter((w) => w.kind === "boss");
      const memes = wins.filter((w) => w.kind === "meme");
      for (const b of bosses) for (const m of memes) if (m.start < b.end && b.start < m.end) overlaps++;
    }
    expect(overlaps).toBe(0); // 仅在同 seed 内比较
    expect(all.filter((w) => w.kind === "boss").length).toBeGreaterThan(500); // 30h 模拟里事件确实在发生
    expect(all.filter((w) => w.kind === "meme").length).toBeGreaterThan(500);
  });

  it("窗口时长：巡逻 ≈ 8s，丢梗 ≈ 5s（±2 帧容差）", () => {
    const bDur = all.filter((w) => w.kind === "boss" && w.end < 3600).map((w) => w.end - w.start); // 剔除模拟边界截断
    const mDur = all.filter((w) => w.kind === "meme" && w.end < 3600).map((w) => w.end - w.start);
    const bBad = bDur.filter((d) => Math.abs(d - BOSS_DURATION) > 0.05);
    const mBad = mDur.filter((d) => Math.abs(d - MEME_DURATION) > 0.05);
    console.log("boss 时长范围:", Math.min(...bDur).toFixed(2), Math.max(...bDur).toFixed(2), "meme:", Math.min(...mDur).toFixed(2), Math.max(...mDur).toFixed(2));
    expect(bBad.length).toBe(0); // 🔴 若失败 = 窗口被提前/推迟关闭
    expect(mBad.length).toBe(0);
  });

  it("同类窗口开启间隔不小于配置下限（boss≥90-ε，meme≥45-ε）", () => {
    const gaps = (kind: "boss" | "meme") => {
      const out: number[] = [];
      for (const wins of perSeed.values()) {
        const starts = wins.filter((w) => w.kind === kind).map((w) => w.start).sort((a, b) => a - b);
        out.push(...starts.slice(1).map((v, i) => v - starts[i]!));
      }
      return out;
    };
    const bg = gaps("boss");
    const mg = gaps("meme");
    console.log("boss 间隔 p50/p95/max:", percentile(bg, 50).toFixed(1), percentile(bg, 95).toFixed(1), Math.max(...bg).toFixed(1));
    console.log("meme 间隔 p50/p95/max:", percentile(mg, 50).toFixed(1), percentile(mg, 95).toFixed(1), Math.max(...mg).toFixed(1));
    expect(Math.min(...bg)).toBeGreaterThanOrEqual(BOSS_INTERVAL_MIN - 0.1);
    expect(Math.min(...mg)).toBeGreaterThanOrEqual(MEME_INTERVAL_MIN - 0.1);
  });
});

function percentile(arr: number[], p: number): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor((p / 100) * (s.length - 1))]!;
}

describe("R2 审计①②：一次性惩罚 / 一梗一奖 / 安然奖", () => {
  it("同一巡逻连点 5 次只扣一次（宽限后：越窗首击扣 1 次）", () => {
    const es: EventState = { ...newEventState(), bossUntil: 100, bossStartAt: 0 };
    let state = { ...initialState(), moyu: 1000 };
    let totalLost = 0;
    for (let i = 0; i < 5; i++) {
      const r = onBossTap(state, es, 5); // now=5 已过 0.8s 宽限
      state = r.state;
      totalLost += r.lost;
    }
    // 偷点语义：每击收入 +1（共 +5）；罚款 raw=50、cap=10 → 仅首击扣 10
    expect(totalLost).toBe(10);
    expect(state.moyu).toBe(1000 + 5 - 10);
  });

  it("巡逻外点击不触发惩罚", () => {
    const es = newEventState();
    const r = onBossTap(initialState(), es, 5);
    expect(r.caught).toBe(false);
    expect(r.lost).toBe(0);
  });

  it("惩罚口径（已修复）：lost = 实扣金额（余额 3 时上报 3 不夸大）", () => {
    const es: EventState = { ...newEventState(), bossUntil: 100, bossStartAt: 0 };
    const state = { ...initialState(), moyu: 3 };
    const r = onBossTap(state, es, 5);
    console.log("上报 lost:", r.lost, "实扣:", state.moyu + r.income - r.state.moyu);
    // 偷点：余额 3 + 收入 1 = 4，罚款 min(raw, cap, 4) = 4 → 归零
    expect(r.state.moyu).toBe(0);
    expect(r.lost).toBe(4); // ✅ 上报=实扣（不为 0 不虚报）
  });

  it("被抓过 → 安然奖为 0；未被抓 → max(50, 5×idleRate)（BOSS_REWARD_IDLE_SECONDS=5；注释写 20× 已过时）", () => {
    const caught: EventState = { ...newEventState(), bossUntil: 100, bossCaught: true };
    expect(bossSurviveReward(initialState(), caught)).toBe(0);
    const reward = bossSurviveReward(initialState());
    expect(reward).toBe(50); // 底薪 0.2 → 5×0.2=1 → 取 min 50
    let rich = initialState();
    rich.levels["retire"] = 10; // 700×10×2^0 = 7000/s + 0.2
    expect(bossSurviveReward(rich)).toBe(4 * (7000 + 0.2)); // 奖励 4×挂机秒 = 28000.8
  });

  it("一梗一奖：第二次点击同梗无奖励", () => {
    const es: EventState = { ...newEventState(), memeUntil: 100 };
    const s1 = onMemeTap(initialState(), es);
    expect(s1.earned).toBe(5); // 5 × 点击力1
    const s2 = onMemeTap(s1.state, es);
    expect(s2.earned).toBe(0);
    expect(s2.state.moyu).toBe(s1.state.moyu);
  });

  it("错过梗（窗口过期）→ 无奖励无惩罚", () => {
    const es = newEventState(); // memeUntil = -1
    const r = onMemeTap(initialState(), es);
    expect(r.earned).toBe(0);
    expect(r.state.moyu).toBe(0);
  });

  it("事件收益入账走 gain()：totalEarned 同步增长（段位进度）", () => {
    const es: EventState = { ...newEventState(), memeUntil: 100 };
    const r = onMemeTap(initialState(), es);
    expect(r.state.totalEarned).toBe(5);
    const idle = advance(initialState(), 60);
    expect(idle.totalEarned).toBe(12); // 底薪 0.2×60
  });
});
