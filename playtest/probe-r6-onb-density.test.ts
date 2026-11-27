/**
 * R7 · 新手 10 分钟「新内容密度」诊断（只读 src/engine）
 *  - 每分钟「累计摸鱼值」（定段位阈值用）
 *  - 每分钟「解锁了什么新东西」：新卡 / 图鉴彩蛋（Lv.1/5/10/20/50）/ 段位 / 丢梗语录 / 巡逻
 * 用于回答：第一次「没新内容」的分钟、以及 5-10 分钟尾巴里到底还有多少东西可看。
 */
import { describe, it } from "vitest";
import { runProfile, UPGRADES, formatMoyu, rankFor, type Profile } from "./probe-r6-onb-lib";

const SEED = 7;
const PROFILES: Profile[] = [
  { name: "A 1cps", cps: 1, buyEvery: 5 },
  { name: "B 2cps", cps: 2, buyEvery: 4 },
  { name: "C 3cps", cps: 3, buyEvery: 3 },
];
const TIERS = [1, 5, 10, 20, 50];

function tierCrossed(before: number, after: number): number {
  return TIERS.filter((t) => before < t && after >= t).length;
}

describe("R7 新内容密度", () => {
  it("每分钟累计摸鱼值（定段位阈值）", () => {
    const rs = PROFILES.map((p) => runProfile(p, 600, SEED));
    console.log("| 分钟 | A 累计 | B 累计 | C 累计 |");
    console.log("|---|---|---|---|");
    for (let m = 0; m <= 10; m++) {
      const cells = rs.map((r) => formatMoyu(r.rows[m]?.totalEarned ?? 0));
      console.log(`| ${m} | ${cells.join(" | ")} |`);
    }
  });

  it("B（2cps）每个 30 秒获得了什么新东西", () => {
    const r = runProfile(PROFILES[1]!, 600, SEED);
    // 从购买推导图鉴彩蛋
    const flavorAt: { t: number; text: string }[] = [];
    for (const p of r.purchases) {
      const n = tierCrossed(p.lvAfter - 1, p.lvAfter);
      for (let i = 0; i < n; i++) flavorAt.push({ t: p.t, text: `彩蛋「${p.name}」+1` });
    }
    const all = [
      ...r.events.map((e) => ({ t: e.t, text: e.text })),
      ...flavorAt,
    ].sort((a, b) => a.t - b.t);
    console.log("| 时间 | 新内容事件 |");
    console.log("|---|---|");
    let bucket = 0;
    let acc: string[] = [];
    const flush = (upto: number) => {
      if (acc.length === 0) {
        console.log(`| ${bucket}~${upto}s | —— 什么都没有 —— |`);
      } else {
        console.log(`| ${bucket}~${upto}s | ${acc.join("；")} |`);
      }
      acc = [];
      bucket = upto;
    };
    for (const e of all) {
      while (e.t >= bucket + 30) flush(bucket + 30);
      acc.push(`${Math.round(e.t)}s ${e.text}`);
    }
    while (bucket < 600) flush(bucket + 30);
    console.log(`\n图鉴 ${r.collection}/55｜卡 ${Object.keys(r.finalState.levels).length}/9｜段位 ${rankFor(r.finalState.totalEarned).current}`);
    console.log(`巡逻 ${r.patrols} 次（变体 ${r.variants.join("/")}）｜丢梗 ${r.memeHits} 次｜日报 3/3 @${(r.dailyDoneAt ?? 0).toFixed(0)}s`);
    console.log(`各卡解锁：${UPGRADES.map((u) => {
      const p = r.purchases.find((x) => x.id === u.id);
      return `${u.name}=${p ? `${p.t.toFixed(0)}s` : "—"}`;
    }).join(" / ")}`);
  });
});
