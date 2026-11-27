/**
 * probe-final-collect-daily.test.ts — 终验探针 ②：日报 3 目标 / 10 分钟可完成 / streak / 跨日 / 严格 restore
 * 只读 src/，不改 src/。引擎级模拟复刻 main.ts 的行为计数路径：
 *   click → doClick + dailyTrack("click")；meme → onMemeTap + collectQuote + dailyTrack("meme")
 *   buy → buyUpgrade + syncFlavorCollection + dailyTrack("buy")；patrol 结束 → finishPatrol + dailyTrack("survive")
 */
import { describe, it, expect } from "vitest";
import {
  DAILY_GOAL_TEMPLATES,
  rollDaily,
  ensureDaily,
  dailyTrack,
  dailyAllDone,
  claimDaily,
  dailyReward,
  restoreDaily,
  formatLocalDate,
  yesterdayLocal,
  yesterdayOf,
  type DailyState,
} from "../src/engine/daily";
import { initialState, type GameState } from "../src/engine/state";
import { advance } from "../src/engine/tick";
import { doClick, buyUpgrade } from "../src/engine/actions";
import { costOf, UPGRADES, effectOf } from "../src/engine/upgrades";
import { newEventState, scheduleEvents, onMemeTap, onBossTap, finishPatrol } from "../src/engine/events";
import { collectQuote, syncFlavorCollection } from "../src/engine/collection";
import { restore, serialize, SAVE_KEY, SAVE_VERSION, type SaveAdapter } from "../src/engine/save";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const GOAL_IDS = DAILY_GOAL_TEMPLATES.map((t) => t.id);

function makeDaily(ids: string[], date: string, prevStreak = 0): DailyState {
  return {
    date,
    goals: ids.map((id) => {
      const t = DAILY_GOAL_TEMPLATES.find((x) => x.id === id);
      if (!t) throw new Error(`unknown goal ${id}`);
      return { id: t.id, target: t.target, progress: 0, done: false };
    }),
    streak: prevStreak,
    lastCompleteDate: null,
    claimed: false,
  };
}

function completeAll(d: DailyState): DailyState {
  return { ...d, goals: d.goals.map((g) => ({ ...g, progress: g.target, done: true })) };
}

function memAdapter(raw?: string): SaveAdapter {
  let v = raw ?? null;
  return {
    getItem: (k) => (k === SAVE_KEY ? v : null),
    setItem: (_k, val) => {
      v = val;
    },
    removeItem: () => {
      v = null;
    },
  };
}

/** 一次「认真玩 10 分钟」的引擎级模拟；返回 3 目标全部完成的时刻（秒）与结算 */
function simulateSession(ids: string[], seed: number, maxSeconds = 600) {
  const date = "2026-11-27";
  let state: GameState = { ...initialState(), daily: makeDaily(ids, date) };
  const rng = lcg(seed);
  const es = newEventState();
  const DT = 0.25;
  const track = (kind: "click" | "meme" | "buy" | "survive", n = 1): void => {
    if (state.daily) state = { ...state, daily: dailyTrack(state.daily, kind, n) };
  };
  let t = 0;
  let prevBoss = false;
  let clickCredit = 0;
  let lastBuyAt = -10;
  let doneAtSec: number | null = null;
  const counters = { clicks: 0, memes: 0, buys: 0, survives: 0 };

  while (t <= maxSeconds) {
    scheduleEvents(es, t, rng);
    const bossActive = es.bossUntil > t;

    if (!bossActive) {
      // 休闲手速 2.5 cps
      clickCredit += 2.5 * DT;
      while (clickCredit >= 1) {
        clickCredit -= 1;
        state = doClick(state, 0);
        track("click");
        counters.clicks += 1;
      }
    } else if (es.bossVariant !== "hold" && es.bossTaps < (es.bossVariant === "blitz" ? 20 : 5)) {
      // type/blitz：点满任务（看横幅提示，非 hold 不罚）
      clickCredit += 4 * DT;
      while (clickCredit >= 1 && es.bossTaps < (es.bossVariant === "blitz" ? 20 : 5)) {
        clickCredit -= 1;
        state = onBossTap(state, es, t, 0).state;
        track("click");
        counters.clicks += 1;
      }
    }

    // 丢梗窗口：立即命中
    if (es.memeUntil > t) {
      const r = onMemeTap(state, es);
      state = collectQuote(r.state, 0).state;
      track("meme");
      counters.memes += 1;
    }

    // 每 2 秒尝试买最便宜的可负担升级
    if (t - lastBuyAt >= 2) {
      lastBuyAt = t;
      const cand = [...UPGRADES].sort((a, b) => costOf(a.id, state.levels[a.id] ?? 0) - costOf(b.id, state.levels[b.id] ?? 0))[0]!;
      const next = buyUpgrade(state, cand.id);
      if (next) {
        state = syncFlavorCollection(next);
        track("buy");
        counters.buys += 1;
      }
    }

    // 巡逻窗口结束结算
    if (prevBoss && !bossActive) {
      const r = finishPatrol(state, es);
      state = r.state;
      if (r.reward > 0) {
        track("survive");
        counters.survives += 1;
      }
    }
    prevBoss = bossActive;

    state = advance(state, DT);

    if (doneAtSec === null && dailyAllDone(state.daily!)) doneAtSec = t;
    t = Math.round((t + DT) * 1000) / 1000;
    if (doneAtSec !== null) break;
  }

  const reward = claimDaily(state, date);
  return {
    state: reward.state,
    doneAtSec,
    claimedReward: reward.claimedReward,
    counters,
    goals: state.daily!.goals,
  };
}

describe("② rollDaily：池 / 3 目标不重复", () => {
  it("模板池恰为 4 个（点 100 / 收 1 梗 / 买 3 级 / 应付 2 次巡逻）", () => {
    expect(DAILY_GOAL_TEMPLATES.map((t) => t.id).sort()).toEqual(["buy_3", "click_100", "meme_1", "survive_2"]);
    const byId = Object.fromEntries(DAILY_GOAL_TEMPLATES.map((t) => [t.id, t]));
    expect(byId["click_100"]!.target).toBe(100);
    expect(byId["meme_1"]!.target).toBe(1);
    expect(byId["buy_3"]!.target).toBe(3);
    expect(byId["survive_2"]!.target).toBe(2);
    expect(byId["survive_2"]!.desc).toContain("巡逻");
  });

  it("200 个种子：恒 3 目标、不重复、全来自池、初始态干净", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const d = rollDaily("2026-11-27", lcg(seed));
      expect(d.goals).toHaveLength(3);
      const ids = d.goals.map((g) => g.id);
      expect(new Set(ids).size).toBe(3);
      for (const id of ids) expect(GOAL_IDS).toContain(id);
      expect(d.goals.every((g) => g.progress === 0 && !g.done)).toBe(true);
      expect(d.claimed).toBe(false);
      expect(d.date).toBe("2026-11-27");
    }
  });

  it("确定性分支：rng=0 → 前 3 个模板；rng→1 → 后 3 个模板（均不重复）", () => {
    expect(rollDaily("2026-11-27", () => 0).goals.map((g) => g.id)).toEqual(["click_100", "meme_1", "buy_3"]);
    expect(rollDaily("2026-11-27", () => 0.999999).goals.map((g) => g.id)).toEqual(["survive_2", "buy_3", "meme_1"]);
  });
});

describe("② 10 分钟内可完成（引擎模拟点击/收梗/购买/巡逻）", () => {
  const triples: string[][] = [];
  for (const a of GOAL_IDS) for (const b of GOAL_IDS) for (const c of GOAL_IDS) if (a < b && b < c) triples.push([a, b, c]);
  expect(triples).toHaveLength(4);

  for (const triple of triples) {
    it(`${triple.join(" + ")}：3 个种子均在 600s 内全完成并可领`, () => {
      for (const seed of [7, 42, 2026]) {
        const r = simulateSession(triple, seed);
        const tag = `[${triple.join(",")} seed=${seed}]`;
        expect(r.doneAtSec, `${tag} 未在 600s 内完成`).not.toBeNull();
        expect(r.doneAtSec!, tag).toBeLessThanOrEqual(600);
        expect(r.goals.every((g) => g.done), `${tag} 仍有未完成目标`).toBe(true);
        expect(r.goals.map((g) => g.id).sort(), tag).toEqual([...triple].sort());
        expect(r.claimedReward, tag).not.toBeNull();
        expect(r.claimedReward!, tag).toBe(Math.max(500, 60 * effectOf(r.state).idleRate));
        expect(r.state.daily!.claimed, tag).toBe(true);
        expect(r.state.daily!.streak, tag).toBe(1);
        // 模拟里当日目标涉及的行为都真实发生过（未涉及的不强制）
        if (triple.includes("click_100")) expect(r.counters.clicks, tag).toBeGreaterThanOrEqual(100);
        if (triple.includes("meme_1")) expect(r.counters.memes, tag).toBeGreaterThanOrEqual(1);
        if (triple.includes("buy_3")) expect(r.counters.buys, tag).toBeGreaterThanOrEqual(3);
        if (triple.includes("survive_2")) expect(r.counters.survives, tag).toBeGreaterThanOrEqual(2);
      }
    });
  }

  it("完整 10 分钟会话的完成时刻留有大量余量（< 420s）", () => {
    for (const triple of triples) {
      const r = simulateSession(triple, 99);
      console.log(`[final-daily] ${triple.join("+")} doneAt=${r.doneAtSec}s clicks=${r.counters.clicks} memes=${r.counters.memes} buys=${r.counters.buys} survives=${r.counters.survives}`);
      expect(r.doneAtSec!).toBeLessThan(420);
    }
  });
});

describe("② 领取门禁：仅全完成可领、只领一次、日期对齐", () => {
  it("未全完成/缺日报/日期不符/已领 → 不发奖且状态不变", () => {
    const s0: GameState = { ...initialState(), daily: makeDaily(["click_100", "meme_1", "buy_3"], "2026-11-27") };
    expect(claimDaily(s0, "2026-11-27").claimedReward).toBeNull();
    expect(claimDaily(s0, "2026-11-28").claimedReward).toBeNull();
    expect(claimDaily({ ...s0, daily: null }, "2026-11-27").claimedReward).toBeNull();

    const oneDone: GameState = {
      ...s0,
      daily: { ...s0.daily!, goals: s0.daily!.goals.map((g, i) => (i === 0 ? { ...g, progress: g.target, done: true } : g)) },
    };
    expect(claimDaily(oneDone, "2026-11-27").claimedReward).toBeNull();

    const all = { ...s0, daily: completeAll(s0.daily!) };
    const first = claimDaily(all, "2026-11-27");
    expect(first.claimedReward).toBe(500);
    expect(first.state.daily!.claimed).toBe(true);
    const second = claimDaily(first.state, "2026-11-27");
    expect(second.claimedReward).toBeNull();
    expect(second.state.moyu).toBe(first.state.moyu);
    expect(second.state.daily).toEqual(first.state.daily);
  });

  it("奖励公式 = max(500, 60 × idleRate)，且余额与累计同步入账", () => {
    const s: GameState = { ...initialState(), levels: { phone: 5 } }; // 里程碑后 10.2/s
    const d = completeAll(makeDaily(["click_100", "meme_1", "buy_3"], "2026-11-27"));
    const r = claimDaily({ ...s, daily: d }, "2026-11-27");
    const idleRate = effectOf({ ...s, daily: d }).idleRate;
    expect(idleRate).toBeCloseTo(10.2, 6);
    expect(dailyReward({ ...s, daily: d })).toBe(Math.max(500, 60 * idleRate));
    expect(r.claimedReward).toBe(612);
    expect(r.state.moyu).toBe(612);
    expect(r.state.totalEarned).toBe(612);
    // 保底 500（无升级，挂机 = 0.2/s）
    const base = claimDaily({ ...initialState(), daily: d }, "2026-11-27");
    expect(base.claimedReward).toBe(500);
  });
});

describe("② streak：连续 / 断档 / 跨月跨年", () => {
  it("连续 3 天：streak 1→2→3，中途 ensureDaily 保留", () => {
    let s: GameState = { ...initialState() };
    s = ensureDaily(s, "2026-11-25", lcg(1));
    expect(dailyAllDone(s.daily!)).toBe(false);
    s = { ...s, daily: completeAll(s.daily!) };
    let r = claimDaily(s, "2026-11-25");
    expect(r.claimedReward).not.toBeNull();
    s = r.state;
    expect(s.daily!.streak).toBe(1);

    s = ensureDaily(s, "2026-11-26", lcg(2));
    expect(s.daily!.streak).toBe(1); // 连胜保留到新一天（未领不涨）
    s = { ...s, daily: completeAll(s.daily!) };
    r = claimDaily(s, "2026-11-26");
    s = r.state;
    expect(s.daily!.streak).toBe(2);

    s = ensureDaily(s, "2026-11-27", lcg(3));
    s = { ...s, daily: completeAll(s.daily!) };
    s = claimDaily(s, "2026-11-27").state;
    expect(s.daily!.streak).toBe(3);
    expect(s.daily!.lastCompleteDate).toBe("2026-11-27");
  });

  it("断档 1 天：streak 归 1 重计", () => {
    let s: GameState = { ...initialState() };
    s = ensureDaily(s, "2026-11-25", lcg(4));
    s = claimDaily({ ...s, daily: completeAll(s.daily!) }, "2026-11-25").state;
    expect(s.daily!.streak).toBe(1);
    // 跳过 26 日，直接到 27 日
    s = ensureDaily(s, "2026-11-27", lcg(5));
    expect(s.daily!.streak).toBe(0);
    s = { ...s, daily: completeAll(s.daily!) };
    s = claimDaily(s, "2026-11-27").state;
    expect(s.daily!.streak).toBe(1);
  });

  it("跨月（03-01 ← 02-28）与跨年（01-01 ← 12-31）连续成立", () => {
    // 跨月
    let s: GameState = { ...initialState() };
    s = ensureDaily(s, "2026-02-28", lcg(6));
    s = claimDaily({ ...s, daily: completeAll(s.daily!) }, "2026-02-28").state;
    s = ensureDaily(s, "2026-03-01", lcg(7));
    expect(s.daily!.streak).toBe(1);
    s = claimDaily({ ...s, daily: completeAll(s.daily!) }, "2026-03-01").state;
    expect(s.daily!.streak).toBe(2);
    // 跨年
    let y: GameState = { ...initialState() };
    y = ensureDaily(y, "2025-12-31", lcg(8));
    y = claimDaily({ ...y, daily: completeAll(y.daily!) }, "2025-12-31").state;
    y = ensureDaily(y, "2026-01-01", lcg(9));
    expect(y.daily!.streak).toBe(1);
    y = claimDaily({ ...y, daily: completeAll(y.daily!) }, "2026-01-01").state;
    expect(y.daily!.streak).toBe(2);
  });
});

describe("② 跨日重掷与本地日期", () => {
  it("同日 ensureDaily 幂等（引用不变）；跨日重掷清空进度、streak 按连续性保留", () => {
    const s1 = ensureDaily(initialState(), "2026-11-27", lcg(11));
    expect(ensureDaily(s1, "2026-11-27", lcg(12))).toBe(s1);
    const s2 = ensureDaily(s1, "2026-11-28", lcg(13));
    expect(s2.daily!.date).toBe("2026-11-28");
    expect(s2.daily!.goals).toHaveLength(3);
    expect(new Set(s2.daily!.goals.map((g) => g.id)).size).toBe(3);
    expect(s2.daily!.goals.every((g) => g.progress === 0 && !g.done)).toBe(true);
    expect(s2.daily!.claimed).toBe(false);
    expect(s2.daily!.streak).toBe(0); // 昨天未领 → 断
    // 跨日不清空图鉴/等级/连胜（只换日报）
    expect(s2.collected).toEqual(s1.collected);
    expect(s2.levels).toEqual(s1.levels);
  });

  it("formatLocalDate 用本地日期，不受 UTC 偏移影响；yesterdayLocal 处理月/年/闰年", () => {
    expect(formatLocalDate(new Date(2026, 10, 27, 0, 0, 0))).toBe("2026-11-27");
    expect(formatLocalDate(new Date(2026, 2, 1, 23, 59, 59))).toBe("2026-03-01");
    expect(formatLocalDate(new Date(2026, 0, 1, 0, 30, 0))).toBe("2026-01-01");
    expect(yesterdayLocal("2026-11-27")).toBe("2026-11-26");
    expect(yesterdayLocal("2026-03-01")).toBe("2026-02-28");
    expect(yesterdayLocal("2024-03-01")).toBe("2024-02-29"); // 闰年
    expect(yesterdayLocal("2026-01-01")).toBe("2025-12-31");
    expect(yesterdayOf("2026-01-01")).toBe(yesterdayLocal("2026-01-01"));
    // 2026 全年逐日回退与本地 Date 一致
    for (let m = 0; m < 12; m++) {
      for (const day of [1, 15, 28]) {
        const cur = new Date(2026, m, day, 12, 0, 0);
        const prev = new Date(2026, m, day - 1, 12, 0, 0);
        expect(yesterdayLocal(formatLocalDate(cur))).toBe(formatLocalDate(prev));
      }
    }
  });
});

describe("② 严格 restore：非法存档被拒/收敛", () => {
  const validGoal = { id: "click_100", target: 100, progress: 12, done: false };
  const valid = (): Record<string, unknown> => ({
    date: "2026-11-27",
    goals: [validGoal, { id: "meme_1", target: 1, progress: 0, done: false }, { id: "buy_3", target: 3, progress: 1, done: false }],
    streak: 2,
    lastCompleteDate: "2026-11-26",
    claimed: false,
  });
  const bad: [string, unknown][] = [
    ["null", null],
    ["非对象", "x"],
    ["缺 date", { ...valid(), date: 123 }],
    ["goals 非数组", { ...valid(), goals: "x" }],
    ["2 个目标", { ...valid(), goals: (valid().goals as unknown[]).slice(0, 2) }],
    ["4 个目标", { ...valid(), goals: [...(valid().goals as unknown[]), validGoal] }],
    ["缺 claimed", (({ claimed: _c, ...rest }) => rest)(valid())],
    ["claimed 非布尔", { ...valid(), claimed: "no" }],
    ["目标为 null", { ...valid(), goals: [null, validGoal, validGoal] }],
    ["id 非字符串", { ...valid(), goals: [{ ...validGoal, id: 1 }, validGoal, validGoal] }],
    ["target=0", { ...valid(), goals: [{ ...validGoal, target: 0 }, validGoal, validGoal] }],
    ["target 负", { ...valid(), goals: [{ ...validGoal, target: -5 }, validGoal, validGoal] }],
    ["target NaN", { ...valid(), goals: [{ ...validGoal, target: NaN }, validGoal, validGoal] }],
    ["target Infinity", { ...valid(), goals: [{ ...validGoal, target: Infinity }, validGoal, validGoal] }],
    ["progress 负", { ...valid(), goals: [{ ...validGoal, progress: -1 }, validGoal, validGoal] }],
    ["progress NaN", { ...valid(), goals: [{ ...validGoal, progress: NaN }, validGoal, validGoal] }],
    ["progress 字符串", { ...valid(), goals: [{ ...validGoal, progress: "3" }, validGoal, validGoal] }],
    ["done 非布尔", { ...valid(), goals: [{ ...validGoal, done: 1 }, validGoal, validGoal] }],
  ];

  it("非法形状全部返回 null", () => {
    for (const [name, raw] of bad) {
      expect(restoreDaily(raw), name).toBeNull();
    }
  });

  it("合法形状保留并夹取 progress ≤ target；streak 非法整档拒绝（R5 收紧）", () => {
    const d = restoreDaily(valid())!;
    expect(d).not.toBeNull();
    expect(d.date).toBe("2026-11-27");
    expect(d.goals).toHaveLength(3);
    expect(d.streak).toBe(2);
    expect(d.lastCompleteDate).toBe("2026-11-26");
    const over = restoreDaily({ ...valid(), goals: [{ ...validGoal, progress: 999 }, validGoal, validGoal] })!;
    expect(over.goals[0]!.progress).toBe(100);
    // streak 非整数/负数/字符串 → 整档拒绝（R5 收紧：不信任脏值，也不静默收敛）
    expect(restoreDaily({ ...valid(), streak: 2.5 })).toBeNull();
    expect(restoreDaily({ ...valid(), streak: -3 })).toBeNull();
    expect(restoreDaily({ ...valid(), streak: "3" })).toBeNull();
    expect(restoreDaily({ ...valid(), lastCompleteDate: 42 })!.lastCompleteDate).toBeNull();
  });

  it("经 save.restore：日报非法 → daily=null（游戏不崩）；字段非法级别更高的档整档作废", () => {
    const base = {
      v: SAVE_VERSION,
      moyu: 100,
      totalEarned: 100,
      levels: { coffee: 1 },
      savedAt: Date.now(),
      createdAt: Date.now(),
      collected: { quotes: [0], flavors: [0] },
    };
    const withBadDaily = { ...base, daily: { date: "2026-11-27", goals: [], claimed: false } };
    const r = restore(memAdapter(JSON.stringify(withBadDaily)), Date.now());
    expect(r.state!.daily).toBeNull();
    expect(r.state!.moyu).toBe(100);
    expect(r.state!.collected.quotes).toEqual([0]);

    const badLevels = { ...base, levels: [1, 2] };
    expect(restore(memAdapter(JSON.stringify(badLevels)), Date.now()).state!.moyu).toBe(0);
    const badVersion = { ...base, v: 999 };
    expect(restore(memAdapter(JSON.stringify(badVersion)), Date.now()).state!.moyu).toBe(0);
    const badJson = "{not json";
    expect(restore(memAdapter(badJson), Date.now()).state!.moyu).toBe(0);
  });

  it("日报 round-trip：合法日报 serialize → restore 等值", () => {
    const s: GameState = { ...initialState(), daily: { ...completeAll(makeDaily(["click_100", "meme_1", "buy_3"], "2026-11-27")), streak: 4, lastCompleteDate: "2026-11-26", claimed: true } };
    const a = memAdapter();
    serialize(s, a, Date.now());
    const back = restore(a, Date.now()).state!;
    expect(back.daily).toEqual(s.daily);
  });
});
