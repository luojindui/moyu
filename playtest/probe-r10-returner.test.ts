import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import {
  createBot,
  runDays,
  reopenAfterGap,
  snapshot,
  DAY_MS,
  OFFLINE_CAP_SECONDS,
  type VisitLog,
} from "./probe-r10-returner-lib";
import { restore, serialize, type SaveAdapter } from "../src/engine/save";
import { formatMoyu } from "../src/engine/format";
import { ensureVisits, offlineEfficiency } from "../src/engine/progression";
import { costOf, UPGRADES } from "../src/engine/upgrades";

const GAP_DAYS = 30;
const ensureVisitsStub = (state: never, at: number) => ensureVisits(state as never, at) as never;
const offlineEfficiencyStub = (state: never, createdAt: number, at: number) => offlineEfficiency(state as never, createdAt, at);

function hours(sec: number): string {
  return `${(sec / 3600).toFixed(1)}h`;
}
function pct(x: number): string {
  return `${(x * 100).toFixed(4)}%`;
}
function row(v: VisitLog): string {
  return `D${v.day}V${v.visit} gap=${hours(v.offlineSeconds)} rate=${v.rate.toFixed(2)} applied=${hours(v.applied)} off+${formatMoyu(v.earned)} active+${formatMoyu(v.activeEarned)} 买${v.purchases} 日报${v.claimedReward !== null ? "领+" + formatMoyu(v.claimedReward) : v.dailyDone ? "完成未领" : "未完成"} streak=${v.streakAfterDaily}`;
}

function memAdapterFrom(raw: string): SaveAdapter {
  const m = new Map<string, string>([["moyu-save", raw]]);
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}
function emptyAdapter(): SaveAdapter {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe("R10 回归老玩家：3 天活跃 → 停 30 天 → 回来开一次", () => {
  it("主场景：离线结算 / 补偿比例 / 进度保留 / 日报与 streak", () => {
    // ---------- A. 玩 3 天（每天 3 次 × 5 分钟，2cps）----------
    const bot = createBot(20261127);
    runDays(bot, 3);
    const d3 = snapshot(bot.state);
    const d3Visits = bot.visits;
    const dayIncome = [1, 2, 3].map((day) => {
      const vs = d3Visits.filter((v) => v.day === day);
      const offline = vs.reduce((a, v) => a + v.earned, 0);
      const active = vs.reduce((a, v) => a + v.activeEarned, 0);
      const dailyReward = vs.reduce((a, v) => a + (v.claimedReward ?? 0), 0);
      return {
        day,
        offline,
        active,
        dailyReward,
        total: offline + active + dailyReward,
        rates: vs.map((v) => v.rate),
        streak: vs.at(-1)!.streakAfterDaily,
        rank: vs.at(-1)!.rankName,
        collection: vs.at(-1)!.collection,
        clicks: vs.reduce((a, v) => a + v.clicks, 0),
      };
    });

    console.log("\n===== 3 天活跃（每天 3 次 × 5 分钟，2cps）=====");
    for (const v of d3Visits) console.log("  " + row(v));
    for (const d of dayIncome) {
      console.log(
        `  D${d.day} 日收入 ${formatMoyu(d.total)}（离线 ${formatMoyu(d.offline)} / 主动 ${formatMoyu(d.active)} / 日报 ${formatMoyu(d.dailyReward)}），段位 ${d.rank}，图鉴 ${d.collection}/55，streak=${d.streak}，点击 ${d.clicks}`,
      );
    }
    console.log(
      `  D3 结束：挂机率 ${formatMoyu(d3.idleRate)}/s，点击力 ${d3.clickPower.toFixed(0)}，累计 ${formatMoyu(d3.lifetimeEarned)}，转生 ${d3.prestige} 点，可转生=${d3.canPrestige}`,
    );

    // ---------- B. 停 30 天 → 回来开一次 ----------
    const lastSavedAt = bot.now;
    const re = reopenAfterGap(bot, GAP_DAYS * DAY_MS);
    const after = snapshot(bot.state);
    const realWait = re.offlineSeconds;
    const settled = re.applied;
    const effective = settled * re.rate;
    const capRatio = effective / realWait;
    const base07Ratio = effective / (realWait * 0.7);
    const day3Income = dayIncome[2]!.total;

    // 参照系：同种子玩家不弃坑、继续按同样节奏玩到 D33 的收入与进度
    const ref = createBot(20261127);
    runDays(ref, 3);
    const d3RefTotal = ref.state.totalEarned;
    runDays(ref, GAP_DAYS + 3, 4);
    const refD33 = snapshot(ref.state);
    const missed = ref.state.totalEarned - d3RefTotal;

    console.log("\n===== 30 天后回来开一次 =====");
    console.log(
      `  距上次存档真实等待 ${hours(realWait)}（${(realWait / 86400).toFixed(1)} 天）；8h 封顶后实际结算 ${hours(settled)}；本次离线效率 ${re.rate.toFixed(2)}（0.7 基础 + 1 次回访 0.1）`,
    );
    console.log(
      `  离线结算获得 ${formatMoyu(re.earned)}（= ${formatMoyu(re.idleRate)}/s × ${hours(settled)} × ${re.rate.toFixed(2)}）`,
    );
    console.log(`  补偿口径①相对 30 天实际等待（按 1.0 满效率理论值）：${hours(effective)} / ${hours(realWait)} = ${pct(capRatio)}`);
    console.log(`  补偿口径②相对 0.7 基础效率：${pct(base07Ratio)}`);
    console.log(
      `  补偿口径③相对「不弃坑继续玩 30 天」的同期收入：${formatMoyu(re.earned)} / ${formatMoyu(missed)} = ${pct(re.earned / missed)}`,
    );
    console.log(
      `  相当于 D3 一天日收入的 ${pct(re.earned / day3Income)}（${formatMoyu(re.earned)} / ${formatMoyu(day3Income)}）；相当于回归当天日报奖励的 ${(re.earned / after.dailyReward).toFixed(0)} 倍`,
    );
    console.log(
      `  回来时：段位 ${after.rankName}（进度 ${(after.rankProgress * 100).toFixed(0)}%），图鉴 ${after.collection}/55，挂机率 ${formatMoyu(after.idleRate)}/s，余额 ${formatMoyu(after.moyu)}`,
    );
    console.log(`  欢迎面板：显示=${re.welcome}，封顶标注=${re.capped}`);
    console.log(
      `  日报：离开时 streak=${d3.streak} → 回来 ${after.streak}（${after.streak === 0 ? "静默清零" : "保留"}），今日目标 ${after.dailyGoals.map((g) => g.id).join("/")}，已领=${after.dailyClaimed}，回访计数=${after.visits.count}`,
    );

    // 同一天第 2/3 次打开（老玩家若当天再进两次，效率 0.9 / 1.0）
    serialize(bot.state, bot.mem, bot.now);
    const re2 = reopenAfterGap(bot, 3600_000);
    serialize(bot.state, bot.mem, bot.now);
    const re3 = reopenAfterGap(bot, 3600_000);
    console.log(
      `  同日再开：第 2 次 rate=${re2.rate.toFixed(2)}（结算 ${hours(re2.applied)} 得 ${formatMoyu(re2.earned)}，回访 ${re2.visitsCount}/3），第 3 次 rate=${re3.rate.toFixed(2)}（结算 ${hours(re3.applied)} 得 ${formatMoyu(re3.earned)}，回访 ${re3.visitsCount}/3）`,
    );
    console.log(
      `  继续玩 30 天参照（同种子）：D33 段位 ${refD33.rankName}、图鉴 ${refD33.collection}/55、挂机率 ${formatMoyu(refD33.idleRate)}/s、累计 ${formatMoyu(refD33.lifetimeEarned)}（回归者 ${formatMoyu(after.lifetimeEarned)}）`,
    );
    console.log(
      `  30 天错过收入 ${formatMoyu(missed)}；回归补偿相当于错过量的 ${pct(re.earned / missed)}；进度差：挂机率 ${formatMoyu(refD33.idleRate)} vs ${formatMoyu(after.idleRate)}（×${(refD33.idleRate / after.idleRate).toFixed(0)}）`,
    );

    // ---------- C. 存档保真（若 localStorage 未被清）----------
    const keep = createBot(20261127);
    runDays(keep, 3);
    const savedRaw = keep.mem.getItem("moyu-save")!;
    const at30 = keep.now + GAP_DAYS * DAY_MS;
    const restored30 = restore(memAdapterFrom(savedRaw), at30);
    const sameFields = {
      moyu: restored30.state!.moyu === d3.moyu,
      levels: JSON.stringify(restored30.state!.levels) === JSON.stringify(d3.levels),
      collection:
        restored30.state!.collected.quotes.length === d3.quotes && restored30.state!.collected.flavors.length === d3.flavors,
      lifetime: restored30.state!.lifetimeEarned === d3.lifetimeEarned,
      prestige: restored30.state!.prestige === d3.prestige,
      totalClicks: restored30.state!.totalClicks === d3.totalClicks,
      createdAt: restored30.createdAt === keep.createdAt,
    };
    console.log("\n===== 存档保真（若 localStorage 没被清）=====");
    console.log(`  30 天前档 restore：${JSON.stringify(sameFields)}；offlineSeconds=${hours(restored30.offlineSeconds)}；visits 原样=${restored30.state!.visits.count}`);
    expect(Object.values(sameFields).every(Boolean)).toBe(true);

    // ---------- C2. 8h 封顶的边际补偿曲线：停 8h / 24h / 7 天 / 30 天 结算是否一样 ----------
    const gapCurve = [1, 8, 12, 24, 24 * 7, 24 * 30].map((h) => {
      const at = keep.now + h * 3600_000;
      const r = restore(memAdapterFrom(savedRaw), at);
      let st = r.state!;
      st = ensureVisitsStub(st, at);
      const rate = offlineEfficiencyStub(st, r.createdAt, at);
      const eff = Math.min(h * 3600, 8 * 3600) * rate;
      return { gapHours: h, rate, appliedHours: Math.min(h, 8), effectiveHours: +(eff / 3600).toFixed(2) };
    });
    console.log("\n===== 8h 封顶的边际补偿（停多久都一样？）=====");
    for (const g of gapCurve) {
      console.log(`  停 ${String(g.gapHours).padStart(3)}h → 效率 ${g.rate.toFixed(2)}、结算 ${g.appliedHours}h、等效 ${g.effectiveHours.toFixed(1)}h`);
    }
    console.log(`  停 24h 与停 720h 的结算完全一致（8h × 0.8 = 6.4h），额外 29 天等待的边际补偿 = 0`);

    // ---------- D. 存档被清（Safari ITP / 清缓存）----------
    const cleared = restore(emptyAdapter(), at30);
    console.log("\n===== 存档被清（Safari 7 天 ITP / 清缓存）=====");
    console.log(
      `  restore 返回：state=${cleared.state === null ? "null" : "初始状态"}，offlineSeconds=${cleared.offlineSeconds}；无「存档丢失/可导入备份」标记 → 玩家被当成全新号（累计 0、图鉴 0、段位实习生），且不会弹欢迎面板`,
    );
    expect(cleared.offlineSeconds).toBe(0);
    expect(cleared.state!.lifetimeEarned).toBe(0);

    // ---------- E. 回归首屏「要处理的东西」量化 ----------
    const newlyAffordable = UPGRADES.filter(
      (u) => d3.moyu < costOf(u.id, d3.levels[u.id] ?? 0) && after.moyu >= costOf(u.id, d3.levels[u.id] ?? 0),
    ).map((u) => u.id);
    console.log("\n===== 回归首屏（引擎口径）=====");
    console.log(
      `  欢迎面板 1 个（离开 ${hours(realWait)} / 按上限结算 ${hours(settled)} / 得 ${formatMoyu(re.earned)}）；📔红点=无（日报刚重置未 3/3）；新手目标链=${after.lifetimeEarned > 1e6 ? "已隐藏" : "显示"}；转生提示=${after.canPrestige ? "HUD 显示「可离职再就业」" : "无"}；离线结算后新买得起的卡=${newlyAffordable.length} 张`,
    );
    console.log("  没有「回归补偿 / 回归任务 / 离店回顾 / 你错过了什么 / streak 补签」任何入口；欢迎面板只说离线收益");

    // ---------- F. 写证据 JSON 给 live 探针 ----------
    mkdirSync("playtest/r10-screens", { recursive: true });
    const evidence = {
      generatedAt: new Date().toISOString(),
      head: "999b0f4",
      profile: "回归老玩家：3 天 × 3 次 × 5 分钟 → 停 30 天 → 回来开一次",
      day1: new Date(2026, 9, 28, 9, 0, 0).toISOString(),
      day3End: new Date(lastSavedAt).toISOString(),
      returnAt: new Date(re.at).toISOString(),
      d3,
      after,
      reopen: {
        realWaitSeconds: realWait,
        appliedSeconds: settled,
        rate: re.rate,
        effectiveSeconds: effective,
        earned: re.earned,
        welcome: re.welcome,
        capped: re.capped,
        idleRate: re.idleRate,
        ratioVsWait: capRatio,
        ratioVs07: base07Ratio,
        ratioVsDay3Income: re.earned / day3Income,
      },
      missedSameRoutine: { refTotal: ref.state.totalEarned, missed, ratio: re.earned / missed, refD33 },
      dayIncome,
      sameDayReopens: [
        { rate: re2.rate, applied: re2.applied, earned: re2.earned, visits: re2.visitsCount },
        { rate: re3.rate, applied: re3.applied, earned: re3.earned, visits: re3.visitsCount },
      ],
      saveIntact: sameFields,
      gapCurve,
      saveCleared: { stateIsNull: cleared.state === null, lifetime: cleared.state!.lifetimeEarned, offlineSeconds: cleared.offlineSeconds },
      firstScreen: {
        welcomePanels: 1,
        journalBadge: false,
        questVisible: after.lifetimeEarned <= 1e6,
        prestigeHint: after.canPrestige,
        newlyAffordable,
        comebackGuidance: "无",
      },
      /** 给 live 探针注入用：D3 结束时的存档 blob（savedAt/createdAt 由 live 端重算） */
      seedSave: JSON.parse(savedRaw),
    };
    writeFileSync("playtest/r10-returner-evidence.json", JSON.stringify(evidence, null, 2));

    // ---------- 断言 ----------
    expect(realWait).toBeGreaterThanOrEqual((GAP_DAYS * DAY_MS) / 1000 - 1);
    expect(settled).toBe(OFFLINE_CAP_SECONDS);
    expect(re.welcome).toBe(true);
    expect(re.rate).toBeCloseTo(0.8, 6); // 建档已超首日 + 本次 1 次回访
    expect(re.earned).toBeGreaterThan(0);
    expect(after.rankIdx).toBeGreaterThanOrEqual(d3.rankIdx); // 30 天不玩，段位只升不降（离线收益还推了一档）
    expect(after.collection).toBe(d3.collection); // 图鉴不丢
    expect(after.streak).toBe(0); // streak 静默断掉
    expect(re2.rate).toBeCloseTo(0.9, 6);
    expect(re3.rate).toBeCloseTo(1.0, 6);
    expect(re.earned / missed).toBeLessThan(0.01);
    expect(capRatio).toBeLessThan(0.01);
  });
});
