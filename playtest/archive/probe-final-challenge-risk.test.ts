import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { initialState, type GameState } from "../src/engine/state";
import { doClick, clickPowerOf, comboMultiplier } from "../src/engine/actions";
import {
  BOSS_DURATION,
  BOSS_GRACE_SECONDS,
  BOSS_REWARD_IDLE_SECONDS,
  BOSS_REWARD_MIN,
  BOSS_STEAL_CAP_IDLE_SECONDS,
  BOSS_STEAL_PENALTY_IDLE_SECONDS,
  BOSS_BLITZ_REWARD_MULT,
  BOSS_BLITZ_TARGET,
  BOSS_TYPE_TARGET,
  SURVIVE_STREAK_CAP,
  bossSurviveReward,
  finishPatrol,
  newEventState,
  onBossTap,
  pickBossVariant,
  surviveStreakMult,
  type EventState,
} from "../src/engine/events";
import { SAVE_KEY, restore, serialize, type SaveAdapter } from "../src/engine/save";
import {
  COMBO_BREAK_S,
  COMBO_MAX,
  COMBO_WINDOW_S,
  simPatrolClicks,
  stepCombo,
} from "./probe-final-challenge-lib";

/**
 * 终验-B：机制逐项（宽限 / 偷点罚款 / 连胜 / 连击链 / 巡逻三变体）
 * 全部走真实引擎函数，不改 src/。
 */

/** 大 idleRate 场景：phone 100 级 → idleRate = 3200.2，点击力 1，便于手算 */
function bigIdleState(moyu = 1_000_000, streak = 0): GameState {
  return { ...initialState(), moyu, levels: { phone: 100 }, surviveStreak: streak };
}

const BIG = bigIdleState();
/** 点击力也高的场景（coffee 100 → 点击力 3201），用于“收入足以缴满封顶”的脱钩检验 */
const BIG_CLICK: GameState = { ...initialState(), moyu: 0, levels: { phone: 100, coffee: 100 } };
const BIG_IR = 3200.2;
const BIG_PER_TAP = Math.max(10, BOSS_STEAL_PENALTY_IDLE_SECONDS * BIG_IR); // 1600.1
const BIG_CAP = Math.max(10, BOSS_STEAL_CAP_IDLE_SECONDS * BIG_IR); // 19201.2

function openPatrol(variant: "hold" | "type" | "blitz" = "hold", start = 1000): EventState {
  const es = newEventState();
  es.nextBossAt = Infinity;
  es.nextMemeAt = Infinity;
  es.bossUntil = start + BOSS_DURATION;
  es.bossStartAt = start;
  es.bossVariant = variant;
  return es;
}

/** 手动按 t 秒点 n 次（连击 0），返回累计 */
function tapTimes(state: GameState, es: EventState, times: number[], combo = 0) {
  let st = state;
  let income = 0;
  let lost = 0;
  let caught = false;
  for (const t of times) {
    const r = onBossTap(st, es, t, combo);
    st = r.state;
    income += r.income;
    lost += r.lost;
    caught = caught || r.caught;
  }
  return { state: st, income, lost, caught };
}

describe("终验-④ 偷点宽限期（0.8s）", () => {
  it("宽限内：0 收入（不能白嫖）、0 罚款、不算被抓；0.8s 边界起开始计收入与罚款", () => {
    const es = openPatrol("hold");
    const graceTimes = [0, 0.2, 0.4, 0.6, 0.799];
    for (const dt of graceTimes) {
      const e = { ...es };
      const r = onBossTap(BIG, e, 1000 + dt, 0);
      expect(r.income, `t=${dt} 宽限内收入`).toBe(0);
      expect(r.lost, `t=${dt} 宽限内罚款`).toBe(0);
      expect(r.caught, `t=${dt} 宽限内不算被抓`).toBe(false);
      expect(e.bossCaught).toBe(false);
      expect(r.state.moyu).toBe(BIG.moyu);
    }
    // 0.8s 整：过宽限
    const e = { ...es };
    const r = onBossTap(BIG, e, 1000 + BOSS_GRACE_SECONDS, 0);
    expect(r.income).toBeGreaterThan(0);
    expect(r.lost).toBeCloseTo(BIG_PER_TAP, 6);
    expect(r.caught).toBe(true);
    expect(e.bossCaught).toBe(true);
    console.log(`宽限边界 t=0.799 免罚免收入；t=0.8 起 income=${r.income} lost=${r.lost} caught=${r.caught}`);
  });

  it("连点式宽限（8cps 前 7 击）：总收入的增加为 0，不产生罚款", () => {
    const es = openPatrol("hold");
    let st = BIG;
    let income = 0;
    let lost = 0;
    for (let i = 0; i < 7; i++) {
      const r = onBossTap(st, es, 1000 + i / 8, 0);
      st = r.state;
      income += r.income;
      lost += r.lost;
    }
    expect(income).toBe(0);
    expect(lost).toBe(0);
    expect(st.moyu).toBe(BIG.moyu);
    expect(es.bossCaught).toBe(false);
    expect(es.bossPenaltyTotal).toBe(0);
  });

  it("宽限点击在 type/blitz 变体也不计入任务进度（bossTaps 不涨）", () => {
    for (const variant of ["type", "blitz"] as const) {
      const es = openPatrol(variant);
      onBossTap(BIG, es, 1000 + 0.1, 0);
      onBossTap(BIG, es, 1000 + 0.5, 0);
      expect(es.bossTaps, `${variant} 宽限内不计任务`).toBe(0);
    }
  });
});

describe("终验-① 偷点（hold）：每击收入 + 每击罚款 + 单巡逻封顶", () => {
  it("每击照给点击收入（含连击），同时逐击罚款；累计罚款封顶 6×idleRate", () => {
    const es = openPatrol("hold");
    const times = Array.from({ length: 40 }, (_, i) => 1000 + 1 + i * 0.1);
    const r = tapTimes(BIG, es, times, 0);
    expect(r.income).toBe(40 * clickPowerOf(BIG)); // 连击 0 → ×1
    expect(r.lost).toBeCloseTo(BIG_CAP, 6); // 12 击 ×1600.1 = 19201.2 到顶
    expect(r.caught).toBe(true);
    expect(es.bossCaught).toBe(true);
    expect(es.bossPenaltyTotal).toBeCloseTo(BIG_CAP, 6);
    // 封顶后再点只进收入、不再罚款（也不重复判被抓）
    const after = onBossTap(r.state, es, 1007.5, 0);
    expect(after.lost).toBe(0);
    expect(after.income).toBe(clickPowerOf(BIG));
    expect(after.caught).toBe(false);
    console.log(`40 击：收入 ${r.income}，罚款 ${r.lost.toFixed(1)}（封顶 ${BIG_CAP.toFixed(1)}）`);
  });

  it("收入含连击加成：combo=12 时单击 = 点击力 × 1.24", () => {
    const es = openPatrol("hold");
    const a = onBossTap(BIG, { ...es }, 1001, 0);
    const b = onBossTap(BIG, { ...es }, 1001, 12);
    expect(a.income).toBe(clickPowerOf(BIG));
    expect(b.income).toBeCloseTo(clickPowerOf(BIG) * 1.24, 10);
  });

  it("罚款与余额脱钩（8cps 真实巡逻）：余额 0 与余额 100 倍罚款相同、余额不为负", () => {
    const a = simPatrolClicks(BIG_CLICK, 8);
    const b = simPatrolClicks({ ...BIG_CLICK, moyu: 1_000_000 * 100 }, 8);
    expect(a.lost).toBeCloseTo(b.lost, 6);
    expect(a.net).toBeGreaterThanOrEqual(-1e-9);
    // 余额 0：先收入后罚款，仍能罚满封顶（点击收入 40 击 > 封顶）
    expect(a.lost).toBeCloseTo(BIG_CAP, 6);
  });
});

describe("终验-⑤ 安然连胜 surviveStreak", () => {
  it("乘数曲线 ×(1+0.1N) 封顶 ×2", () => {
    const table = [0, 1, 5, 9, 10, 11, 50].map((n) => [n, surviveStreakMult(n)]);
    console.table(table.map(([n, m]) => ({ 连胜: n, 乘数: m })));
    expect(surviveStreakMult(0)).toBe(1);
    expect(surviveStreakMult(1)).toBeCloseTo(1.1, 10);
    expect(surviveStreakMult(5)).toBeCloseTo(1.5, 10);
    expect(surviveStreakMult(SURVIVE_STREAK_CAP)).toBe(2);
    expect(surviveStreakMult(50)).toBe(2);
  });

  it("安然结算：奖励 = max(50, 8×idleRate) × 乘数，并推进连胜（写回 GameState）", () => {
    const base = Math.max(BOSS_REWARD_MIN, BOSS_REWARD_IDLE_SECONDS * BIG_IR);
    const s0 = bigIdleState(1000, 0);
    const es = openPatrol();
    const r1 = finishPatrol(s0, es);
    expect(r1.reward).toBeCloseTo(base, 6);
    expect(r1.state.surviveStreak).toBe(1);
    expect(r1.state.moyu).toBeCloseTo(1000 + base, 6);
    const r2 = finishPatrol(r1.state, es); // 同一连胜链：1 → 2
    expect(r2.reward).toBeCloseTo(base * 1.1, 6);
    expect(r2.state.surviveStreak).toBe(2);
    const es10 = openPatrol();
    es10.surviveStreak = 9;
    const r10 = finishPatrol(bigIdleState(1000, 9), es10);
    expect(r10.reward).toBeCloseTo(base * 1.9, 6);
    expect(r10.state.surviveStreak).toBe(10);
    const r11 = finishPatrol(r10.state, es10);
    expect(r11.reward).toBeCloseTo(base * 2, 6);
    expect(r11.state.surviveStreak).toBe(11);
  });

  it("被抓清零：巡逻中偷点被抓 → 本场 0 奖励，连胜归 0", () => {
    const es = openPatrol("hold");
    es.surviveStreak = 5;
    const caught = onBossTap(bigIdleState(1000, 5), es, 1001, 0);
    expect(caught.caught).toBe(true);
    expect(es.surviveStreak).toBe(0);
    const fin = finishPatrol(caught.state, es);
    expect(fin.reward).toBe(0);
    expect(fin.state.surviveStreak).toBe(0);
    // 被抓后即使剩余时间没再点，也不能“安然”
    expect(bossSurviveReward(caught.state, { ...es, bossCaught: true })).toBe(0);
  });

  it("入存档：serialize → restore 连胜保留；非法值清洗为 0", () => {
    const mem = new Map<string, string>();
    const adapter: SaveAdapter = {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
    serialize(bigIdleState(5000, 7), adapter, 1000);
    const blob = JSON.parse(mem.get(SAVE_KEY)!) as { surviveStreak?: number };
    expect(blob.surviveStreak).toBe(7);
    const back = restore(adapter, 2000);
    expect(back.state?.surviveStreak).toBe(7);

    const bad = JSON.parse(mem.get(SAVE_KEY)!) as Record<string, unknown>;
    bad.surviveStreak = -3;
    mem.set(SAVE_KEY, JSON.stringify(bad));
    expect(restore(adapter, 2000).state?.surviveStreak).toBe(0);
    bad.surviveStreak = 2.5;
    mem.set(SAVE_KEY, JSON.stringify(bad));
    expect(restore(adapter, 2000).state?.surviveStreak).toBe(0);
    console.log("连胜入档：serialize/restore 保留 7；-3 / 2.5 清洗为 0");
  });

  it("HUD 与主循环接线（静态）：hud-streak 元素 + 主循环读档/写回", () => {
    const html = readFileSync("index.html", "utf8");
    const hud = readFileSync("src/ui/hud.ts", "utf8");
    const main = readFileSync("src/main.ts", "utf8");
    expect(html).toContain('id="hud-streak"');
    expect(hud).toContain("state.surviveStreak");
    expect(hud).toContain("🔥连胜");
    expect(main).toContain("es.surviveStreak = state.surviveStreak");
    expect(finishPatrol.toString()).toContain("surviveStreak");
  });

  it.fails("⚠️ 已知偏差：被抓瞬间 GameState.surviveStreak 未清零，巡逻结束前刷新可保留连胜", () => {
    // onBossTap 只清 es.surviveStreak；state.surviveStreak 要等 finishPatrol 才写回。
    // 玩家被抓后 8s 窗口内刷新（pagehide 会立即存档）→ restore 仍读到旧连胜，规避“被抓清零”。
    const es = openPatrol("hold");
    es.surviveStreak = 5;
    const caught = onBossTap(bigIdleState(1000, 5), es, 1001, 0);
    const mem = new Map<string, string>();
    const adapter: SaveAdapter = {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
    serialize(caught.state, adapter, 1000);
    const afterRefresh = restore(adapter, 2000).state?.surviveStreak;
    console.warn(`被抓后未结算即刷新：restore 得到连胜 ${afterRefresh}（应为 0）`);
    expect(afterRefresh, "被抓后应立即（或在存档前）清零 state.surviveStreak").toBe(0);
  });
});

describe("终验-⑥ 连击链 combo", () => {
  it("冷启动 1cps 零收益；3cps 有收益；封顶 ×1.24", () => {
    const runCold = (cps: number, seconds = 8) => {
      const n = Math.floor(seconds * cps + 1e-9);
      let combo = 0;
      let income = 0;
      for (let i = 0; i < n; i++) {
        combo = stepCombo(combo, 1 / cps);
        income += 100 * comboMultiplier(combo);
      }
      return { n, combo, lift: income / (n * 100) - 1 };
    };
    const c1 = runCold(1);
    const c3 = runCold(3);
    const c8 = runCold(8);
    console.table([
      { cps: 1, taps: c1.n, "8s 收入提升": `${(c1.lift * 100).toFixed(1)}%`, 结束连击: c1.combo },
      { cps: 3, taps: c3.n, "8s 收入提升": `${(c3.lift * 100).toFixed(1)}%`, 结束连击: c3.combo },
      { cps: 8, taps: c8.n, "8s 收入提升": `${(c8.lift * 100).toFixed(1)}%`, 结束连击: c8.combo },
    ]);
    expect(c1.lift).toBe(0); // 1cps 间隔 1s > 0.4s，冷启动不累积
    expect(c3.lift).toBeGreaterThan(0.15); // 3cps 稳定吃到连击
    expect(c8.combo).toBe(COMBO_MAX);
    expect(comboMultiplier(COMBO_MAX)).toBeCloseTo(1.24, 10);
    expect(comboMultiplier(COMBO_MAX + 5)).toBeCloseTo(1.24, 10);
    expect(comboMultiplier(0)).toBe(1);
  });

  it("<0.4s 累积、1.5s 断点清零、断点后慢点零收益", () => {
    expect(COMBO_WINDOW_S).toBeCloseTo(0.4, 10);
    expect(COMBO_BREAK_S).toBeCloseTo(1.5, 10);
    expect(stepCombo(0, 0.39)).toBe(1);
    expect(stepCombo(0, 0.41)).toBe(0); // 不累积也不清零（保持）
    expect(stepCombo(5, 1.2)).toBe(5);
    expect(stepCombo(5, 1.6)).toBe(0); // 断点清零
    // 断点后以 1cps 慢点：一直归零
    let combo = 0;
    for (let i = 0; i < 6; i++) combo = stepCombo(combo, 1);
    expect(combo).toBe(0);
    // doClick 端到端：combo 12 → +点击力×1.24
    const st = { ...initialState(), moyu: 0, levels: { phone: 3 } };
    const cp = clickPowerOf(st);
    expect(cp).toBe(1);
    expect(doClick(st, 12).moyu).toBeCloseTo(cp * 1.24, 10);
  });

  it("⚠️ 口径提示：已到 12 连后以 1cps（间隔 1.0s < 1.5s）可保持 ×1.24（符合 1.5s 断点设计）", () => {
    expect(stepCombo(12, 1.0)).toBe(12);
    expect(comboMultiplier(stepCombo(12, 1.0))).toBeCloseTo(1.24, 10);
    console.log("1cps“零收益”仅在冷启动成立；若先爆发 12 连，再以 1 次/秒点击可维持 ×1.24（1.5s 断点不触发）");
  });
});

describe("终验-④ 巡逻三变体", () => {
  it("hold：忍住有奖 / 偷点被抓 0 奖（见 ⑤）；type：点 5 次达标、点击不罚", () => {
    const base = Math.max(BOSS_REWARD_MIN, BOSS_REWARD_IDLE_SECONDS * BIG_IR);
    // 5 次达标
    const es5 = openPatrol("type");
    const r5 = tapTimes(bigIdleState(), es5, [1001, 1002, 1003, 1004, 1005]);
    expect(es5.bossTaps).toBe(BOSS_TYPE_TARGET);
    expect(r5.lost).toBe(0);
    expect(r5.caught).toBe(false);
    const fin5 = finishPatrol(r5.state, es5);
    expect(fin5.reward).toBeCloseTo(base, 6);
    // 4 次不达标
    const es4 = openPatrol("type");
    const r4 = tapTimes(bigIdleState(), es4, [1001, 1002, 1003, 1004]);
    expect(finishPatrol(r4.state, es4).reward).toBe(0);
    console.log(`type：5 击达标 reward=${fin5.reward.toFixed(0)}；4 击 reward=0；点击 lost=0`);
  });

  it("blitz：点 20 次达标、奖励 ×1.5、点击不罚；19 次为 0", () => {
    const base = Math.max(BOSS_REWARD_MIN, BOSS_REWARD_IDLE_SECONDS * BIG_IR);
    const times20 = Array.from({ length: BOSS_BLITZ_TARGET }, (_, i) => 1001 + i * 0.1);
    const es20 = openPatrol("blitz");
    const r20 = tapTimes(bigIdleState(), es20, times20);
    expect(es20.bossTaps).toBe(BOSS_BLITZ_TARGET);
    expect(r20.lost).toBe(0);
    expect(r20.caught).toBe(false);
    expect(finishPatrol(r20.state, es20).reward).toBeCloseTo(base * BOSS_BLITZ_REWARD_MULT, 6);

    const es19 = openPatrol("blitz");
    const r19 = tapTimes(bigIdleState(), es19, times20.slice(0, 19));
    expect(finishPatrol(r19.state, es19).reward).toBe(0);

    // 实际手感：宽限内点击不计任务，8s 内 20 次需 ≥~2.9cps（代码注释写 2.5cps 偏低）
    const at25 = simPatrolClicks(bigIdleState(), 2.5, { variant: "blitz" });
    const at3 = simPatrolClicks(bigIdleState(), 3, { variant: "blitz" });
    expect(at25.billableTaps).toBeLessThan(BOSS_BLITZ_TARGET);
    expect(at3.billableTaps).toBeGreaterThanOrEqual(BOSS_BLITZ_TARGET);
    console.log(`blitz：2.5cps 仅 ${at25.billableTaps}/20 次（宽限吃掉 0.8s），3cps ${at3.billableTaps}/20 次达标；实际门槛 ~2.9cps`);
  });

  it("三变体权重：hold 40% / type 35% / blitz 25%（抽样）", () => {
    const counts: Record<string, number> = { hold: 0, type: 0, blitz: 0 };
    let s = 2024 >>> 0;
    const rng = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 4000; i++) counts[pickBossVariant(rng)] += 1;
    const pct = (n: number) => counts[n]! / 4000;
    expect(pct("hold")).toBeGreaterThan(0.3);
    expect(pct("hold")).toBeLessThan(0.5);
    expect(pct("type")).toBeGreaterThan(0.25);
    expect(pct("blitz")).toBeGreaterThan(0.15);
    console.log(`变体抽样：hold ${(pct("hold") * 100).toFixed(1)}% / type ${(pct("type") * 100).toFixed(1)}% / blitz ${(pct("blitz") * 100).toFixed(1)}%`);
  });
});
