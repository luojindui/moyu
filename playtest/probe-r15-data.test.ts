/**
 * R15 批「摸鱼站」数值试玩探针 —— 数据党视角
 * 只读 src/，不修改源码。全部数值用引擎函数实算，不猜。
 *
 * 回答：
 * 1) 奖励是否合理：早期(1/s)/中期(1000/s)/后期(10万/s) 满分奖励 vs 30s 挂机收益、一次派遣
 * 2) 最优策略：三游戏期望分对比 / 每日 3 次如何分配 / 是否存在唯一最优
 * 3) 刷分空间：分数上限、重复提交、0 分消耗次数
 *
 * 产出：playtest/r15-data/engine-evidence.json
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { initialState, type GameState } from "../src/engine/state";
import {
  ARCADE_DAILY_LIMIT,
  GAMES,
  coffeeScore,
  emptyArcade,
  ensureArcade,
  finishGame,
  findScore,
  genBeats,
  genDrops,
  genFindRounds,
  judgeBeat,
  judgeCatch,
} from "../src/engine/minigames";
import { COLLEAGUES, dispatchReward, missionDef, missionSecondsFor } from "../src/engine/team";

const OUT = "playtest/r15-data";
mkdirSync(OUT, { recursive: true });
const ev: Record<string, unknown> = {};

/* ---------------- 工具 ---------------- */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 复刻引擎奖励公式（与 minigames.ts:65 一致，用引擎常量口径校验） */
function rewardOf(idleRate: number, score: number): number {
  const capped = Math.min(score, 9999);
  return Math.floor((idleRate * 0.6 + 20) * (capped / 100));
}

/** 奖励折算成"多少秒挂机收益" */
function idleSecondsEquivalent(idleRate: number, reward: number): number {
  return idleRate > 0 ? reward / idleRate : Infinity;
}

/** 构造一个持有老周 Lv1 且正在派遣指定任务的 state（用于引擎 dispatchReward 实算） */
function stateWithDispatch(colleagueId: string, missionId: string, level = 1, favor = 0): GameState {
  const def = COLLEAGUES.find((c) => c.id === colleagueId)!;
  const sec = missionSecondsFor(colleagueId, missionId);
  return {
    ...initialState(),
    team: {
      colleagues: {
        [colleagueId]: {
          level,
          missionId,
          startedAt: 0,
          endsAt: Date.now() + sec * 1000,
          favor,
          autoRepeat: false,
          rewardSnapshot: 0,
        },
      },
    },
  };
}

/** 用引擎 dispatchReward 实算一次派遣奖励（不依赖时间） */
function oneDispatch(colleagueId: string, missionId: string, stationIdle: number, level = 1, favor = 0): number {
  const s = stateWithDispatch(colleagueId, missionId, level, favor);
  return dispatchReward(s, colleagueId, stationIdle);
}

const STAGES = [
  { key: "opening", label: "开局(底薪)", idle: 0.2 },
  { key: "early", label: "早期", idle: 1 },
  { key: "mid", label: "中期", idle: 1000 },
  { key: "late", label: "后期", idle: 100000 },
];

/* ============================================================
 * 1) 三游戏可达分数上限（引擎函数实算，非猜测）
 * ============================================================ */
describe("R15-1 三游戏可达分数上限", () => {
  it("接咖啡：掉落数量分布 + 完美接住上限", () => {
    const N = 5000;
    const rng = mulberry32(12345);
    const ns: number[] = [];
    const perfects: number[] = [];
    for (let i = 0; i < N; i++) {
      const drops = genDrops(30, rng);
      ns.push(drops.length);
      perfects.push(coffeeScore(drops.length, 0, drops.length)); // 全接住、combo=全连
    }
    const stat = (arr: number[]) => ({
      min: Math.min(...arr),
      max: Math.max(...arr),
      mean: Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)),
    });
    // 验证判定窗口：每个掉落都能在 at/x 处命中
    const drops = genDrops(30, mulberry32(7));
    const hitAll = drops.every((d) => judgeCatch(drops, d.at, d.x).hit?.id === d.id);
    // 理论极限：掉落间隔最小 0.55s，可推最大掉落数
    const maxDropsTheoretical = Math.floor((29.5 - 0.8) / 0.55) + 1;
    ev.coffee = {
      drops: stat(ns),
      perfectScore: stat(perfects),
      theoreticalMaxDrops: maxDropsTheoretical,
      theoreticalMaxScore: coffeeScore(maxDropsTheoretical, 0, maxDropsTheoretical),
      hitAllSeedsVerified: hitAll,
      samples: N,
    };
    expect(hitAll).toBe(true);
    expect(Math.max(...perfects)).toBeLessThan(1000); // 远低于 9999
  });

  it("找老板：5 轮上限 + 时间奖励上限", () => {
    // 引擎：findScore(correct, wrong, leftSec) = max(0, correct*50 - wrong*20 + floor(leftSec*10))
    const rounds = genFindRounds(5, 3, mulberry32(99));
    const maxTheoretical = findScore(5, 0, 30); // 0 秒通关（不可达）
    const maxRealistic = findScore(5, 0, 29.9);
    const timeoutZero = findScore(5, 0, 0); // 30 秒超时才点完（0 时间奖励）
    const perRound = [0.2, 0.4, 0.8, 1.5, 3.0].map((lat) => ({
      latencySec: lat,
      elapsed: Number((lat * 5).toFixed(2)),
      score: findScore(5, 0, Math.max(0, 30 - lat * 5)),
    }));
    ev.findboss = {
      roundCount: rounds.length,
      grid: 3,
      roundCountFixedByUI: 5,
      maxTheoretical,
      maxRealistic,
      slowClear: timeoutZero,
      byLatency: perRound,
    };
    expect(rounds.length).toBe(5);
  });

  it("节奏点击：节拍数量 + 满分（引擎分 vs UI 加分口径）", () => {
    const beats = genBeats(30, 120, 0.6);
    // 模拟 UI：每个节拍精确点击 → judgeBeat 返回 perfect
    const used = new Set<number>();
    let engineScore = 0;
    let perfect = 0;
    for (const b of beats) {
      const r = judgeBeat(beats, b, used);
      if (r.kind === "perfect" && r.index >= 0) {
        used.add(r.index);
        engineScore += r.score;
        perfect++;
      }
    }
    const uiScore = engineScore + perfect * 5; // arcade.ts:228/244 额外 +perfect*5
    // 模拟"乱点"（每 50ms 一次）→ 每个节拍都被判 good
    const spam = (intervalMs: number) => {
      const u = new Set<number>();
      let sc = 0;
      let pf = 0;
      for (let t = 0.0; t < 30; t += intervalMs / 1000) {
        const r = judgeBeat(beats, t, u);
        if (r.kind !== "miss" && r.index >= 0) {
          u.add(r.index);
          sc += r.score;
          if (r.kind === "perfect") pf++;
        }
      }
      return { intervalMs, hits: u.size, score: sc + pf * 5, perfect: pf };
    };
    ev.rhythm = {
      beatCount: beats.length,
      enginePerfectAll: engineScore,
      uiPerfectAll: uiScore,
      uiExtraPerPerfect: 5,
      spam: [spam(50), spam(100), spam(250), spam(300), spam(400)],
      beatsPerSec: 120 / 60,
    };
    expect(beats.length).toBe(59);
    expect(uiScore).toBe(59 * 25);
  });
});

/* ============================================================
 * 2) 奖励对比：满分 vs 30s 挂机 vs 一次派遣
 * ============================================================ */
describe("R15-2 奖励对比表", () => {
  it("三阶段 × 三游戏满分 × 30s挂机/一次派遣", () => {
    const maxScores = { rhythm: 1475, coffee: 820, findboss: 549 }; // coffee 820 = 5000 局实测最高（41 个掉落）
    const rows = STAGES.map((st) => {
      const idle30 = st.idle * 30;
      // 一次派遣：最早可用「老周 Lv1 + 就近溜达（3min, x2.2, 无匹配）」
      const dispatch = oneDispatch("zhou", "stroll", st.idle);
      const games = Object.fromEntries(
        Object.entries(maxScores).map(([g, s]) => {
          const reward = rewardOf(st.idle, s);
          return [
            g,
            {
              score: s,
              reward,
              vsIdle30: Number((reward / idle30).toFixed(4)),
              idleSecEquivalent: Number(idleSecondsEquivalent(st.idle, reward).toFixed(1)),
              vsDispatch: Number((reward / dispatch).toFixed(3)),
            },
          ];
        }),
      );
      return {
        stage: st.label,
        idleRate: st.idle,
        idle30s: idle30,
        oneDispatch: {
          colleague: "zhou lv1",
          mission: "stroll(就近溜达 180s x2.2)",
          seconds: missionSecondsFor("zhou", "stroll"),
          reward: dispatch,
        },
        games,
      };
    });
    ev.rewardTable = rows;

    // 阶段间漂移：早期 vs 后期（同一满分分数下"折算挂机秒数"的变化）
    const secEq = (idle: number, score: number) => idleSecondsEquivalent(idle, rewardOf(idle, score));
    ev.stageSpread = {
      rhythmMax_score: 1475,
      idleSecondsEquivalent: {
        opening_0_2: Number(secEq(0.2, 1475).toFixed(1)),
        early_1: Number(secEq(1, 1475).toFixed(1)),
        mid_1000: Number(secEq(1000, 1475).toFixed(1)),
        late_100000: Number(secEq(100000, 1475).toFixed(1)),
      },
      vs30sIdle: {
        opening: Number((rewardOf(0.2, 1475) / (0.2 * 30)).toFixed(2)),
        early: Number((rewardOf(1, 1475) / 30).toFixed(2)),
        mid: Number((rewardOf(1000, 1475) / (1000 * 30)).toFixed(3)),
        late: Number((rewardOf(100000, 1475) / (100000 * 30)).toFixed(3)),
      },
      spreadEarlyOverLateX: Number(
        (rewardOf(1, 1475) / (1 * 30) / (rewardOf(100000, 1475) / (100000 * 30))).toFixed(1),
      ),
    };

    // 规格上限 9999 若真的打满（当前三游戏都打不到）
    ev.capScenario = STAGES.map((st) => ({
      stage: st.label,
      idleRate: st.idle,
      atCap9999: rewardOf(st.idle, 9999),
      vsIdle30: Number((rewardOf(st.idle, 9999) / (st.idle * 30)).toFixed(3)),
      idleSecEquivalent: Number(idleSecondsEquivalent(st.idle, rewardOf(st.idle, 9999)).toFixed(1)),
    }));

    // 日上限：3 次都打满节奏
    ev.daily3 = STAGES.map((st) => {
      const per = rewardOf(st.idle, 1475);
      const daily = per * ARCADE_DAILY_LIMIT;
      return {
        stage: st.label,
        idleRate: st.idle,
        perGame: per,
        daily3: daily,
        idle90s: st.idle * 90,
        vsIdle90s: Number((daily / (st.idle * 90)).toFixed(3)),
        idleSecEquivalent: Number(idleSecondsEquivalent(st.idle, daily).toFixed(1)),
      };
    });

    // 盈亏平衡：奖励 = 同期 30s 挂机收益 所需的分数
    ev.breakEvenScore = STAGES.map((st) => {
      const s = (30 * st.idle * 100) / (st.idle * 0.6 + 20);
      const maxReachable = 1475;
      return {
        stage: st.label,
        idleRate: st.idle,
        breakEvenScore: Number(s.toFixed(1)),
        reachableByRhythm: s <= maxReachable,
        maxReachableScore: maxReachable,
      };
    });

    // 奖励是否随分数单调不减
    for (const x of [
      { key: 0, idle: 0, arr: [] as number[] },
    ]) void x;
    let mono = true;
    for (const idle of [0, 0.2, 1, 1000, 100000]) {
      let prev = -1;
      for (let s = 0; s <= 9999; s++) {
        const r = rewardOf(idle, s);
        if (r < prev) mono = false;
        prev = r;
      }
    }
    ev.rewardMonotonic = mono;
    // 低分白玩阈值：奖励 <1 的分数区间（消耗次数却 0 收益）
    ev.zeroRewardScore = [0, 0.2, 1, 1000, 100000].map((idle) => {
      let minScoreFor1 = -1;
      for (let s = 1; s <= 9999; s++) {
        if (rewardOf(idle, s) >= 1) {
          minScoreFor1 = s;
          break;
        }
      }
      return { idleRate: idle, minScoreForOneReward: minScoreFor1 };
    });

    expect(mono).toBe(true);
  });

  it("派遣基准扩展：中期/后期队内替代口径（老周 Lv1 3min vs 老周 Lv5 30min 匹配）", () => {
    ev.dispatchVariants = STAGES.map((st) => ({
      stage: st.label,
      idleRate: st.idle,
      zhou_lv1_stroll_3min: oneDispatch("zhou", "stroll", st.idle, 1, 0),
      zhou_lv5_chat_30min_matched: oneDispatch("zhou", "chat", st.idle, 5, 0),
      li_lv5_stroll_3min_matched_short: oneDispatch("li", "stroll", st.idle, 5, 0),
      zhou_lv1_coffee_8h: oneDispatch("zhou", "coffee", st.idle, 1, 0),
      // 折算成"多少秒挂机收益"，用来看派遣自身的时间效率
      zhou_lv1_stroll_3min_idleSecEq: Number(
        (oneDispatch("zhou", "stroll", st.idle, 1, 0) / (st.idle || 1)).toFixed(2),
      ),
    }));
    // 关系校验：3 分钟派遣奖励 = 工位挂机 × 秒数 × 0.011 × 倍率 → 远小于同期挂机
    const d3 = oneDispatch("zhou", "stroll", 1000);
    const idle180 = 1000 * 180;
    expect(d3).toBeGreaterThan(0);
    expect(d3 / idle180).toBeLessThan(0.1); // 派遣本身只值同期挂机收益的一小部分（本次批次外，仅作对照）
    // 节奏满分奖励 ≈ 2 × 一次 3 分钟派遣（中期/后期）
    const g = rewardOf(1000, 1475);
    expect(g / d3).toBeGreaterThan(1.5);
    expect(g / d3).toBeLessThan(2.5);
  });
});

/* ============================================================
 * 3) 三游戏期望分对比 + 最优分配
 * ============================================================ */
describe("R15-3 期望分与最优策略", () => {
  it("接咖啡：不同接住率下的期望分（含 UI 漏接 bug 影响）", () => {
    const N = 2000;
    const rng = mulberry32(2024);
    const seeds = Array.from({ length: N }, () => genDrops(30, rng));
    const sim = (p: number) => {
      const r = mulberry32(555);
      let sum = 0;
      let max = 0;
      for (const drops of seeds) {
        let caught = 0;
        let combo = 0;
        let maxCombo = 0;
        for (let i = 0; i < drops.length; i++) {
          if (r() < p) {
            caught++;
            combo++;
            maxCombo = Math.max(maxCombo, combo);
          } else {
            combo = 0;
          }
        }
        // 现状（UI 漏接恒为 0）：missed=0；设计意图：missed = drops.length - caught
        const actual = coffeeScore(caught, 0, maxCombo);
        const intended = coffeeScore(caught, drops.length - caught, maxCombo);
        sum += actual;
        max = Math.max(max, actual);
        void intended;
      }
      return { catchRate: p, expectedScore: Number((sum / N).toFixed(1)), maxScore: max };
    };
    ev.coffeeExpectation = [0.5, 0.7, 0.85, 0.95, 1.0].map(sim);

    // 盲点模拟（当前视觉 bug 下的真实手感）：随机时间 + 随机 x 连点
    const blind = (tapIntervalMs: number, fixedX: number | null) => {
      const r = mulberry32(777);
      let sum = 0;
      let max = 0;
      for (const drops of seeds) {
        const used = new Set<number>();
        let caught = 0;
        let combo = 0;
        let maxCombo = 0;
        for (let t = 0.2; t < 30; t += tapIntervalMs / 1000) {
          const x = fixedX ?? 0.12 + r() * 0.76;
          const { hit } = judgeCatch(drops, t, x);
          if (hit && !used.has(hit.id)) {
            used.add(hit.id);
            caught++;
            combo++;
            maxCombo = Math.max(maxCombo, combo);
          } else {
            combo = 0;
          }
        }
        const sc = coffeeScore(caught, 0, maxCombo);
        sum += sc;
        max = Math.max(max, sc);
      }
      return { tapIntervalMs, fixedX, expectedScore: Number((sum / N).toFixed(1)), maxScore: max };
    };
    ev.coffeeBlind = [blind(500, null), blind(300, null), blind(500, 0.5), blind(200, null), blind(100, null)];

    // 盲点进阶：高频"扫屏"（x 匀速扫过全宽），上限估计
    const sweep = (tapIntervalMs: number, sweepSec: number) => {
      const r = mulberry32(888);
      let sum = 0;
      let max = 0;
      for (const drops of seeds) {
        const used = new Set<number>();
        let caught = 0;
        let combo = 0;
        let maxCombo = 0;
        let k = 0;
        for (let t = 0.2; t < 30; t += tapIntervalMs / 1000) {
          const x = (((k++ * (tapIntervalMs / 1000)) / sweepSec) % 1) * 0.98 + 0.01;
          const { hit } = judgeCatch(drops, t, x);
          if (hit && !used.has(hit.id)) {
            used.add(hit.id);
            caught++;
            combo++;
            maxCombo = Math.max(maxCombo, combo);
          } else {
            combo = 0;
          }
        }
        const sc = coffeeScore(caught, 0, maxCombo);
        sum += sc;
        max = Math.max(max, sc);
      }
      return { tapIntervalMs, sweepSec, expectedScore: Number((sum / N).toFixed(1)), maxScore: max };
    };
    ev.coffeeBlindSweep = [sweep(200, 1), sweep(100, 1), sweep(100, 0.5), sweep(50, 0.5), sweep(100, 2)];

    // 复刻 UI tick：统计"漏接"是否真的会累加
    const simUiMissed = (drops: ReturnType<typeof genDrops>) => {
      const used = new Set<number>();
      let missed = 0;
      let lastIdx = -1;
      for (let f = 0; f <= 30 * 60; f++) {
        const elapsed = f / 60;
        const visible = drops.filter((d) => d.at > elapsed - 0.4 && d.at < elapsed + 3);
        for (const d of visible) {
          if (used.has(d.id) || d.id <= lastIdx) continue;
          const left = (d.at - elapsed) / 3;
          if (left < 0) {
            used.add(d.id);
            missed++;
          }
        }
        if (visible.length) lastIdx = Math.max(lastIdx, visible[visible.length - 1]!.id);
      }
      const passed = drops.filter((d) => d.at < 30).length;
      return { passedDrops: passed, missedCounted: missed };
    };
    ev.coffeeMissedAudit = seeds.slice(0, 200).map((d) => simUiMissed(d)).reduce(
      (acc, x) => ({ passedDrops: acc.passedDrops + x.passedDrops, missedCounted: acc.missedCounted + x.missedCounted }),
      { passedDrops: 0, missedCounted: 0 },
    );

    // 视觉窗口 vs 判定窗口（静态 top 不更新 → 元素在 at-3s 创建、400ms 后移除）
    const d0 = genDrops(30, mulberry32(1))[3]!;
    ev.coffeeVisualWindow = {
      dropAt: d0.at,
      elementCreatedAtSec: Number((d0.at - 3).toFixed(2)),
      elementRemovedAtSec: Number((d0.at - 3 + 0.4).toFixed(2)),
      catchWindow: [Number((d0.at - 0.32).toFixed(2)), Number((d0.at + 0.32).toFixed(2))],
      overlapSec: 0,
      gapSec: Number((d0.at - 0.32 - (d0.at - 2.6)).toFixed(2)),
    };
  });

  it("找老板：不同手速下的期望分（近乎恒定、低方差）", () => {
    const lat = [0.15, 0.3, 0.5, 0.8, 1.2, 2.0, 3.0];
    ev.findbossExpectation = lat.map((l) => {
      const elapsed = l * 5;
      const leftSec = Math.max(0, 30 - elapsed);
      return {
        perRoundLatencySec: l,
        elapsedSec: Number(elapsed.toFixed(2)),
        score: findScore(5, 0, leftSec),
        rewardAtMid: rewardOf(1000, findScore(5, 0, leftSec)),
      };
    });
    // 错误惩罚：每次错 -20；30 秒超时 0 时间奖励
    ev.findbossErrors = [0, 1, 2, 3, 5].map((w) => ({
      wrong: w,
      scoreFast: findScore(5, w, 20),
      scoreTimeout: findScore(5, w, 0),
    }));
  });

  it("节奏点击：技能曲线 + 乱点保底", () => {
    const beats = 59;
    ev.rhythmExpectation = [0.0, 0.2, 0.4, 0.6, 0.8, 0.95, 1.0].map((p) => {
      // p = perfect 率，其余判 good（不 miss 的"认真打"上界）
      const score = beats * (25 * p + 10 * (1 - p));
      return { perfectRate: p, expectedScore: Math.floor(score), rewardAtMid: rewardOf(1000, Math.floor(score)) };
    });
    // 乱点保底（每 250ms 一次必得 good）
    const spam250 = 59 * 10;
    ev.rhythmSpamFloor = { score: spam250, rewardAtMid: rewardOf(1000, spam250) };
  });

  it("唯一最优判定：分游戏期望分 argmax（技能档）", () => {
    const skillTiers = [
      { tier: "低技能", coffee: 250, findboss: 490, rhythm: 590 }, // 节奏=乱点保底
      { tier: "中技能", coffee: 560, findboss: 510, rhythm: 900 },
      { tier: "高技能", coffee: 700, findboss: 530, rhythm: 1250 },
      { tier: "满技能", coffee: 820, findboss: 549, rhythm: 1475 },
    ];
    ev.strategyTiers = skillTiers.map((t) => {
      const best = (["coffee", "findboss", "rhythm"] as const).sort((a, b) => t[b] - t[a])[0];
      return { ...t, argmax: best, daily3Best: { game: best, score: t[best] * 3 } };
    });
    // 节奏 vs 找老板 的支配关系：节奏乱点保底(590) > 找老板理论上限(549)？
    ev.domination = {
      rhythmSpamFloor: 590,
      findbossAbsMax: findScore(5, 0, 30),
      findbossRealisticMax: findScore(5, 0, 29.9),
      findbossDominated: 590 > findScore(5, 0, 29.9),
      coffeeMax: 820,
      rhythmMax: 1475,
    };
    // 分配数学：奖励 ∝ 分数、三游戏同系数、次数跨游戏共享、无阈值 → 最优分配 = argmax 游戏 ×3
    ev.allocation = {
      formula: "reward = floor((idle*0.6+20) * score/100)，对 score 线性，无游戏系数、无边际递减",
      conclusion: "分配问题退化为单次 argmax，不存在 2+1/1+1+1 的组合策略",
    };
  });
});

/* ============================================================
 * 4) 刷分空间：上限 / 重复提交 / 0 分 / 跨日
 * ============================================================ */
describe("R15-4 刷分空间审计", () => {
  const rich = () => ({ ...initialState(), arcade: emptyArcade("2026-11-27") });
  it("分数上限与重复提交", () => {
    // 9999 分（客户端可伪造上限）
    const cap = finishGame(rich(), "coffee", 9999, 1000)!;
    // 1e9 分被 cap 到 9999（与满分同奖励）
    const over = finishGame(rich(), "coffee", 1e9, 1000)!;
    // 负数 / 0 / NaN 各自消耗次数但 0 奖励（每次都用新 state 避免次数串扰）
    const zero = finishGame(rich(), "coffee", 0, 1000)!;
    const neg = finishGame(rich(), "coffee", -5, 1000)!;
    const nan = finishGame(rich(), "coffee", Number.NaN, 1000)!;
    // 次数用尽后 null（重复提交被 played 挡住）
    const extra = finishGame(rich(), "coffee", 100, 1000)!;
    const extra2 = finishGame(extra.state, "coffee", 100, 1000)!;
    const extra3 = finishGame(extra2.state, "coffee", 100, 1000)!;
    const extra4 = finishGame(extra3.state, "coffee", 100, 1000);
    ev.exploitAudit = {
      cap9999RewardAt1000: cap.reward,
      over9999CappedTo: over.state.arcade.best.coffee,
      over9999RewardEqualsCap: over.reward === cap.reward,
      zeroConsumesAttempt: zero.reward === 0 && zero.state.arcade.played === 1,
      negConsumesAttempt: neg.reward === 0 && neg.state.arcade.played === 1,
      nanConsumesAttemptNoReward: nan.reward === 0 && nan.state.arcade.played === 1,
      fourthSubmissionBlocked: extra4 === null,
      playedAfter3: extra3.state.arcade.played,
    };
    expect(over.reward).toBe(cap.reward);
    expect(extra4).toBeNull();
  });

  it("跨日重置 + 最高分保留 + 最高分无收益联动", () => {
    let s = finishGame(rich(), "rhythm", 1475, 1000)!.state;
    const same = ensureArcade(s, "2026-11-27");
    const next = ensureArcade(s, "2026-11-28");
    ev.crossDay = {
      sameDayIsSameObject: same === s,
      nextDayPlayed: next.arcade.played,
      nextDayBestKept: next.arcade.best.rhythm,
      bestHasAnyEffect: "无（best 仅菜单/结算展示，不参与奖励/成就/排行）",
    };
    expect(next.arcade.played).toBe(0);
    expect(next.arcade.best.rhythm).toBe(1475);
  });

  it("分数标尺错配：实际上限 / 规格上限 / 奖励系数", () => {
    ev.scaleMismatch = {
      specCap: 9999,
      actualMax: { coffee: 820, findboss: 549, rhythm: 1475 },
      capUtilization: {
        coffee: Number((820 / 9999).toFixed(4)),
        findboss: Number((549 / 9999).toFixed(4)),
        rhythm: Number((1475 / 9999).toFixed(4)),
      },
      engineComment: "minigames.ts:64「分数 × 0.6 秒挂机收益（30 秒小游戏 ≈ 18 秒挂机收益）」",
      // 达到注释意图（18s 挂机）所需分数：S = 18*idle*100/(0.6*idle+20)
      scoreFor18sIdle: [0.2, 1, 1000, 100000].map((idle) => ({
        idleRate: idle,
        requiredScore: Number(((18 * idle * 100) / (idle * 0.6 + 20)).toFixed(1)),
        reachable: (18 * idle * 100) / (idle * 0.6 + 20) <= 1475,
      })),
    };
    // 注释意图 vs 实际（满分节奏）
    ev.commentVsActual = STAGES.map((st) => ({
      stage: st.label,
      idleRate: st.idle,
      intended18s: Number((18 * st.idle).toFixed(1)),
      actualAtRhythmMax: idleSecondsEquivalent(st.idle, rewardOf(st.idle, 1475)),
      ratioActualOverIntended: Number((idleSecondsEquivalent(st.idle, rewardOf(st.idle, 1475)) / 18).toFixed(2)),
    }));
  });

  it("配置/口径不一致清单", () => {
    ev.consistency = {
      gameDailyLimitField: GAMES.map((g) => ({ id: g.id, dailyLimit: g.dailyLimit })),
      actualSharedLimit: ARCADE_DAILY_LIMIT,
      dailyLimitUsedInCode: false,
      perfectScoreUiVsEngine: { enginePerPerfect: 20, uiEffectivePerPerfect: 25, diffPct: 25 },
      rewardBase: {
        arcadeUses: "stationIdleScaled（工位挂机，不含同事/固定同事挂机）",
        hudShows: "effectOf().idleRate（含同事固定 + 30% 工位占比）",
      },
      durationSpec: { spec: 30, findbossActual: "≈1-6 秒点完 5 轮即结束（不是 30 秒）" },
    };
  });
});

describe("R15 汇总落盘", () => {
  it("写入证据 JSON", () => {
    writeFileSync(`${OUT}/engine-evidence.json`, JSON.stringify(ev, null, 2));
    expect(Object.keys(ev).length).toBeGreaterThan(10);
  });
});