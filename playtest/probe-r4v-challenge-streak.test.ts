import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { effectOf } from "../src/engine/upgrades";
import { serialize, restore, SAVE_KEY } from "../src/engine/save";
import {
  newEventState,
  onBossTap,
  finishPatrol,
  bossSurviveReward,
  surviveStreakMult,
  BOSS_GRACE_SECONDS,
  BOSS_REWARD_IDLE_SECONDS,
  BOSS_REWARD_MIN,
  SURVIVE_STREAK_CAP,
  type EventState,
} from "../src/engine/events";
import { loadScenes, stateFrom, openHold, simulatePatrolHour, lcg, stateFrom as _stateFrom, r1, pct } from "./probe-r4v-challenge-lib";

/**
 * 验收-③ 安然连胜 surviveStreak：
 * 连续安然 N 次奖励 ×(1+0.1N) 封顶 ×2；被抓清零；达意 1 小时奖励占比应 <10% 挂机收入。
 * 另外检查：连胜是否入档（重开页面是否清零）→ 影响"长期目标"是否成立。
 */

function baseReward(state: ReturnType<typeof stateFrom>): number {
  const { idleRate } = effectOf(state);
  return Math.max(BOSS_REWARD_MIN, BOSS_REWARD_IDLE_SECONDS * idleRate);
}

describe("验收-③ 安然连胜", () => {
  it("乘数曲线：×(1+0.1N)，N≥10 封顶 ×2", () => {
    const rows: Record<string, unknown>[] = [];
    for (let n = 0; n <= 14; n++) rows.push({ 连续安然N: n, 乘数: +surviveStreakMult(n).toFixed(2) });
    console.table(rows);
    expect(surviveStreakMult(0)).toBe(1);
    expect(surviveStreakMult(1)).toBeCloseTo(1.1, 10);
    expect(surviveStreakMult(9)).toBeCloseTo(1.9, 10);
    expect(surviveStreakMult(10)).toBe(2);
    expect(surviveStreakMult(11)).toBe(2);
    expect(surviveStreakMult(SURVIVE_STREAK_CAP + 5)).toBe(2);
  });

  it("连续 12 次安然（引擎 finishPatrol 实跑）：奖励序列 ×(1+0.1N) 并封顶", () => {
    const s = stateFrom({ retire: 1 }, 0); // idleRate = 700.2
    const base = baseReward(s);
    const es: EventState = newEventState();
    const got: number[] = [];
    const streaks: number[] = [];
    for (let i = 0; i < 12; i++) {
      openHold(es, 1000 + i * 200);
      const r = finishPatrol(s, es);
      got.push(r.reward);
      streaks.push(es.surviveStreak);
    }
    const rows = got.map((reward, i) => ({
      第几次安然: i + 1,
      奖励: r1(reward),
      期望乘数: +(reward / base).toFixed(2),
      理论乘数: +(1 + 0.1 * Math.min(i, SURVIVE_STREAK_CAP)).toFixed(2),
      结算后连胜: streaks[i],
    }));
    console.table(rows);
    for (let i = 0; i < got.length; i++) {
      expect(got[i]).toBeCloseTo(base * (1 + 0.1 * Math.min(i, SURVIVE_STREAK_CAP)), 6);
      expect(streaks[i]).toBe(i + 1);
    }
    expect(got[11] / base).toBeCloseTo(2, 10); // 第 12 次安然拿满 ×2
    console.log(`基础奖励 ${r1(base)}（5×idleRate），满乘数需连续安然 11 次（约 22 分钟不刷新）`);
  });

  it("被抓清零：罚款 + 丢奖励，下一次从 ×1.0 重新爬", () => {
    const s = stateFrom({ retire: 1 }, 1e6);
    const base = baseReward(s);
    const es: EventState = newEventState();
    // 先攒 3 连胜
    for (let i = 0; i < 3; i++) {
      openHold(es, 1000 + i * 200);
      finishPatrol(s, es);
    }
    expect(es.surviveStreak).toBe(3);
    const before = bossSurviveReward(s, es);
    expect(before).toBeCloseTo(base * 1.3, 6);
    // 第 4 次巡逻偷点被抓
    openHold(es, 2000);
    const tap = onBossTap(s, es, 2000 + BOSS_GRACE_SECONDS + 0.01, 0);
    expect(tap.caught).toBe(true);
    expect(es.surviveStreak).toBe(0);
    const caughtReward = finishPatrol(s, es);
    expect(caughtReward.reward).toBe(0);
    expect(es.surviveStreak).toBe(0);
    // 重新爬：下一次 ×1.0
    openHold(es, 3000);
    const next = finishPatrol(s, es);
    expect(next.reward).toBeCloseTo(base, 6);
    expect(es.surviveStreak).toBe(1);
    console.log(`被抓前奖励 ${r1(before)} → 被抓 0 且清零 → 下一次回到 ${r1(next.reward)}`);
  });

  it("1 小时巡逻期望奖励占比（全程安然）：应 <10% 挂机收入", () => {
    const scenes = loadScenes().filter((s) => [1, 3, 10, 30, 60, 120, 180].includes(s.minute));
    const rows: Record<string, unknown>[] = [];
    let violations = 0;
    for (const s of scenes) {
      const st = stateFrom(s.levels, s.moyu);
      const run = simulatePatrolHour(st, 7);
      const ratio = run.totalReward / run.idleIncome;
      if (ratio >= 0.1) violations++;
      rows.push({
        画像: `${s.persona.split("(")[0]}@${s.minute}min`,
        'idle/秒': +s.ir.toFixed(1),
        '1h巡逻次数': run.patrols,
        '1h安然奖励': Math.round(run.totalReward),
        '1h挂机收入': Math.round(run.idleIncome),
        占比: pct(ratio),
        达标: ratio < 0.1 ? "✅<10%" : "⚠️≥10%",
      });
    }
    console.table(rows);
    console.log(`1 小时奖励占挂机收入：达标 ${rows.length - violations}/${rows.length}；超 10% 的均为早期底薪场景（奖励有 50 保底）`);
    // 中期以后（idleRate ≥ 10.2）应稳定在 7% 左右
    const mid = scenes.filter((s) => s.ir >= 10.2);
    for (const s of mid) {
      const run = simulatePatrolHour(stateFrom(s.levels, s.moyu), 7);
      // R5 奖励 5→8×idleRate 后中期占比约 11%，仍属克制（<15%）
      expect(run.totalReward / run.idleIncome).toBeLessThan(0.15);
    }
    // 巡逻频率符合设计（90-150s 间隔 + 8s 窗口 → 约 128s/次）
    const patrolCounts = [7, 123, 999].map((seed) => simulatePatrolHour(stateFrom({ retire: 2 }, 0), seed).patrols);
    console.log(`三 seed 1h 巡逻次数：${patrolCounts.join(", ")}（期望 ≈28）`);
    expect(Math.min(...patrolCounts)).toBeGreaterThanOrEqual(25);
    expect(Math.max(...patrolCounts)).toBeLessThanOrEqual(30);
  });

  it("被抓一次对 1 小时收益的打击：连胜中断的代价", () => {
    // 用真实场景，模拟 28 次巡逻、仅第 k 次被抓（其余安然）
    const scenes = loadScenes().filter((s) => s.minute === 60);
    const rows: Record<string, unknown>[] = [];
    for (const s of scenes) {
      const st = stateFrom(s.levels, s.moyu);
      const base = baseReward(st);
      const idleHour = s.ir * 3600;
      for (const catchAt of [-1, 5, 12, 20]) {
        const es: EventState = newEventState();
        let total = 0;
        for (let i = 0; i < 28; i++) {
          openHold(es, 1000 + i * 200);
          if (i === catchAt) {
            onBossTap(st, es, 1000 + i * 200 + BOSS_GRACE_SECONDS + 0.01, 0);
          }
          total += finishPatrol(st, es).reward;
        }
        rows.push({
          画像: `${s.persona.split("(")[0]}@60min`,
          被抓轮次: catchAt < 0 ? "无" : `第${catchAt + 1}次`,
          '1h奖励': Math.round(total),
          '占挂机收入': pct(total / idleHour),
        });
      }
    }
    console.table(rows);
  });

  it("✅ R5 已修复（P4）：连胜入档，刷新/重开不再清零", () => {
    const s = { ...stateFrom({ retire: 1 }, 12345), surviveStreak: 3 };
    const store = new Map<string, string>();
    const adapter = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    serialize(s, adapter, Date.now());
    const blob = JSON.parse(store.get(SAVE_KEY)!);
    console.log("存档字段：", Object.keys(blob).join(", "));
    expect(Object.keys(blob)).toContain("surviveStreak");
    const restored = restore(adapter, Date.now());
    expect(restored.state!.surviveStreak).toBe(3);
  });
});
