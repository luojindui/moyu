/**
 * R7 硬核放置玩家 · 平衡探针
 *
 * 必做验证 4：9 档升级是否存在「永远不该买」的陷阱项 / 「买了就通关」的最优项。
 *   ① 在 1e6 累计节点做边际收益排序（下一级 ROI + 1e6 预算全砸单项的收益）；
 *   ② 点击线交叉点：需要多高的持续 cps 才值得买点击项；
 *   ③ 无单项支配：72h 近最优购买的结构分布。
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
    console.log("| 项 | 等级 | 下一级价 | +挂机/s | ROI(挂机/s per 摸鱼值) | 折算“每 1e6 摸鱼值多出” |");
    console.log("|---|---|---|---|---|---|");
    for (const m of mt) {
      console.log(
        `| ${m.name} | Lv${m.level} | ${formatMoyu(m.cost)} | ${m.dIdle || "—"} | ${m.idleRoi.toExponential(2)} | ${m.dIdle ? formatMoyu(m.idleRoi * 1e6) + "/s" : "0（点击项）"} |`,
      );
    }

    console.log(`\n1e6 预算全砸单项（从 1e6 累计态起，实际可花余额 ${formatMoyu(at1e6.moyu)}，此处为“假设有 1e6 预算”的排序）：`);
    const dump = budgetDump(st1e6, 1_000_000);
    console.log("| 项 | 可买级数 | 花费 | 总 +挂机/s | 总 +点击力 | 挂机 ROI |");
    console.log("|---|---|---|---|---|---|");
    for (const d of dump) {
      console.log(
        `| ${d.name} | ${d.levels} | ${formatMoyu(d.spent)} | ${formatMoyu(d.dIdle)} | ${d.dClick} | ${d.idleRoi.toExponential(2)} |`,
      );
    }
    console.log(`\n此时挂机基线 ${formatMoyu(at1e6.idleRate)}/s；把 1e6 全砸最优点 ${dump[0]!.name} → +${formatMoyu(dump[0]!.dIdle)}/s = ${((dump[0]!.dIdle / at1e6.idleRate) * 100).toFixed(1)}%`);

    // 第一次买得起 1e6 档（retire）时的收入跳变 = 是否存在「买了就通关」的支配项
    const before = effectOf(stRetire).idleRate;
    const afterRetire = effectOf({ ...stRetire, levels: { ...stRetire.levels, retire: 1 } }).idleRate;
    console.log(`\n### D2. 「买了就通关」检查：首次攒到 1e6（${atRetire.hours.toFixed(2)}h，累计 ${formatMoyu(atRetire.totalEarned)}）`);
    console.log(`买 retire 前挂机 ${formatMoyu(before)}/s → 买 1 级退休式躺平后 ${formatMoyu(afterRetire)}/s（+${((afterRetire / before - 1) * 100).toFixed(0)}%），下一级价 ${formatMoyu(costOf("retire", 1))}`);
    console.log("1e6 态各项等级：" + UPGRADES.map((u) => `${u.id}:${atRetire.levels[u.id] ?? 0}`).join(" "));
    writeFileSync(OUT, JSON.stringify({ at1e6, atRetire, mt, dump, retireJump: { before, afterRetire } }, null, 2));
    expect(dump.length).toBe(9);
  });

  it("点击线是否「永远不该买」：不同持续 cps 下 72h 收入的交叉点", () => {
    const cpsList = [0, 0.2, 0.4, 0.8, 2.5, 3];
    console.log("\n### D3. 点击线价值交叉：持续点击 cps → 72h 收入（同一近最优策略 roiRatio=0.6）");
    console.log("| 持续 cps | 单次收入倍率 | 72h 收入 | 相对纯挂机 | 点击收入占比 | 72h 总点击次数 | 点击线等级合计 |");
    console.log("|---|---|---|---|---|---|---|");
    const rows: { cps: number; total: number; clickShare: number; clicks: number; clickLevels: number }[] = [];
    for (const cps of cpsList) {
      const sim = runSim(base({ hours: 72, cps, dt: 0.5, roiRatio: 0.6 }));
      const s = sim.snapshots[sim.snapshots.length - 1]!;
      const clickLevels = (s.levels["coffee"] ?? 0) + (s.levels["water"] ?? 0) + (s.levels["chair"] ?? 0);
      const clickShare = sim.income.click / Math.max(1, sim.state.totalEarned);
      rows.push({ cps, total: s.totalEarned, clickShare, clicks: sim.totalClicks, clickLevels });
      console.log(
        `| ${cps} | ${cps > 0 ? "×" + (clickValueOf(cps) / cps).toFixed(2) : "—"} | ${formatMoyu(s.totalEarned)} | ${(s.totalEarned / rows[0]!.total * 100).toFixed(1)}% | ${(clickShare * 100).toFixed(1)}% | ${sim.totalClicks} | ${clickLevels} |`,
      );
    }
    // 交叉点：找到 72h 收入超过纯挂机的第一个 cps，线性内插
    const zero = rows[0]!.total;
    console.log(`\n纯挂机基线 ${formatMoyu(zero)}；交叉点 cps ≈ ${rows.filter((r) => r.total > zero).map((r) => r.cps).join("/") || "在 3cps 内都不赚"}`);
    writeFileSync(OUT.replace(".json", "-click.json"), JSON.stringify(rows, null, 2));
    expect(rows.length).toBe(cpsList.length);
  });

  it("无单项支配：近最优 72h 购买结构分布", () => {
    const sim = runSim(base({ hours: 72, cps: 0, dt: 0.5, roiRatio: 0.6 }));
    console.log("\n### D4. 近最优 72h 购买结构（总购买次数占比）");
    const total = Object.values(sim.purchases).reduce((a, b) => a + b, 0);
    for (const u of UPGRADES) {
      const n = sim.purchases[u.id] ?? 0;
      console.log(`  ${u.name.padEnd(6, "　")} ${String(n).padStart(4)} 次 (${((n / total) * 100).toFixed(1)}%)  末级 Lv${sim.state.levels[u.id] ?? 0}`);
    }
    console.log(`总购买 ${total} 次；未购买项：${UPGRADES.filter((u) => !sim.purchases[u.id]).map((u) => u.name).join("、") || "无"}`);
    console.log(`\n72h 末状态：挂机 ${formatMoyu(effectOf(sim.state).idleRate)}/s，点击力 ${formatMoyu(sim.state.levels["chair"] ? effectOf(sim.state).clickPower : 0)}，图鉴 ${sim.snapshots[sim.snapshots.length - 1]!.collection}/55`);
    const uniq = Object.entries(sim.purchases).filter(([, n]) => n > 0).map(([id]) => id);
    expect(uniq.length).toBe(6); // 6 个挂机项都被买；3 个点击项 0 次
    expect(sim.purchases["coffee"]).toBe(0);
    expect(sim.purchases["water"]).toBe(0);
    expect(sim.purchases["chair"]).toBe(0);
  });
});
