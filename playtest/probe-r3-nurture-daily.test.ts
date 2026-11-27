import { describe, it, expect } from "vitest";
import { NURTURE_PERSONAS, runNurture, rankFor, RANKS, FLAVOR_TOTAL } from "./probe-r3-nurture-lib";
import { initialState } from "../src/engine/state";
import { OFFLINE_CAP_SECONDS } from "../src/engine/offline";
import { settleReturn } from "../src/engine/resume";
import { effectOf } from "../src/engine/upgrades";

/**
 * 养成党探针 ⑤每日仪式感模型：休闲党画像（1 tps、30s 一购）每天只玩 30 分钟，
 * 其余 23.5h 离线（引擎语义：8h 封顶 × 首日 1.0 / 之后 0.7）。跑 14 天，
 * 观察每天回访实际拿到什么：段位推进、新彩蛋、购买次数、仪式性事件。
 */
const DAYS = 14;
const ACTIVE_MIN = 30;

describe("养成党：14 天每日 30min 回访模型（休闲党）", () => {
  it("每日成长表", { timeout: 240_000 }, () => {
    const casual = NURTURE_PERSONAS.find((p) => p.name.includes("casual"))!;
    let state = initialState();
    let totalSeen = 0;

    for (let d = 0; d < DAYS; d++) {
      const rate = d === 0 ? 1 : 0.7; // 建档 24h 内全额，之后 70%
      const dayStartTe = state.totalEarned;
      const startRank = rankFor(dayStartTe);
      const seenBefore = totalSeen;

      // 当天 30 分钟活跃游玩
      const r = runNurture(casual, {
        minutes: ACTIVE_MIN,
        sampleEverySec: 60,
        initial: { moyu: state.moyu, totalEarned: state.totalEarned, levels: { ...state.levels } },
        seed: 12345 + d,
      });
      totalSeen = r.flavorSeenCount;
      const teAfterActive = r.endTotalEarned;
      const moyuAfterActive = r.samples.at(-1)!.moyu;

      // 离线 23.5h → 回归结算（走引擎真实函数链 settleReturn）
      const back = settleReturn(
        { moyu: moyuAfterActive, totalEarned: teAfterActive, levels: r.endLevels },
        0,
        (23.5 * 3600) * 1000,
        rate,
      );
      state = back.state;
      const dayEndTe = state.totalEarned;
      const endRank = rankFor(dayEndTe);

      console.log(
        `Day${String(d + 1).padStart(2)}: 活跃+${Math.round(teAfterActive - dayStartTe)}  离线+${Math.round(dayEndTe - teAfterActive)}（结算 ${(back.applied / 3600).toFixed(1)}h@${rate}） ` +
          `日总+${Math.round(dayEndTe - dayStartTe)}  段位:${startRank.current}→${endRank.current}${startRank.current !== endRank.current ? " ⬆" : ""}  ` +
          `彩蛋+${totalSeen - seenBefore}(${totalSeen}/${FLAVOR_TOTAL})`,
      );
    }

    const terminal = state.totalEarned >= RANKS.at(-1)!.at;
    console.log(`\n14 天累计 totalEarned=${(state.totalEarned / 1e8).toFixed(2)}e8（终段 1e8 ${terminal ? "已达成" : "未达成"}）`);
    console.log(`终段达成后：段位栏固定文本、进度条恒 100%，无任何系统继续记录成长`);
    expect(OFFLINE_CAP_SECONDS).toBe(8 * 3600);
    expect(effectOf(initialState()).idleRate).toBe(0.2);
    expect(RANKS.at(-1)!.at).toBe(1e8);
  });
});
