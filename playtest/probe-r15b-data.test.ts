/**
 * R15b 复验（HEAD 14057dc）：摸鱼站修复后数值复算
 * 只读 src/，全部用引擎函数实算。
 *
 * 重点：
 *  ① 三阶段奖励占比（早期 30 vs 30s 挂机；中后期 25 秒挂机）
 *  ② 三游戏"能否真的打到 REF_SCORE=600"（满分可达性 / 期望分 / 是否仍唯一支配）
 *  ③ 咖啡：新掉落间隔下的分数上限（是否 < REF_SCORE）、漏接扣分
 *  ④ 找老板：30s 无限轮 → 分数尺度（远超 600？MAX_SCORE=2000 截断？时间奖励是否变死机制）
 *  ⑤ 节奏：乱点 -5 惩罚后的保底分 / 满分
 *  ⑥ 刷分面：MAX_SCORE、best 截断、0 分、重复提交、跨日
 *
 * 产出：playtest/r15-data/v2-engine-evidence.json
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { initialState, gain } from "../src/engine/state";
import {
  ARCADE_DAILY_LIMIT,
  EARLY_FLOOR,
  GAMES,
  MAX_SCORE,
  REF_SCORE,
  TARGET_IDLE_SECONDS,
  coffeeScore,
  emptyArcade,
  ensureArcade,
  finishGame,
  findScore,
  genBeats,
  genDrops,
  judgeBeat,
  judgeCatch,
} from "../src/engine/minigames";
import { COLLEAGUES, dispatchReward, missionSecondsFor } from "../src/engine/team";

const OUT = "playtest/r15-data";
mkdirSync(OUT, { recursive: true });
const ev: Record<string, unknown> = {};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 复刻引擎奖励公式（minigames.ts:72-77） */
function rewardOf(idleRate: number, score: number): number {
  const capped = Math.min(score, MAX_SCORE);
  const ratio = Math.min(1, capped / REF_SCORE);
  return Math.max(Math.floor(idleRate * TARGET_IDLE_SECONDS * ratio), Math.ceil(EARLY_FLOOR * ratio));
}

/** 某分数要拿满奖励所需的"有效分"（= REF_SCORE） */
const FULL = REF_SCORE;

const STAGES = [
  { key: "opening", label: "开局(0.2/s)", idle: 0.2 },
  { key: "early", label: "早期(1/s)", idle: 1 },
  { key: "mid", label: "中期(1000/s)", idle: 1000 },
  { key: "late", label: "后期(10万/s)", idle: 100000 },
];

function stateWithDispatch(colleagueId: string, missionId: string, level = 1, favor = 0) {
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
  } as ReturnType<typeof initialState>;
}
const oneDispatch = (colleagueId: string, missionId: string, stationIdle: number, level = 1, favor = 0) =>
  dispatchReward(stateWithDispatch(colleagueId, missionId, level, favor), colleagueId, stationIdle);

/* ============================================================
 * ① 三游戏实际可达分数（新规则）
 * ============================================================ */
describe("R15b-1 三游戏可达分数 vs REF_SCORE=600", () => {
  it("接咖啡：新掉落间隔 0.8~1.35s → 掉落数/满分分布", () => {
    const N = 5000;
    const rng = mulberry32(424242);
    const ns: number[] = [];
    const scores: number[] = [];
    for (let i = 0; i < N; i++) {
      const drops = genDrops(30, rng);
      ns.push(drops.length);
      scores.push(coffeeScore(drops.length, 0, drops.length)); // 全接住
    }
    const sorted = [...scores].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.floor((sorted.length - 1) * p)]!;
    const stat = (arr: number[]) => ({
      min: Math.min(...arr),
      max: Math.max(...arr),
      mean: Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)),
    });
    ev.coffee = {
      samples: N,
      drops: stat(ns),
      perfectScore: { ...stat(scores), p50: q(0.5), p90: q(0.9), p99: q(0.99) },
      reachRef600: Number((scores.filter((s) => s >= REF_SCORE).length / N).toFixed(4)),
      maxPossibleDrops: Math.floor((29.5 - 0.8) / 0.8) + 1,
      refScore: REF_SCORE,
    };
    expect(Math.max(...scores)).toBeLessThan(REF_SCORE * 2); // 咖啡尺度小
  });

  it("接咖啡：真实接住率下的期望分（combo 断开 + 漏接 -2）", () => {
    const N = 3000;
    const rng = mulberry32(9988);
    const seeds = Array.from({ length: N }, () => genDrops(30, rng));
    const sim = (p: number) => {
      const r = mulberry32(31);
      let sum = 0;
      let max = 0;
      let full = 0;
      for (const drops of seeds) {
        let caught = 0;
        let missed = 0;
        let combo = 0;
        let maxCombo = 0;
        for (const _d of drops) {
          if (r() < p) {
            caught++;
            combo++;
            maxCombo = Math.max(maxCombo, combo);
          } else {
            combo = 0;
            missed++;
          }
        }
        const sc = coffeeScore(caught, missed, maxCombo);
        sum += sc;
        max = Math.max(max, sc);
        if (sc >= FULL) full++;
      }
      return {
        catchRate: p,
        expectedScore: Number((sum / N).toFixed(1)),
        maxScore: max,
        reachRef600Pct: Number(((full / N) * 100).toFixed(2)),
        rewardAtMidIdle: rewardOf(1000, Math.round(sum / N)),
      };
    };
    ev.coffeeExpectation = [0.5, 0.7, 0.85, 0.95, 1.0].map(sim);
  });

  it("找老板：30s 无限轮 → 分数只由点击数决定（时间奖励在结算归零）", () => {
    // 结算口径：finish 时 leftSec=0 → findScore(c, w, 0) = max(0, 50c - 20w)
    const finalScore = (c: number, w: number) => findScore(c, w, 0);
    const refClicks = Math.ceil(FULL / 50); // 打满 600 分需要 12 个正确
    const byRate = [2, 3, 4, 6, 8].map((cps) => {
      const correct = Math.round(cps * 30);
      const raw = finalScore(correct, 0);
      return {
        clicksPerSec: cps,
        correctIn30s: correct,
        rawScore: raw,
        cappedByMaxScore: Math.min(raw, MAX_SCORE),
        timeToReachRefSec: Number((refClicks / cps).toFixed(1)),
        rewardAtMidIdle: rewardOf(1000, raw),
      };
    });
    // 过程分 vs 结算分：过程分带 floor(leftSec*10)（最高 300），结算归零
    const liveVsFinal = [0.5, 5, 15, 29.9].map((elapsed) => {
      const leftSec = 30 - elapsed;
      return {
        elapsedSec: elapsed,
        liveScoreWith0Correct: findScore(0, 0, leftSec),
        finalScoreWith0Correct: finalScore(0, 0),
      };
    });
    ev.findboss = {
      refScore: REF_SCORE,
      clicksNeededForRef: refClicks,
      byClickRate: byRate,
      liveScoreVsFinal: liveVsFinal,
      timeBonusDeadAtSettlement: true,
      maxRawIn30s: finalScore(30 * 30, 0), // 30 clicks/s 上限假设
    };
    expect(refClicks).toBe(12);
    expect(byRate[0]!.rawScore).toBeGreaterThanOrEqual(FULL); // 2 次/秒也够 600
  });

  it("节奏：满分 1180（无 +perfect*5）+ 乱点 -5 惩罚后的保底", () => {
    const beats = genBeats(30, 120, 0.6);
    // 满分：全部 perfect
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
    // UI 乱点：命中 +10/+20，未命中扣 5（下限 0）
    const spam = (intervalMs: number) => {
      const u = new Set<number>();
      let sc = 0;
      let hits = 0;
      let penalties = 0;
      let pf = 0;
      for (let t = 0.0; t < 30; t += intervalMs / 1000) {
        const r = judgeBeat(beats, t, u);
        if (r.kind !== "miss" && r.index >= 0) {
          u.add(r.index);
          sc += r.score;
          hits++;
          if (r.kind === "perfect") pf++;
        } else {
          sc = Math.max(0, sc - 5);
          penalties++;
        }
      }
      return {
        intervalMs,
        taps: Math.floor(30 / (intervalMs / 1000)),
        hits,
        penalties,
        score: sc,
        perfect: pf,
        reachesRef: sc >= FULL,
        rewardAtMidIdle: rewardOf(1000, sc),
      };
    };
    const scoreToRef = {
      perfectsNeeded: Math.ceil(FULL / 20),
      goodsNeeded: Math.ceil(FULL / 10),
    };
    ev.rhythm = {
      beatCount: beats.length,
      perfectAll: engineScore,
      uiEffectivePerPerfect: 20,
      scoreToRef,
      spam: [spam(100), spam(200), spam(250), spam(300), spam(400), spam(500)],
    };
    expect(engineScore).toBe(1180);
    expect(scoreToRef.perfectsNeeded).toBe(30);
  });
});

/* ============================================================
 * ② 三阶段奖励占比（新公式）
 * ============================================================ */
describe("R15b-2 奖励对比表 v2", () => {
  it("三阶段 × 满分(600/实际可达) vs 30s 挂机 vs 一次派遣", () => {
    const rows = STAGES.map((st) => {
      const idle30 = st.idle * 30;
      const dispatch = oneDispatch("zhou", "stroll", st.idle);
      const at = (score: number) => {
        const reward = rewardOf(st.idle, score);
        return {
          reward,
          vsIdle30: Number((reward / idle30).toFixed(3)),
          idleSecEquivalent: Number((reward / st.idle).toFixed(1)),
          vsDispatch: Number((reward / dispatch).toFixed(2)),
        };
      };
      return {
        stage: st.label,
        idleRate: st.idle,
        idle30s: Number(idle30.toFixed(1)),
        oneDispatch_zhouLv1_stroll: dispatch,
        atRef600: at(REF_SCORE),
        atCoffeeRealMax: at(540), // 咖啡实测上限中位
        atRhythmMax: at(1180),
        atFindbossRealistic: at(9000), // 30s 点 180 个正确
      };
    });
    ev.rewardTable = rows;

    // 阶段漂移（满分奖励 / 30s 挂机）
    const ratio = (idle: number) => Number((rewardOf(idle, REF_SCORE) / (idle * 30)).toFixed(3));
    ev.stageDrift = {
      vs30sIdle: {
        opening_0_2: ratio(0.2),
        early_1: ratio(1),
        mid_1000: ratio(1000),
        late_100000: ratio(100000),
      },
      oldDrift34x_fixed: true,
      // 早期保底覆盖的 idle 区间：floor(idle*25) < 30 → idle < 1.2
      earlyFloorCoversIdleBelow: EARLY_FLOOR / TARGET_IDLE_SECONDS,
    };
    // 每日 3 次满分
    ev.daily3 = STAGES.map((st) => ({
      stage: st.label,
      idleRate: st.idle,
      perGame: rewardOf(st.idle, REF_SCORE),
      daily3: rewardOf(st.idle, REF_SCORE) * ARCADE_DAILY_LIMIT,
      idle90s: Number((st.idle * 90).toFixed(1)),
    }));
    // 每日 3 次若全打"咖啡真实上限 540"
    ev.daily3Coffee = STAGES.map((st) => ({
      stage: st.label,
      daily3AtCoffee540: rewardOf(st.idle, 540) * ARCADE_DAILY_LIMIT,
      daily3AtRef600: rewardOf(st.idle, REF_SCORE) * ARCADE_DAILY_LIMIT,
      lossPct: Number(
        (((rewardOf(st.idle, REF_SCORE) - rewardOf(st.idle, 540)) / rewardOf(st.idle, REF_SCORE)) * 100).toFixed(1),
      ),
    }));
    expect(rows.length).toBe(4);
  });
});

/* ============================================================
 * ③ 唯一支配 / 最优策略 v2
 * ============================================================ */
describe("R15b-3 期望奖励与最优策略", () => {
  it("各游戏'拿到满奖励'所需水平 + 期望奖励（中后期）", () => {
    // 找老板：12 个正确 ≈ 4-6 秒（手速 2-3 次/秒）→ 几乎必满
    // 节奏：30 perfect / 59 拍（约 51%）或 60 good → 中等
    // 咖啡：满分 20n，n 中位 ~27 → 540 < 600 → 天花板 < 满奖励
    const midIdle = 1000;
    const games = [
      {
        game: "找老板",
        fullRewardScore: FULL,
        effortForFull: "12 个正确；2 次/秒约 6s，3 次/秒约 4s（30s 内可点 60~240 个）",
        realisticScore: 9000,
        expectedReward: rewardOf(midIdle, 9000),
        ratioOfFull: 1,
        canFull: true,
      },
      {
        game: "节奏点击",
        fullRewardScore: FULL,
        effortForFull: "30 perfect（51% 命中）/ 60 good；熟练玩家正拍点击可达",
        realisticScore: 900,
        expectedReward: rewardOf(midIdle, 900),
        ratioOfFull: Number((900 / FULL).toFixed(2)),
        canFull: true,
      },
      {
        game: "接咖啡",
        fullRewardScore: FULL,
        effortForFull: "需要掉落数 ≥30（概率见 coffee.reachRef600），且全接住",
        realisticScore: 540,
        expectedReward: rewardOf(midIdle, 540),
        ratioOfFull: Number((540 / FULL).toFixed(3)),
        canFull: false,
      },
    ];
    ev.strategy = {
      midIdle,
      fullRewardThreshold: FULL,
      games,
      argmax: games.slice().sort((a, b) => b.expectedReward - a.expectedReward)[0]!.game,
    };
    // 咖啡满奖励不可达（中位掉落数 < 30）
    expect(games[2]!.canFull).toBe(false);
  });

  it("咖啡局内掉落数 ≥30（能到 600）的概率", () => {
    const N = 20000;
    const rng = mulberry32(7);
    let ge30 = 0;
    for (let i = 0; i < N; i++) if (genDrops(30, rng).length >= 30) ge30++;
    ev.coffeeReach600Probability = Number((ge30 / N).toFixed(4));
    expect(ev.coffeeReach600Probability).toBeLessThan(0.2); // 大多数局打不满
  });
});

/* ============================================================
 * ④ 刷分面 / 自洽性 v2
 * ============================================================ */
describe("R15b-4 刷分面与自洽性", () => {
  const fresh = () => ({ ...gain(initialState(), 1e9), arcade: emptyArcade("2026-11-27") });

  it("MAX_SCORE 截断 / best 入档 / 重复提交 / 0 分", () => {
    const cap = finishGame(fresh(), "findboss", 9000, 1000)!;
    const over = finishGame(fresh(), "findboss", 1e9, 1000)!;
    const zero = finishGame(fresh(), "coffee", 0, 1000)!;
    const neg = finishGame(fresh(), "coffee", -5, 1000)!;
    const nan = finishGame(fresh(), "coffee", Number.NaN, 1000);
    let s = fresh();
    for (let i = 0; i < ARCADE_DAILY_LIMIT; i++) s = finishGame(s, "rhythm", 100, 1000)!.state;
    const fourth = finishGame(s, "rhythm", 100, 1000);
    ev.capAndExploit = {
      maxScore: MAX_SCORE,
      raw9000_bestRecorded: cap.state.arcade.best.findboss,
      raw9000_reward: cap.reward,
      raw1e9_rewardEquals9000: over.reward === cap.reward,
      raw1e9_bestRecorded: over.state.arcade.best.findboss,
      zeroConsumes: zero.reward === 0 && zero.state.arcade.played === 1,
      negConsumes: neg.reward === 0 && neg.state.arcade.played === 1,
      nanConsumes: nan!.reward === 0,
      fourthBlocked: fourth === null,
      uiResultShowsRawButBestCapped: "结算屏显示原始分（如 9000），入档 best 截到 2000 → 菜单'最高 2000'",
    };
    expect(cap.state.arcade.best.findboss).toBe(MAX_SCORE);
    expect(cap.reward).toBe(Math.floor(1000 * 25)); // ratio 封顶 1
  });

  it("(1-ratio) 与奖励：分数 600 以上不再增加奖励（最高分无收益联动）", () => {
    const r600 = finishGame(fresh(), "rhythm", 600, 1000)!.reward;
    const r1180 = finishGame(fresh(), "rhythm", 1180, 1000)!.reward;
    const r2000 = finishGame(fresh(), "rhythm", 2000, 1000)!.reward;
    ev.rewardSaturation = {
      at600: r600,
      at1180: r1180,
      at2000: r2000,
      saturated: r600 === r1180 && r1180 === r2000,
    };
    expect(ev.rewardSaturation.saturated).toBe(true);
  });

  it("跨日重置 / best 保留 / 0 分文案面", () => {
    const s = finishGame(fresh(), "coffee", 555, 1000)!.state;
    const next = ensureArcade(s, "2026-11-28");
    ev.crossDay = {
      sameDaySame: ensureArcade(s, "2026-11-27") === s,
      nextPlayed: next.arcade.played,
      bestKept: next.arcade.best.coffee,
      zeroScoreText: "结算屏：本局 0 分，次数已扣 1 次（arcade.ts:313）",
    };
    expect(next.arcade.best.coffee).toBe(555);
  });

  it("早期保底：谁能拿满 / 拿到多少", () => {
    const rows = STAGES.map((st) => {
      const full = rewardOf(st.idle, REF_SCORE);
      const atHalf = rewardOf(st.idle, REF_SCORE / 2);
      return {
        stage: st.label,
        idleRate: st.idle,
        full,
        half: atHalf,
        fullVs30sIdle: Number((full / (st.idle * 30)).toFixed(3)),
        fullInIdleSeconds: Number((full / st.idle).toFixed(1)),
      };
    });
    ev.earlyFloor = {
      EARLY_FLOOR,
      TARGET_IDLE_SECONDS,
      REF_SCORE,
      rows,
      // 满分奖励折算挂机秒数：开局=150s，早期=30s，中后期=25s
      note: "开局 0.2/s 时 30 摸鱼值 = 150 秒挂机（5×同局时长）；idle≥1.2 后恒为 25s",
    };
  });
});

describe("R15b 汇总落盘", () => {
  it("写入 v2 证据 JSON", () => {
    writeFileSync(`${OUT}/v2-engine-evidence.json`, JSON.stringify(ev, null, 2));
    expect(Object.keys(ev).length).toBeGreaterThan(8);
  });
});