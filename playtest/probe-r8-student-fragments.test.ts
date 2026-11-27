/**
 * R8 学生碎片党探针：模拟「1 天 5 次 ×3 分钟」回访。
 *
 * 只读 src/ 引擎函数链，不改游戏文件。链路与 main.ts 一致：
 *   open  : restore → ensureVisits → offlineEfficiency → settleReturn → syncFlavorCollection → ensureDaily
 *   session: 每帧 scheduleEvents → 点击(doClick/onBossTap/onMemeTap) → 巡逻结算 finishPatrol → advance(dt)
 *   close : serialize
 *
 * 行为假设（学生碎片画像）：
 *  - 一次 3 分钟里分 4 段手感：前 25s 猛戳(3.2cps)→ 25-55s(1.6) → 55-120s 看商店/发呆(0.7) → 120-180s(1.6)，合计 ≈270 戳
 *  - 每 3s 检查一次能买的卡：优先「没见过的卡」，否则最便宜
 *  - 老板巡逻 hold 变体：看横幅忍住不点；type/blitz 变体：跟着点
 *  - 丢梗窗口：70% 概率注意到并去点，否则当普通点击
 *  - 日报 3/3 完成后立即领奖
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { initialState, type GameState } from "../src/engine/state";
import {
  doClick,
  buyUpgrade,
  clickPowerOf,
  COMBO_WINDOW_S,
  COMBO_BREAK_S,
  COMBO_MAX,
} from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { UPGRADES, costOf, effectOf } from "../src/engine/upgrades";
import { newEventState, scheduleEvents, onBossTap, onMemeTap, finishPatrol, type EventState } from "../src/engine/events";
import { collectQuote, syncFlavorCollection, collectionCount, TOTAL_ITEMS } from "../src/engine/collection";
import { MEME_QUOTES } from "../src/engine/flavor";
import { ensureDaily, dailyTrack, formatLocalDate, dailyAllDone, claimDaily, type DailyState } from "../src/engine/daily";
import { rankFor } from "../src/engine/titles";
import { serialize, restore, type SaveAdapter } from "../src/engine/save";
import { settleReturn } from "../src/engine/resume";
import { ensureVisits, offlineEfficiency } from "../src/engine/progression";
import { formatMoyu } from "../src/engine/format";

const DAY_MS = 86_400_000;
const DT = 0.05;

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function memSave(): SaveAdapter & { dump(): string } {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
    dump: () => JSON.stringify([...store.entries()]),
  };
}

function dateOf(ms: number): string {
  return formatLocalDate(new Date(ms));
}

/** 3 分钟碎片会话的手感曲线：秒 → 每秒点击数（engaged=较投入，casual=单手随便戳） */
type Profile = "engaged" | "casual";

function cps(profile: Profile, t: number): number {
  if (profile === "engaged") {
    if (t < 25) return 3.2;
    if (t < 55) return 1.6;
    if (t < 120) return 0.7;
    return 1.6;
  }
  // casual：课间单手，戳一阵停一阵
  if (t < 20) return 2.0;
  if (t < 60) return 0.6;
  if (t < 120) return 0.3;
  return 0.8;
}

const BUY_CHECKS: Record<Profile, number[]> = {
  engaged: [15, 45, 80, 115, 150],
  casual: [30, 100, 170],
};

interface Purchase {
  t: number;
  id: string;
  name: string;
  lv: number;
  cost: number;
}

class Sim {
  state: GameState;
  es: EventState = newEventState();
  gameTime = 0;
  now: number;
  combo = 0;
  lastTapAt = -99;
  rng: () => number;
  purchases: Purchase[] = [];
  taps = 0;
  memeHits = 0;
  memesSeen = 0;
  memeNoticed = false;
  lastMemeUntil = -1;
  patrols = 0;
  patrolReward = 0;
  prevBossActive = false;
  claimCount = 0;
  claimTotal = 0;

  constructor(now: number, rng: () => number) {
    this.state = initialState();
    this.now = now;
    this.rng = rng;
  }

  daily(kind: "click" | "meme" | "buy" | "survive", n = 1): void {
    if (this.state.daily) this.state = { ...this.state, daily: dailyTrack(this.state.daily, kind, n) };
  }

  tap(): void {
    // 看横幅照做：hold 巡逻期间忍住
    if (this.es.bossUntil > this.gameTime && this.es.bossVariant === "hold") return;
    const nowMs = this.gameTime * 1000;
    const gap = (nowMs - this.lastTapAt) / 1000;
    this.combo = gap < COMBO_WINDOW_S ? Math.min(COMBO_MAX, this.combo + 1) : gap > COMBO_BREAK_S ? 0 : this.combo;
    this.lastTapAt = nowMs;
    this.taps++;
    if (this.es.bossUntil > this.gameTime) {
      const r = onBossTap(this.state, this.es, this.gameTime, this.combo);
      this.state = r.state;
      this.daily("click");
      return;
    }
    if (this.es.memeUntil > this.gameTime && this.memeNoticed) {
      const r = onMemeTap(this.state, this.es);
      const qi = Math.floor(this.rng() * MEME_QUOTES.length);
      this.state = collectQuote(r.state, qi).state;
      this.memeHits++;
      this.daily("meme");
      return;
    }
    this.state = doClick(this.state, this.combo);
    this.daily("click");
    if (this.state.totalClicks % 25 === 0) this.state = syncFlavorCollection(this.state);
  }

  step(): void {
    this.gameTime += DT;
    this.now += DT * 1000;
    scheduleEvents(this.es, this.gameTime, this.rng);
    if (this.es.memeUntil > this.gameTime && this.lastMemeUntil !== this.es.memeUntil) {
      this.lastMemeUntil = this.es.memeUntil;
      this.memesSeen++;
      this.memeNoticed = this.rng() < 0.7;
    } else if (this.es.memeUntil < 0) {
      this.lastMemeUntil = -1;
    }
    const bossActive = this.es.bossUntil > this.gameTime;
    if (this.prevBossActive && !bossActive) {
      const r = finishPatrol(this.state, this.es);
      this.state = r.state;
      this.patrols++;
      if (r.reward > 0) {
        this.patrolReward += r.reward;
        this.daily("survive");
      }
    }
    this.prevBossActive = bossActive;
    this.state = advance(this.state, DT);
  }

  tryBuy(): void {
    const affordable = UPGRADES.filter((u) => this.state.moyu >= costOf(u.id, this.state.levels[u.id] ?? 0));
    if (!affordable.length) return;
    const owned = new Set(Object.keys(this.state.levels).filter((k) => (this.state.levels[k] ?? 0) > 0));
    const target =
      affordable.find((u) => !owned.has(u.id)) ??
      [...affordable].sort((a, b) => costOf(a.id, this.state.levels[a.id] ?? 0) - costOf(b.id, this.state.levels[b.id] ?? 0))[0]!;
    const cost = costOf(target.id, this.state.levels[target.id] ?? 0);
    const next = buyUpgrade(this.state, target.id);
    if (!next) return;
    this.state = syncFlavorCollection(next);
    this.daily("buy");
    this.purchases.push({
      t: this.gameTime,
      id: target.id,
      name: target.name,
      lv: this.state.levels[target.id] ?? 0,
      cost,
    });
  }

  tryClaimDaily(): void {
    const d = this.state.daily;
    if (!d || d.claimed || !dailyAllDone(d)) return;
    const r = claimDaily(this.state, dateOf(this.now));
    if (r.claimedReward !== null) {
      this.state = r.state;
      this.claimCount++;
      this.claimTotal += r.claimedReward;
    }
  }
}

interface VisitRecord {
  day: number;
  idx: number;
  at: string;
  weekday: string;
  offlineSeconds: number;
  offlineRate: number;
  offlineEarned: number;
  welcome: boolean;
  goals: { id: string; desc: string; target: number }[];
  taps: number;
  memeHits: number;
  memesSeen: number;
  patrols: number;
  patrolReward: number;
  purchases: Purchase[];
  buyCount: number;
  dailyBefore: string;
  dailyAfter: string;
  progressBefore: string;
  progressAfter: string;
  goalsNewlyDone: string[];
  claimed: number | null;
  streakAfter: number;
  codexBefore: number;
  codexAfter: number;
  newQuotes: number;
  newFlavors: number;
  rankBefore: string;
  rankAfter: string;
  sessionEarned: number;
  moyuEnd: number;
  idleRateEnd: number;
  clickPowerEnd: number;
  interesting: boolean;
  /** 真正的"一无所获"：无日报新完成 + 无新图鉴 + 无段位晋升（买同款升级不算新内容） */
  stale: boolean;
}

const GOAL_DESC: Record<string, string> = {
  click_100: "点100",
  meme_1: "收1梗",
  buy_3: "买3级",
  survive_2: "应付1次巡逻",
};

function goalProgressLine(d: DailyState | null): string {
  if (!d) return "无日报";
  return d.goals
    .map((g) => `${GOAL_DESC[g.id] ?? g.id} ${Math.min(g.progress, g.target)}/${g.target}${g.done ? "✓" : ""}`)
    .join(" | ");
}

function goalsDoneIds(d: DailyState | null): string[] {
  return d ? d.goals.filter((g) => g.done).map((g) => g.id) : [];
}

function run(seed: number, days = 3, profile: Profile = "engaged"): { state: GameState; createdAt: number; records: VisitRecord[]; sim: Sim } {
  const rng = makeRng(seed);
  const mem = memSave();
  const installAt = new Date(2026, 10, 17, 7, 40, 0).getTime(); // D1 07:40 建档（周一）
  const sim = new Sim(installAt, rng);
  sim.state = ensureDaily(sim.state, dateOf(installAt), rng);
  serialize(sim.state, mem, installAt); // 建档（createdAt 落档）
  const createdAt = installAt;
  const records: VisitRecord[] = [];
  const visitHours = [8, 10, 12, 15, 19];
  const visitMinutes = [10, 5, 30, 40, 20];

  for (let day = 1; day <= days; day++) {
    for (let v = 0; v < 5; v++) {
      const at = new Date(2026, 10, 17, visitHours[v]!, visitMinutes[v]!, 0).getTime() + (day - 1) * DAY_MS;
      // ---------- open ----------
      const saved = restore(mem, at);
      let state = saved.state ?? initialState();
      state = ensureVisits(state, at);
      const rate = offlineEfficiency(state, createdAt, at);
      const settled = settleReturn(state, at - saved.offlineSeconds * 1000, at, rate);
      state = syncFlavorCollection(settled.state); // main.ts boot 读档迁移
      state = ensureDaily(state, dateOf(at), rng);
      sim.state = state;
      sim.now = at;
      sim.gameTime = 0; // 刷新后场景时间归零（main.ts 新页面）
      sim.es = newEventState();
      sim.es.surviveStreak = state.surviveStreak;
      sim.prevBossActive = false;
      sim.lastMemeUntil = -1;
      sim.combo = 0;
      sim.lastTapAt = -99;
      sim.taps = 0;
      sim.memeHits = 0;
      sim.memesSeen = 0;
      sim.patrols = 0;
      sim.patrolReward = 0;
      sim.purchases = [];
      sim.claimCount = 0;
      sim.claimTotal = 0;

      const codexBefore = collectionCount(state);
      const quotesBefore = state.collected.quotes.length;
      const flavorsBefore = state.collected.flavors.length;
      const rankBefore = rankFor(state.lifetimeEarned).current;
      const totalBefore = state.totalEarned;
      const goalsBefore = goalsDoneIds(state.daily);
      const progressBefore = goalProgressLine(state.daily);
      const dailySnapshotBefore = state.daily
        ? `${goalsDoneIds(state.daily).length}/3 ${state.daily.claimed ? "已领" : ""}`.trim()
        : "无";
      const offlineEarned = settled.earned;
      const welcome = settled.showPanel;

      // ---------- 3 分钟会话 ----------
      let tapCredit = 0;
      let nextClaimAt = 0;
      // 碎片玩家：3 分钟里瞄几次商店，每次买 1 张（不是全自动脚本）
      const buyPlan = BUY_CHECKS[profile];
      let buyCheckIdx = 0;
      const SESSION = 180;
      const steps = Math.round(SESSION / DT);
      for (let i = 0; i < steps; i++) {
        const t = i * DT;
        tapCredit += cps(profile, t) * DT;
        while (tapCredit >= 1) {
          sim.tap();
          tapCredit -= 1;
        }
        sim.step();
        if (buyCheckIdx < buyPlan.length && t >= buyPlan[buyCheckIdx]!) {
          buyCheckIdx++;
          sim.tryBuy();
        }
        if (t >= nextClaimAt) {
          nextClaimAt += 30;
          sim.tryClaimDaily();
        }
      }
      // 会话末尾再检查一次日报/购买（很多人是在结束前才想起来领）
      sim.tryBuy();
      sim.tryClaimDaily();

      const stateEnd = sim.state;
      const goalsAfter = goalsDoneIds(stateEnd.daily);
      const goalsNewlyDone = goalsAfter.filter((g) => !goalsBefore.includes(g));
      const claimed = sim.claimTotal > 0 ? sim.claimTotal : null;

      // ---------- close ----------
      serialize(stateEnd, mem, sim.now);

      const rec: VisitRecord = {
        day,
        idx: v + 1,
        at: `${String(visitHours[v]).padStart(2, "0")}:${String(visitMinutes[v]).padStart(2, "0")}`,
        weekday: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(at).getDay()]!,
        offlineSeconds: Math.round(saved.offlineSeconds),
        offlineRate: Number(rate.toFixed(2)),
        offlineEarned,
        welcome,
        goals: stateEnd.daily ? stateEnd.daily.goals.map((g) => ({ id: g.id, desc: GOAL_DESC[g.id] ?? g.id, target: g.target })) : [],
        taps: sim.taps,
        memeHits: sim.memeHits,
        memesSeen: sim.memesSeen,
        patrols: sim.patrols,
        patrolReward: sim.patrolReward,
        purchases: sim.purchases,
        buyCount: sim.purchases.length,
        dailyBefore: dailySnapshotBefore,
        dailyAfter: stateEnd.daily
          ? `${goalsDoneIds(stateEnd.daily).length}/3${stateEnd.daily.claimed ? " 已领" : ""} streak=${stateEnd.daily.streak}`
          : "无",
        progressBefore,
        progressAfter: goalProgressLine(stateEnd.daily),
        goalsNewlyDone,
        claimed,
        streakAfter: stateEnd.daily?.streak ?? 0,
        codexBefore,
        codexAfter: collectionCount(stateEnd),
        newQuotes: stateEnd.collected.quotes.length - quotesBefore,
        newFlavors: stateEnd.collected.flavors.length - flavorsBefore,
        rankBefore,
        rankAfter: rankFor(stateEnd.lifetimeEarned).current,
        sessionEarned: stateEnd.totalEarned - totalBefore,
        moyuEnd: stateEnd.moyu,
        idleRateEnd: effectOf(stateEnd).idleRate,
        clickPowerEnd: clickPowerOf(stateEnd),
        interesting: false,
      };
      rec.interesting =
        rec.goalsNewlyDone.length > 0 ||
        rec.buyCount > 0 ||
        rec.newQuotes + rec.newFlavors > 0 ||
        rec.rankBefore !== rec.rankAfter ||
        rec.claimed !== null;
      rec.stale =
        rec.goalsNewlyDone.length === 0 && rec.newQuotes + rec.newFlavors === 0 && rec.rankBefore === rec.rankAfter;
      records.push(rec);
    }
  }
  return { state: sim.state, createdAt, records, sim };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

describe("R8 学生碎片党：1 天 5 次 ×3 分钟回访", () => {
  it("跑 3 天 ×2 种手感（D3 为回访稳态）并输出每次回访产出", () => {
    const seeds = [7, 11, 23];
    const profiles: Profile[] = ["engaged", "casual"];
    const all: Record<string, unknown>[] = [];
    const summary: Record<string, unknown>[] = [];

    for (const profile of profiles) {
      let d3Nothing = 0;
      let d3Stale = 0;
      let d3NoGoal = 0;
      let d3NoBuy = 0;
      let d3Visits = 0;
      let d1Nothing = 0;
      let d1Visits = 0;
      const runs: { seed: number; day1: VisitRecord[]; day3: VisitRecord[] }[] = [];
      for (const seed of seeds) {
        const { records } = run(seed, 3, profile);
        const d1 = records.filter((r) => r.day === 1);
        const d3 = records.filter((r) => r.day === 3);
        d3Nothing += d3.filter((r) => !r.interesting).length;
        d3Stale += d3.filter((r) => r.stale).length;
        d3NoGoal += d3.filter((r) => r.goalsNewlyDone.length === 0).length;
        d3NoBuy += d3.filter((r) => r.buyCount === 0).length;
        d3Visits += d3.length;
        d1Nothing += d1.filter((r) => r.stale).length;
        d1Visits += d1.length;
        const annotate = (r: VisitRecord) => ({
          ...r,
          goalsNewlyDone: r.goalsNewlyDone.map((g) => GOAL_DESC[g] ?? g),
          purchases: r.purchases.map((p) => `${p.name}Lv${p.lv}`),
        });
        runs.push({ seed, day1: d1.map(annotate) as unknown as VisitRecord[], day3: d3.map(annotate) as unknown as VisitRecord[] });
      }
      all.push({ profile, runs });
      summary.push({
        profile,
        d3Visits,
        d3Nothing,
        d3Stale,
        d3NoGoal,
        d3NoBuy,
        d1Stale: d1Nothing,
        d1Visits,
        d3GoalPools: runs.map((r) => r.day3[0]?.goals.map((g) => g.desc)),
        d3Claim: runs.map((r) => r.day3.filter((x) => x.claimed !== null).length),
        last: runs.map((r) => ({
          rank: r.day3[4]?.rankAfter,
          idle: r.day3[4]?.idleRateEnd,
          moyu: r.day3[4]?.moyuEnd,
          codex: r.day3[4]?.codexAfter,
        })),
      });

      const primary = runs[0]!;
      console.log(`\n[R8] ===== ${profile} · D3 回访明细（seed 7，学生 1 天 5 次 ×3 分钟）=====`);
      for (const r of primary.day3) {
        const goals = r.goals.map((g) => `${g.desc}${g.target > 1 ? `(${g.target})` : ""}`).join("/");
        console.log(
          `[R8] ${profile} D3-${r.idx} ${r.at} 离线${(r.offlineSeconds / 60).toFixed(0)}分@${pct(r.offlineRate)} +${formatMoyu(r.offlineEarned)}` +
            ` | 戳${r.taps} 梗${r.memeHits}/${r.memesSeen} 巡逻${r.patrols}` +
            ` | 买${r.buyCount}(${r.purchases.join(",") || "-"})` +
            ` | 日报新完成[${r.goalsNewlyDone.join(",") || "无"}] 领${r.claimed === null ? "否" : formatMoyu(r.claimed)}` +
            ` | 图鉴+${r.newQuotes + r.newFlavors} 段位${r.rankAfter !== r.rankBefore ? `${r.rankBefore}→${r.rankAfter}` : r.rankAfter}` +
            ` | 本次赚${formatMoyu(r.sessionEarned)} 余额${formatMoyu(r.moyuEnd)} 挂机${formatMoyu(r.idleRateEnd)}/s` +
            ` | 目标池:${goals}${r.stale ? " ★无新内容" : ""}`,
        );
        console.log(`[R8]   ${r.at} 日报进度 ${r.progressBefore}  →  ${r.progressAfter}`);
      }
      console.log(`[R8] ===== ${profile} · 首次安装日 D1（seed 7）=====`);
      for (const r of primary.day1) {
        console.log(
          `[R8] ${profile} D1-${r.idx} ${r.at} 离线+${formatMoyu(r.offlineEarned)} 戳${r.taps} 买${r.buyCount} 日报新完成[${r.goalsNewlyDone.join(",") || "无"}] 图鉴${r.codexAfter}/${TOTAL_ITEMS} 段位${r.rankAfter} 余额${formatMoyu(r.moyuEnd)}`,
        );
      }
      console.log(
        `[R8] 汇总(${profile})：D3 '3 分钟一无所有'=${d3Nothing}/${d3Visits}；'无新内容(不论升级)'=${d3Stale}/${d3Visits}；无新完成日报目标=${d3NoGoal}/${d3Visits}；零购买=${d3NoBuy}/${d3Visits}；D1 首日无新内容=${d1Nothing}/${d1Visits}`,
      );
    }

    writeFileSync(
      "playtest/r8-student-fragments.json",
      JSON.stringify({ generatedAt: new Date().toISOString(), seeds, summary, all }, null, 1),
    );
    console.log(`[R8] JSON → playtest/r8-student-fragments.json`);

    const engaged = summary.find((x) => x.profile === "engaged") as { d3Nothing: number; d3Visits: number; d3Stale: number; d3NoGoal: number };
    const casual = summary.find((x) => x.profile === "casual") as { d3Nothing: number; d3Visits: number; d3Stale: number; d3NoGoal: number };
    expect(engaged.d3Stale / engaged.d3Visits).toBeGreaterThanOrEqual(0); // 观察量（报告用）
    expect(casual.d3Stale / casual.d3Visits).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
