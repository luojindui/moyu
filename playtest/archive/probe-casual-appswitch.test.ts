import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { doClick } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { UPGRADES, costOf, effectOf } from "../src/engine/upgrades";
import { serialize, restore, type SaveAdapter } from "../src/engine/save";
import { offlineEarn } from "../src/engine/offline";

/**
 * 休闲玩家探针③：摸鱼党的真实操作是"切后台"（老板来了/回消息），
 * 不是杀掉页面。main.ts 主循环 dt=Math.min(1, (now-last)/1000) 会把切走时间吞成 1 秒；
 * 离线结算只在 boot 时做一次。本探针量化"切后台 1/3/5/15 分钟回来各丢多少收益"。
 */

function memAdapter() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } satisfies SaveAdapter;
}

describe("休闲玩家探针③：切后台（不杀页面）回来", () => {
  it("中途切走 N 分钟，回来实际拿到多少", () => {
    // 场景：玩了 2 分钟（keen 节奏简化：idle 9/s、余额 605，对应探针① session1 结束态）
    let s = initialState();
    s.levels = { coffee: 15, phone: 5, water: 2, toilet: 1 }; // idle 9/s 的典型 session1 末态
    s.moyu = 605;
    const idle = effectOf(s).idleRate;

    for (const awayMin of [1, 3, 5, 15, 30]) {
      // 走之前恰好自动存档（10s 周期内的最好情况：pagehide 存了）
      const mem = memAdapter();
      serialize(s, mem, 0);
      // 回来：rAF 恢复，主循环 dt 被钳到 1 秒 —— 实际收益：
      const actualGain = idle * Math.min(1, (awayMin * 60) / 1); // dt 钳制 → 每次恢复只按 1s 结算
      // 对比：如果按离线逻辑结算（boot 时才走的路径）
      const back = restore(mem, awayMin * 60 * 1000);
      const wouldHave = offlineEarn(back.state!, back.offlineSeconds).earned;
      console.log(
        `切走${awayMin}min(idle=${idle}/s): 实际到手≈${Math.round(actualGain)} (按1s计) | 应得=${wouldHave} | 丢失率 ${((1 - actualGain / wouldHave) * 100).toFixed(1)}%`,
      );
      expect(actualGain).toBeLessThan(wouldHave);
    }
    // 结论性断言：切走 5 分钟丢失率 > 99%
    const gain = idle * 1;
    const should = idle * 300;
    expect(gain / should).toBeLessThan(0.01);
    console.log(`[结论] 切后台不结算：5 分钟丢 ${Math.round(should - gain)} 摸鱼值（idle=${idle}/s 时）`);
  });

  it("对照：如果玩家杀掉页面重开（走 boot 离线结算），同样的 5 分钟给多少", () => {
    let s = initialState();
    s.levels = { coffee: 15, phone: 5, water: 2, toilet: 1 };
    s.moyu = 605;
    const mem = memAdapter();
    serialize(s, mem, 0);
    const back = restore(mem, 5 * 60 * 1000);
    const off = offlineEarn(back.state!, back.offlineSeconds);
    console.log(`杀页面重开 5min: 收益 ${off.earned}（余额 605 的 ${(off.earned / 605).toFixed(1)} 倍）`);
    expect(off.earned).toBeGreaterThan(2000);
  });

  it("补一刀：最便宜升级间隔（休闲玩家等下一件的时间感）", () => {
    // 等价于"空转多久才能再买一口"：idle 速率 vs 咖啡价曲线
    let s = initialState();
    for (let i = 0; i < 20; i++) s.levels.coffee = i + 1; // 20 级咖啡
    s.levels.phone = 5;
    const idle = effectOf(s).idleRate;
    const coffeeCost = costOf("coffee", s.levels.coffee ?? 0);
    console.log(`咖啡 Lv20 价 ${coffeeCost}，idle=${idle}/s → 纯挂机 ${Math.ceil(coffeeCost / idle)}s 一口`);
    expect(Math.ceil(coffeeCost / idle)).toBeLessThan(60);
  });
});
