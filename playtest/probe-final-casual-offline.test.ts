import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { offlineEarn, OFFLINE_CAP_SECONDS } from "../src/engine/offline";
import { settleReturn, RESUME_SETTLE_THRESHOLD_SECONDS } from "../src/engine/resume";
import { serialize, restore, type SaveAdapter } from "../src/engine/save";
import { effectOf } from "../src/engine/upgrades";
import { formatMoyu } from "../src/engine/format";
import { memSave, DAY_MS, offlineRate } from "./probe-final-casual-lib";

/**
 * 终验④ 离线规则：首日 1.0 / 次日 0.7 / 8 小时封顶——全部用真实引擎函数验证。
 * 与 main.ts boot 链路一致：restore() 给出 offlineSeconds/createdAt → 速率按
 * `Date.now() - createdAt < 24h ? 1 : 0.7` → offlineEarn(state, offlineSeconds, rate)。
 * 浏览器实测（CDP 真机 390×844）三档分别为 360 / 252 / 4032，本文件断言引擎侧同值。
 */

const IDLE = 0.2; // 初始底薪
const HALF_HOUR = 1800;

function baseState() {
  // 初始状态走真实 upgrades 表推导 idle=0.2/s（不手搓数值）
  return initialState();
}

function rateFor(now: number, createdAt: number): number {
  return offlineRate(now, createdAt);
}

describe("终验④：离线规则（真实引擎）", () => {
  it("首日全额 1.0：30 分钟 = 360（浏览器实测同值）", () => {
    const s = baseState();
    expect(effectOf(s).idleRate).toBeCloseTo(IDLE, 10);
    const r = offlineEarn(s, HALF_HOUR, 1);
    console.log(`\n首日 30min：idle=${effectOf(s).idleRate}/s × ${r.applied}s × 1.0 = ${r.earned}（HUD 显示 ${formatMoyu(r.earned)}）`);
    expect(r.applied).toBe(HALF_HOUR);
    expect(r.earned).toBeCloseTo(360, 10);
  });

  it("次日 70%：同样 30 分钟 = 252（浏览器实测同值）", () => {
    const s = baseState();
    const r = offlineEarn(s, HALF_HOUR, 0.7);
    console.log(`次日 30min：${effectOf(s).idleRate}/s × ${r.applied}s × 0.7 = ${r.earned}（${formatMoyu(r.earned)}）`);
    expect(r.earned).toBeCloseTo(360 * 0.7, 10);
  });

  it("8 小时封顶：100 小时只结算 28800 秒", () => {
    const s = baseState();
    s.levels.phone = 9; // idle 9 × 2 = 18/s（里程碑后），让数值有区分度
    const idle = effectOf(s).idleRate;
    const r = offlineEarn(s, 100 * 3600, 1);
    console.log(`\n离线 100h：applied=${r.applied}s（${r.applied / 3600}h，封顶 ${OFFLINE_CAP_SECONDS / 3600}h），idle=${idle}/s → 收益 ${r.earned}`);
    expect(r.applied).toBe(OFFLINE_CAP_SECONDS);
    expect(r.earned).toBeCloseTo(idle * OFFLINE_CAP_SECONDS, 6);
    expect(r.earned).toBeLessThan(idle * 100 * 3600);
  });

  it("速率阈值 24h：23h59m59s 全额 / 24h00m00s 起 70%（边界）", () => {
    const now = 1_800_000_000_000;
    const t1 = [23 * 3600 + 59 * 60 + 59, 24 * 3600, 24 * 3600 + 1].map((elapsed) => {
      const createdAt = now - elapsed * 1000;
      const rate = rateFor(now, createdAt);
      const s = baseState();
      const r = offlineEarn(s, elapsed, rate);
      return { elapsedH: +(elapsed / 3600).toFixed(4), rate, earned: r.earned };
    });
    for (const x of t1) console.log(`  离线 ${x.elapsedH}h → 速率 ${x.rate} → ${x.earned.toFixed(1)}`);
    expect(t1[0]!.rate).toBe(1);
    expect(t1[1]!.rate).toBe(0.7);
    expect(t1[2]!.rate).toBe(0.7);
  });

  it("存档链路：createdAt 持久化 + 未来 createdAt 收敛防绕过", () => {
    const mem = memSave();
    const now = 1_800_000_000_000;
    const s = baseState();
    serialize(s, mem, now - 2 * DAY_MS); // 2 天前建 档并保存
    const back = restore(mem, now);
    console.log(`\n存档链路：offlineSeconds=${Math.round(back.offlineSeconds)}s（${(back.offlineSeconds / 3600).toFixed(1)}h），createdAt 距今 ${((now - back.createdAt) / DAY_MS).toFixed(2)} 天 → 速率 ${rateFor(now, back.createdAt)}`);
    expect(back.createdAt).toBe(now - 2 * DAY_MS);
    expect(rateFor(now, back.createdAt)).toBe(0.7);

    // 篡改 createdAt 为未来 → restore 收敛到 savedAt，速率回到首日 1.0（不能靠改档白拿全额）
    serialize(s, mem, now - 60 * 60 * 1000);
    const raw = JSON.parse(mem.getItem("moyu-save")!) as Record<string, unknown>;
    raw.createdAt = now + 10 * DAY_MS;
    mem.setItem("moyu-save", JSON.stringify(raw));
    const hacked = restore(mem, now);
    console.log(`  未来 createdAt 篡改 → 收敛为 savedAt（距今 ${((now - hacked.createdAt) / 1000).toFixed(0)}s），速率 ${rateFor(now, hacked.createdAt)}`);
    expect(rateFor(now, hacked.createdAt)).toBe(1);
  });

  it("切后台回归：≥5s 才结算，30 分钟同规则（resume.ts）", () => {
    const s = baseState();
    const now = 1_800_000_000_000;
    const short = settleReturn(s, now - (RESUME_SETTLE_THRESHOLD_SECONDS - 1) * 1000, now, 1);
    const long = settleReturn(s, now - HALF_HOUR * 1000, now, 1);
    const nextDay = settleReturn(s, now - HALF_HOUR * 1000, now, 0.7);
    console.log(`\n切后台：4s → applied=${short.applied} 面板=${short.showPanel}；30min → ${long.earned}（面板 ${long.showPanel}）；次日 30min → ${nextDay.earned}`);
    expect(short.applied).toBe(0);
    expect(short.showPanel).toBe(false);
    expect(long.applied).toBe(HALF_HOUR);
    expect(long.earned).toBeCloseTo(360, 6);
    expect(long.showPanel).toBe(true);
    expect(nextDay.earned).toBeCloseTo(252, 6);
  });

  it("回归：三档与浏览器实测一一对应", () => {
    // CDP 真机（390×844，初始咖啡 Lv1、idle 0.2）实测：360.0 / 252.0 / 4032.0
    const s = baseState();
    const first = offlineEarn(s, HALF_HOUR, 1).earned;
    const second = offlineEarn(s, HALF_HOUR, 0.7).earned;
    const capped = offlineEarn(s, 100 * 3600, 0.7).earned;
    console.log(`\n真机对照：首日 ${first} = 360.0 ✅｜次日 ${second} = 252.0 ✅｜100h（70%）${capped} = 4032.0 ✅`);
    expect([first, second, capped].map((x) => +x.toFixed(1))).toEqual([360, 252, 4032]);
  });
});
