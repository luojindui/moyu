import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { doClick, clickPowerOf } from "../src/engine/actions";
import { newEventState, bossSurviveReward } from "../src/engine/events";

/**
 * 挑战党探针 R3-④：连点奖励缺失验证。
 * 假设：无论以什么频率/节奏点击，单位点击收入恒等于 clickPower——
 * 无连击、无暴击、无节奏加成、无高分状态。用数据证明"手速溢价 = 0"。
 */

function st(levels: Record<string, number>) {
  return { ...initialState(), levels: { ...levels } };
}

describe("R3-④ 连点奖励缺失", () => {
  it("不同频率爆发点击：每次点击收入恒等于点击力（线性，零方差）", () => {
    const s = st({ coffee: 39, phone: 31, water: 26, toilet: 13, chair: 11 });
    const cp = clickPowerOf(s);
    const rows: unknown[] = [];
    // 模拟不同 cps 的 10 秒爆发：用间隔调度单次 doClick，测量总收入
    for (const cps of [1, 2, 3, 5, 8, 12]) {
      let cur = s;
      const n = Math.round(10 * cps);
      const deltas: number[] = [];
      for (let i = 0; i < n; i++) {
        const before = cur.moyu;
        cur = doClick(cur);
        deltas.push(+(cur.moyu - before).toFixed(10));
      }
      const total = cur.moyu - s.moyu;
      const distinct = new Set(deltas);
      rows.push({
        cps,
        点击数: n,
        总收入: +total.toFixed(2),
        线性期望: n * cp,
        偏差: +(total - n * cp).toFixed(10),
        单击收入去重: [...distinct],
      });
      if (Math.abs(total - n * cp) > 1e-9) throw new Error("存在非线性加成?");
    }
    console.table(rows);
  });

  it("节奏无关性：同样 60 次点击，均匀 1cps vs 前快后慢 vs 全部瞬间完成，总收入相同", () => {
    const s = st({ coffee: 14, phone: 5, water: 1 });
    const cp = clickPowerOf(s);
    // 引擎 doClick 是纯函数（无时间参数），节奏只存在于调用间隔中。
    // 证明：连 doClick 60 次与分 60 分钟点，每次收入相同。
    let burst = s;
    for (let i = 0; i < 60; i++) burst = doClick(burst);
    console.log({
      burst60: +burst.moyu.toFixed(2),
      期望: 60 * cp,
      时间参数存在: doClick.length, // doClick(state) 无时间入参 → 节奏物理上无法影响收入
    });
    if (Math.abs(burst.moyu - 60 * cp) > 1e-9) throw new Error("异常");
  });

  it("连续安然躲过巡逻：奖励无连胜加成（第 N 次与第 1 次相同）", () => {
    const s = st({ coffee: 39, phone: 31, water: 26, toilet: 13, chair: 11 });
    const rewards: number[] = [];
    for (let streak = 1; streak <= 10; streak++) {
      const es = newEventState();
      es.bossCaught = false;
      rewards.push(bossSurviveReward(s, es));
    }
    console.log({ 连续10次安然奖励: rewards, 去重: [...new Set(rewards)] });
    if (new Set(rewards).size !== 1) throw new Error("存在连胜加成?");
  });

  it("R3 修复回归：连击（combo）与安然连胜（surviveStreak）已实现", () => {
    const esKeys = Object.keys(newEventState()).sort();
    console.log({ EventState字段: esKeys });
    // ✅ 已修复：EventState 有 surviveStreak（连胜），连击在 main 运行时链中
    expect(esKeys).toContain("surviveStreak");
    // 连击收入溢价可被 doClick(combo) 表达
    const s = initialState();
    expect(doClick(s, 12).moyu).toBeCloseTo(1.24, 10);
    expect(doClick(s, 99).moyu).toBeCloseTo(1.24, 10); // 封顶 12 连
  });

  it("手速溢价总账：3cps vs 8cps 坚持一小时，单位时间收入的差异来源", () => {
    // 无连击系统时，手速收入 = cps × cp 纯线性；
    // 技巧上限 = 会不会点。8cps 比 3cps 多赚 167%，但这与"技巧"无关（自动连点器即可达成）。
    const s = st({ coffee: 39, phone: 31, water: 26, toilet: 13, chair: 11 });
    const cp = clickPowerOf(s);
    const rows = [1, 3, 8].map((cps) => ({
      cps,
      点击时收: cps * cp * 3600,
      点击力: cp,
      单击溢价: 0,
      备注: "线性无上限加成，连点器=人手",
    }));
    console.table(rows);
  });
});
