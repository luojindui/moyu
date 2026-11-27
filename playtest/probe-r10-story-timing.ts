/**
 * R10 剧情/角色党：叙事触点的时间价值探针（只读 src/，不改 src/）
 * 运行：node_modules/.bin/vite-node playtest/probe-r10-story-timing.ts
 *
 * 目的：给"第几天解锁第几章 / 每章几次会话能碰到"找真实节奏。
 * ① 首会话（休闲 1cps，30s 看次商店）分钟级阈值触达
 * ② 14 天回访（复用 r6-ret-lib 的 runBot）逐日累计 → 章节解锁天数 + 内容空窗起点
 */
import { initialState, type GameState } from "../src/engine/state";
import { doClick, buyUpgrade } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { UPGRADES, costOf } from "../src/engine/upgrades";
import { newEventState, scheduleEvents, onBossTap, onMemeTap, finishPatrol } from "../src/engine/events";
import { collectQuote, syncFlavorCollection, collectionCount } from "../src/engine/collection";
import { MEME_QUOTES } from "../src/engine/flavor";
import { formatMoyu } from "../src/engine/format";
import { runBot, dayRow } from "./probe-r6-ret-lib";

const DT = 0.25;

function firstSession(minutes: number) {
  let s: GameState = initialState();
  const es = newEventState();
  let seed = 7;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const marks: { t: number; label: string }[] = [];
  const seen = new Set<string>();
  const milestones: [number, string][] = [
    [15, "买得起第一杯咖啡(15)"],
    [100, "首次 100 点击 / 喝水线"],
    [1_000, "1e3"],
    [10_000, "1e4 摸鱼学徒"],
    [100_000, "1e5 资深摸鱼"],
    [1_000_000, "1e6 摸鱼大师"],
    [10_000_000, "1e7"],
  ];
  let tapCredit = 0;
  let lastBuy = 0;
  let prevBoss = false;
  for (let t = 0; t <= minutes * 60; t += DT) {
    scheduleEvents(es, t, rng);
    const boss = es.bossUntil > t;
    tapCredit += (boss ? 0 : 1) * DT;
    while (tapCredit >= 1) {
      tapCredit -= 1;
      if (es.memeUntil > t) {
        const r = onMemeTap(s, es);
        const qi = Math.floor(rng() * MEME_QUOTES.length);
        s = collectQuote(r.state, qi).state;
      } else {
        s = doClick(s, 0);
      }
    }
    if (prevBoss && !boss) s = finishPatrol(s, es).state;
    prevBoss = boss;
    s = advance(s, DT);
    if (t - lastBuy >= 30) {
      lastBuy = t;
      const affordable = UPGRADES.filter((u) => costOf(u.id, s.levels[u.id] ?? 0) <= s.moyu).sort(
        (a, b) => costOf(a.id, s.levels[a.id] ?? 0) - costOf(b.id, s.levels[b.id] ?? 0),
      );
      if (affordable[0]) {
        const nx = buyUpgrade(s, affordable[0].id);
        if (nx) s = syncFlavorCollection(nx);
      }
    }
    for (const [at, label] of milestones) {
      if (!seen.has(label) && s.lifetimeEarned >= at) {
        seen.add(label);
        marks.push({ t, label });
      }
    }
  }
  return { s, marks };
}

console.log("===== ① 首会话（休闲党 1cps + 30s 一次商店，3 小时）=====");
const { s, marks } = firstSession(180);
for (const m of marks) {
  const mm = Math.floor(m.t / 60);
  const ss = Math.round(m.t % 60);
  console.log(`  ${String(mm).padStart(3)}m${String(ss).padStart(2, "0")}s  ${m.label}`);
}
console.log(
  `  3h 末：累计 ${formatMoyu(s.lifetimeEarned)} / 点击 ${s.totalClicks} / 升级 ${Object.keys(s.levels).length} 档 / 图鉴 ${collectionCount(s)}/55`,
);

console.log("\n===== ② 14 天回访（每天 3 次 × 3 分钟，2cps 长线玩家）=====");
const bot = runBot();
for (const d of bot.days) {
  const c = d as unknown as Record<string, unknown>;
  console.log(dayRow(d));
  console.log(
    `       累计 ${formatMoyu(d.totalEarned)} · 图鉴 ${String(c.collection)}/55 · 解锁 ${String(d.unlocked)}/9 · 段位前进 ${String(c.rankIdx)}`,
  );
}
const thresholds = [1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 2.5e9, 1e10];
console.log("\n  阈值 → 首次到达的天：");
for (const th of thresholds) {
  const day = bot.days.find((d) => d.totalEarned >= th);
  console.log(`  ${formatMoyu(th).padStart(8)} → ${day ? `D${String(day.day).padStart(2, "0")}` : "14 天内未达"}`);
}
let firstFlat: number | null = null;
for (let i = 1; i < bot.days.length; i++) {
  const prev = bot.days[i - 1]!;
  const cur = bot.days[i]!;
  const cp = prev as unknown as Record<string, unknown>;
  const cc = cur as unknown as Record<string, unknown>;
  const changed = cc.rankIdx !== cp.rankIdx || cc.collection !== cp.collection || cur.unlocked !== prev.unlocked;
  if (!changed && firstFlat === null) firstFlat = cur.day;
}
console.log(`  首次"整天无新内容"：D${firstFlat}`);
