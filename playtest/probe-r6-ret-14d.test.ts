import { describe, it, expect } from "vitest";
import {
  runBot,
  dayRow,
  longestNoChangeRun,
  longestNoWeakChangeRun,
  collectionGap,
  DEFAULT_CFG,
  formatMoyu,
  type Bot,
  type DayLog,
} from "./probe-r6-ret-lib";

/**
 * 探针①：14 天真实回访（每天 3 次 × 3 分钟）
 *  - 全链路用 src/engine 真实函数：openPage=restore+settleReturn，play=doClick/onBossTap/onMemeTap/
 *    finishPatrol/advance/scheduleEvents，养成=buyUpgrade+syncFlavorCollection，日报=dailyTrack/claimDaily
 *  - 记录每天：段位 / 图鉴 / 解锁数 / 等级和 / 挂机率 / 日收入(离线占比) / 日报 / 当日新变化
 */

const bot14 = runBot();

function table(bot: Bot): string {
  return bot.days.map((d) => dayRow(d)).join("\n");
}

function incomeGrowth(days: DayLog[], i: number): number {
  const prev = days[i - 1]!;
  const cur = days[i]!;
  return cur.dayIncome / prev.dayIncome;
}

describe("R6 留存①：14 天成长表（画像：每天 3 次 × 3 分钟）", () => {
  it("14 天逐日成长表（天/段位/图鉴/解锁/日报）", () => {
    console.log("\n===== 14 天成长表（理性长线玩家：2cps、5s 看一次商店、优先解锁新卡再买挂机性价比） =====");
    console.log(table(bot14));
    expect(bot14.days).toHaveLength(14);
    // Day1 就把 9 档升级全部解锁
    expect(bot14.days[0]!.unlocked).toBe(9);
    // Day1 结束已到第 4 档（摸鱼大师）；Day3 触顶第 7 档
    expect(bot14.days[0]!.rankIdx).toBeGreaterThanOrEqual(3);
    expect(bot14.days[0]!.rankIdx).toBeLessThanOrEqual(4);
    expect(bot14.days.find((d) => d.rankIdx === 6)!.day).toBe(3);
    // Day3 起段位一直是终点 100%
    for (const d of bot14.days.filter((x) => x.day >= 3)) {
      expect(d.rankIdx).toBe(6);
      expect(d.rankProgress).toBe(1);
    }
    // 图鉴在 Day5 到 43/55 后不再变化（理性玩家不买点击线）
    expect(bot14.days.at(-1)!.collection).toBe(43);
    // 日收入走势：Day1→Day2 +33.6 倍，Day3 后仍 +4.75 倍
    expect(incomeGrowth(bot14.days, 1)).toBeGreaterThan(20);
    expect(incomeGrowth(bot14.days, 2)).toBeGreaterThan(4);
    // Day8 之后日收入增速掉到 1~1.2 倍（游戏只剩数字微增）
    for (let i = 8; i < 14; i++) expect(incomeGrowth(bot14.days, i)).toBeLessThan(1.1);
    console.log(
      `\n--- 关键量 ---\nD1 累计 ${formatMoyu(bot14.days[0]!.totalEarned)}，D3 累计 ${formatMoyu(bot14.days[2]!.totalEarned)}，D14 累计 ${formatMoyu(bot14.days.at(-1)!.totalEarned)}`,
    );
    console.log(
      `D1 日收入 ${formatMoyu(bot14.days[0]!.dayIncome)}（离线占比 ${(bot14.days[0]!.offlineRatio * 100).toFixed(0)}%）→ D2 ${formatMoyu(bot14.days[1]!.dayIncome)}（×${incomeGrowth(bot14.days, 1).toFixed(1)}）→ D14 ${formatMoyu(bot14.days.at(-1)!.dayIncome)}`,
    );
    console.log(
      `D8→D14 日收入增速：${Array.from({ length: 6 }, (_, k) => `D${k + 9}:×${incomeGrowth(bot14.days, k + 8).toFixed(2)}`).join(" ")}`,
    );
  });

  it("最大「无确定新变化」连续天数（新变化=段位晋升/图鉴新增/新升级解锁）", () => {
    const strict = longestNoChangeRun(bot14.days);
    const lenient = longestNoWeakChangeRun(bot14.days);
    console.log("\n===== 无新变化连续天数（主 seed）=====");
    for (const r of strict.runs) {
      console.log(`  严格口径：D${r.from} ~ D${r.to}（${strict.runs.find((x) => x.from === r.from) ? `${r.length} 天` : ""}）`);
    }
    console.log(`  最长严格口径：${strict.length} 天，D${strict.from} ~ D${strict.to}`);
    console.log(
      `  日历：D${strict.from} = ${bot14.days.find((d) => d.day === strict.from)!.date}，D${strict.to} = ${bot14.days.find((d) => d.day === strict.to)!.date}`,
    );
    console.log(`  宽松口径（把每 20 级 ×2 里程碑也算「新变化」）：${lenient.length} 天，D${lenient.from} ~ D${lenient.to}`);
    // 严格口径：最后两档变化之后一路空到 D14
    expect(strict.length).toBeGreaterThanOrEqual(9);
    expect(strict.from).toBe(6);
    expect(strict.to).toBe(14);
    expect(bot14.days.find((d) => d.day === strict.from)!.date).toBe("2026-12-02");
    expect(bot14.days.find((d) => d.day === strict.to)!.date).toBe("2026-12-10");
    // 宽松口径也只有 3 天：×2 脉冲只能撑到 D8
    expect(lenient.length).toBeLessThanOrEqual(3);

    // 多 seed 复现 + 30 天外推：空窗不是单点巧合
    const seeds = [1, 7, 42, 20261127, 999];
    console.log("\n===== 多 seed 复现 =====");
    for (const seed of seeds) {
      const b = runBot({ ...DEFAULT_CFG, seed });
      const r = longestNoChangeRun(b.days);
      const maxRankDay = b.days.find((d) => d.rankIdx === 6)!.day;
      console.log(
        `  seed ${String(seed).padStart(8)}: 无变化 ${r.length} 天(D${r.from}-D${r.to})，满段 D${maxRankDay}，图鉴 ${b.days.at(-1)!.collection}/55，D14 累计 ${formatMoyu(b.days.at(-1)!.totalEarned)}`,
      );
      expect(maxRankDay).toBe(3);
    }
    const b30 = runBot({ ...DEFAULT_CFG, days: 30 });
    const r30 = longestNoChangeRun(b30.days);
    console.log(
      `\n30 天外推：D30 累计 ${formatMoyu(b30.days.at(-1)!.totalEarned)}、日收入 ${formatMoyu(b30.days.at(-1)!.dayIncome)}、图鉴 ${b30.days.at(-1)!.collection}/55 → 无新变化连续 ${r30.length} 天（D${r30.from}~D${r30.to}）`,
    );
    expect(r30.length).toBeGreaterThanOrEqual(25);
  });

  it("日报：每天 3 目标能否在 3 分钟内完成？streak 能否连到 14？", () => {
    console.log("\n===== 日报 14 天 =====");
    let within3 = 0;
    for (const d of bot14.days) {
      const claim = bot14.visits.find((v) => v.day === d.day && v.claimedReward !== null);
      const ok3 = claim?.visit === 1;
      if (ok3) within3++;
      console.log(
        `  D${String(d.day).padStart(2, "0")} ${d.daily!.goals.map((g) => ({ click_100: "点100", meme_1: "收1梗", buy_3: "买3级", survive_2: "巡逻1次" })[g] ?? g).join("/")}｜首次 3/3 ${ok3 ? "✅" : "❌"}（${d.daily!.doneAtVisit === 1 ? `第 1 次回访 ${d.daily!.doneAtSeconds}s 处完成` : `第 2 次回访 12:30 完成（3 分钟窗口内做不到）`}）｜${d.daily!.claimed ? "已领" : "未领"} streak=${d.daily!.streak}｜奖励 ${formatMoyu(d.daily!.reward)}（日收入 ${(d.dailyRewardRatio * 100).toFixed(2)}%）`,
      );
    }
    console.log(`\n  3 分钟内完成 ${within3}/14；14 天全部领取：${bot14.days.every((d) => d.daily!.claimed)}；streak=${bot14.days.at(-1)!.daily!.streak}`);
    expect(bot14.days.every((d) => d.daily!.claimed)).toBe(true);
    expect(bot14.days.at(-1)!.daily!.streak).toBe(14);
    // 后期「买 3 级」目标会被经济规模卡住：D14 只有第 2 次回访才完成
    expect(within3).toBeGreaterThanOrEqual(13);
    expect(bot14.days.at(-1)!.daily!.doneAtVisit).toBe(2);
    // 日报奖励占日收入：Day1 1.7% → D14 0.14%
    expect(bot14.days[0]!.dailyRewardRatio).toBeGreaterThan(0.01);
    expect(bot14.days.at(-1)!.dailyRewardRatio).toBeLessThan(0.002);
    console.log(
      `\n  日报奖励占比：D1 ${(bot14.days[0]!.dailyRewardRatio * 100).toFixed(2)}% → D7 ${(bot14.days[6]!.dailyRewardRatio * 100).toFixed(2)}% → D14 ${(bot14.days.at(-1)!.dailyRewardRatio * 100).toFixed(3)}%（= 60 秒挂机收益）`,
    );
    console.log(`  D14 当天 3 次回访共买 ${bot14.days.at(-1)!.purchases} 次（目标要 3 次/3 分钟 → 买不起）`);
  });

  it("图鉴为什么停在 43/55：最后 12 格全绑在点击线上", () => {
    const gap = collectionGap(bot14.state);
    const last = bot14.days.at(-1)!;
    console.log("\n===== 图鉴缺口（理性玩家 D14）=====");
    console.log(`  图鉴 ${last.collection}/55：语录 ${last.quotes}/10 + 彩蛋 ${last.flavors}/45`);
    console.log(`  缺口 ${gap.flavorsMissing} 条彩蛋，全部来自点击线：`);
    for (const it of gap.items) {
      console.log(`    ${it.name} · Lv${it.tierLv}：Lv${it.from}→${it.to}，补到该档需 ${formatMoyu(it.cost)} 摸鱼值`);
    }
    console.log(`  补齐合计 ${formatMoyu(gap.totalCost)}（= D14 日收入的 ${((gap.totalCost / last.dayIncome) * 100).toFixed(4)}%）`);
    console.log(
      `  但点击力只有 ${last.clickPower}，挂机 ${formatMoyu(last.idleRate)}/秒 → 点 1 下 = 挂机 ${(last.clickPower / last.idleRate).toExponential(2)} 秒，理性玩家没有理由买`,
    );
    expect(gap.flavorsMissing).toBe(12);
    expect(gap.items.every((x) => x.click)).toBe(true);
    expect(last.collection).toBe(43);
    // 换「图鉴党」策略：55/55 在 D5 就能收满，之后同样空窗
    const completionist = runBot({ ...DEFAULT_CFG, strategy: "completionist" });
    const fullDay = completionist.days.find((d) => d.collection === 55)!.day;
    const otherStreak = longestNoChangeRun(completionist.days);
    console.log(
      `\n  图鉴党（优先补彩蛋档）：55/55 在 D${fullDay} 收满（当日日收入 ${formatMoyu(completionist.days.find((d) => d.day === fullDay)!.dayIncome)}）；之后无变化连续 ${otherStreak.length} 天（D${otherStreak.from}~D${otherStreak.to}）`,
    );
    expect(fullDay).toBeLessThanOrEqual(5);
    expect(otherStreak.length).toBeGreaterThanOrEqual(9);
  });

  it("策略敏感度：慢手/乱买玩家的「空窗」只是被低效率推迟", () => {
    const slow = runBot({ ...DEFAULT_CFG, cps: 1, buyCadence: 12, strategy: "cheapest" });
    const r = longestNoChangeRun(slow.days);
    const maxRank = slow.days.find((d) => d.rankIdx === 6)!.day;
    console.log("\n===== 慢手新手（1cps / 12s 看一次商店 / 永远买最便宜）=====");
    console.log(table(slow));
    console.log(
      `\n  无变化最长 ${r.length} 天（D${r.from}-D${r.to}）；满段 D${maxRank}；D14 图鉴 ${slow.days.at(-1)!.collection}/55、累计 ${formatMoyu(slow.days.at(-1)!.totalEarned)}`,
    );
    // 慢手玩家靠「低效率」把同样内容摊到 D14，说明不是内容更多，只是更慢
    expect(r.length).toBeLessThanOrEqual(2);
    expect(maxRank).toBeGreaterThanOrEqual(10);
    const slow30 = runBot({ ...DEFAULT_CFG, days: 30, cps: 1, buyCadence: 12, strategy: "cheapest" });
    console.log(
      `  30 天外推：慢手玩家同样在 D${longestNoChangeRun(slow30.days).from} 后进入 ${longestNoChangeRun(slow30.days).length} 天无变化`,
    );
    expect(longestNoChangeRun(slow30.days).length).toBeGreaterThanOrEqual(10);
  });
});
