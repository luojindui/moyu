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
  RANKS,
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
  return `| ${s.hours.toFixed(0).padStart(3)}h | ${formatMoyu(s.totalEarned).padStart(9)} | ${formatMoyu(s.idleRate).padStart(8)}/s | ${s.rankName}(${s.rankIdx + 1}/${RANKS.length}) | 图鉴 ${s.collection}/${TOTAL_ITEMS} | 解锁 ${s.unlocked}/9 | Lv合计 ${s.totalLevels} | 本段收入 ${formatMoyu(s.blockIncome).padStart(9)} | 环比 ${s.blockGrowth ? s.blockGrowth.toFixed(2) + "×" : "-"} |`;
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

  it("对照：购买策略敏感度 + 点击意愿敏感度（72h）", () => {
    console.log("\n### B1. 购买策略敏感度（cps=0，72h）：硬核 optimizer 的「攒钱等里程碑」值多少");
    console.log("| 策略 | 72h 累计收入 | 72h 挂机率 | 相对「有闲钱就买」 |");
    console.log("|---|---|---|---|");
    const strategies: { name: string; cfg: HardConfig }[] = [
      { name: "有闲钱就买（贪心 ROI）", cfg: base({ hours: 72, cps: 0 }) },
      { name: "攒钱 3600s 窗口", cfg: base({ hours: 72, cps: 0, saveWatchSeconds: 3600 }) },
      { name: "只买全局最优（ratio=1）", cfg: base({ hours: 72, cps: 0, roiRatio: 1 }) },
      { name: "ROI 门槛 0.6（近最优基线）", cfg: base({ hours: 72, cps: 0, roiRatio: 0.6 }) },
    ];
    let greedyTotal = 0;
    const s1: Record<string, unknown>[] = [];
    for (const c of strategies) {
      const sim = runSim(c.cfg);
      const s = sim.snapshots[sim.snapshots.length - 1]!;
      if (!greedyTotal) greedyTotal = s.totalEarned;
      console.log(`| ${c.name} | ${formatMoyu(s.totalEarned)} | ${formatMoyu(s.idleRate)}/s | ${((s.totalEarned / greedyTotal) * 100).toFixed(1)}% |`);
      s1.push({ name: c.name, totalEarned: s.totalEarned, idleRate: s.idleRate, levels: s.levels });
    }

    console.log("\n### B2. 点击意愿敏感度（同一近最优策略 roiRatio=0.6，72h）");
    console.log("| 持续 cps | 72h 累计收入 | 相对纯挂机 | 图鉴 | 点击线等级合计 | 备注 |");
    console.log("|---|---|---|---|---|---|");
    const cpsList = [0, 0.2, 1, 3];
    let zero = 0;
    const s2: Record<string, unknown>[] = [];
    for (const cps of cpsList) {
      const sim = runSim(base({ hours: 72, cps, dt: 0.5, roiRatio: 0.6 }));
      const s = sim.snapshots[sim.snapshots.length - 1]!;
      if (!zero) zero = s.totalEarned;
      const clickLevels = (s.levels["coffee"] ?? 0) + (s.levels["water"] ?? 0) + (s.levels["chair"] ?? 0);
      const note = cps === 0 ? "纯挂机" : cps === 0.2 ? "5.18 万次点击/72h（可做到）" : cps === 1 ? "25.9 万次（不现实）" : "77.8 万次（不可能）";
      console.log(`| ${cps} | ${formatMoyu(s.totalEarned)} | ${((s.totalEarned / zero) * 100).toFixed(1)}% | ${s.collection}/55 | ${clickLevels} | ${note} |`);
      s2.push({ cps, totalEarned: s.totalEarned, collection: s.collection, clickLevels, clicks: sim.totalClicks });
    }
    writeFileSync(OUT.replace(".json", "-sensitivity.json"), JSON.stringify({ strategies: s1, click: s2 }, null, 2));
    expect(s1.length).toBe(4);
    expect(s2.length).toBe(4);
  });

  it("图鉴 55/55 达成条件：点击线靠累计点击数（2 万）+ 挂机线 Lv50", () => {
    // 挂机老玩家会为了「图鉴 55/55 → 挂机 ×1.2」专门补点击：用低 cps 触发点击线彩蛋
    const sim = runSim(base({ hours: 48, cps: 0.2, dt: 0.5, roiRatio: 0.6, snapshotHours: [3, 6, 9, 12, 18, 24, 36] }));
    console.log("\n### D. 图鉴 55/55 达成节奏（cps=0.2：72h 内共 5.18 万次普通点击）");
    console.log("| 时点 | 图鉴 | 语录 | 挂机线彩蛋 | 点击线彩蛋 | 普通点击数 | 挂机率 |");
    console.log("|---|---|---|---|---|---|---|");
    const CLICK_TIERS = [100, 500, 3000, 8000, 20000]; // collection.ts CLICK_TIER_THRESHOLDS
    for (const s of sim.snapshots) {
      const tiers = CLICK_TIERS.filter((th) => s.totalClicks >= th).length;
      const clickF = tiers * 3; // 3 个点击项共享同一组点击门槛
      const idleF = s.flavors - clickF;
      console.log(`| ${s.hours}h | ${s.collection}/55 | ${s.quotes}/10 | ${idleF}/30 | ${clickF}/15 | ${s.totalClicks} | ${formatMoyu(s.idleRate)}/s |`);
    }
    console.log("点击线彩蛋门槛：100 / 500 / 3000 / 8000 / 20000 次普通点击（3 项共 15 格）；挂机线为等级 Lv1/5/10/20/50。");
    console.log("=> 55/55 需要「2 万次普通点击 + 6 项挂机线各 Lv50」；纯挂机 0 点击永远停在 40/55，拿不到 ×1.2。");
    // 纯挂机对照
    const pure = runSim(base({ hours: 72, cps: 0, dt: 0.5, roiRatio: 0.6 }));
    const ps = pure.snapshots[pure.snapshots.length - 1]!;
    console.log(`纯挂机 72h 图鉴上限：${ps.collection}/55（语录 ${ps.quotes}/10，点击线彩蛋 0/15），点击次数 ${ps.totalClicks}`);
    expect(ps.collection).toBe(40);
    expect(ps.totalClicks).toBe(0);
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
    expect(rank7AtHours).not.toBeNull();
    expect(rank7AtHours!).toBeGreaterThan(100);
  });
});
