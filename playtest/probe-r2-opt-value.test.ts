/**
 * probe-r2-opt-value.test.ts — r2 数值党探针④：九档边际性价比与交叉点 / 策略对比 / 事件经济占比 / 段位时间
 * 运行：npx vitest run playtest/probe-r2-opt-value.test.ts
 */
import { describe, it } from "vitest";
import { UPGRADES, costOf, marginalEffect, effectOf } from "../src/engine/upgrades";
import { RANKS } from "../src/engine/titles";
import { initialState, gain, type GameState } from "../src/engine/state";
import { doClick } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import {
  newEventState, scheduleEvents, onBossTap, onMemeTap, bossSurviveReward,
} from "../src/engine/events";
import {
  runSim, makeGreedy, makeGreedyFilter, byPrice, engineCost, engineEffect, phaseStats,
} from "./probe-opt-lib";

describe("九档边际性价比（含里程碑跳变）", () => {
  it("第 N 级买价 ÷ 每单位效果（里程碑前后对比）", { timeout: 120_000 },
      () => {
    console.log("\n===== r2 边际性价比表（引擎 marginalEffect，含 ×2/20 跳变） =====");
    const levelsList = [0, 10, 18, 19, 20, 30, 38, 39, 40, 60];
    for (const u of UPGRADES) {
      const parts = levelsList.map((lv) => {
        const m = marginalEffect(u.id, lv);
        const eff = u.clickPower ? m.clickPower : m.idleRate;
        const price = costOf(u.id, lv);
        return `lv${lv}:${Math.round(price / Math.max(eff, 1))}`;
      });
      console.log(`  ${u.name.padEnd(6)}(每级+${u.clickPower ?? u.idleRate}${u.clickPower ? "点击力" : "/s"}): ${parts.join(" ")}`);
    }
  });

  it("交叉点重算：黄金期是否拉开到 5-6 级；里程碑是否重置黄金期", { timeout: 120_000 },
      () => {
    console.log("\n===== r2 交叉点（边际成本/效果 > 下一档裸价/效果 的等级序列，前 3 次） =====");
    const idleLadder = ["phone", "toilet", "group", "meeting", "deep", "retire"];
    const clickLadder = ["coffee", "water", "chair"];
    const crossings = (aId: string, bId: string) => {
      const a = UPGRADES.find((u) => u.id === aId)!;
      const b = UPGRADES.find((u) => u.id === bId)!;
      const out: number[] = [];
      let dominated = false;
      for (let lv = 0; lv <= 80; lv++) {
        const mA = marginalEffect(aId, lv);
        const unitA = a.clickPower ? mA.clickPower : mA.idleRate;
        const unitB = b.clickPower ?? b.idleRate!;
        const dominatedNow = costOf(aId, lv) / Math.max(unitA, 1) > costOf(bId, 0) / unitB;
        if (dominatedNow && !dominated) out.push(lv);
        dominated = dominatedNow;
      }
      return out;
    };
    for (let i = 0; i < idleLadder.length - 1; i++) {
      const a = UPGRADES.find((u) => u.id === idleLadder[i])!;
      const b = UPGRADES.find((u) => u.id === idleLadder[i + 1])!;
      console.log(`  挂机线 ${a.name}→${b.name}: 被压制的等级序列起点 = [${crossings(idleLadder[i]!, idleLadder[i + 1]!).join(", ")}]（里程碑后重置为再次优选）`);
    }
    for (let i = 0; i < clickLadder.length - 1; i++) {
      const a = UPGRADES.find((u) => u.id === clickLadder[i])!;
      const b = UPGRADES.find((u) => u.id === clickLadder[i + 1])!;
      console.log(`  点击线 ${a.name}→${b.name}: [${crossings(clickLadder[i]!, clickLadder[i + 1]!).join(", ")}]`);
    }
  });
});

describe("策略对比（tps=3，180min）", () => {
  it("贪心立即花光 vs 攒钱等最优 vs cheapest(stock) vs 只买挂机项", { timeout: 120_000 },
      () => {
    const waitBest: Parameters<typeof runSim>[0]["orderFn"] = (s, t, tp, inc) =>
      makeGreedy(engineCost, engineEffect)(s, t, tp, inc).slice(0, 1);
    const strategies: [string, Parameters<typeof runSim>[0]][] = [
      ["贪心-立即花光", { orderFn: makeGreedy(engineCost, engineEffect) }],
      ["逐价便宜优先(stock)", { orderFn: byPrice(engineCost) }],
      ["攒钱等最优项", { orderFn: waitBest }],
      ["只买挂机项", { orderFn: makeGreedyFilter(engineCost, engineEffect, "idle") }],
    ];
    console.log("\n===== r2 策略对比 tps=3 @180min =====");
    for (const [name, opts] of strategies) {
      const run = runSim({ minutes: 180, tps: 3, dt: 0.25, ...opts, checkpointMinutes: [180] });
      const end = run.curve.at(-1)!;
      console.log(
        `  ${name.padEnd(18)}: income@180=${String(end.income).padStart(10)}/s  购买${String(run.purchases).padStart(4)}次  idle=${end.ir}/s  cp=${end.cp}`,
      );
    }
  });
});

describe("事件经济占比（引擎事件真链路 + 贪心购买）", () => {
  /** 完整重放事件循环（对齐 simulate.test.ts 口径），购买改贪心；分前 30min / 后 150min 统计 */
  function run180(tps: (t: number) => number, initialTaps: number, dodge: boolean, tapMemes: boolean) {
    const DT = 0.25;
    let state = initialState();
    const es = newEventState();
    let s = 987654321 >>> 0;
    const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    let tapCredit = 0;
    let bossRewards = 0, memeEarned = 0, caughtLoss = 0, bossCount = 0;
    let baseIncome = 0;
    let prevBossActive = false;
    let prevMemeActive = false;
    const order = makeGreedy(engineCost, engineEffect);
    const phases = { early: { base: 0, ev: 0 }, late: { base: 0, ev: 0 } };
    // 初始点击（挂机党）
    for (let i = 0; i < initialTaps; i++) {
      const before = state.moyu;
      state = doClick(state);
      baseIncome += state.moyu - before;
      phases.early.base += state.moyu - before;
    }
    const totalSec = 180 * 60;
    for (let i = 0; i * DT <= totalSec; i++) {
      const t = i * DT;
      scheduleEvents(es, t, rng);
      const bossActive = es.bossUntil > t;
      const effTps = bossActive && dodge ? 0 : tps(t);
      tapCredit += effTps * DT;
      while (tapCredit >= 1) {
        tapCredit -= 1;
        if (bossActive) {
          const r = onBossTap(state, es);
          state = r.state;
          if (r.caught) caughtLoss += r.lost;
        } else {
          const before = state.moyu;
          state = doClick(state);
          const g = state.moyu - before;
          baseIncome += g;
          phases[t < 1800 ? "early" : "late"].base += g;
        }
      }
      const memeActive = es.memeUntil > t;
      if (tapMemes && memeActive && !prevMemeActive) {
        const r = onMemeTap(state, es);
        state = r.state;
        memeEarned += r.earned;
        phases[t < 1800 ? "early" : "late"].ev += r.earned;
      }
      prevMemeActive = memeActive;
      if (prevBossActive && !bossActive) {
        if (!es.bossCaught) {
          const reward = bossSurviveReward(state, es);
          state = gain(state, reward);
          bossRewards += reward;
          phases[t < 1800 ? "early" : "late"].ev += reward;
        }
        bossCount++;
      }
      prevBossActive = bossActive;
      const ig = effectOf(state).idleRate * DT;
      if (ig > 0) {
        state = gain(state, ig);
        baseIncome += ig;
        phases[t < 1800 ? "early" : "late"].base += ig;
      }
      for (;;) {
        let bought = false;
        for (const id of order(state, t, effTps, effectOf(state).idleRate)) {
          const price = engineCost(id, state.levels[id] ?? 0);
          if (price > 0 && state.moyu >= price) {
            state = { ...state, moyu: state.moyu - price, levels: { ...state.levels, [id]: (state.levels[id] ?? 0) + 1 } };
            bought = true;
            break;
          }
        }
        if (!bought) break;
      }
    }
    return { state, bossRewards, memeEarned, caughtLoss, baseIncome, bossCount, phases };
  }

  it("三画像（dodge+点梗）：安然/丢梗/被抓 占基础收入比", { timeout: 120_000 },
      () => {
    console.log("\n===== 事件经济实测（180min 贪心，躲避+点梗） =====");
    const cases: [string, (t: number) => number, number][] = [
      ["casual(1tps)", () => 1, 0],
      ["clicker(3tps)", () => 3, 0],
      ["idle(0tps,10下)", () => 0, 10],
    ];
    for (const [name, tps, taps] of cases) {
      const r = run180(tps, taps, true, true);
      const ev = r.bossRewards + r.memeEarned;
      const e = r.phases.early, l = r.phases.late;
      console.log(
        `  ${name.padEnd(15)}: 事件合计=${(ev / 1e4).toFixed(1)}万 (安然${(r.bossRewards / 1e4).toFixed(1)}万 ×${r.bossCount}次 / 丢梗${(r.memeEarned / 1e4).toFixed(1)}万)  基础收入=${(r.baseIncome / 1e4).toFixed(0)}万  总占比=${((ev / (ev + r.baseIncome)) * 100).toFixed(1)}%  前30min=${((e.ev / (e.ev + e.base)) * 100).toFixed(1)}%  后150min=${((l.ev / (l.ev + l.base)) * 100).toFixed(1)}%`,
      );
    }
    const w = run180((t) => (t < 1800 ? 8 : 1), 0, false, true);
    console.log(
      `  whale莽撞(不躲): 被抓损失=${(w.caughtLoss / 1e4).toFixed(1)}万 vs 进账${((w.baseIncome + w.memeEarned) / 1e4).toFixed(0)}万 (占${((w.caughtLoss / (w.baseIncome + w.memeEarned)) * 100).toFixed(1)}%)  丢梗${(w.memeEarned / 1e4).toFixed(1)}万  安然奖=0`,
    );
  });
});

describe("段位到达时间（titles）", () => {
  it("三画像的 rank 时间点", { timeout: 120_000 },
      () => {
    console.log(`\n===== 段位门槛 ${RANKS.map((r) => `${r.name}@${r.at}`).join(" ")} =====`);
    const cases: [string, number, number][] = [["casual(1tps)", 1, 0], ["clicker(3tps)", 3, 0], ["idle(10下)", 0, 10]];
    for (const [name, tps, taps] of cases) {
      const run = runSim({
        minutes: 180, tps, dt: 0.25, initialTaps: taps,
        orderFn: makeGreedy(engineCost, engineEffect),
        checkpointMinutes: Array.from({ length: 37 }, (_, i) => i * 5), // 每 5min
      });
      const times = RANKS.slice(1).map((r) => {
        const c = run.curve.find((p) => p.totalEarned >= r.at);
        return `${r.name}@${c ? c.tMin + "min" : ">180min"}`;
      });
      console.log(`  ${name.padEnd(14)}: ${times.join("  ")}`);
    }
  });
});

void phaseStats;
void ({} as GameState);
