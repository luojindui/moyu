import { describe, it, expect } from "vitest";
import {
  loadReport,
  loadScenes,
  stateFrom,
  effortOf,
  decision,
  flipCps,
  r1,
  pct,
} from "./probe-r4v-challenge-lib";

/**
 * 验收-① 赌点存在性：用真实进度（report.json 的检查点 levels）建「忍 EV vs 硬刚 EV」表。
 * 口径：巡逻 8s 内
 *   忍   EV = 安然奖励 max(50,5×idleRate)×连胜乘数（不点击）
 *   硬刚 EV = 8s 点击收入（含连击链，连击在巡逻前已在链上） − 一次罚款
 * delta = 硬刚 − 忍；>0 即"值得赌"。
 * 需求：高点击力/花光型出现赌点（硬刚占优）；低点击力/重度囤积仍是忍优（双人群兼容）。
 */
describe("验收-① 偷点赌点存在性（真实进度）", () => {
  it("sanity：report.json 的 clickPower/idleRate 与引擎 effectOf 一致", () => {
    const scenes = loadScenes();
    expect(scenes.length).toBeGreaterThanOrEqual(28);
    let checked = 0;
    for (const s of scenes) {
      expect(s.cp).toBeCloseTo(s.reportCp, 6);
      expect(s.ir).toBeCloseTo(s.reportIr, 6);
      checked++;
    }
    const rep = loadReport();
    console.log(`sanity: ${checked} 个检查点全部与引擎 effectOf 一致（report ${rep.generatedAt} / ${rep.engine}）`);
  });

  it("选代表性场景：忍 vs 硬刚 EV 表（真实余额=囤积型 / 余额清零=花光型）", () => {
    const scenes = loadScenes();
    const pick = (personaKey: string, minute: number) => {
      const s = scenes.find((x) => x.persona.includes(personaKey) && x.minute === minute);
      if (!s) throw new Error(`missing scene ${personaKey}@${minute}`);
      return s;
    };
    const picks = [
      ["clicker", 3],
      ["clicker", 60],
      ["clicker", 180],
      ["casual", 10],
      ["casual", 60],
      ["casual", 180],
      ["idle", 60],
      ["idle", 180],
      ["whale", 60],
    ] as const;
    const cpsList = [1, 3, 5, 8];
    const rows: Record<string, unknown>[] = [];
    for (const [p, m] of picks) {
      const s = pick(p, m);
      for (const bank of ["囤积", "花光"] as const) {
        const moyu = bank === "囤积" ? s.moyu : 0;
        const st = stateFrom(s.levels, moyu);
        for (const cps of cpsList) {
          const d = decision(st, cps, 0);
          rows.push({
            画像: `${s.persona.split("(")[0]}@${m}min(${bank})`,
            'cp/ir': +(s.cp / s.ir).toFixed(2),
            余额: Math.round(moyu),
            cps,
            忍EV: r1(d.soft),
            硬刚EV: r1(d.hard),
            '硬刚−忍': r1(d.delta),
            赌点: d.delta > 0 ? "硬刚优" : "忍优",
            罚款挂机秒: +d.penaltyIdleSeconds.toFixed(1),
            奖励挂机秒: +d.rewardIdleSeconds.toFixed(1),
          });
        }
      }
    }
    console.table(rows);
    const hardWins = rows.filter((r) => r.赌点 === "硬刚优").length;
    console.log(`代表场景硬刚占优：${hardWins}/${rows.length}`);
  });

  it("全量检查点 × {囤积,花光} × cps：硬刚占优比例随 cps 的变化", () => {
    const scenes = loadScenes();
    const cpsList = [1, 2, 3, 5, 8];
    const summary: Record<string, unknown>[] = [];
    const byCps = new Map<number, { hard: number; total: number }>();
    for (const cps of cpsList) byCps.set(cps, { hard: 0, total: 0 });
    const streak10: Record<number, { hard: number; total: number }> = {};
    for (const cps of cpsList) streak10[cps] = { hard: 0, total: 0 };
    // 也按"花光型"单独统计：设计说花光型应该更容易翻正
    const zeroBank = new Map<number, { hard: number; total: number }>();
    for (const cps of cpsList) zeroBank.set(cps, { hard: 0, total: 0 });
    for (const s of scenes) {
      if (s.minute === 0) continue;
      for (const bank of ["囤积", "花光"] as const) {
        const st = stateFrom(s.levels, bank === "囤积" ? s.moyu : 0);
        for (const cps of cpsList) {
          const d0 = decision(st, cps, 0);
          const d10 = decision(st, cps, 10);
          const b = byCps.get(cps)!;
          b.total++;
          if (d0.delta > 0) b.hard++;
          streak10[cps].total++;
          if (d10.delta > 0) streak10[cps].hard++;
          if (bank === "花光") {
            const z = zeroBank.get(cps)!;
            z.total++;
            if (d0.delta > 0) z.hard++;
          }
        }
      }
    }
    for (const cps of cpsList) {
      summary.push({
        cps,
        硬刚占优_连胜0: `${byCps.get(cps)!.hard}/${byCps.get(cps)!.total} (${pct(byCps.get(cps)!.hard / byCps.get(cps)!.total)})`,
        硬刚占优_连胜10: `${streak10[cps].hard}/${streak10[cps].total} (${pct(streak10[cps].hard / streak10[cps].total)})`,
        花光型硬刚占优: `${zeroBank.get(cps)!.hard}/${zeroBank.get(cps)!.total} (${pct(zeroBank.get(cps)!.hard / zeroBank.get(cps)!.total)})`,
      });
    }
    console.table(summary);

    // 需求 A：赌点存在 —— 花光 + 高点击力 + 快连点，硬刚应占优
    const highCp = scenes.filter((s) => s.persona.includes("clicker") && s.minute >= 60);
    expect(highCp.length).toBeGreaterThan(0);
    const gambleRows = highCp.map((s) => decision(stateFrom(s.levels, 0), 5, 0).delta);
    const gamble8 = highCp.map((s) => decision(stateFrom(s.levels, 0), 8, 0).delta);
    console.log(`花光型 clicker(≥60min) @5cps 硬刚−忍 = ${gambleRows.map((x) => r1(x)).join(", ")}`);
    console.log(`花光型 clicker(≥60min) @8cps 硬刚−忍 = ${gamble8.map((x) => r1(x)).join(", ")}`);
    expect(Math.max(...gamble8)).toBeGreaterThan(0);

    // 需求 B：双人群兼容 —— 重度囤积 + 慢点击应仍是忍优
    const hoardSlow = scenes
      .filter((s) => s.minute >= 60)
      .map((s) => decision(stateFrom(s.levels, s.moyu), 1, 0));
    const softWins = hoardSlow.filter((d) => d.delta <= 0);
    console.log(`重度囤积(≥60min)×1cps：忍优 ${softWins.length}/${hoardSlow.length}`);
    expect(softWins.length).toBeGreaterThan(0);
  });

  it("赌点窗口：各真实场景硬刚首次翻正的 cps 阈值（连胜 0 / 10）", () => {
    const scenes = loadScenes();
    const picks = scenes.filter((s) => [1, 3, 10, 60, 180].includes(s.minute));
    const rows: Record<string, unknown>[] = [];
    for (const s of picks) {
      for (const bank of ["囤积", "花光"] as const) {
        const moyu = bank === "囤积" ? s.moyu : 0;
        const st = stateFrom(s.levels, moyu);
        rows.push({
          画像: `${s.persona.split("(")[0]}@${s.minute}min(${bank})`,
          'cp/ir': +(s.cp / s.ir).toFixed(2),
          '余额/挂机秒': Math.round(moyu / s.ir),
          '翻正cps_连胜0': flipCps(st, 0),
          '翻正cps_连胜10': flipCps(st, 10),
        });
      }
    }
    console.table(rows);
  });
});
