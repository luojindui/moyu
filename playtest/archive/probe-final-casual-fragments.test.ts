import { describe, it, expect } from "vitest";
import {
  newSim,
  runSession,
  dateOf,
  visitBack,
  hudLine,
  affordableCount,
  lockedCount,
  dailySnapshot,
  rankText,
  newSim as freshSim,
  OFFLINE_CAP_SECONDS,
  clickPowerOf,
  effectOf,
  costOf,
  UPGRADES,
  formatMoyu,
  collectionCount,
  DT,
} from "./probe-final-casual-lib";
import { dailyAllDone, claimDaily } from "../src/engine/daily";
import { rankFor } from "../src/engine/titles";
import { collectionCount as cc } from "../src/engine/collection";

/**
 * 终验② 2 分钟碎片 session ×5，中间离线 30 分钟（真实存档链路：serialize → restore → offlineEarn →
 * 欢迎面板条件 earned>0；日报 ensureDaily / 图鉴 syncFlavorCollection / 段位 rankFor 全部接回）。
 * 画像：上班间隙偷玩 2 分钟，前 15 秒兴奋（2.5 次/秒）后手酸掉到 0.8 次/秒。
 */

const SESSION_S = 120;
const OFFLINE_S = 30 * 60;
const MOOD = (t: number): number => (t < 15 ? 2.5 : Math.max(0.8, 2.5 - t * 0.014));

function nextUnlockEta(state: import("../src/engine/state").GameState): string {
  const locked = UPGRADES.filter((u) => !(u.id in state.levels));
  if (!locked.length) return "全解锁";
  const need = Math.min(...locked.map((u) => costOf(u.id, 0) - state.moyu));
  const idle = effectOf(state).idleRate;
  const target = locked.find((u) => costOf(u.id, 0) - state.moyu === need)!;
  return `${target.name} 还差 ${formatMoyu(need)}（纯挂机 ${idle > 0 ? Math.ceil(need / idle) + "s" : "∞"}）`;
}

describe("终验②：5 × 2min 碎片 session + 中间离线 30 分钟", () => {
  it("每次回访收益 / 可买项 / 新内容", () => {
    const sim = newSim(20261127);
    const rows: Record<string, unknown>[] = [];
    let prevRank = rankFor(sim.state.totalEarned).current;
    let prevCollection = collectionCount(sim.state);
    let prevLevels = Object.keys(sim.state.levels).length;
    let prevDone = 0;
    let totalSessionEarned = 0;

    for (let i = 1; i <= 5; i++) {
      // ---- 回访 ----
      const back = visitBack(sim, OFFLINE_S);
      // 回访先看日报：可领就领（📔 红点行为）
      let claimText = "无可领";
      if (sim.state.daily && dailyAllDone(sim.state.daily) && !sim.state.daily.claimed) {
        const c = claimDaily(sim.state, dateOf(sim.now));
        if (c.claimedReward !== null) {
          sim.state = c.state;
          claimText = `领 +${formatMoyu(c.claimedReward)}（streak ${c.state.daily!.streak}）`;
        }
      }
      const atReturn = {
        离线收益: +back.earnings.toFixed(1),
        离线计入秒数: back.applied,
        速率: back.rate,
        欢迎面板: back.welcome ? "弹" : "不弹",
        可买项: affordableCount(sim.state),
        段位: rankFor(sim.state.totalEarned).current,
        图鉴: `${collectionCount(sim.state)}/55`,
        日报: dailySnapshot(sim.state.daily),
        日报领奖: claimText,
      };
      const earnBefore = sim.state.totalEarned;
      const buysBefore = sim.purchases.length;
      const clicksBefore = sim.clicks;
      const memesBefore = sim.memeHits;
      const patrolsBefore = sim.patrols;

      // ---- 2 分钟碎片 session ----
      runSession(sim, SESSION_S, MOOD, 3, "new");
      const sessionEarned = sim.state.totalEarned - earnBefore;
      totalSessionEarned += sessionEarned;

      const rankNow = rankFor(sim.state.totalEarned).current;
      const collectionNow = collectionCount(sim.state);
      const levelsNow = Object.keys(sim.state.levels).length;
      const doneNow = sim.state.daily ? sim.state.daily.goals.filter((g) => g.done).length : 0;
      const newContent: string[] = [];
      if (levelsNow > prevLevels) newContent.push(`新升级×${levelsNow - prevLevels}`);
      if (rankNow !== prevRank) newContent.push(`段位→${rankNow}`);
      if (collectionNow > prevCollection) newContent.push(`图鉴+${collectionNow - prevCollection}`);
      if (doneNow > prevDone) newContent.push(`日报完成+${doneNow - prevDone}`);
      if (sim.state.daily && dailyAllDone(sim.state.daily) && !sim.state.daily.claimed) newContent.push("日报★可领");

      rows.push({
        session: i,
        ...atReturn,
        本段收益: +sessionEarned.toFixed(0),
        本段点击: sim.clicks - clicksBefore,
        本段购买: sim.purchases.length - buysBefore,
        本段丢梗: sim.memeHits - memesBefore,
        本段巡逻: sim.patrols - patrolsBefore,
        结束HUD: hudLine(sim.state),
        新内容: newContent.length ? newContent.join("、") : "无",
        下一张新卡: nextUnlockEta(sim.state),
      });

      prevRank = rankNow;
      prevCollection = collectionNow;
      prevLevels = levelsNow;
      prevDone = doneNow;
    }

    for (const r of rows) console.log(JSON.stringify(r));

    console.log("\n== 10 分钟有效游玩 + 4×30 分钟离线 小结 ==");
    const last = rows.at(-1)!;
    console.log(`  最终段位 ${rankFor(sim.state.totalEarned).current}，累计 ${formatMoyu(sim.state.totalEarned)}`);
    console.log(`  离线总收益 ${rows.reduce((a, r) => a + Number(r.离线收益), 0).toFixed(0)}，游玩总收益 ${totalSessionEarned.toFixed(0)}`);
    console.log(`  图鉴 ${collectionCount(sim.state)}/55，日报 ${dailySnapshot(sim.state.daily)}`);
    console.log(`  升级等级: ${JSON.stringify(sim.state.levels)}`);

    // 回访必有收益（底薪 0.2/s 兜底）→ 欢迎面板每次都该弹
    expect(rows.every((r) => Number(r.离线收益) > 0)).toBe(true);
    expect(rows.every((r) => r.欢迎面板 === "弹")).toBe(true);
    // 5 个碎片 session 内应持续有新内容（升级/图鉴/段位/日报至少出现一次）
    expect(rows.some((r) => String(r.新内容) !== "无")).toBe(true);
    // 段位应能靠"离线+2分钟"推进
    expect(String(last.段位)).not.toBe("摸鱼实习生");
  });

  it("单次 2 分钟 session 能推进多少日报目标（3 目标随机）", () => {
    const sim = newSim(4242);
    // 固定日报目标组合：点100 / 买3 / 收1梗 是最常见的休闲组合，这里直接用真引擎掷出
    const before = dailySnapshot(sim.state.daily);
    runSession(sim, SESSION_S, MOOD, 3, "new");
    const after = dailySnapshot(sim.state.daily);
    console.log(`\n== 单次 2 分钟 ==\n  开始 ${before}\n  结束 ${after}`);
    const d = sim.state.daily!;
    console.log(`  2 分钟内完成 ${d.goals.filter((g) => g.done).length}/3 个目标；点击 ${sim.clicks} 次`);
    expect(sim.clicks).toBeGreaterThan(100);
  });

  it("离线 30 分钟收益 vs 可买项：回访是否有事可做", () => {
    // 首日全额的 30 分钟：0.2/s × 1800 = 360，足以买多张卡
    const sim = freshSim(99);
    const back = visitBack(sim, OFFLINE_S);
    const cheapest = Math.min(...UPGRADES.map((u) => costOf(u.id, 0)));
    const buyable = Math.floor(back.earnings / cheapest);
    console.log(
      `\n== 首次回访（30min，底薪 0.2/s）==\n  收益 ${back.earnings.toFixed(0)}＝${buyable} 张最便宜卡（${cheapest}）\n  可买项 ${affordableCount(sim.state)}/9；挂机 ${effectOf(sim.state).idleRate}/秒；点击 ${clickPowerOf(sim.state)}`,
    );
    expect(back.earnings).toBeCloseTo(360, 0);
    expect(buyable).toBeGreaterThanOrEqual(15);
  });

  it("8 小时封顶（碎片玩家周末回来）：真实链路", () => {
    const sim = freshSim(7);
    runSession(sim, SESSION_S, MOOD, 3, "new");
    const idleBefore = effectOf(sim.state).idleRate;
    const back = visitBack(sim, 100 * 3600);
    const expected = idleBefore * OFFLINE_CAP_SECONDS * back.rate;
    console.log(
      `\n== 离线 100 小时 ==\n  挂机 ${idleBefore}/秒 → 实际计入 ${back.applied}s（= ${back.applied / 3600}h，封顶 ${OFFLINE_CAP_SECONDS / 3600}h）\n  收益 ${back.earnings.toFixed(0)}，理论 ${expected.toFixed(0)}（速率 ${back.rate}）`,
    );
    expect(back.applied).toBe(OFFLINE_CAP_SECONDS);
    expect(back.earnings).toBeCloseTo(expected, 5);
  });

  it("对照：佛系 1 次/秒（手很闲的摸鱼玩家）", () => {
    const sim = newSim(20261127);
    const rows: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const back = visitBack(sim, OFFLINE_S);
      runSession(sim, SESSION_S, () => 1, 3, "new");
      rows.push(
        `第${i}次回访: 离线 +${formatMoyu(back.earnings)}（${back.rate}）｜可买 ${affordableCount(sim.state)}/9｜结束 ${hudLine(sim.state)}｜段位 ${rankFor(sim.state.totalEarned).current}`,
      );
    }
    for (const r of rows) console.log("  " + r);
    expect(rows.length).toBe(5);
  });
});
