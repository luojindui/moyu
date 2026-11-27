/**
 * probe-r4v-nurture-daily.test.ts — 验收 3：每日摸鱼日报
 * 量级验证使用真实引擎模拟（lib.simulateSession 复刻 main.ts 行为计数路径）。
 */
import { describe, it, expect } from "vitest";
import {
  DAILY_GOAL_TEMPLATES,
  rollDaily,
  ensureDaily,
  dailyTrack,
  dailyAllDone,
  claimDaily,
  dailyReward,
  type DailyState,
} from "../src/engine/daily";
import { initialState, type GameState } from "../src/engine/state";
import { effectOf } from "../src/engine/upgrades";
import { lcg, makeDaily, simulateSession } from "./probe-r4v-nurture-lib";

function log(label: string, value: unknown): void {
  console.log(`[r4v-daily] ${label}`, JSON.stringify(value));
}

const ALL_IDS = ["click_100", "meme_1", "buy_3", "survive_2"];
const COMBOS = ALL_IDS.map((omit) => ALL_IDS.filter((id) => id !== omit)); // 4 种 3-目标组合
const DATE = "2026-11-27";

function doneState(ids = ALL_IDS, date = DATE): GameState {
  const s = initialState();
  return { ...s, daily: makeDaily(ids, date) };
}

function forceComplete(s: GameState): GameState {
  const d = s.daily!;
  return { ...s, daily: { ...d, goals: d.goals.map((g) => ({ ...g, progress: g.target, done: true })) } };
}

describe("日报·目标池与掷取", () => {
  it("每次 3 个目标不重复；500 次抽样池中 4 个模板全部出现且频率≈75%", () => {
    const rng = lcg(20261127);
    const freq: Record<string, number> = {};
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const d = rollDaily(DATE, rng);
      expect(d.goals).toHaveLength(3);
      const ids = d.goals.map((g) => g.id);
      expect(new Set(ids).size).toBe(3);
      for (const id of ids) {
        expect(DAILY_GOAL_TEMPLATES.some((t) => t.id === id)).toBe(true);
        freq[id] = (freq[id] ?? 0) + 1;
        seen.add(id);
      }
      expect(d.claimed).toBe(false);
      expect(d.goals.every((g) => g.progress === 0 && !g.done)).toBe(true);
    }
    expect(seen.size).toBe(4); // 4 选 3 的池：任何模板都可能被落下
    for (const id of ALL_IDS) {
      const p = (freq[id] ?? 0) / 500;
      expect(p).toBeGreaterThan(0.6);
      expect(p).toBeLessThan(0.9); // 理论 75%
    }
    log("目标频率", freq);
  });

  it("模板 kind 两两唯一（保证一次行为只推进一个目标，不串进度）", () => {
    const kinds = DAILY_GOAL_TEMPLATES.map((t) => t.kind);
    expect(new Set(kinds).size).toBe(DAILY_GOAL_TEMPLATES.length);
    expect(DAILY_GOAL_TEMPLATES.map((t) => t.target)).toEqual([100, 1, 3, 2]);
  });

  it("rollDaily 继承传入 streak；ensureDaily 同日幂等（同引用）、跨日重掷重置进度", () => {
    expect(rollDaily(DATE, lcg(1), 5).streak).toBe(5);
    let s = doneState();
    s = ensureDaily(s, DATE, lcg(2));
    const same = ensureDaily(s, DATE, lcg(3));
    expect(same).toBe(s); // 同日不重掷（同引用）
    s = forceComplete(s);
    s = { ...s, daily: dailyTrack(s.daily!, "meme", 1) };
    const next = ensureDaily(s, "2026-11-28", lcg(4));
    expect(next.daily!.date).toBe("2026-11-28");
    expect(next.daily!.goals.every((g) => g.progress === 0 && !g.done)).toBe(true);
    expect(next.daily!.claimed).toBe(false);
  });
});

describe("日报·量级：3 目标在 10 分钟内可完成（真实引擎模拟）", () => {
  it("全新玩家（1 次/秒点击、每 30 秒买最便宜、躲巡逻）4 种目标组合 ×5 种子全部 ≤600s", () => {
    const results: Record<string, { times: number[]; clicks: number; memes: number; buys: number; survives: number }> = {};
    for (const combo of COMBOS) {
      const times: number[] = [];
      let c = 0,
        m = 0,
        b = 0,
        sv = 0;
      for (let seed = 1; seed <= 5; seed++) {
        const start: GameState = { ...initialState(), daily: makeDaily(combo, DATE) };
        const r = simulateSession(start, { date: DATE, maxSeconds: 720, tps: 1, buyEverySec: 30, seed });
        expect(r.doneAtSec, `combo=${combo.join("+")} seed=${seed}`).not.toBeNull();
        expect(r.doneAtSec!).toBeLessThanOrEqual(600);
        times.push(r.doneAtSec!);
        c = r.clicks;
        m = r.memes;
        b = r.buys;
        sv = r.survives;
      }
      results[combo.join("+")] = { times, clicks: c, memes: m, buys: b, survives: sv };
    }
    log("新玩家组合完成时刻(秒)", results);
  });

  it("中期玩家（已购若干等级）4 种组合 ≤600s，购买成本上涨不导致 buy_3 卡死", () => {
    const mid: GameState = {
      ...initialState(),
      moyu: 20_000,
      totalEarned: 60_000,
      levels: { coffee: 10, water: 8, chair: 4, phone: 12, toilet: 6, group: 3, meeting: 1 },
    };
    const results: Record<string, number[]> = {};
    for (const combo of COMBOS) {
      results[combo.join("+")] = [];
      for (let seed = 11; seed <= 13; seed++) {
        const start: GameState = { ...mid, daily: makeDaily(combo, DATE) };
        const r = simulateSession(start, { date: DATE, maxSeconds: 720, tps: 1, buyEverySec: 30, seed });
        expect(r.doneAtSec, `combo=${combo.join("+")} seed=${seed}`).not.toBeNull();
        expect(r.doneAtSec!).toBeLessThanOrEqual(600);
        results[combo.join("+")]!.push(r.doneAtSec!);
      }
    }
    log("中期玩家组合完成时刻(秒)", results);
  });

  it("巡逻词条口径：跟随横幅（adaptive）时 survive_2 完成率；纯躲避（字面「躲过」）的差异", () => {
    // batch6 巡逻三变体后：survive 只在 finishPatrol 有奖励时计数（hold 安然；type/blitz 需点满）
    const measure = (patrolBehavior: "adaptive" | "dodge") => {
      const times: Array<number | null> = [];
      let survives = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const start: GameState = { ...initialState(), daily: makeDaily(["survive_2", "buy_3", "click_100"], DATE) };
        const r = simulateSession(start, { date: DATE, maxSeconds: 1800, tps: 1, buyEverySec: 30, seed, patrolBehavior });
        survives += r.survives;
        times.push(r.goalDoneAtSec["survive_2"] ?? null);
      }
      const done600 = times.filter((t) => t !== null && t <= 600).length;
      const done900 = times.filter((t) => t !== null && t <= 900).length;
      const done1800 = times.filter((t) => t !== null).length;
      const max = Math.max(...times.filter((t): t is number => t !== null));
      return { patrolBehavior, done600, done900, done1800, total: 20, maxSurviveDoneSec: Math.round(max), survivesAvg: +(survives / 20).toFixed(1) };
    };
    const adaptive = measure("adaptive");
    const dodge = measure("dodge");
    log("survive_2 完成率", { adaptive, dodge });
    // 跟随横幅提示的玩家：10 分钟内基本稳定（20 局 19 局达标，1 局 644s）
    expect(adaptive.done600).toBeGreaterThanOrEqual(19);
    expect(adaptive.done900).toBe(20);
    // 只按字面「安然躲过」全程不点的玩家：10 分钟内仅约 2/3 局达标，最慢 25 分钟
    expect(dodge.done600).toBeLessThan(20); // 证据：口径与变体交互导致不稳
    expect(dodge.done1800).toBe(20); // 30 分钟内总能完成
  });

  it("模拟器自查：一局内点击/丢梗/购买/安然计数确实来自真实行为", () => {
    const start: GameState = { ...initialState(), daily: makeDaily(ALL_IDS, DATE) };
    const r = simulateSession(start, { date: DATE, maxSeconds: 480, tps: 1, buyEverySec: 20, seed: 9 });
    expect(r.clicks).toBeGreaterThan(50);
    expect(r.memeWindows).toBeGreaterThanOrEqual(1);
    expect(r.buys).toBeGreaterThanOrEqual(3);
    expect(r.endGoals.every((g) => g.done)).toBe(true);
    expect(r.claimedReward).not.toBeNull();
    log("模拟自查", { clicks: r.clicks, memeWindows: r.memeWindows, buys: r.buys, survives: r.survives, goalDoneAtSec: r.goalDoneAtSec });
  });
});

describe("日报·领取与 streak 语义", () => {
  it("claimDaily 只在 3/3 全完成时发奖；未完成/重复领/日期不符均不发", () => {
    let s = doneState();
    const r0 = claimDaily(s, DATE);
    expect(r0.claimedReward).toBeNull();
    expect(r0.state).toBe(s); // 状态引用不变

    s = { ...s, daily: { ...s.daily!, goals: s.daily!.goals.map((g, i) => (i < 2 ? { ...g, progress: g.target, done: true } : g)) } };
    expect(claimDaily(s, DATE).claimedReward).toBeNull(); // 2/3

    expect(claimDaily(forceComplete(s), "2026-11-28").claimedReward).toBeNull(); // 日期不符

    const ok = claimDaily(forceComplete(s), DATE);
    expect(ok.claimedReward).not.toBeNull();
    expect(ok.state.daily!.claimed).toBe(true);
    const again = claimDaily(ok.state, DATE);
    expect(again.claimedReward).toBeNull(); // 不重复发
    expect(again.state).toBe(ok.state);
  });

  it("奖励 = max(500, 60×挂机秒收益)，且计入 totalEarned", () => {
    const fresh = forceComplete(doneState());
    expect(dailyReward(fresh)).toBe(500);
    const r1 = claimDaily(fresh, DATE);
    expect(r1.claimedReward).toBe(500);
    expect(r1.state.moyu).toBe(500);
    expect(r1.state.totalEarned).toBe(500);

    const st = initialState();
    st.levels["phone"] = 5;
    const s2 = forceComplete({ ...st, daily: makeDaily(ALL_IDS, DATE) });
    const expected = Math.max(500, 60 * effectOf(s2).idleRate);
    expect(effectOf(s2).idleRate).toBeGreaterThan(0.2);
    expect(dailyReward(s2)).toBe(expected);
    expect(claimDaily(s2, DATE).claimedReward).toBe(expected);
    log("奖励", { fresh: dailyReward(fresh), phone5: { idleRate: effectOf(s2).idleRate, reward: expected } });
  });

  it("streak：连续 3 天领取 → 1/2/3；断档 1 天 → 归 1；领取前跨日保留旧值", () => {
    let s = initialState();
    const dates = ["2026-11-20", "2026-11-21", "2026-11-22"];
    const streaks: number[] = [];
    for (const d of dates) {
      s = ensureDaily(s, d, lcg(10));
      expect(s.daily!.streak).toBe(streaks.at(-1) ?? 0); // 领取前保留上次连续数
      s = claimDaily(forceComplete(s), d).state;
      streaks.push(s.daily!.streak);
    }
    expect(streaks).toEqual([1, 2, 3]);
    // 断档（跳过 23 日）
    s = ensureDaily(s, "2026-11-24", lcg(11));
    expect(s.daily!.streak).toBe(0);
    s = claimDaily(forceComplete(s), "2026-11-24").state;
    expect(s.daily!.streak).toBe(1);
    log("streak 序列", { streaks, afterBreak: s.daily!.streak });
  });

  it("未领取即跨日 → 不计入连续；前一天完成但没领也算断档", () => {
    let s = initialState();
    s = ensureDaily(s, "2026-11-20", lcg(12));
    s = forceComplete(s); // 完成了但不领
    s = ensureDaily(s, "2026-11-21", lcg(13));
    expect(s.daily!.streak).toBe(0);
    s = forceComplete(s);
    expect(claimDaily(s, "2026-11-21").state.daily!.streak).toBe(1);
  });

  it("dailyTrack：累计、达标 done、超额封顶、已 done 不再变化、非当日目标 kind 不误伤", () => {
    let d: DailyState = makeDaily(["click_100", "survive_2", "meme_1"], DATE);
    d = dailyTrack(d, "click", 60);
    expect(d.goals.find((g) => g.id === "click_100")!.progress).toBe(60);
    d = dailyTrack(d, "click", 60);
    const click = d.goals.find((g) => g.id === "click_100")!;
    expect(click.progress).toBe(100);
    expect(click.done).toBe(true);
    const after = dailyTrack(d, "click", 100);
    expect(after.goals.find((g) => g.id === "click_100")!.progress).toBe(100); // 封顶
    // 未包含 buy_3 的日报：购买行为不产生任何目标进度
    const before = after.goals.map((g) => g.progress);
    const noBuy = dailyTrack(after, "buy", 3);
    expect(noBuy.goals.map((g) => g.progress)).toEqual(before);
    // 每日 3 目标从 4 池抽：某 kind 当日无对应目标时该行为是空转（设计如此）
    expect(DAILY_GOAL_TEMPLATES.some((t) => t.kind === "buy")).toBe(true);
  });

  it("dailyAllDone：全部 done 才 true；完成 2/3 仍 false", () => {
    let s = forceComplete(doneState());
    expect(dailyAllDone(s.daily!)).toBe(true);
    s = { ...s, daily: { ...s.daily!, goals: s.daily!.goals.map((g, i) => (i === 0 ? { ...g, done: false, progress: 99 } : g)) } };
    expect(dailyAllDone(s.daily!)).toBe(false);
  });
});
