/**
 * probe-r4v-nurture-value.test.ts — 验收 4：回访价值量化（休闲党 14 天）
 * 假设：每天 30 分钟活跃（≈1800 次点击 / 约 30 个丢梗窗口 / 15 次购买），
 * 两次会话间隔 23.5h（离线收益按引擎规则：8h 封顶，首日 1.0 / 之后 0.7）。
 * 统计「每天是否都有确定的新变化」（日报目标/图鉴进度/段位）。
 */
import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { ensureDaily } from "../src/engine/daily";
import { collectionCount, TOTAL_ITEMS } from "../src/engine/collection";
import { offlineEarn } from "../src/engine/offline";
import { rankFor, RANKS } from "../src/engine/titles";
import { UPGRADES } from "../src/engine/upgrades";
import { lcg, simulateSession, dateStr } from "./probe-r4v-nurture-lib";

function log(label: string, value: unknown): void {
  console.log(`[r4v-value] ${label}`, JSON.stringify(value));
}

interface DayRow {
  day: number;
  date: string;
  goals: string[];
  doneAtSec: number | null;
  claimed: boolean;
  reward: number | null;
  clicks: number;
  memes: number;
  memeWindows: number;
  buys: number;
  survives: number;
  offlineEarned: number;
  quoteDelta: number;
  flavorDelta: number;
  collectionDelta: number;
  collectionTotal: number;
  rankUp: boolean;
  rank: string;
  totalEarned: number;
  newChange: boolean;
}

describe("回访价值·休闲党 14 天（30 分钟/天）", () => {
  it("14 天逐日记录：日报可完成性、图鉴增量、段位变化、每天是否有新变化", () => {
    const DAYS = 14;
    const base = new Date(2026, 10, 13, 12, 0, 0); // 2026-11-13 本地 12:00 起
    const rng = lcg(20261113);
    let state = initialState();
    const rows: DayRow[] = [];
    console.log(`[r4v-value] 图鉴总量 TOTAL_ITEMS=${TOTAL_ITEMS}`);

    for (let d = 0; d < DAYS; d++) {
      const date = dateStr(base, d);
      // 段位口径：按「当天开始（离线结算前）」比较，才能反映隔夜回访的段位变化
      const rankAtDayStart = rankFor(state.totalEarned).current;
      let offlineEarned = 0;
      if (d > 0) {
        const ageHours = d * 23.5; // 建档后经过时长
        const rate = ageHours < 24 ? 1 : 0.7;
        const off = offlineEarn(state, 23.5 * 3600, rate);
        state = off.state;
        offlineEarned = off.earned;
      }
      state = ensureDaily(state, date, rng);

      const before = {
        quotes: state.collected.quotes.length,
        flavors: state.collected.flavors.length,
        total: collectionCount(state),
        totalEarned: state.totalEarned,
        rank: rankAtDayStart,
      };
      const goals = state.daily!.goals.map((g) => g.id);

      const r = simulateSession(state, { date, maxSeconds: 1800, tps: 1, buyEverySec: 120, seed: 5000 + d });
      state = r.state;
      const after = {
        quotes: state.collected.quotes.length,
        flavors: state.collected.flavors.length,
        total: collectionCount(state),
        totalEarned: state.totalEarned,
        rank: rankFor(state.totalEarned).current,
      };
      const rankUp = RANKS.findIndex((x) => x.name === after.rank) > RANKS.findIndex((x) => x.name === rankAtDayStart);

      const row: DayRow = {
        day: d + 1,
        date,
        goals,
        doneAtSec: r.doneAtSec,
        claimed: r.claimedReward !== null,
        reward: r.claimedReward,
        clicks: r.clicks,
        memes: r.memes,
        memeWindows: r.memeWindows,
        buys: r.buys,
        survives: r.survives,
        offlineEarned: Math.round(offlineEarned),
        quoteDelta: after.quotes - before.quotes,
        flavorDelta: after.flavors - before.flavors,
        collectionDelta: after.total - before.total,
        collectionTotal: after.total,
        rankUp,
        rank: after.rank,
        totalEarned: Math.round(after.totalEarned),
        newChange: false,
      };
      row.newChange = row.claimed || row.collectionDelta > 0 || row.rankUp;
      rows.push(row);
    }

    // 逐日明细（证据）
    for (const r of rows) {
      log(`Day${r.day}`, {
        date: r.date,
        goals: r.goals,
        doneAtSec: r.doneAtSec === null ? null : Math.round(r.doneAtSec),
        claimed: r.claimed,
        reward: r.reward,
        clicks: r.clicks,
        memes: r.memes,
        memeWindows: r.memeWindows,
        buys: r.buys,
        collection: r.collectionTotal,
        collectionDelta: r.collectionDelta,
        rank: r.rank,
        rankUp: r.rankUp,
        totalEarned: r.totalEarned,
        newChange: r.newChange,
      });
    }

    const daysWithClaim = rows.filter((r) => r.claimed).length;
    const daysWithCollection = rows.filter((r) => r.collectionDelta > 0).length;
    const daysWithRankUp = rows.filter((r) => r.rankUp).length;
    const daysWithNewChange = rows.filter((r) => r.newChange).length;
    const doneTimes = rows.map((r) => r.doneAtSec).filter((x): x is number => x !== null);
    const maxDone = Math.max(...doneTimes);
    const medianDone = [...doneTimes].sort((a, b) => a - b)[Math.floor(doneTimes.length / 2)]!;
    const final = rows.at(-1)!;

    log("14 天汇总", {
      daysWithClaim,
      daysWithCollection,
      daysWithRankUp,
      daysWithNewChange,
      firstDayCollection: rows[0]!.collectionTotal,
      finalCollection: final.collectionTotal,
      finalRank: final.rank,
      finalTotalEarned: final.totalEarned,
      maxDoneSec: Math.round(maxDone),
      medianDoneSec: Math.round(medianDone),
      avgClicks: +(rows.reduce((a, r) => a + r.clicks, 0) / DAYS).toFixed(1),
      avgMemes: +(rows.reduce((a, r) => a + r.memes, 0) / DAYS).toFixed(1),
      avgBuys: +(rows.reduce((a, r) => a + r.buys, 0) / DAYS).toFixed(1),
      endLevels: { ...state.levels },
    });

    // ===== 断言：验收口径 =====
    expect(rows).toHaveLength(14);
    // ① 日报每天都能在 10 分钟内完成并领取
    expect(daysWithClaim).toBe(14);
    expect(maxDone).toBeLessThanOrEqual(600);
    // ② 每天都有确定的新变化（日报完成领取 / 图鉴 +1 / 段位提升）
    expect(daysWithNewChange).toBe(14);
    // ③ 图鉴确有持续进度（不止首日），且不越界
    expect(rows[0]!.collectionDelta).toBeGreaterThan(0);
    expect(daysWithCollection).toBeGreaterThanOrEqual(2);
    expect(final.collectionTotal).toBeGreaterThan(rows[0]!.collectionTotal);
    expect(final.collectionTotal).toBeLessThanOrEqual(TOTAL_ITEMS);
    // ④ 段位至少跨 1 档（长期目标可见）
    expect(rows.some((r) => r.rankUp)).toBe(true);
    // ⑤ 行为量级符合画像假设（1800 点击/30 丢梗窗口/15 购买）
    expect(rows.every((r) => r.clicks > 1500)).toBe(true);
    expect(rows.every((r) => r.buys >= 10)).toBe(true);
  });

  it("长线 60 天：图鉴封顶日 / 段位封顶日 / 收集空窗最长天数（判断成长天花板）", () => {
    const base = new Date(2026, 10, 13, 12, 0, 0);
    const rng = lcg(20261113);
    let state = initialState();
    let firstCompleteDay: number | null = null;
    let claimDays = 0;
    let zeroDeltaStreak = 0;
    let maxZeroStreak = 0;
    let topRankDay: number | null = null;
    const topRankName = RANKS.at(-1)!.name;
    const milestones: Array<Record<string, unknown>> = [];
    for (let d = 0; d < 60; d++) {
      const date = dateStr(base, d);
      if (d > 0) state = offlineEarn(state, 23.5 * 3600, d * 23.5 < 24 ? 1 : 0.7).state;
      state = ensureDaily(state, date, rng);
      const before = collectionCount(state);
      const r = simulateSession(state, { date, maxSeconds: 1800, tps: 1, buyEverySec: 120, seed: 5000 + d });
      state = r.state;
      const after = collectionCount(state);
      if (r.claimedReward !== null) claimDays++;
      if (after >= TOTAL_ITEMS && firstCompleteDay === null) firstCompleteDay = d + 1;
      if (rankFor(state.totalEarned).current === topRankName && topRankDay === null) topRankDay = d + 1;
      if (after - before === 0) {
        zeroDeltaStreak++;
        maxZeroStreak = Math.max(maxZeroStreak, zeroDeltaStreak);
      } else zeroDeltaStreak = 0;
      if (d === 0 || d === 9 || d === 29 || d === 44 || d === 59) {
        milestones.push({
          day: d + 1,
          collection: after,
          rank: rankFor(state.totalEarned).current,
          totalEarned: Math.round(state.totalEarned),
          claim: r.claimedReward !== null,
        });
      }
    }
    log("60 天长线", {
      claimDays,
      collectionCompleteDay: firstCompleteDay,
      topRankDay,
      maxZeroCollectionStreakDays: maxZeroStreak,
      milestones,
    });
    expect(claimDays).toBe(60); // 日报仪式 60/60 天可领
    expect(firstCompleteDay).not.toBeNull(); // 图鉴 55/55 在两个月内可封顶
    expect(firstCompleteDay!).toBeLessThanOrEqual(60);
    expect(topRankDay).not.toBeNull(); // 段位在 60 天内可到顶（当前 7 档）
    expect(maxZeroStreak).toBeLessThanOrEqual(10); // 图鉴空窗最长不超过 10 天
  }, 30_000);

  it("第 1 天 30 分钟首访：图鉴从 0 起步能拿到第一波收集（语录+首档彩蛋）", () => {
    const base = new Date(2026, 10, 13, 12, 0, 0);
    const rng = lcg(20261113);
    let state = initialState();
    const date = dateStr(base, 0);
    state = ensureDaily(state, date, rng);
    const r = simulateSession(state, { date, maxSeconds: 1800, tps: 1, buyEverySec: 120, seed: 5000 });
    const total = collectionCount(r.state);
    log("首日图鉴", {
      quotes: r.state.collected.quotes.length,
      flavors: r.state.collected.flavors.length,
      total,
      buys: r.buys,
      levels: r.state.levels,
    });
    expect(total).toBeGreaterThan(0);
    expect(r.state.collected.quotes.length).toBeGreaterThanOrEqual(10); // 10 语录可收满
    expect(r.state.collected.flavors.length).toBeGreaterThanOrEqual(3); // 首日至少解锁几档彩蛋
    // 购买/升级与彩蛋档位一致
    for (const u of UPGRADES) {
      const lv = r.state.levels[u.id] ?? 0;
      const expectedTiers = lv >= 50 ? 5 : lv >= 20 ? 4 : lv >= 10 ? 3 : lv >= 5 ? 2 : lv >= 1 ? 1 : 0;
      const idx = UPGRADES.findIndex((x) => x.id === u.id) * 5;
      const got = r.state.collected.flavors.filter((i) => i >= idx && i < idx + 5).length;
      expect(got).toBe(expectedTiers);
    }
  });
});
