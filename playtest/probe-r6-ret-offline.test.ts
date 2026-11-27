import { describe, it, expect } from "vitest";
import {
  runBot,
  offlineAudit,
  memSave,
  DEFAULT_CFG,
  EPOCH_DAY1,
  formatMoyu,
} from "./probe-r6-ret-lib";
import { serialize, restore } from "../src/engine/save";
import { settleReturn } from "../src/engine/resume";
import { effectOf } from "../src/engine/upgrades";
import { OFFLINE_CAP_SECONDS } from "../src/engine/offline";

/**
 * 探针②：离线收益 首日 1.0 → 次日 0.7 的落差，是否造成 Day2 体验下降？
 * 全程真实链路：serialize → restore(算 offlineSeconds/createdAt) →
 *   settleReturn(state, now-offlineSeconds*1000, now, rate)，rate = (now-createdAt<24h ? 1 : 0.7)
 * 与 src/main.ts boot() 完全一致。
 */

const bot = runBot();
const audit = offlineAudit(bot);

describe("R6 留存②：离线 1.0 → 0.7 的真实落差", () => {
  it("逐次离线结算：前 4 次都是 1.0，第一次 0.7 落在 Day2 中午", () => {
    console.log("\n===== 逐次离线结算（前 6 次）=====");
    for (const v of bot.visits.slice(0, 6)) {
      const cf = v.rate < 1 ? v.offlineEarned / v.rate : v.offlineEarned;
      console.log(
        `  D${v.day}V${v.visit} 离开 ${(v.gapSeconds / 3600).toFixed(2)}h → 结算 ${(v.offlineApplied / 3600).toFixed(2)}h × 挂机 ${formatMoyu(v.idleRate)}/s × 速率 ${v.rate} = ${formatMoyu(v.offlineEarned)}${v.rate < 1 ? `（若 1.0 = ${formatMoyu(cf)}，少 ${formatMoyu(cf - v.offlineEarned)}）` : ""}`,
      );
    }
    const d1 = bot.visits.filter((v) => v.day === 1);
    const d2 = bot.visits.filter((v) => v.day === 2);
    expect(d1.every((v) => v.rate === 1)).toBe(true);
    // 首日全额窗口 = 建档(09:03)+24h = D2 09:03；D2 第一次回访 09:00 还在窗口内 → 隔夜那笔仍是 1.0
    expect(d2[0]!.rate).toBe(1);
    // 第一次 0.7 落在 D2 12:30（第 2 次回访）
    expect(audit.firstRate07).toEqual({ day: 2, visit: 2, at: EPOCH_DAY1 + 86_400_000 + (12 * 60 + 30) * 60_000 });
    console.log(
      `\n  首次 0.7：D${audit.firstRate07!.day} 第 ${audit.firstRate07!.visit} 次回访（12:30）；首日全额共覆盖 ${audit.firstRate1Visit} 次结算（含 Day1 两次离线 + Day2 隔夜）`,
    );
  });

  it("Day2 有没有名义下降？没有：日收入是 Day1 的 33.6 倍，0.7 被挂机率增长掩盖", () => {
    const d1 = bot.days[0]!;
    const d2 = bot.days[1]!;
    const d2v1 = bot.visits.filter((v) => v.day === 2)[0]!;
    const d1v3 = bot.visits.filter((v) => v.day === 1)[2]!;
    console.log("\n===== Day1 vs Day2 =====");
    console.log(`  D1 日收入 ${formatMoyu(d1.dayIncome)}（离线占比 ${(d1.offlineRatio * 100).toFixed(0)}%）`);
    console.log(`  D2 日收入 ${formatMoyu(d2.dayIncome)} = D1 的 ${(d2.dayIncome / d1.dayIncome).toFixed(1)} 倍`);
    console.log(
      `  D1 晚间离线（7.45h × 1.0）= ${formatMoyu(d1v3.offlineEarned)}；D2 隔夜（8h × 1.0）= ${formatMoyu(d2v1.offlineEarned)}（${(d2v1.offlineEarned / d1v3.offlineEarned).toFixed(1)} 倍）`,
    );
    const d2v2 = bot.visits.filter((v) => v.day === 2)[1]!;
    console.log(
      `  D2 第一次 0.7（3.45h）= ${formatMoyu(d2v2.offlineEarned)}，仍是 D1 任何一笔离线的 ${(d2v2.offlineEarned / d1v3.offlineEarned).toFixed(1)} 倍 → 玩家看不到「下降」`,
    );
    expect(d2.dayIncome / d1.dayIncome).toBeGreaterThan(20);
    expect(d2v1.rate).toBe(1);
    // 但 0.7 的真实成本是每天都扣 30% 的离线（= 98.7% 的收入）
    console.log(
      `\n  0.7 的真实成本：14 天离线实收 ${formatMoyu(audit.actual07)}，若全 1.0 本应为 ${formatMoyu(audit.actual07 + audit.loss07)}（少 ${formatMoyu(audit.loss07)}）→ 累计收入会多 ${(((audit.actual07 + audit.loss07) / bot.days.at(-1)!.totalEarned - 1) * 100).toFixed(0)}%`,
    );
    console.log(
      `  等价于：D14 每天被扣 0.3 × 离线 = ${formatMoyu(bot.days.at(-1)!.offlineEarned * 0.3)}（日收入的 ${((bot.days.at(-1)!.offlineEarned * 0.3) / bot.days.at(-1)!.dayIncome * 100).toFixed(0)}%）`,
    );
    expect(audit.loss07 / audit.actual07).toBeCloseTo(0.4286, 2); // 1/0.7-1
  });

  it("24h 边界是一道 3 分钟的悬崖：同样离场 13h，晚 10 分钟开页就吃 0.7", () => {
    // 用真实存档链：D1 09:03 建档、D1 20:03 关页存档 → 次日 09:00 / 09:10 分别 boot
    const d1 = runBot({ ...DEFAULT_CFG, days: 1 });
    const idle = effectOf(d1.state).idleRate;
    const mem = memSave();
    const installAt = EPOCH_DAY1 + 9 * 3600_000 + 3 * 60_000;
    const closeAt = EPOCH_DAY1 + 20 * 3600_000 + 3 * 60_000;
    serialize(d1.state, mem, installAt); // 首存 → createdAt = 09:03
    serialize(d1.state, mem, closeAt); // 关页存档 → savedAt = 20:03
    const run = (now: number): { rate: number; applied: number; earned: number; createdAt: number } => {
      const back = restore(mem, now);
      const rate = now - back.createdAt < 86_400_000 ? 1 : 0.7;
      const r = settleReturn(back.state!, now - back.offlineSeconds * 1000, now, rate);
      return { rate, applied: r.applied, earned: r.earned, createdAt: back.createdAt };
    };
    const onTime = run(EPOCH_DAY1 + 86_400_000 + 9 * 3600_000); // D2 09:00（差 3 分钟进 24h 窗口）
    const late = run(EPOCH_DAY1 + 86_400_000 + 9 * 3600_000 + 10 * 60_000); // D2 09:10
    console.log("\n===== 24h 边界悬崖（同一份存档）=====");
    console.log(`  D1 结束挂机率 ${formatMoyu(idle)}/秒，离场 ${(12.95).toFixed(2)}h（结算封顶 8h）`);
    console.log(
      `  D2 09:00 开页：createdAt 距今 ${((EPOCH_DAY1 + 86_400_000 + 9 * 3600_000 - onTime.createdAt) / 3600_000).toFixed(2)}h → 速率 ${onTime.rate}，结算 ${(onTime.applied / 3600).toFixed(1)}h = ${formatMoyu(onTime.earned)}`,
    );
    console.log(
      `  D2 09:10 开页：createdAt 距今 ${((EPOCH_DAY1 + 86_400_000 + 9 * 3600_000 + 600_000 - late.createdAt) / 3600_000).toFixed(2)}h → 速率 ${late.rate}，结算 ${(late.applied / 3600).toFixed(1)}h = ${formatMoyu(late.earned)}`,
    );
    const loss = onTime.earned - late.earned;
    const d1Active = d1.visits.reduce((a, v) => a + v.activeEarned, 0);
    console.log(
      `  只差 10 分钟开页 → 少拿 ${formatMoyu(loss)}（一笔隔夜收益的 30%）= Day1 全天主动游玩收入（${formatMoyu(d1Active)}）的 ${(loss / d1Active).toFixed(1)} 倍`,
    );
    expect(onTime.rate).toBe(1);
    expect(late.rate).toBe(0.7);
    expect(late.earned / onTime.earned).toBeCloseTo(0.7, 6);
    expect(loss / d1Active).toBeGreaterThan(50);
  });

  it("8h 封顶 + 0.7 叠加：正常睡眠（13h）只结算 43% 的时长；14 天共丢 64.4h", () => {
    const nights = bot.visits.filter((v) => v.visit === 1 && v.gapSeconds > 0);
    console.log("\n===== 隔夜结算效率（3 次回访节奏）=====");
    for (const v of nights) {
      console.log(
        `  D${v.day} 隔夜：离开 ${(v.gapSeconds / 3600).toFixed(2)}h → 只结算 ${(v.offlineApplied / 3600).toFixed(2)}h × ${v.rate} = 有效 ${((v.offlineApplied / 3600) * v.rate).toFixed(2)}h（占离场时长 ${(((v.offlineApplied * v.rate) / v.gapSeconds) * 100).toFixed(0)}%）`,
      );
    }
    console.log(
      `\n  14 天因 8h 封顶未结算 ${audit.capLostHours.toFixed(1)}h；因 0.7 少结算 ${formatMoyu(audit.loss07)}`,
    );
    console.log(
      `  离线/主动收入比：离线 ${formatMoyu(audit.totalOffline)} vs 主动 ${formatMoyu(audit.totalActive)}（主动仅 ${((audit.totalActive / (audit.totalOffline + audit.totalActive)) * 100).toFixed(2)}%）`,
    );
    expect(audit.capLostHours).toBeGreaterThan(60);
    // 每 3 次回访的日均离线覆盖 ≈ 18.9h / 24h
    const avgCover = audit.byDay.reduce((a, x) => a + x.applied, 0) / 14 / 3600;
    console.log(`  日均离线结算覆盖 ${avgCover.toFixed(2)}h / 24h（3 次回访拆成 3.45h + 7.45h + 8h 封顶）`);
    expect(avgCover).toBeGreaterThan(18);
    expect(avgCover).toBeLessThan(20);
  });

  it("回访本身值多少钱：主动游玩只贡献 1.3% 日收入，日报奖励 0.14%", () => {
    const last = bot.days.at(-1)!;
    console.log("\n===== 单次回访的价值（D14）=====");
    console.log(`  D14 日收入 ${formatMoyu(last.dayIncome)}；3 次回访主动游玩共 ${formatMoyu(last.activeEarned)}（${(100 * last.activeEarned / last.dayIncome).toFixed(2)}%）`);
    console.log(`  D14 日报奖励 ${formatMoyu(last.daily!.reward)}（${(100 * last.dailyRewardRatio).toFixed(3)}%）= 60 秒挂机收益`);
    console.log(`  D14 三次离线结算合计 ${formatMoyu(last.offlineEarned)}（${(100 * last.offlineRatio).toFixed(1)}%，开页即自动到账，与点击无关）`);
    expect(last.activeEarned / last.dayIncome).toBeLessThan(0.02);
    expect(last.dailyRewardRatio).toBeLessThan(0.002);

    // 0.7 的解法对比：若 3 次回访能把当日离线效率从 0.7 拉到 1.0，回报有多大？
    const uplift = last.offlineEarned / 0.7 - last.offlineEarned;
    console.log(
      `  若「3 次回访 → 离线效率 0.7 升到 1.0」：单日多拿 ${formatMoyu(uplift)}（= 日收入 ${(100 * uplift / last.dayIncome).toFixed(0)}%）→ 回访边际收益从 1.3% 提到 42%`,
    );
    expect(uplift / last.dayIncome).toBeGreaterThan(0.25);
    // 8h 封顶本身也是暗规则：面板只写「8 小时封顶」，玩家无法推导「多一次回访能多结算 3h」
    expect(OFFLINE_CAP_SECONDS).toBe(8 * 3600);
  });
});
