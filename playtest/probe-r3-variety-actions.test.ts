import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { initialState, gain } from "../src/engine/state";
import { doClick, buyUpgrade, clickPowerOf } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { effectOf, UPGRADES, costOf, valueScoreOf } from "../src/engine/upgrades";
import { flavorFor } from "../src/engine/flavor";
import {
  newEventState,
  scheduleEvents,
  onBossTap,
  onMemeTap,
  bossSurviveReward,
} from "../src/engine/events";
import { MEME_QUOTES, CLICK_MEMES, UPGRADE_FLAVOR } from "../src/engine/flavor";

/**
 * 探针 R3-variety #1：动作多样性与新鲜度曲线（多玩法党视角）
 * - 每 5 分钟桶：有意义动作种类与频次（点击/购买/躲巡逻成功/被抓/点梗）
 * - 新内容解锁节奏：首购 / 彩蛋档位解锁 / 语录首见（轮转 & 随机有放回两种口径）
 * - 事件经济占比：巡逻+丢梗奖励 / 总收入
 */

interface Persona {
  name: string;
  tapsPerSecond: (t: number) => number;
  buyEverySeconds: number;
  pick: "cheapest" | "dearest" | "value";
  dodgeBoss: boolean;
  tapsMemes: boolean;
}

const PERSONAS: Persona[] = [
  { name: "variety(多玩法党)", tapsPerSecond: (t) => (t < 180 ? 3 : t < 600 ? 1.5 : 2), buyEverySeconds: 15, pick: "value", dodgeBoss: true, tapsMemes: true },
  { name: "clicker(狂点党)", tapsPerSecond: () => 3, buyEverySeconds: 5, pick: "cheapest", dodgeBoss: true, tapsMemes: true },
  { name: "casual(休闲党)", tapsPerSecond: () => 1, buyEverySeconds: 30, pick: "cheapest", dodgeBoss: true, tapsMemes: true },
];

const DT = 0.25;
const MINUTES = 30;
const BUCKET = 300; // 5 分钟桶

function mkRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shannon(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return -counts.filter((c) => c > 0).reduce((acc, c) => {
    const p = c / total;
    return acc + p * Math.log2(p);
  }, 0);
}

function simulate(p: Persona, quoteMode: "cycle" | "random", seed: number) {
  let state = initialState();
  const es = newEventState();
  const rng = mkRng(seed);
  const quoteRng = mkRng(seed ^ 0x5f3759df);
  const quoteSeen = new Set<string>();
  let memeEvents = 0;

  const buckets = Array.from({ length: MINUTES * 60 / BUCKET }, (_, i) => ({
    bucket: i,
    minuteRange: [i * 5, (i + 1) * 5] as [number, number],
    clicks: 0, buys: 0, dodgeWins: 0, caught: 0, memeTaps: 0, bossWindows: 0,
    newUnlocks: 0, // 本桶新内容事件数
  }));

  const firstPurchase = new Map<string, number>();
  const flavorTierSeen = new Set<string>(); // id:tier
  const noveltyTimeline: { t: number; kind: string; detail: string }[] = [];
  let bossRewards = 0;
  let memeEarnings = 0;
  let tapCredit = 0;
  let lastBuyAt = -1e9;
  let prevBossActive = false;
  let prevMemeActive = false;

  for (let t = 0; t <= MINUTES * 60; t += DT) {
    const bi = Math.min(buckets.length - 1, Math.floor(t / BUCKET));
    const b = buckets[bi];
    scheduleEvents(es, t, rng);
    const bossActive = es.bossUntil > t;
    const effectiveTaps = bossActive && p.dodgeBoss ? 0 : p.tapsPerSecond(t);
    tapCredit += effectiveTaps * DT;
    while (tapCredit >= 1) {
      tapCredit -= 1;
      if (bossActive) {
        const r = onBossTap(state, es, t);
        state = r.state;
        if (r.caught) { b.caught++; }
      } else {
        state = doClick(state);
        b.clicks++;
      }
    }
    const memeActive = es.memeUntil > t;
    if (memeActive && !prevMemeActive) {
      b.bossWindows; // noop
      memeEvents++;
      // 语录首见
      const quote = quoteMode === "cycle"
        ? MEME_QUOTES[(memeEvents - 1) % MEME_QUOTES.length]
        : MEME_QUOTES[Math.floor(quoteRng() * MEME_QUOTES.length)];
      if (!quoteSeen.has(quote)) {
        quoteSeen.add(quote);
        b.newUnlocks++;
        noveltyTimeline.push({ t: +(t / 60).toFixed(2), kind: "quote", detail: quote });
      }
    }
    if (p.tapsMemes && memeActive && !prevMemeActive) {
      const r = onMemeTap(state, es);
      state = r.state;
      memeEarnings += r.earned;
      b.memeTaps++;
    }
    prevMemeActive = memeActive;
    if (prevBossActive && !bossActive) {
      if (!es.bossCaught) {
        const reward = bossSurviveReward(state, es);
        state = gain(state, reward);
        bossRewards += reward;
        b.dodgeWins++;
      }
    }
    if (!prevBossActive && bossActive) b.bossWindows++;
    prevBossActive = bossActive;
    state = advance(state, DT);

    if (t - lastBuyAt >= p.buyEverySeconds) {
      const affordable = UPGRADES.filter((u) => state.moyu >= costOf(u.id, state.levels[u.id] ?? 0));
      if (affordable.length > 0) {
        let target: string | null = null;
        if (p.pick === "cheapest") {
          target = affordable.sort((a, c) => costOf(a.id, state.levels[a.id] ?? 0) - costOf(c.id, state.levels[c.id] ?? 0))[0].id;
        } else if (p.pick === "dearest") {
          target = affordable.sort((a, c) => costOf(c.id, state.levels[c.id] ?? 0) - costOf(a.id, state.levels[a.id] ?? 0))[0].id;
        } else {
          // 性价比贪心：挂机向与点击向合并分数（各维度归一到每万块边际）
          target = affordable.sort((a, c) => {
            const sa = valueScoreOf(a.id, state.levels[a.id] ?? 0);
            const sc = valueScoreOf(c.id, state.levels[c.id] ?? 0);
            const va = Math.max(sa.idle, sa.click * 0.5); // 点击力按 0.5 权重折算（点击党手动折损）
            const vc = Math.max(sc.idle, sc.click * 0.5);
            return vc - va;
          })[0].id;
        }
        const before = state.levels[target] ?? 0;
        const next = buyUpgrade(state, target);
        if (next) {
          state = next;
          b.buys++;
          lastBuyAt = t;
          if (!firstPurchase.has(target)) {
            firstPurchase.set(target, t);
            b.newUnlocks++;
            noveltyTimeline.push({ t: +(t / 60).toFixed(2), kind: "firstBuy", detail: target });
          }
          const beforeTier = flavorFor(target, before);
          const afterTier = flavorFor(target, before + 1);
          if (afterTier && afterTier !== beforeTier) {
            const tier = [1, 5, 10, 20, 50].filter((x) => x <= before + 1).pop()!;
            const key = `${target}:${tier}`;
            if (!flavorTierSeen.has(key)) {
              flavorTierSeen.add(key);
              b.newUnlocks++;
              noveltyTimeline.push({ t: +(t / 60).toFixed(2), kind: "flavor", detail: key });
            }
          }
        }
      }
    }
  }

  // 桶级派生指标
  const rows = buckets.map((b) => {
    const cats = [b.clicks, b.buys, b.dodgeWins, b.caught, b.memeTaps].filter((x) => x > 0).length;
    // 排除海量点击后的"事件层"熵：购买/躲成功/被抓/点梗
    const eventCats = [b.buys, b.dodgeWins, b.caught, b.memeTaps];
    return {
      ...b,
      distinctActionTypes: cats,
      eventLayerEntropy: +shannon(eventCats).toFixed(3),
      nonClickActions: eventCats.reduce((a, c) => a + c, 0),
    };
  });
  const end = { moyu: state.moyu, totalEarned: state.totalEarned, idleRate: effectOf(state).idleRate, clickPower: clickPowerOf(state) };
  return {
    persona: p.name,
    quoteMode,
    rows,
    noveltyTimeline,
    end,
    economy: {
      bossRewards: Math.round(bossRewards),
      memeEarnings: Math.round(memeEarnings),
      eventShareOfTotal: +(((bossRewards + memeEarnings) / Math.max(1, state.totalEarned)) * 100).toFixed(2),
      memeEvents,
      bossWindows: rows.reduce((a, r) => a + r.bossWindows, 0),
    },
  };
}

describe("R3 variety #1 动作多样性 + 新鲜度曲线", () => {
  it("30 分钟 × 3 画像 × 2 语录口径", () => {
    const results = [...PERSONAS.flatMap((p) => [simulate(p, "cycle", 12345), simulate(p, "random", 12345)])];
    // 新鲜度拐点：首个 newUnlocks==0 且之后不再出现新内容的桶
    const curves = results.map((r) => {
      const lastNovelty = r.noveltyTimeline.at(-1)?.t ?? 0;
      const firstFlat = r.rows.find((b) => b.newUnlocks === 0)?.minuteRange[0];
      return { persona: r.persona, quoteMode: r.quoteMode, lastNewContentMinute: lastNovelty, firstFlatBucketMinute: firstFlat ?? null, endTotal: Math.round(r.end.totalEarned) };
    });
    const report = {
      probe: "r3-variety-actions",
      contentPools: {
        clickMemes: CLICK_MEMES.length,
        memeQuotes: MEME_QUOTES.length,
        upgradeFlavorLines: Object.values(UPGRADE_FLAVOR).reduce((a, l) => a + l.length, 0),
      },
      curves,
      results,
    };
    writeFileSync("playtest/r3-variety-actions.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ curves, economy: results.map((r) => ({ persona: r.persona, quoteMode: r.quoteMode, ...r.economy })) }, null, 1));
  });
});
