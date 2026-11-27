import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { initialState } from "../src/engine/state";
import { effectOf, UPGRADES, valueScoreOf, milestoneGap } from "../src/engine/upgrades";
import { syncFlavorCollection, collectionCount, TOTAL_ITEMS } from "../src/engine/collection";
import { DAILY_GOAL_TEMPLATES } from "../src/engine/daily";
import { capForElapsed } from "../src/engine/offline";
import { formatMoyu } from "../src/engine/format";
import {
  simulate,
  analyzeSchedule,
  optimalPurchases,
  IDLE_IDS,
  HOUR,
  type PolicyName,
  type SimResult,
} from "./probe-r11-calc-lib";

/**
 * R11 计算器党/Excel 玩家探针（只读 src/，不修改任何游戏文件）：
 * ① 每天只开 1 次、只购买 —— 7 天购买策略对比（理论最优背包 / 整包启发 / 逐级贪心 / 攒钱 / 均衡 / 单卡）+ 购买顺序
 * ② 1 次 vs 2 次 vs 3 次回访的离线收益差（效率 0.8→1.0 + 8h 封顶）
 * ③ 离线规则对"只离线党"是否公平（封顶 / 效率 / streak / 日报可达性 / 图鉴 / 转生）
 * ④ 10 秒操作值不值得优化（错误策略的 7 天代价）
 *
 * 运行：npx vitest run --config playtest/vitest.r11-calc.config.ts
 */

const DAYS = 7;
const DAILY_OPEN = [21 * 60]; // 每天 21:00 开一次，每次 10s，只买不点
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const mul = (a: number, b: number): string => `${(a / b).toFixed(2)}×`;
const pad = (s: string, n: number): string => {
  // 中文按 2 列宽补齐（终端输出对齐用）
  let w = 0;
  for (const ch of s) w += /[\u4e00-\u9fff]/.test(ch) ? 2 : 1;
  return s + " ".repeat(Math.max(0, n - w));
};

const EVIDENCE: Record<string, unknown> = {};

/* ========================= ① 7 天购买策略 ========================= */

describe("① 每天 1 次、只购买：7 天策略对比", () => {
  const policies: PolicyName[] = [
    "knapsack",
    "hybrid",
    "greedy",
    "milestone-pack",
    "balanced",
    "hoard-big",
    "phone-only",
  ];

  it("7 天离线总收入：理论最优 > 整包启发 >> 逐级贪心 >> 攒钱/均衡（含日报）", () => {
    const runs: SimResult[] = policies.map((p) =>
      simulate({ days: DAYS, opens: DAILY_OPEN, policy: p, daily: true, prestige: "never", seed: 20261101 }),
    );
    const best = Math.max(...runs.map((r) => r.totalOffline));
    console.log("\n① 7 天策略对比（每天 21:00 开 10 秒、只购买、不转生）");
    console.log(
      pad("策略", 34) +
        pad("D2 离线", 12) +
        pad("D7 离线", 13) +
        pad("7 天累计", 13) +
        pad("D7 关页 idle", 15) +
        "相对最优",
    );
    runs.forEach((r) => {
      const d2 = r.days[1]!.offlineEarned;
      const d7 = r.days[6]!.offlineEarned;
      console.log(
        pad(r.label, 34) +
          pad(formatMoyu(d2), 12) +
          pad(formatMoyu(d7), 13) +
          pad(formatMoyu(r.totalOffline), 13) +
          pad(`${r.day7Idle.toFixed(0)}/s`, 15) +
          `${((r.totalOffline / best - 1) * 100).toFixed(1)}%`,
      );
    });
    const byLabel = Object.fromEntries(runs.map((r) => [r.policy, r]));
    console.log(
      `\n最优=背包 ${formatMoyu(byLabel.knapsack!.totalOffline)}｜整包启发差 ${pct(byLabel.hybrid!.totalOffline / byLabel.knapsack!.totalOffline - 1)}｜逐级贪心差 ${pct(byLabel.greedy!.totalOffline / byLabel.knapsack!.totalOffline - 1)}｜攒整包差 ${pct(byLabel["milestone-pack"]!.totalOffline / byLabel.knapsack!.totalOffline - 1)}｜均衡差 ${pct(byLabel.balanced!.totalOffline / byLabel.knapsack!.totalOffline - 1)}`,
    );
    // 日报：纯离线党 7 天只有 0 次可领（每天 5%，见 ③）
    const claims = byLabel.knapsack!.opens.filter((o) => o.dailyClaimed !== null).length;
    console.log(`最优策略 7 天日报领取次数：${claims}（纯离线每天只有 5% 可达，见 ③）`);

    EVIDENCE.policies = runs.map((r) => ({
      policy: r.policy,
      label: r.label,
      total: r.totalOffline,
      daily: r.dailyOffline,
      day7Idle: r.day7Idle,
      ratios: r.totalOffline / byLabel.knapsack!.totalOffline,
    }));

    // 结论性断言
    expect(byLabel.knapsack!.totalOffline).toBeGreaterThan(byLabel.hybrid!.totalOffline);
    expect(byLabel.hybrid!.totalOffline / byLabel.knapsack!.totalOffline).toBeGreaterThan(0.99); // 整包启发 ≈ 最优
    expect(byLabel.greedy!.totalOffline / byLabel.knapsack!.totalOffline).toBeLessThan(0.7); // 逐级贪心 -30% 以上
    expect(byLabel.greedy!.totalOffline).toBeGreaterThan(byLabel.balanced!.totalOffline);
    expect(byLabel["milestone-pack"]!.totalOffline).toBeGreaterThan(byLabel.balanced!.totalOffline);
    expect(byLabel.balanced!.totalOffline).toBeGreaterThan(byLabel["phone-only"]!.totalOffline);
    expect(byLabel["phone-only"]!.totalOffline).toBeGreaterThan(byLabel["hoard-big"]!.totalOffline);
  });

  it("最优购买顺序：先吃 ×2 里程碑整包，不是逐级摊；点击线一律不买", () => {
    const r = simulate({ days: DAYS, opens: DAILY_OPEN, policy: "knapsack", daily: true, prestige: "never" });
    console.log("\n① 理论最优（背包）逐日购买 → 关页等级（p=刷手机 t=蹲坑 g=群聊 m=会议 d=深度 r=躺平）");
    r.days.forEach((d) => {
      const last = r.opens.filter((o) => o.day === d.day).slice(-1)[0]!;
      const lv = IDLE_IDS.map((id) => `${id[0]}${last.levels[id] ?? 0}`).join(" ");
      const bought = Object.entries(d.purchases)
        .map(([id, n]) => `${id[0]}+${n}`)
        .join(" ");
      console.log(
        `  D${d.day} 买 ${pad(bought || "（没钱）", 46)} → ${pad(lv, 40)} 关页 idle ${d.idleEnd.toFixed(0)}/s`,
      );
    });
    console.log("\n① 第一笔钱（D2 打开时余额 5762 = 离线 5760 + 10 秒被动）怎么花：");
    const st = { ...initialState(), moyu: 5762 };
    console.log(`  背包解：${optimalPurchases(st, st.moyu).join(",")}`);
    console.log("  各档 Lv.0→1 性价比（每万摸鱼值换 idle/s）与首次 ×2 位置：");
    UPGRADES.filter((u) => u.idleRate).forEach((u) => {
      console.log(
        `    ${pad(u.name, 10)} ${String(u.idleRate).padStart(3)}/s 价 ${String(u.baseCost).padStart(8)} → ${valueScoreOf(u.id, 0).idle.toFixed(1)}/万  首次×2 在 Lv.${milestoneGap(u.id, 0)}`,
      );
    });
    // 断言：第一次点满的钱先给刷手机（Lv.5 就有 ×2，是全场最高性价比）
    const firstBuy = Object.keys(r.days[1]!.purchases);
    expect(firstBuy).toContain("phone");
    expect(firstBuy).toContain("toilet");
    expect(r.days[1]!.purchases.phone).toBeGreaterThanOrEqual(10);

    EVIDENCE.buyPlan = r.days.map((d) => ({
      day: d.day,
      purchases: d.purchases,
      idleEnd: d.idleEnd,
      offlineEarned: d.offlineEarned,
      balanceEnd: d.balanceEnd,
    }));
    const lastOpen = r.opens[r.opens.length - 1]!;
    EVIDENCE.day7Levels = lastOpen.levels;
    EVIDENCE.day7Idle = r.day7Idle;
    EVIDENCE.knapsackTotal = r.totalOffline;
  });

  it("转生是比购买顺序更大的杠杆：D5 首次达标 1e8，早转 7 天 ×4", () => {
    const never = simulate({ days: DAYS, opens: DAILY_OPEN, policy: "knapsack", daily: true, prestige: "never", label: "不转生" });
    const early = simulate({ days: DAYS, opens: DAILY_OPEN, policy: "knapsack", daily: true, prestige: "on-threshold", label: "能转就转" });
    const hoard8 = simulate({ days: DAYS, opens: DAILY_OPEN, policy: "knapsack", daily: true, prestige: "hoard-8", label: "攒 8 点再转" });
    console.log("\n① 转生时机（最优购买，7 天窗口）");
    for (const r of [never, early, hoard8]) {
      const pres = r.days.filter((d) => d.prestigePoints > 0).map((d) => `D${d.day}+${d.prestigePoints}pt`);
      console.log(
        `  ${pad(r.label, 12)} 7 天离线 ${pad(formatMoyu(r.totalOffline), 10)} 转生点 ${String(r.prestigePoints).padStart(3)}  D7 idle ${r.day7Idle.toFixed(0)}/s  转生：${pres.join(" ") || "无"}`,
      );
    }
    const d5 = early.days[4]!;
    console.log(
      `  首次转生在 D5（本局累计跨过 1e8 → +${d5.prestigePoints} 点，倍率 ×${(1 + 0.75 * d5.prestigePoints).toFixed(2)}）；早转 ${formatMoyu(early.totalOffline)} vs 不转 ${formatMoyu(never.totalOffline)} = ${mul(early.totalOffline, never.totalOffline)}`,
    );
    console.log(`  攒够 8 点再转（D6）：${formatMoyu(hoard8.totalOffline)}，反而只有早转的 ${pct(hoard8.totalOffline / early.totalOffline)}（7 天窗口内"能转就转"更优）`);
    EVIDENCE.prestige = {
      never: never.totalOffline,
      early: early.totalOffline,
      hoard8: hoard8.totalOffline,
      earlyPoints: early.prestigePoints,
      firstPrestigeDay: 5,
    };
    expect(d5.prestigePoints).toBeGreaterThan(0);
    expect(early.totalOffline).toBeGreaterThan(never.totalOffline * 2);
    expect(hoard8.totalOffline).toBeLessThan(early.totalOffline);
  });
});

/* ========================= ② 打开节律 ========================= */

describe("② 1 次 vs 2 次 vs 3 次回访", () => {
  it("稳态等效收益：回访效率 + 8h 封顶（真实引擎 capForElapsed 计算）", () => {
    const schedules: { name: string; opens: number[] }[] = [
      { name: "1 次/天（21:00）", opens: [21 * 60] },
      { name: "2 次/天（09:00 / 20:00）", opens: [9 * 60, 20 * 60] },
      { name: "2 次/天（00:00 / 16:00，长间隔压到当天最后一次）", opens: [0, 16 * 60] },
      { name: "3 次/天（09:00 / 13:00 / 20:00，常见作息）", opens: [9 * 60, 13 * 60, 20 * 60] },
      { name: "3 次/天（00:05 / 08:05 / 16:05，每 8h）", opens: [5, 8 * 60 + 5, 16 * 60 + 5] },
      { name: "3 次/天（21:00 一口气连开 3 下）", opens: [21 * 60, 21 * 60 + 10, 21 * 60 + 20] },
      { name: "4 次/天（每 6h）", opens: [0, 6 * 60, 12 * 60, 18 * 60] },
    ];
    const rows = schedules.map((s) => ({ ...analyzeSchedule(s.opens), name: s.name }));
    const base = rows[0]!.effectiveHoursPerDay;
    console.log("\n② 稳态单日：离线结算的等效满速小时（applied × rate）");
    console.log(pad("节律", 46) + pad("间隔(h)", 20) + pad("效率", 14) + pad("等效(h)", 20) + "vs 1 次");
    rows.forEach((r) => {
      const gaps = r.perOpen.map((p) => p.gapHours.toFixed(1)).join(",");
      const rates = r.perOpen.map((p) => p.rate.toFixed(1)).join(",");
      console.log(
        pad(r.name, 46) +
          pad(gaps, 20) +
          pad(rates, 14) +
          pad(`${r.effectiveHoursPerDay.toFixed(2)}h（${pct(r.effectiveHoursPerDay / 24)} 24h）`, 26) +
          mul(r.effectiveHoursPerDay, base),
      );
    });
    console.log(
      `\n结论：1 次/天 = 6.40h 等效（24h 的 ${pct(6.4 / 24)}，因为 24h 间隔只结算 8h × 效率 0.8）\n` +
        `      2 次/天 = 13.60h（+112.5%）；3 次常见作息 = 17.00h（+165.6%）；3 次每 8h = 21.60h（+237.5%，上限）\n` +
        `      连开 3 下只 +${pct(6.72 / 6.4 - 1)}（效率加成只作用在 10 分钟短间隔上，几乎白给）`,
    );
    EVIDENCE.schedules = rows.map((r) => ({
      name: r.name,
      effectiveHoursPerDay: r.effectiveHoursPerDay,
      perOpen: r.perOpen,
    }));

    // 引擎事实：24h/48h 间隔都被 8h 封顶；≥7 天 24h；≥30 天 48h
    expect(capForElapsed(24 * HOUR)).toBe(8 * HOUR);
    expect(capForElapsed(48 * HOUR)).toBe(8 * HOUR);
    expect(capForElapsed(7 * 24 * HOUR)).toBe(24 * HOUR);
    expect(capForElapsed(30 * 24 * HOUR)).toBe(48 * HOUR);
    // 1 次/天：先 ensureVisits 再算效率 → 当天首开就是 0.8（不是 0.7）
    expect(rows[0]!.perOpen[0]!.rate).toBeCloseTo(0.8, 10);
    expect(rows[0]!.perOpen[0]!.effectiveHours).toBeCloseTo(6.4, 10);
    expect(rows[4]!.effectiveHoursPerDay).toBeCloseTo(21.6, 10);
    expect(rows[1]!.effectiveHoursPerDay).toBeCloseTo(13.6, 10);
    expect(rows[3]!.effectiveHoursPerDay).toBeCloseTo(17, 10);
    expect(rows[5]!.effectiveHoursPerDay).toBeCloseTo(6.7166667, 6);
  });

  it("7 天引擎模拟：3 次/天在成长期被复利放大（1 次 = 61.6 亿，3 次 = 1606.7 亿）", () => {
    const runs = [
      simulate({ days: DAYS, opens: [21 * 60], policy: "greedy", daily: false, prestige: "never", label: "1 次 21:00" }),
      simulate({ days: DAYS, opens: [9 * 60, 20 * 60], policy: "greedy", daily: false, prestige: "never", label: "2 次 9/20" }),
      simulate({
        days: DAYS,
        opens: [9 * 60, 13 * 60, 20 * 60],
        policy: "greedy",
        daily: false,
        prestige: "never",
        label: "3 次 9/13/20",
      }),
      simulate({
        days: DAYS,
        opens: [5, 8 * 60 + 5, 16 * 60 + 5],
        policy: "greedy",
        daily: false,
        prestige: "never",
        label: "3 次 每 8h",
      }),
    ];
    const base = runs[0]!.totalOffline;
    console.log("\n② 7 天引擎模拟（只买不点、逐级贪心、不含日报/转生）");
    console.log(pad("节律", 20) + pad("7 天离线累计", 18) + pad("D7 离线单日", 16) + "倍率");
    runs.forEach((r) => {
      console.log(
        pad(r.label, 20) +
          pad(formatMoyu(r.totalOffline), 18) +
          pad(formatMoyu(r.days[6]!.offlineEarned), 16) +
          mul(r.totalOffline, base),
      );
    });
    console.log(
      `  注：7 天累计倍率（${mul(runs[3]!.totalOffline, base)}）远大于稳态倍率（3.375×），因为 idle 指数成长被"早买一天"复利放大；\n  看"多开值不值"应以稳态等效小时（②第一张表）为准。`,
    );
    EVIDENCE.periodSim = runs.map((r) => ({ label: r.label, total: r.totalOffline, d7: r.days[6]!.offlineEarned }));
    expect(runs[3]!.totalOffline).toBeGreaterThan(runs[2]!.totalOffline);
    expect(runs[2]!.totalOffline).toBeGreaterThan(runs[1]!.totalOffline);
    expect(runs[1]!.totalOffline).toBeGreaterThan(runs[0]!.totalOffline);
  });
});

/* ========================= ③ 公平性 ========================= */

describe("③ 离线规则对只离线党是否公平", () => {
  it("8h 封顶 vs 24h 真实离线：每天只拿回 1/3 时间，等效 26.7%", () => {
    console.log("\n③ 封顶与效率");
    console.log(`  每天离线 24h → 只结算 ${capForElapsed(24 * HOUR) / HOUR}h（${pct(8 / 24)} 的离线时间被捡回）`);
    console.log(`  × 全天首次回访效率 0.8 → 等效 ${(8 * 0.8).toFixed(2)}h = 24h 的 ${pct(6.4 / 24)}`);
    console.log(`  隔 1 天（48h）回来 → 仍只结算 ${capForElapsed(48 * HOUR) / HOUR}h → 日均等效 ${(8 * 0.8 / 2).toFixed(2)}h（比天天开少 ${pct(1 - 0.5)}）`);
    console.log(`  隔 6 天回来 → 仍 8h → 日均 ${(6.4 / 7).toFixed(2)}h（-${pct(1 - 1 / 7)}）`);
    console.log(`  隔 7 天回来 → 24h 封顶 + 强制 100% 效率 → ${(24).toFixed(0)}h，日均 ${(24 / 7).toFixed(2)}h（天天开 6.4h 的 ${pct((24 / 7) / 6.4)}）`);
    console.log(`  隔 30 天回来 → 48h 封顶 → 日均 ${(48 / 30).toFixed(2)}h`);
    console.log(`  效率事实：基础 0.7，但打开会先记一次回访 +0.1 → 当天首开实际 0.8；3 次/天第 3 次才到 1.0`);
    EVIDENCE.cap = {
      cap8h: capForElapsed(24 * HOUR),
      cap2d: capForElapsed(48 * HOUR),
      cap7d: capForElapsed(7 * 24 * HOUR),
      cap30d: capForElapsed(30 * 24 * HOUR),
      dailyEquivalentHours: 6.4,
    };
    expect(capForElapsed(48 * HOUR)).toBe(8 * HOUR); // 隔一天不补，整天白丢
    expect(capForElapsed(6 * 24 * HOUR)).toBe(8 * HOUR); // 6 天不玩也只给 8h
  });

  it("日报/streak 对纯离线基本锁死：每天只有 5% 可达", () => {
    const zeroOp = new Set(["visit_1", "idle_earn", "buy_3"]);
    const t = DAILY_GOAL_TEMPLATES;
    const combos: string[][] = [];
    for (let a = 0; a < t.length; a++)
      for (let b = a + 1; b < t.length; b++)
        for (let c = b + 1; c < t.length; c++) combos.push([t[a]!.id, t[b]!.id, t[c]!.id]);
    const ok = combos.filter((c) => c.every((id) => zeroOp.has(id)));
    const p = ok.length / combos.length;
    console.log("\n③ 日报可达性（10 秒纯离线：不点屏幕）");
    console.log(`  目标池 6 抽 3 = ${combos.length} 种组合；可完成（必须全在 visit/idle/buy 内）= ${ok.length} 种 → ${pct(p)}/天`);
    console.log(`  streak 每 7 连天才 +0.05 效率 → 连 7 天概率 ${(p ** 7).toExponential(2)}，实际拿不到；\n` +
      `  也就是说"每 7 天 +0.05、封顶 +0.15"这条长线对离线党是空头支票（+0.15 = +18.75% 离线效率）`);
    console.log(`  click_100 / meme_1 / survive_2 是死目标：不点屏幕；首次巡逻在 20-35s，而 10s 会话永远遇不到`);
    EVIDENCE.daily = {
      combos: combos.length,
      completable: ok.length,
      rate: p,
      streak7Prob: p ** 7,
      dailyRewardValue: 600, // ≈ 600×idleRate（与日离线收入 2.6% 量级）
    };
    expect(p).toBeCloseTo(1 / 20, 10);
  });

  it("图鉴上限 30/55 → +12%；「55/55 ×1.2」在引擎里其实没落地", () => {
    const idleIds = new Set(IDLE_IDS);
    const clickItems = UPGRADES.filter((u) => !idleIds.has(u.id)).length * 5;
    const quotes = 10;
    const max = TOTAL_ITEMS - clickItems - quotes;
    const s = initialState();
    const c30 = collectionCount(
      syncFlavorCollection({ ...s, levels: Object.fromEntries(IDLE_IDS.map((id) => [id, 50])) }),
    );
    const bonus = (n: number): number => 1 + Math.min(0.2, 0.02 * Math.floor(n / 5));
    console.log("\n③ 图鉴（累计点击 0 的离线党）");
    console.log(`  点击线 15 格 + 语录 10 格永远拿不到 → 上限 ${max}/${TOTAL_ITEMS} 格`);
    console.log(`  图鉴加成：离线满配 ${c30} 格 → ×${bonus(c30).toFixed(2)}；活跃玩家 55 格 → ×${bonus(55).toFixed(2)}（差 ${pct(bonus(55) / bonus(c30) - 1)}）`);
    console.log(`  注：collection.ts 导出 COLLECTION_BONUS=1.2，但 upgrades.ts 的 collectionBonus 未引用它 → README 的"集满 ×1.2"实际未生效（额外小问题）`);
    EVIDENCE.collection = { offlineMax: c30, activeMax: 55, offlineBonus: bonus(c30), activeBonus: bonus(55) };
    expect(c30).toBe(30);
    expect(bonus(c30)).toBeCloseTo(1.12, 10);
  });

  it("离线党拿不到的还有：点击线（0 收益）、巡逻/丢梗奖励、连击、每日领奖", () => {
    // 离线收益 = idleRate × applied × rate，只吃挂机线；点击线对次日离线 0 贡献
    const s = initialState();
    const withClick = { ...s, levels: { coffee: 50, water: 50, chair: 50 } };
    console.log("\n③ 点击线对离线收益的贡献：" + (effectOf(withClick).idleRate - effectOf(s).idleRate).toFixed(2) + "（0 = 点击线对离线党完全无用）");
    expect(effectOf(withClick).idleRate).toBeCloseTo(effectOf(s).idleRate, 10);
  });
});

/* ========================= ④ 10 秒操作 ========================= */

describe("④ 10 秒操作值不值得优化", () => {
  it("买错一天的代价：D7 关页 idle 差 16.5%（次日离线收益同比例差）", () => {
    const knap = simulate({ days: DAYS, opens: DAILY_OPEN, policy: "knapsack", daily: true, prestige: "never" });
    const greedy = simulate({ days: DAYS, opens: DAILY_OPEN, policy: "greedy", daily: true, prestige: "never" });
    const balanced = simulate({ days: DAYS, opens: DAILY_OPEN, policy: "balanced", daily: true, prestige: "never" });
    console.log("\n④ 10 秒操作的价值");
    console.log(`  D7 关页 idle：最优 ${knap.day7Idle.toFixed(0)}/s｜逐级贪心 ${greedy.day7Idle.toFixed(0)}/s（${pct(greedy.day7Idle / knap.day7Idle - 1)}）｜均衡 ${balanced.day7Idle.toFixed(0)}/s（${pct(balanced.day7Idle / knap.day7Idle - 1)}）`);
    console.log(`  离线收益只取决于"关页瞬间的 idle 快照"，买错一次 = 接下来 24h 的离线收入同步打折`);
    console.log(`  7 天累计差距：贪心 ${pct(greedy.totalOffline / knap.totalOffline - 1)}｜均衡 ${pct(balanced.totalOffline / knap.totalOffline - 1)}`);
    EVIDENCE.wrongBuy = {
      day7Idle: { knap: knap.day7Idle, greedy: greedy.day7Idle, balanced: balanced.day7Idle },
      total: { knap: knap.totalOffline, greedy: greedy.totalOffline, balanced: balanced.totalOffline },
    };
    expect(greedy.day7Idle / knap.day7Idle).toBeLessThan(0.9);
  });
});

/* ========================= ⑤ 建议数值验证 ========================= */

/** 用同一套节律模型算"若封顶改为 capH 小时"的等效满速小时（仅假设推演，不改 src） */
function effectiveHoursWithCap(opens: number[], capH: number): number {
  const sorted = [...opens].sort((a, b) => a - b);
  let sum = 0;
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i]!;
    const prev = i === 0 ? sorted[sorted.length - 1]! - 24 * 60 : sorted[i - 1]!;
    const gapH = (m - prev) / 60;
    const rate = Math.min(1, 0.7 + Math.min(i + 1, 3) * 0.1);
    sum += Math.min(gapH, capH) * rate; // 引擎：applied = min(elapsed, cap)
  }
  return sum;
}

describe("⑤ 建议的数值验证", () => {
  it("建议1：8h→12h 封顶（保留 ≥7 天 24h / ≥30 天 48h）", () => {
    const cases: { name: string; opens: number[] }[] = [
      { name: "1 次/天（21:00）", opens: [21 * 60] },
      { name: "2 次/天（09:00/20:00）", opens: [9 * 60, 20 * 60] },
      { name: "3 次/天（09:00/13:00/20:00）", opens: [9 * 60, 13 * 60, 20 * 60] },
      { name: "3 次/天（每 8h）", opens: [5, 8 * 60 + 5, 16 * 60 + 5] },
    ];
    console.log("\n⑤ 建议 1：封顶 8h → 12h");
    console.log(pad("节律", 30) + pad("现 8h 等效", 16) + pad("建议 12h 等效", 18) + "变化");
    for (const c of cases) {
      const now = effectiveHoursWithCap(c.opens, 8);
      const next = effectiveHoursWithCap(c.opens, 12);
      console.log(pad(c.name, 30) + pad(now.toFixed(2) + "h", 16) + pad(next.toFixed(2) + "h", 18) + `+${pct(next / now - 1)}`);
    }
    const dailyNow = effectiveHoursWithCap([21 * 60], 8);
    const dailyNext = effectiveHoursWithCap([21 * 60], 12);
    const x3Now = effectiveHoursWithCap([9 * 60, 13 * 60, 20 * 60], 8);
    const x3Next = effectiveHoursWithCap([9 * 60, 13 * 60, 20 * 60], 12);
    console.log(
      `  1 次/天 ${dailyNow.toFixed(2)}h → ${dailyNext.toFixed(2)}h（+${pct(dailyNext / dailyNow - 1)}）；3 次/天优势 ${mul(x3Now, dailyNow)} → ${mul(x3Next, dailyNext)}；隔一天回来日均 ${(8 * 0.8 / 2).toFixed(2)}h → ${(12 * 0.8 / 2).toFixed(2)}h`,
    );
    EVIDENCE.suggestionCap12h = {
      daily8: dailyNow,
      daily12: dailyNext,
      x3_8: x3Now,
      x3_12: x3Next,
    };
    expect(dailyNext / dailyNow).toBeCloseTo(1.5, 6);
    expect(x3Next / dailyNext).toBeLessThan(x3Now / dailyNow); // 多开优势被削弱
  });

  it("建议2：日报/streak 对离线可达后的收益", () => {
    // 日奖励 = max(500, 600×idleRate)；日离线 = 28800s × 0.8 × idleRate
    const idle = 1000; // 中期示例
    const reward = Math.max(500, 600 * idle);
    const dailyOffline = 28800 * 0.8 * idle;
    const streakBonus = 0.15; // 4 周连续后封顶（每 7 天 +0.05）
    console.log("\n⑤ 建议 2：日报零操作可达");
    console.log(`  idle=${idle}/s 示例：日奖励 ${formatMoyu(reward)} = 当天离线 ${formatMoyu(dailyOffline)} 的 ${pct(reward / dailyOffline)}`);
    console.log(`  streak 4 周后 +0.15 效率：0.8→0.95 = +${pct(0.95 / 0.8 - 1)}（1 次/天 6.40h→7.60h；叠加 12h 封顶 9.60→11.40h）`);
    EVIDENCE.suggestionDaily = { reward, dailyOffline, rewardRatio: reward / dailyOffline, streakGain: 0.95 / 0.8 - 1 };
    expect(reward / dailyOffline).toBeCloseTo(600 / (28800 * 0.8), 10);
    expect(0.95 / 0.8 - 1).toBeCloseTo(streakBonus / 0.8, 10);
  });
});

/* ========================= 落盘 ========================= */

describe("落盘证据", () => {
  it("写 playtest/r11-calc-report.json", () => {
    EVIDENCE.meta = {
      head: "4610c76",
      generatedAt: new Date().toISOString(),
      note: "R11 计算器党探针：只用 src/engine 纯函数模拟，不点屏幕；每次开页复刻 main.ts boot 链路",
    };
    // 延迟 import 避免顶部依赖顺序问题
    writeFileSync(new URL("./r11-calc-report.json", import.meta.url), JSON.stringify(EVIDENCE, null, 2));
    expect(true).toBe(true);
  });
});
