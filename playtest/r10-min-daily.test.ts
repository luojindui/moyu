/**
 * R10 极简视角：日报「可选但不可完成」验证（只读 src/engine，不改 src）
 * 结论目标：3 个目标中若含 visit_1 / idle_earn，则没有任何代码路径推进它们 → 无法 3/3 领取。
 */
import { describe, it, expect } from "vitest";
import {
  rollDaily,
  dailyTrack,
  dailyAllDone,
  claimDaily,
  DAILY_GOAL_TEMPLATES,
  type DailyState,
} from "../src/engine/daily";
import { initialState } from "../src/engine/state";

/** main.ts 里实际存在的 trackDaily 调用只覆盖这 4 种 */
const TRACKED = ["click", "meme", "buy", "survive"] as const;

describe("R10 日报可完成性（极简视角）", () => {
  it("rollDaily 10000 次：含不可推进目标的组合占比", () => {
    const deadKinds = DAILY_GOAL_TEMPLATES.filter((t) => !TRACKED.includes(t.kind as (typeof TRACKED)[number]));
    console.log(`不可推进目标模板：${deadKinds.map((t) => `${t.id}(${t.kind})`).join(" / ")}`);
    let withDead = 0;
    const N = 10000;
    for (let i = 0; i < N; i++) {
      const d = rollDaily("2026-11-27", () => Math.random(), 0);
      if (d.goals.some((g) => deadKinds.some((t) => t.id === g.id))) withDead++;
    }
    console.log(`含 ≥1 个不可推进目标的日报占比：${((withDead / N) * 100).toFixed(1)}%`);
    expect(withDead / N).toBeGreaterThan(0.7);
  });

  it("只跑 main.ts 存在的 4 种行为：含 visit/idle 的日报永远无法领取", () => {
    let blocked = 0;
    let claimable = 0;
    for (let i = 0; i < 2000; i++) {
      let d: DailyState = rollDaily("2026-11-27", () => Math.random(), 0);
      // 模拟玩家把所有可点的都做了：400 次点击 / 买 5 次 / 点梗 3 次 / 巡逻 3 次
      for (let k = 0; k < 400; k++) d = dailyTrack(d, "click");
      for (let k = 0; k < 5; k++) d = dailyTrack(d, "buy");
      for (let k = 0; k < 3; k++) d = dailyTrack(d, "meme");
      for (let k = 0; k < 3; k++) d = dailyTrack(d, "survive");
      const st = { ...initialState(), daily: d };
      const r = claimDaily(st, "2026-11-27");
      if (r.claimedReward !== null) claimable++;
      else blocked++;
    }
    console.log(`全行为跑满后：可领取 ${claimable} / 2000，不可领取 ${blocked} / 2000`);
    expect(blocked).toBeGreaterThan(0);
  });
});
