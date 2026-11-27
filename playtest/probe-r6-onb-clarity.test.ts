/**
 * R7 · 新手可理解性探针（只读 src/engine）
 *
 * 复算「首屏商店卡 + HUD」上新手实际看到的每一个字符串（模板与 src/ui/shop.ts、src/ui/hud.ts 一致，
 * 首屏真实 DOM 文本已由 playtest/probe-r6-onb-cdp.mjs 交叉验证），并给出可读性替换文案与数值依据：
 *  - 「+N 点击力｜×2还差N级」：×2 里程碑要投入多少摸鱼值？
 *  - 「点击 667/万」「挂机 200.0/万」：新人能否换算成「回本时间」？
 *  - 「实习生 0%」：下一段位目标是否可见？
 *  - 「×2」里程碑（20 级错峰）与图鉴档位（Lv.1/5/10/20/50）是两套阈值
 */
import { describe, it, expect } from "vitest";
import { initialState, type GameState } from "../src/engine/state";
import { UPGRADES, costOf, marginalEffect, milestoneGap, valueScoreOf, effectOf, MILESTONE_LEVELS, MILESTONE_OFFSET_STEP } from "../src/engine/upgrades";
import { clickPowerOf } from "../src/engine/actions";
import { rankFor, RANKS } from "../src/engine/titles";
import { formatMoyu } from "../src/engine/format";
import { ensureDaily, dailyReward, DAILY_GOAL_TEMPLATES } from "../src/engine/daily";

const fresh = (): GameState => initialState();

/** 与 src/ui/shop.ts refresh() 完全一致的卡片文案 */
function cardTexts(state: GameState) {
  return UPGRADES.map((u) => {
    const lv = state.levels[u.id] ?? 0;
    const price = costOf(u.id, lv);
    const m = marginalEffect(u.id, lv);
    const inc = m.clickPower > 0 ? `+${m.clickPower} 点击力` : `+${m.idleRate}/秒`;
    const gap = milestoneGap(u.id, lv);
    const score = valueScoreOf(u.id, lv);
    const dim = u.clickPower ? `点击 ${score.click.toFixed(0)}/万` : `挂机 ${score.idle.toFixed(1)}/万`;
    return {
      name: u.name,
      desc: u.desc,
      next: `${inc}｜×2还差${gap}级`,
      value: dim,
      cost: `${formatMoyu(price)} 摸鱼值`,
      payback: u.clickPower ? `≈${Math.round(price / m.clickPower)} 次点击回本` : `≈${Math.round(price / m.idleRate)} 秒回本`,
    };
  });
}

/** 与 src/ui/hud.ts refresh() 完全一致的 HUD 文案 */
function hudTexts(state: GameState) {
  const r = rankFor(state.totalEarned);
  const shortName = r.current.replace(/^带薪/, "").replace(/^摸鱼/, "");
  return {
    moyu: formatMoyu(state.moyu),
    click: String(clickPowerOf(state)),
    idle: formatMoyu(effectOf(state).idleRate),
    rank: r.next ? `${shortName} ${(r.progress * 100).toFixed(0)}%` : shortName,
    rankTitle: r.next ? `${r.current} → ${r.next.name}` : r.current,
    nextRankAt: r.next?.at.toLocaleString("en-US") ?? null,
  };
}

describe("R7 可理解性：首屏文案复算", () => {
  it("首屏 9 张卡的完整文案（新手第一眼能看到的全部信息）", () => {
    const st = fresh();
    console.log("HUD:", JSON.stringify(hudTexts(st)));
    console.log("| 卡 | 描述 | 下一级 | 性价比 | 价格 | 可读版回本 |");
    console.log("|---|---|---|---|---|---|");
    for (const c of cardTexts(st)) console.log(`| ${c.name} | ${c.desc} | ${c.next} | ★ ${c.value} | ${c.cost} | ${c.payback} |`);
    expect(cardTexts(st)).toHaveLength(9);
  });

  it("「×2还差N级」的隐藏成本：每张卡拉满 20 级要砸多少摸鱼值", () => {
    console.log("| 卡 | 维度 | lv0 每次 + | 第 1 个 ×2 在 Lv. | 升到该级累计花费 | 相对首卡价 |");
    console.log("|---|---|---|---|---|---|");
    for (const u of UPGRADES) {
      const gap = milestoneGap(u.id, 0);
      const target = 0 + gap; // 从 lv0 升到里程碑级所需级数 = gap
      let sum = 0;
      for (let i = 0; i < target; i++) sum += costOf(u.id, i);
      console.log(
        `| ${u.name} | ${u.clickPower ? "点击" : "挂机"} | ${u.clickPower ? `+${u.clickPower} 点击力` : `+${u.idleRate}/秒`} | Lv.${target} | ${formatMoyu(sum)} | ${(sum / 15).toFixed(0)}× 首卡 |`,
      );
    }
    // 咖啡：×2 需要 20 级，累计花费远超新手 10 分钟能理解的范围
    let coffee20 = 0;
    for (let i = 0; i < 20; i++) coffee20 += costOf("coffee", i);
    expect(milestoneGap("coffee", 0)).toBe(20);
    expect(coffee20).toBeGreaterThan(1000);
    console.log(`\n咖啡 ×2 累计 ${formatMoyu(coffee20)}（≈ ${Math.round(coffee20 / 15)} 张咖啡首价）；而 10 分钟新手总累计仅 0.8 万~74 万`);
    console.log(`里程碑参数：每 ${MILESTONE_LEVELS} 级 ×2，错峰 ${MILESTONE_OFFSET_STEP} 级/表位`);
  });

  it("「点击 667/万」到底是什么：新人无法换算，回本时间才是直觉量", () => {
    const st = fresh();
    for (const u of UPGRADES) {
      const s = valueScoreOf(u.id, 0);
      const p = costOf(u.id, 0);
      const m = marginalEffect(u.id, 0);
      const dim = u.clickPower ? `点击 ${s.click.toFixed(0)}/万` : `挂机 ${s.idle.toFixed(1)}/万`;
      const pay = u.clickPower ? `${Math.round(p / m.clickPower)} 次点击` : `${Math.round(p / m.idleRate)} 秒`;
      console.log(`${u.name}: 现文案「${dim}」 → 建议「${pay}回本」（${p} ÷ ${u.clickPower ? `+${m.clickPower}/次` : `+${m.idleRate}/秒`}）`);
    }
    // 数值：咖啡 667/万 = 1/15*10000；等价「15 次点击回本」
    expect(valueScoreOf("coffee", 0).click).toBeCloseTo(666.67, 1);
    expect(costOf("coffee", 0) / marginalEffect("coffee", 0).clickPower).toBe(15);
  });

  it("HUD 段位「实习生 0%」：升级目标在移动端不可见（title 只在桌面 hover 显示）", () => {
    const st = fresh();
    console.log("HUD:", JSON.stringify(hudTexts(st)));
    console.log("RANKS:", RANKS.map((r) => `${r.name}@${r.at.toLocaleString("en-US")}`).join(" / "));
    const r = rankFor(0);
    expect(r.current).toBe("摸鱼实习生");
    expect(r.next?.at).toBe(10_000);
    expect(r.progress).toBe(0);
    // 10 分钟内 A 慢手累计约 9.6 万 → HUD 上只会看到 0%～96% 的百分比，没有「还差多少」
    for (const t of [0, 500, 5_000, 9_600]) {
      const info = rankFor(t);
      console.log(`累计 ${formatMoyu(t)} → HUD「${info.current.replace(/^摸鱼/, "")} ${(info.progress * 100).toFixed(0)}%」，面板无「还差 ${formatMoyu((info.next?.at ?? 0) - t)}」`);
    }
  });

  it("日报可达性：目标量级 vs 新手 0-10 分钟实际行为", () => {
    const st = fresh();
    const d = ensureDaily(st, "2026-11-27", () => 0.1).daily!;
    const reward = dailyReward(st);
    console.log("日报目标池:", DAILY_GOAL_TEMPLATES.map((t) => `${t.desc}(${t.target})`).join(" / "));
    console.log(`本次目标: ${d.goals.map((g) => `${g.id} 0/${g.target}`).join(" / ")}`);
    console.log(`日报奖励（空档期）max(500, 60×0.2)=${formatMoyu(reward)}；图中 2m20s 就 3/3，奖励≈${formatMoyu(Math.max(500, 60 * 20))}`);
    console.log("日报奖励 = max(500, 60×挂机秒收益)：越晚领越多，新手完全没有这个信息");
    expect(reward).toBe(500);
  });
});
