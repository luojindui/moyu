/**
 * R13 赌徒党引擎探针：验证稀有卡"风险"是否落地、抽卡分布、剧情链文本、
 * 回合制老板的赌博结构与线索唯一性。只读 src/，不改 src/。
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
} from "../src/engine/cards";
import { offlineEfficiency } from "../src/engine/progression";
import { effectOf } from "../src/engine/upgrades";
import { PERSONALITIES, CHOICES, resolveBossChoice, isCorrect, CHOICE_CORRECT_MULT, CHOICE_WRONG_PENALTY_RATIO } from "../src/engine/boss-choice";
import { newEventState, scheduleEvents, finishPatrol, BOSS_INTERVAL_MIN, BOSS_INTERVAL_MAX } from "../src/engine/events";
import { rollDaily } from "../src/engine/daily";

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

function stateWithCard(id: string, extra: { until?: number } = {}) {
  const s = initialState();
  return {
    ...s,
    cards: {
      date: "2026-11-27",
      offers: [],
      chosen: id,
      until: extra.until ?? Date.now() + 3600_000,
      nextDayGuaranteed: null,
    },
  };
}

describe("R13-P0 稀有卡宣传的『风险』是否真的落地", () => {
  it("通宵摸鱼：riskPenalty=0.2 有定义，但离线效率与不选卡完全一致（=没生效）", () => {
    const base = initialState();
    const createdAt = Date.now() - 5 * DAY;
    const now = Date.now();
    const offNoCard = offlineEfficiency(base, createdAt, now);
    const overtime = stateWithCard("overtime", { until: now + DAY });
    const offWithCard = offlineEfficiency(overtime, createdAt, now);
    console.log(`[overtime] cardEffects.riskPenalty=${cardEffects(overtime, now).riskPenalty} idleMult=${cardEffects(overtime, now).idleMult}`);
    console.log(`[overtime] 离线效率: 不选卡=${offNoCard.toFixed(4)} 选了通宵摸鱼=${offWithCard.toFixed(4)}`);
    expect(cardEffects(overtime, now).riskPenalty).toBe(0.2);
    // 若"明天离线 -20%"生效，应当 offWithCard = offNoCard - 0.2 左右；实际完全相等
    expect(offWithCard).toBe(offNoCard);
  });

  it("通宵摸鱼：+60% 挂机今天确实生效（只有好处是真的）", () => {
    const base = initialState();
    const withCard = stateWithCard("overtime");
    // 卡对 idleRate 的乘区（upgrades 用 card.idleMult 乘工位部分）
    console.log(`[overtime] idleMult 生效值=${cardEffects(withCard, Date.now()).idleMult}`);
    expect(cardEffects(withCard, Date.now()).idleMult).toBe(1.6);
    expect(effectOf(base).idleRate).toBeGreaterThanOrEqual(0);
  });

  it("老板出差/全员大会：eventRateMult（巡逻更频繁）没有任何读取方（调度函数连 state 都不收）", () => {
    const quiet = stateWithCard("quiet_day");
    const meeting = stateWithCard("big_meeting");
    const now = Date.now();
    const e1 = cardEffects(quiet, now);
    const e2 = cardEffects(meeting, now);
    console.log(`[quiet_day] eventRateMult=${e1.eventRateMult}（卡面写"巡逻更频繁 +30%"）`);
    console.log(`[big_meeting] eventRateMult=${e2.eventRateMult}（卡面写"巡逻间隔减半"）`);
    expect(e1.eventRateMult).toBe(1.3);
    expect(e2.eventRateMult).toBe(2);
    // 结构性证据：scheduleEvents(es, now, rng) 签名收不到 state，无法读取卡效果
    expect(scheduleEvents.length).toBe(3);
    // 巡逻间隔常量完全没有被卡影响
    expect(BOSS_INTERVAL_MIN).toBe(90);
    expect(BOSS_INTERVAL_MAX).toBe(150);
    // 同一 rng 序列下，带卡/不带卡的巡逻排期完全相同
    const seed = 12345;
    const mk = (withCard: boolean) => {
      const es = newEventState();
      const rng = mulberry32(seed);
      scheduleEvents(es, 0, rng);
      const first = es.nextBossAt;
      scheduleEvents(es, first, rng);
      return [first, es.nextBossAt];
    };
    console.log(`[schedule] 排期（与卡无关）: ${JSON.stringify(mk(true))} === ${JSON.stringify(mk(false))}`);
    expect(mk(true)).toEqual(mk(false));
  });

  it("选卡实际有效期 = 到当天结束，而不是 24h（until 字段是死数据）", () => {
    const s = initialState();
    const before = ensureCards(s, "2026-11-27", mulberry32(1));
    const picked = chooseCard({ ...before, cards: { ...before.cards, offers: ["overtime", "coffee_day", "quiet_day"] } }, "overtime", Date.now());
    expect(picked).not.toBeNull();
    expect(picked!.cards.chosen).toBe("overtime");
    expect(picked!.cards.until - Date.now()).toBeGreaterThan(CARD_DURATION * 1000 - 5_000);
    // 23:00 选卡，1 小时后跨日 → 卡直接消失（效果清零），24h 承诺不成立
    const nextDay = ensureCards(picked!, "2026-11-28", mulberry32(2));
    console.log(`[duration] 选卡 until=+24h；跨日重载后 chosen=${nextDay.cards.chosen}`);
    expect(nextDay.cards.chosen).toBe(null);
    expect(activeCard(nextDay, Date.now())).toBe(null);
  });
});

describe("R13-P1 每日卡池：开箱手感 / 稀有度与价值", () => {
  it("抽 3 张的稀有度分布（10000 天模拟）", () => {
    const rng = mulberry32(42);
    let allCommon = 0;
    let hasRareOrEvent = 0;
    let hasEvent = 0;
    let hasOvertime = 0;
    const rareCount = { common: 0, rare: 0, event: 0 };
    const dayPool = new Set();
    const rarityById = new Map(CARDS.map((c) => [c.id, c.rarity]));
    const N = 10000;
    for (let i = 0; i < N; i++) {
      const cs = rollOffers("2026-11-27", rng, null);
      dayPool.add(cs.offers.join(","));
      const rs = cs.offers.map((id) => rarityById.get(id)!);
      rs.forEach((r) => (rareCount[r] += 1));
      if (rs.every((r) => r === "common")) allCommon++;
      if (rs.some((r) => r !== "common")) hasRareOrEvent++;
      if (rs.includes("event")) hasEvent++;
      if (cs.offers.includes("overtime")) hasOvertime++;
    }
    console.log(
      `[roll] ${N} 天：全普通 ${(allCommon / N * 100).toFixed(1)}% | 至少 1 稀有/剧情 ${(hasRareOrEvent / N * 100).toFixed(1)}% | 有剧情卡 ${(hasEvent / N * 100).toFixed(1)}% | 有通宵摸鱼 ${(hasOvertime / N * 100).toFixed(1)}%`,
    );
    console.log(`[roll] 单卡稀有度占比: 普通 ${(rareCount.common / (3 * N) * 100).toFixed(1)}% / 稀有 ${(rareCount.rare / (3 * N) * 100).toFixed(1)}% / 剧情 ${(rareCount.event / (3 * N) * 100).toFixed(1)}%`);
    console.log(`[roll] 3 张组合去重后共 ${dayPool.size} 种（上限 720 = 10 张卡取 3 张的全排列）`);
    // 开箱"新卡"手感：第 1/3/5/8 天平均已见卡数 + 第 8 天 3 张全是"已见过的卡"的概率
    const seenByDay = [1, 3, 5, 8].map((d) => {
      const r = mulberry32(100 + d);
      let sum = 0;
      const M = 2000;
      for (let i = 0; i < M; i++) {
        const seen = new Set<string>();
        for (let day = 0; day < d; day++) rollOffers("2026-11-27", r, null).offers.forEach((id) => seen.add(id));
        sum += seen.size;
      }
      return { day: d, avgSeen: +(sum / M).toFixed(2) };
    });
    console.log(`[roll] 平均已见卡数: ${seenByDay.map((x) => `第${x.day}天 ${x.avgSeen}/10`).join(" | ")}`);
    let repeatDay8 = 0;
    {
      const M = 3000;
      const r = mulberry32(777);
      for (let i = 0; i < M; i++) {
        const seen = new Set<string>();
        let rep = 0;
        for (let day = 0; day < 8; day++) {
          const offers = rollOffers("2026-11-27", r, null).offers;
          if (day === 7 && offers.every((id) => seen.has(id))) rep++;
          offers.forEach((id) => seen.add(id));
        }
        repeatDay8 += rep;
      }
    }
    console.log(`[roll] 第 8 天 3 张全是旧卡的概率 ≈ ${(repeatDay8 / 3000 * 100).toFixed(1)}%`);
    expect(allCommon / N).toBeGreaterThan(0.3);
    expect(hasRareOrEvent / N).toBeGreaterThan(0.55);
    // 10 天左右基本见完 10 张（开箱寿命极短）
    const last = seenByDay[seenByDay.length - 1]!;
    expect(last.avgSeen).toBeGreaterThan(8);
  });

  it("稀有卡挖坑：稀有度≠价值（早期无同事时派遣卡=0 收益，纯挂机玩家点击卡=0 收益）", () => {
    // 早期 team.colleagues 为空 → 团建吃饭 +40% 派遣奖励 为 0 收益；老周的秘密同理
    const s = initialState();
    console.log(`[trap] 初始同事数=${Object.keys(s.team.colleagues).length}；此时 团建吃饭/秘密项目 的派遣加成 = 0 收益`);
    expect(Object.keys(s.team.colleagues).length).toBe(0);
    // 三张普通卡里两张对纯挂机党收益接近 0（提前下班：不离开页面就没收益）
    const commons = CARDS.filter((c) => c.rarity === "common");
    expect(commons.length).toBe(5);
  });

  it("关不掉的弹窗：选卡面板不支持跳过（Escape 只处理 journal/welcome），且未选择时每帧自动重弹", () => {
    const src = readFileSync("src/main.ts", "utf8");
    const cardSrc = readFileSync("src/ui/card-panel.ts", "utf8");
    // Escape 处理里没有 cards 面板
    const escBlock = src.slice(src.indexOf('if (e.key !== "Escape")'), src.indexOf('if (e.key !== "Escape")') + 900);
    console.log(`[modal] Escape 处理含 cards? ${escBlock.includes("cards")}`);
    expect(escBlock.includes("cards")).toBe(false);
    // 每帧调用 maybeShow（未选卡 → 重新弹出）
    expect(src.includes("cardPanel.maybeShow(state);")).toBe(true);
    expect(cardSrc.includes("if (!state.cards || state.cards.chosen) return;")).toBe(true);
    // 选卡后 HUD 没有任何展示（activeLabel 是死代码）
    const usages = (src.match(/activeLabel/g) ?? []).length;
    console.log(`[hud] main.ts 中 activeLabel 使用次数=${usages}（0 = 选完卡后界面看不到生效中的卡/剩余时间）`);
    expect(usages).toBe(0);
  });

  it("HR约谈剧情链：卡面写『升职机会』，实际保底的是『秘密项目』；promotion 卡不存在（死分支）", () => {
    const s = initialState();
    const rolled = rollOffers("2026-11-27", mulberry32(7), null);
    const withHr = chooseCard({ ...s, cards: { ...rolled, date: "2026-11-27", offers: ["hr_talk", "coffee_day", "quiet_day"] } }, "hr_talk", Date.now());
    console.log(`[story] HR约谈 → nextDayGuaranteed=${withHr!.cards.nextDayGuaranteed}`);
    expect(withHr!.cards.nextDayGuaranteed).toBe("secret_project");
    const next = ensureCards(withHr!, "2026-11-28", mulberry32(3));
    console.log(`[story] 次日保底出现: ${next.cards.offers.map((id) => CARDS.find((c) => c.id === id)?.name).join(" / ")}`);
    expect(next.cards.offers[0]).toBe("secret_project");
    // 卡面文本承诺的是"升职机会"
    const hrDesc = CARDS.find((c) => c.id === "hr_talk")!.desc;
    expect(hrDesc.includes("升职机会")).toBe(true);
    expect(CARDS.some((c) => c.id === "promotion")).toBe(false);
    // rollOffers 里 promotion 分支是死代码
    const dead = rollOffers("2026-11-28", mulberry32(5), "promotion");
    console.log(`[story] rollOffers(guaranteed='promotion') 首张=${dead.offers[0]}（不是 promotion，因为卡不存在）`);
    expect(dead.offers[0]).not.toBe("promotion");
  });

  it("卡池只有 10 张：模拟连续 14 天，看重复/全普通天数", () => {
    const rng = mulberry32(99);
    const seen = new Set();
    const rarity = new Map(CARDS.map((c) => [c.id, c.rarity]));
    let allCommonDays = 0;
    for (let d = 1; d <= 14; d++) {
      const cs = rollOffers(`2026-11-${String(d).padStart(2, "0")}`, rng, null);
      cs.offers.forEach((id) => seen.add(id));
      if (cs.offers.every((id) => rarity.get(id) === "common")) allCommonDays++;
      if (d === 14) console.log(`[14天] 已见到卡 ${seen.size}/10；14 天里全普通 ${allCommonDays} 天`);
    }
  });
});

describe("R13-P0 回合制老板：是赌博还是背答案？", () => {
  it("线索=答案：3 个性格的 name 直接包含答案关键词，无需推断", () => {
    for (const p of PERSONALITIES) {
      const answer = CHOICES.find((c) => c.id === p.correct)!.label;
      console.log(`[clue] ${p.name} —— ${p.tell} → 正确应对【${answer}】`);
    }
    expect(PERSONALITIES.length).toBe(3);
    const names = PERSONALITIES.map((p) => p.name).join("|");
    expect(names).toContain("急性子");
    expect(names).toContain("多疑");
    expect(names).toContain("健忘");
    // 每个性格唯一映射，三个答案互不重复
    expect(new Set(PERSONALITIES.map((p) => p.correct)).size).toBe(3);
  });

  it("错误代价 vs 正确收益：盲猜的期望是正的（没有真正的风险）", () => {
    const base = 50; // 早期 base = max(50, 4×idleRate)
    const s = { ...initialState(), moyu: 1e6 };
    const right = resolveBossChoice(s, "hasty", "act-busy", base);
    const wrong = resolveBossChoice(s, "hasty", "keep-slacking", base);
    console.log(`[ev] base=${base}: 选对 +${right.delta} / 选错 ${wrong.delta} / 不选(超时) 0`);
    console.log(`[ev] 盲猜 3 选 1 期望 = (2.2 - 2×0.6)/3 = ${((CHOICE_CORRECT_MULT - 2 * CHOICE_WRONG_PENALTY_RATIO) / 3).toFixed(3)} × base = ${(((CHOICE_CORRECT_MULT - 2 * CHOICE_WRONG_PENALTY_RATIO) / 3) * base).toFixed(1)}（>0，赌不亏）`);
    expect(right.delta).toBe(110);
    expect(wrong.delta).toBe(-30);
    expect((CHOICE_CORRECT_MULT - 2 * CHOICE_WRONG_PENALTY_RATIO) / 3).toBeGreaterThan(0);
    // 罚款封顶：余额不足只扣到 0，不欠债
    const poor = { ...initialState(), moyu: 10 };
    const punished = resolveBossChoice(poor, "hasty", "keep-slacking", base);
    console.log(`[ev] 余额 10 时选错实际扣款=${punished.delta}（不欠债）`);
    expect(punished.delta).toBe(-10);
    expect(punished.state.moyu).toBe(0);
  });

  it("超时 = 零惩罚零反馈：finishPatrol 对 choice 未选只发 0 奖，连胜不变", () => {
    const es = newEventState();
    es.bossVariant = "choice";
    es.bossUntil = 100;
    es.bossChoiceDone = false;
    es.surviveStreak = 4;
    // 窗口过期：scheduleEvents 把 bossUntil 置 -1
    scheduleEvents(es, 101, mulberry32(11));
    expect(es.bossUntil).toBe(-1);
    const s = { ...initialState(), moyu: 500, surviveStreak: 4 };
    const r = finishPatrol(s, es);
    console.log(`[timeout] 超时不选：奖励=${r.reward} moyu 变化=${r.state.moyu - s.moyu} 连胜=${r.state.surviveStreak}`);
    expect(r.reward).toBe(0);
    expect(r.state.moyu).toBe(s.moyu);
    expect(r.state.surviveStreak).toBe(4);
  });

  it("main.ts 的选择结算与反馈文案", () => {
    const src = readFileSync("src/main.ts", "utf8");
    console.log(`[ui] 选对/选错 toast: ${src.includes("r.correct ? `选对了！+${Math.round(r.delta)}`") ? "存在" : "缺失"}`);
    expect(src.includes("选对了")).toBe(true);
    // 超时（未选）没有任何 toast 分支
    const finish = src.slice(src.indexOf("if (prevBossActive && !bossActive)"), src.indexOf("if (prevBossActive && !bossActive)") + 800);
    console.log(`[ui] 超时结局是否有提示: ${finish.includes("choice") && finish.includes("showToast") ? "有" : "无（静默消失）"}`);
    expect(finish.includes("!== \"choice\"") || !finish.includes("choice")).toBe(true);
  });
});
