import { describe, it, expect } from "vitest";
import { initialState, gain } from "./state";
import {
  ARCADE_DAILY_LIMIT,
  coffeeScore,
  emptyArcade,
  ensureArcade,
  finishGame,
  findScore,
  genBeats,
  genDrops,
  genFindRounds,
  judgeBeat,
  judgeCatch,
  GAMES,
} from "./minigames";

const TODAY = "2026-11-27";
const rich = () => ({ ...gain(initialState(), 1e9), arcade: emptyArcade(TODAY) });
const rng = () => 0.42;

describe("摸鱼站", () => {
  it("3 个游戏，每日总次数 3", () => {
    expect(GAMES).toHaveLength(3);
    expect(ARCADE_DAILY_LIMIT).toBe(3);
  });

  it("完成一局：扣次数、给奖励、记最高分", () => {
    const s = rich();
    const r = finishGame(s, "coffee", 120, 1000)!;
    expect(r.reward).toBeGreaterThan(0);
    expect(r.state.arcade.played).toBe(1);
    expect(r.state.arcade.best.coffee).toBe(120);
    expect(r.state.moyu).toBe(s.moyu + r.reward);
  });

  it("超过每日次数后不再能玩", () => {
    let s = rich();
    for (let i = 0; i < ARCADE_DAILY_LIMIT; i++) s = finishGame(s, "coffee", 50, 100)!.state;
    expect(finishGame(s, "coffee", 50, 100)).toBeNull();
  });

  it("0 分也消耗次数（防刷）", () => {
    const s = rich();
    const r = finishGame(s, "coffee", 0, 100)!;
    expect(r.reward).toBe(0);
    expect(r.state.arcade.played).toBe(1);
  });

  it("跨日重置次数，保留最高分", () => {
    let s = finishGame(rich(), "coffee", 80, 100)!.state;
    const next = ensureArcade(s, "2026-11-28");
    expect(next.arcade.played).toBe(0);
    expect(next.arcade.best.coffee).toBe(80);
    expect(ensureArcade(next, "2026-11-28")).toBe(next);
  });

  it("接咖啡：掉落序列递增、判定窗口有效", () => {
    const drops = genDrops(30, rng);
    expect(drops.length).toBeGreaterThan(20);
    for (let i = 1; i < drops.length; i++) expect(drops[i]!.at).toBeGreaterThan(drops[i - 1]!.at);
    // 正中心命中
    const d = drops[3]!;
    expect(judgeCatch(drops, d.at, d.x).hit?.id).toBe(d.id);
    // 偏差太大不命中
    expect(judgeCatch(drops, d.at + 0.2, d.x + 0.3).hit).toBeNull();
  });

  it("接咖啡计分：combo 有加成，漏接扣分", () => {
    expect(coffeeScore(10, 0, 0)).toBe(100);
    expect(coffeeScore(10, 0, 10)).toBeGreaterThan(100); // 满 combo ×2
    expect(coffeeScore(10, 5, 0)).toBe(90);
  });

  it("找老板：轮次生成在网格内，计分正确", () => {
    const rounds = genFindRounds(5, 3, rng);
    expect(rounds).toHaveLength(5);
    for (const r of rounds) expect(r.bossAt).toBeGreaterThanOrEqual(0), expect(r.bossAt).toBeLessThan(9);
    expect(findScore(3, 0, 2)).toBe(150 + 20);
    expect(findScore(2, 1, 0)).toBe(100 - 20);
  });

  it("节奏：节拍按 BPM 生成，判定分 perfect/good/miss", () => {
    const beats = genBeats(10, 120, 0.5); // 120BPM = 0.5s 间隔
    expect(beats[0]).toBeCloseTo(0.5, 3);
    expect(beats[1]! - beats[0]!).toBeCloseTo(0.5, 3);
    const used = new Set<number>();
    expect(judgeBeat(beats, 0.51, used)).toMatchObject({ kind: "perfect", score: 20 });
    expect(judgeBeat(beats, 0.64, used)).toMatchObject({ kind: "good", score: 10 });
    expect(judgeBeat(beats, 2.2, used)).toMatchObject({ kind: "miss", score: 0 });
  });
});
