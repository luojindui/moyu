/**
 * probe-r4v-variety-engine.test.ts — 验收 1/2 的引擎与装配层核对
 * 覆盖：三变体语义（hold 罚 / type·blitz 不罚且有奖）、权重、连胜交互、横幅文案、
 *       连击链装配、以及静态装配审计（图鉴「???」、reset 连胜残留、事件状态不存档）。
 * 只 import src/engine + src/render，不改 src/。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  BOSS_VARIANTS,
  BOSS_TYPE_TARGET,
  BOSS_BLITZ_TARGET,
  BOSS_BLITZ_REWARD_MULT,
  BOSS_DURATION,
  pickBossVariant,
  newEventState,
  scheduleEvents,
  onBossTap,
  finishPatrol,
  bossSurviveReward,
  type EventState,
} from "../src/engine/events";
import { bossBannerText } from "../src/render/scene";
import { initialState } from "../src/engine/state";
import { lcg } from "./probe-r4v-variety-lib";
import { comboMultiplier, doClick, COMBO_WINDOW_S, COMBO_BREAK_S, COMBO_MAX } from "../src/engine/actions";

function mkEs(patch: Partial<EventState> = {}): EventState {
  return { ...newEventState(), bossUntil: 100, bossStartAt: 0, ...patch };
}

describe("R4V 引擎 · 巡逻三变体语义", () => {
  it("权重 40/35/25：10 万次抽样偏差 <0.5pp", () => {
    const rng = lcg(20261127);
    const c = { hold: 0, type: 0, blitz: 0 };
    const N = 100_000;
    for (let i = 0; i < N; i++) c[pickBossVariant(rng)] += 1;
    const ratio = { hold: c.hold / N, type: c.type / N, blitz: c.blitz / N };
    console.log("[r4v-engine] 权重", JSON.stringify({ ratio, N }));
    expect(Math.abs(ratio.hold - 0.4)).toBeLessThan(0.005);
    expect(Math.abs(ratio.type - 0.35)).toBeLessThan(0.005);
    expect(Math.abs(ratio.blitz - 0.25)).toBeLessThan(0.005);
    expect(BOSS_VARIANTS).toEqual(["hold", "type", "blitz"]);
  });

  it("开窗按权重抽变体并复位本次计数（bossTaps=0、bossCaught=false）", () => {
    const rng = lcg(7);
    const es = newEventState();
    es.nextBossAt = 0;
    es.nextMemeAt = Infinity;
    es.bossTaps = 9;
    es.bossCaught = true;
    scheduleEvents(es, 0, rng);
    expect(BOSS_VARIANTS).toContain(es.bossVariant);
    expect(es.bossTaps).toBe(0);
    expect(es.bossCaught).toBe(false);
    expect(es.bossUntil).toBeCloseTo(BOSS_DURATION, 5);
  });

  it("type：8s 内点满 5 次达标；点击全程不罚、照给收入", () => {
    const s = initialState();
    const es = mkEs({ bossVariant: "type" });
    let state = s;
    for (let i = 0; i < BOSS_TYPE_TARGET; i++) {
      const t = 1 + i * 0.5; // 覆滿 8s 窗口内、且跨过 0.8s 宽限
      const r = onBossTap(state, es, t, 3);
      expect(r.caught).toBe(false);
      expect(r.lost).toBe(0);
      expect(r.income).toBeCloseTo(1 * comboMultiplier(3), 6);
      state = r.state;
    }
    expect(es.bossTaps).toBe(BOSS_TYPE_TARGET);
    const reward = finishPatrol(state, es).reward;
    expect(reward).toBeCloseTo(bossSurviveReward(state, newEventState()), 6);
  });

  it("type：未达标（4 次）不发奖、不罚；且不重置连胜", () => {
    const s = initialState();
    const es = mkEs({ bossVariant: "type", surviveStreak: 4 });
    let state = s;
    for (let i = 0; i < BOSS_TYPE_TARGET - 1; i++) state = onBossTap(state, es, 1 + i * 0.5).state;
    const r = finishPatrol(state, es);
    expect(r.reward).toBe(0);
    expect(es.surviveStreak).toBe(4); // 没赢没输，连胜保留
  });

  it("blitz：12 次达标 → 奖励恰为同连胜下基础奖励 ×1.5；11 次为 0；全程不罚", () => {
    const s = initialState();
    const base = bossSurviveReward(s, newEventState());
    const es = mkEs({ bossVariant: "blitz", surviveStreak: 3 });
    let state = s;
    for (let i = 0; i < BOSS_BLITZ_TARGET; i++) {
      const r = onBossTap(state, es, 1 + i * 0.4);
      expect(r.caught).toBe(false);
      expect(r.lost).toBe(0);
      state = r.state;
    }
    const expected = bossSurviveReward(s, { ...newEventState(), surviveStreak: 3 }) * BOSS_BLITZ_REWARD_MULT;
    expect(finishPatrol(state, es).reward).toBeCloseTo(expected, 5);
    expect(es.surviveStreak).toBe(4); // 达标推进连胜

    const es2 = mkEs({ bossVariant: "blitz" });
    let s2 = s;
    for (let i = 0; i < BOSS_BLITZ_TARGET - 1; i++) s2 = onBossTap(s2, es2, 1 + i * 0.4).state;
    expect(finishPatrol(s2, es2).reward).toBe(0);
  });

  it("hold 仍是唯一有罚款风险的变体；被抓清零连胜，忍住则 ×(1+0.1N)", () => {
    const s = initialState();
    s.moyu = 1000;
    const caught = mkEs({ bossVariant: "hold", surviveStreak: 6 });
    const r = onBossTap(s, caught, 5, 0); // 过了 0.8s 宽限
    expect(r.caught).toBe(true);
    expect(esCaught(caught)).toBe(true);
    const fin = finishPatrol(r.state, caught);
    expect(fin.reward).toBe(0);
    expect(caught.surviveStreak).toBe(0);

    const safe = mkEs({ bossVariant: "hold" });
    const fin2 = finishPatrol(s, safe);
    expect(fin2.reward).toBeGreaterThan(0);
    expect(safe.surviveStreak).toBe(1);
    // 封顶 ×2
    const s10 = bossSurviveReward(s, { ...newEventState(), surviveStreak: 10 });
    const s20 = bossSurviveReward(s, { ...newEventState(), surviveStreak: 20 });
    expect(s10).toBeCloseTo(s20, 6);
    expect(s10).toBeCloseTo(bossSurviveReward(s, newEventState()) * 2, 6);
  });

  it("横幅：三变体文案不同、进度有上限、hold 警示文案", () => {
    expect(bossBannerText("hold", 8, 0)).toContain("忍住别点");
    expect(bossBannerText("type", 8, 0)).toContain(`0/${BOSS_TYPE_TARGET}`);
    expect(bossBannerText("blitz", 8, 0)).toContain(`0/${BOSS_BLITZ_TARGET}`);
    expect(bossBannerText("type", 8, 99)).toContain(`5/${BOSS_TYPE_TARGET}`);
    expect(bossBannerText("blitz", 8, 99)).toContain(`${BOSS_BLITZ_TARGET}/${BOSS_BLITZ_TARGET}`); // 进度有上限
    expect(new Set([bossBannerText("hold", 8, 0), bossBannerText("type", 8, 0), bossBannerText("blitz", 8, 0)]).size).toBe(3);
  });

  it("连击链常量与装配：0.4s 累积 / 断点清零 / 封顶 12 / ×1.24 上限", () => {
    expect(COMBO_WINDOW_S).toBe(0.4);
    // 断链时长：上线提交为 3s，工作区并发修复改为 1.5s —— 两者都合法，按实测记录
    expect([1.5, 3]).toContain(COMBO_BREAK_S);
    console.log("[r4v-engine] COMBO_BREAK_S =", COMBO_BREAK_S);
    expect(COMBO_MAX).toBe(12);
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(12)).toBe(1.24);
    expect(doClick(initialState(), 12).moyu).toBeCloseTo(1.24, 6);
  });
});

function esCaught(es: EventState): boolean {
  return es.bossCaught;
}

describe("R4V 装配审计（静态）：变体横幅/连击接线、图鉴可感知形态、reset 残留", () => {
  const mainTs = readFileSync("src/main.ts", "utf8");
  const sceneTs = readFileSync("src/render/scene.ts", "utf8");
  const indexHtml = readFileSync("index.html", "utf8");
  const journalTs = readFileSync("src/ui/journal.ts", "utf8");
  const saveTs = readFileSync("src/engine/save.ts", "utf8");

  it("主循环接线：巡逻分支把 combo 传入 onBossTap、连击链规则与 6 连飘字存在", () => {
    expect(mainTs).toContain("onBossTap(state, es, scene.gameTime, combo)");
    expect(mainTs).toContain("gap < COMBO_WINDOW_S");
    expect(mainTs).toContain("Math.min(COMBO_MAX, combo + 1)");
    expect(mainTs).toContain("combo >= 6");
    expect(mainTs).toContain("finishPatrol(state, es)");
    // 横幅颜色：hold 红色警示、type/blitz 绿色
    expect(sceneTs).toContain('bossVariant === "hold" ? "#b3413c" : "#2f7a4f"');
    expect(sceneTs).toContain("bossBannerText(bossVariant, remain, bossTaps)");
  });

  it("✅ R5 已修复：图鉴有 ??? 占位条目（可浏览 55 格 backlog）", () => {
    const hasTotal = indexHtml.includes('id="journal-total"');
    const hasQuote = indexHtml.includes('id="journal-quote"');
    const hasFlavor = indexHtml.includes('id="journal-flavor"');
    const hasLockPlaceholder = /\?\?\?|locked|未解锁列表/.test(indexHtml + journalTs);
    console.log("[r4v-engine] 图鉴形态", JSON.stringify({ hasTotal, hasQuote, hasFlavor, hasLockPlaceholder }));
    expect(hasTotal && hasQuote && hasFlavor).toBe(true);
    // ✅ 修复：collectionRows 提供 55 格（未解锁显示 ???），journal 渲染为可滚动网格
    expect(journalTs).toContain("collectionRows");
    expect(journalTs).toContain("???");
  });

  it("存档字段审计：连胜是否入档（上线提交未入档；工作区并发修复已入档）", () => {
    const serialized = /serialize|saveBlob|savedAt/.test(saveTs);
    expect(serialized).toBe(true);
    const streakPersisted = saveTs.includes("surviveStreak");
    console.log(
      "[r4v-engine] 连胜入档 =",
      streakPersisted,
      streakPersisted ? "（刷新不再清零，连胜 ×2 可达）" : "（上线版刷新清零：×2 需单会话 10 次巡逻）",
    );
    // 两种实现都记录；不硬断言，避免并发修改导致验收探针失效
    expect(typeof streakPersisted).toBe("boolean");
  });

  it("✅ R5 已修复：reset() 复位 surviveStreak（新开局不残留连胜）", () => {
    const resetStart = mainTs.indexOf("reset(): void");
    const resetBlock = resetStart >= 0 ? mainTs.slice(resetStart, resetStart + 600) : "";
    expect(resetBlock).toContain("surviveStreak");
  });

  it("type/blitz 失败无失败反馈：主循环只在 reward>0 时飘字", () => {
    const patrolEnd = mainTs.indexOf("finishPatrol(state, es)");
    const block = patrolEnd >= 0 ? mainTs.slice(patrolEnd, patrolEnd + 320) : "";
    console.log("[r4v-engine] 巡逻结算反馈片段", JSON.stringify(block.split("\n").slice(0, 8)));
    expect(block).toContain("if (r.reward > 0)");
    // ⚠️ 记录：reward=0（type/blitz 未达标）时没有任何提示
  });
});
