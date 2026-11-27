/**
 * R7 · 新手 0→10 分钟节奏探针（只读 src/engine，不修改游戏）
 *
 * 三种新手画像（1/2/3 次点击每秒 + 每 5/4/3 秒瞄一眼商店，优先买没买过的卡），
 * 各跑 600 秒真实引擎主循环，输出每分钟余额/点击力/挂机率/卡数/段位、第一次卡住时刻，
 * 并用「10 分钟 + 4×30 分钟离线」验证/反驳前序「10 分钟即到摸鱼大师」的结论。
 *
 * 主画像 = 回应型新手（看到横幅会照做：hold 忍住、type/blitz 点满）+ 手痒型消费（闲钱砸最便宜已购卡）。
 * 敏感度：屏蔽型（不看横幅）/ 存钱型（只买新卡不升级）。
 */
import { describe, it } from "vitest";
import {
  runProfile,
  visitBack,
  buyLook,
  UPGRADES,
  costOf,
  formatMoyu,
  rankFor,
  tableRow,
  type Profile,
  type ProfileResult,
} from "./probe-r6-onb-lib";

const SEED = 7;
const PROFILES: Profile[] = [
  { name: "A 慢手：1 次/秒，每 5s 看商店", cps: 1, buyEvery: 5 },
  { name: "B 普通：2 次/秒，每 4s 看商店", cps: 2, buyEvery: 4 },
  { name: "C 快手：3 次/秒，每 3s 看商店", cps: 3, buyEvery: 3 },
];
const RANK_SHORT = ["实习", "学徒", "资深", "大师", "传说", "之神", "尽头"];

function fmtT(t: number | null | undefined): string {
  if (t === null || t === undefined) return "—";
  const m = Math.floor(t / 60);
  const s = Math.round(t % 60);
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

function report(r: ProfileResult): string {
  const L: string[] = [];
  const f = r.finalState;
  const order = new Map<string, number>();
  for (const p of r.purchases) if (p.isNew && !order.has(p.id)) order.set(p.id, p.t);
  const levels = Object.entries(f.levels)
    .filter(([, lv]) => lv > 0)
    .map(([id, lv]) => `${UPGRADES.find((u) => u.id === id)?.name ?? id} Lv.${lv}`)
    .join("、");
  L.push(`\n### ${r.profile.name}`);
  L.push("| 分钟 | 余额 | 点击力 | 挂机/秒 | 卡数 | 段位 | 本分购买 | 可买卡数 | 下一张新卡 |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const row of r.rows) L.push(tableRow(row));
  L.push("");
  L.push(
    `- 首购 ${fmtT(r.firstPurchaseAt)}｜卡数 ${Object.keys(f.levels).length}/9｜累计 ${formatMoyu(f.totalEarned)}｜段位 ${rankFor(f.totalEarned).current}｜图鉴 ${r.collection}/55｜等级：${levels}`,
  );
  L.push(
    `- 点击 ${r.clicks}｜丢梗命中 ${r.memeHits}｜巡逻 ${r.patrols} 次（变体 ${r.variants.join("/")}，安然奖励合计 ${Math.round(r.patrolReward)}）｜被逮 ${r.caught} 次（罚款 ${Math.round(r.fines)}）`,
  );
  L.push(`- 第一次巡逻 ${fmtT(r.firstPatrolAt)}｜第一次丢梗 ${fmtT(r.firstMemeAt)}｜第一次被逮 ${fmtT(r.firstCaughtAt)}｜日报 3/3 ${fmtT(r.dailyDoneAt)}`);
  L.push(`- 各卡解锁：${UPGRADES.map((u) => `${u.name}=${order.has(u.id) ? fmtT(order.get(u.id)!) : "未解锁"}`).join("｜")}`);
  L.push(`- 段位时刻：${[...r.rankAt.entries()].filter(([, t]) => t !== undefined).map(([i, t]) => `${RANK_SHORT[i]}@${fmtT(t)}`).join("｜") || "10 分钟内无升段"}`);
  const unlockGaps: string[] = [];
  for (let i = 1; i < r.unlockAt.length; i++) unlockGaps.push(fmtT(r.unlockAt[i]! - r.unlockAt[i - 1]!));
  L.push(
    `- 新卡解锁间隔：${unlockGaps.join(" / ") || "—"}｜商店一张买不起的分钟：${r.emptyShopMinutes.join(",") || "无"}｜买不起累计 ${r.sim.affordlessSeconds}s（最长连续 ${r.sim.maxAffordlessStreak}s，首次 ${fmtT(r.sim.firstAffordlessAt)}）`,
  );
  for (const s of r.stalls) L.push(`- 卡点[${s.kind}] ${fmtT(s.t)}：${s.detail}`);
  return L.join("\n");
}

describe("R7 新手 0-10 分钟节奏", () => {
  it("三种新手各跑 10 分钟：节奏表 + 第一次卡住 + 内容耗尽（seed 7）", () => {
    for (const r of PROFILES.map((p) => runProfile(p, 600, SEED))) console.log(report(r));
  });

  it("seed 敏感性：5 个种子下关键指标（验证结论不靠单个随机种子）", () => {
    const seeds = [1, 2, 3, 7, 11];
    console.log("\n### seed 敏感性（5 seeds）");
    console.log("| 画像 | 首购 | 卡数@10min | 累计@10min | 段位@10min | 首卡点 | 9/9 时刻 |");
    console.log("|---|---|---|---|---|---|---|");
    for (const p of PROFILES) {
      const rs = seeds.map((s) => runProfile(p, 600, s));
      const cards = rs.map((r) => Object.keys(r.finalState.levels).length);
      const totals = rs.map((r) => r.finalState.totalEarned);
      const ranks = new Set(rs.map((r) => rankFor(r.finalState.totalEarned).current));
      const firsts = rs.map((r) => r.firstPurchaseAt ?? NaN);
      const stalls = rs.map((r) => r.firstStall?.t ?? null);
      const ex = rs.map((r) => r.exhaustionAt);
      const med = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
      const rng = (a: number[]): string => `${Math.min(...a).toFixed(0)}~${Math.max(...a).toFixed(0)}`;
      console.log(
        `| ${p.name.split("：")[0]} | ${rng(firsts)}s | ${cards.join("/")} | ${formatMoyu(Math.min(...totals))}~${formatMoyu(Math.max(...totals))}（中位 ${formatMoyu(med(totals))}） | ${[...ranks].join("、")} | ${stalls.map((t) => (t === null ? "—" : fmtT(t))).join(" ")} | ${ex.map((t) => (t === null ? "—" : fmtT(t))).join(" ")} |`,
      );
    }
  });

  it("行为敏感度：屏蔽型（不看横幅）vs 存钱型（只买新卡不升级）", () => {
    console.log("\n### 屏蔽型新手（不看横幅，hold 巡逻继续点）");
    console.log("| 画像 | 卡数 | 累计 | 段位 | 被逮次数 | 罚款 | 巡逻奖励 | 日报3/3 |");
    console.log("|---|---|---|---|---|---|---|---|");
    for (const p of PROFILES) {
      const r = runProfile({ ...p, dodgeHold: false }, 600, SEED);
      const f = r.finalState;
      console.log(
        `| ${p.name.split("：")[0]} | ${Object.keys(f.levels).length}/9 | ${formatMoyu(f.totalEarned)} | ${rankFor(f.totalEarned).current} | ${r.caught} | ${Math.round(r.fines)} | ${Math.round(r.patrolReward)} | ${fmtT(r.dailyDoneAt)} |`,
      );
    }
    console.log("\n### 存钱型新手（只买新卡，闲钱不升级）");
    console.log("| 画像 | 卡数 | 累计 | 段位 | 点击力 | 挂机 | 首购 | 日报3/3 | 9/9 |");
    console.log("|---|---|---|---|---|---|---|---|---|");
    for (const p of PROFILES) {
      const r = runProfile({ ...p, spendLevels: false }, 600, SEED);
      const f = r.finalState;
      const last = r.rows[r.rows.length - 1]!;
      console.log(
        `| ${p.name.split("：")[0]} | ${Object.keys(f.levels).length}/9 | ${formatMoyu(f.totalEarned)} | ${rankFor(f.totalEarned).current} | ${last.clickPower} | ${formatMoyu(last.idleRate)}/s | ${fmtT(r.firstPurchaseAt)} | ${fmtT(r.dailyDoneAt)} | ${r.exhaustionAt === null ? "—" : fmtT(r.exhaustionAt)} |`,
      );
    }
  });
});

describe("R7 纯挂机新手（从不点屏幕，只看数字）", () => {
  it("0 次/秒的新手：底薪 0.2/s 能不能自己滚起来", () => {
    const r = runProfile({ name: "D 纯挂机：0 次/秒，每 5s 看商店", cps: 0, buyEvery: 5 }, 600, SEED);
    console.log(report(r));
  });
});

describe("R7 离线验证：10 分钟 + 4×30 分钟离线是否直达摸鱼大师 / 9 卡", () => {
  it("三种新手：10 分钟有效游玩 + 4 次 30 分钟离线回访（回访即买）", () => {
    for (const p of PROFILES) {
      const r = runProfile(p, 600, SEED);
      const sim = r.sim;
      const lines: string[] = [`\n### ${p.name}`];
      const f0 = sim.state;
      lines.push(`- 游玩 10 分钟：卡数 ${Object.keys(f0.levels).length}/9｜累计 ${formatMoyu(f0.totalEarned)}｜段位 ${rankFor(f0.totalEarned).current}`);
      for (let k = 1; k <= 4; k++) {
        const v = visitBack(sim, 1800);
        let bought = 0;
        for (let guard = 0; guard < 500; guard++) {
          if (!buyLook(sim, true)) break;
          bought++;
        }
        const f = sim.state;
        const remaining = UPGRADES.filter((u) => (f.levels[u.id] ?? 0) === 0).map(
          (u) => `${u.name}(${formatMoyu(costOf(u.id, f.levels[u.id] ?? 0))})`,
        );
        lines.push(
          `- 第 ${k} 次离线 30 分钟：+${formatMoyu(v.earnings)}（效率 ${Math.round(v.rate * 100)}%）→ 卡数 ${Object.keys(f.levels).length}/9｜累计 ${formatMoyu(f.totalEarned)}｜段位 ${rankFor(f.totalEarned).current}｜本次买 ${bought} 次｜未解锁 ${remaining.join("、") || "无"}`,
        );
      }
      console.log(lines.join("\n"));
    }
  });
});
