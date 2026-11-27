/**
 * R7 硬核放置老玩家 · 收入曲线 + 终盘深度探针
 *
 * 必做验证 1：最优购买策略下跑 1h / 6h / 24h / 72h，输出收入曲线（6h 块增长倍数），找「增长停滞」时刻。
 * 必做验证 2：评估 24h 后终盘内容（升级等级上限、终档 2.5e9 何时达成、图鉴 55 何时集满）。
 *
 * 运行：npx vitest run --config playtest/vitest.r7-hard.config.ts
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import {
  DEFAULT_HARD_CFG,
  TOTAL_ITEMS,
  collectionGap,
  formatMoyu,
  levelLine,
  longRun,
  runSim,
  type HardConfig,
  type Snapshot,
} from "./probe-r7-hard-lib";

const OUT = new URL("./r7-hard-evidence.json", import.meta.url).pathname;

function base(over: Partial<HardConfig>): HardConfig {
  return { ...DEFAULT_HARD_CFG, ...over };
}

function row(s: Snapshot): string {
  return `| ${s.hours.toFixed(0).padStart(3)}h | ${formatMoyu(s.totalEarned).padStart(9)} | ${formatMoyu(s.idleRate).padStart(8)}/s | ${s.rankName}(${s.rankIdx + 1}/7) | 图鉴 ${s.collection}/${TOTAL_ITEMS} | 解锁 ${s.unlocked}/9 | Lv合计 ${s.totalLevels} | 本段收入 ${formatMoyu(s.blockIncome).padStart(9)} | 环比 ${s.blockGrowth ? s.blockGrowth.toFixed(2) + "×" : "-"} |`;
}

describe("R7 硬核 · 1h/6h/24h/72h 收入曲线", () => {
  it("纯挂机最优购买：72h 曲线、6h 块增长倍数与停滞点", () => {
    const t0 = Date.now();
    // 基线策略 = 硬核 optimizer 的近最优解（sweep 见 probe-r7-hard-sweep：
    // 「可负担项 ROI ≥ 全局最优 ×0.6 才买，否则攒钱」72h 收入 1014 亿，比「有闲钱就买」+38%）
    const sim = runSim(base({ hours: 72, cps: 0, dt: 0.5, roiRatio: 0.6, snapshotHours: [1, 3, 6, 24] }));
    const ms = Date.now() - t0;

    console.log(`\n### A. 纯挂机 · 近最优购买（ROI 门槛 0.6 + 攒钱，事件全勤）72h — 耗时 ${ms}ms`);
    console.log("| 时点 | 累计收入 | 挂机率 | 段位 | 图鉴 | 解锁 | 等级 | 本段收入 | 环比 |");
    console.log("|---|---|---|---|---|---|---|---|---|");
    for (const s of sim.snapshots) console.log(row(s));

    console.log("\n6h 块明细：");
    for (const b of sim.blocks) {
      console.log(
        `  ${String(b.fromHours).padStart(3)}-${String(b.toHours).padStart(3)}h  收入 ${formatMoyu(b.income).padStart(9)}  环比 ${b.growth ? b.growth.toFixed(2) + "×" : "-"}  挂机率 ${formatMoyu(b.idleRate)}/s  段位 ${b.rankName}`,
      );
    }
    console.log("\n当前 HEAD（8969d10，14 档）段位达成：" + sim.rankCross.map((r) => `${r.name}@${r.atHours.toFixed(2)}h`).join("  "));
    // 任务书钉定 HEAD a786a53 的 7 档终档 = 2.5e9 = 当前 14 档表第 7 项（rankCross 下标 5）
    const a53 = sim.rankCross[5];
    console.log(`a786a53（任务书版本）7 档终档「摸鱼宇宙尽头」2.5e9 达成：${a53 ? `${a53.atHours.toFixed(2)}h` : "72h 内未达成"}`);
    console.log("前 6h 段位：" + sim.rankCross.filter((r) => r.atHours <= 6).map((r) => `${r.name}@${r.atHours.toFixed(2)}h`).join("  "));
    console.log("\n终态等级：" + levelLine(sim.snapshots[sim.snapshots.length - 1]!));
    console.log("\n开局前 25 次购买：" + sim.firstBuys.slice(0, 25).map((b) => `${b.hours.toFixed(2)}h ${b.id}(${formatMoyu(b.cost)})`).join(" "));
    console.log(
      `\n收入构成：挂机 ${formatMoyu(sim.income.idle)} / 点击 ${formatMoyu(sim.income.click)} / 事件 ${formatMoyu(sim.income.event)}；事件占比 ${((sim.income.event / sim.state.totalEarned) * 100).toFixed(1)}%`,
    );
    console.log(`事件 ${sim.patrols} 次，丢梗 ${sim.memesSeen} 次（新语录 ${sim.quotesHit}/10），攒钱等待 ${sim.saveWaits} 次`);
    console.log(`1e6 节点：${sim.at1e6 ? `${sim.at1e6.hours.toFixed(2)}h` : "未到"}；首次攒到 1e6：${sim.atRetireAffordable ? `${sim.atRetireAffordable.hours.toFixed(2)}h` : "未到"}`);

    expect(sim.state.totalEarned).toBeGreaterThan(0);
    expect(sim.snapshots.length).toBe(5);
    expect(sim.blocks.length).toBe(12);
    writeFileSync(OUT, JSON.stringify({ a: sim, ms }, null, 2));
  });

  it("对照：点击/半挂机/活跃点击/攒钱策略敏感度（72h）", () => {
    const cases: { name: string; cfg: HardConfig }[] = [
      { name: "纯挂机 cps=0", cfg: base({ hours: 72, cps: 0 }) },
      { name: "半挂机 cps=1", cfg: base({ hours: 72, cps: 1 }) },
      { name: "活跃 cps=3", cfg: base({ hours: 72, cps: 3 }) },
      { name: "纯挂机+攒钱60s", cfg: base({ hours: 72, cps: 0, saveWatchSeconds: 60 }) },
      { name: "纯挂机+攒钱300s", cfg: base({ hours: 72, cps: 0, saveWatchSeconds: 300 }) },
      { name: "纯挂机+攒钱900s", cfg: base({ hours: 72, cps: 0, saveWatchSeconds: 900 }) },
      { name: "纯挂机+攒钱1800s", cfg: base({ hours: 72, cps: 0, saveWatchSeconds: 1800 }) },
      { name: "纯挂机+攒钱3600s", cfg: base({ hours: 72, cps: 0, saveWatchSeconds: 3600 }) },
      { name: "纯挂机+只买最优", cfg: base({ hours: 72, cps: 0, saveWatchSeconds: 1e9 }) },
      { name: "事件党 cps=0.2", cfg: base({ hours: 72, cps: 0.2 }) },
      { name: "事件党+攒钱3600s", cfg: base({ hours: 72, cps: 0.2, saveWatchSeconds: 3600 }) },
    ];
    console.log("\n### B. 策略/点击敏感度对照（72h）");
    console.log("| 策略 | 72h 累计收入 | 72h 挂机率 | 段位 | 图鉴 | Lv合计 | 事件占比 |");
    console.log("|---|---|---|---|---|---|---|");
    const results: Record<string, unknown>[] = [];
    for (const c of cases) {
      const sim = runSim(c.cfg);
      const s = sim.snapshots[sim.snapshots.length - 1]!;
      const evShare = ((sim.income.event / sim.state.totalEarned) * 100).toFixed(1);
      console.log(
        `| ${c.name} | ${formatMoyu(s.totalEarned)} | ${formatMoyu(s.idleRate)}/s | ${s.rankName}(${s.rankIdx + 1}/7) | ${s.collection}/${TOTAL_ITEMS} | ${s.totalLevels} | ${evShare}% |`,
      );
      results.push({
        name: c.name,
        totalEarned: s.totalEarned,
        idleRate: s.idleRate,
        rankIdx: s.rankIdx,
        collection: s.collection,
        levels: s.levels,
        income: sim.income,
        firstBuys: sim.firstBuys.slice(0, 10),
      });
    }
    writeFileSync(OUT.replace(".json", "-sensitivity.json"), JSON.stringify(results, null, 2));
    expect(results.length).toBe(cases.length);
  });

  it("长跑：终档 2.5e9 何时达成 / 图鉴 55 何时集满（30 天）", () => {
    const t0 = Date.now();
    const { sim, rank7AtHours } = longRun(720, { cps: 0, dt: 15, buyInterval: 5, approxEventShare: 0.05, doEvents: false, roiRatio: 0.6 });
    const ms = Date.now() - t0;
    const last = sim.snapshots[sim.snapshots.length - 1]!;
    console.log(`\n### C. 30 天长跑（事件按 5% 折算，dt=15s，耗时 ${ms}ms）`);
    console.log(`30 天累计收入：${formatMoyu(last.totalEarned)}  挂机率 ${formatMoyu(last.idleRate)}/s  段位 ${last.rankName}(${last.rankIdx + 1}/7)  等级 ${levelLine(last)}`);
    console.log(`当前 HEAD 终档（摸鱼宇宙尽头·终 3.2e11）达成：${rank7AtHours === null ? "30 天内未达成" : `${rank7AtHours.toFixed(1)}h = ${(rank7AtHours / 24).toFixed(1)} 天`}`);
    const c = sim.rankCross;
    console.log("全段位达成：" + c.map((r) => `${r.name}@${r.atHours.toFixed(1)}h`).join("  "));
    const gap = collectionGap(sim.state);
    console.log(`图鉴 ${last.collection}/${TOTAL_ITEMS}；补齐图鉴还需累计花费 ${formatMoyu(gap.totalCost)}（retire 占 ${(gap.retireShare * 100).toFixed(1)}%）`);
    console.log("  补齐缺口 Top：" + gap.byItem.slice(0, 5).map((b) => `${b.name} Lv${b.from}→50 需 ${formatMoyu(b.cost)}`).join("；"));
    console.log("30 天途中快照：" + sim.snapshots.map((s) => `${s.hours}h 收 ${formatMoyu(s.totalEarned)} ${s.rankName}`).join(" | "));
    console.log("每 6h 块（长跑后半）：" + sim.blocks.slice(-8).map((b) => `${b.fromHours}-${b.toHours}h 收${formatMoyu(b.income)} ${b.growth ? b.growth.toFixed(2) + "×" : "-"}`).join(" | "));
    writeFileSync(OUT.replace(".json", "-longrun.json"), JSON.stringify({ last, rank7AtHours, gap, income: sim.income, blocks: sim.blocks, blocksAll: sim.blocks.length }, null, 2));
    expect(rank7AtHours).toBeNull();
  });
});
