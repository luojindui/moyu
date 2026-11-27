import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { effectOf, UPGRADES, costOf, valueScoreOf, milestoneGap } from "../src/engine/upgrades";
import { syncFlavorCollection, collectionCount, TOTAL_ITEMS } from "../src/engine/collection";
import { DAILY_GOAL_TEMPLATES, DAILY_WINDOWS_PER_DAY } from "../src/engine/daily";
import { OFFLINE_CAP_SECONDS, capForElapsed } from "../src/engine/offline";
import { formatMoyu } from "../src/engine/format";
import {
  simulate,
  analyzeSchedule,
  IDLE_IDS,
  DAY_MS,
  EPOCH,
  HOUR,
  SESSION_SECONDS,
  OFFLINE_CAP_H,
  type PolicyName,
  type SimResult,
} from "./probe-r11-calc-lib";

/**
 * R11 计算器党探针：
 * ① 每天只开 1 次、只购买 —— 7 天策略对比（贪心 / 攒钱 / 均衡 / 单卡 / 攒里程碑）
 * ② 1 次 vs 3 次回访的离线收益差（效率 0.8→1.0 + 8h 封顶）
 * ③ 离线规则对"只离线党"是否公平（封顶 / 效率 / streak / 日报可达性 / 图鉴）
 */

const DAYS = 7;
const DAILY_OPEN = [21 * 60]; // 每天 21:00 开一次，每次 10s
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const x = (a: number, b: number): string => `${(a / b).toFixed(2)}×`;

function fmtHours(h: number): string {
  return `${h.toFixed(2)}h（${pct(h / 24)} 的 24h）`;
}

/* ============================ ② 打开节律 ============================ */

describe("② 打开节律：1 次 vs 3 次回访", () => {
  it("稳态等效收益：间隔封顶 + 回访效率（真实引擎 capForElapsed）", () => {
    const schedules: { name: string; opens: number[] }[] = [
      { name: "每天 1 次（21:00）", opens: [21 * 60] },
      { name: "每天 1 次（00:05，跨零点）", opens: [0 * 60 + 5] },
      { name: "每天 2 次（09:00 / 20:00）", opens: [9 * 60, 20 * 60] },
      { name: "每天 2 次（00:00 / 16:00，长间隔压后）", opens: [0, 16 * 60] },
      { name: "每天 3 次（09:00 / 13:00 / 20:00）", opens: [9 * 60, 13 * 60, 20 * 60] },
      { name: "每天 3 次（00:05 / 08:05 / 16:05，8h 均分）", opens: [5, 8 * 60 + 5, 16 * 60 + 5] },
      { name: "每天 3 次（21:00 连开 3 下 +10s/+20s）", opens: [21 * 60, 21 * 60 + 10, 21 * 60 + 20] },
      { name: "每天 4 次（每 6h）", opens: [0, 6 * 60, 12 * 60, 18 * 60] },
    ];
    const rows = schedules.map((s) => analyzeSchedule(s.opens));
    const base = rows[0]!.effectiveHoursPerDay;
    console.log("\n② 稳态：每天离线结算的等效满速小时（rate × applied）");
    console.log("节律".padEnd(52) + " | 间隔(h)".padEnd(24) + " | 效率".padEnd(20) + " | 等效(h)".padEnd(22) + " | vs 1次");
    rows.forEach((r) => {
      const gaps = r.perOpen.map((p) => p.gapHours.toFixed(1)).join(",");
      const rates = r.perOpen.map((p) => p.rate.toFixed(1)).join(",");
      console.log(
        r.label.padEnd(42) +
          ` | ${gaps}`.padEnd(16) +
          ` | ${rates}`.padEnd(14) +
          ` | ${r.effectiveHoursPerDay.toFixed(2)}h (${pct(r.effectiveHoursPerDay / 24)} 24h)`.padEnd(26) +
          ` | ${(r.effectiveHoursPerDay / base).toFixed(3)}×`,
      );
    });
    // 引擎断言：8h 封顶、24h 间隔只结算 8h
    expect(capForElapsed(24 * HOUR)).toBe(OFFLINE_CAP_SECONDS);
    expect(capForElapsed(13 * HOUR)).toBe(OFFLINE_CAP_SECONDS);
    expect(capForElapsed(2 * 24 * HOUR)).toBe(OFFLINE_CAP_SECONDS);
    expect(capForElapsed(7 * 24 * HOUR)).toBe(24 * HOUR);
    const one = rows[0]!.perOpen[0]!;
    expect(one.rate).toBeCloseTo(0.8, 10); // 先 ensureVisits 再算效率：当天第一次打开已 +0.1
    expect(one.effectiveHours).toBeCloseTo(6.4, 10);
    expect(rows[5]!.effectiveHoursPerDay).toBeCloseTo(21.6, 10); // 3 次 8h 均分上限
    expect(rows[6]!.effectiveHoursPerDay - base).toBeLessThan(0.5); // 连开 3 下仅 +<0.5h
    expect(rows[5]!.effectiveHoursPerDay / base).toBeCloseTo(3.375, 6);
  });

  it("7 天引擎模拟：1 次 vs 3 次（贪心，纯离线收益对比，不含日报）", () => {
    const runs = [
      simulate({ days: DAYS, opens: [21 * 60], policy: "greedy", daily: false, prestige: "never", label: "1 次 21:00" }),
      simulate({ days: DAYS, opens: [9 * 60, 20 * 60], policy: "greedy", daily: false, prestige: "never", label: "2 次 9/20" }),
      simulate({ days: DAYS, opens: [9 * 60, 13 * 60, 20 * 60], policy: "greedy", daily: false, prestige: "never", label: "3 次 9/13/20" }),
      simulate({
        days: DAYS,
        opens: [5, 8 * 60 + 5, 16 * 60 + 5],
        policy: "greedy",
        daily: false,
        prestige: "never",
        label: "3 次 8h 均分",
      }),
    ];
    const base = runs[0]!.totalOffline;
    console.log("\n② 7 天引擎模拟（只买不点、贪心购买、不含日报/转生）");
    console.log("节律".padEnd(20) + " | 7天离线总收入".padEnd(24) + " | 第7天 idle/s".padEnd(16) + " | 倍率");
    runs.forEach((r) => {
      console.log(
        r.label.padEnd(18) +
          ` | ${formatMoyu(r.totalOffline).padEnd(20)} (${r.totalOffline.toExponential(2)})` +
          ` | ${r.day7Idle.toFixed(1)}`.padEnd(18) +
          ` | ${(r.totalOffline / base).toFixed(2)}×`,
      );
    });
    expect(runs[3]!.totalOffline).toBeGreaterThan(runs[2]!.totalOffline);
    expect(runs[2]!.totalOffline).toBeGreaterThan(runs[0]!.totalOffline);
  });
});

/* ============================ ① 7 天购买策略 ============================ */

describe("① 每天 1 次、只购买：7 天策略对比", () => {
  it("贪心 vs 攒钱 vs 均衡 vs 单卡 vs 攒里程碑", () => {
    const policies: PolicyName[] = ["greedy", "balanced", "hoard-big", "phone-only", "milestone-pack"];
    const runs: SimResult[] = policies.map((p) =>
      simulate({ days: DAYS, opens: DAILY_OPEN, policy: p, daily: true, prestige: "never", seed: 20261101 }),
    );
    const base = runs[0]!.totalOffline;
    console.log("\n① 7 天模拟（每天 21:00 开 10s、只购买、含日报）");
    console.log(
      "策略".padEnd(34) +
        " | 7天离线收入".padEnd(24) +
        " | 第7天 idle/s".padEnd(15) +
        " | 7天在线(日报)".padEnd(14) +
        " | vs 贪心",
    );
    runs.forEach((r) => {
      console.log(
        r.label.padEnd(32) +
          ` | ${formatMoyu(r.totalOffline).padEnd(20)}` +
          ` | ${r.day7Idle.toFixed(1)}`.padEnd(17) +
          ` | ${formatMoyu(r.dailyOffline.reduce((a, b) => a + b, 0) * 0).padEnd(10)}` +
          ` | ${((r.totalOffline / base - 1) * 100).toFixed(1)}%`,
      );
    });
    // 每日明细
    console.log("\n逐日离线进账（第 1 天=新建档，无离线）");
    const header = ["策略".padEnd(16)].concat(runs[0]!.days.map((d) => `D${d.day}`.padEnd(12))).join(" | ");
    console.log(header);
    runs.forEach((r) => {
      console.log(
        r.label.slice(0, 14).padEnd(14) +
          " | " +
          r.days.map((d) => formatMoyu(d.offlineEarned).padEnd(10)).join(" | "),
      );
    });
    console.log("\n每日购买（贪心）");
    runs[0]!.days.forEach((d) => {
      const parts = Object.entries(d.purchases).map(([id, n]) => `${id}×${n}`);
      console.log(
        `  D${d.day}: 结算 ${(d.appliedSeconds / 3600).toFixed(1)}h × ${d.rateFirst.toFixed(1)} → +${formatMoyu(d.offlineEarned)}；买 ${parts.join(" ")}；日终 idle ${d.idleEnd.toFixed(1)}/s`,
      );
    });
    // 贪心到底买了什么（7 天累计）
    const totals: Record<string, number> = {};
    runs[0]!.days.forEach((d) => {
      for (const [id, n] of Object.entries(d.purchases)) totals[id] = (totals[id] ?? 0) + n;
    });
    console.log("\n贪心 7 天累计购买：", JSON.stringify(totals));
    console.log(
      "贪心第 7 天各档等级：",
      JSON.stringify(
        Object.fromEntries(IDLE_IDS.map((id) => [id, runs[0]!.opens[runs[0]!.opens.length - 1]!.purchases[id] ? 0 : 0])),
      ),
    );
    console.log("贪心 7 天日报领取次数：", runs[0]!.opens.filter((o) => o.dailyClaimed !== null).length);
    expect(runs[0]!.totalOffline).toBeGreaterThan(runs[1]!.totalOffline);
    expect(runs[0]!.totalOffline).toBeGreaterThan(runs[2]!.totalOffline);
    expect(runs[0]!.totalOffline).toBeGreaterThan(runs[4]!.totalOffline);
  });

  it("贪心购买顺序（按性价比排序的实际序列，前 30 笔）", () => {
    // 只跑 3 天看前几天的购买顺序（长序列在第 1 周就会出现里程碑跳变）
    const r = simulate({ days: 7, opens: [21 * 60], policy: "greedy", daily: false, prestige: "never" });
    const seq: { day: number; idle: number; tier: string }[] = [];
    r.days.forEach((d, i) => {
      const ids: string[] = [];
      for (const [id, n] of Object.entries(d.purchases)) for (let k = 0; k < n; k++) ids.push(id);
      ids.forEach((id) => seq.push({ day: d.day, idle: d.idleEnd, tier: id }));
    });
    console.log("\n贪心 7 天购买明细（按天汇总）");
    r.days.forEach((d) => {
      const parts = Object.entries(d.purchases).map(([id, n]) => `${id}×${n}`).join(", ");
      console.log(`  D${d.day}: ${parts || "（没钱，空手）"}  → 日终 idle ${d.idleEnd.toFixed(1)}/s，余额 ${formatMoyu(d.balanceEnd)}`);
    });
    // 初始各档的边际性价比（排序依据）
    console.log("\n各档 Lv.0→1 边际性价比（每 1 万摸鱼值换到的 idle/s）与首次 ×2 里程碑");
    const s = initialState();
    UPGRADES.filter((u) => u.idleRate).forEach((u) => {
      const score = valueScoreOf(u.id, 0).idle;
      const gap = milestoneGap(u.id, 0);
      console.log(
        `  ${u.name.padEnd(6)} 基础 ${String(u.idleRate).padStart(3)}/s 价 ${String(u.baseCost).padStart(8)} → ${score.toFixed(1)}/万  | 距首次×2 ${gap} 级 (到 Lv.${gap})`,
      );
    });
    expect(seq.length).toBeGreaterThan(5);
    // 首笔必须是刷手机（Lv.4→5 的 ×2 跳变性价比最高）
    expect(seq[0]!.tier).toBe("phone");
  });
});

/* ============================ ③ 公平性 ============================ */

describe("③ 离线党公平性", () => {
  it("8h 封顶 vs 24h 真实离线：离线党只拿到 1/3 时间", () => {
    const dailyGapH = 24;
    const appliedH = capForElapsed(dailyGapH * HOUR) / HOUR;
    console.log(`\n③ 每天离线 24h：真实 ${dailyGapH}h → 结算 ${appliedH}h（${pct(appliedH / dailyGapH)}）`);
    console.log(`   1 次/天效率 0.8 → 等效 ${(appliedH * 0.8).toFixed(2)}h = ${pct((appliedH * 0.8) / 24)} 的 24h`);
    console.log(`   48h 回来（隔一天）：仍只结算 ${capForElapsed(48 * HOUR) / HOUR}h → 平均每天 ${((capForElapsed(48 * HOUR) / HOUR) / 2).toFixed(1)}h 等效 ${(6.4 / 2).toFixed(2)}h`);
    console.log(`   7 天回来：结算 ${capForElapsed(7 * 24 * HOUR) / HOUR}h 且效率强制 1.0 → ${(24 * 1.0).toFixed(1)}h，日均 ${(24 / 7).toFixed(1)}h vs 每天开 ${(6.4).toFixed(1)}h`);
    console.log(`   30 天回来：结算 ${capForElapsed(30 * 24 * HOUR) / HOUR}h × 1.0 → 日均 ${(48 / 30).toFixed(2)}h`);
    expect(capForElapsed(24 * HOUR)).toBe(8 * HOUR);
    expect(capForElapsed(48 * HOUR)).toBe(8 * HOUR); // 隔一天不补，白白损失一整天
    expect(capForElapsed(7 * 24 * HOUR)).toBe(24 * HOUR);
    expect(capForElapsed(30 * 24 * HOUR)).toBe(48 * HOUR);
  });

  it("离线党的日报/streak 可达性：3 个目标全部零操作才可能完成", () => {
    // 6 个目标池抽 3 个不重复 → 共 C(6,3)=20 种；10s 会话永远到不了首次巡逻(20-35s)，也不会点击/收梗
    const zeroOp = new Set(["visit_1", "idle_earn", "buy_3"]);
    const templates = DAILY_GOAL_TEMPLATES;
    const combos: string[][] = [];
    for (let a = 0; a < templates.length; a++)
      for (let b = a + 1; b < templates.length; b++)
        for (let c = b + 1; c < templates.length; c++) combos.push([templates[a]!.id, templates[b]!.id, templates[c]!.id]);
    const completable = combos.filter((c) => c.every((id) => zeroOp.has(id)));
    const reachable = completable.length / combos.length;
    console.log(`\n③ 日报目标池 6 个抽 3 个 = ${combos.length} 种组合`);
    console.log(`   10 秒纯离线可完成（必须全在 visit/idle/buy 里）的组合数：${completable.length} → ${pct(reachable)}/天`);
    console.log(`   连续 7 天都完成才能 streak+1 → 概率 ${(reachable ** 7).toExponential(2)}（每 7 天 +0.05 效率基本拿不到）`);
    console.log(`   click_100 / meme_1 / survive_2 对离线党是死目标（不点屏幕；首次巡逻在 20-35s，10s 会话遇不到）`);
    // 期望：每天 5% 能领日报
    expect(reachable).toBeCloseTo(1 / 20, 10);
  });

  it("离线党图鉴上限：30/55 → +12%，拿不到点击线 15 格与 ×1.2 集满奖励", () => {
    const idleIds = new Set(IDLE_IDS);
    const clickItems = UPGRADES.filter((u) => !idleIds.has(u.id)).length * 5; // 3 档 × 5
    const quotes = 10; // 丢梗语录，毛都不点拿不到
    const offlineMax = UPGRADES.length * 5 - clickItems - quotes; // 6 档挂机线 × 5
    const s = initialState();
    const c30 = collectionCount(syncFlavorCollection({ ...s, levels: Object.fromEntries(IDLE_IDS.map((id) => [id, 50])) }));
    const bonus = (n: number): number => 1 + Math.min(0.2, 0.02 * Math.floor(n / 5));
    console.log(`\n③ 只离线：累计点击 0 → 点击线彩蛋 0/${clickItems}，语录 0/${quotes}；上限 ${offlineMax}/${TOTAL_ITEMS}`);
    console.log(`   图鉴加成：离线 ${c30} 格 → ×${bonus(c30).toFixed(2)}；活跃玩家 55 格 → ×1.20（差 ${pct(bonus(55) / bonus(c30) - 1)}）`);
    console.log(`   （注：collection.ts 导出了 COLLECTION_BONUS=1.2 但升级公式里未使用，README 的"集满 ×1.2"实际未落地）`);
    expect(c30).toBe(30);
    expect(bonus(c30)).toBeCloseTo(1.12, 10);
    expect(bonus(55)).toBeCloseTo(1.2, 10);
  });

  it("回访效率机制的实际价值：连开 3 下只多 5%", () => {
    const burst = analyzeSchedule([21 * 60, 21 * 60 + 10, 21 * 60 + 20]);
    const once = analyzeSchedule([21 * 60]);
    const gain = burst.effectiveHoursPerDay / once.effectiveHoursPerDay - 1;
    console.log(`\n③ 同一天 21:00/21:10/21:20 连开 3 次：等效 ${burst.effectiveHoursPerDay.toFixed(2)}h vs 1 次 ${once.effectiveHoursPerDay.toFixed(2)}h → +${pct(gain)}`);
    console.log(`   效率 0.9/1.0 只作用在 10 分钟的短间隔上，回访加成几乎白给`);
    expect(gain).toBeLessThan(0.06);
    expect(gain).toBeGreaterThan(0.03);
  });
});

/* ============================ ④ 10 秒操作优化空间 ============================ */

describe("④ 10 秒操作：不同策略的 7 天差距（用来量化一键最优购买的价值）", () => {
  it("一次买错 = 一整天离线收益打折", () => {
    const greedy = simulate({ days: 7, opens: [21 * 60], policy: "greedy", daily: true, prestige: "never" });
    const balanced = simulate({ days: 7, opens: [21 * 60], policy: "balanced", daily: true, prestige: "never" });
    const hoard = simulate({ days: 7, opens: [21 * 60], policy: "hoard-big", daily: true, prestige: "never" });
    console.log(`\n④ 7 天对比：贪心 ${formatMoyu(greedy.totalOffline)}｜均衡 ${formatMoyu(balanced.totalOffline)}（${pct(balanced.totalOffline / greedy.totalOffline - 1)}）｜攒大卡 ${formatMoyu(hoard.totalOffline)}（${pct(hoard.totalOffline / greedy.totalOffline - 1)}）`);
    expect(greedy.totalOffline).toBeGreaterThanOrEqual(balanced.totalOffline);
    expect(greedy.totalOffline).toBeGreaterThan(hoard.totalOffline);
    // 第 7 天 idle 差距（关页快照直接决定次日收益）
    console.log(`   第 7 天关页 idle：贪心 ${greedy.day7Idle.toFixed(1)}/s vs 均衡 ${balanced.day7Idle.toFixed(1)}/s vs 攒大卡 ${hoard.day7Idle.toFixed(1)}/s`);
    console.log(`   即：如果 D7 买错，D8 的离线收益直接差 ${pct(balanced.day7Idle / greedy.day7Idle - 1)} / ${pct(hoard.day7Idle / greedy.day7Idle - 1)}`);
  });
});
