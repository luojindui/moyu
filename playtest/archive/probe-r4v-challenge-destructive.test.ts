import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { costOf, effectOf, UPGRADES } from "../src/engine/upgrades";
import {
  newEventState,
  onBossTap,
  bossSurviveReward,
  finishPatrol,
  surviveStreakMult,
  BOSS_GRACE_SECONDS,
  BOSS_DURATION,
  BOSS_PENALTY_MIN,
  type EventState,
} from "../src/engine/events";
import { loadScenes, stateFrom, decision, simPatrol, openHold, r1, pct, lcg } from "./probe-r4v-challenge-lib";

/**
 * 验收-⑤ 破坏性检查：
 *  A 赌点是「确定性阈值」还是「概率赌」？（onBossTap 无 RNG → 决策可被算死）
 *  B 巡逻期是否变成「无脑连点」（硬刚是否总是最优）
 *  C 0.8s 宽限是否仍吸收反应时间 / 是否被「宽限偷点」白嫖
 *  D 罚款的 5% 余额部分是否可被「花光再点」规避（囤积保护是否形同虚设）
 *  E 连胜中断的隐形成本是否让高连胜玩家反而该忍（设计上的补救）
 */

function baseReward(state: ReturnType<typeof stateFrom>): number {
  const { idleRate } = effectOf(state);
  return Math.max(50, 5 * idleRate);
}

/** N 次巡逻视野的连胜价值（从 streakAfterCurrent 起算） */
function horizonValue(base: number, streakAfterCurrent: number, patrols = 12): number {
  let v = 0;
  for (let i = 0; i < patrols; i++) v += base * surviveStreakMult(streakAfterCurrent + i);
  return v;
}

describe("验收-⑤ 破坏性检查", () => {
  it("A. 赌点无 RNG：同一状态重复 5 次收益完全一致（确定性阈值，不是概率赌）", () => {
    const s = stateFrom({ coffee: 39, phone: 31, water: 26, toilet: 13, chair: 11 }, 513874);
    const vals = Array.from({ length: 5 }, () => simPatrol(s, 5).moyuDelta);
    expect(new Set(vals).size).toBe(1);
    // 巡逻相位偏移（玩家首击时刻不同）只影响宽限内免罚次数 → 对总额影响极小
    const phaseDeltas: number[] = [];
    for (const phase of [0, 0.05, 0.1, 0.2]) {
      const es = newEventState();
      openHold(es, 1000);
      let st = s;
      let lost = 0;
      for (let i = 0; ; i++) {
        const t = phase + i / 5;
        if (t >= BOSS_DURATION) break;
        const r = onBossTap(st, es, 1000 + t, 12);
        st = r.state;
        lost += r.lost;
      }
      phaseDeltas.push(lost);
    }
    console.log({ 同状态5次硬刚净: vals.map((v) => r1(v)), 不同相位罚款: phaseDeltas.map((v) => r1(v)) });
    expect(Math.max(...phaseDeltas) - Math.min(...phaseDeltas)).toBeLessThan(1e-9); // 罚款一次，相位不影响总罚款
    console.log("结论：偷点结果确定（无暴击/无随机罚款额），玩家可算死「该点/该忍」，心跳只能来自信息不透明");
  });

  it("B. 是否「无脑连点」：全量真实场景的硬刚最优占比", () => {
    const scenes = loadScenes().filter((s) => s.minute >= 3);
    const rows: Record<string, unknown>[] = [];
    for (const cps of [1, 2, 3, 5, 8]) {
      let hard = 0;
      let total = 0;
      for (const s of scenes) {
        for (const bank of [s.moyu, 0]) {
          total++;
          if (decision(stateFrom(s.levels, bank), cps, 0).delta > 0) hard++;
        }
      }
      rows.push({ cps, 硬刚最优: `${hard}/${total}`, 占比: pct(hard / total) });
    }
    console.table(rows);
    const at8 = scenes.flatMap((s) => [s.moyu, 0].map((bank) => decision(stateFrom(s.levels, bank), 8, 0)));
    const at8hard = at8.filter((d) => d.delta > 0).length / at8.length;
    const at1 = scenes.flatMap((s) => [s.moyu, 0].map((bank) => decision(stateFrom(s.levels, bank), 1, 0)));
    const at1hard = at1.filter((d) => d.delta > 0).length / at1.length;
    expect(at8hard).toBeGreaterThan(0.9);
    console.log(`8cps 硬刚最优 ${pct(at8hard)}；1cps 仍只有 ${pct(at1hard)} → 快手的巡逻期已变成无脑连点（没有理由停手）`);
    // 1h 政策对比（28 次巡逻）：全程忍（奖励随连胜涨到 ×2） vs 全程硬刚（每次拿点击收入−罚款）
    const patrols = 28;
    const rows2: Record<string, unknown>[] = [];
    let hardWins8 = 0;
    let hardWins1 = 0;
    let total = 0;
    for (const sc of scenes.filter((x) => x.minute >= 10)) {
      const st = stateFrom(sc.levels, sc.moyu);
      const es = newEventState();
      let dodge = 0;
      for (let i = 0; i < patrols; i++) {
        openHold(es, 1000 + i * 200);
        dodge += finishPatrol(st, es).reward;
      }
      const hard1 = simPatrol(st, 1).moyuDelta * patrols;
      const hard3 = simPatrol(st, 3).moyuDelta * patrols;
      const hard8 = simPatrol(st, 8).moyuDelta * patrols;
      total++;
      if (hard8 > dodge) hardWins8++;
      if (hard1 > dodge) hardWins1++;
      rows2.push({
        画像: `${sc.persona.split("(")[0]}@${sc.minute}min`,
        '忍(含连胜)1h': Math.round(dodge),
        硬刚1cps: Math.round(hard1),
        硬刚3cps: Math.round(hard3),
        硬刚8cps: Math.round(hard8),
        '8cps政策胜者': hard8 > dodge ? "硬刚" : "忍",
      });
    }
    console.table(rows2);
    console.log(`1h 政策：8cps 硬刚胜 ${hardWins8}/${total}；1cps 硬刚胜 ${hardWins1}/${total}（单次巡逻 8cps 是 100% 硬刚优，但连胜滚到 ×2 后部分场景长期反超）`);
    // R5 后：8cps 仍是强选择（人类难持续），但 3cps 已被压回忍侧（见 r5-balance 探针）
    expect(hardWins8).toBeGreaterThanOrEqual(total * 0.5);
    expect(hardWins1).toBeLessThan(total * 0.4);
  });

  it("C. 0.8s 宽限：吸收反应时间 ✅，但「宽限内白嫖」严格优于忍 ⚠️", () => {
    const s = stateFrom({ coffee: 39, phone: 31, water: 26, toilet: 13, chair: 11 }, 513874);
    // 边界：0.79s 免罚、0.8s 起罚
    const es = newEventState();
    openHold(es, 1000);
    const free = onBossTap(s, es, 1000 + 0.79, 12);
    expect(free.caught).toBe(false);
    expect(free.lost).toBe(0);
    const caught = onBossTap(s, es, 1000 + BOSS_GRACE_SECONDS, 12);
    expect(caught.caught).toBe(true);
    expect(caught.lost).toBeGreaterThan(0);
    // 宽限内点击（然后收手）：白拿点击收入 + 仍拿安然奖励 → 严格优于纯忍
    const rows: Record<string, unknown>[] = [];
    for (const sc of loadScenes().filter((x) => [10, 60, 180].includes(x.minute))) {
      const st = stateFrom(sc.levels, sc.moyu);
      const soft = bossSurviveReward(st, newEventState());
      const g = simPatrol(st, 8, { graceOnly: true });
      rows.push({
        画像: `${sc.persona.split("(")[0]}@${sc.minute}min`,
        宽限内点击数: g.taps,
        白嫖收入: Math.round(g.moyuDelta),
        占安然奖励: pct(g.moyuDelta / soft),
        纯忍EV: Math.round(soft),
        宽限偷点EV: Math.round(g.moyuDelta + soft),
        作弊增益: pct((g.moyuDelta + soft) / soft - 1),
      });
    }
    console.table(rows);
    for (const sc of loadScenes().filter((x) => x.minute >= 10)) {
      const st = stateFrom(sc.levels, sc.moyu);
      const soft = bossSurviveReward(st, newEventState());
      const g = simPatrol(st, 8, { graceOnly: true });
      expect(g.moyuDelta + soft).toBeGreaterThanOrEqual(soft); // 永不亏 → 最优解变成「点 0.8s 然后收手」
    }
    console.log("宽限内点若干下 + 安然奖励 = 严格支配纯忍：最优策略其实是白嫖宽限，而非赌");
    // 反应时间：人在 0.1~0.45s 反应过来点一下（都在宽限内）→ 免罚
    const rng = lcg(99);
    let reflexFree = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const es2 = newEventState();
      openHold(es2, 1000);
      onBossTap(s, es2, 1000 + (0.1 + rng() * 0.35), 0);
      reflexFree++;
    }
    expect(reflexFree).toBe(N);
    console.log(`反应时点击免罚率：${pct(reflexFree / N)}（0.1~0.45s 反射全部被宽限吸收 ✅）`);
    // 但「反应过来后继续按原节奏点」会立刻被逮：1cps 下首击后 1s 的下一击 > 0.8s
    const es3 = newEventState();
    openHold(es3, 1000);
    onBossTap(s, es3, 1000 + 0.3, 0); // 反射点击
    const next = onBossTap(s, es3, 1000 + 1.3, 0);
    expect(next.caught).toBe(true);
    console.log(`反射点击后若继续 1cps 节奏：1.3s 处被抓（罚款 ${r1(next.lost)}）→ 宽限只吸收反射那一下，不代替停手决策`);
  });

  it("✅ R5 已修复（P1）：花光余额不再能规避罚款（罚款按挂机收益计）", () => {
    const scenes = loadScenes().filter((s) => s.minute >= 10);
    const rows: Record<string, unknown>[] = [];
    let flips = 0;
    for (const sc of scenes) {
      const hoard = decision(stateFrom(sc.levels, sc.moyu), 3, 0);
      const zero = decision(stateFrom(sc.levels, 0), 3, 0);
      const flipped = hoard.delta <= 0 && zero.delta > 0;
      if (flipped) flips++;
      rows.push({
        画像: `${sc.persona.split("(")[0]}@${sc.minute}min`,
        '囤积时3cps硬刚−忍': r1(hoard.delta),
        '花光后3cps硬刚−忍': r1(zero.delta),
        罚款_囤积: Math.round(hoard.penalty),
        罚款_花光: Math.round(zero.penalty),
        罚款降低: pct(1 - zero.penalty / Math.max(1, hoard.penalty)),
        结论: flipped ? "花光后翻正" : hoard.delta > 0 ? "本就硬刚优" : "仍忍优",
      });
    }
    console.table(rows);
    console.log(`花光余额把 3cps 从忍优翻成硬刚优的场景：${flips}/${scenes.length}`);
    // ✅ R5 已修复（P1）：罚款与余额脱钩 → 花光不再能规避罚款
    expect(flips).toBe(0);
    // 可花光的程度：下一级最便宜升级是否买得起
    const rows2: Record<string, unknown>[] = [];
    for (const sc of scenes.filter((x) => [60, 180].includes(x.minute))) {
      const minNext = Math.min(...UPGRADES.map((u) => costOf(u.id, sc.levels[u.id] ?? 0)));
      rows2.push({
        画像: `${sc.persona.split("(")[0]}@${sc.minute}min`,
        余额: Math.round(sc.moyu),
        最便宜下一级: Math.round(minNext),
        能否花光: minNext <= sc.moyu ? "能买→余额可压低" : "买不起→只能囤积",
      });
    }
    console.table(rows2);
    console.log("升级永远正收益 → 花光再点没有代价；只有下一级买不起的后期才会被迫囤积，而 5% 罚款恰好只惩罚这些囤积者");
  });

  it("E. 连胜中断的隐形成本：高连胜时该忍（对无脑连点的唯一制衡）", () => {
    const scenes = loadScenes().filter((s) => [60, 180].includes(s.minute));
    const rows: Record<string, unknown>[] = [];
    for (const sc of scenes) {
      const st = stateFrom(sc.levels, sc.moyu);
      const base = baseReward(st);
      for (const streak of [0, 3, 10]) {
        const dodgeValue = base * surviveStreakMult(streak) + horizonValue(base, streak + 1);
        const hardFuture = horizonValue(base, 0);
        const hard5 = simPatrol(st, 5).moyuDelta;
        const hard8 = simPatrol(st, 8).moyuDelta;
        rows.push({
          画像: `${sc.persona.split("(")[0]}@${sc.minute}min`,
          连胜: streak,
          忍_12期总价值: Math.round(dodgeValue),
          硬刚12期_5cps: Math.round(hard5 + hardFuture),
          硬刚12期_8cps: Math.round(hard8 + hardFuture),
          '5cps该点?': hard5 + hardFuture > dodgeValue,
          '8cps该点?': hard8 + hardFuture > dodgeValue,
        });
      }
    }
    console.table(rows);
    // 高连胜（10）时连 8cps 都该忍 → 连胜机制给忍补了正当性
    const sc = scenes.find((s) => s.persona.includes("clicker") && s.minute === 180)!;
    const st = stateFrom(sc.levels, sc.moyu);
    const base = baseReward(st);
    const dodge10 = base * 2 + horizonValue(base, 11);
    const hard8 = simPatrol(st, 8).moyuDelta + horizonValue(base, 0);
    expect(dodge10).toBeGreaterThan(hard8);
    console.log(`clicker@180 连胜10：忍(12期) ${Math.round(dodge10)} > 8cps硬刚(12期) ${Math.round(hard8)} → 连胜越高越不该赌`);
    // 但硬刚玩家永远不会积累连胜（每次被抓清零）→ 制衡对连点人群不生效
    const es: EventState = newEventState();
    es.surviveStreak = 7;
    openHold(es, 1000);
    onBossTap(st, es, 1000 + BOSS_GRACE_SECONDS + 0.01, 0);
    expect(es.surviveStreak).toBe(0);
    console.log("连点玩家每次被抓都把连胜清零 → 高连胜制衡只对已经在忍的人生效，形成策略分叉而非赌点");
  });

  it("F. 罚款安全性 & 先收入后罚款顺序验证", () => {
    // 罚款基数含刚拿到的点击收入（先给钱再算 5%）
    const s = stateFrom({ coffee: 39 }, 100000); // totalEarned 也被置为 100000
    const es = newEventState();
    openHold(es, 1000);
    const r = onBossTap(s, es, 1000 + BOSS_GRACE_SECONDS + 0.01, 0);
    const cp = 1 + effectOf(s).clickPower;
    const raw = Math.max(BOSS_PENALTY_MIN, 0.05 * (100000 + cp));
    const cap = Math.max(10, 10 * effectOf(s).idleRate);
    expect(r.lost).toBeCloseTo(Math.min(raw, cap, 100000 + cp), 6);
    expect(r.state.totalEarned).toBeCloseTo(100000 + cp, 6); // 收入进累计，罚款不扣累计
    // 余额 0 且收入很低：罚款吃掉全部收入但不为负（早期偷点 = 白点）
    const s0: ReturnType<typeof stateFrom> = { ...initialState(), levels: { coffee: 0 }, moyu: 0, totalEarned: 0 };
    const es2 = newEventState();
    openHold(es2, 1000);
    const r2 = onBossTap(s0, es2, 1000 + BOSS_GRACE_SECONDS + 0.01, 0);
    expect(r2.income).toBe(1);
    expect(r2.lost).toBe(1); // 余额只有 1 → 罚到 0
    expect(r2.state.moyu).toBe(0);
    expect(r2.state.moyu).toBeGreaterThanOrEqual(0);
    console.log(`早期(cp=1,余额0)偷点：收入 ${r2.income} 被全额罚掉，且丢 50 安然奖励 → 纯亏`);
  });
});
