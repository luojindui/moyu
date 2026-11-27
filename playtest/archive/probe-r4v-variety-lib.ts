/**
 * probe-r4v-variety-lib.ts — 第 4 轮验收（多玩法党）公共模拟库。
 * 只在 playtest/ 内使用，不修改 src/。
 *
 * 以 src/engine 真实逻辑复刻 main.ts 的输入/事件路径：
 *   - 点击：combo 链规则与 main.ts 完全一致（间隔 <0.4s 累积，>3s 断；封顶 12）
 *   - 巡逻：scheduleEvents 开窗 → 变体行为（hold 停手 / type、blitz 点击计数）
 *           → finishPatrol 结算（安然/被抓/达标）
 *   - 丢梗：开窗即点 → onMemeTap + collectQuote（main.ts 随机取语录）
 *   - 购买：节律到期买 1 个 → buyUpgrade + syncFlavorCollection（真实彩蛋解锁路径）
 *   - 挂机：advance
 * 用于：时间桶多样性 / 变体熵 / 内容耗尽时间 / 事件经济占比。
 *
 * baseline 模式 = 本次上线前的语义（恒 hold 变体、无连击、无日报、无连胜），
 * 事件时序与 current 完全一致（独立随机流 + 强制 hold 不额外消耗随机数），
 * 因此 A/B 对比只差「多样性内容」本身。
 */
import type { GameState } from "../src/engine/state";
import { initialState } from "../src/engine/state";
import { doClick, buyUpgrade, comboMultiplier, clickPowerOf, COMBO_WINDOW_S, COMBO_BREAK_S, COMBO_MAX } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { UPGRADES, costOf, valueScoreOf, effectOf } from "../src/engine/upgrades";
import {
  newEventState,
  scheduleEvents,
  onBossTap,
  onMemeTap,
  finishPatrol,
  BOSS_DURATION,
  BOSS_TYPE_TARGET,
  BOSS_BLITZ_TARGET,
  type EventState,
  type BossVariant,
} from "../src/engine/events";
import { collectQuote, syncFlavorCollection } from "../src/engine/collection";
import { ensureDaily, dailyTrack, claimDaily, dailyAllDone } from "../src/engine/daily";
import { MEME_QUOTES } from "../src/engine/flavor";

export const DT = 0.25;
export const BUCKET_SEC = 300;

export interface VarietyPersona {
  name: string;
  /** 非事件窗口的正常点击率（次/秒） */
  baseTps: number;
  /** type/blitz 窗口内的冲刺点击率（次/秒） */
  burstTps: number;
  /** 看到横幅到开始操作的反应时间（秒） */
  reactionSec: number;
  /** 购买节律（秒/次） */
  buyEverySec: number;
  pick: "value" | "cheapest";
  tapMemes: boolean;
  /** hold 窗口停手（多玩法党的稳健打法） */
  dodgeHold: boolean;
  /** 点击间隔抖动比例（0=匀速，1=±50%） */
  jitter: number;
  /** 按会话时间变化的点击率（r3 口径画像用；缺省 = baseTps） */
  tpsAt?: (t: number) => number;
}

/** 第 3 轮 player-variety 口径画像（复刻 10.3/13.8/2.6→0.7 基线用） */
export const R3_VARIETY: VarietyPersona = {
  name: "variety-r3(第3轮口径)",
  baseTps: 2,
  burstTps: 3.4,
  reactionSec: 0.25,
  buyEverySec: 15,
  pick: "value",
  tapMemes: true,
  dodgeHold: true,
  jitter: 0.25,
  tpsAt: (t) => (t < 180 ? 3 : t < 600 ? 1.5 : 2),
};

export const PERSONAS: VarietyPersona[] = [
  {
    name: "variety(多玩法党)",
    baseTps: 2.2,
    burstTps: 3.4,
    reactionSec: 0.25,
    buyEverySec: 20,
    pick: "value",
    tapMemes: true,
    dodgeHold: true,
    jitter: 0.6,
  },
  {
    name: "clicker(狂点党)",
    baseTps: 3.2,
    burstTps: 4.2,
    reactionSec: 0.2,
    buyEverySec: 10,
    pick: "value",
    tapMemes: true,
    dodgeHold: true,
    jitter: 0.4,
  },
  {
    name: "casual(休闲党)",
    baseTps: 1.0,
    burstTps: 1.6,
    reactionSec: 0.5,
    buyEverySec: 35,
    pick: "cheapest",
    tapMemes: true,
    dodgeHold: true,
    jitter: 0.6,
  },
];

export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export type NoveltyKind =
  | "firstBuy"
  | "flavor"
  | "quote"
  | "dailyGoal"
  | "variant"
  | "variantWin"
  | "streak"
  | "combo"
  | "dailyClaim";

/** 主线内容（验收口径：彩蛋45 + 图鉴语录10 + 日报3 + 变体3）；其余为机制里程碑 */
export const PRIMARY_CONTENT_KINDS: NoveltyKind[] = ["flavor", "quote", "dailyGoal", "variant"];

export function isPrimaryContent(kind: NoveltyKind): boolean {
  return PRIMARY_CONTENT_KINDS.includes(kind);
}

export interface NoveltyEvent {
  /** 分钟（保留 2 位） */
  t: number;
  kind: NoveltyKind;
  id: string;
  primary: boolean;
}

export interface PatrolWindow {
  variant: BossVariant;
  start: number;
  taps: number;
  won: boolean;
  caught: boolean;
}

export interface BucketRow {
  idx: number;
  minuteRange: [number, number];
  clicks: number;
  memeTaps: number;
  buys: number;
  windows: number;
  tapsInWindows: Record<BossVariant, number>;
  wins: Record<BossVariant, number>;
  caught: number;
  /** 本桶主线新内容数（彩蛋/语录/日报目标/变体首见） */
  newContent: number;
  /** 本桶机制里程碑数（首次购买/变体达标/连胜/连击/领日报） */
  newMechanics: number;
  /** 本桶出现过的巡逻变体种类 */
  variantKinds: BossVariant[];
  /** 本桶变体分布的 Shannon 熵（bit）；无巡逻窗口 = null */
  variantEntropy: number | null;
  /** 本桶有意义的动作种类数（点击/丢梗/购买/各变体成功/被抓） */
  actionKinds: number;
}

export interface SimOptions {
  persona: VarietyPersona;
  /** baseline = 上线前语义；current = 现行语义 */
  mode: "baseline" | "current";
  minutes: number;
  seed: number;
  /** 连击链开关（current 下做连击收益 A/B） */
  comboEnabled?: boolean;
}

export interface SimResult {
  persona: string;
  mode: SimOptions["mode"];
  seed: number;
  buckets: BucketRow[];
  novelty: NoveltyEvent[];
  windows: PatrolWindow[];
  economy: {
    bossRewards: number;
    memeEarnings: number;
    penalties: number;
    dailyClaims: number;
    totalEarned: number;
    eventSharePct: number;
    eventNetSharePct: number;
    bossWindows: number;
    memeWindows: number;
    blitzBonus: number;
  };
  combo: {
    clicks: number;
    avgCombo: number;
    pctComboGE6: number;
    pctComboGE12: number;
    maxCombo: number;
    /** 连击相对无连击的总收入增幅（current 下由测试另跑 no-combo A/B 填充） */
    comboUpliftPct: number | null;
  };
  end: {
    totalEarned: number;
    moyu: number;
    clickPower: number;
    idleRate: number;
    levels: Record<string, number>;
    quotes: number;
    flavors: number;
  };
  detail: {
    /** 语录首次收集时间（分钟，按收集顺序） */
    quoteTimes: number[];
    /** 语录全部收齐时间（分钟）；null=会话内未收齐 */
    allQuotesAtMin: number | null;
    /** 各升级首购时间（分钟） */
    firstBuyTimes: { id: string; t: number }[];
    /** 相邻首购间隔（分钟，>0） */
    firstBuyGaps: { from: string; to: string; gapMin: number }[];
    /** 日报 3 目标各自完成时间（分钟） */
    dailyGoalTimes: { id: string; t: number }[];
    /** 三变体首见时间（分钟） */
    variantFirstTimes: { variant: BossVariant; t: number }[];
    /** 各阶段新内容事件速率（件/分钟）与文本彩蛋占比 */
    rate: {
      /** 主线口径：彩蛋+语录+日报目标+变体首见 */
      primaryFirst5: number;
      primaryAfter15: number;
      primaryAfter15FlavorPct: number;
      /** 收藏口径：+升级首购（第 3 轮「新内容速率」口径） */
      collectFirst5: number;
      collectAfter15: number;
      collectAfter15FlavorPct: number;
      /** 全量口径：+变体达标/连胜/连击/领日报 */
      allFirst5: number;
      allAfter15: number;
      allAfter15FlavorPct: number;
      after15KindCounts: Record<string, number>;
    };
    /** 图鉴（55 条）累计收集：{分钟: 数量} */
    codexAt: Record<string, number>;
    /** 不同 kind 的新内容事件数 */
    kindCounts: Record<string, number>;
  };
  content: {
    /** 主线内容池大小（彩蛋45+语录10+日报3+变体3） */
    poolSize: number;
    /** 主线内容收集数 */
    collected: number;
    /** 机制里程碑解锁数（次要口径） */
    mechanicsCollected: number;
    /** 各阶段累计收集数 */
    at5: number;
    at10: number;
    at12: number;
    at20: number;
    at30: number;
    lastNoveltyMin: number | null;
    /** 首个「新内容=0」的 5 分钟桶起点（分钟） */
    firstEmptyBucketMin: number | null;
    /** 最后一个「新内容≥2」的桶结束时间（分钟） */
    denseUntilMin: number | null;
    /** 持续空桶（该桶起之后全部为 0）的起点；null = 30 分钟内未耗尽 */
    plateauStartMin: number | null;
  };
}

function shannon(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return -counts
    .filter((c) => c > 0)
    .reduce((acc, c) => {
      const p = c / total;
      return acc + p * Math.log2(p);
    }, 0);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export { median };

const DATE = "2026-11-27";

export function simulate(opts: SimOptions): SimResult {
  const { persona: p, mode, minutes } = opts;
  const comboEnabled = mode === "current" && opts.comboEnabled !== false;
  const quoteMode = opts.quoteMode ?? "random";
  const total = Math.round((minutes * 60) / DT);
  const bucketCount = Math.ceil((minutes * 60) / BUCKET_SEC);

  const rngEvents = lcg(opts.seed);
  const rngClicks = lcg(opts.seed ^ 0x9e3779b9);
  const rngBuy = lcg(opts.seed ^ 0x85ebca6b);
  const rngQuote = lcg(opts.seed ^ 0xc2b2ae35);

  let state: GameState = initialState();
  let es: EventState = newEventState();
  if (mode === "current") state = ensureDaily(state, DATE, rngBuy);

  const buckets: BucketRow[] = Array.from({ length: bucketCount }, (_, i) => ({
    idx: i,
    minuteRange: [i * 5, (i + 1) * 5],
    clicks: 0,
    memeTaps: 0,
    buys: 0,
    windows: 0,
    tapsInWindows: { hold: 0, type: 0, blitz: 0 },
    wins: { hold: 0, type: 0, blitz: 0 },
    caught: 0,
    newContent: 0,
    newMechanics: 0,
    variantKinds: [],
    variantEntropy: null,
    actionKinds: 0,
  }));

  const novelty: NoveltyEvent[] = [];
  const seen = new Set<string>();
  const addNovelty = (t: number, kind: NoveltyKind, id: string): void => {
    const key = `${kind}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const primary = isPrimaryContent(kind);
    novelty.push({ t: +(t / 60).toFixed(2), kind, id, primary });
    const bi = Math.min(bucketCount - 1, Math.floor(t / BUCKET_SEC));
    if (primary) buckets[bi]!.newContent += 1;
    else buckets[bi]!.newMechanics += 1;
  };

  const windows: PatrolWindow[] = [];
  let currentWindow: PatrolWindow | null = null;
  const windowsByBucket: BossVariant[][] = buckets.map(() => []);

  const economy = { bossRewards: 0, memeEarnings: 0, penalties: 0, dailyClaims: 0, blitzBonus: 0 };
  let bossWindows = 0;
  let memeWindows = 0;
  let memeTapSeq = 0;
  const quoteTimes: number[] = [];
  const dailyGoalTimes: { id: string; t: number }[] = [];
  const variantFirstTimes: { variant: BossVariant; t: number }[] = [];
  const codexSamples: { t: number; count: number }[] = [];
  let freeClicks = 0;
  let comboSum = 0;
  let comboGE6 = 0;
  let comboGE12 = 0;
  let maxCombo = 0;

  // 连击（与 main.ts pointerdown 内联逻辑逐行一致）
  let combo = 0;
  let lastClickAt = -1e9;
  const registerPointer = (t: number): number => {
    const gap = t - lastClickAt;
    combo = gap < COMBO_WINDOW_S ? Math.min(COMBO_MAX, combo + 1) : gap > COMBO_BREAK_S ? 0 : combo;
    lastClickAt = t;
    if (comboEnabled) {
      comboSum += combo;
      if (combo >= 6) comboGE6 += 1;
      if (combo >= 12) comboGE12 += 1;
      if (combo > maxCombo) maxCombo = combo;
      if (combo >= 6) addNovelty(t, "combo", "6");
      if (combo >= 12) addNovelty(t, "combo", "12");
    }
    return comboEnabled ? combo : 0;
  };

  const track = (kind: "click" | "meme" | "buy" | "survive", n = 1): void => {
    if (mode !== "current" || !state.daily) return;
    state = { ...state, daily: dailyTrack(state.daily, kind, n) };
    for (const g of state.daily.goals) {
      if (g.done) {
        addNovelty(tNow, "dailyGoal", g.id);
        if (!dailyGoalTimes.some((x) => x.id === g.id)) dailyGoalTimes.push({ id: g.id, t: +(tNow / 60).toFixed(2) });
      }
    }
  };

  // 点击节律：credit 累积（等价于按真实间隔发 pointerdown）
  let tapCredit = 0;
  let gateUntil = 0;
  let nextClickAt = 0;

  let prevBossActive = false;
  let prevMemeActive = false;
  let lastBuyAt = -1e9;
  let dailyClaimed = false;
  let tNow = 0;
  let buySeq = 0;

  const firstBuyTimes: { id: string; t: number }[] = [];
  const doBuy = (t: number): void => {
    const affordable = UPGRADES.filter((u) => state.moyu >= costOf(u.id, state.levels[u.id] ?? 0));
    if (affordable.length === 0) return;
    const target =
      p.pick === "cheapest"
        ? [...affordable].sort((a, b) => costOf(a.id, state.levels[a.id] ?? 0) - costOf(b.id, state.levels[b.id] ?? 0))[0]!
        : [...affordable].sort((a, b) => {
            const sa = valueScoreOf(a.id, state.levels[a.id] ?? 0);
            const sb = valueScoreOf(b.id, state.levels[b.id] ?? 0);
            return Math.max(sb.idle, sb.click * 0.5) - Math.max(sa.idle, sa.click * 0.5);
          })[0]!;
    const beforeFlavors = state.collected.flavors;
    const next = buyUpgrade(state, target.id);
    if (!next) return;
    state = syncFlavorCollection(next);
    buySeq += 1;
    buckets[Math.min(bucketCount - 1, Math.floor(t / BUCKET_SEC))]!.buys += 1;
    track("buy");
    if (!firstBuyTimes.some((x) => x.id === target.id)) firstBuyTimes.push({ id: target.id, t: +(t / 60).toFixed(2) });
    addNovelty(t, "firstBuy", target.id);
    for (const idx of state.collected.flavors) {
      if (!beforeFlavors.includes(idx)) {
        const up = UPGRADES[Math.floor(idx / 5)];
        addNovelty(t, "flavor", `${up?.id ?? "?"}:${idx % 5}`);
      }
    }
  };

  const clickAt = (t: number): void => {
    const c = registerPointer(t);
    if (es.bossUntil > t) {
      const beforeTaps = es.bossTaps;
      const r = onBossTap(state, es, t, c);
      state = r.state;
      if (r.caught) {
        economy.penalties += r.lost;
        const bi = Math.min(bucketCount - 1, Math.floor(t / BUCKET_SEC));
        buckets[bi]!.caught += 1;
        if (currentWindow) currentWindow.caught = true;
      }
      const variant = es.bossVariant;
      const bi = Math.min(bucketCount - 1, Math.floor(t / BUCKET_SEC));
      buckets[bi]!.tapsInWindows[variant] += es.bossTaps - beforeTaps;
      if (currentWindow) currentWindow.taps += es.bossTaps - beforeTaps;
      track("click");
      return;
    }
    // 丢梗由窗口开启时单独命中；此处为普通点击
    state = doClick(state, c);
    freeClicks += 1;
    const bi = Math.min(bucketCount - 1, Math.floor(t / BUCKET_SEC));
    buckets[bi]!.clicks += 1;
    track("click");
  };

  for (let i = 0; i <= total; i++) {
    const t = i * DT;
    tNow = t;
    const memeWasIdle = es.memeUntil < 0;
    scheduleEvents(es, t, rngEvents);
    let bossActive = es.bossUntil > t;
    // baseline：强制 hold 变体（pickBossVariant 已消耗同一随机数，时序/随机序列不受影响）
    if (mode === "baseline" && bossActive) es.bossVariant = "hold";

    const bi = Math.min(bucketCount - 1, Math.floor(t / BUCKET_SEC));
    const b = buckets[bi]!;

    // 巡逻开窗
    if (!prevBossActive && bossActive) {
      bossWindows += 1;
      b.windows += 1;
      const w: PatrolWindow = { variant: es.bossVariant, start: t, taps: 0, won: false, caught: false };
      windows.push(w);
      currentWindow = w;
      windowsByBucket[bi]!.push(es.bossVariant);
      if (mode === "current") {
        addNovelty(t, "variant", es.bossVariant);
        if (!variantFirstTimes.some((x) => x.variant === es.bossVariant)) {
          variantFirstTimes.push({ variant: es.bossVariant, t: +(t / 60).toFixed(2) });
        }
      }
      gateUntil = t + p.reactionSec;
      tapCredit = 0;
      nextClickAt = gateUntil;
    }

    // 丢梗开窗：多玩法党立刻戳（main.ts 命中路径）
    if (memeWasIdle && es.memeUntil > 0) {
      memeWindows += 1;
      if (p.tapMemes) {
        const tappedAt = t + p.reactionSec;
        const c = registerPointer(tappedAt);
        const r = onMemeTap(state, es);
        state = r.state;
        economy.memeEarnings += r.earned;
        const qi = quoteMode === "cycle" ? memeTapSeq % MEME_QUOTES.length : Math.floor(rngQuote() * MEME_QUOTES.length);
        memeTapSeq += 1;
        const col = collectQuote(r.state, qi);
        state = col.state;
        if (col.isNew) {
          addNovelty(tappedAt, "quote", String(qi));
          quoteTimes.push(+(tappedAt / 60).toFixed(2));
        }
        b.memeTaps += 1;
        track("meme");
        void c;
      }
    }

    // 点击节律：决定当前可点击速率
    let rate = 0;
    if (bossActive) {
      const variant = es.bossVariant;
      if (variant === "hold") {
        rate = p.dodgeHold ? 0 : p.baseTps;
      } else if (variant === "type") {
        rate = es.bossTaps < BOSS_TYPE_TARGET ? p.burstTps : p.baseTps;
      } else {
        rate = es.bossTaps < BOSS_BLITZ_TARGET ? p.burstTps : p.baseTps;
      }
    } else {
      rate = p.tpsAt ? p.tpsAt(t) : p.baseTps;
    }
    if (t >= gateUntil && rate > 0) {
      if (nextClickAt < t) nextClickAt = t;
      while (nextClickAt <= t + DT && nextClickAt <= t + DT) {
        const clickTime = Math.max(t, nextClickAt);
        clickAt(clickTime);
        const interval = (1 / rate) * (1 - p.jitter / 2 + p.jitter * rngClicks());
        nextClickAt = clickTime + Math.max(0.05, interval);
      }
    }

    // 巡逻收窗：结算（与 main.ts 的 prevBossActive 逻辑一致）
    const bossActiveAfter = es.bossUntil > t;
    if (prevBossActive && !bossActiveAfter) {
      const caught = es.bossCaught;
      const w = currentWindow;
      if (mode === "baseline") {
        const saved = es.surviveStreak;
        es.surviveStreak = 0; // 上线前无连胜乘数
        const r = finishPatrol(state, es);
        state = r.state;
        es.surviveStreak = saved;
        if (r.reward > 0) economy.bossRewards += r.reward;
        if (w) {
          w.won = r.reward > 0;
          if (w.won) b.wins[w.variant] += 1;
        }
      } else {
        const r = finishPatrol(state, es);
        state = r.state;
        if (r.reward > 0) {
          economy.bossRewards += r.reward;
          track("survive");
          if (w) {
            w.won = true;
            b.wins[w.variant] += 1;
            addNovelty(t, "variantWin", w.variant);
            if (w.variant === "blitz") economy.blitzBonus += r.reward - r.reward / 1.5;
          }
          if (es.surviveStreak >= 5) addNovelty(t, "streak", "5");
          if (es.surviveStreak >= 10) addNovelty(t, "streak", "10");
        }
      }
      if (w && caught) w.caught = true;
      currentWindow = null;
    }
    prevBossActive = bossActiveAfter;

    // 购买
    if (t - lastBuyAt >= p.buyEverySec) {
      lastBuyAt = t;
      doBuy(t);
    }

    state = advance(state, DT);

    // 日报全完成 → 领取（多玩法党会点 📔）
    if (mode === "current" && state.daily && !dailyClaimed && dailyAllDone(state.daily)) {
      const r = claimDaily(state, DATE);
      if (r.claimedReward !== null) {
        state = r.state;
        economy.dailyClaims += r.claimedReward;
        dailyClaimed = true;
        addNovelty(t, "dailyClaim", "all");
      }
    }
  }

  // ---- 桶派生指标 ----
  const variantCountsByBucket = windowsByBucket;
  for (const b of buckets) {
    const kinds = variantCountsByBucket[b.idx]!;
    b.variantKinds = [...new Set(kinds)] as BossVariant[];
    if (kinds.length === 0) {
      b.variantEntropy = null;
    } else {
      const cnt = { hold: 0, type: 0, blitz: 0 } as Record<BossVariant, number>;
      for (const k of kinds) cnt[k] += 1;
      b.variantEntropy = +shannon([cnt.hold, cnt.type, cnt.blitz]).toFixed(4);
    }
    const actionCats = [
      b.clicks > 0,
      b.memeTaps > 0,
      b.buys > 0,
      b.caught > 0,
      b.wins.hold > 0,
      b.wins.type > 0,
      b.wins.blitz > 0,
      b.tapsInWindows.type > 0,
      b.tapsInWindows.blitz > 0,
    ];
    b.actionKinds = actionCats.filter(Boolean).length;
  }

  // ---- 内容耗尽判定（主线口径） ----
  const primaryNovelty = novelty.filter((n) => n.primary);
  const noveltyMinutes = primaryNovelty.map((n) => n.t);
  const lastNoveltyMin = noveltyMinutes.length ? Math.max(...noveltyMinutes) : null;
  const firstEmpty = buckets.find((b) => b.newContent === 0)?.idx ?? null;
  const denseBuckets = buckets.filter((b) => b.newContent >= 2);
  const denseUntilMin = denseBuckets.length ? denseBuckets[denseBuckets.length - 1]!.minuteRange[1] : null;
  let plateauStartMin: number | null = null;
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (buckets[i]!.newContent !== 0) {
      plateauStartMin = i + 1 < buckets.length ? buckets[i + 1]!.minuteRange[0] : null;
      break;
    }
    plateauStartMin = buckets[i]!.minuteRange[0];
  }
  const countAt = (min: number): number => primaryNovelty.filter((n) => n.t <= min).length;
  const codexAt: Record<string, number> = {};
  for (const min of [5, 10, 12, 15, 20, 25, 30, 45, 60]) {
    codexAt[String(min)] = state.collected.quotes.length + state.collected.flavors.length >= 0
      ? primaryNovelty.filter((n) => n.t <= min && (n.kind === "quote" || n.kind === "flavor")).length
      : 0;
  }

  const clicksForCombo = freeClicks + windows.reduce((a, w) => a + w.taps, 0);
  const { idleRate } = effectOf(state);

  // ---- detail 口径 ----
  const firstBuyGaps = firstBuyTimes.slice(1).map((x, i) => {
    const prev = firstBuyTimes[i]!;
    return { from: prev.id, to: x.id, gapMin: +(x.t - prev.t).toFixed(2) };
  });
  const rateOf = (ev: NoveltyEvent[], fromMin: number, toMin: number): number =>
    +(ev.filter((n) => n.t > fromMin && n.t <= toMin).length / Math.max(0.001, toMin - fromMin)).toFixed(2);
  const collectNovelty = novelty.filter((n) => n.primary || n.kind === "firstBuy");
  const after15 = novelty.filter((n) => n.t > 15);
  const after15Primary = primaryNovelty.filter((n) => n.t > 15);
  const after15Collect = collectNovelty.filter((n) => n.t > 15);
  const flavorCount = (ev: NoveltyEvent[]): number => ev.filter((n) => n.kind === "flavor").length;
  const pct = (num: number, den: number): number => (den ? +((num / den) * 100).toFixed(1) : 0);
  const after15KindCounts: Record<string, number> = {};
  for (const n of after15) after15KindCounts[n.kind] = (after15KindCounts[n.kind] ?? 0) + 1;
  const kindCounts: Record<string, number> = {};
  for (const n of novelty) kindCounts[n.kind] = (kindCounts[n.kind] ?? 0) + 1;

  return {
    persona: p.name,
    mode,
    seed: opts.seed,
    detail: {
      quoteTimes,
      allQuotesAtMin: quoteTimes.length >= MEME_QUOTES.length ? quoteTimes[MEME_QUOTES.length - 1]! : null,
      firstBuyTimes,
      firstBuyGaps,
      dailyGoalTimes,
      variantFirstTimes,
      rate: {
        primaryFirst5: rateOf(primaryNovelty, 0, 5),
        primaryAfter15: rateOf(primaryNovelty, 15, minutes),
        primaryAfter15FlavorPct: pct(flavorCount(after15Primary), after15Primary.length),
        collectFirst5: rateOf(collectNovelty, 0, 5),
        collectAfter15: rateOf(collectNovelty, 15, minutes),
        collectAfter15FlavorPct: pct(flavorCount(after15Collect), after15Collect.length),
        allFirst5: rateOf(novelty, 0, 5),
        allAfter15: rateOf(novelty, 15, minutes),
        allAfter15FlavorPct: pct(flavorCount(after15), after15.length),
        after15KindCounts,
      },
      codexAt,
      kindCounts,
    },
    buckets,
    novelty,
    windows,
    economy: {
      ...economy,
      totalEarned: state.totalEarned,
      eventSharePct: +(((economy.bossRewards + economy.memeEarnings) / Math.max(1, state.totalEarned)) * 100).toFixed(2),
      eventNetSharePct: +(
        ((economy.bossRewards + economy.memeEarnings - economy.penalties) / Math.max(1, state.totalEarned)) *
        100
      ).toFixed(2),
      bossWindows,
      memeWindows,
    },
    combo: {
      clicks: clicksForCombo,
      avgCombo: +(comboSum / Math.max(1, clicksForCombo)).toFixed(2),
      pctComboGE6: +((comboGE6 / Math.max(1, clicksForCombo)) * 100).toFixed(1),
      pctComboGE12: +((comboGE12 / Math.max(1, clicksForCombo)) * 100).toFixed(1),
      maxCombo,
      comboUpliftPct: null,
    },
    end: {
      totalEarned: state.totalEarned,
      moyu: state.moyu,
      clickPower: clickPowerOf(state),
      idleRate,
      levels: { ...state.levels },
      quotes: state.collected.quotes.length,
      flavors: state.collected.flavors.length,
    },
    content: {
      poolSize: mode === "current" ? 61 : 55,
      collected: primaryNovelty.length,
      mechanicsCollected: novelty.filter((n) => !n.primary).length,
      at5: countAt(5),
      at10: countAt(10),
      at12: countAt(12),
      at20: countAt(20),
      at30: countAt(30),
      lastNoveltyMin: lastNoveltyMin === null ? null : +lastNoveltyMin.toFixed(2),
      firstEmptyBucketMin: firstEmpty === null ? null : buckets[firstEmpty]!.minuteRange[0],
      denseUntilMin,
      plateauStartMin,
    },
  };
}

/** 多 seed 聚合：返回各指标中位数 */
export interface Aggregate {
  persona: string;
  mode: SimOptions["mode"];
  runs: number;
  medianCollected: number;
  medianMechanicsCollected: number;
  medianLastNoveltyMin: number | null;
  medianDenseUntilMin: number | null;
  medianPlateauStartMin: number | null;
  medianEventSharePct: number;
  medianEventNetSharePct: number;
  medianAt10: number;
  medianAt12: number;
  medianAt20: number;
  medianAt30: number;
  medianTotalEarned: number;
  meanActionKinds: number;
  /** 各桶变体熵均值（仅有窗口的桶） */
  meanVariantEntropy: number;
  /** 各桶变体种类数 CV（上线前恒 1 → 0） */
  variantKindsCV: number;
  newContentPerBucket: number[];
  newMechanicsPerBucket: number[];
  actionKindsPerBucket: number[];
  /** 巡逻窗口行为：每变体平均点击次数 / 达标率 */
  behavior: Record<BossVariant, { windows: number; tapsPerWindow: number; winRatePct: number; clicksPerSec: number }>;
  combo: { avgCombo: number; pctComboGE6: number; pctComboGE12: number; maxCombo: number };
}

export function aggregate(results: SimResult[]): Aggregate {
  const med = (xs: number[]): number => median(xs);
  const nn = (xs: (number | null)[]): number | null => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? +median(v).toFixed(2) : null;
  };
  const first = results[0]!;
  const meanOf = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  // 变体种类数 CV：只统计「有巡逻窗口」的桶（上线前恒 1 → CV=0 的可比口径）
  const flatKinds = results.flatMap((r) => r.buckets.filter((b) => b.windows > 0).map((b) => b.variantKinds.length));
  const meanKinds = meanOf(flatKinds);
  const sdKinds = Math.sqrt(meanOf(flatKinds.map((x) => (x - meanKinds) ** 2)));
  const entropyPerBucket = results.flatMap((r) => r.buckets.map((b) => b.variantEntropy).filter((x): x is number => x !== null));
  const windows = results.flatMap((r) => r.windows);
  const bucketMedians = (pick: (b: BucketRow) => number): number[] => {
    const n = first.buckets.length;
    return Array.from({ length: n }, (_, i) => +median(results.map((r) => pick(r.buckets[i]!))).toFixed(1));
  };
  const behavior = {} as Aggregate["behavior"];
  for (const v of ["hold", "type", "blitz"] as BossVariant[]) {
    const ws = windows.filter((w) => w.variant === v);
    const taps = ws.reduce((a, w) => a + w.taps, 0);
    const wins = ws.filter((w) => w.won).length;
    behavior[v] = {
      windows: ws.length,
      tapsPerWindow: +(taps / Math.max(1, ws.length)).toFixed(2),
      winRatePct: +((wins / Math.max(1, ws.length)) * 100).toFixed(1),
      clicksPerSec: +(taps / Math.max(1, ws.length * BOSS_DURATION)).toFixed(2),
    };
  }
  return {
    persona: first.persona,
    mode: first.mode,
    runs: results.length,
    medianCollected: med(results.map((r) => r.content.collected)),
    medianMechanicsCollected: med(results.map((r) => r.content.mechanicsCollected)),
    medianLastNoveltyMin: nn(results.map((r) => r.content.lastNoveltyMin)),
    medianDenseUntilMin: nn(results.map((r) => r.content.denseUntilMin)),
    medianPlateauStartMin: nn(results.map((r) => r.content.plateauStartMin)),
    medianEventSharePct: med(results.map((r) => r.economy.eventSharePct)),
    medianEventNetSharePct: med(results.map((r) => r.economy.eventNetSharePct)),
    medianAt10: med(results.map((r) => r.content.at10)),
    medianAt12: med(results.map((r) => r.content.at12)),
    medianAt20: med(results.map((r) => r.content.at20)),
    medianAt30: med(results.map((r) => r.content.at30)),
    medianTotalEarned: Math.round(med(results.map((r) => r.end.totalEarned))),
    meanActionKinds: +meanOf(results.flatMap((r) => r.buckets.map((b) => b.actionKinds))).toFixed(2),
    meanVariantEntropy: +meanOf(entropyPerBucket).toFixed(3),
    variantKindsCV: meanKinds === 0 ? 0 : +(sdKinds / meanKinds).toFixed(3),
    newContentPerBucket: bucketMedians((b) => b.newContent),
    newMechanicsPerBucket: bucketMedians((b) => b.newMechanics),
    actionKindsPerBucket: bucketMedians((b) => b.actionKinds),
    behavior,
    combo: {
      avgCombo: +meanOf(results.map((r) => r.combo.avgCombo)).toFixed(2),
      pctComboGE6: +meanOf(results.map((r) => r.combo.pctComboGE6)).toFixed(1),
      pctComboGE12: +meanOf(results.map((r) => r.combo.pctComboGE12)).toFixed(1),
      maxCombo: Math.max(...results.map((r) => r.combo.maxCombo)),
    },
  };
}

/** 只跑事件调度（不点击）的巡逻变体序列 —— 用于同 pattern 重复/熵统计 */
export function patrolVariantSequence(seed: number, minutes: number): BossVariant[] {
  const rng = lcg(seed);
  const es = newEventState();
  const seq: BossVariant[] = [];
  let prev = false;
  const total = Math.round((minutes * 60) / DT);
  for (let i = 0; i <= total; i++) {
    const t = i * DT;
    scheduleEvents(es, t, rng);
    const active = es.bossUntil > t;
    if (!prev && active) seq.push(es.bossVariant);
    prev = active;
  }
  return seq;
}

export function round(x: number, digits = 2): number {
  return +x.toFixed(digits);
}
