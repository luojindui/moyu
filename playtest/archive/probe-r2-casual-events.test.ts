import { describe, it, expect } from "vitest";
import { initialState, gain } from "../src/engine/state";
import { doClick, clickPowerOf } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { effectOf } from "../src/engine/upgrades";
import {
  newEventState,
  scheduleEvents,
  onBossTap,
  onMemeTap,
  bossSurviveReward,
  BOSS_DURATION,
  BOSS_INTERVAL_MIN,
  BOSS_INTERVAL_MAX,
  MEME_DURATION,
  MEME_INTERVAL_MIN,
  MEME_INTERVAL_MAX,
} from "../src/engine/events";

/**
 * R2 复测点②：随机事件对休闲节奏的打扰感
 * 模型（休闲玩家）：
 *  - 点击流：前 15s 兴奋 2.5/s，之后衰减到 0.8/s（上班偷玩）
 *  - 巡逻：横幅弹出后 0.8s 注意力延迟，期间已计划的点击会"手滑"被逮，之后忍住（手指停）
 *  - 丢梗：注意到延迟 0.5-1.5s，命中 +5×点击力；15% 概率根本没看到
 * 跑 30min×20 seed + 单个 2min 碎片视角，统计冲突率/损失/奖励/收益占比。
 */

const DT = 0.05;
const SEEDS = 20;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Stats {
  bossCount: number; caught: number; lostTotal: number; surviveTotal: number;
  memeCount: number; memeHit: number; memeEarnTotal: number;
  bossTapConflict: number; // 巡逻窗口内"本应点击"的次数（节律被掐断程度）
  sessionIncome: number; eventIncome: number; frozenSeconds: number;
}

/** REACTION_MS：横幅弹出→玩家停手的反应延迟（秒）。默认 0.8，敏感性分析时调低 */
let REACTION_S = 0.8;

/** 场景：中盘进度（clickPower 179, idle 335/s，对应 fragments s4 末态附近） */
function midState() {
  const s = initialState();
  s.levels = { coffee: 40, water: 30, chair: 12, phone: 32, toilet: 20, group: 10 };
  s.moyu = 100_000;
  s.totalEarned = 500_000;
  return s;
}

function runSession(seconds: number, seed: number, state0 = midState()): Stats {
  const rng = mulberry32(seed);
  let s = { ...state0, levels: { ...state0.levels } };
  const es = newEventState();
  const st: Stats = { bossCount: 0, caught: 0, lostTotal: 0, surviveTotal: 0, memeCount: 0, memeHit: 0, memeEarnTotal: 0, bossTapConflict: 0, sessionIncome: 0, eventIncome: 0, frozenSeconds: 0 };
  let tapCredit = 0;
  let bossStartedAt = -1;
  let bossHandled = false; // 反应延迟内的手滑只结算一次
  let memeNoticeAt = -1;
  let prevBoss = false;

  for (let t = 0; t < seconds; t += DT) {
    scheduleEvents(es, t, rng);
    const bossActive = es.bossUntil > t;
    const memeActive = es.memeUntil > t;
    if (bossActive && !prevBoss) { st.bossCount++; bossStartedAt = t; bossHandled = false; }
    if (prevBoss && !bossActive && !es.bossCaught) {
      const r = bossSurviveReward(s, es);
      st.surviveTotal += r;
      s = gain(s, r);
      st.eventIncome += r;
    }
    prevBoss = bossActive;

    // 丢梗：出现后安排一次"注意到"的点击
    if (memeActive && memeNoticeAt < 0) {
      st.memeCount++;
      if (rng() < 0.85) memeNoticeAt = t + 0.5 + rng() * 1.0; // 15% 没看到
    }
    if (!memeActive) { memeNoticeAt = -1; }

    // 休闲点击流（巡逻时忍住：延迟反应后停手）
    if (!bossActive || t - bossStartedAt < REACTION_S) {
      const tps = t < 15 ? 2.5 : Math.max(0.8, 2.5 - t * 0.014);
      tapCredit += tps * DT;
      while (tapCredit >= 1) {
        tapCredit -= 1;
        if (bossActive) {
          st.bossTapConflict++;
          if (!bossHandled) { // 反应延迟内的手滑
            const r = onBossTap(s, es);
            if (r.caught) {
              s = r.state; bossHandled = true;
              st.caught++; st.lostTotal += r.lost;
              st.sessionIncome -= r.lost; // 净损失
            }
          }
          continue; // 之后忍住：这次点击吞掉（不产出）
        }
        if (memeActive && memeNoticeAt >= 0 && t >= memeNoticeAt) {
          const r = onMemeTap(s, es);
          st.memeHit++; st.memeEarnTotal += r.earned;
          s = r.state; st.eventIncome += r.earned;
          memeNoticeAt = -1;
          continue;
        }
        const before = s.moyu;
        s = doClick(s);
        st.sessionIncome += s.moyu - before;
      }
    } else {
      st.frozenSeconds += DT;
    }
    s = advance(s, DT);
    st.sessionIncome += effectOf(s).idleRate * DT;
  }
  return st;
}

describe("R2-② 随机事件打扰感（休闲节奏 30min×20 seed）", () => {
  it("事件频率、冲突率、收益占比", () => {
    const runs: Stats[] = [];
    for (let i = 0; i < SEEDS; i++) runs.push(runSession(1800, 1000 + i));
    const avg = (f: (s: Stats) => number) => runs.reduce((a, s) => a + f(s), 0) / runs.length;
    console.log(`[30min×${SEEDS}seed] 巡逻 ${avg((s) => s.bossCount).toFixed(1)} 次（间隔${BOSS_INTERVAL_MIN}-${BOSS_INTERVAL_MAX}s，每次${BOSS_DURATION}s）`);
    console.log(`  被逮率 ${(avg((s) => s.caught) / Math.max(1, avg((s) => s.bossCount)) * 100).toFixed(0)}% | 巡逻窗口内本应点击均 ${avg((s) => s.bossTapConflict).toFixed(1)} 次 | 手指冻结 ${avg((s) => s.frozenSeconds).toFixed(0)}s（占 ${(avg((s) => s.frozenSeconds) / 1800 * 100).toFixed(1)}%）`);
    console.log(`  被逮损失均 ${avg((s) => s.lostTotal).toFixed(0)} vs 安然奖均 ${avg((s) => s.surviveTotal).toFixed(0)}（净 ${avg((s) => s.surviveTotal - s.lostTotal).toFixed(0)}）`);
    console.log(`  丢梗 ${avg((s) => s.memeCount).toFixed(1)} 次（间隔${MEME_INTERVAL_MIN}-${MEME_INTERVAL_MAX}s，${MEME_DURATION}s 窗口），命中均 ${avg((s) => s.memeHit).toFixed(1)}，梗收益均 ${avg((s) => s.memeEarnTotal).toFixed(0)}`);
    console.log(`  事件净收益 ${avg((s) => s.eventIncome).toFixed(0)} / session 总收入 ${avg((s) => s.sessionIncome).toFixed(0)} = ${(avg((s) => s.eventIncome) / Math.max(1, avg((s) => s.sessionIncome)) * 100).toFixed(1)}%`);
    expect(avg((s) => s.bossCount)).toBeGreaterThan(8); // 30min 应有 ~12-20 次
  }, 20_000);

  it("敏感性：反应延迟 0.3/0.5/0.8s 的被逮率（红横幅显眼度决定真实值）", () => {
    for (const r of [0.3, 0.5, 0.8]) {
      REACTION_S = r;
      const runs: Stats[] = [];
      for (let i = 0; i < SEEDS; i++) runs.push(runSession(1800, 4000 + i));
      const avg = (f: (s: Stats) => number) => runs.reduce((a, s) => a + f(s), 0) / runs.length;
      const rate = avg((s) => s.caught) / Math.max(1, avg((s) => s.bossCount));
      const net = avg((s) => s.surviveTotal - s.lostTotal);
      console.log(`反应${r}s: 被逮率 ${(rate * 100).toFixed(0)}% | 每30min净事件收益 ${net.toFixed(0)}（正=忍奖>罚款）`);
    }
    REACTION_S = 0.8;
  }, 20_000);

  it("2min 碎片视角：一个 session 撞到几次事件", () => {
    const hits: { boss: number; meme: number; firstMeme: number; firstBoss: number }[] = [];
    for (let i = 0; i < SEEDS; i++) {
      const s = runSession(120, 2000 + i);
      hits.push({ boss: s.bossCount, meme: s.memeCount, firstMeme: 0, firstBoss: 0 });
    }
    const avg = (f: (h: (typeof hits)[0]) => number) => hits.reduce((a, h) => a + f(h), 0) / hits.length;
    console.log(`[2min碎片] 巡逻均 ${avg((h) => h.boss).toFixed(2)} 次，丢梗均 ${avg((h) => h.meme).toFixed(2)} 次（理论：meme 45-75s 必到 1-2 次，boss 90-150s 半数 session 遇 1 次）`);
    expect(avg((h) => h.meme)).toBeGreaterThan(0.8); // 每 session 至少 ~1 梗
    expect(avg((h) => h.boss)).toBeLessThan(1); // 巡逻不该每碎片都出现
  });

  it("早期（0 进度）被逮痛感：底薪党余额小，min(10) 惩罚 vs 安然奖 50", () => {
    const early = initialState(); // 零进度：click=1, idle=0.2
    const st = runSession(600, 3000, early);
    console.log(`[早期10min] 巡逻${st.bossCount} 被逮${st.caught}次 损失${st.lostTotal.toFixed(0)}（每次 max(10,5%)） 安然奖${st.surviveTotal.toFixed(0)}（每次 max(50, 5×0.2=1→50)） 梗收益${st.memeEarnTotal.toFixed(0)}（5×点击力=5）`);
    console.log(`[早期判断] 早期被逮一次 = 白敲 10 下（click=1），安然奖 50 = 50 下 —— "忍"有明确正向激励，"手滑"代价温和`);
    expect(st.surviveTotal).toBeGreaterThan(0);
  });

  it("中盘被逮痛感对比（R5：罚款与余额脱钩，按挂机秒计）", () => {
    const s = midState();
    const es = newEventState();
    es.bossUntil = 999; es.bossCaught = false;
    const reward = bossSurviveReward(s, es); // 先算未被抓时的安然奖
    const r = onBossTap(s, es);
    const idle = effectOf(s).idleRate;
    console.log(`[中盘] idle=${idle}/s：安然奖 ${reward.toFixed(0)}（8×idle）vs 被逮一次扣 ${r.lost.toFixed(0)}（0.5×idle，整段封顶 6×idle）`);
    // ✅ R5：罚款与余额脱钩（防花光规避），单次扣 0.5×idleRate
    expect(r.lost).toBeCloseTo(Math.max(10, 0.5 * idle), 6);
    // 同余额量级无关：换个余额罚款不变
    const es2 = newEventState();
    es2.bossUntil = 999;
    es2.bossStartAt = 0;
    const r2 = onBossTap({ ...s, moyu: 1_000_000 }, es2, 1);
    expect(r2.lost).toBeCloseTo(r.lost, 6);
  });
});
