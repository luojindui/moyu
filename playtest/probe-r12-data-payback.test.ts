import { describe, it } from "vitest";
import { simulate, secs, fmt, multOf } from "./probe-r12-data-lib";
import { initialState } from "../src/engine/state";
import { COLLEAGUES, MAX_COLLEAGUE_LEVEL, upgradeCostOf } from "../src/engine/team";

const VISITS = [9, 13, 20];

describe("R12-1 回本时间表", () => {
  it("① 招募回本（S 扫描，倍率 1）", () => {
    const rows: string[] = [];
    const Ss = [0.2, 1, 10, 100, 1e3, 1e4, 1e5, 1e6];
    for (const def of COLLEAGUES) {
      const vals = Ss.map((S) => {
        const gain = def.idlePerLevel * multOf(initialState()) + S * def.sharePerLevel;
        return secs(def.cost / gain);
      });
      rows.push(
        `${def.name.padEnd(3)} 招募=${fmt(def.cost).padStart(8)} | ` + Ss.map((S, i) => `S=${fmt(S)}:${vals[i]}`).join("  "),
      );
    }
    console.log("\n### 招募回本 = 招募价 ÷ 同事 Lv1 挂机/秒（倍率=1，S=工位挂机/秒）\n" + rows.join("\n"));
    const total = COLLEAGUES.map((d) => {
      let x = d.cost;
      for (let lv = 1; lv < MAX_COLLEAGUE_LEVEL; lv++) x += upgradeCostOf(d, lv);
      return `${d.name}: 招募${fmt(d.cost)} / 升满全套${fmt(x)}`;
    });
    console.log("\n### 全套投入（招募+升满）\n" + total.join("\n"));
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

  it("③ 同事升级回本（每级，按 S 口径）", () => {
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

  it("④ 招募时机敏感性：越晚买越划算（份额项随工位涨）", () => {
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

  it("⑤ 同事性价比排序（每人每摸鱼值买到的挂机/秒）", () => {
    const rows = COLLEAGUES.map((d) => {
      let full = d.cost;
      for (let lv = 1; lv < MAX_COLLEAGUE_LEVEL; lv++) full += upgradeCostOf(d, lv);
      return {
        name: d.name,
        cost: d.cost,
        fixedPerCost: d.idlePerLevel / d.cost,
        lv5FixedPerCost: (d.idlePerLevel * 5) / full,
        share: d.sharePerLevel,
        shareCost: d.cost,
      };
    });
    console.log("\n### 固定值部分「每摸鱼值换到的挂机/秒」（越大越好）");
    for (const r of rows) console.log(`${r.name}: 招募价${fmt(r.cost)} → ${r.fixedPerCost.toExponential(2)}/s/摸鱼值（lv5 全套 ${r.lv5FixedPerCost.toExponential(2)}）`);
    const best = rows[0]!;
    for (const r of rows.slice(1)) {
      console.log(`${r.name} 固定值性价比 = 老周的 1/${(best.fixedPerCost / r.fixedPerCost).toFixed(0)}`);
    }
    console.log("每人 share 都是 0.008/级（完全相同），即晚期边际收益一样但价格差 50 万倍");
  });
});
