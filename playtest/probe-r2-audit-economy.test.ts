import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { advance } from "../src/engine/tick";
import { effectOf, marginalEffect, milestoneGap, costOf, MILESTONE_LEVELS, BASE_IDLE_RATE } from "../src/engine/upgrades";
import { buyUpgrade, clickPowerOf } from "../src/engine/actions";
import { rankFor } from "../src/engine/titles";
import { offlineEarn, OFFLINE_CAP_SECONDS } from "../src/engine/offline";
import { settleReturn, RESUME_SETTLE_THRESHOLD_SECONDS } from "../src/engine/resume";
import { onBossTap } from "../src/engine/events";

/**
 * R2 审计探针②：批次3 经济数值规格逐条对照。
 * 底薪 / 里程碑×2 / 段位 / 离线分级（首日全额、次日 70%）/ totalEarned 语义。
 */

describe("R2 审计②a：工位底薪（规格：零购买挂机 60s → +12）", () => {
  it("零升级 advance(60) = 12", () => {
    expect(advance(initialState(), 60).moyu).toBeCloseTo(BASE_IDLE_RATE * 60, 10);
    expect(BASE_IDLE_RATE).toBe(0.2);
  });
  it("effectOf 空 upgrade idleRate 含底薪 0.2", () => {
    expect(effectOf(initialState()).idleRate).toBe(0.2);
    expect(effectOf(initialState()).clickPower).toBe(0);
  });
});

describe("R2 审计②b：效果里程碑（规格：19 级 19/秒 → 20 级 40/秒）", () => {
  const at = (lv: number) => effectOf({ ...initialState(), levels: { phone: lv } }).idleRate - BASE_IDLE_RATE;

  it("刷手机 19 级贡献 19/秒，20 级 40/秒", () => {
    expect(at(19)).toBe(19);
    expect(at(20)).toBe(40); // 20 × 2^1
  });
  it("39→41 级：78(×2), 160(×4), 164(×4)", () => {
    expect(at(39)).toBe(78); // floor(39/20)=1 → ×2
    expect(at(40)).toBe(160); // floor(40/20)=2 → ×4
    expect(at(41)).toBe(164);
  });
  it("marginalEffect 在里程碑处跳变（19→20 增量 21）", () => {
    expect(marginalEffect("phone", 19).idleRate).toBe(40 - 19);
    expect(marginalEffect("phone", 18).idleRate).toBe(1);
    expect(marginalEffect("phone", 0).idleRate).toBe(1);
    expect(marginalEffect("coffee", 19).clickPower).toBe(21);
  });
  it("milestoneGap：0→20，19→1，20→20，39→1，40→20", () => {
    expect(milestoneGap("phone", 0)).toBe(MILESTONE_LEVELS);
    expect(milestoneGap("phone", 19)).toBe(1);
    expect(milestoneGap("phone", 20)).toBe(20);
    expect(milestoneGap("phone", 39)).toBe(1);
    expect(milestoneGap("phone", 40)).toBe(20);
  });
  it("多升级叠加：phone20 + toilet20 = 40 + 200 + 底薪", () => {
    const s = { ...initialState(), levels: { phone: 20, toilet: 20 } };
    expect(effectOf(s).idleRate).toBeCloseTo(0.2 + 40 + 5 * 20 * 2, 10);
  });
});

describe("R2 审计②c：段位（规格：9000→10000 实习生→学徒，花费不减累计）", () => {
  it("rankFor 边界", () => {
    expect(rankFor(0).current).toBe("摸鱼实习生");
    expect(rankFor(9999.99).current).toBe("摸鱼实习生");
    expect(rankFor(10000).current).toBe("摸鱼学徒");
    expect(rankFor(9000).progress).toBeCloseTo(0.9, 6);
    expect(rankFor(99999.99).current).toBe("摸鱼学徒");
    expect(rankFor(100000).current).toBe("资深摸鱼");
    expect(rankFor(1e8).current).toBe("带薪摸鱼传说");
    expect(rankFor(1e12).next).toBeNull();
    expect(rankFor(1e12).progress).toBe(1);
    expect(rankFor(-5).progress).toBe(0); // 负数防御
  });
  it("购买花费不减 totalEarned；进账类全部累加", () => {
    let s = { ...initialState(), moyu: 1e6, totalEarned: 1e6 };
    s = buyUpgrade(s, "phone")!;
    expect(s.moyu).toBe(1e6 - costOf("phone", 0));
    expect(s.totalEarned).toBe(1e6); // 不减
    const clicked = { ...s, moyu: 0, totalEarned: 0, levels: {} };
    const afterClick = { ...clicked, moyu: 100 };
    // 惩罚只扣余额
    const es = { nextBossAt: 0, bossUntil: 100, nextMemeAt: 0, memeUntil: -1, bossCaught: false };
    const penalized = onBossTap({ ...afterClick, totalEarned: 100 }, es).state;
    expect(penalized.moyu).toBe(90); // 100 - max(10, 5) = 100 - 10
    expect(penalized.totalEarned).toBe(100); // 段位不受惩罚影响
  });
});

const s = { ...initialState(), levels: { toilet: 2 } }; // 0.2 + 10 = 10.2/s

describe("R2 审计②d：离线效率分级（首日全额 / 次日 70% / 8h 封顶）", () => {
  it("首日 rate=1：1 小时全额", () => {
    const r = offlineEarn(s, 3600, 1);
    expect(r.earned).toBeCloseTo(10.2 * 3600, 6);
  });
  it("次日 rate=0.7：1 小时 × 0.7", () => {
    const r = offlineEarn(s, 3600, 0.7);
    expect(r.earned).toBeCloseTo(10.2 * 3600 * 0.7, 6);
  });
  it("默认 rate=1（向后兼容）", () => {
    expect(offlineEarn(s, 10).earned).toBeCloseTo(10.2 * 10, 6);
  });
  it("24h 封顶 8h 且乘以 rate", () => {
    const r = offlineEarn(s, 24 * 3600, 0.7);
    expect(r.applied).toBe(OFFLINE_CAP_SECONDS);
    expect(r.earned).toBeCloseTo(10.2 * OFFLINE_CAP_SECONDS * 0.7, 6);
  });
  it("离线收益计入 totalEarned", () => {
    expect(offlineEarn(s, 100, 1).state.totalEarned).toBeCloseTo(10.2 * 100, 6);
  });
});

describe("R2 审计②e：settleReturn（后台回归结算）", () => {
  it("gap < 5s 不结算不弹窗", () => {
    const r = settleReturn(s, 0, (RESUME_SETTLE_THRESHOLD_SECONDS - 0.01) * 1000, 1);
    expect(r.applied).toBe(0);
    expect(r.showPanel).toBe(false);
    expect(r.state).toBe(s); // 原引用
  });
  it("gap ≥ 5s 结算且弹窗（earned>0）", () => {
    const r = settleReturn(s, 0, 30 * 60 * 1000, 1);
    expect(r.applied).toBe(1800);
    expect(r.earned).toBeCloseTo(10.2 * 1800, 6);
    expect(r.showPanel).toBe(true);
  });
  it("时钟回拨（now < lastActive）安全", () => {
    const r = settleReturn(s, 100_000, 0, 1);
    expect(r.applied).toBe(0);
  });
});

describe("R2 审计②f：点击力里程碑一致性（咖啡线）", () => {
  it("coffee 20 级 → 点击力 1 + 20×1×2 = 41", () => {
    expect(clickPowerOf({ ...initialState(), levels: { coffee: 20 } })).toBe(1 + 40);
  });
});
