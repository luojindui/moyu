import { describe, it, expect } from "vitest";
import { initialState, gain } from "../src/engine/state";
import { doClick } from "../src/engine/actions";
import {
  newEventState,
  scheduleEvents,
  onBossTap,
  bossSurviveReward,
  BOSS_DURATION,
  BOSS_GRACE_SECONDS,
  type EventState,
} from "../src/engine/events";
import { effectOf } from "../src/engine/upgrades";

/**
 * 挑战党探针 R3-①：老板巡逻的风险回报曲线。
 * 问题：存在"值得赌"的瞬间吗？忍 vs 不忍 的期望差由什么决定？
 * 方法：用真实引擎函数（onBossTap/bossSurviveReward）在真实进度状态上算 EV。
 * 状态取自 playtest/report.json（simulate.test.ts 实跑检查点）。
 */

/** 用 report.json 检查点的 levels 构造真实进度状态，moyu 可指定（模拟囤积/花光） */
function stateFrom(levels: Record<string, number>, moyu: number) {
  return { ...initialState(), levels: { ...levels }, moyu, totalEarned: moyu };
}

/** 开一场巡逻（直接操纵 EventState 到窗口内） */
function bossOpen(es: EventState, now: number) {
  es.bossUntil = now + BOSS_DURATION;
  es.bossStartAt = now;
  es.bossCaught = false;
}

/** 场景 A（忍）：巡逻期不点，8s 后拿安然奖励 */
function evDodge(state: ReturnType<typeof stateFrom>, es: EventState, now: number) {
  bossOpen(es, now);
  const reward = bossSurviveReward(state, es); // 未被抓
  return { delta: reward, reward, penalty: 0 };
}

/** 场景 B（手滑/硬刚）：grace 过后照点。onBossTap 是唯一入口（main.ts L92） */
function evClickThrough(state: ReturnType<typeof stateFrom>, es: EventState, now: number, tapsPerSec: number) {
  bossOpen(es, now);
  let st = state;
  let tapped = 0;
  let caught = 0;
  let penalty = 0;
  let earned = 0;
  const dt = 1 / tapsPerSec;
  for (let t = 0; t < BOSS_DURATION; t += dt) {
    tapped++;
    const r = onBossTap(st, es, now + t);
    st = r.state;
    if (r.caught) caught++;
    penalty += r.lost;
  }
  earned = st.moyu - state.moyu; // 应为负且无任何点击收入
  return { delta: earned, reward: 0, penalty, tapped, caught };
}

describe("R3-① 老板巡逻风险回报", () => {
  it("真实进度检查点：忍 vs 不忍 期望表（引擎实跑）", () => {
    // (来源: report.json casual/clicker 检查点 levels)
    const states: { label: string; levels: Record<string, number>; moyu: number }[] = [
      { label: "m=3min casual(花光型)", levels: { coffee: 6 }, moyu: 50 },
      { label: "m=10min casual(中度囤积)", levels: { coffee: 14, phone: 5, water: 1 }, moyu: 5984 },
      { label: "m=60min casual(重囤积)", levels: { coffee: 39, phone: 31, water: 26, toilet: 13, chair: 11 }, moyu: 513874 },
      { label: "m=180min casual(重囤积)", levels: { coffee: 74, phone: 66, water: 61, toilet: 48, chair: 46, group: 35, meeting: 21, deep: 9 }, moyu: 2074746 },
      { label: "m=180min clicker(花光型)", levels: { coffee: 91, phone: 82, water: 77, toilet: 65, chair: 62, group: 51, meeting: 38, deep: 25, retire: 11 }, moyu: 3000 },
    ];
    const rows: unknown[] = [];
    for (const s of states) {
      for (const cps of [1, 3, 8]) {
        const st = stateFrom(s.levels, s.moyu);
        const es = newEventState();
        const A = evDodge(st, es, 100);
        const B = evClickThrough(st, es, 100, cps);
        const { idleRate } = effectOf(st);
        rows.push({
          scene: s.label,
          balance: s.moyu,
          idleRate: +idleRate.toFixed(1),
          tapsPerSec: cps,
          忍EV: +A.delta.toFixed(1),
          点EV: +B.delta.toFixed(1),
          点EV中点击收入: +(B.delta + B.penalty).toFixed(1), // 应恒为 0
          被抓次数: B.caught,
          罚款: +B.penalty.toFixed(1),
          罚款换算挂机秒: +(B.penalty / idleRate).toFixed(1),
          奖励换算挂机秒: +(A.reward / idleRate).toFixed(1),
          罚奖比: +(B.penalty / A.reward).toFixed(2),
          忍优优势: +(A.delta - B.delta).toFixed(1),
        });
      }
    }
    console.table(rows);
    // ✅ R3 修复回归（challenger #1 偷点）：赌点已存在——高点击力/花光型场景下硬刚占优
    const gambles = (rows as any[]).filter((r) => r.忍EV <= r.点EV);
    console.log(`赌点场景数: ${gambles.length}/${(rows as any[]).length}`);
    expect(gambles.length).toBeGreaterThan(0); // 有值得赌的瞬间
    // 低点击力/重度囤积场景仍是"忍"占优（保护休闲党，不改挂机路线）
    const dodgeWins = (rows as any[]).filter((r) => r.忍EV > r.点EV);
    expect(dodgeWins.length).toBeGreaterThan(0);
  });

  it("罚款 vs 囤积比例：惩罚跟余额走，不跟风险选择走", () => {
    // idleRate 固定 189.2（m=60min casual），余额从 0 扫到 1 小时挂机收入
    const levels = { coffee: 39, phone: 31, water: 26, toilet: 13, chair: 11 };
    const idleRate = effectOf(stateFrom(levels, 0)).idleRate;
    const rows: unknown[] = [];
    for (const bankedSeconds of [0, 10, 60, 200, 600, 3600]) {
      const moyu = bankedSeconds * idleRate;
      const st = stateFrom(levels, moyu);
      const es = newEventState();
      bossOpen(es, 100);
      const r = onBossTap(st, es, 100 + BOSS_GRACE_SECONDS + 0.01);
      // 偷点后：余额 = moyu + 点击收入
      const moyuAfterIncome = moyu + r.income;
      const idle = effectOf(st).idleRate;
      const rewardClean = bossSurviveReward(st, { ...es, bossCaught: false });
      rows.push({
        囤积挂机秒: bankedSeconds,
        余额: Math.round(moyu),
        每击罚款_半秒挂机: Math.round(Math.max(10, 0.5 * idle)),
        整段封顶_6秒挂机: Math.round(Math.max(10, 6 * idle)),
        实扣: r.lost,
        实扣挂机秒: +(r.lost / idleRate).toFixed(1),
        安然奖励: rewardClean,
        奖励挂机秒: +(rewardClean / idleRate).toFixed(1),
        罚奖比: +(r.lost / rewardClean).toFixed(2),
      });
      const expectLost = Math.min(Math.max(10, 0.5 * idle), Math.max(10, 6 * idle), moyuAfterIncome);
      if (Math.abs(r.lost - expectLost) > 1e-6) throw new Error("罚款公式不符");
    }
    console.table(rows);
  });

  it("0.8s 宽限吸收率：不同点击频率下首击落在宽限内的概率（蒙特卡洛）", () => {
    // 玩家以 rate cps 匀速点击，横幅出现在随机相位 → 首击延时 ~ U(0, 1/rate)
    const rows: unknown[] = [];
    for (const rate of [0.5, 1, 2, 3, 5, 8]) {
      let inGrace = 0;
      const N = 20000;
      for (let i = 0; i < N; i++) {
        const phase = Math.random() / rate;
        if (phase < BOSS_GRACE_SECONDS) inGrace++;
      }
      rows.push({ cps: rate, 首击免罚率: +(inGrace / N).toFixed(3), 理论值: +Math.min(1, BOSS_GRACE_SECONDS * rate).toFixed(3) });
    }
    console.table(rows);
  });

  it("R3 修复回归：巡逻期偷点有收入（原缺陷：零收入→无赌点）", () => {
    const st = stateFrom({ coffee: 39 }, 10000);
    const es = newEventState();
    bossOpen(es, 100);
    const CLICKS = 24;
    let s = st;
    let caught = false;
    for (let i = 0; i < CLICKS; i++) {
      const r = onBossTap(s, es, 100 + BOSS_GRACE_SECONDS + 0.01 + i / 60);
      s = r.state;
      caught = caught || r.caught;
    }
    const duringBoss = { earned: s.totalEarned - st.totalEarned, moyu: s.moyu - st.moyu };
    // 对照：无巡逻同样 24 次 doClick
    let s2 = st;
    for (let i = 0; i < CLICKS; i++) s2 = doClick(s2);
    const noBoss = { earned: s2.totalEarned - st.totalEarned, moyu: s2.moyu - st.moyu };
    console.log({ duringBoss, noBoss, caught });
    // ✅ 已修复（challenger #1 偷点）：收入与无巡逻时完全等价
    expect(duringBoss.earned).toBe(noBoss.earned);
    expect(caught).toBe(true); // 过了宽限 → 被逮
    expect(duringBoss.moyu).toBe(noBoss.moyu - 10); // 同收入下被扣一次罚款 → 真赌点
  });

  it("假如巡逻期点击保留收入（假想规则）的风险回报：找真赌点", () => {
    // 反事实分析：若点击照常给钱，硬刚 8s 的收入 = 8×cps×cp，扣罚款。
    // 与忍（拿 5s 挂机奖励）比较，求 break-even 点击力。
    const rows: unknown[] = [];
    for (const cfg of [
      { label: "m=60 casual", levels: { coffee: 39, phone: 31, water: 26, toilet: 13, chair: 11 }, moyu: 513874 },
      { label: "m=180 casual", levels: { coffee: 74, phone: 66, water: 61, toilet: 48, chair: 46, group: 35, meeting: 21, deep: 9 }, moyu: 2074746 },
    ]) {
      const st = stateFrom(cfg.levels, cfg.moyu);
      const { idleRate } = effectOf(st);
      const es = newEventState();
      bossOpen(es, 100);
      const penalty = onBossTap(st, es, 100 + BOSS_GRACE_SECONDS + 0.01).lost;
      es.bossCaught = false;
      const reward = bossSurviveReward(st, es);
      for (const cps of [1, 3, 8]) {
        const cp = 1 + effectOf(st).clickPower;
        const clickIncome = BOSS_DURATION * cps * cp;
        rows.push({
          scene: cfg.label,
          cps,
          假想硬刚净得: Math.round(clickIncome - penalty),
          忍得: Math.round(reward),
          硬刚更优: clickIncome - penalty > reward,
          硬刚收益挂机秒: +(((clickIncome - penalty) - reward) / idleRate).toFixed(1),
        });
      }
    }
    console.table(rows);
  });
});
