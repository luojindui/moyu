/**
 * R7 硬核放置玩家 · 平衡探针
 *
 * 必做验证 4：9 档升级是否存在「永远不该买」的陷阱项 / 「买了就通关」的最优项。
 *   ① 1e6 累计节点：下一级边际 ROI 排序 + 1e6 预算全砸单项；
 *   ② 是否「买了就通关」：首次攒到 1e6 买 retire 的收入跳变；
 *   ③ 点击线是否陷阱：同一 cps 下「买点击项 vs 不买」的 72h 收入差；
 *   ④ 无单项支配：近最优 72h 购买结构。
 *
 * 运行：npx vitest run --config playtest/vitest.r7-hard.config.ts
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import {
  DEFAULT_HARD_CFG,
  UPGRADES,
  budgetDump,
  clickValueOf,
  costOf,
  effectOf,
  formatMoyu,
  initialState,
  marginalTable,
  runSim,
  valueScoreOf,
  type GameState,
  type HardConfig,
  type Snapshot,
} from "./probe-r7-hard-lib";

const OUT = new URL("./r7-hard-balance.json", import.meta.url).pathname;

function base(over: Partial<HardConfig>): HardConfig {
  return { ...DEFAULT_HARD_CFG, ...over };
}
function stateOf(s: Snapshot): GameState {
  return { ...initialState(), levels: { ...s.levels }, moyu: s.moyu, totalEarned: s.totalEarned };
}

describe("R7 硬核 · 平衡：陷阱项 / 支配项 / 1e6 边际排序", () => {
  it("1e6 累计节点：下一级边际 ROI 排序 + 1e6 预算全砸单项", () => {
    const sim = runSim(base({ hours: 2, cps: 0, dt: 0.5, roiRatio: 0.6, snapshotHours: [1] }));
    const at1e6 = sim.at1e6!;
    const atRetire = sim.atRetireAffordable!;
    const st1e6 = stateOf(at1e6);
    const stRetire = stateOf(atRetire);
    console.log(`\n### D1. 1e6 累计节点（${at1e6.hours.toFixed(2)}h）状态：挂机 ${formatMoyu(at1e6.idleRate)}/s，段位 ${at1e6.rankName}`);
    console.log("等级：" + UPGRADES.map((u) => `${u.id} Lv${at1e6.levels[u.id] ?? 0}`).join("  "));

    console.log("\n下一级边际 ROI（纯挂机口径，按挂机产能排序）：");
    const mt = marginalTable(st1e6, 0).sort((a, b) => b.idleRoi - a.idleRoi);
    console.log("| 项 | 等级 | 下一级价 | +挂机/s | ROI(挂机/s per 摸鱼值) | 1e6 预算折算 |");
    console.log("|---|---|---|---|---|---|");
    for (const m of mt) {
      console.log(
        `| ${m.name} | Lv${m.level} | ${formatMoyu(m.cost)} | ${m.dIdle || "—"} | ${m.idleRoi.toExponential(2)} | ${m.dIdle ? formatMoyu(m.idleRoi * 1e6) + "/s" : "0（点击项，纯挂机口径）"} |`,
      );
    }

    console.log(`\n1e6 预算全砸单项（从 1e6 累计态起；此时实际可花余额 ${formatMoyu(at1e6.moyu)}）：`);
    const dump = budgetDump(st1e6, 1_000_000);
    console.log("| 项 | 可买级数 | 花费 | 总 +挂机/s | 总 +点击力 | 挂机 ROI |");
    console.log("|---|---|---|---|---|---|");
    for (const d of dump) {
      console.log(
        `| ${d.name} | ${d.levels} | ${formatMoyu(d.spent)} | ${formatMoyu(d.dIdle)} | ${d.dClick} | ${d.idleRoi.toExponential(2)} |`,
      );
    }
    console.log(`此时挂机基线 ${formatMoyu(at1e6.idleRate)}/s；全砸最优点 ${dump[0]!.name} → +${formatMoyu(dump[0]!.dIdle)}/s = +${((dump[0]!.dIdle / at1e6.idleRate) * 100).toFixed(1)}%`);

    // 「买了就通关」检查：首次买得起 1e6 档时 retire 的收入跳变
    const before = effectOf(stRetire).idleRate;
    const afterRetire = effectOf({ ...stRetire, levels: { ...stRetire.levels, retire: 1 } }).idleRate;
    console.log(`\n### D2. 「买了就通关」检查：首次攒到 1e6（${atRetire.hours.toFixed(2)}h，累计 ${formatMoyu(atRetire.totalEarned)}）`);
    console.log(`retire 前挂机 ${formatMoyu(before)}/s → 买 1 级退休式躺平后 ${formatMoyu(afterRetire)}/s（+${((afterRetire / before - 1) * 100).toFixed(0)}%），下一级价 ${formatMoyu(costOf("retire", 1))}`);
    console.log("1e6 态各项等级：" + UPGRADES.map((u) => `${u.id}:${atRetire.levels[u.id] ?? 0}`).join(" "));
    writeFileSync(OUT, JSON.stringify({ at1e6, atRetire, mt, dump, retireJump: { before, afterRetire } }, null, 2));
    expect(dump.length).toBe(9);
    // 无单项支配：1e6 预算下最高/次高 < 3×（深度摸鱼 2.3×，但那是它等级低/单价便宜；
    // 等 retire 解锁后 ROI 会追上，不是「买了就通关」）
    expect(dump[0]!.dIdle / dump[1]!.dIdle).toBeLessThan(3);
    // retire 首买增益 < 30%：不是通关按钮
    expect(afterRetire / before - 1).toBeLessThan(0.3);
  });

  it("点击线陷阱验证：主动点击但只靠点击收入，买 vs 不买点击项", () => {
    const cases: { cps: number; buy: boolean }[] = [
      { cps: 0.2, buy: true },
      { cps: 0.2, buy: false },
      { cps: 2.5, buy: true },
      { cps: 2.5, buy: false },
    ];
    console.log("\n### D3. 点击线陷阱验证（72h，roiRatio=0.6；同一 cps 下买/不买点击项）");
    console.log("| 持续 cps | 买点击项 | 72h 收入 | 点击收入占比 | 图鉴 | 点击线等级 | 末挂机率 |");
    console.log("|---|---|---|---|---|---|---|");
    const rows: { cps: number; buy: boolean; total: number; clickShare: number; collection: number; clickLevels: number; idle: number }[] = [];
    for (const c of cases) {
      const sim = runSim(base({ hours: 72, cps: c.cps, dt: 0.5, roiRatio: 0.6, buyClickItems: c.buy }));
      const s = sim.snapshots[sim.snapshots.length - 1]!;
      const clickLevels = (s.levels["coffee"] ?? 0) + (s.levels["water"] ?? 0) + (s.levels["chair"] ?? 0);
      const clickShare = sim.income.click / Math.max(1, sim.state.totalEarned);
      rows.push({ cps: c.cps, buy: c.buy, total: s.totalEarned, clickShare, collection: s.collection, clickLevels, idle: s.idleRate });
      console.log(
        `| ${c.cps} | ${c.buy ? "是" : "否"} | ${formatMoyu(s.totalEarned)} | ${(clickShare * 100).toFixed(1)}% | ${s.collection}/55 | ${clickLevels} | ${formatMoyu(s.idleRate)}/s |`,
      );
    }
    const a = rows[0]!;
    const b = rows[1]!;
    console.log(`\ncps=0.2：买点击项 ${formatMoyu(a.total)} vs 不买 ${formatMoyu(b.total)} → 收益差 ${(((a.total / b.total) - 1) * 100).toFixed(1)}%`);
    const a2 = rows[2]!;
    const b2 = rows[3]!;
    console.log(`cps=2.5（48h 内 43.2 万次点击，人类不可持续）：买 ${formatMoyu(a2.total)} vs 不买 ${formatMoyu(b2.total)} → 收益差 ${(((a2.total / b2.total) - 1) * 100).toFixed(1)}%`);
    console.log("说明：cps=0.2 时 72h 总点击 5.18 万次 ≥ 2 万点击门槛 → 图鉴 55/55 → ×1.2 挂机加成（这才是点击的真正价值，与买不买点击项无关）");
    writeFileSync(OUT.replace(".json", "-click.json"), JSON.stringify(rows, null, 2));
    expect(rows.length).toBe(4);
  });

  it("商店「性价比」星标是否误导：点击向按『每点点击力』计价，未按 cps 折算", () => {
    const sim = runSim(base({ hours: 24, cps: 0, dt: 0.5, roiRatio: 0.6, snapshotHours: [1] }));
    for (const s of sim.snapshots) {
      const st = stateOf(s);
      const scores = UPGRADES.map((u) => {
        const lv = st.levels[u.id] ?? 0;
        const v = valueScoreOf(u.id, lv);
        return { id: u.id, name: u.name, click: v.click, idle: v.idle, isClick: !!u.clickPower, cost: costOf(u.id, lv) };
      });
      const bestClick = scores.filter((x) => x.isClick).sort((a, b) => b.click - a.click)[0]!;
      const bestIdle = scores.filter((x) => !x.isClick).sort((a, b) => b.idle - a.idle)[0]!;
      console.log(`\n### D5. 商店性价比显示对比（${s.hours}h，idle ${formatMoyu(s.idleRate)}/s）`);
      console.log(`  ★点击向最优：${bestClick.name}「点击 ${bestClick.click.toFixed(0)}/万」（价 ${formatMoyu(bestClick.cost)}）`);
      console.log(`  ★挂机向最优：${bestIdle.name}「挂机 ${bestIdle.idle.toFixed(3)}/万」（价 ${formatMoyu(bestIdle.cost)}）`);
      console.log(`  → 显示值相差 ${(bestClick.click / Math.max(1e-9, bestIdle.idle)).toFixed(0)} 倍，但点击向单位是「点击力/万」、挂机向是「挂机每秒/万」，两者不可比；`);
      console.log(`     0.2cps 折算下点击向真实收益 = 点击力×0.2/秒，分数应 ≈ ${(bestClick.click * 0.2).toFixed(1)}/万，仍远低于挂机向 ${bestIdle.idle.toExponential(2)}`);
    }
    expect(sim.snapshots.length).toBeGreaterThan(0);
  });

  it("无单项支配：近最优 72h 购买结构分布", () => {
    const sim = runSim(base({ hours: 72, cps: 0, dt: 0.5, roiRatio: 0.6 }));
    console.log("\n### D4. 近最优 72h 购买结构（总购买次数占比）");
    const total = Object.values(sim.purchases).reduce((x, y) => x + y, 0);
    for (const u of UPGRADES) {
      const n = sim.purchases[u.id] ?? 0;
      console.log(`  ${u.name.padEnd(6, "　")} ${String(n).padStart(4)} 次 (${((n / total) * 100).toFixed(1)}%)  末级 Lv${sim.state.levels[u.id] ?? 0}`);
    }
    const uniq = Object.entries(sim.purchases).filter(([, n]) => n > 0).map(([id]) => id);
    console.log(`总购买 ${total} 次；未购买项：${UPGRADES.filter((u) => !sim.purchases[u.id]).map((u) => u.name).join("、")}`);
    console.log(`72h 末：挂机 ${formatMoyu(effectOf(sim.state).idleRate)}/s，图鉴 ${sim.snapshots[sim.snapshots.length - 1]!.collection}/55`);
    expect(uniq.length).toBe(6);
    expect(sim.purchases["coffee"]).toBe(0);
    expect(sim.purchases["water"]).toBe(0);
    expect(sim.purchases["chair"]).toBe(0);
  });
});
