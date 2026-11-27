/**
 * R14 批 3「管理党」引擎探针（只读 src/，不修改源码）。
 *
 * 回答 4 个问题：
 * 1) 每日精力（100 点 / 3 种分配）是真取舍还是"三个都点"？
 * 2) 8 件家具是资源调度还是"一次性购物清单"？（ROI / 槽位 / 维护 / 互斥 / 耗尽时间点）
 * 3) 派遣（谁 + 什么任务）是否存在固定最优？（净收益 argmax 是否随阶段变化）
 * 4) 新系统与旧系统（同事/天赋/巡逻/离线）的协同深度（是否有实质联动，还是纯乘数）
 *
 * 产出：playtest/r14-mgr/engine-evidence.json
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { initialState, type GameState, gain } from "../src/engine/state";
import {
  ENERGY_ACTIONS, ENERGY_PER_DAY, emptyEnergy, ensureEnergy, useEnergy, energyEffects,
  type EnergyAction,
} from "../src/engine/energy";
import { DECOR, buyDecor, canBuyDecor, decorEffects } from "../src/engine/decor";
import {
  COLLEAGUES, MISSIONS, MAX_COLLEAGUE_LEVEL, dispatchReward, missionSecondsFor,
  SKILL_MATCH_BONUS, upgradeCostOf, emptyTeam,
} from "../src/engine/team";
import { costOf, effectOf, marginalEffect, stationIdleOf, stationIdleScaled, valueScoreOf } from "../src/engine/upgrades";
import { bossSurviveReward } from "../src/engine/events";
import { offlineEarn, OFFLINE_CAP_SECONDS } from "../src/engine/offline";
import { settleReturn } from "../src/engine/resume";
import { talentEffects, TALENTS, talentCostOf, addTalentPoints, emptyTalents } from "../src/engine/talents";
import { RANKS, rankFor } from "../src/engine/titles";
import { formatMoyu } from "../src/engine/format";

mkdirSync("playtest/r14-mgr", { recursive: true });
const OUT: Record<string, unknown> = {};
function note(key: string, value: unknown): void {
  OUT[key] = value;
}
const round = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d;

function st(over: Partial<GameState> = {}): GameState {
  return { ...initialState(), ...over };
}
function col(level: number, favor = 0) {
  return { level, missionId: null, startedAt: 0, endsAt: 0, favor, autoRepeat: false, rewardSnapshot: 0 };
}
function mkState(levels: Record<string, number>, team: Record<string, ReturnType<typeof col>> = {}, extra: Partial<GameState> = {}): GameState {
  return st({ levels, team: { colleagues: team }, ...extra });
}

// 三个代表性阶段（升级等级取自常见进度：早期 1 档、中期几档、后期接近满）
const S_EARLY = mkState({ coffee: 2, phone: 1 });
const S_MID = mkState({ phone: 4, toilet: 3, group: 2, meeting: 1 }, { zhou: col(3), mei: col(1) });
const S_LATE = mkState(
  { phone: 8, toilet: 6, group: 5, meeting: 3, deep: 2 },
  { zhou: col(5, 60), mei: col(5, 40), qiang: col(5, 20), li: col(4, 0), wang: col(3, 0) },
);
for (const [name, s] of Object.entries({ early: S_EARLY, mid: S_MID, late: S_LATE })) {
  const total = effectOf(s).idleRate;
  const station = stationIdleScaled(s);
  note(`idle_${name}`, {
    total: round(total, 4), station: round(station, 4),
    stationShareOfTotal: round(station / total, 4),
    hudIdleText: formatMoyu(total),
  });
}

/* ============================================================
 * 1) 每日精力：是不是"真取舍"
 * ========================================================== */
describe("R14-1 每日精力是否真取舍", () => {
  it("三个动作成本之和 == 每日预算，且每项每天限一次，任意子集都付得起", () => {
    const costs = ENERGY_ACTIONS.map((a) => ({ id: a.id, name: a.name, cost: a.cost }));
    const total = costs.reduce((s, c) => s + c.cost, 0);
    note("energy_actions", costs);
    note("energy_budget", ENERGY_PER_DAY);
    note("energy_cost_sum", total);
    note("energy_cost_sum_equals_budget", total === ENERGY_PER_DAY);

    // 枚举全部子集：能否在 left=100 时一次付清
    const subsets: { set: string[]; cost: number; affordable: boolean }[] = [];
    for (let mask = 1; mask < 8; mask++) {
      const set = ENERGY_ACTIONS.filter((_, i) => mask & (1 << i)).map((a) => a.id);
      const cost = ENERGY_ACTIONS.filter((_, i) => mask & (1 << i)).reduce((s, a) => s + a.cost, 0);
      subsets.push({ set: set as string[], cost, affordable: cost <= ENERGY_PER_DAY });
    }
    note("energy_all_subsets", subsets);
    note("energy_all_subsets_affordable", subsets.every((x) => x.affordable));
    const maximal = subsets.filter((x) => !subsets.some((y) => y.set.length > x.set.length && x.set.every((id) => y.set.includes(id))));
    note("energy_maximal_sets", maximal.map((m) => m.set));
    note("energy_unique_maximal_set", maximal.length === 1);
    expect(total).toBe(ENERGY_PER_DAY);
    expect(maximal.length).toBe(1);
  });

  it("效果全部单调正向 + 当日剩点不结转 → 唯一占优策略 = 三个都用", () => {
    // 每个动作的效果最少是 1（无负面），且不能重复用 → 超集弱占优
    const effects = ENERGY_ACTIONS.map((a) => ({ id: a.id, cost: a.cost, desc: a.desc }));
    note("energy_effect_monotone", {
      slack_idleMult: 1.25, fakeWork_patrolMult: 1.8, social_favorPerColleague: 3,
      allNonNegative: true, note: "超集只会更多不会更少 → 全用弱占优",
    });
    // 模拟整天：按任意顺序用完 3 个
    let s = mkState({}, {}, { energy: emptyEnergy("2026-11-27") });
    const order: EnergyAction[] = ["social", "fake-work", "slack"];
    for (const id of order) {
      const n = useEnergy(s, id);
      expect(n).not.toBeNull();
      s = n!;
    }
    note("energy_after_all_three", s.energy);
    expect(s.energy.left).toBe(0);
    expect(s.energy.used.length).toBe(3);
    // 再点一次也应失败（每天限一次）
    expect(useEnergy(s, "slack")).toBeNull();
    // 当天剩下点的唯一价值：没有（跨日 ensureEnergy 重置 → 不结转）
    const leftover = useEnergy(mkState({}, {}, { energy: emptyEnergy("2026-11-27") }), "slack")!;
    const nextDay = ensureEnergy(leftover, "2026-11-28");
    note("energy_leftover_wasted", { sameDayLeft: leftover.energy.left, nextDayLeft: nextDay.energy.left, carriedOver: false });
    expect(leftover.energy.left).toBe(60);
    expect(nextDay.energy.left).toBe(100);
    expect(nextDay.energy.used.length).toBe(0);
  });

  it("三档精力的实际价值差（若被迫三选一，最优是否固定）", () => {
    // 挂机档：+25% 工位挂机。注意 energy idleMult 只乘「工位」部分（不含同事固定值），见 upgrades.effectOf
    // 一天口径：在线 1h + 离线 12h（离线封顶 12h；精力 buff 在次日离线结算前不会被重置，见 R14-4）
    const DAY_IDLE_SECONDS = 3600 + 12 * 3600;
    const rows: Record<string, unknown>[] = [];
    for (const [name, base] of Object.entries({ early: S_EARLY, mid: S_MID, late: S_LATE })) {
      const idle = effectOf(base).idleRate;
      const withSlack = effectOf({ ...base, energy: { ...emptyEnergy("d"), boosted: { idleMult: 1.25, patrolRewardMult: 1 } } }).idleRate;
      const slackGainPerDay = (withSlack - idle) * DAY_IDLE_SECONDS;

      // 巡逻档：巡逻基础奖 = max(50, 5×idleRate)；每 90-150s 一次（均值 120s），连胜倍率平均按 1.5；仅在线时巡逻
      const patrolBase = Math.max(50, 5 * idle);
      const patrolsPerActiveHour = 3600 / 120;
      const fakeWorkGainPerActiveHour = patrolsPerActiveHour * 0.8 * patrolBase * 1.5;
      const fakeWorkGainPerDay = fakeWorkGainPerActiveHour * 1; // 只在线 1h 有巡逻
      // 社交档：全体 +3 好感；好感里程碑：80 → 全员挂机 +2%/人（封顶 10%）；100 → 该同事派遣 ×1.5
      const socialFavorTotal = 3 * 5; // 15 点好感
      rows.push({
        stage: name,
        idleRate: round(idle, 4),
        stationShare: round(stationIdleScaled(base) / idle, 4),
        actualIdleGainFromSlackPct: round(((withSlack - idle) / idle) * 100, 2),
        slackGainPerDay: Math.round(slackGainPerDay),
        patrolBase: Math.round(patrolBase),
        fakeWorkGainPerActiveHour: Math.round(fakeWorkGainPerActiveHour),
        fakeWorkGainPerDay: Math.round(fakeWorkGainPerDay),
        socialFavorTotal,
        ratio_slack_over_fakework_perDay: round(slackGainPerDay / Math.max(1, fakeWorkGainPerDay), 2),
      });
    }
    note("energy_value_comparison", rows);
    // 关键：UI 文案写「今天挂机 +25%」，但实际总挂机增幅远小于 25%（同事固定值不被乘，同事占比越高越稀释）
    const late = rows.find((r) => r.stage === "late")!;
    expect(Number(late.actualIdleGainFromSlackPct)).toBeLessThan(10);
    // 若被迫三选一：按"一天"口径，slack 在所有阶段都显著 > 巡逻档（巡逻收益只有在线 1h 那点）
    for (const r of rows) expect(Number(r.ratio_slack_over_fakework_perDay)).toBeGreaterThan(2);
  });

  it("跨日：不同 subset 是否会让强度出现差异（答案：不会，全用严格最优）", () => {
    // 比较 7 种可能用法在"一天"内的收益分量，确认全用的分量最大
    const base = S_MID;
    const rows = [];
    for (let mask = 0; mask < 8; mask++) {
      let s = { ...base, energy: emptyEnergy("2026-11-27") };
      for (let i = 0; i < 3; i++) {
        if (!(mask & (1 << i))) continue;
        const n = useEnergy(s, ENERGY_ACTIONS[i]!.id);
        if (n) s = n;
      }
      const e = energyEffects(s);
      rows.push({
        mask, used: s.energy.used,
        idleMult: e.idleMult, patrolRewardMult: e.patrolRewardMult,
        idleRate: round(effectOf(s).idleRate, 4),
        patrolReward: round(bossSurviveReward(s), 1),
        favorSum: Object.values(s.team.colleagues).reduce((a, c) => a + c.favor, 0),
      });
    }
    note("energy_subsets_effect", rows);
    // 全用集合在 idle/patrol/favor 三个维度都不差于任何子集
    const full = rows[7]!;
    for (const r of rows) {
      if (r === full) continue;
      expect(full.idleRate).toBeGreaterThanOrEqual(r.idleRate as number);
      expect(full.patrolReward).toBeGreaterThanOrEqual(r.patrolReward as number);
      expect(full.favorSum).toBeGreaterThanOrEqual(r.favorSum as number);
    }
  });
});

/* ============================================================
 * 2) 工位家具：资源调度 or 一次性购物清单
 * ========================================================== */
describe("R14-2 工位经营是不是一次性购物清单", () => {
  it("8 件家具：全部一次性买断、纯正向、无槽位/无维护/无互斥/无消耗", () => {
    note("decor_items", DECOR.map((d) => ({ id: d.id, name: d.name, cost: d.cost, effects: d.effects, minRank: d.minRank ?? null })));
    expect(DECOR.length).toBe(8);
    // 所有效果都 > 无（纯正向）
    for (const d of DECOR) {
      const vals = Object.entries(d.effects).map(([k, v]) => ({ k, v: v as number }));
      expect(vals.every((x) => x.v > 0)).toBe(true);
    }
    // 没有互斥组、没有槽位上限字段（引擎层无任何限制函数）
    note("decor_no_slots", { stateDecorIsArray: true, maxCount: DECOR.length, mutex: false, upkeep: false, consumesCurrency: "moyu(一次性)" });
    // minRank 字段在 DECOR 表里从未填写、canBuyDecor 也不检查
    note("decor_minRank_gate", { declaredInInterface: true, usedByAnyItem: DECOR.some((d) => d.minRank !== undefined), enforcedInCanBuy: false });
    expect(DECOR.every((d) => d.minRank === undefined)).toBe(true);

    // 买断流程：同一件不能买第二次；全部买完后无可买项
    let s = mkState({}, {}, { moyu: 1e12 });
    for (const d of DECOR) {
      s = buyDecor(s, d.id)!;
      expect(buyDecor(s, d.id)).toBeNull();
    }
    note("decor_after_buy_all", { count: s.decor.length, effects: decorEffects(s), remainingAffordable: DECOR.filter((d) => canBuyDecor(s, d.id)).length });
    expect(s.decor.length).toBe(8);
    expect(DECOR.filter((d) => canBuyDecor(s, d.id)).length).toBe(0);
    expect(buyDecor(s, "plant")).toBeNull(); // 买断后不可重复
  });

  it("全买断总价与总加成（系统何时被耗尽）", () => {
    const totalCost = DECOR.reduce((a, d) => a + d.cost, 0);
    const eff = decorEffects({ ...initialState(), decor: DECOR.map((d) => d.id) });
    note("decor_totals", {
      totalCost,
      totalCostText: `${(totalCost / 1e8).toFixed(2)}亿`,
      idleMult: round(eff.idleMult, 4),
      clickMult: round(eff.clickMult, 4),
      offlineBonus: round(eff.offlineBonus, 4),
      dispatchRewardMult: round(eff.dispatchRewardMult, 4),
      exhaustedAtLifetime: totalCost,
    });
    // 全家具买完所需累计 ≈ 2.23e9 —— 对照段位表在第几档
    const rankIdx = RANKS.reduce((idx, r, i) => (totalCost >= r.at ? i : idx), 0);
    note("decor_exhaust_rank", { rankIndex: rankIdx, rankName: RANKS[rankIdx]!.name, rankAt: RANKS[rankIdx]!.at, nextRank: RANKS[rankIdx + 1]?.name ?? null });
    expect(totalCost).toBeGreaterThan(2e9);
  });

  it("家具 ROI（回本时间）随阶段变化 → 只有一个「攒够就买下一件」的顺序", () => {
    const rows: Record<string, unknown>[] = [];
    for (const [name, base] of Object.entries({ early: S_EARLY, mid: S_MID, late: S_LATE })) {
      const idle = effectOf(base).idleRate;
      for (const d of DECOR) {
        const after = { ...base, decor: [...base.decor, d.id] };
        const idle2 = effectOf(after).idleRate;
        const click1 = effectOf(base).clickPower;
        const click2 = effectOf(after).clickPower;
        rows.push({
          stage: name, id: d.id, cost: d.cost,
          deltaIdlePerSec: round(idle2 - idle, 4),
          paybackHours: d.effects.idleMult ? round(d.cost / Math.max(1e-9, idle2 - idle) / 3600, 2) : null,
          deltaClick: round(click2 - click1, 3),
          // 用"当前收入"折算买的代价
          costAsHoursOfIncome: round(d.cost / Math.max(1e-9, idle) / 3600, 2),
          desc: d.desc,
        });
      }
    }
    note("decor_roi", rows);
    // 关键结论：idle 类家具的回本时间在该阶段基本"价格/当前收入"同阶，没有出现某件必须先买的策略拐点
    const idleItems = rows.filter((r) => r.paybackHours !== null);
    note("decor_idle_payback_hours", Object.fromEntries(
      ["early", "mid", "late"].map((stage) => [stage, idleItems.filter((r) => r.stage === stage).map((r) => ({ id: r.id, hours: r.paybackHours }))]),
    ));
  });

  it("家具 vs 商店升级：同类加成是否存在「必须二选一」的竞争（ROI 对比）", () => {
    // 比较"每 1 点摸鱼值换到多少挂机/s"，在代表性阶段把"当时最划算的商店升级"与"家具"放在同一张表
    const out: Record<string, unknown> = {};
    for (const [name, base] of Object.entries({ early: S_EARLY, mid: S_MID, late: S_LATE })) {
      let best: { id: string; level: number; cost: number; delta: number; roi: number } | null = null;
      for (const u of ["phone", "toilet", "group", "meeting", "deep", "retire"]) {
        const lv = base.levels[u as never] ?? 0;
        const c = costOf(u, lv);
        const m = marginalEffect(u, lv);
        const roi = m.idleRate / c;
        if (!best || roi > best.roi) best = { id: u, level: lv, cost: c, delta: round(m.idleRate, 4), roi };
      }
      const idle = effectOf(base).idleRate;
      const decorRows = DECOR.filter((d) => d.effects.idleMult).map((d) => {
        const delta = effectOf({ ...base, decor: [...base.decor, d.id] }).idleRate - idle;
        return { id: d.id, cost: d.cost, delta: round(delta, 4), roi: delta / d.cost, roiVsBestShop: round(delta / d.cost / (best!.roi || 1), 3) };
      });
      out[name] = { bestShopUpgrade: best, decorIdleRoi: decorRows };
    }
    note("decor_vs_shop_roi", out);
  });
});

/* ============================================================
 * 3) 派遣：是否存在固定最优（谁 + 哪个任务）
 * ========================================================== */
describe("R14-3 派遣是否存在固定最优", () => {
  it("同一同事在不同阶段/等级/好感下，净收益最高的任务是否恒定", () => {
    const stations = [1, 5, 20, 100, 500, 2000, 10000];
    const result: Record<string, unknown>[] = [];
    for (const def of COLLEAGUES) {
      for (const level of [1, 3, 5]) {
        for (const favor of [0, 100]) {
          const argmaxByStation = stations.map((station) => {
            const base = mkState({}, { [def.id]: col(level, favor) });
            const probe = (missionId: string): number => {
              const s: GameState = { ...base, team: { colleagues: { ...base.team.colleagues, [def.id]: { ...col(level, favor), missionId } } } };
              const reward = dispatchReward(s, def.id, station);
              const secs = missionSecondsFor(def.id, missionId);
              const perHour = reward / (secs / 3600);
              // 与 team-panel.ts 完全一致的口径：离岗损失 = 该同事挂机贡献 ×15%
              const colIdlePerSec = (def.idlePerLevel * level + station * def.sharePerLevel * level) * 0.15;
              const net = perHour - colIdlePerSec * 3600;
              return { mission: missionId, reward: Math.round(reward), netPerHour: Math.round(net), grossPerHour: Math.round(perHour) };
            };
            const all = MISSIONS.map((m) => probe(m.id));
            const best = [...all].sort((a, b) => b.netPerHour - a.netPerHour)[0]!;
            return { station, best: best.mission, bestNet: best.netPerHour, all };
          });
          const uniqueArgmax = [...new Set(argmaxByStation.map((x) => x.best))];
          result.push({ colleague: def.id, name: def.name, skill: def.skill, level, favor, uniqueArgmax, byStation: argmaxByStation.map((x) => ({ station: x.station, best: x.best, bestNet: x.bestNet })) });
        }
      }
    }
    note("dispatch_argmax", result);
    // 统计：任务 argmax 随 station 变化的组数（有变化 = 阶段内有决策；恒定 = 固定最优）
    const changing = result.filter((r) => (r.uniqueArgmax as string[]).length > 1);
    note("dispatch_argmax_changing_groups", changing.length);
    note("dispatch_argmax_total_groups", result.length);
  });

  it("技能匹配 +50% 是否让人「应该派匹配任务」（实际是否被别的高倍率任务压过）", () => {
    const rows: Record<string, unknown>[] = [];
    const station = 100;
    for (const def of COLLEAGUES) {
      const base = mkState({}, { [def.id]: col(5, 0) });
      const scored = MISSIONS.map((m) => {
        const s: GameState = { ...base, team: { colleagues: { ...base.team.colleagues, [def.id]: { ...col(5, 0), missionId: m.id } } } };
        const reward = dispatchReward(s, def.id, station);
        const secs = missionSecondsFor(def.id, m.id);
        const net = reward / (secs / 3600) - (def.idlePerLevel * 5 + station * def.sharePerLevel * 5) * 0.15 * 3600;
        return { mission: m.id, type: m.type, mult: m.mult, matched: def.skill === m.type, gross: Math.round(reward), netPerHour: Math.round(net) };
      });
      const best = [...scored].sort((a, b) => b.netPerHour - a.netPerHour)[0]!;
      const bestMatched = scored.filter((x) => x.matched).sort((a, b) => b.netPerHour - a.netPerHour)[0]!;
      rows.push({ colleague: def.name, skill: def.skill, best, bestMatched, matchedIsBest: best.mission === bestMatched.mission, scored });
    }
    note("dispatch_skill_match", rows);
    // 观察：匹配任务是否总是最优
    note("dispatch_matched_is_best_count", rows.filter((r) => r.matchedIsBest).length);
  });

  it("自动重复是否让「每日派遣」变成零决策（自动重复严格不差于手动）", () => {
    // 自动重复：完成后立即按当前工位重算快照再派同一任务 → 奖励不亏，动作 0 次
    // 需检查的唯一例外：当阶段变化后"同一任务"不再是该同事最优 → 需要手动改任务
    const stationChanges = [1, 100, 2000];
    const rows = COLLEAGUES.map((def) => {
      const bests = stationChanges.map((station) => {
        const base = mkState({}, { [def.id]: col(5, 0) });
        const scored = MISSIONS.map((m) => {
          const s: GameState = { ...base, team: { colleagues: { ...base.team.colleagues, [def.id]: { ...col(5, 0), missionId: m.id } } } };
          const reward = dispatchReward(s, def.id, station);
          const net = reward / (missionSecondsFor(def.id, m.id) / 3600) - (def.idlePerLevel * 5 + station * def.sharePerLevel * 5) * 0.15 * 3600;
          return { mission: m.id, net: Math.round(net) };
        });
        return [...scored].sort((a, b) => b.net - a.net)[0]!;
      });
      return { name: def.name, bestPerStage: stationChanges.map((s, i) => ({ station: s, ...bests[i] })), allSame: new Set(bests.map((b) => b.mission)).size === 1 };
    });
    note("dispatch_auto_repeat_mission_drift", rows);
    note("dispatch_all_same_across_stages", rows.filter((r) => r.allSame).length);
  });

  it("是否存在「派谁」的容量竞争（任务不限量 → 无排他）", () => {
    // 每个同事可独立派任意任务；MISSIONS 无并发上限；无全局派遣槽位
    note("dispatch_capacity", {
      missionsUnlimited: true,
      noConcurrentLimit: true,
      eachColleagueIndependent: true,
      noSharedSlot: true,
      implication: "5 人可以同时派同一个任务，不存在排班冲突 → 没有'派谁'的资源竞争",
    });
  });
});

/* ============================================================
 * 4) 协同深度 + 跨日 bug
 * ========================================================== */
describe("R14-4 协同深度 & 跨日", () => {
  it("新系统的加成是否只影响「工位」部分（与同事系统的联动强度）", () => {
    const rows: Record<string, unknown>[] = [];
    for (const [name, base] of Object.entries({ mid: S_MID, late: S_LATE })) {
      const eff = effectOf(base).idleRate;
      const station = stationIdleScaled(base);
      const teamPart = eff - station;
      // decor 全 idle 项 & slack 只乘 station
      const allIdleDecor = { ...base, decor: DECOR.map((d) => d.id) };
      const afterDecor = effectOf(allIdleDecor).idleRate;
      const withSlack = effectOf({ ...base, energy: { ...emptyEnergy("d"), boosted: { idleMult: 1.25, patrolRewardMult: 1 } } }).idleRate;
      rows.push({
        stage: name,
        totalIdle: round(eff, 4),
        stationIdle: round(station, 4),
        teamIdle: round(teamPart, 4),
        stationShare: round(station / eff, 4),
        decorFullTotalIdleGainPct: round(((afterDecor - eff) / eff) * 100, 2),
        decorFullStationOnlyGainPct: round((decorEffects(allIdleDecor).idleMult - 1) * 100, 2),
        slackTotalIdleGainPct: round(((withSlack - eff) / eff) * 100, 2),
        slackStationOnlyGainPct: 25,
      });
    }
    note("synergy_multiplier_only", rows);
    const late = rows.find((r) => r.stage === "late")!;
    // 同事占比越高，slack/家具这类"只乘工位"的加成被稀释得越厉害
    expect(Number(late.slackTotalIdleGainPct)).toBeLessThan(10);
  });

  it("跨日精力 buff 是否会被计入次日离线结算（文案「持续到当天结束」）", () => {
    const base = mkState({ phone: 4, toilet: 3, group: 2 }, { zhou: col(3) });
    const now = Date.now();
    const yesterday = new Date(now - 24 * 3600 * 1000).toLocaleDateString("sv-SE");
    // 情形 A：昨天用了 slack，今天首次打开（精力 date=昨天，buff 仍在 state 里）
    const used = useEnergy({ ...base, energy: emptyEnergy(yesterday) }, "slack")!;
    // main.ts 顺序：restore → settleReturn(离线结算) → 循环内 ensureEnergy(跨日重置)
    const settledA = settleReturn(used, now - 8 * 3600 * 1000, now, 1);
    // 情形 B：没有 buff
    const settledB = settleReturn({ ...base, energy: emptyEnergy(yesterday) }, now - 8 * 3600 * 1000, now, 1);
    const resetA = ensureEnergy(settledA.state, new Date(now).toLocaleDateString("sv-SE"));
    note("energy_offline_leak", {
      idleRate: round(effectOf(base).idleRate, 4),
      offlineEarnWithYesterdaySlack: Math.round(settledA.earned),
      offlineEarnWithoutBuff: Math.round(settledB.earned),
      extra: Math.round(settledA.earned - settledB.earned),
      energyDateAfterReset: resetA.energy.date,
      resetLeft: resetA.energy.left,
      note: "离线结算发生在 ensureEnergy 重置之前 → 昨天的 +25% 会结算进今天凌晨的离线收益",
    });
    expect(settledA.earned).toBeGreaterThan(settledB.earned);
    // 文案说"效果持续到当天结束"，实际跨日离线仍享受 → 规格不一致（利好玩家的漏洞）
  });

  it("天赋：每日 1 点 + 免费重置 → 决策是否有承诺成本", () => {
    // 每流派：tier1-4（1+1+2+2=6）+ 一个终极（3）= 9 点；3 流派 = 27；上限 24 → 终局必须放弃 3 点
    const branchCosts = ["click", "idle", "event"].map((b) => {
      const list = TALENTS.filter((t) => t.branch === b);
      const nonUlt = list.filter((t) => !t.exclusive).reduce((s, t) => s + talentCostOf(t.tier), 0);
      const oneUlt = Math.min(...list.filter((t) => t.exclusive).map((t) => talentCostOf(t.tier)));
      return { branch: b, pointsForOneUltimate: nonUlt + oneUlt, nonUlt };
    });
    note("talent_branch_cost", { branches: branchCosts, allBranches: 27, cap: 24, mustDropPoints: 3 });
    // 每天 +1 点：一条流派 9 点 ≈ 9 天；满上限 24 点 ≈ 24 天（每日赠送封顶）
    note("talent_daily_gift", { perDay: 1, daysTo24Points: 24, note: "点满上限后每日不再赠点（防白送 overflow）" });
    const branchTiers = TALENTS.filter((t) => t.branch === "idle").map((t) => ({ id: t.id, tier: t.tier, cost: talentCostOf(t.tier) }));
    note("talent_idle_branch", branchTiers);
    // 免费重置：无任何代价（UI 只 confirm），是「随时洗点」的零承诺系统
    note("talent_respec", { free: true, cost: 0, cooldown: false, note: "免费重置 → 天赋只有『现在点哪个』的弱决策，没有构筑承诺" });
  });

  it("每日决策量清点（管理党口径）", () => {
    note("decision_tally", {
      energy: { dailyActions: 3, budget: 100, costSum: 100, forcedAnswer: "三个都用", realDecisionsPerDay: 0 },
      dispatch: {
        colleagues: 5, missionsPerColleague: 6, capacityLimit: 0,
        setupDecisionsOnce: "5 次任务选择 + 5 次自动重复开关（一次性）",
        dailyDecisionsWithAutoRepeat: 0,
        actionPerDay: "一键领取 1 次（无决策）",
        argmaxChangingGroups: "2/30（只有老周 Lv1 在 station 20→100 之间从 stroll 换 coffee）",
      },
      decor: { items: 8, oneTime: true, slots: 0, upkeep: 0, mutex: 0, totalCostText: "22.35亿", decisionsTotal: "8 次（整个游戏生涯），耗尽后该页永久无事可做" },
      talent: { dailyGain: 1, cap: 24, freeRespec: true, decisionsPerDay: "0-1（点 1 下，且可随时免费洗）" },
      cards: { dailyChoices: 1, existingFromBatch2: true },
      summary: "批次3新增的『每天上线的决策链』里，精力与家具的持续决策数 = 0；真正每日要做的是领派遣奖励+点天赋点+选卡",
    });
  });
});

describe("R14-输出证据 JSON", () => {
  it("写盘", () => {
    writeFileSync("playtest/r14-mgr/engine-evidence.json", JSON.stringify(OUT, null, 2));
    expect(Object.keys(OUT).length).toBeGreaterThan(10);
  });
});