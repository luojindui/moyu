import { describe, it, expect } from "vitest";
import {
  rollDaily,
  ensureDaily,
  dailyTrack,
  dailyAllDone,
  claimDaily,
  DAILY_GOAL_TEMPLATES,
  yesterdayLocal,
  restoreDaily,
  type DailyState,
} from "./daily";
import { initialState } from "./state";
import { effectOf } from "./upgrades";

const rng = (() => {
  let s = 42 >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
})();

describe("每日摸鱼日报", () => {
  it("rollDaily：3 个不重复目标，来自模板池", () => {
    const d = rollDaily("2026-11-26", rng);
    expect(d.goals).toHaveLength(3);
    expect(new Set(d.goals.map((g) => g.id)).size).toBe(3);
    expect(DAILY_GOAL_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    expect(d.claimed).toBe(false);
    expect(d.streak).toBe(0);
  });

  it("目标量级为会话 1/3（10 分钟可完成）：点 100 / 收 1 梗 / 买 3 级 / 安然 2 次", () => {
    const byId = Object.fromEntries(DAILY_GOAL_TEMPLATES.map((t) => [t.id, t.target]));
    expect(byId["click_100"]).toBe(100);
    expect(byId["meme_1"]).toBe(1);
    expect(byId["buy_3"]).toBe(3);
    expect(byId["survive_2"]).toBe(2);
  });

  it("dailyTrack：进度累计、达标置 done、超额不溢出", () => {
    let d: DailyState = rollDaily("2026-11-26", rng);
    d = dailyTrack(d, "click", 60);
    expect(d.goals.find((g) => g.id === "click_100")!.progress).toBe(60);
    d = dailyTrack(d, "click", 60);
    const g = d.goals.find((x) => x.id === "click_100")!;
    expect(g.progress).toBe(100);
    expect(g.done).toBe(true);
  });

  it("ensureDaily：同日幂等、跨日重掷（streak 保留）", () => {
    let s = initialState();
    s = ensureDaily(s, "2026-11-26", rng);
    const d1 = s.daily!.goals.map((g) => g.id).join(",");
    const s2 = ensureDaily(s, "2026-11-26", rng);
    expect(s2.daily!.goals.map((g) => g.id).join(",")).toBe(d1); // 同日不重掷
    const s3 = ensureDaily(s, "2026-11-27", rng);
    expect(s3.daily!.date).toBe("2026-11-27");
    expect(s3.daily!.goals.every((g) => g.progress === 0 && !g.done)).toBe(true);
  });

  it("claimDaily：全完成才可领，奖励 = max(500, 60×挂机)；streak 推进", () => {
    let s = initialState();
    s.levels["phone" as string] = 5; // 10.2/s → 60×10.2 = 612
    s = ensureDaily(s, "2026-11-26", rng);
    expect(claimDaily(s, "2026-11-26").claimedReward).toBeNull(); // 未完成
    // 强制完成全部目标
    s.daily!.goals.forEach((g) => {
      g.progress = g.target;
      g.done = true;
    });
    const r = claimDaily(s, "2026-11-26");
    // 独立推定：max(500, 60 × 10.2) = 612
    expect(r.claimedReward).toBe(612);
    expect(r.state.daily!.claimed).toBe(true);
    expect(r.state.daily!.streak).toBe(1);
    // 次日完成 → streak 2
    let s2 = r.state;
    s2 = ensureDaily(s2, "2026-11-27", rng);
    s2.daily!.goals.forEach((g) => {
      g.progress = g.target;
      g.done = true;
    });
    expect(claimDaily(s2, "2026-11-27").state.daily!.streak).toBe(2);
  });

  it("隔天未完成 → streak 归 1 重计", () => {
    let s = initialState();
    s = ensureDaily(s, "2026-11-26", rng);
    s.daily!.goals.forEach((g) => {
      g.progress = g.target;
      g.done = true;
    });
    s = claimDaily(s, "2026-11-26").state;
    // 跳过 27 日，28 日再完成
    s = ensureDaily(s, "2026-11-28", rng);
    expect(s.daily!.streak).toBe(0); // 未领不涨
    s.daily!.goals.forEach((g) => {
      g.progress = g.target;
      g.done = true;
    });
    expect(claimDaily(s, "2026-11-28").state.daily!.streak).toBe(1);
  });

  it("dailyAllDone 判定", () => {
    let s = initialState();
    s = ensureDaily(s, "2026-11-26", rng);
    expect(dailyAllDone(s.daily!)).toBe(false);
    s.daily!.goals.forEach((g) => {
      g.progress = g.target;
      g.done = true;
    });
    expect(dailyAllDone(s.daily!)).toBe(true);
  });

  it("奖励与挂机挂钩（不买升级也有 500 保底）", () => {
    let s = initialState();
    s = ensureDaily(s, "2026-11-26", rng);
    s.daily!.goals.forEach((g) => {
      g.progress = g.target;
      g.done = true;
    });
    expect(claimDaily(s, "2026-11-26").claimedReward).toBe(500);
    expect(effectOf(initialState()).idleRate).toBe(0.2); // 底薪党保底语境
  });
});

describe("日报结构净化和跨日（nurture 验收 #3/#5）", () => {
  it("目标池文案与巡逻变体一致（应付 2 次巡逻）", () => {
    const tpl = DAILY_GOAL_TEMPLATES.find((t) => t.id === "survive_2")!;
    expect(tpl.desc).toContain("巡逻"); // 不写"安然躲过"（变体下点满也算）
  });

  it("yesterdayOf 用本地日期（UTC+8 跨日正确）", () => {
    expect(yesterdayLocal("2026-03-01")).toBe("2026-02-28");
    expect(yesterdayLocal("2026-01-01")).toBe("2025-12-31");
  });

  it("restoreDaily 形状非法 → null（空 goals/缺 streak/非数值 progress）", () => {
    expect(restoreDaily(null)).toBeNull();
    expect(restoreDaily({ date: "2026-11-27", goals: [], claimed: false })).toBeNull();
    expect(restoreDaily({ date: "2026-11-27", goals: [{ id: "x", target: 1, progress: 1, done: true }], claimed: false })).toBeNull();
  });
});
