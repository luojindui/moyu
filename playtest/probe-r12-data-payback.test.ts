import { describe, it } from "vitest";
import { simulate, secs, fmt, multOf, colleagueIdleAt } from "./probe-r12-data-lib";
import { initialState } from "../src/engine/state";
import { COLLEAGUES, MAX_COLLEAGUE_LEVEL, upgradeCostOf, AWAY_IDLE_FACTOR } from "../src/engine/team";

const VISITS = [9, 13, 20];

describe("R12R2-1 回本时间表（新价格 + share 递增）", () => {
  it("① 招募回本（S 扫描，倍率 1）", () => {
    console.log("\n### 招募价 / share / 固定值（新数值）");
    for (const d of COLLEAGUES) {
      let full = d.cost;
      for (let lv = 1; lv < MAX_COLLEAGUE_LEVEL; lv++) full += upgradeCostOf(d, lv);
      console.log(
        `${d.name}: 招募${fmt(d.cost)} 固定${d.idlePerLevel}/级 share${(d.sharePerLevel * 100).toFixed(1)}%/级 被动=${d.trait}(${d.traitValue}) 升满全套=${fmt(full)}（×${(full / d.cost).toFixed(2)}）`,
      );
    }
    const Ss = [0.2, 1, 10, 100, 1e3, 1e4, 1e5, 1e6];
    const rows: string[] = [];
    for (const def of COLLEAGUES) {
      const vals = Ss.map((S) => {
        const gain = def.idlePerLevel * multOf(initialState()) + S * def.sharePerLevel;
        return secs(def.cost / gain);
      });
      rows.push(`${def.name.padEnd(3)} 招募=${fmt(def.cost).padStart(8)} | ` + Ss.map((S, i) => `S=${fmt(S)}:${vals[i]}`).join("  "));
    }
    console.log("\n### 招募回本 = 招募价 ÷ Lv1 在岗挂机/秒（倍率=1，S=工位/秒）\n" + rows.join("\n"));
  });

  it("② 现实成长（3 回访×10 分钟）→ 攒够时间 + 当时回本", () => {
    for (const cps of [0, 1, 3]) {
      const r = simulate({ days: 30, visitHours: VISITS, sessionSeconds: 600, cps, team: "none" });
      const rows = COLLEAGUES.map((d) => {
        const a = r.firstAfford[d.id]!;
        if (a.atDay < 0) return `${d.name}: 30 天内攒不到 ${fmt(d.cost)}`;
        const gain = d.idlePerLevel * multOf(a.state!) + a.station * d.sharePerLevel;
        return `${d.name}: D${a.atDay + 1} 攒够（当时工位 ${fmt(a.station)}/s）→ 回本 ${secs(d.cost / gain)}`;
      });
      console.log(`\n### cps=${cps}\n` + rows.join("\n"));
      if (cps === 1) {
        const days = [1, 2, 3, 7, 14, 30].map((day) => {
          const s = r.byDay.filter((x) => x.day === day - 1).at(-1)!;
          return `D${day}: 累计=${fmt(s.lifetime)} 工位=${fmt(s.station)}/s`;
        });
        console.log("  曲线: " + days.join(" | "));
      }
    }
  });

  it("③ 升级回本（每级，按 S 口径）", () => {
    for (const S of [1e3, 1e5]) {
      console.log(`\n### 同事升级回本（工位 S=${fmt(S)}/s，倍率 1）`);
      for (const def of COLLEAGUES) {
        const cells: string[] = [];
        for (let lv = 1; lv < MAX_COLLEAGUE_LEVEL; lv++) {
          const price = upgradeCostOf(def, lv);
          const gain = def.idlePerLevel + S * def.sharePerLevel;
          cells.push(`Lv${lv}→${lv + 1}: 价${fmt(price)} 回本${secs(price / gain)}`);
        }
        console.log(`${def.name}: ` + cells.join(" | "));
      }
    }
  });

  it("④ 队友性价比：固定值/每摸鱼值 & share 同价对照", () => {
    console.log("\n### 固定值部分「每摸鱼值换到的挂机/秒」");
    const rows = COLLEAGUES.map((d) => {
      let full = d.cost;
      for (let lv = 1; lv < MAX_COLLEAGUE_LEVEL; lv++) full += upgradeCostOf(d, lv);
      return { name: d.name, cost: d.cost, r: d.idlePerLevel / d.cost, r5: (d.idlePerLevel * 5) / full, share: d.sharePerLevel };
    });
    for (const r of rows) console.log(`${r.name}: 招募价${fmt(r.cost)} → ${r.r.toExponential(2)}/s/摸鱼值（lv5全套 ${r.r5.toExponential(2)}）`);
    const best = rows[0]!;
    for (const r of rows.slice(1)) console.log(`${r.name} 固定值性价比 = 老周的 1/${(best.r / r.r).toFixed(0)}`);
    console.log(
      `share 每点价格：` +
        rows.map((r) => `${r.name} ${(r.cost / r.share).toExponential(2)}/点`).join(" | ") +
        ` → 最高/最低 = ${((rows[4]!.cost / rows[4]!.share) / (rows[0]!.cost / rows[0]!.share)).toFixed(0)}×`,
    );
    console.log(`（对照：派遣在外挂机只算 ${AWAY_IDLE_FACTOR * 100}%，即招聘回本按"全在岗"算是最乐观值）`);
  });

  it("⑤ 招募时机敏感性（越晚买回本越短）", () => {
    const r = simulate({ days: 7, visitHours: VISITS, sessionSeconds: 600, cps: 1, team: "none" });
    const dayStates = new Map<number, (typeof r.byDay)[number]>();
    for (const d of r.byDay) dayStates.set(d.day, d);
    for (const id of ["qiang", "li", "wang"]) {
      const def = COLLEAGUES.find((c) => c.id === id)!;
      const line: string[] = [];
      for (const day of [1, 2, 3, 5, 7]) {
        const S = dayStates.get(day - 1)!.station;
        const gain = def.idlePerLevel + S * def.sharePerLevel;
        line.push(`D${day}(S=${fmt(S)}): ${secs(def.cost / gain)}`);
      }
      console.log(`${def.name}：` + line.join("  "));
    }
  });
});
