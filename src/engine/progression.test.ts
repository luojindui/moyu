import { describe, it, expect } from "vitest";
import { RANKS, rankFor } from "./titles";
import { initialState } from "./state";
import { ensureVisits, offlineEfficiency } from "./progression";
import { syncFlavorCollection, collectionCount, TOTAL_ITEMS } from "./collection";
import { effectOf } from "./upgrades";

const DAY = 86_400_000;

describe("R7 长线：段位续档", () => {
  it("14 档，覆盖 5e9 → 6.4e11（D4~D22 各一次晋升）", () => {
    expect(RANKS.map((r) => r.at)).toEqual([
      0, 10_000, 100_000, 1_000_000, 100_000_000, 1_000_000_000, 2_500_000_000, 5_000_000_000, 1e10, 2e10, 4e10,
      8e10, 1.6e11, 3.2e11,
    ]);
    expect(rankFor(6e11).current).toBe("摸鱼宇宙尽头·终");
    expect(rankFor(6e11).next).toBeNull();
  });
});

describe("R7 长线：回访提升离线效率（回访可挣回 0.7 → 1.0）", () => {
  it("当日回访次数递增，效率 0.7 → 0.8 → 0.9 → 1.0 封顶", () => {
    let s = initialState();
    const t0 = 10 * DAY;
    const boot = (now: number) => {
      s = ensureVisits(s, now);
      return offlineEfficiency(s, t0, now);
    };
    expect(boot(t0 + 1 * DAY)).toBeCloseTo(0.8, 6); // 第 1 次回访：0.7 + 0.1
    expect(boot(t0 + 1 * DAY + 3600_000)).toBeCloseTo(0.9, 6); // 第 2 次
    expect(boot(t0 + 1 * DAY + 7200_000)).toBeCloseTo(1.0, 6); // 第 3 次
    expect(boot(t0 + 1 * DAY + 10_800_000)).toBeCloseTo(1.0, 6); // 封顶
  });

  it("首日全额；跨日回访计数重置", () => {
    let s = initialState();
    s = ensureVisits(s, 1000 + 2 * DAY);
    expect(offlineEfficiency(s, 1000, 1000 + 2 * DAY)).toBeCloseTo(0.8, 6);
    // 次日第一次回访 → 计数重置为 1
    s = ensureVisits(s, 1000 + 3 * DAY);
    expect(s.visits.count).toBe(1);
    expect(offlineEfficiency(s, 1000, 1000 + 3 * DAY)).toBeCloseTo(0.8, 6);
  });

  it("streak 里程碑：每满 7 天 +0.05，封顶 +0.15", () => {
    const s = { ...initialState(), daily: { date: "2026-11-27", goals: [], streak: 7, lastCompleteDate: null, claimed: true } };
    // 0.7 + 0.1(第一次回访) + 0.05 = 0.85
    const s1 = ensureVisits(s, 2 * DAY + 1000);
    expect(offlineEfficiency(s1, 1000, 2 * DAY + 1000)).toBeCloseTo(0.85, 6);
    const s21 = { ...s, daily: { ...s.daily!, streak: 21 } };
    const s2 = ensureVisits(s21, 2 * DAY + 1000);
    expect(offlineEfficiency(s2, 1000, 2 * DAY + 1000)).toBeLessThanOrEqual(1.0);
  });
});

describe("R7 长线：图鉴解锁点击线（解除 43/55 死锁）", () => {
  it("点击线彩蛋按累计点击数解锁（100/500/3000/8000/20000）", () => {
    let s = { ...initialState(), totalClicks: 600 };
    s = syncFlavorCollection(s);
    const coffeeCollected = s.collected.flavors.filter((i) => i < 5).length;
    expect(coffeeCollected).toBe(2); // 100、500 两档
    s = { ...s, totalClicks: 9000 };
    s = syncFlavorCollection(s);
    expect(s.collected.flavors.filter((i) => i < 5).length).toBe(4);
  });

  it("图鉴集满 55/55 给永久挂机 ×1.2（数值终点）", () => {
    let s = initialState();
    // 直接灌满
    s = {
      ...s,
      collected: { quotes: Array.from({ length: 10 }, (_, i) => i), flavors: Array.from({ length: 45 }, (_, i) => i) },
    };
    s = syncFlavorCollection(s);
    expect(collectionCount(s)).toBe(TOTAL_ITEMS);
    // 完成奖励在 effectOf 中生效
    expect(effectOf(s).idleRate).toBeCloseTo(0.2 * 1.2, 6);
    // 未集满无加成
    expect(effectOf(initialState()).idleRate).toBeCloseTo(0.2, 6);
  });
});
