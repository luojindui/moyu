/**
 * probe-r4v-nurture-lib.ts — 第 4 轮验收（养成收集党）公共模拟库。
 * 只在 playtest/ 内使用，不修改 src/。
 *
 * 以 src/engine 的真实逻辑复刻 main.ts 的行为计数路径：
 *   - 点击 → doClick + dailyTrack("click")（巡逻窗口内躲避=不点，避免被抓）
 *   - 丢梗命中 → onMemeTap + collectQuote + dailyTrack("meme")
 *   - 购买 → buyUpgrade + syncFlavorCollection + dailyTrack("buy")
 *   - 安然结束 → finishPatrol + dailyTrack("survive")
 *   - 挂机收益 → advance
 * 用于验证：日报 3 目标 10 分钟内可完成性、14 天回访价值。
 */
import type { GameState } from "../src/engine/state";
import { advance } from "../src/engine/tick";
import { doClick, buyUpgrade } from "../src/engine/actions";
import { UPGRADES, costOf } from "../src/engine/upgrades";
import { newEventState, scheduleEvents, onMemeTap, finishPatrol } from "../src/engine/events";
import { collectQuote, syncFlavorCollection } from "../src/engine/collection";
import { MEME_QUOTES } from "../src/engine/flavor";
import {
  DAILY_GOAL_TEMPLATES,
  dailyTrack,
  dailyAllDone,
  claimDaily,
  type DailyGoal,
  type DailyState,
} from "../src/engine/daily";

export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 按模板 id 列表手工构造当日日报（用于「组合 × 种子」穷举可行性） */
export function makeDaily(ids: string[], date = "2026-11-27"): DailyState {
  const goals: DailyGoal[] = ids.map((id) => {
    const tpl = DAILY_GOAL_TEMPLATES.find((t) => t.id === id);
    if (!tpl) throw new Error(`unknown goal ${id}`);
    return { id: tpl.id, target: tpl.target, progress: 0, done: false };
  });
  return { date, goals, streak: 0, lastCompleteDate: null, claimed: false };
}

export interface SessionOpts {
  date: string;
  maxSeconds: number;
  /** 每秒点击数（巡逻窗口内因躲避而暂停） */
  tps: number;
  /** 购买尝试节律（秒）；每次最多买 1 个最便宜的 */
  buyEverySec: number;
  seed?: number;
  dodgeBoss?: boolean;
  tapMemes?: boolean;
}

export interface SessionResult {
  state: GameState;
  /** 当日 3 目标全部 done 的时刻（秒），未完成 = null */
  doneAtSec: number | null;
  clicks: number;
  memes: number;
  memeWindows: number;
  bossWindows: number;
  buys: number;
  survives: number;
  claimedReward: number | null;
  /** 各目标首次 done 的时刻（秒），用于展示余量 */
  goalDoneAtSec: Record<string, number>;
  endGoals: { id: string; progress: number; target: number; done: boolean }[];
}

export function simulateSession(start: GameState, opts: SessionOpts): SessionResult {
  const DT = 0.25;
  const rng = lcg(opts.seed ?? 12345);
  const es = newEventState();
  let state = start;
  let tapCredit = 0;
  let lastBuyAt = 0;
  let prevBossActive = false;
  let doneAtSec: number | null = null;
  let claimedReward: number | null = null;
  const goalDoneAtSec: Record<string, number> = {};
  const counters = { clicks: 0, memes: 0, memeWindows: 0, bossWindows: 0, buys: 0, survives: 0 };

  const track = (kind: "click" | "meme" | "buy" | "survive", n = 1): void => {
    if (state.daily) state = { ...state, daily: dailyTrack(state.daily, kind, n) };
  };
  const steps = Math.round(opts.maxSeconds / DT);
  for (let i = 0; i <= steps; i++) {
    const t = i * DT;
    const memeWasIdle = es.memeUntil < 0;
    scheduleEvents(es, t, rng);
    const bossActive = es.bossUntil > t;

    // 点击（巡逻中躲避，不点 → 不被抓）
    if (!bossActive || opts.dodgeBoss === false) {
      tapCredit += opts.tps * DT;
      while (tapCredit >= 1) {
        tapCredit -= 1;
        state = doClick(state);
        track("click");
        counters.clicks += 1;
      }
    }

    // 丢梗窗口：出现即点（收集语录 + 日报 meme 计数）
    if (memeWasIdle && es.memeUntil > 0) {
      counters.memeWindows += 1;
      if (opts.tapMemes !== false) {
        const r = onMemeTap(state, es);
        const qi = Math.floor(rng() * MEME_QUOTES.length);
        state = collectQuote(r.state, qi).state;
        track("meme");
        counters.memes += 1;
      }
    }

    // 巡逻结束：安然 → 发奖 + 计数
    if (prevBossActive && !bossActive) {
      counters.bossWindows += 1;
      const r = finishPatrol(state, es);
      state = r.state;
      if (r.reward > 0) {
        track("survive");
        counters.survives += 1;
      }
    }
    prevBossActive = bossActive;

    // 购买：节律到点 → 买最便宜的（真实点击商店行为）
    if (t - lastBuyAt >= opts.buyEverySec) {
      lastBuyAt = t;
      const sorted = [...UPGRADES].sort(
        (a, b) => costOf(a.id, state.levels[a.id] ?? 0) - costOf(b.id, state.levels[b.id] ?? 0),
      );
      for (const u of sorted) {
        const next = buyUpgrade(state, u.id);
        if (next) {
          state = syncFlavorCollection(next);
          track("buy");
          counters.buys += 1;
          break;
        }
      }
    }

    state = advance(state, DT);

    if (state.daily) {
      for (const g of state.daily.goals) {
        if (g.done && goalDoneAtSec[g.id] === undefined) goalDoneAtSec[g.id] = t;
      }
    }
    if (doneAtSec === null && state.daily && dailyAllDone(state.daily)) doneAtSec = t;
  }

  // 玩家完成目标后去日报领取
  const r = claimDaily(state, opts.date);
  if (r.claimedReward !== null) {
    state = r.state;
    claimedReward = r.claimedReward;
  }

  return {
    state,
    doneAtSec,
    ...counters,
    claimedReward,
    goalDoneAtSec,
    endGoals: (state.daily?.goals ?? []).map((g) => ({
      id: g.id,
      progress: g.progress,
      target: g.target,
      done: g.done,
    })),
  };
}

/** 本地日期字符串 YYYY-MM-DD（Asia/Shanghai，node 本地时区） */
export function dateStr(base: Date, dayOffset: number): string {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + dayOffset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
