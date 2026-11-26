/**
 * probe-opt-offline.test.ts — 数值党探针④：离线 8h 上限合理性（早期暴富 / 7 天回访循环 / 上限敏感性）
 * 全程走引擎 serialize → restore → offlineEarn 真链路。
 * 运行：npx vitest run playtest/probe-opt-offline.test.ts
 */
import { describe, it } from "vitest";
import { initialState, type GameState } from "../src/engine/state";
import { serialize, restore, type SaveAdapter } from "../src/engine/save";
import { offlineEarn, OFFLINE_CAP_SECONDS } from "../src/engine/offline";
import { effectOf, UPGRADES, costOf } from "../src/engine/upgrades";
import { runSim, makeGreedy, engineCost, engineEffect } from "./probe-opt-lib";

const memAdapter = (): SaveAdapter => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
};

/** 贪心清仓：把存量按贪心顺序买到买不起为止，返回(购买数, 增加的挂机速率) */
function dumpBuy(state: GameState): { state: GameState; buys: number; addedIdle: number } {
  const order = makeGreedy(engineCost, engineEffect);
  let buys = 0;
  const idleBefore = effectOf(state).idleRate;
  for (;;) {
    let bought = false;
    for (const id of order(state, 0, 1, effectOf(state).idleRate)) {
      const s2 = (() => {
        const price = costOf(id, state.levels[id] ?? 0);
        return price > 0 && state.moyu >= price ? price : null;
      })();
      if (s2 !== null) {
        state = { ...state, moyu: state.moyu - s2, levels: { ...state.levels, [id]: (state.levels[id] ?? 0) + 1 } };
        buys += 1;
        bought = true;
        break;
      }
    }
    if (!bought) break;
  }
  return { state, buys, addedIdle: effectOf(state).idleRate - idleBefore };
}

function simulateOfflineSettle(state: GameState, awayHours: number, capHours?: number) {
  const mem = memAdapter();
  serialize(state, mem, 0);
  const back = restore(mem, awayHours * 3600 * 1000);
  const cap = capHours ?? OFFLINE_CAP_SECONDS / 3600;
  if (cap <= OFFLINE_CAP_SECONDS / 3600) {
    // ≤8h：走引擎真链路（引擎自身 8h 封顶）
    const r = offlineEarn(back.state, Math.min(back.offlineSeconds, cap * 3600));
    return { applied: r.applied, earned: r.earned, state: r.state, enginePath: true };
  }
  // >8h 反事实：引擎封顶外的假设上限，直接按速率结算（标注反事实）
  const applied = Math.min(back.offlineSeconds, cap * 3600);
  const earned = effectOf(back.state).idleRate * applied;
  return { applied, earned, state: { ...back.state, moyu: back.state.moyu + earned }, enginePath: false };
}

describe("早期离线暴富：首个会话后睡一觉", () => {
  it("活跃 10min / 30min / 180min 后离线 8h：暴富倍数与清仓效果", () => {
    console.log("\n===== 离线暴富测试（1tps 休闲贪心，活跃 N min → 离线 8h → 贪心清仓）=====");
    console.log(`  [引擎常量] OFFLINE_CAP_SECONDS = ${OFFLINE_CAP_SECONDS / 3600}h`);
    for (const activeMin of [10, 30, 180]) {
      const sess = runSim({
        minutes: activeMin,
        tps: 1,
        dt: 0.25,
        orderFn: makeGreedy(engineCost, engineEffect),
        checkpointMinutes: [activeMin],
      });
      const before = sess.endState;
      const rateBefore = effectOf(before).idleRate;
      const activeEarned = sess.totalClickIncome + sess.totalIdleIncome;
      const off = simulateOfflineSettle(before, 8);
      const afterDump = dumpBuy(off.state);
      const rateAfter = effectOf(afterDump.state).idleRate;
      console.log(
        `  活跃${String(activeMin).padStart(4)}min: 存档时挂机速率=${rateBefore}/s  活跃期总收入=${activeEarned}  离线8h入账=${Math.round(off.earned)} (活跃期收入的×${(off.earned / Math.max(activeEarned, 1)).toFixed(1)})  清仓购买${afterDump.buys}次(+${afterDump.addedIdle}/s) → 速率${rateBefore}→${rateAfter}/s (×${(rateAfter / Math.max(rateBefore, 1)).toFixed(1)})`,
      );
    }
  });

  it("超早期（只买得起 1-2 级刷手机）离线 8h 是否直接跳档", () => {
    // 手造极早期状态：刷手机×2（挂机 2/s），离线 8h
    let s = initialState();
    s = { ...s, levels: { phone: 2 } };
    const off = simulateOfflineSettle(s, 8);
    const dump = dumpBuy(off.state);
    console.log(
      `\n  phone×2(2/s) 起步离线8h: 入账=${Math.round(off.earned)}（=刷手机裸价×${(off.earned / 50).toFixed(0)}） 清仓购买${dump.buys}次 +${dump.addedIdle}/s → 2→${effectOf(dump.state).idleRate}/s (×${(effectOf(dump.state).idleRate / 2).toFixed(1)}) 终局等级=${JSON.stringify(dump.state.levels)}`,
    );
  });
});

describe("7 天回访循环：每天 2h 活跃(1tps 贪心) + 夜里离线", () => {
  it("上限 0h(无离线) / 4h / 8h / 24h 对比", () => {
    console.log("\n===== 7天循环（每天 2h 活跃 → 离线 min(上限, 夜长12h)）=====");
    for (const capH of [0, 4, 8, 24]) {
      let state = initialState();
      const dayRates: number[] = [];
      let day7OfflineEarned = 0;
      for (let day = 1; day <= 7; day++) {
        const sess = runSim({
          minutes: 120,
          tps: 1,
          dt: 0.5,
          orderFn: makeGreedy(engineCost, engineEffect),
          checkpointMinutes: [120],
          initial: state, // 从上一天（含离线结算）状态续跑
        });
        state = sess.endState;
        const rate = effectOf(state).idleRate;
        dayRates.push(rate);
        if (capH > 0) {
          const off = simulateOfflineSettle(state, 12, capH);
          state = off.state;
          if (day === 7) day7OfflineEarned = off.earned;
        }
      }
      const endRate = effectOf(state).idleRate;
      console.log(
        `  上限${String(capH).padStart(2)}h: 每日活跃末挂机速率=[${dayRates.map((r) => Math.round(r)).join(", ")}]/s  7天终局速率=${Math.round(endRate)}/s  第7夜离线入账=${Math.round(day7OfflineEarned)}`,
      );
    }
    console.log("  注: '无离线'仅第1天累积(探针串行限制)，读数时对比 4/8/24 的倍数关系为主");
  });
});

describe("离线公平性与上限敏感", () => {
  it("同一进度下离线 1h/4h/8h/12h/24h 收益曲线（8h 是否是甜点）", () => {
    // 取 180min 会话后的典型进度
    const sess = runSim({
      minutes: 180,
      tps: 1,
      dt: 0.25,
      orderFn: makeGreedy(engineCost, engineEffect),
      checkpointMinutes: [180],
    });
    const rate = effectOf(sess.endState).idleRate;
    console.log(`\n  样本进度: 挂机速率=${Math.round(rate)}/s`);
    for (const h of [1, 4, 8, 12, 24]) {
      const off = simulateOfflineSettle(sess.endState, h, h); // 上限=离线时长（即不封顶，仅测时长本身）
      const dump = dumpBuy(off.state);
      const r2 = effectOf(dump.state).idleRate;
      const tag = h > 8 ? "(反事实,引擎实际封8h)" : "";
      console.log(
        `  离线${String(h).padStart(2)}h: 入账=${Math.round(off.earned).toString().padStart(10)}  清仓后速率=${Math.round(r2).toString().padStart(6)}/s (×${(r2 / rate).toFixed(2)}) 清仓购买${dump.buys}次 ${tag}`,
      );
    }
    // 说明下一步价格量级
    const nextCosts = UPGRADES.map((u) => `${u.name}:${Math.round(costOf(u.id, sess.endState.levels[u.id] ?? 0))}`).join("  ");
    console.log(`  该进度下各项下一级价格: ${nextCosts}`);
  });
});
