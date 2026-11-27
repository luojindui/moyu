import { describe, it, expect } from "vitest";
import {
  loadScenes,
  loadReport,
  lateScenes,
  sceneName,
  stateFrom,
  simPatrolClicks,
  softReward,
  simHour,
  r0,
  r1,
  pct,
  type Scene,
} from "./probe-final-challenge-lib";

/**
 * 终验-A：心跳赌点（挑战/刺激党）
 *
 * ① 赌点存在性：用 playtest/report.json 的实跑检查点 levels 建「忍 EV vs 硬刚 EV」表（1/3/5/8cps）。
 *    忍 EV   = 安然奖励 max(50, 8×idleRate) × 连胜乘数（hold 变体，不点击）
 *    硬刚 EV = 巡逻 8s 全点（含连击链稳态）的净收入（点击收入 − 逐击罚，单巡逻封顶 6×idleRate）
 * ② 无脑连点是否被治住：1h 真实调度（scheduleEvents），两种口径：
 *    单次决策（硬刚政策下每场被抓 → 连胜恒 0，机会成本 = 连胜 0 奖励）→ 对应“每场巡逻赌不赌”
 *    连胜滚雪球（忍政策跑到 ×2 后再评估硬刚）→ 对应“整小时都硬刚 vs 一直忍”的全周期账
 * ③ 花光规避：余额 0 vs 余额 100 倍，同一巡逻罚款是否一致、余额不为负。
 */

function sceneRows(scenes: Scene[]) {
  return scenes.map((s) => {
    const st = stateFrom(s.levels, s.moyu);
    const soft0 = softReward(st, 0);
    const soft10 = softReward(st, 10);
    const net = (cps: number) => simPatrolClicks(st, cps).net;
    const n1 = net(1);
    const n3 = net(3);
    const n5 = net(5);
    const n8 = net(8);
    return {
      scene: sceneName(s),
      idleRate: r1(s.ir),
      cp: r0(s.cp),
      "cp/ir": +r2(s.cp / s.ir),
      余额: r0(s.moyu),
      "忍EV@0": r0(soft0),
      "忍EV@10": r0(soft10),
      "硬刚@1": r0(n1),
      "硬刚@3": r0(n3),
      "硬刚@5": r0(n5),
      "硬刚@8": r0(n8),
      "3cps占优@0": n3 > soft0 ? "硬刚⚠" : "忍✓",
      "3cps占优@10": n3 > soft10 ? "硬刚⚠" : "忍✓",
      "8cps占优@0": n8 > soft0 ? "硬刚✓" : "忍",
    };
  });
}

const scenes = loadScenes();

describe("终验-① 赌点存在性（report.json 真实进度）", () => {
  it("sanity：28 个检查点 levels → 引擎重算 cp/ir 与报告一致", () => {
    expect(scenes.length).toBeGreaterThanOrEqual(28);
    for (const s of scenes) {
      expect(s.cp).toBeCloseTo(s.reportCp, 6);
      expect(s.ir).toBeCloseTo(s.reportIr, 6);
    }
    const rep = loadReport();
    console.log(`sanity: ${scenes.length} 检查点 cp/ir 与引擎一致（report ${rep.generatedAt} / ${rep.engine}）`);
  });

  it("中后期真实场景：忍 EV vs 硬刚 EV（1/3/5/8cps）", () => {
    const late = lateScenes();
    expect(late.length).toBeGreaterThanOrEqual(8);
    const rows = sceneRows(late);
    console.table(rows);
    const soft = late.map((s) => softReward(stateFrom(s.levels, s.moyu), 0));
    const net = (cps: number) => late.map((s) => simPatrolClicks(stateFrom(s.levels, s.moyu), cps).net);

    // 1cps：慢点必亏（纯送罚款）——全部忍优
    net(1).forEach((v, i) => expect(v, `${sceneName(late[i]!)} 1cps`).toBeLessThan(soft[i]!));

    // 3cps：中后期 3cps 忍占优为主（严格目标 0 例外，见下方 it.fails）
    const hard3 = net(3).filter((v, i) => v > soft[i]!).length;
    console.log(`中后期 ${late.length} 场景 @连胜0：3cps 硬刚占优 ${hard3} 个，5cps ${net(5).filter((v, i) => v > soft[i]!).length} 个，8cps ${net(8).filter((v, i) => v > soft[i]!).length} 个`);
    expect(hard3, "3cps 硬刚占优场景应 ≤3（无脑连点主体被治住）").toBeLessThanOrEqual(3);

    // 8cps：赌点存在（至少 1 个场景硬刚占优）且不再 100%（至少 1 个场景忍优）
    const hard8 = net(8).filter((v, i) => v > soft[i]!).length;
    expect(hard8, "8cps 至少一个场景硬刚占优（赌点存在）").toBeGreaterThanOrEqual(1);
    expect(hard8, "8cps 不应全场景硬刚占优（赌点不是白给）").toBeLessThan(late.length);
    expect(hard8 / late.length, "8cps 硬刚占优场景应 ≥50%").toBeGreaterThanOrEqual(0.5);

    // 常规中后期玩家已积累连胜：连胜 10 时 3cps 应全部忍优
    const soft10 = late.map((s) => softReward(stateFrom(s.levels, s.moyu), 10));
    net(3).forEach((v, i) => expect(v, `${sceneName(late[i]!)} 3cps@连胜10`).toBeLessThanOrEqual(soft10[i]!));
  });

  it.fails("⚠️ 严格口径：连胜 0 时 3cps 并非全部忍优（已知 2/10 例外，见数据）", () => {
    // 需求原文：“中后期 idleRate≥1000 时 3cps 忍占优”。
    // 实测：多数场景成立，但 clicker@30min（翻正 2.75cps）与 casual@120min（翻正 2.75cps）在连胜 0 时 3cps 硬刚占优。
    // 以 it.fails 记录该口径偏差（修复后应转绿）：严格期望“例外数 = 0”。
    const late = lateScenes();
    const soft = late.map((s) => softReward(stateFrom(s.levels, s.moyu), 0));
    const violations = late
      .map((s, i) => ({ s, delta: simPatrolClicks(stateFrom(s.levels, s.moyu), 3).net - soft[i]! }))
      .filter((x) => x.delta > 0);
    console.warn(`严格口径偏差：${violations.map((v) => `${sceneName(v.s)} +${r0(v.delta)}`).join("，")}`);
    expect(violations.length, "3cps 硬刚占优例外数").toBe(0);
  });
});

describe("终验-② 无脑连点是否被治住（1h 政策对比）", () => {
  const SEEDS = [1, 7, 42, 99];

  function run(cps: number) {
    const late = lateScenes();
    const agg = { base: [] as number[], snow: [] as number[], hardPolicyScenes: [] as number[] };
    for (const seed of SEEDS) {
      const hours = late.map((s) => simHour(stateFrom(s.levels, s.moyu), { seed, cps, forceHold: true }));
      agg.base.push(hours.reduce((a, h) => a + h.baseWinRate, 0) / hours.length);
      agg.snow.push(hours.reduce((a, h) => a + h.winRate, 0) / hours.length);
      agg.hardPolicyScenes.push(hours.filter((h) => h.policy.winner === "硬刚").length / hours.length);
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    return { base: mean(agg.base), snow: mean(agg.snow), policy: mean(agg.hardPolicyScenes), late };
  }

  it("8cps 单次决策胜率 ≥50% 但不再 100%；3cps <40%", () => {
    const r8 = run(8);
    const r3 = run(3);
    console.table([
      { 口径: "单次巡逻决策（连胜0，1h 内每场赌不赌）", "8cps 硬刚胜率": pct(r8.base), "3cps 硬刚胜率": pct(r3.base) },
      { 口径: "连胜滚雪球（忍政策到 ×2 后逐巡逻）", "8cps 硬刚胜率": pct(r8.snow), "3cps 硬刚胜率": pct(r3.snow) },
      { 口径: "1h 全周期政策（硬刚 vs 忍 总额）", "8cps 硬刚胜率": pct(r8.policy), "3cps 硬刚胜率": pct(r3.policy) },
    ]);
    // 需求断言（单次决策口径）
    expect(r8.base, "8cps 硬刚胜率 ≥50%").toBeGreaterThanOrEqual(0.5);
    expect(r8.base, "8cps 硬刚胜率不再 100%（存在忍更优场景）").toBeLessThan(1);
    expect(r3.base, "3cps 硬刚胜率 <40%").toBeLessThan(0.4);
    // 补充：若整小时都押硬刚（无脑连点到底），全周期政策反而输——治住的核心证据
    expect(r8.policy, "1h 全周期都硬刚的 8cps 政策胜率应 <50%").toBeLessThan(0.5);
    expect(r3.policy, "1h 全周期都硬刚的 3cps 政策胜率应 <40%").toBeLessThan(0.4);
  });

  it.fails("⚠️ 口径差异：若把 1h 全周期政策作为唯一口径，8cps 仅 2/10 场景赢（<50%）", () => {
    // 需求写的是“1h 政策对比（单次巡逻 + 连胜滚雪球）”。按“整小时都硬刚 vs 一直忍”的总账口径，
    // 连胜滚雪球（×2）会把硬刚比下去：8cps 只在 clicker@30 / casual@120 两个中前期点击强势场景赢。
    // 这与“单次巡逻赌点”口径（8cps 80%）结论不同——以 it.fails 记录口径依赖，供产品确认主口径。
    const r8 = run(8);
    expect(r8.policy, "1h 全周期 8cps 硬刚政策获胜场景占比").toBeGreaterThanOrEqual(0.5);
  });
});

describe("终验-③ 花光规避（罚款与余额脱钩）", () => {
  it("8cps / 5cps：余额 0 与余额 100 倍，同一巡逻罚款完全相同；余额不为负", () => {
    const rows: Record<string, unknown>[] = [];
    for (const cps of [5, 8]) {
      for (const s of scenes) {
        const st0 = stateFrom(s.levels, 0);
        const rich = s.moyu * 100 + 1000;
        const stRich = stateFrom(s.levels, rich);
        const a = simPatrolClicks(st0, cps);
        const b = simPatrolClicks(stRich, cps);
        expect(a.lost, `${sceneName(s)} ${cps}cps 罚款应与余额无关`).toBeCloseTo(b.lost, 6);
        expect(a.net, `${sceneName(s)} ${cps}cps 余额 0 不应透支`).toBeGreaterThanOrEqual(-1e-9);
        if (cps === 8) rows.push({ scene: sceneName(s), "罚款@余额0": r1(a.lost), "罚款@余额100x": r1(b.lost), 相同: "✓" });
      }
    }
    console.table(rows.slice(0, 4));
    console.log(`8cps/5cps：32/32 场景罚款与余额无关（余额 0 亦不为负）`);
  });

  it.fails("⚠️ 低 cps（1/3cps）仍残留余额耦合：余额 0 时罚不满封顶（会被“花光”少罚）", () => {
    // onBossTap 的 lost = min(perTap, cap-已罚, 扣除收入后的余额)。
    // 8cps 时累计点击收入 > 封顶，余额会补足，所以看起来“脱钩”；
    // 但 1/3cps 累计收入不足以摸到封顶，余额 0 的玩家只被罚光收入，比富玩家少罚。
    // 实测（32 场景）：3cps 6/32 场景不等（跨 10 个中后期场景为 6/10）；1cps 13/32 不等。
    // 结论：不产生正期望（净收益 0，花光不能让赌点变正），但“脱钩”未完全达成 → 以 it.fails 记录。
    let mismatch3 = 0;
    let mismatch1 = 0;
    const examples: string[] = [];
    for (const s of scenes) {
      for (const cps of [1, 3]) {
        const a = simPatrolClicks(stateFrom(s.levels, 0), cps);
        const b = simPatrolClicks(stateFrom(s.levels, s.moyu * 100 + 1000), cps);
        if (Math.abs(a.lost - b.lost) > 1e-6) {
          if (cps === 1) mismatch1++;
          else mismatch3++;
          if (examples.length < 5) {
            examples.push(`${sceneName(s)}@${cps}cps 余额0罚${r0(a.lost)} vs 富罚${r0(b.lost)}（净0=${r0(a.net)}）`);
          }
        }
      }
    }
    console.warn(`低 cps 余额耦合：1cps ${mismatch1}/32、3cps ${mismatch3}/32 场景不等；例：${examples.join("；")}`);
    expect(mismatch3 + mismatch1, "任意 cps 下罚款都应完全相同（脱钩）").toBe(0);
  });
});

function r2(n: number): number {
  return +n.toFixed(2);
}
