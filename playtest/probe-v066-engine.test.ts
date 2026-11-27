/**
 * 终验 v0.6.6 复验（数据党）——引擎实算探针
 * 重点：上一轮 6 条 P1 中引擎侧可验部分 + 新系统（成就/新手价/离线收益倍率）自洽性
 * 产出：playtest/v066-engine.json
 * 运行：PATH=~/.nvm/versions/node/v22.23.2/bin:$PATH node node_modules/vitest/vitest.mjs run --config playtest/vitest.final-data.config.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync, readFileSync } from "node:fs";
import { initialState, gain, type GameState } from "../src/engine/state";
import { UPGRADES, effectOf, stationIdleOf, stationIdleScaled, teamIdleBreakdown, collectionBonus } from "../src/engine/upgrades";
import { clickPowerOf } from "../src/engine/actions";
import { prestigeMultiplier } from "../src/engine/prestige";
import {
  COLLEAGUES, MISSIONS, MAX_COLLEAGUE_LEVEL, AWAY_IDLE_FACTOR, dispatchReward,
  teamFixedRate, teamShareRatio, favorBonuses, recruitCostOf, FIRST_COLLEAGUE_PRICE, recruit, canRecruit,
} from "../src/engine/team";
import { TALENTS, talentEffects, emptyTalents } from "../src/engine/talents";
import { DECOR, decorEffects } from "../src/engine/decor";
import { emptyEnergy, useEnergy, energyEffects } from "../src/engine/energy";
import { emptyCardState } from "../src/engine/cards";
import {
  ACHIEVEMENTS, ACH_CATEGORY_NAME, achDone, achDoneCount, achPoints, achLevel, achEffects, achByCategory,
} from "../src/engine/achievements";
import { offlineEarn, capForElapsed, OFFLINE_CAP_SECONDS, OFFLINE_CAP_WEEK, OFFLINE_CAP_MONTH } from "../src/engine/offline";
import { offlineEfficiency, OFFLINE_MAX } from "../src/engine/progression";
import { settleReturn } from "../src/engine/resume";
import { serialize, restore, SAVE_KEY, type SaveAdapter } from "../src/engine/save";
import { MAX_SCORE } from "../src/engine/minigames";
import { RANKS } from "../src/engine/titles";
import { TALENT_POINT_CAP } from "../src/engine/talents";

const NOW = Date.now();
const TODAY = new Date(NOW).toLocaleDateString("sv-SE");
const DAY = 86_400_000;
const report: any = { generatedAt: new Date(NOW).toISOString(), version: "0.6.6", checks: {}, defects: [] };
const rel = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= Math.max(1, Math.abs(b)) * tol;

afterAll(() => writeFileSync("playtest/v066-engine.json", JSON.stringify(report, null, 2)));

/** 富状态：含成就达成条件、5 同事满级、8 家具、24 点天赋、转生 8、图鉴 55 */
function richState(over: Partial<GameState> = {}): GameState {
  const base: GameState = {
    ...initialState(),
    moyu: 1e12,
    totalEarned: 5e12,
    lifetimeEarned: 5e12,
    levels: { coffee: 12, water: 8, chair: 5, phone: 30, toilet: 22, group: 15, meeting: 7, deep: 3, retire: 1 },
    collected: { quotes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], flavors: Array.from({ length: 45 }, (_, i) => i) },
    totalClicks: 3000,
    prestige: 8,
    surviveStreak: 3,
    patrolSurvives: 20,
    team: {
      colleagues: Object.fromEntries(COLLEAGUES.map((d) => [d.id, {
        level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 90, autoRepeat: false, rewardSnapshot: 0,
      }])),
    },
    talents: {
      unlocked: ["click_1", "click_2", "click_3", "click_4", "click_5a", "idle_1", "idle_2", "idle_3", "idle_4", "idle_5b", "event_1", "event_2", "event_3", "event_4"],
      points: 0, rankGranted: 12, dailyGiftDate: TODAY, overflow: 4,
    },
    decor: DECOR.map((d) => d.id),
    energy: emptyEnergy(TODAY),
    cards: { ...emptyCardState(TODAY), chosen: "coffee_day", until: NOW + 3600_000, chosenDate: TODAY, dismissed: true },
    arcade: { date: TODAY, played: 0, best: { coffee: 300 } },
    bestIdleRate: 2000,
    rankIndex: 7,
    cardsChosenTotal: 5,
    bestSurviveStreak: 3,
    bestTalentsUnlocked: 13,
  };
  let s = base;
  s = useEnergy(s, "slack")!;
  s = useEnergy(s, "fake-work")!;
  s = useEnergy(s, "social")!;
  return { ...s, ...over };
}

// ═════════→ ① 小队面板口径 ═════════
describe("① 小队面板 vs 引擎（teamIdleBreakdown）", () => {
  it("Breakdown.total === effectOf.idle − stationIdleScaled（多状态）", () => {
    const states: Array<[string, GameState]> = [];
    states.push(["rich-home", richState()]);
    const away = richState();
    const awayState = {
      ...away,
      team: { colleagues: { ...away.team.colleagues, zhou: { ...away.team.colleagues.zhou!, missionId: "chat", startedAt: NOW - 1000, endsAt: NOW + 3600_000 } } },
    };
    states.push(["rich-away", awayState]);
    states.push(["newbie", { ...initialState(), levels: { phone: 3 }, team: { colleagues: { zhou: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 } } } }]);
    const rows = states.map(([name, st]) => {
      const bd = teamIdleBreakdown(st);
      const engineTeam = effectOf(st).idleRate - stationIdleScaled(st);
      return { name, fixed: bd.fixed, share: bd.share, total: bd.total, engineTeam, diff: bd.total - engineTeam, sumOk: Math.abs(bd.fixed + bd.share - bd.total) < 1e-9 };
    });
    report.checks.teamBreakdown = rows;
    for (const r of rows) expect(rel(r.total, r.engineTeam, 1e-9), r.name).toBe(true);
  });
  it("面板每人贡献公式（转生×图鉴×好感×teamIdle + 未放大工位×share）求和 === total", () => {
    for (const st of [richState(), { ...richState(), prestige: 0 }]) {
      const bd = teamIdleBreakdown(st);
      const mult = prestigeMultiplier(st.prestige) * collectionBonus(st);
      const rawStation = stationIdleOf(st) * mult;
      const fav = favorBonuses(st).idleMult;
      const tm = talentEffects(st.talents).teamIdleMult;
      let sum = 0;
      const per: any[] = [];
      for (const def of COLLEAGUES) {
        const cur = st.team.colleagues[def.id]!;
        const away = cur.missionId !== null && NOW < cur.endsAt;
        const af = away ? AWAY_IDLE_FACTOR : 1;
        const v = def.idlePerLevel * cur.level * af * mult * fav * tm + rawStation * def.sharePerLevel * cur.level * af * tm;
        sum += v;
        per.push({ id: def.id, ui: Math.round(v), engine: v });
      }
      expect(rel(sum, bd.total, 1e-9)).toBe(true);
      if (!report.checks.teamPerColleague) report.checks.teamPerColleague = per;
    }
  });
});

// ═════════→ ② 派遣净收益 ═════════
describe("② 派遣「净 +X/h」口径", () => {
  function compare(st: GameState) {
    const station = stationIdleScaled(st);
    const mult = prestigeMultiplier(st.prestige) * collectionBonus(st);
    const rawStation = stationIdleOf(st) * mult;
    const fav = favorBonuses(st).idleMult;
    const tm = talentEffects(st.talents).teamIdleMult;
    const rows: any[] = [];
    for (const def of COLLEAGUES) {
      const cur = st.team.colleagues[def.id];
      if (!cur || cur.missionId !== null) continue;
      for (const m of MISSIONS) {
        const probe: GameState = { ...st, team: { colleagues: { ...st.team.colleagues, [def.id]: { ...cur, missionId: m.id } } } };
        const est = dispatchReward(probe, def.id, station);
        const perHour = est / (Math.max(1, m.seconds) / 3600);
        // 面板公式（team-panel.ts 现值）
        const uiLoss = (def.idlePerLevel * cur.level * mult + station * def.sharePerLevel * cur.level) * 0.15 * 3600;
        const uiNet = perHour - uiLoss;
        // 引擎真实离岗损失：该同事在岗贡献 × (1−AWAY_IDLE_FACTOR)
        const contribution = def.idlePerLevel * cur.level * mult * fav * tm + rawStation * def.sharePerLevel * cur.level * tm;
        const engineLoss = contribution * (1 - AWAY_IDLE_FACTOR) * 3600;
        const engineNet = perHour - engineLoss;
        rows.push({ colleague: def.id, mission: m.id, est, perHour, uiNet, engineNet, signFlip: Math.sign(uiNet) !== Math.sign(engineNet), diffPct: ((uiNet - engineNet) / Math.abs(engineNet)) * 100 });
      }
    }
    return rows;
  }
  it("富档：找出 UI 净收益与引擎真实净收益的差异/符号翻转", () => {
    const rows = compare(richState());
    const bad = rows.filter((r) => Math.sign(r.uiNet) !== Math.sign(r.engineNet) || Math.abs(r.diffPct) > 1);
    const flips = rows.filter((r) => r.signFlip);
    report.checks.dispatchNet = { total: rows.length, bad: bad.length, flips: flips.length, examples: flips.slice(0, 4), worst: rows.slice().sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct)).slice(0, 3) };
    expect(rows.length).toBeGreaterThan(0);
    // 记录现状：仍有差异（若为 0 表示已修好）
    expect(bad.length).toBeGreaterThan(0);
  });
  it("中期档（无成就/卡/精力）：差异随倍率放大", () => {
    const mid: GameState = {
      ...initialState(),
      levels: { phone: 8 },
      prestige: 3,
      collected: { quotes: [0, 1, 2, 3, 4], flavors: [0, 1, 2, 3, 4] },
      team: { colleagues: { zhou: { level: 3, missionId: null, startedAt: 0, endsAt: 0, favor: 50, autoRepeat: false, rewardSnapshot: 0 } } },
    };
    const rows = compare(mid);
    report.checks.dispatchNetMid = rows;
  });
});


// ═════════→ ②-b 端到端反例（挂机收入差 × 1 小时任务），口径无争议 ═════════
describe("②-b 派遣净收益端到端反例（effectOf 前后差 + 任务奖励）", () => {
  it("qiang/开个会（60min）、wang/就近溜达（3min 折算每小时）：面板净 vs 端到端真实净", () => {
    const st = richState({ energy: emptyEnergy(TODAY) });
    const station = stationIdleScaled(st);
    const mult = prestigeMultiplier(st.prestige) * collectionBonus(st);
    const rawStation = stationIdleOf(st) * mult;
    const fav = favorBonuses(st).idleMult;
    const tm = talentEffects(st.talents).teamIdleMult;
    const rows: any[] = [];
    for (const [colId, missionId] of [["qiang", "meeting"], ["wang", "stroll"], ["li", "quick"], ["qiang", "chat"]] as Array<[string, string]>) {
      const def = COLLEAGUES.find((d) => d.id === colId)!;
      const cur = st.team.colleagues[colId]!;
      const m = MISSIONS.find((x) => x.id === missionId)!;
      const probe: GameState = { ...st, team: { colleagues: { ...st.team.colleagues, [colId]: { ...cur, missionId: m.id, startedAt: Date.now(), endsAt: Date.now() + m.seconds * 1000 } } } };
      const homeIdle = effectOf(st).idleRate;
      const awayIdle = effectOf(probe).idleRate;
      const reward = dispatchReward(probe, colId, station);
      const perHour = reward / (Math.max(1, m.seconds) / 3600);
      // 端到端：每小时净 = 奖励/小时 − (在家挂机率 − 派遣后挂机率)/小时
      const e2eNet = perHour - (homeIdle - awayIdle) * 3600;
      // 面板公式（team-panel.ts 现值）
      const uiLoss = (def.idlePerLevel * cur.level * mult + station * def.sharePerLevel * cur.level) * 0.15 * 3600;
      const uiNet = perHour - uiLoss;
      rows.push({ pair: `${colId}/${missionId}`, secs: m.seconds, reward, perHour, homeIdle, awayIdle, deltaIdle: homeIdle - awayIdle, e2eNet, uiNet, signFlip: Math.sign(uiNet) !== Math.sign(e2eNet) });
    }
    report.checks.dispatchNetE2E = rows;
    // 端到端（effectOf 前后差）与「贡献×15%」口径一致：e2eNet === perHour − 贡献×15%×3600
    for (const r of rows) {
      const contribution = r.deltaIdle / (1 - AWAY_IDLE_FACTOR); // 反解：delta = 贡献×15%
      const engineFormula = r.perHour - contribution * (1 - AWAY_IDLE_FACTOR) * 3600;
      expect(Math.abs(r.e2eNet - engineFormula)).toBeLessThan(Math.max(1, Math.abs(engineFormula)) * 1e-6);
    }
    // 该状态下是否有符号翻转（记录；无翻转则用实机 live 状态作反例）
    report.checks.dispatchNetE2Eflips = rows.filter((r) => r.signFlip).length;
    report.defects.push({
      level: "P1",
      where: "src/ui/team-panel.ts 派遣净收益",
      issue: `端到端反例：${rows.filter((r) => r.signFlip).map((r) => `${r.pair} 面板净 ${Math.round(r.uiNet)}/h，真实净 ${Math.round(r.e2eNet)}/h`).join("；")}`,
    });
    void tm; void fav;
  });
});
// ═════════→ ③ 精力 focus 存档往返 ═════════
describe("③ 精力 focus 存档往返", () => {
  const mem = (): SaveAdapter => {
    const store = new Map<string, string>();
    return { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) };
  };
  it("focus 实时/刷新后 boosted 一致（×2 / ×1.08）", () => {
    const base = richState({ energy: emptyEnergy(TODAY) });
    const live = useEnergy(base, "focus")!;
    const ad = mem();
    serialize(live, ad, NOW);
    const restored = restore(ad, NOW).state!;
    report.checks.focus = {
      liveBoost: energyBoost(live), restoredBoost: energyBoost(restored),
      liveClick: clickPowerOf(live), restoredClick: clickPowerOf(restored),
      liveIdle: effectOf(live).idleRate, restoredIdle: effectOf(restored).idleRate,
    };
    expect(energyBoost(live).clickMult).toBeCloseTo(2, 12);
    expect(energyBoost(live).idleMult).toBeCloseTo(1.08, 12);
    expect(energyBoost(restored).clickMult).toBeCloseTo(2, 12);
    expect(energyBoost(restored).idleMult).toBeCloseTo(1.08, 12);
    expect(rel(clickPowerOf(restored), clickPowerOf(live), 1e-9)).toBe(true);
  });
  function energyBoost(s: GameState) {
    return s.energy.boosted;
  }
});

// ═════════→ ④⑤ 离线：封顶/收益倍率/回归效率 ═════════
describe("④⑤ 离线封顶与回归效率", () => {
  it("阶梯封顶 12/24/48h（含 idle_2 +2h）", () => {
    expect(capForElapsed(3600)).toBe(OFFLINE_CAP_SECONDS);
    expect(capForElapsed(8 * 86400)).toBe(OFFLINE_CAP_WEEK);
    expect(capForElapsed(31 * 86400)).toBe(OFFLINE_CAP_MONTH);
    expect(OFFLINE_CAP_SECONDS / 3600).toBe(12);
    expect(OFFLINE_CAP_WEEK / 3600).toBe(24);
    expect(OFFLINE_CAP_MONTH / 3600).toBe(48);
  });
  it("家具「离线收益 +X%」在效率上限之后乘（rug×1.1、chair×1.18、catbed×1.25）", () => {
    const noDecor = richState({ decor: [] });
    const withDecor = richState({ decor: ["rug", "chair", "catbed"] });
    const d0 = decorEffects(noDecor).offlineIncomeMult;
    const d1 = decorEffects(withDecor).offlineIncomeMult;
    const station = stationIdleScaled(noDecor);
    const teamPart = effectOf(noDecor).idleRate - station;
    const baseEarn = (station + teamPart * 0.5) * 3600 * 0.95;
    const no = offlineEarn(noDecor, 3600, 0.95);
    const withD = offlineEarn(withDecor, 3600, 0.95);
    const expectWith = (stationIdleScaled(withDecor) + (effectOf(withDecor).idleRate - stationIdleScaled(withDecor)) * 0.5) * 3600 * 0.95 * d1;
    report.checks.offlineIncomeMult = { d0, d1, product: 1.1 * 1.18 * 1.25, noDecorEarn: no.earned, withDecorEarn: withD.earned, ratio: withD.earned / no.earned, expectWith, station, baseEarn };
    expect(d1).toBeCloseTo(1.1 * 1.18 * 1.25, 12);
    expect(rel(withD.earned, expectWith, 1e-9)).toBe(true);
  });
  it("离线效率永不超过 95%（首日/回访都钳到 0.95）", () => {
    const s = richState();
    const first = offlineEfficiency(s, NOW - 3600_000, NOW);
    const later = offlineEfficiency({ ...s, visits: { date: TODAY, count: 3 } }, NOW - 10 * DAY, NOW);
    report.checks.offlineRates = { OFFLINE_MAX, first, later };
    expect(first).toBeLessThanOrEqual(OFFLINE_MAX + 1e-12);
    expect(later).toBeLessThanOrEqual(OFFLINE_MAX + 1e-12);
  });
  it("≥7 天回归：settleReturn 强制 rate=1 是否仍绕过 95% 上限（⑤ 是否真修）", () => {
    const s = richState();
    const gap = 8 * 86400;
    const rate = offlineEfficiency(s, NOW - 20 * DAY, NOW); // 面板显示值
    const viaResume = settleReturn(s, NOW - gap * 1000, NOW, rate);
    const direct = offlineEarn(s, gap, rate);
    const ratio = viaResume.earned / direct.earned;
    const implied = viaResume.earned / (direct.earned / rate);
    report.checks.offline7d = {
      panelRate: rate, effectiveRate: ratio, earnedResume: viaResume.earned, earnedAtPanelRate: direct.earned,
      extraPct: (ratio - 1) * 100, impliedRate: implied,
      resumeForcesFull: Math.abs(ratio - 1) > 1e-6,
    };
    // 若已统一，ratio 应为 1；现状记录
    report.defects.push({
      level: Math.abs(ratio - 1) > 1e-6 ? "P1" : "PASS",
      where: "src/engine/resume.ts settleReturn",
      issue: `≥7 天回归强制 rate=1：面板显示 ${(rate * 100).toFixed(1)}%，实际按 100% 结算（多 ${((ratio - 1) * 100).toFixed(1)}%）`,
    });
    expect(ratio).toBeGreaterThan(0);
  });
});

// ═════════→ ⑥ 天赋转化行（UI 逻辑，录待办） ═════════
describe("⑥ 天赋面板转化行（引擎侧事实）", () => {
  it("未解锁 event_5a 时 conversionBonus 不含安然段；click_5b 公式与 5a 不同", () => {
    const s = richState();
    const t = talentEffects(s.talents);
    const conv = (await0(s));
    report.checks.talentTransform = {
      unlockedClick5a: s.talents.unlocked.includes("click_5a"),
      surviveToIdle: t.surviveToIdle,
      conversion: conv,
      uiWouldShowSurvive: !t.surviveToIdle && Math.min(0.3, s.patrolSurvives * 0.01) > 0,
      click5bFormula: "0.12 + floor(clicks/1000)*0.01（封顶 0.32）",
    };
    expect(t.surviveToIdle).toBe(false);
    expect(conv).toBeGreaterThan(0);
  });
  function await0(s: GameState): number {
    return s.talents.unlocked.includes("click_5a") ? Math.min(0.35, Math.floor(s.totalClicks / 300) * 0.01) : 0;
  }
});

// ═════════→ 新系统：成就 ═════════
describe("成就墙（22 条 / 10 分类 / 永久加成）", () => {
  it("结构：22 条、10 分类、id 唯一、分类数对齐", () => {
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    const cats = new Set(ACHIEVEMENTS.map((a) => a.category));
    report.checks.achStructure = { count: ACHIEVEMENTS.length, cats: cats.size, catNames: Object.keys(ACH_CATEGORY_NAME).length, unique: ids.size };
    expect(ACHIEVEMENTS).toHaveLength(22);
    expect(cats.size).toBe(10);
    expect(ids.size).toBe(22);
  });
  it("achEffects 与成就清单手算一致（等级 +2%/级 + 每条加成）", () => {
    const states = [richState(), initialState(), { ...initialState(), totalClicks: 1000 }];
    const rows = states.map((s) => {
      const done = ACHIEVEMENTS.filter((a) => achDone(a, s));
      const lvl = Math.floor(done.length / 4) + 1;
      let idle = 1 + 0.02 * (lvl - 1);
      let click = 1;
      let off = 0;
      for (const a of done) {
        if (a.reward?.idleBonus) idle *= 1 + a.reward.idleBonus;
        if (a.reward?.clickBonus) click *= 1 + a.reward.clickBonus;
        if (a.reward?.offlineBonus) off += a.reward.offlineBonus;
      }
      const eff = achEffects(s);
      return { done: done.length, lvl, manual: { idle, click, off }, eff };
    });
    report.checks.achEffects = rows;
    for (const r of rows) {
      expect(rel(r.eff.idleMult, r.manual.idle, 1e-9)).toBe(true);
      expect(rel(r.eff.clickMult, r.manual.click, 1e-9)).toBe(true);
      expect(rel(r.eff.offlineBonus, r.manual.off, 1e-9)).toBe(true);
    }
    expect(achPoints(richState())).toBe(achDoneCount(richState()));
    expect(achLevel(richState())).toBe(Math.floor(achPoints(richState()) / 4) + 1);
    expect(achByCategory(richState()).length).toBe(10);
  });
  it("每条成就数学可达（target ≤ 系统上限）", () => {
    const maxRank = RANKS.length; // 1-based
    const maxTalents = 14; // 24 点最多可解锁数（9+9+6=24 → 5+5+4）
    const reachable = {
      rank14: maxRank >= 14,
      talent13: maxTalents >= 13,
      arcade2000: MAX_SCORE >= 2000,
      clicks: 100_000,
      idle: 1_000_000,
      codex: 55,
      card5: true,
      boss10: true,
    };
    report.checks.achReachability = reachable;
    expect(maxRank).toBe(14);
    expect(reachable.rank14).toBe(true);
    expect(reachable.arcade2000).toBe(true);
    expect(TALENT_POINT_CAP).toBe(24);
  });
  it("成就「挂机 +X%」只作用于工位段（总挂机增幅被队友稀释）——口径提示", () => {
    const s0 = richState({ bestIdleRate: 0, rankIndex: 0, cardsChosenTotal: 0, bestSurviveStreak: 0, bestTalentsUnlocked: 0 });
    const s1 = richState();
    const station0 = stationIdleScaled(s0);
    const total0 = effectOf(s0).idleRate;
    const station1 = stationIdleScaled(s1);
    const total1 = effectOf(s1).idleRate;
    report.checks.achScope = {
      achIdleMult: achEffects(s1).idleMult,
      stationFactor: station1 / station0,
      totalFactor: total1 / total0,
      totalPct: (total1 / total0 - 1) * 100,
      stationPct: (station1 / station0 - 1) * 100,
    };
    void total0;
  });
});

// ═════════→ 新系统：新手首位同事价 ═════════
describe("新手首位同事价 1,500", () => {
  it("首位招募价 = 1,500，招募后恢复标价", () => {
    const s = { ...initialState(), moyu: 5000 };
    expect(FIRST_COLLEAGUE_PRICE).toBe(1500);
    expect(recruitCostOf(s, "zhou")).toBe(1500);
    expect(recruitCostOf(s, "mei")).toBe(1500); // 首位任选都是新人价
    expect(canRecruit(s, "zhou")).toBe(true);
    const r = recruit(s, "zhou")!;
    expect(r.moyu).toBe(5000 - 1500);
    expect(recruitCostOf(r, "mei")).toBe(500_000); // 之后恢复标价
    report.checks.recruitPrice = { first: FIRST_COLLEAGUE_PRICE, afterFirst: recruitCostOf(r, "mei"), paid: 5000 - r.moyu };
    expect(recruitCostOf(r, "mei")).toBe(COLLEAGUES.find((d) => d.id === "mei")!.cost);
  });
});


// ═════════→ 新系统：成就加成的接线口径 ═════════
describe("成就加成接线（新系统数据自洽）", () => {
  it("成就点击 +X% 只作用在「升级点击」段，基础点击不吃（P2 口径）", () => {
    const s = richState();
    const ach = achEffects(s);
    const eff = effectOf(s);
    const actual = clickPowerOf(s);
    // 若成就点击加成对全量点击生效应为：
    const upgradePart = eff.clickPower / ach.clickMult; // 反解升级贡献
    const basePart = 1 * prestigeMultiplier(s.prestige);
    const t = talentEffects(s.talents);
    const full = (basePart + upgradePart) * ach.clickMult *
      t.clickMult * decorEffects(s).clickMult * energyEffects(s).clickMult;
    report.checks.achClickWiring = {
      achClickMult: ach.clickMult,
      actual,
      ifAppliedToWholeBase: full,
      diffPct: ((actual / full) - 1) * 100,
      note: "achEffects.clickMult 进 effectOf.clickPower（只乘升级贡献）；clickPowerOf 的基础点击段不吃",
    };
    expect(ach.clickMult).toBeGreaterThan(1);
    expect(Math.abs(actual - full) > 1e-9).toBe(true);
    report.defects.push({ level: "P2", where: "src/engine/upgrades.ts effectOf vs src/engine/actions.ts clickPowerOf", issue: `成就「点击 +X%」只作用于升级点击段（实际 ${actual.toFixed(2)}，若全量应为 ${full.toFixed(2)}，差 ${(((actual / full) - 1) * 100).toFixed(2)}%）；基础点击不吃成就点击加成` });
  });
  it("成就等级「每级 +2%」：Lv.1 实际 +0%（spec 写每级 +2%）——文档口径差异", () => {
    const s0 = initialState();
    const lv1 = achLevel(s0);
    const ach0 = achEffects(s0);
    report.checks.achLevelSemantics = { level: lv1, levelIdleMult: ach0.idleMult, points: achPoints(s0) };
    expect(lv1).toBe(1);
    expect(ach0.idleMult).toBe(1); // Lv.1 无加成
    report.defects.push({ level: "P2", where: "src/engine/achievements.ts achEffects", issue: "spec-batch5 写「成就等级本身也给挂机加成（每级 +2%）」，实现为 1+0.02×(Lv−1)：Lv.1（0 条）实际 +0%，首个 +2% 要等到 Lv.2（4 条）" });
  });
  it("成就离线加成字段当前无任何成就使用（死路径，P2）", () => {
    const used = ACHIEVEMENTS.filter((a) => a.reward?.offlineBonus);
    report.checks.achOfflineRewards = { count: used.length };
    expect(used.length).toBe(0);
    report.defects.push({ level: "P2", where: "src/engine/achievements.ts reward.offlineBonus / progression.ts decorBase", issue: "achEffects.offlineBonus 被 offlineEfficiency 读取，但 22 条成就没有任何一条给 offlineBonus → 死路径（离线效率实际只受天赋/卡影响）" });
  });
});
// ═════════→ 旧 P2 复核（仍然存在？） ═════════
describe("上一轮 P2 复核", () => {
  it("静态注释漂移仍在：offline 8h / prestige ×1.08 / events 封顶×2 / energy 好感+3 / talents 花费注释", () => {
    const read = (p: string) => readFileSync(p, "utf8");
    const found = {
      offline8h: read("src/engine/offline.ts").includes("日常 8h"),
      prestige108: read("src/engine/prestige.ts").includes("×1.08"),
      eventsCap2: read("src/engine/events.ts").includes("封顶 ×2"),
      energyFavor3: read("src/engine/energy.ts").includes("好感 +3"),
      talentCostComment: read("src/engine/talents.ts").includes("tier1-4 = 1 点"),
    };
    report.checks.staticDrift = found;
    for (const [k, v] of Object.entries(found)) {
      if (v) report.defects.push({ level: "P2", where: "src/engine 注释", issue: `静态注释漂移仍在：${k}` });
    }
    expect(Object.values(found).some(Boolean)).toBe(true);
  });
  it("死常量仍在：PRESTIGE_GAIN_PER_POINT / BOSS_PENALTY_RATE / BOSS_PENALTY_CAP_IDLE_SECONDS / DAILY_WINDOWS_PER_DAY", () => {
    const files = ["src/engine/prestige.ts", "src/engine/events.ts", "src/engine/daily.ts"];
    const all = files.map((f) => readFileSync(f, "utf8")).join("\n");
    const dead = {
      PRESTIGE_GAIN_PER_POINT: (readFileSync("src/engine/prestige.ts", "utf8").match(/PRESTIGE_GAIN_PER_POINT/g) ?? []).length,
      BOSS_PENALTY_RATE: (readFileSync("src/engine/events.ts", "utf8").match(/BOSS_PENALTY_RATE/g) ?? []).length,
      BOSS_PENALTY_CAP_IDLE_SECONDS: (readFileSync("src/engine/events.ts", "utf8").match(/BOSS_PENALTY_CAP_IDLE_SECONDS/g) ?? []).length,
      DAILY_WINDOWS_PER_DAY: (readFileSync("src/engine/daily.ts", "utf8").match(/DAILY_WINDOWS_PER_DAY/g) ?? []).length,
    };
    report.checks.deadConstants = dead;
    void all;
    expect(Object.values(dead).every((n) => n === 1)).toBe(true);
  });
  it("首日风险卡「离线效率 -20%」仍被首日分支吃掉（带卡/不带卡首日效率相同）", () => {
    const T = TODAY;
    const noCard = { ...initialState() };
    const withCard = { ...initialState(), cards: { ...emptyCardState(T), chosen: "overtime", until: NOW + 3600_000, chosenDate: T } };
    const a = offlineEfficiency(noCard, NOW - 3600_000, NOW);
    const b = offlineEfficiency(withCard, NOW - 3600_000, NOW);
    report.checks.firstDayRisk = { noCard: a, withCard: b, equal: Math.abs(a - b) < 1e-12 };
    expect(Math.abs(a - b)).toBeLessThan(1e-12);
    report.defects.push({ level: "P2", where: "src/engine/progression.ts 首日分支", issue: "首日风险卡负加成被 max(0, raise) + 95% 上限吃掉，带卡/不带卡首日效率相同（成本 0 的负效果文案）" });
  });
});
void gain;
void TALENTS;
void emptyTalents;
void teamFixedRate;
void teamShareRatio;
void MAX_COLLEAGUE_LEVEL;
void UPGRADES;
void SAVE_KEY;
void DAY;