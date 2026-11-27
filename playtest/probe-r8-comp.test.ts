import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { run, formatMoyu, START_MS, type RunResult, type Profile, type Snap } from "./probe-r8-comp-lib";

/**
 * R8 竞品流失玩家：24h / 72h 进度曲线（7 天外推）
 * 纯挂机（idle）与活跃（active）两档，与竞品做 D1/D3/D7 段落对照。
 */

const active = run("active", { days: 7 });
const idle = run("idle", { days: 7 });
const activeCap = run("active", { days: 7, prestige: "cap" });
const activeNone = run("active", { days: 7, prestige: "none" });
const activeOnce = run("active", { days: 7, prestige: "once" });
const active30 = run("active", { days: 30 });
const none30 = run("active", { days: 30, prestige: "none" });

function fmt(n: number): string {
  return formatMoyu(n);
}

function snapAt(r: RunResult, hours: number): Snap {
  const target = START_MS + hours * 3_600_000;
  let best = r.snaps[0]!;
  for (const s of r.snaps) if (Math.abs(s.atMs - target) < Math.abs(best.atMs - target)) best = s;
  return best;
}

function hh(hours: number): string {
  const d = Math.floor(hours / 24) + 1;
  const h = Math.floor(hours % 24);
  return `D${d} ${String(h).padStart(2, "0")}:${String(Math.round((hours % 1) * 60)).padStart(2, "0")}`;
}

function curveRows(r: RunResult, markHours: number[]): string[] {
  return markHours.map((h) => {
    const s = snapAt(r, h);
    return [
      hh(h).padEnd(11),
      fmt(s.lifetime).padStart(9),
      String(Math.round(s.idleRate)).padStart(8) + "/s",
      String(Math.round(s.clickPower)).padStart(6),
      `${s.rank}(${(s.rankProgress * 100).toFixed(0)}%)`.padStart(22),
      `${s.collection}/55`.padStart(7),
      `♻${s.prestige} ×${s.prestigeMult.toFixed(2)}`.padStart(11),
      `Lv合计${s.totalLevels}`.padStart(9),
    ].join(" ");
  });
}

const HEAD = ["时刻".padEnd(11), "累计(历史)".padStart(9), "挂机率".padStart(9), "点击力".padStart(6), "段位".padStart(22), "图鉴".padStart(7), "转生".padStart(11), "等级".padStart(9)].join(" ");

describe("R8 竞品流失玩家：24h/72h 曲线", () => {
  it("24 小时逐小时曲线（纯挂机 vs 活跃）", () => {
    const hours = [9, 9.25, 9.5, 10, 11, 12, 13, 15, 18, 21, 24];
    console.log("\n===== 24h 曲线 | ACTIVE（D1 开 4 次共 ~36 分钟，3cps） =====");
    console.log(HEAD);
    console.log(curveRows(active, hours).join("\n"));
    console.log("\n===== 24h 曲线 | IDLE（每天 3 次 × 40~90 秒，一次不点） =====");
    console.log(HEAD);
    console.log(curveRows(idle, hours).join("\n"));

    // active 24h 已解锁转生层（1e8）→ 说明转生不遥远
    const a24 = snapAt(active, 24);
    const i24 = snapAt(idle, 24);
    console.log(`\n24h 末：active 历史累计 ${fmt(a24.lifetime)}（挂机 ${Math.round(a24.idleRate)}/s、段位 ${a24.rank}、图鉴 ${a24.collection}）`);
    console.log(`         idle   历史累计 ${fmt(i24.lifetime)}（挂机 ${Math.round(i24.idleRate)}/s、段位 ${i24.rank}、图鉴 ${i24.collection}）`);
    expect(a24.lifetime).toBeGreaterThan(i24.lifetime * 3);
  });

  it("72 小时关键点曲线 + 7 天日汇总", () => {
    const hours = [24, 27, 30, 33, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72];
    console.log("\n===== 72h 曲线 | ACTIVE =====");
    console.log(HEAD);
    console.log(curveRows(active, hours).join("\n"));
    console.log("\n===== 72h 曲线 | IDLE =====");
    console.log(HEAD);
    console.log(curveRows(idle, hours).join("\n"));

    for (const r of [active, idle]) {
      console.log(`\n===== 7 天日汇总 | ${r.profile.toUpperCase()} =====`);
      console.log("日 日期        当日收入     末累计      挂机/秒   末段位                图鉴 转生 会话 点击  当日新变化数");
      for (const d of r.daily) {
        console.log(
          [
            `D${d.day}`,
            d.date.padEnd(11),
            fmt(d.dayIncome).padStart(10),
            fmt(d.lifetimeEnd).padStart(11),
            String(Math.round(d.idleRateEnd)).padStart(9),
            d.rankEnd.padEnd(18),
            `${d.collectionEnd}/55`.padStart(5),
            `♻${d.prestigeEnd}`.padStart(4),
            String(d.sessions).padStart(3),
            String(d.clicks).padStart(5),
            String(d.newContentCount).padStart(6),
          ].join(" "),
        );
      }
    }
  });

  it("关键时间点 + 新内容密度 + 空转", () => {
    for (const r of [active, idle]) {
      console.log(`\n===== 关键时间点 | ${r.profile.toUpperCase()}（小时） =====`);
      for (const [k, v] of Object.entries(r.keyTimings)) {
        console.log(`  ${k.padEnd(16)} ${v === null ? "未达成" : `${v.toFixed(2)}h`}`);
      }
      const perDay = r.daily.map((d) => d.newContentCount);
      console.log(`  每日新变化次数：${perDay.map((n, i) => `D${i + 1}=${n}`).join(" ")}`);
      console.log(`  会话内最长空转：${r.maxSessionDeadAirMinutes} 分钟；墙钟最长无变化：${(r.maxNoContentMinutes / 60).toFixed(1)} 小时`);
      console.log(`  7 天事件数：${r.events.length}（段位 ${r.events.filter((e) => e.type === "rank").length} / 图鉴 ${r.events.filter((e) => e.type === "collection").length} / ×2 ${r.events.filter((e) => e.type === "milestone").length} / 解锁 ${r.events.filter((e) => e.type === "unlock").length} / 转生 ${r.events.filter((e) => e.type === "prestige").length}）`);
      // 转生明细
      const prestiges = r.events.filter((e) => e.type === "prestige");
      if (prestiges.length) console.log(`  转生：${prestiges.map((e) => `t=${e.tHours.toFixed(1)}h ${e.detail}`).join("；")}`);
      // 7 天会话经济
      const off = r.sessions.reduce((a, s) => a + s.offlineEarned, 0);
      const act = r.sessions.reduce((a, s) => a + s.activeEarned, 0);
      console.log(`  7 天收入构成：离线 ${fmt(off)}（${((off / (off + act)) * 100).toFixed(0)}%）/ 活跃 ${fmt(act)}；巡逻 ${r.sessions.reduce((a, s) => a + s.patrols, 0)} 次、偷点被抓 ${r.sessions.reduce((a, s) => a + s.caughtTaps, 0)} 次、收梗 ${r.sessions.reduce((a, s) => a + s.memeHits, 0)} 个、日报领取 ${r.sessions.filter((s) => s.claimedReward !== null).length} 次`);
    }
  });

  it("转生策略敏感性：早期转生(≥3点) vs 攒满(≥20点) vs 不转生", () => {
    console.log("\n===== 转生策略敏感性（ACTIVE，7 天）=====");
    console.log("策略          24h累计     72h累计     7d累计      7d日收入    转生次数/点数  7d末挂机率");
    for (const r of [active, activeCap, activeOnce, activeNone]) {
      const s24 = snapAt(r, 24);
      const s72 = snapAt(r, 72);
      const end = r.snaps.at(-1)!;
      const pts = r.events.filter((e) => e.type === "prestige").length;
      const labels: Record<string, string> = { early: "每次≥3点", cap: "攒满≥20点", once: "只转1次", none: "不转生" };
      console.log(
        [
          labels[r.prestigeRule]!.padEnd(14),
          fmt(s24.lifetime).padStart(10),
          fmt(s72.lifetime).padStart(10),
          fmt(end.lifetime).padStart(10),
          fmt(r.daily.at(-1)!.dayIncome).padStart(10),
          `${pts}次/♻${end.prestige}`.padStart(12),
          `${Math.round(end.idleRate)}/s`.padStart(10),
        ].join(" "),
      );
    }
    console.log("  （口径：转生会清空本局等级/余额，只看历史累计与日收入是否被转生层抬起来）");
    expect(active.daily).toHaveLength(7);
  });

  it("D1 首会话节奏（开页后前 12 分钟能看见多少新东西）", () => {
    const first = active.sessions[0]!;
    const t0 = first.atMs;
    const t1 = t0 + first.seconds * 1000;
    const inSession = active.events.filter((e) => e.atMs >= t0 && e.atMs <= t1);
    console.log("\n===== D1 首会话（09:00 开页，12 分钟）内容节奏 =====");
    console.log(
      inSession
        .map((e) => {
          const sec = Math.round((e.atMs - t0) / 1000);
          return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")} ${e.detail}`;
        })
        .join("\n"),
    );
    console.log(`首会话内新变化 ${inSession.length} 次；会话内最长空转 ${first.deadAirMinutes} 分钟`);
    // 前 3 分钟（新手留存区）
    const first3 = inSession.filter((e) => e.atMs - t0 <= 180_000);
    console.log(`前 3 分钟新变化 ${first3.length} 次：${first3.map((e) => e.detail).join(" / ")}`);
    expect(first3.length).toBeGreaterThanOrEqual(4);
  });

  it("30 天外推：转生层到底是不是长线成长层？（active 早期转生 vs 不转生）", () => {
    console.log("\n===== 30 天外推（ACTIVE）=====");
    console.log("策略         D1累计       D3累计       D7累计        D14累计       D30累计");
    for (const r of [active30, none30]) {
      const label = r.prestigeRule === "early" ? "早期转生" : "不转生 ";
      const pick = (h: number) => fmt(snapAt(r, h).lifetime).padStart(11);
      console.log([label.padEnd(10), pick(24), pick(72), pick(168), pick(336), pick(720)].join(" "));
    }
    for (const r of [active30, none30]) {
      const label = r.prestigeRule === "early" ? "早期转生" : "不转生";
      const end = r.snaps.at(-1)!;
      console.log(`\n  ${label}：D30 日收入 ${fmt(r.daily.at(-1)!.dayIncome)}、段位 ${end.rank}、图鉴 ${end.collection}/55、转生 ♻${end.prestige}`);
      console.log(`  每日新变化次数（D1~D10）：${r.daily.slice(0, 10).map((d) => d.newContentCount).join(" ")}`);
      console.log(`  每日新变化次数（D11~D30）：${r.daily.slice(10).map((d) => d.newContentCount).join(" ")}`);
    }
    let crossDay: number | null = null;
    for (let i = 0; i < 30; i++) {
      if (active30.daily[i]!.lifetimeEnd > none30.daily[i]!.lifetimeEnd) {
        crossDay = i + 1;
        break;
      }
    }
    console.log(`\n  交叉日：早期转生策略的累计值首次超过「不转生」发生在 D${crossDay ?? ">30"}`);
    const findDay = (r: ReturnType<typeof run>, target: number): number | null => {
      const d = r.daily.find((x) => x.lifetimeEnd >= target);
      return d ? d.day : null;
    };
    console.log(`  达到 1e10：早期转生 D${findDay(active30, 1e10) ?? "-"} vs 不转生 D${findDay(none30, 1e10) ?? "-"}`);
    console.log(`  达到 1e12：早期转生 D${findDay(active30, 1e12) ?? "-"} vs 不转生 D${findDay(none30, 1e12) ?? "-"}`);
    console.log(`  达到 1e15：早期转生 D${findDay(active30, 1e15) ?? "-"} vs 不转生 D${findDay(none30, 1e15) ?? "-"}`);
    expect(none30.daily).toHaveLength(30);
  });

  it("写出证据 JSON", () => {
    const slim = (r: RunResult) => ({
      profile: r.profile,
      seed: r.seed,
      days: r.days,
      keyTimings: r.keyTimings,
      maxNoContentMinutes: r.maxNoContentMinutes,
      maxSessionDeadAirMinutes: r.maxSessionDeadAirMinutes,
      daily: r.daily,
      sessions: r.sessions.map((s) => ({ ...s, endState: undefined })),
      events: r.events,
      snaps: r.snaps.filter((s) => s.atMs % (3 * 3_600_000) === 0 || s.atMs === START_MS).slice(0, 700),
    });
    const out = {
      generatedAt: new Date().toISOString(),
      engine: "HEAD 06041a1 (R7 prestige + 14 ranks)",
      profiles: { active: slim(active), idle: slim(idle), activeCap: slim(activeCap), activeNone: slim(activeNone) },
      prestigeVariants: { activeEarly7d: slim(active), activeCap7d: slim(activeCap), activeOnce7d: slim(activeOnce), activeNone7d: slim(activeNone) },
      longRun30d: { activeEarly: { keyTimings: active30.keyTimings, daily: active30.daily }, activeNoPrestige: { keyTimings: none30.keyTimings, daily: none30.daily } },
      snapshots24h: { active: curveRows(active, [0, 1, 2, 3, 4, 6, 8, 10, 12, 15, 18, 21, 24]), idle: curveRows(idle, [0, 1, 2, 3, 4, 6, 8, 10, 12, 15, 18, 21, 24]) },
      snapshots72h: { active: curveRows(active, [24, 27, 30, 33, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72]), idle: curveRows(idle, [24, 27, 30, 33, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72]) },
    };
    writeFileSync("playtest/r8-comp-report.json", JSON.stringify(out, null, 2));
    console.log("\nwritten playtest/r8-comp-report.json");
    expect(active.daily).toHaveLength(7);
    expect(idle.daily).toHaveLength(7);
  });
});
