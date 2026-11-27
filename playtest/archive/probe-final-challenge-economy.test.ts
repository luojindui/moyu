import { describe, it, expect } from "vitest";
import {
  lateScenes,
  loadScenes,
  sceneName,
  stateFrom,
  simHour,
  r0,
  r1,
  pct,
} from "./probe-final-challenge-lib";

/**
 * 终验-⑦ 事件经济占比（1h 模拟）
 *
 * 口径：巡逻奖励 + 丢梗收入 / 同期挂机收入（idleRate × 3600）。
 *   - 巡逻：scheduleEvents 真实调度（平均约 120s 一次，28 次/h），忍政策连胜滚雪球（×1→×2）；
 *   - 丢梗：平均约 60s 一次（53 次/h），假设每次命中（5×点击力）；
 *   - 变体：hold 变体按忍结算；type/blitz 假设玩家完成点击任务（上限口径）。
 * 状态用 report.json 检查点快照（挂机率恒定）；真实进度中挂机率会涨，占比只会更低（保守）。
 */
describe("终验-⑦ 事件经济占比（1h 模拟）", () => {
  it("巡逻 + 丢梗收入占挂机收入：中后期 14.6%-19.2%（上限口径）", () => {
    const late = lateScenes();
    const rows = late.map((s) => {
      const st = stateFrom(s.levels, s.moyu);
      const hold = simHour(st, { seed: 7, cps: 3, forceHold: true });
      const mix = simHour(st, { seed: 7, cps: 3, forceHold: false });
      const patrolHoldShare = hold.dodgeTotal / hold.idleIncome;
      const totalHoldShare = (hold.dodgeTotal + hold.memeReward) / hold.idleIncome;
      const totalMixShare = (mix.dodgeTotal + mix.memeReward) / mix.idleIncome;
      return {
        scene: sceneName(s),
        idleRate: r1(s.ir),
        巡逻数: mix.patrols.length,
        丢梗数: mix.memeCount,
        "巡逻占比(忍)": pct(patrolHoldShare),
        "丢梗占比": pct(mix.memeReward / mix.idleIncome),
        "合计(忍)": pct(totalHoldShare),
        "合计(完成变体)": pct(totalMixShare),
        _patrolHoldShare: patrolHoldShare,
        _totalHoldShare: totalHoldShare,
        _totalMixShare: totalMixShare,
      };
    });
    console.table(rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("_")))));
    const shares = rows.map((r) => r._totalMixShare);
    const holdShares = rows.map((r) => r._totalHoldShare);
    const patrolShares = rows.map((r) => r._patrolHoldShare);
    console.log(
      `事件经济占比：巡逻(忍) ${pct(Math.min(...patrolShares))}-${pct(Math.max(...patrolShares))}；` +
        `含丢梗(忍) ${pct(Math.min(...holdShares))}-${pct(Math.max(...holdShares))}；` +
        `含丢梗+完成变体 ${pct(Math.min(...shares))}-${pct(Math.max(...shares))}`,
    );
    // 结构性结论：巡逻奖励单独已 ~11%-13%，丢梗再叠 1%-6%
    expect(Math.min(...patrolShares)).toBeGreaterThan(0.09);
    expect(Math.max(...patrolShares)).toBeLessThan(0.14);
    expect(Math.min(...shares)).toBeGreaterThan(0.10);
    expect(Math.max(...shares)).toBeLessThan(0.22); // 不构成支配性收入（仍以挂机为主）
    // 事件节奏符合设计（1h 内巡逻 28 次、丢梗 53 次）
    for (const r of rows) {
      expect(r.巡逻数).toBeGreaterThanOrEqual(26);
      expect(r.巡逻数).toBeLessThanOrEqual(31);
      expect(r.丢梗数).toBeGreaterThanOrEqual(46);
      expect(r.丢梗数).toBeLessThanOrEqual(60);
    }
  });

  it.fails("⚠️ <10% 目标未达成：中后期最低 14.6%、最高 19.2%（超 4.6-9.2pp）", () => {
    // 需求：“巡逻+丢梗收入占挂机收入（1h 模拟），应 <10%（如略超请给出数值与判断）”。
    // 实测最低 14.6%（clicker@180min）、最高 19.2%（casual@120min）；即使只算 hold 忍收益也 12.4%-16.9%。
    // 结构性原因：奖励基准 8×idleRate ×连胜×2 / 平均 120s 间隔 ≈ 13.3% 上限，未含丢梗。
    // 以 it.fails 记录偏差（若后续调到 <10% 该用例会转红提示复核阈值）。
    const late = lateScenes();
    const shares = late.map((s) => {
      const st = stateFrom(s.levels, s.moyu);
      const mix = simHour(st, { seed: 7, cps: 3, forceHold: false });
      return (mix.dodgeTotal + mix.memeReward) / mix.idleIncome;
    });
    console.warn(`⚠️ 事件经济占比 ${pct(Math.min(...shares))}-${pct(Math.max(...shares))}，目标 <10%`);
    expect(Math.max(...shares), "1h 事件收入占挂机收入应 <10%").toBeLessThan(0.1);
  });

  it("早期（低挂机基数）事件收入天然占主导——<10% 只对中后期成立（旁证）", () => {
    const early = loadScenes().filter((s) => s.minute <= 3);
    const rows = early.map((s) => {
      const st = stateFrom(s.levels, s.moyu);
      const h = simHour(st, { seed: 7, cps: 3, forceHold: true });
      return {
        scene: sceneName(s),
        idleRate: r1(s.ir),
        "1h挂机收入": r0(h.idleIncome),
        "1h事件收入": r0(h.dodgeTotal + h.memeReward),
        占比: pct((h.dodgeTotal + h.memeReward) / h.idleIncome),
      };
    });
    console.table(rows);
    // 早期安然奖下限 50 远高于挂机收入（如 0.2/s → 1h 720），占比必然 >100%；这是设计内的新手补偿。
    const first = rows[0]!;
    expect(String(first.占比)).not.toBe("0.0%");
  });
});
