/**
 * R13 赌徒党 · 第二轮复验探针（HEAD e4464d9 + round-2 修复）
 * 核对：线索去名 / 赔率 1.8:1.0 盲猜负期望 / 16 张卡池 / 跳过即关 / 1.2s 防误触 / 跨天再选 / 首次巡逻是否优先 choice
 * 只读 src/，不改 src/。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { initialState } from "../src/engine/state";
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
import { newEventState, scheduleEvents, finishPatrol, onBossChoice, pickBossVariant } from "../src/engine/events";

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

function cardState(id: string | null, until: number, extra: Partial<{ date: string; chosenDate: string; nextDayGuaranteed: string | null; dismissed: boolean }> = {}) {
  return {
    date: extra.date ?? "2026-11-27",
    offers: ["overtime", "coffee_day", "quiet_day"],
    chosen: id,
    until,
    nextDayGuaranteed: extra.nextDayGuaranteed ?? null,
    dismissed: extra.dismissed ?? false,
    chosenDate: extra.chosenDate ?? "",
  };
}

describe("R2-① 线索去名：横幅还能不能一眼看出答案", () => {
  it("tell 里不再包含性格名；但行为描述仍与答案近似一一映射", () => {
    const src = readFileSync("src/ui/boss-panel.ts", "utf8");
    console.log(`[clue] 面板模板含「有人过来了——」=${src.includes("有人过来了——")}；含 p.name=${src.includes("${p.name}走过来了")}`);
    expect(src.includes("有人过来了——")).toBe(true);
    expect(src.includes("${p.name}走过来了")).toBe(false);
    const names = ["安总", "王总", "老李"];
    for (const p of PERSONALITIES) {
      const label = CHOICES.find((c) => c.id === p.correct)!.label;
      const leaks = names.filter((n) => p.tell.includes(n));
      console.log(`[clue] 行为线索=「${p.tell}」 → 正确应对【${label}】（含名字泄露=${leaks.length}）`);
      expect(leaks.length).toBe(0);
    }
    // 行为→答案的语义接近直译：盯屏幕→切屏、快步→装忙、看手机发呆→继续摸鱼
    console.log("[clue] 推断难度：仍需 1 步联想，但三个线索与三个答案几乎一一对应 → 学 1 次后仍是确定题");
    console.log("[clue] 唯一泄露：结算台词（选后才出现）「王总：屏幕挺干净啊。」会在答完后揭露名字");
  });

  it("5 秒窗口 / 赔率 1.8 : 1.0（盲猜期望 = -0.067，负期望）", () => {
    console.log(`[odds] 正确 ×${CHOICE_CORRECT_MULT} / 错误 ×${CHOICE_WRONG_PENALTY_RATIO}`);
    const blind = (1 / 3) * CHOICE_CORRECT_MULT - (2 / 3) * CHOICE_WRONG_PENALTY_RATIO;
    console.log(`[odds] 盲猜 3 选 1 期望 = ${blind.toFixed(4)} × base（<0 盲猜亏）`);
    console.log(`[odds] 但超时=0（不选不亏）→ 最优策略是"没读准就等它过"，赌是被惩罚的选项`);
    expect(CHOICE_CORRECT_MULT).toBe(1.8);
    expect(CHOICE_WRONG_PENALTY_RATIO).toBe(1.0);
    expect(blind).toBeLessThan(0);
    expect(CHOICE_SECONDS).toBe(5);
  });

  it("实扣金额：base=50 时 选对 +90 / 选错 -50 / 超时 0", () => {
    const s = { ...initialState(), moyu: 1e6 };
    const right = resolveBossChoice(s, "hasty", "act-busy", 50);
    const wrong = resolveBossChoice(s, "hasty", "keep-slacking", 50);
    console.log(`[odds] base=50 → 选对 +${right.delta} / 选错 ${wrong.delta} / 超时 0（_ratio 1.0 = 扣掉一次"安然"的全部收益）`);
    expect(right.delta).toBe(90);
    expect(wrong.delta).toBe(-50);
  });

  it("新手前 3 次巡逻选错仍免罚（教学），第 4 次起真扣", () => {
    const es = { ...newEventState(), bossVariant: "choice" as const, bossUntil: 1e9, patrolCount: 2 };
    const s = { ...initialState(), moyu: 1000 };
    const rookie = onBossChoice(s, es, "keep-slacking", 1000);
    console.log(`[rookie] patrolCount=2 选错：delta=${rookie!.delta}（免罚，只丢连胜）`);
    expect(Math.abs(rookie!.delta)).toBe(0);
    const es4 = { ...newEventState(), bossVariant: "choice" as const, bossUntil: 1e9, patrolCount: 4 };
    const late = onBossChoice(s, es4, "keep-slacking", 1000);
    console.log(`[rookie] patrolCount=4 选错：delta=${late!.delta}（真扣）`);
    expect(late!.delta).toBeLessThan(0);
  });
});

describe("R2-① 首次巡逻是否优先 choice（lead 声称的设计变更）", () => {
  it("代码里找不到"首巡强制 choice"：0 巡逻次数时变体仍按 35/30/20/15 抽取", () => {
    const src = readFileSync("src/engine/events.ts", "utf8");
    console.log(`[first] events.ts 含 forcedVariant 逻辑=${src.includes("es.forcedVariant = null")}；含"首次优先 choice"标记=${/patrolCount\s*===?\s*0[^;]*choice/.test(src)}`);
    // 用 1000 个随机种子模拟"首次巡逻"的变体分布
    const counts: Record<string, number> = {};
    const rng = mulberry32(2026);
    for (let i = 0; i < 1000; i++) {
      const es = newEventState();
      scheduleEvents(es, 0, rng); // 排期
      const at = es.nextBossAt;
      scheduleEvents(es, at, rng); // 触发首次巡逻
      counts[es.bossVariant] = (counts[es.bossVariant] ?? 0) + 1;
    }
    console.log(`[first] 1000 次"首次巡逻"变体分布：${JSON.stringify(counts)}（choice 应为 ~15%，而非 100%）`);
    expect(counts.choice).toBeGreaterThan(0);
    expect(counts.choice).toBeLessThan(1000);
    expect(counts.hold).toBeGreaterThan(0);
  });

  it("pickBossVariant 无 patrolCount 参数 → 无法按首巡定制", () => {
    console.log(`[first] pickBossVariant.length=${pickBossVariant.length}（只收 rng，无首巡分支）`);
    expect(pickBossVariant.length).toBe(1);
  });
});

describe("R2-⑤ 卡池 10 → 16：多样性到底改善多少", () => {
  it("16 张卡（普通 8 / 稀有 6 / 剧情 2），抽卡分布重新算", () => {
    const byRarity: Record<string, number> = {};
    CARDS.forEach((c) => (byRarity[c.rarity] = (byRarity[c.rarity] ?? 0) + 1));
    console.log(`[pool] 卡池共 ${CARDS.length} 张：${JSON.stringify(byRarity)}；新增=${CARDS.filter((c) => ["ac_broken", "canteen_gift", "remote_day", "intern_ask", "office_move", "deadline"].includes(c.id)).map((c) => c.name).join("/")}`);
    expect(CARDS.length).toBe(16);
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(16);

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
    console.log(`[pool] 全普通天 ${(allCommon / N * 100).toFixed(1)}% | 至少 1 稀有/剧情 ${(hasRareOrEvent / N * 100).toFixed(1)}% | 有剧情 ${(hasEvent / N * 100).toFixed(1)}% | 有通宵摸鱼 ${(hasOvertime / N * 100).toFixed(1)}%`);
    console.log(`[pool] 注：普通卡张数 5→8（权重 15→24），稀有 3→6（权重 3→6）→ 全普通天反而变多`);
    expect(allCommon / N).toBeGreaterThan(0.33);
  });

  it("卡池寿命：第 8 天全旧卡概率、多久见完 16 张", () => {
    const rng = mulberry32(99);
    const seenByDay = [1, 3, 5, 8, 12].map((d) => {
      const r = mulberry32(100 + d);
      let sum = 0;
      const M = 2000;
      for (let i = 0; i < M; i++) {
        const seen = new Set<string>();
        for (let day = 0; day < d; day++) rollOffers("2026-11-27", r, null).offers.forEach((id) => seen.add(id));
        sum += seen.size;
      }
      return `第${d}天 ${(sum / M).toFixed(1)}/16`;
    });
    console.log(`[pool] 平均已见卡：${seenByDay.join(" | ")}`);
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
    console.log(`[pool] 第 8 天 3 张全旧卡概率 ≈ ${(repeat / 3000 * 100).toFixed(1)}%（10 张池时为 74.6%）`);
    expect(repeat / 3000).toBeLessThan(0.6);
    void rng;
  });

  it("新稀有卡的"风险"是真实数值（不是文案）：部门搬家/截止日/空调坏了", () => {
    const s = initialState();
    const now = Date.now();
    const createdAt = now - 5 * DAY;
    const noCard = offlineEfficiency(s, createdAt, now);
    const acBroken = offlineEfficiency({ ...s, cards: cardState("ac_broken", now + DAY) }, createdAt, now);
    const deadline = offlineEfficiency({ ...s, cards: cardState("deadline", now + DAY) }, createdAt, now);
    const move = { ...s, cards: cardState("office_move", now + DAY) };
    console.log(`[newcard] 离线效率：无卡 ${noCard.toFixed(2)} / 空调坏了 ${acBroken.toFixed(2)}(-5%) / 截止日 ${deadline.toFixed(2)}(-10%)`);
    console.log(`[newcard] 部门搬家 idleMult=${cardEffects(move, now).idleMult}(-10%) patrolRewardMult=${cardEffects(move, now).patrolRewardMult}(+80%) → 真有取舍`);
    console.log(`[newcard] 远程办公日 eventRateMult=${cardEffects({ ...s, cards: cardState("remote_day", now + DAY) }, now).eventRateMult}(巡逻减半)`);
    expect(noCard - acBroken).toBeCloseTo(0.05, 5);
    expect(noCard - deadline).toBeCloseTo(0.1, 5);
    expect(cardEffects(move, now).idleMult).toBeCloseTo(0.9, 5);
    expect(cardEffects(move, now).patrolRewardMult).toBe(1.8);
  });
});

describe("R2-⑦ 跨天：抽新卡 + 旧 buff 保留 24h + 每天可再选一次", () => {
  it("跨天后 offers 换新、chosen/until 保留、今天可再选且只能选一次", () => {
    const now = Date.now();
    const s = {
      ...initialState(),
      cards: cardState("overtime", now + 5 * 3600_000, { date: "2026-11-26", chosenDate: "2026-11-26" }),
    };
    const nextDay = ensureCards(s, "2026-11-27", mulberry32(3), now);
    console.log(`[cross] 跨天：date=${nextDay.cards.date} chosen=${nextDay.cards.chosen} (until 剩余 ${((nextDay.cards.until - now) / 3600_000).toFixed(1)}h) 新 offers=${nextDay.cards.offers.join(",")}`);
    expect(nextDay.cards.chosen).toBe("overtime");
    expect(nextDay.cards.date).toBe("2026-11-27");
    expect(nextDay.cards.offers).not.toEqual(["overtime", "coffee_day", "quiet_day"]);
    expect(cardEffects(nextDay, now).idleMult).toBe(1.6); // 旧 buff 仍在

    const picked = chooseCard(nextDay, nextDay.cards.offers[0]!, now);
    expect(picked).not.toBeNull();
    console.log(`[cross] 今天再选：${nextDay.cards.offers[0]} → chosen=${picked!.cards.chosen}（旧 buff 被替换，不叠加）`);
    expect(picked!.cards.chosen).toBe(nextDay.cards.offers[0]!);
    const again = chooseCard(picked!, nextDay.cards.offers[1]!, now);
    console.log(`[cross] 同一天选第二次：${again}（应为 null）`);
    expect(again).toBe(null);
  });
});

describe("R2-③④ 跳过即关 / 防误触 1.2s（源码级）", () => {
  it("onSkip 现在会 hide；防误触 400ms → 1200ms", () => {
    const main = readFileSync("src/main.ts", "utf8");
    const panel = readFileSync("src/ui/card-panel.ts", "utf8");
    console.log(`[ui] main.ts onSkip 含 cardPanel.hide()=${main.includes("cardPanel.hide();")}`);
    console.log(`[ui] 防误触 1200ms=${panel.includes("< 1200")}；400ms=${panel.includes("< 400")}`);
    expect(main.includes("cardPanel.hide();")).toBe(true);
    expect(panel.includes("< 1200")).toBe(true);
  });

  it("跳过当天不再弹 / 跳到次日卡池正常出现", () => {
    const now = Date.now();
    const s = { ...initialState(), cards: { ...cardState(null, 0), offers: ["overtime", "coffee_day", "quiet_day"] } };
    const skipped = dismissCards(s);
    expect(skipped.cards.dismissed).toBe(true);
    // 同日 ensureCards 不动
    expect(ensureCards(skipped, "2026-11-27", mulberry32(1), now)).toBe(skipped);
    // 次日新卡池 dismissed 复位
    const next = ensureCards(skipped, "2026-11-28", mulberry32(1), now + 20 * 3600_000);
    console.log(`[skip] 跳过：同日不重抽；次日 dismissed=${next.cards.dismissed} offers=${next.cards.offers.length} 张`);
    expect(next.cards.dismissed).toBe(false);
  });
});

describe("R2 保底：超时/窗口校验/画布不罚仍成立", () => {
  it("超时 0 奖 0 罚；迟到点击不结算", () => {
    const es = { ...newEventState(), bossVariant: "choice" as const, bossUntil: 100, surviveStreak: 4 };
    scheduleEvents(es, 101, mulberry32(11));
    const s = { ...initialState(), moyu: 500, surviveStreak: 4 };
    const r = finishPatrol(s, es);
    console.log(`[timeout] 奖励=${r.reward} 余额变化=${r.state.moyu - s.moyu} 连胜=${r.state.surviveStreak}`);
    expect(r.reward).toBe(0);
    expect(r.state.moyu).toBe(s.moyu);
    const es2 = { ...newEventState(), bossVariant: "choice" as const, bossUntil: 100 };
    const late = onBossChoice({ ...initialState(), moyu: 100 }, es2, "act-busy", 101);
    expect(late).toBe(null);
  });

  it("选择的奖励走完整倍率（卡/天赋/连胜），大额时扣款也同步放大", () => {
    const s = { ...initialState(), moyu: 1e6, surviveStreak: 4 };
    const es = { ...newEventState(), bossVariant: "choice" as const, bossUntil: 1e9, surviveStreak: 4, patrolCount: 10 };
    const base = 50 * 1.4;
    const right = resolveBossChoice(s, "forgetful", "keep-slacking", base);
    const wrong = resolveBossChoice(s, "forgetful", "keep-slacking", base);
    console.log(`[reward] base=${base} 时 选对 +${right.delta} / 选错 ${wrong.delta}（错的代价随连胜一起变大）`);
    expect(right.delta).toBe(Math.floor(base * 1.8));
    expect(wrong.delta).toBe(-base);
  });
});
