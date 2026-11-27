/**
 * R13 赌徒党引擎探针（针对 2026-11-27 17:56 后的当前工作区版本重写）：
 * 核对开发组刚合的修复是否真的落地，并继续找"赌"的问题。
 * 只读 src/，不改 src/。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { initialState, gain } from "../src/engine/state";
import {
  CARDS,
  CARD_DURATION,
  chooseCard,
  cardEffects,
  ensureCards,
  rollOffers,
  activeCard,
  dismissCards,
} from "../src/engine/cards";
import { offlineEfficiency } from "../src/engine/progression";
import { effectOf } from "../src/engine/upgrades";
import {
  PERSONALITIES,
  CHOICES,
  resolveBossChoice,
  CHOICE_SECONDS,
  CHOICE_CORRECT_MULT,
  CHOICE_WRONG_PENALTY_RATIO,
} from "../src/engine/boss-choice";
import {
  newEventState,
  scheduleEvents,
  finishPatrol,
  onBossChoice,
  bossSurviveReward,
} from "../src/engine/events";
import { surviveStreakMult } from "../src/engine/events";
import { serialize, restore, SAVE_KEY, type SaveAdapter } from "../src/engine/save";

const DAY = 86_400_000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cardsState(id: string, until: number, extra: Partial<{ date: string; nextDayGuaranteed: string | null; dismissed: boolean }> = {}) {
  return {
    date: extra.date ?? "2026-11-27",
    offers: ["overtime", "coffee_day", "quiet_day"],
    chosen: id,
    until,
    nextDayGuaranteed: extra.nextDayGuaranteed ?? null,
    dismissed: extra.dismissed ?? false,
  };
}

function stateWithCard(id: string, until = Date.now() + 3600_000) {
  return { ...initialState(), cards: cardsState(id, until) };
}

function memAdapter(): { adapter: SaveAdapter; mem: Map<string, string> } {
  const mem = new Map<string, string>();
  return {
    mem,
    adapter: {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    },
  };
}

describe("R13 修复核对：稀有卡风险现在真的算了（24h 内离线 -20%）", () => {
  it("通宵摸鱼：离线效率从 0.7 掉到 0.5（-0.2 生效）", () => {
    const base = initialState();
    const now = Date.now();
    const createdAt = now - 5 * DAY;
    const noCard = offlineEfficiency(base, createdAt, now);
    const withOvertime = offlineEfficiency(stateWithCard("overtime", now + DAY), createdAt, now);
    console.log(`[risk] 不选卡离线效率=${noCard.toFixed(3)} / 通宵摸鱼=${withOvertime.toFixed(3)}（差 ${(noCard - withOvertime).toFixed(3)}）`);
    expect(cardEffects(stateWithCard("overtime"), now).riskPenalty).toBe(0.2);
    expect(noCard - withOvertime).toBeCloseTo(0.2, 5);
  });

  it("但新手首日（建档 <24h）离线效率恒为 1 → 首日稀有卡是纯收益、零风险", () => {
    const s = stateWithCard("overtime");
    const now = Date.now();
    const firstDay = offlineEfficiency(s, now - 1000, now);
    console.log(`[risk] 建档 1 秒的玩家选通宵摸鱼：离线效率=${firstDay}（-20% 被首日保护吃掉）`);
    expect(firstDay).toBe(1);
  });

  it("通宵摸鱼 +60% 挂机确实生效（好处立刻到手）", () => {
    const base = initialState();
    const withCard = stateWithCard("overtime");
    const r0 = effectOf(base).idleRate;
    const r1 = effectOf(withCard).idleRate;
    console.log(`[idle] 不选卡=${r0.toFixed(3)}/s 选通宵摸鱼=${r1.toFixed(3)}/s（×${(r1 / r0).toFixed(2)}）`);
    expect(r1 / r0).toBeCloseTo(1.6, 3);
  });
});

describe("R13 修复核对：巡逻密度现在吃卡了（eventRateMult）", () => {
  it("全员大会 eventRateMult=2 → 巡逻间隔减半", () => {
    const mk = (rate: number) => {
      const es = newEventState();
      const rng = mulberry32(2024);
      scheduleEvents(es, 0, rng, rate);
      return es.nextBossAt;
    };
    const normal = mk(1);
    const dense = mk(2);
    console.log(`[density] 正常首巡=${normal.toFixed(2)}s / 全员大会=${dense.toFixed(2)}s（×${(normal / dense).toFixed(2)}）`);
    expect(normal / dense).toBeCloseTo(2, 5);
    const src = readFileSync("src/main.ts", "utf8");
    console.log(`[density] main.ts 是否把 cardEffects.eventRateMult 传给调度: ${src.includes("cardEffects(state, Date.now()).eventRateMult")}`);
    expect(src.includes("cardEffects(state, Date.now()).eventRateMult")).toBe(true);
  });

  it("全员大会 + 连胜 4 + 选对：单次选对 = 220+（这里是真的爽点）", () => {
    const s = { ...stateWithCard("big_meeting"), surviveStreak: 4 };
    const es = { ...newEventState(), bossVariant: "choice" as const, surviveStreak: 4, patrolCount: 10 };
    const base = bossSurviveReward(s, { ...es, bossCaught: false });
    const correct = Math.floor(base * CHOICE_CORRECT_MULT);
    console.log(`[reward] 全员大会下 base=${Math.round(base)}（=50×连胜×2）选对=+${correct}，选错=-${Math.floor(base * 0.6)}`);
    expect(surviveStreakMult(4)).toBeCloseTo(1.4, 5);
    expect(correct).toBeGreaterThan(220);
  });
});

describe("R13 修复核对：卡的 24h 时长 / 跳过 / HUD / 到期边界", () => {
  it("24h 内跨天不清卡（只更新 date），不再零点清零", () => {
    const now = Date.now();
    const s = { ...initialState(), cards: cardsState("overtime", now + 20 * 3600_000) };
    const nextDay = ensureCards(s, "2026-11-28", mulberry32(1), now);
    console.log(`[duration] 跨天但未到 24h：chosen=${nextDay.cards.chosen} date=${nextDay.cards.date}`);
    expect(nextDay.cards.chosen).toBe("overtime");
    expect(nextDay.cards.date).toBe("2026-11-28");
    // 24h 到期后换池
    const expired = ensureCards(s, "2026-11-29", mulberry32(2), now + 25 * 3600_000);
    console.log(`[duration] 超过 24h 后：chosen=${expired.cards.chosen}（换新卡池）`);
    expect(expired.cards.chosen).toBe(null);
  });

  it("P1 边界漏洞：同一自然日卡到期后重载，会重弹「同一批旧卡」再选一次", () => {
    const now = Date.now();
    const { adapter, mem } = memAdapter();
    const s = { ...initialState(), cards: cardsState("overtime", now - 1000) }; // 已过期
    serialize(s, adapter, now);
    // 模拟 restore 时把已过期选择清掉
    const blob = JSON.parse(mem.get(SAVE_KEY)!);
    blob.cards.until = now - 1000;
    mem.set(SAVE_KEY, JSON.stringify(blob));
    const restored = restore(adapter, now);
    console.log(`[expiry] restore 后 chosen=${restored.state.cards?.chosen} offers=${restored.state.cards?.offers.length}`);
    expect(restored.state.cards?.chosen).toBe(null);
    const again = ensureCards(restored.state, "2026-11-27", mulberry32(3), now);
    const modalWouldShow = !!(again.cards && !again.cards.chosen && !again.cards.dismissed && again.cards.offers.length > 0);
    console.log(`[expiry] 同日再 ensureCards：offers=${again.cards?.offers.join(",")} → 弹窗会重新出现=${modalWouldShow}（可再选一张）`);
    expect(modalWouldShow).toBe(true);
  });

  it("HUD 现在常驻显示今日卡（修复了选完就看不见）", () => {
    const hud = readFileSync("src/ui/hud.ts", "utf8");
    expect(hud.includes("今日卡：")).toBe(true);
    expect(hud.includes("elCard")).toBe(true);
    console.log("[hud] hud.ts 含『今日卡：』常驻文本 = true（但只有名字，没有剩余时长/效果）");
  });

  it("跳过：dismissCards 置位后不再自动弹出（但关闭面板=丢当天卡，且无重新打开入口）", () => {
    const s = { ...initialState(), cards: cardsState("", 0, { date: "2026-11-27" }) };
    s.cards.chosen = null;
    s.cards.offers = ["overtime", "coffee_day", "quiet_day"];
    const skipped = dismissCards(s);
    expect(skipped.cards.dismissed).toBe(true);
    const panel = readFileSync("src/ui/card-panel.ts", "utf8");
    console.log(`[skip] card-panel 检查 dismissed: ${panel.includes("cs.dismissed")}；main.ts 是否有"重新打开卡面板"的按钮: ${readFileSync("src/main.ts", "utf8").includes("cardPanel.show(")}`);
    expect(panel.includes("cs.dismissed")).toBe(true);
    // 全仓除 maybeShow 外没有任何 cardPanel.show 调用 → 跳过/选完后无法再查看卡详情
    const main = readFileSync("src/main.ts", "utf8");
    const showCalls = (main.match(/cardPanel\.show\(/g) ?? []).length;
    console.log(`[skip] main.ts 中 cardPanel.show() 调用次数=${showCalls}（0 = 跳过/选完无入口查看/反悔）`);
    expect(showCalls).toBe(0);
  });

  it("首日不拦：需戳 8 下或开页 12 秒后才弹卡（修复了一进来就被弹窗拦住）", () => {
    const panel = readFileSync("src/ui/card-panel.ts", "utf8");
    console.log(`[onboard] 首日门槛存在=${panel.includes("totalClicks < 8")}，12s 门槛存在=${panel.includes("12_000")}`);
    expect(panel.includes("totalClicks < 8")).toBe(true);
    expect(panel.includes("12_000")).toBe(true);
  });
});

describe("R13 每日卡池：开箱手感（10 张池的随机寿命）", () => {
  it("10000 天抽卡分布 + 10 张池多久见完", () => {
    const rng = mulberry32(42);
    const rarityOf = new Map(CARDS.map((c) => [c.id, c.rarity]));
    const N = 10000;
    let allCommon = 0;
    let hasRareOrEvent = 0;
    let hasEvent = 0;
    let hasOvertime = 0;
    for (let i = 0; i < N; i++) {
      const cs = rollOffers("2026-11-27", rng, null);
      const rs = cs.offers.map((id) => rarityOf.get(id)!);
      if (rs.every((r) => r === "common")) allCommon++;
      if (rs.some((r) => r !== "common")) hasRareOrEvent++;
      if (rs.includes("event")) hasEvent++;
      if (cs.offers.includes("overtime")) hasOvertime++;
    }
    console.log(
      `[roll] 全普通 ${(allCommon / N * 100).toFixed(1)}% | 至少 1 稀有/剧情 ${(hasRareOrEvent / N * 100).toFixed(1)}% | 有剧情 ${(hasEvent / N * 100).toFixed(1)}% | 有通宵摸鱼 ${(hasOvertime / N * 100).toFixed(1)}%`,
    );
    const seenByDay = [1, 3, 5, 8].map((d) => {
      const r = mulberry32(100 + d);
      let sum = 0;
      const M = 2000;
      for (let i = 0; i < M; i++) {
        const seen = new Set<string>();
        for (let day = 0; day < d; day++) rollOffers("2026-11-27", r, null).offers.forEach((id) => seen.add(id));
        sum += seen.size;
      }
      return `第${d}天 ${(sum / M).toFixed(1)}/10`;
    });
    console.log(`[roll] 平均已见卡: ${seenByDay.join(" | ")}`);
    let repeat = 0;
    {
      const r = mulberry32(777);
      const M = 3000;
      for (let i = 0; i < M; i++) {
        const seen = new Set<string>();
        let rep = false;
        for (let day = 0; day < 8; day++) {
          const offers = rollOffers("2026-11-27", r, null).offers;
          if (day === 7 && offers.every((id) => seen.has(id))) rep = true;
          offers.forEach((id) => seen.add(id));
        }
        if (rep) repeat++;
      }
    }
    console.log(`[roll] 第 8 天 3 张全是旧卡的概率 ≈ ${(repeat / 3000 * 100).toFixed(1)}%`);
    expect(allCommon / N).toBeGreaterThan(0.3);
    expect(hasRareOrEvent / N).toBeGreaterThan(0.55);
  });

  it("稀有度 ≠ 价值：早期 3 张里可能 2 张无收益（无同事→派遣卡；不关机→离线卡）", () => {
    const s = initialState();
    console.log(`[trap] 初始同事数=${Object.keys(s.team.colleagues).length}；此阶段『团建吃饭/老周的秘密』派遣加成为 0；『提前下班』只在离线时结算`);
    expect(Object.keys(s.team.colleagues).length).toBe(0);
  });

  it("HR约谈文案已改成『明天卡池保证出一张稀有卡』，与实现一致", () => {
    const desc = CARDS.find((c) => c.id === "hr_talk")!.desc;
    console.log(`[story] HR约谈 desc = ${desc}`);
    expect(desc.includes("稀有卡")).toBe(true);
    const s = { ...initialState(), cards: { ...cardsState(null as unknown as string, Date.now() + DAY, { nextDayGuaranteed: "secret_project" }) } };
    s.cards.chosen = null;
    s.cards.offers = ["hr_talk", "coffee_day", "quiet_day"];
    const p = chooseCard(s, "hr_talk", Date.now());
    expect(p).not.toBeNull();
    const next = ensureCards(p!, "2026-11-28", mulberry32(9), Date.now() + 25 * 3600_000);
    console.log(`[story] 次日保底卡：${next.cards.offers.map((id) => CARDS.find((c) => c.id === id)?.name).join(" / ")}`);
    expect(next.cards.offers).toContain("secret_project");
  });
});

describe("R13 回合制老板：赌博结构（5s 窗口 / 新手宽限 / 迟到点击无效）", () => {
  it("窗口常量=5s，但读屏播报还写着 4 秒（文案不一致）", () => {
    const src = readFileSync("src/main.ts", "utf8");
    console.log(`[a11y] CHOICE_SECONDS=${CHOICE_SECONDS}；main.ts 播报含"4 秒"=${src.includes("在 4 秒内选对应对")}`);
    expect(CHOICE_SECONDS).toBe(5);
    expect(src.includes("在 4 秒内选对应对")).toBe(true);
  });

  it("线索=答案：性格名直接包含答案关键词（无需推断，也不是赌）", () => {
    for (const p of PERSONALITIES) {
      const label = CHOICES.find((c) => c.id === p.correct)!.label;
      console.log(`[clue] ${p.name}（${p.tell}）→ 【${label}】`);
    }
    expect(new Set(PERSONALITIES.map((p) => p.correct)).size).toBe(3);
  });

  it("新手前 3 次巡逻选错不扣钱（只丢连胜）；老玩家选错 -0.6×base", () => {
    const es = { ...newEventState(), bossVariant: "choice" as const, bossUntil: 100000, patrolCount: 2, surviveStreak: 3 };
    const s = { ...initialState(), moyu: 1000, surviveStreak: 3 };
    const rookie = onBossChoice(s, es, "keep-slacking", 1000);
    console.log(`[rookie] 第 3 次巡逻选错（宽限内）：delta=${rookie!.delta} 连胜 ${rookie!.state.surviveStreak}`);
    expect(Math.abs(rookie!.delta)).toBe(0); // -0 也算 0
    expect(rookie!.state.surviveStreak).toBe(0);
    const vetEs = { ...newEventState(), bossVariant: "choice" as const, bossUntil: 999, patrolCount: 10 };
    const vet = resolveBossChoice({ ...s, moyu: 1e6 }, "hasty", "keep-slacking", 100);
    console.log(`[vet] base=100 选错：${vet.delta}（-60）`);
    expect(vet.delta).toBe(-60);
  });

  it("窗口外迟到点击不再结算（5s 过后点了也不算）", () => {
    const es = { ...newEventState(), bossVariant: "choice" as const, bossUntil: 100 };
    const late = onBossChoice({ ...initialState(), moyu: 100 }, es, "act-busy", 101);
    console.log(`[window] now=101 > bossUntil=100 → 结算结果=${late}`);
    expect(late).toBe(null);
  });

  it("选择期间点画布不再按偷点罚款（bossPanel.isOpen 直接吞掉 canvas 点击）", () => {
    const src = readFileSync("src/main.ts", "utf8");
    console.log(`[tap] doTap 里拦截选择中画布点击=${src.includes("if (bossPanel.isOpen) return;")}`);
    expect(src.includes("if (bossPanel.isOpen) return;")).toBe(true);
  });

  it("超时：无奖、不罚、连胜不变，现在有『没来得及选…这次不算』提示", () => {
    const es = { ...newEventState(), bossVariant: "choice" as const, bossUntil: 100, surviveStreak: 4 };
    scheduleEvents(es, 101, mulberry32(11));
    const s = { ...initialState(), moyu: 500, surviveStreak: 4 };
    const r = finishPatrol(s, es);
    console.log(`[timeout] 奖励=${r.reward} 余额变化=${r.state.moyu - s.moyu} 连胜=${r.state.surviveStreak}`);
    expect(r.reward).toBe(0);
    expect(r.state.moyu).toBe(s.moyu);
    const main = readFileSync("src/main.ts", "utf8");
    console.log(`[timeout] 超时提示存在=${main.includes("没来得及选…这次不算")}`);
    expect(main.includes("没来得及选…这次不算")).toBe(true);
  });

  it("赌博期望：盲猜 3 选 1 期望仍为正（+0.33×base），赌不亏", () => {
    const ev = (CHOICE_CORRECT_MULT - 2 * CHOICE_WRONG_PENALTY_RATIO) / 3;
    console.log(`[ev] 盲猜期望=${ev.toFixed(3)}×base（>0，赌不亏；且前 3 次选错免费）`);
    expect(ev).toBeGreaterThan(0);
  });
});
