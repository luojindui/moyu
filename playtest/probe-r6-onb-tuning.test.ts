/**
 * R7 · 新手节奏「放缓」数值方案 A/B 探针（只在内存里改 UPGRADES/RANKS 数组做对照，不修改 src/）
 *
 * 对照 3 套方案 × 3 种新手画像 × 10 分钟主循环：
 *  - 基线：HEAD a786a53 现状
 *  - 方案1「温和」：抬高第 2~9 张卡价 + 抬段位阈值（首卡 15 不变，保首次购买 ≤15s）
 *  - 方案2「克制」：更贵的中段卡 + 更高段位（把 9/9 与「大师」推到第二/第三天）
 * 另外用「只抬段位」方案隔离变量：段位阈值单独改能否让长线变长。
 * 每个方案再跑「10 分钟 + 4×30 分钟离线回访」，看长线内容消耗速度。
 */
import { describe, it } from "vitest";
import { runProfile, buyLook, visitBack, UPGRADES, formatMoyu, rankFor, type Profile, type ProfileResult } from "./probe-r6-onb-lib";
import { RANKS } from "../src/engine/titles";

const SEED = 7;
const PROFILES: Profile[] = [
  { name: "A", cps: 1, buyEvery: 5 },
  { name: "B", cps: 2, buyEvery: 4 },
  { name: "C", cps: 3, buyEvery: 3 },
];
const ORIG_UPGRADES = UPGRADES.map((u) => ({ ...u }));
const COST_ORIG = UPGRADES.map((u) => u.baseCost);
const RANK_ORIG = RANKS.map((r) => r.at);

type NewCard = { id: string; name: string; desc: string; baseCost: number; idleRate?: number; clickPower?: number };
type Scheme = { name: string; costs?: number[]; ranks?: number[]; newCards?: NewCard[] };

const SCHEMES: Scheme[] = [
  { name: "基线（现状）" },
  {
    name: "方案1 温和",
    costs: [15, 250, 1800, 120, 1500, 9000, 60_000, 350_000, 2_500_000],
    ranks: [0, 25_000, 350_000, 6_000_000, 300_000_000, 3_000_000_000, 15_000_000_000],
  },
  {
    name: "方案2 克制",
    costs: [15, 300, 2500, 100, 2200, 14_000, 100_000, 600_000, 5_000_000],
    ranks: [0, 25_000, 500_000, 10_000_000, 500_000_000, 5_000_000_000, 30_000_000_000],
  },
  {
    name: "方案3 只抬段位",
    ranks: [0, 25_000, 500_000, 10_000_000, 500_000_000, 5_000_000_000, 30_000_000_000],
  },
  {
    // 重排卡价：早期略降、中段微调、后期大幅上移，让 10 分钟内每分钟都有新卡、9/9 留给第二天
    name: "方案4 卡价重排+段位后移",
    costs: [15, 120, 1200, 60, 800, 3500, 15_000, 300_000, 3_000_000],
    ranks: [0, 25_000, 500_000, 10_000_000, 500_000_000, 5_000_000_000, 30_000_000_000],
  },
  {
    // 方案6：1~6 号卡价完全不动（10 分钟节奏不变），只把第 7~9 张卡与段位后移
    name: "方案6 只动后 3 张卡+段位",
    costs: [15, 100, 800, 50, 600, 4000, 40_000, 1_000_000, 10_000_000],
    ranks: [0, 10_000, 500_000, 20_000_000, 500_000_000, 5_000_000_000, 30_000_000_000],
  },
  {
    // 方案8（最终推荐，最小改动）：前 7 张卡价与首会话完全不动，只把第 8/9 张卡上移 + 段位后移
    name: "方案8 只动深度/躺平+段位",
    costs: [15, 100, 800, 50, 600, 4000, 25_000, 600_000, 3_000_000],
    ranks: [0, 10_000, 500_000, 20_000_000, 500_000_000, 5_000_000_000, 30_000_000_000],
  },
  {
    // 方案7（对照）：后 3 张卡 4万/60万/300万，段位 1万/50万/2000万/5亿/50亿/300亿
    name: "方案7 推荐落地值",
    costs: [15, 100, 800, 50, 600, 4000, 40_000, 600_000, 3_000_000],
    ranks: [0, 10_000, 500_000, 20_000_000, 500_000_000, 5_000_000_000, 30_000_000_000],
  },
  {
    // 方案5：补 3 档卡把 10 分钟尾巴填上（12 档价格梯），后期卡价上移，段位后移
    name: "方案5 补 3 档卡+段位后移",
    newCards: [
      { id: "kettle", name: "带薪泡茶", desc: "挂机 +2/秒", baseCost: 300, idleRate: 2 },
      { id: "nap", name: "带薪午休", desc: "挂机 +25/秒", baseCost: 9000, idleRate: 25 },
      { id: "remote", name: "居家办公", desc: "挂机 +120/秒", baseCost: 70_000, idleRate: 120 },
    ],
    costs: [15, 120, 1200, 60, 800, 3500, 15_000, 500_000, 4_000_000, 300, 9000, 70_000],
    ranks: [0, 25_000, 500_000, 10_000_000, 500_000_000, 5_000_000_000, 30_000_000_000],
  },
];

function apply(s: Scheme): void {
  UPGRADES.length = 0;
  for (const u of ORIG_UPGRADES) UPGRADES.push({ ...u });
  if (s.newCards) UPGRADES.push(...s.newCards.map((u) => ({ ...u })));
  UPGRADES.forEach((u, i) => (u.baseCost = s.costs?.[i] ?? COST_ORIG[i] ?? u.baseCost));
  RANKS.forEach((r, i) => (r.at = s.ranks?.[i] ?? RANK_ORIG[i]!));
}

function byName(prefix: string): Scheme {
  const s = SCHEMES.find((x) => x.name.startsWith(prefix));
  if (!s) throw new Error(`no scheme ${prefix}`);
  return s;
}

function fmtT(t: number | null | undefined): string {
  if (t === null || t === undefined) return "—";
  const m = Math.floor(t / 60);
  const s = Math.round(t % 60);
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

function cardTimes(r: ProfileResult): string {
  const order = new Map<string, number>();
  for (const p of r.purchases) if (p.isNew && !order.has(p.id)) order.set(p.id, p.t);
  return UPGRADES.map((u) => (order.has(u.id) ? fmtT(order.get(u.id)!) : "—")).join(" / ");
}

describe("R7 放缓方案对照：10 分钟节奏 + 长线（4×30min 离线）", () => {
  it("三套数值方案的 10 分钟节奏", () => {
    for (const scheme of SCHEMES) {
      apply(scheme);
      console.log(`\n### ${scheme.name}｜卡价 ${UPGRADES.map((u) => formatMoyu(u.baseCost)).join("/")}｜段位 ${RANKS.map((r) => formatMoyu(r.at)).join("/")}`);
      console.log("| 画像 | 首购 | 各卡首解锁时刻（咖啡/喝水/椅/手机/蹲坑/群聊/会议/深度/躺平） |");
      console.log("|---|---|---|");
      const rows: { p: Profile; r: ProfileResult }[] = [];
      for (const p of PROFILES) {
        const r = runProfile(p, 600, SEED);
        rows.push({ p, r });
        console.log(`| ${p.name} | ${fmtT(r.firstPurchaseAt)} | ${cardTimes(r)} |`);
      }
      console.log("| 画像 | 卡数@10m | 累计@10m | 段位@10m | 第一次没新卡 | 商店买不起累计 |");
      console.log("|---|---|---|---|---|---|");
      for (const { p, r } of rows) {
        const noNew = r.stalls.find((s) => s.kind === "没有新卡");
        console.log(
          `| ${p.name} | ${Object.keys(r.finalState.levels).length}/9 | ${formatMoyu(r.finalState.totalEarned)} | ${rankFor(r.finalState.totalEarned).current} | ${noNew ? fmtT(noNew.t) : "—"} | ${r.sim.affordlessSeconds}s |`,
        );
      }
    }
    apply({ name: "restore" });
  });

  it("方案2 的长线：10 分钟 + 4×30 分钟离线回访（回访即买）", () => {
    apply(byName("方案2"));
    for (const p of PROFILES) {
      const r = runProfile(p, 600, SEED);
      const sim = r.sim;
      const out: string[] = [`\n### 方案2 · ${p.name}`];
      for (let k = 1; k <= 4; k++) {
        const v = visitBack(sim, 1800);
        let bought = 0;
        for (let guard = 0; guard < 800; guard++) {
          if (!buyLook(sim, true)) break;
          bought++;
        }
        const f = sim.state;
        out.push(
          `- 离线 ${k}：+${formatMoyu(v.earnings)} → 卡数 ${Object.keys(f.levels).length}/9｜累计 ${formatMoyu(f.totalEarned)}｜段位 ${rankFor(f.totalEarned).current}｜买 ${bought}`,
        );
      }
      console.log(out.join("\n"));
    }
    apply({ name: "restore" });
  });

  it("方案3 的长线：只抬段位（卡价不变）", () => {
    apply(byName("方案3"));
    for (const p of PROFILES) {
      const r = runProfile(p, 600, SEED);
      const sim = r.sim;
      const out: string[] = [`\n### 方案3 · ${p.name}`];
      for (let k = 1; k <= 4; k++) {
        const v = visitBack(sim, 1800);
        buyLoop(sim);
        const f = sim.state;
        out.push(
          `- 离线 ${k}：+${formatMoyu(v.earnings)} → 卡数 ${Object.keys(f.levels).length}/9｜累计 ${formatMoyu(f.totalEarned)}｜段位 ${rankFor(f.totalEarned).current}`,
        );
      }
      console.log(out.join("\n"));
    }
    apply({ name: "restore" });
  });
});

describe("方案4 长线", () => {
  it("方案4：10 分钟 + 4×30 分钟离线", () => {
    apply(byName("方案4"));
    for (const p of PROFILES) {
      const r = runProfile(p, 600, SEED);
      const sim = r.sim;
      const out: string[] = [`\n### 方案4 · ${p.name}`];
      for (let k = 1; k <= 4; k++) {
        const v = visitBack(sim, 1800);
        buyLoop(sim);
        const f = sim.state;
        out.push(
          `- 离线 ${k}：+${formatMoyu(v.earnings)} → 卡数 ${Object.keys(f.levels).length}/9｜累计 ${formatMoyu(f.totalEarned)}｜段位 ${rankFor(f.totalEarned).current}`,
        );
      }
      console.log(out.join("\n"));
    }
    apply({ name: "restore" });
  });
});

describe("方案6 长线", () => {
  it("方案6：10 分钟 + 8×30 分钟离线（看 9/9 与大师从第几次回访开始）", () => {
    apply(byName("方案6"));
    for (const p of PROFILES) {
      const r = runProfile(p, 600, SEED);
      const sim = r.sim;
      const out: string[] = [`\n### 方案6 · ${p.name}（10 分钟：卡 ${Object.keys(sim.state.levels).length}/9｜累计 ${formatMoyu(sim.state.totalEarned)}｜${rankFor(sim.state.totalEarned).current}）`];
      for (let k = 1; k <= 8; k++) {
        const v = visitBack(sim, 1800);
        buyLoop(sim);
        const f = sim.state;
        out.push(
          `- 回访 ${k}（${(k * 0.5).toFixed(1)}h）：+${formatMoyu(v.earnings)} → 卡 ${Object.keys(f.levels).length}/9｜累计 ${formatMoyu(f.totalEarned)}｜${rankFor(f.totalEarned).current}`,
        );
      }
      console.log(out.join("\n"));
    }
    apply({ name: "restore" });
  });
});

describe("方案8 长线", () => {
  it("方案8：10 分钟（应与基线完全一致）+ 8×30 分钟离线", () => {
    apply(byName("方案8"));
    for (const p of PROFILES) {
      const r = runProfile(p, 600, SEED);
      const sim = r.sim;
      const order = new Map<string, number>();
      for (const q of r.purchases) if (q.isNew && !order.has(q.id)) order.set(q.id, q.t);
      const out: string[] = [
        `\n### 方案8 · ${p.name}（10 分钟：卡 ${Object.keys(sim.state.levels).length}/9｜累计 ${formatMoyu(sim.state.totalEarned)}｜${rankFor(sim.state.totalEarned).current}｜解锁 ${UPGRADES.map((u) => (order.has(u.id) ? `${Math.round(order.get(u.id)!)}s` : "—")).join("/")}）`,
      ];
      for (let k = 1; k <= 8; k++) {
        const v = visitBack(sim, 1800);
        buyLoop(sim);
        const f = sim.state;
        out.push(`- 回访 ${k}（${(k * 0.5).toFixed(1)}h）：+${formatMoyu(v.earnings)} → 卡 ${Object.keys(f.levels).length}/9｜累计 ${formatMoyu(f.totalEarned)}｜${rankFor(f.totalEarned).current}`);
      }
      console.log(out.join("\n"));
    }
    apply({ name: "restore" });
  });
});

describe("方案7 长线", () => {
  it("方案7：10 分钟 + 8×30 分钟离线", () => {
    apply(byName("方案7"));
    for (const p of PROFILES) {
      const r = runProfile(p, 600, SEED);
      const sim = r.sim;
      const out: string[] = [
        `\n### 方案7 · ${p.name}（10 分钟：卡 ${Object.keys(sim.state.levels).length}/9｜累计 ${formatMoyu(sim.state.totalEarned)}｜${rankFor(sim.state.totalEarned).current}）`,
      ];
      for (let k = 1; k <= 8; k++) {
        const v = visitBack(sim, 1800);
        buyLoop(sim);
        const f = sim.state;
        out.push(
          `- 回访 ${k}（${(k * 0.5).toFixed(1)}h）：+${formatMoyu(v.earnings)} → 卡 ${Object.keys(f.levels).length}/9｜累计 ${formatMoyu(f.totalEarned)}｜${rankFor(f.totalEarned).current}`,
        );
      }
      console.log(out.join("\n"));
    }
    apply({ name: "restore" });
  });
});

describe("方案5 长线", () => {
  it("方案5：10 分钟 + 4×30 分钟离线", () => {
    apply(byName("方案5"));
    for (const p of PROFILES) {
      const r = runProfile(p, 600, SEED);
      const sim = r.sim;
      const out: string[] = [`\n### 方案5 · ${p.name}`];
      out.push(`- 10 分钟：卡数 ${Object.keys(sim.state.levels).length}/${UPGRADES.length}｜累计 ${formatMoyu(sim.state.totalEarned)}`);
      for (let k = 1; k <= 4; k++) {
        const v = visitBack(sim, 1800);
        buyLoop(sim);
        const f = sim.state;
        out.push(
          `- 离线 ${k}：+${formatMoyu(v.earnings)} → 卡数 ${Object.keys(f.levels).length}/${UPGRADES.length}｜累计 ${formatMoyu(f.totalEarned)}｜段位 ${rankFor(f.totalEarned).current}`,
        );
      }
      console.log(out.join("\n"));
    }
    apply({ name: "restore" });
  });
});

function buyLoop(sim: Parameters<typeof buyLook>[0]): void {
  for (let guard = 0; guard < 800; guard++) if (!buyLook(sim, true)) return;
}
