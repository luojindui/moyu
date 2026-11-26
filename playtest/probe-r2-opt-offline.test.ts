/**
 * probe-r2-opt-offline.test.ts — r2 数值党探针③：离线首夜跳档 / 70% 收敛 / 上限敏感性
 * 全程走引擎 serialize → restore → offlineEarn 真链路。
 * 运行：npx vitest run playtest/probe-r2-opt-offline.test.ts
 */
import { describe, it } from "vitest";
import { initialState, type GameState } from "../src/engine/state";
import { serialize, restore, type SaveAdapter } from "../src/engine/save";
import { offlineEarn, OFFLINE_CAP_SECONDS } from "../src/engine/offline";
import { effectOf, UPGRADES, costOf } from "../src/engine/upgrades";
import { runSim, makeGreedy, engineCost, engineEffect, makeGreedyFilter } from "./probe-opt-lib";

const memAdapter = (): SaveAdapter => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
};

function dumpBuy(state: GameState): { state: GameState; buys: number; addedIdle: number } {
  const order = makeGreedy(engineCost, engineEffect);
  let buys = 0;
  const idleBefore = effectOf(state).idleRate;
  for (;;) {
    let bought = false;
    for (const id of order(state, 0, 1, effectOf(state).idleRate)) {
      const price = engineCost(id, state.levels[id] ?? 0);
      if (price > 0 && state.moyu >= price) {
        state = { ...state, moyu: state.moyu - price, levels: { ...state.levels, [id]: (state.levels[id] ?? 0) + 1 } };
        buys += 1;
        bought = true;
        break;
      }
    }
    if (!bought) break;
  }
  return { state, buys, addedIdle: effectOf(state).idleRate - idleBefore };
}

/** 引擎真链路结算；capHours>8 走反事实（引擎自身封 8h） */
function settle(state: GameState, awayHours: number, rate: number, capHours?: number) {
  const mem = memAdapter();
  serialize(state, mem, 0);
  const back = restore(mem, awayHours * 3600 * 1000);
  const cap = capHours ?? OFFLINE_CAP_SECONDS / 3600;
  if (cap <= OFFLINE_CAP_SECONDS / 3600) {
    const r = offlineEarn(back.state, Math.min(back.offlineSeconds, cap * 3600), rate);
    return { earned: r.earned, state: r.state, enginePath: true };
  }
  const earned = effectOf(back.state).idleRate * Math.min(back.offlineSeconds, cap * 3600) * rate;
  return { earned, state: { ...back.state, moyu: back.state.moyu + earned, totalEarned: back.state.totalEarned + earned }, enginePath: false };
}

describe("首夜跳档复测（r1 批次1 为 ×51.1）", () => {
  it("活跃 10/30/180min → 首夜离线 8h(rate=1) → 清仓", { timeout: 120_000 },
      () => {
    console.log("\n===== r2 首夜离线（rate=1 首日全额） =====");
    for (const activeMin of [10, 30, 180]) {
      const sess = runSim({
        minutes: activeMin, tps: 1, dt: 0.25,
        orderFn: makeGreedy(engineCost, engineEffect),
        checkpointMinutes: [activeMin],
      });
      const before = sess.endState;
      const rateBefore = effectOf(before).idleRate;
      const activeEarned = sess.totalClickIncome + sess.totalIdleIncome;
      const off = settle(before, 8, 1);
      const dump = dumpBuy(off.state);
      const rateAfter = effectOf(dump.state).idleRate;
      console.log(
        `  活跃${String(activeMin).padStart(4)}min: 存档挂机=${rateBefore}/s  会话总收入=${activeEarned}  首夜入账=${Math.round(off.earned)} (×${(off.earned / Math.max(activeEarned, 1)).toFixed(1)})  清仓${dump.buys}次(+${dump.addedIdle}/s) → ${rateBefore}→${rateAfter}/s (×${(rateAfter / Math.max(rateBefore, 1)).toFixed(1)})`,
      );
    }
    // 纯挂机党首夜
    const idleSess = runSim({
      minutes: 10, tps: 0, dt: 0.25, initialTaps: 10,
      orderFn: makeGreedyFilter(engineCost, engineEffect, "idle"), checkpointMinutes: [10],
    });
    const off2 = settle(idleSess.endState, 8, 1);
    const dump2 = dumpBuy(off2.state);
    console.log(
      `  纯挂机党(10下+10min): 存档挂机=${effectOf(idleSess.endState).idleRate}/s  首夜入账=${Math.round(off2.earned)}  清仓${dump2.buys}次 → ${effectOf(idleSess.endState).idleRate}→${effectOf(dump2.state).idleRate}/s`,
    );
  });
});

describe("70% 效率收敛复测（第二夜起 rate=0.7）", () => {
  it("7 天循环 rate 全 1.0 vs 首日后 0.7", { timeout: 120_000 },
      () => {
    console.log("\n===== 7 天（每天 2h 活跃+夜 12h 离线 8h 封顶） =====");
    for (const mode of ["全 1.0（对照）", "首夜1.0/后0.7"]) {
      let state = initialState();
      const dayRates: number[] = [];
      for (let day = 1; day <= 7; day++) {
        const sess = runSim({
          minutes: 120, tps: 1, dt: 0.5,
          orderFn: makeGreedy(engineCost, engineEffect), checkpointMinutes: [120], initial: state,
        });
        state = sess.endState;
        const rate = day === 1 || mode === "全 1.0（对照）" ? 1 : 0.7;
        const off = settle(state, 12, rate);
        state = dumpBuy(off.state).state;
        dayRates.push(Math.round(effectOf(state).idleRate));
      }
      console.log(`  ${mode}: 日终挂机速率=[${dayRates.join(", ")}]/s`);
    }
  });

  it("同进度离线时长敏感性（rate=0.7，8h 上限 vs 反事实 12/24h）", { timeout: 120_000 },
      () => {
    const sess = runSim({
      minutes: 180, tps: 1, dt: 0.25,
      orderFn: makeGreedy(engineCost, engineEffect), checkpointMinutes: [180],
    });
    const rate = effectOf(sess.endState).idleRate;
    console.log(`\n  样本进度: 挂机=${Math.round(rate)}/s`);
    for (const h of [1, 4, 8, 12, 24]) {
      const off = settle(sess.endState, h, 0.7, h);
      const dump = dumpBuy(off.state);
      const r2 = effectOf(dump.state).idleRate;
      console.log(
        `  离线${String(h).padStart(2)}h: 入账=${Math.round(off.earned).toString().padStart(12)}  清仓后=${Math.round(r2).toString().padStart(7)}/s (×${(r2 / rate).toFixed(2)}) 清仓${dump.buys}次 ${h > 8 ? "(反事实)" : ""}`,
      );
    }
    const nextCosts = UPGRADES.map((u) => `${u.name}:${Math.round(costOf(u.id, sess.endState.levels[u.id] ?? 0))}`).join(" ");
    console.log(`  该进度下一级价格: ${nextCosts}`);
  });
});
