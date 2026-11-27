/**
 * probe-r3-nurture-lib.ts — 养成收集党探针公共库（只在 playtest/ 内使用，不改 src/）。
 * 镜像 simulate.test.ts 的画像语义（同 LCG 种子/购买节律/事件经济），
 * 额外追踪收集党关心的量：totalEarned 段位跨越、彩蛋档位解锁、段位进度条密度。
 */
import { initialState, gain } from "../src/engine/state";
import { doClick, buyUpgrade, clickPowerOf } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { effectOf, UPGRADES, costOf } from "../src/engine/upgrades";
import { RANKS, rankFor } from "../src/engine/titles";
import { UPGRADE_FLAVOR, flavorFor } from "../src/engine/flavor";
import {
  newEventState,
  scheduleEvents,
  onBossTap,
  onMemeTap,
  bossSurviveReward,
} from "../src/engine/events";

export interface Persona {
  name: string;
  tapsPerSecond: (t: number) => number;
  buyEverySeconds: number;
  buyStrategy: "cheapest" | "most_expensive";
  dodgeBoss: boolean;
  tapsMemes: boolean;
}

export const NURTURE_PERSONAS: Persona[] = [
  { name: "clicker(狂点党)", tapsPerSecond: () => 3, buyEverySeconds: 5, buyStrategy: "cheapest", dodgeBoss: true, tapsMemes: true },
  { name: "idle(挂机党)", tapsPerSecond: (t) => (t < 5 ? 2 : 0), buyEverySeconds: 60, buyStrategy: "cheapest", dodgeBoss: true, tapsMemes: true },
  { name: "whale(爆肝党)", tapsPerSecond: (t) => (t < 1800 ? 8 : 1), buyEverySeconds: 10, buyStrategy: "most_expensive", dodgeBoss: false, tapsMemes: true },
  { name: "casual(休闲党)", tapsPerSecond: () => 1, buyEverySeconds: 30, buyStrategy: "cheapest", dodgeBoss: true, tapsMemes: true },
];

/** 彩蛋档位阈值（flavorFor 语义：>=50 取第5条，>=20 第4条 …） */
export const FLAVOR_TIERS = [1, 5, 10, 20, 50] as const;
export const FLAVOR_TOTAL = Object.keys(UPGRADE_FLAVOR).length * FLAVOR_TIERS.length; // 9×5=45

export interface RankCross {
  name: string;
  at: number;
  tSec: number | null; // null = 模拟窗口内未达成
}

export interface FlavorUnlock {
  id: string;
  tier: number; // 达到的等级阈值
  tSec: number;
}

export interface Sample {
  tSec: number;
  totalEarned: number;
  moyu: number;
  rankIdx: number;
  progress: number; // rankFor 档内进度 0..1
}

export interface NurtureRunResult {
  persona: string;
  minutes: number;
  samples: Sample[];
  rankCrossings: RankCross[];
  flavorUnlocks: FlavorUnlock[];
  flavorSeenCount: number;
  endLevels: Record<string, number>;
  endTotalEarned: number;
  memeTaps: number;
  /** 末段（当前档内）每 5 分钟进度条增量序列，按段位分桶 */
}

export interface NurtureOpts {
  minutes: number;
  sampleEverySec?: number;
  initial?: { moyu: number; totalEarned: number; levels: Record<string, number> };
  /** 覆盖点击率（多日模型里日常 30min 用画像原速） */
  tpsOverride?: number | ((t: number) => number);
  seed?: number;
}

export function runNurture(p: Persona, opts: NurtureOpts): NurtureRunResult {
  const DT = 0.25;
  const sampleEvery = opts.sampleEverySec ?? 5;
  const rng = (() => {
    let s = (opts.seed ?? 12345) >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  })();

  let state = opts.initial
    ? { moyu: opts.initial.moyu, totalEarned: opts.initial.totalEarned, levels: { ...opts.initial.levels } }
    : initialState();
  const es = newEventState();

  const tpsFn = opts.tpsOverride ?? p.tapsPerSecond;
  const samples: Sample[] = [];
  const rankCrossings: RankCross[] = RANKS.map((r) => ({ name: r.name, at: r.at, tSec: null }));
  const flavorUnlocks: FlavorUnlock[] = [];
  // 初始状态即已解锁的档位（多日模型续跑时结算）
  {
    const idx0 = rankFor(state.totalEarned);
    for (let i = 0; i < RANKS.length; i++) {
      if (state.totalEarned >= RANKS[i]!.at) rankCrossings[i]!.tSec = 0;
    }
    void idx0;
    for (const id of Object.keys(state.levels)) {
      const lv = state.levels[id] ?? 0;
      for (const tier of FLAVOR_TIERS) if (lv >= tier) flavorUnlocks.push({ id, tier, tSec: 0 });
    }
  }

  let tapCredit = 0;
  let lastBuyAt = 0;
  let prevBossActive = false;
  let prevMemeActive = false;
  let memeTaps = 0;
  let purchases = 0;

  const steps = Math.round((opts.minutes * 60) / DT);
  for (let i = 0; i <= steps; i++) {
    const t = i * DT;

    scheduleEvents(es, t, rng);
    const bossActive = es.bossUntil > t;
    const effectiveTaps = bossActive && p.dodgeBoss ? 0 : typeof tpsFn === "function" ? tpsFn(t) : tpsFn;
    tapCredit += effectiveTaps * DT;
    while (tapCredit >= 1) {
      tapCredit -= 1;
      if (bossActive) {
        const r = onBossTap(state, es, t);
        state = r.state;
      } else {
        state = doClick(state);
      }
    }

    const memeActive = es.memeUntil > t;
    if (p.tapsMemes && memeActive && !prevMemeActive) {
      const r = onMemeTap(state, es);
      state = r.state;
      memeTaps++;
    }
    prevMemeActive = memeActive;

    if (prevBossActive && !bossActive && !es.bossCaught) {
      state = gain(state, bossSurviveReward(state, es));
    }
    prevBossActive = bossActive;

    state = advance(state, DT);

    // 购买（镜像 simulate.test.ts：固定节律 + 单次购买）
    const cheapest = Math.min(...UPGRADES.map((u) => costOf(u.id, state.levels[u.id] ?? 0)));
    const canBuy = state.moyu >= cheapest;
    if (t - lastBuyAt >= p.buyEverySeconds && canBuy) {
      const sorted = [...UPGRADES].sort((a, b) => {
        const ca = costOf(a.id, state.levels[a.id] ?? 0);
        const cb = costOf(b.id, state.levels[b.id] ?? 0);
        return p.buyStrategy === "cheapest" ? ca - cb : cb - ca;
      });
      for (const u of sorted) {
        const next = buyUpgrade(state, u.id);
        if (next) {
          state = next;
          purchases++;
          lastBuyAt = t;
          const newLv = state.levels[u.id] ?? 0;
          if ((FLAVOR_TIERS as readonly number[]).includes(newLv)) {
            flavorUnlocks.push({ id: u.id, tier: newLv, tSec: t });
          }
          break;
        }
      }
    }

    // 段位跨越 + 采样
    const te = state.totalEarned;
    for (let ri = 0; ri < RANKS.length; ri++) {
      if (rankCrossings[ri]!.tSec === null && te >= RANKS[ri]!.at) rankCrossings[ri]!.tSec = t;
    }
    if (Math.abs(t % sampleEvery) < DT / 2) {
      const r = rankFor(te);
      const idx = RANKS.findIndex((x) => x.name === r.current);
      samples.push({ tSec: t, totalEarned: te, moyu: state.moyu, rankIdx: idx, progress: r.progress });
    }
  }

  return {
    persona: p.name,
    minutes: opts.minutes,
    samples,
    rankCrossings,
    flavorUnlocks,
    flavorSeenCount: flavorUnlocks.length,
    endLevels: { ...state.levels },
    endTotalEarned: state.totalEarned,
    memeTaps,
  };
}

/** 把彩蛋解锁事件折算成"累计可见条数"时间序列（每解锁一档 +1，Lv1 也算 1 条） */
export function flavorDiscoveryTimeline(unlocks: FlavorUnlock[], total = FLAVOR_TOTAL) {
  const sorted = [...unlocks].sort((a, b) => a.tSec - b.tSec);
  return sorted.map((u, i) => ({ tMin: +(u.tSec / 60).toFixed(1), seen: i + 1, total, ...u }));
}

/** 每 windowSec 的进度条增量（按段位分桶统计） */
export function progressDensity(samples: Sample[], windowSec = 300) {
  const byTier: Record<number, { deltas: number[]; times: number[] }> = {};
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const dt = b.tSec - a.tSec;
    if (b.rankIdx !== a.rankIdx) continue; // 跨段窗口不计
    const d = (b.progress - a.progress) / dt * windowSec;
    (byTier[b.rankIdx] ??= { deltas: [], times: [] }).deltas.push(d);
    byTier[b.rankIdx]!.times.push(b.tSec);
  }
  const stats: Record<string, { tier: string; windows: number; median5min: number; p10_5min: number; firstMin: number; lastMin: number }> = {};
  for (const [idx, v] of Object.entries(byTier)) {
    const s = [...v.deltas].sort((x, y) => x - y);
    const med = s[Math.floor(s.length / 2)] ?? 0;
    const p10 = s[Math.floor(s.length * 0.1)] ?? 0;
    stats[`tier${idx}`] = {
      tier: `rank${+idx + 1}(${RANKS[+idx]!.name})`,
      windows: s.length,
      median5min: +(med * 100).toFixed(3),
      p10_5min: +(p10 * 100).toFixed(3),
      firstMin: +(v.times[0]! / 60).toFixed(1),
      lastMin: +(v.times.at(-1)! / 60).toFixed(1),
    };
  }
  return stats;
}

export { RANKS, rankFor, flavorFor, clickPowerOf, effectOf, costOf, UPGRADES };
