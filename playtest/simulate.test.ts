import { describe, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { initialState } from "../src/engine/state";
import { doClick, buyUpgrade, clickPowerOf } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { effectOf, UPGRADES, costOf } from "../src/engine/upgrades";
import { serialize, restore, type SaveAdapter } from "../src/engine/save";
import { offlineEarn } from "../src/engine/offline";
import {
  newEventState,
  scheduleEvents,
  onBossTap,
  onMemeTap,
  bossSurviveReward,
} from "../src/engine/events";
import { formatMoyu } from "../src/engine/format";

/**
 * Agent 试玩模拟驱动：无视觉 agent 通过跑本文件"游玩"游戏引擎，
 * 产出 playtest/report.json（进度曲线/购买时间线/空转期/随机事件经济）。
 * 运行：npx vitest run playtest/simulate.test.ts
 */

interface Persona {
  name: string;
  tapsPerSecond: (t: number) => number;
  buyEverySeconds: number;
  buyStrategy: "cheapest" | "most_expensive";
  minutes: number;
  /** 是否躲避老板（false = 手滑被抓） */
  dodgeBoss: boolean;
  /** 是否点击丢梗奖励 */
  tapsMemes: boolean;
}

const PERSONAS: Persona[] = [
  { name: "clicker(狂点党)", tapsPerSecond: () => 3, buyEverySeconds: 5, buyStrategy: "cheapest", minutes: 180, dodgeBoss: true, tapsMemes: true },
  { name: "idle(挂机党)", tapsPerSecond: (t) => (t < 5 ? 2 : 0), buyEverySeconds: 60, buyStrategy: "cheapest", minutes: 180, dodgeBoss: true, tapsMemes: true },
  { name: "whale(爆肝党)", tapsPerSecond: (t) => (t < 1800 ? 8 : 1), buyEverySeconds: 10, buyStrategy: "most_expensive", minutes: 180, dodgeBoss: false, tapsMemes: true },
  { name: "casual(休闲党)", tapsPerSecond: () => 1, buyEverySeconds: 30, buyStrategy: "cheapest", minutes: 180, dodgeBoss: true, tapsMemes: true },
];

const DT = 0.25; // 模拟步长（秒）

function simulate(p: Persona) {
  let state = initialState();
  const es = newEventState();
  const rng = (() => {
    let s = 12345 >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  })();
  const checkpoints: unknown[] = [];
  const checkMinutes = [0, 1, 3, 10, 30, 60, 120, 180];
  let firstPurchase: number | null = null;
  let purchases = 0;
  let deadAirStart: number | null = null;
  let maxDeadAir = 0;
  let lastBuyAt = 0;
  let tapCredit = 0;
  let bossCaught = 0;
  let bossRewards = 0;
  let memeRewards = 0;
  let prevBossActive = false;
  let prevMemeActive = false;
  const timeline: { minute: number; item: string }[] = [];

  for (let t = 0; t <= p.minutes * 60; t += DT) {
    // 随机事件
    scheduleEvents(es, t, rng);
    const bossActive = es.bossUntil > t;
    // 躲避型：巡逻期不点；莽撞型：照点（每次都被扣）
    const effectiveTaps = bossActive && p.dodgeBoss ? 0 : p.tapsPerSecond(t);
    tapCredit += effectiveTaps * DT;
    while (tapCredit >= 1) {
      tapCredit -= 1;
      if (bossActive) {
        const r = onBossTap(state, es);
        state = r.state;
        if (r.caught) bossCaught++;
      } else {
        state = doClick(state);
      }
    }
    // 丢梗：tapsMemes 型玩家在梗出现的第一帧就点
    const memeActive = es.memeUntil > t;
    if (p.tapsMemes && memeActive && !prevMemeActive) {
      const r = onMemeTap(state, es);
      state = r.state;
      memeRewards += r.earned;
    }
    prevMemeActive = memeActive;
    // 巡逻结束：安然奖励
    if (prevBossActive && !bossActive && !es.bossCaught) {
      const reward = bossSurviveReward(state, es);
      state = { ...state, moyu: state.moyu + reward };
      bossRewards += reward;
    }
    prevBossActive = bossActive;
    // 被动
    state = advance(state, DT);
    // 空转检测：买不起任何升级 & 距上次购买超过 120s
    const cheapest = Math.min(...UPGRADES.map((u) => costOf(u.id, state.levels[u.id] ?? 0)));
    const canBuy = state.moyu >= cheapest;
    if (!canBuy) {
      if (deadAirStart === null) deadAirStart = t;
      maxDeadAir = Math.max(maxDeadAir, t - deadAirStart);
    } else {
      deadAirStart = null;
    }
    // 购买
    if (t - lastBuyAt >= p.buyEverySeconds && canBuy) {
      const sorted = [...UPGRADES].sort((a, b) => {
        const ca = costOf(a.id, state.levels[a.id] ?? 0);
        const cb = costOf(b.id, state.levels[b.id] ?? 0);
        return p.buyStrategy === "cheapest" ? ca - cb : cb - ca;
      });
      for (const u of sorted) {
        const next = buyUpgrade(state, u.id);
        if (next) {
          state = next;
          purchases++;
          lastBuyAt = t;
          if (firstPurchase === null) firstPurchase = t / 60;
          timeline.push({ minute: +(t / 60).toFixed(1), item: u.name });
          break;
        }
      }
    }
    // 检查点
    for (const m of checkMinutes) {
      if (Math.abs(t - m * 60) < DT / 2) {
        checkpoints.push({
          minute: m,
          moyu: +state.moyu.toFixed(1),
          moyuText: formatMoyu(state.moyu),
          clickPower: clickPowerOf(state),
          idleRate: +effectOf(state).idleRate.toFixed(2),
          levels: { ...state.levels },
        });
      }
    }
  }
  return { persona: p.name, checkpoints, firstPurchaseMinute: firstPurchase, purchases, maxDeadAirSeconds: Math.round(maxDeadAir), purchaseTimeline: timeline, bossCaughtTaps: bossCaught, bossSurviveRewards: Math.round(bossRewards), memeEarnings: Math.round(memeRewards) };
}

function simulateOffline() {
  // 离线结算全链路：存档 → 8 小时后回来 → 结算
  const store = new Map<string, string>();
  const mem: SaveAdapter = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
  let state = initialState();
  state.levels["phone" as string] = 3;
  serialize(state, mem, 0);
  const back = restore(mem, 8 * 3600 * 1000);
  const r = offlineEarn(back.state!, back.offlineSeconds);
  return { offlineSeconds: back.offlineSeconds, earned: r.earned, cappedAt: r.applied };
}

describe("agent 试玩模拟", () => {
  it("运行四类玩家画像并产出报告", () => {
    const results = PERSONAS.map(simulate);
    const report = {
      generatedAt: new Date().toISOString(),
      engine: "mvp-v1 batch1（纯放置循环，无随机事件）",
      sessions: results,
      offlineCheck: simulateOffline(),
      summary: results.map((r) => ({
        persona: r.persona,
        firstPurchaseMinute: r.firstPurchaseMinute,
        purchasesIn180min: r.purchases,
        maxDeadAirSeconds: r.maxDeadAirSeconds,
        endMoyu: r.checkpoints.at(-1),
      })),
    };
    mkdirSync("playtest", { recursive: true });
    writeFileSync("playtest/report.json", JSON.stringify(report, null, 2));
    console.log("report written to playtest/report.json");
    console.log(
      JSON.stringify(
        report.summary.map((s) => `${s.persona}: 首购 ${s.firstPurchaseMinute}min, 180min 购买 ${s.purchasesIn180min} 次, 最长空转 ${s.maxDeadAirSeconds}s`),
        null,
        1,
      ),
    );
  });
});
