import { describe, it } from "vitest";
import { simulate, branchIds, pct, fmt, secs, DAY } from "./probe-r12-data-lib";
import { TALENTS, talentEffects } from "../src/engine/talents";

const VISITS = [9, 13, 20];
const CLICK = branchIds("click");
const IDLE = branchIds("idle");
const EVENT = branchIds("event");
const HYBRID = [...CLICK, ...EVENT];
const ALL = [...CLICK, ...IDLE, ...EVENT];

function run(n: number, days: number, cps: number, talents: string[]) {
  return simulate({ days, visitHours: VISITS, sessionSeconds: 600, cps, team: "none", talents, snapshots: false });
}

describe("R12-3 三流派实测收益", () => {
  it("① 流派总收益对比（7 天 / 30 天，3 种玩家画像）", () => {
    for (const days of [7, 30]) {
      for (const cps of [0, 1, 3]) {
        const base = run(1, days, cps, []);
        const rows: string[] = [];
        const cfgs: [string, string[]][] = [
          ["无天赋", []],
          ["点击流5点", CLICK],
          ["挂机流5点", IDLE],
          ["事件流5点", EVENT],
          ["点+事10点", HYBRID],
          ["全15点", ALL],
        ];
        for (const [name, ids] of cfgs) {
          const r = ids.length ? run(1, days, cps, ids) : base;
          const delta = r.totals.lifetime / base.totals.lifetime - 1;
          rows.push(
            `${name}: 总入=${fmt(r.totals.lifetime)}（${delta >= 0 ? "+" : ""}${pct(delta)}） 期末工位=${fmt(r.final.station)}/s 点击=${r.final.totalClicks} 安然=${r.final.patrolSurvives}`,
          );
        }
        console.log(`\n### ${days} 天 · cps=${cps}\n` + rows.join("\n"));
      }
    }
  });

  it("② 逐天赋边际贡献（整条流派去掉 1 个天赋后的收益差）", () => {
    for (const [branchName, ids] of [
      ["点击流", CLICK],
      ["挂机流", IDLE],
      ["事件流", EVENT],
    ] as const) {
      for (const cps of [0, 1, 3]) {
        const days = 7;
        const full = run(1, days, cps, ids);
        const rows: string[] = [];
        for (const id of ids) {
          const def = TALENTS.find((t) => t.id === id)!;
          const less = run(1, days, cps, ids.filter((x) => x !== id));
          const delta = full.totals.lifetime / less.totals.lifetime - 1;
          rows.push(`  ${def.name}(${def.desc}): 去掉后收益=${fmt(less.totals.lifetime)}，该天赋贡献 ${pct(delta)}`);
        }
        console.log(`\n### ${branchName} · cps=${cps}\n` + rows.join("\n"));
      }
    }
  });

  it("③ 每点收益效率（单流派 5 点 vs 混搭 10 点）", () => {
    const days = 30;
    const cps = 1;
    const base = run(1, days, cps, []);
    const per = (ids: string[], name: string) => {
      const r = run(1, days, cps, ids);
      const gain = r.totals.lifetime / base.totals.lifetime - 1;
      return { name, gain, perPoint: gain / ids.length, points: ids.length };
    };
    const list = [
      per(CLICK, "点击流5点"),
      per(IDLE, "挂机流5点"),
      per(EVENT, "事件流5点"),
      per(HYBRID, "点+事10点"),
      per(ALL, "全15点"),
    ];
    for (const x of list) {
      console.log(`${x.name}: 收益 ${pct(x.gain)} / ${x.points} 点 = ${pct(x.perPoint)}/点`);
    }
  });

  it("④ 转化类天赋的时间门槛（点击 300 次/点、安然巡逻 1 次/点）", () => {
    // 反推：多少秒在线/点击才能吃满
    const clickPerPoint = 300;
    const clickCap = 0.35;
    const survivePerPoint = 1;
    const surviveCap = 0.3;
    console.log(
      `\n点击流转满需 10,500 次点击（${clickCap}/1%/300=10,500）；事件流转满需 30 次安然巡逻。` +
        `\n3 回访×10 分钟、cps=3 时每天点击=${3 * 600 * 3} 次 → 约 ${(10500 / 900).toFixed(1)} 天；` +
        `每天安然巡逻=${(3 * 600) / 120} 次 → 约 ${(30 / 15).toFixed(1)} 天。`,
    );
  });

  it("⑤ 天赋实现审计：哪些 effect 在 src 里没有消费方", () => {
    const e = talentEffects({
      unlocked: ALL,
      points: 0,
      rankGranted: -1,
    });
    console.log("\n### 全点亮后 talentEffects 输出\n", JSON.stringify(e));
    console.log(
      [
        "消费方审计（grep src/）：",
        "click_1 clickMult → actions.ts clickPowerOf ✓",
        "click_2 comboWindowBonus → 无消费方（main.ts 用常量 COMBO_WINDOW_S=0.5）✗",
        "click_3 comboMaxBonus → 无消费方（main.ts 用常量 COMBO_MAX=20）✗",
        "click_4 critEvery → 无消费方（main.ts 无暴击逻辑）✗",
        "click_5 clickToIdleStep → upgrades.ts conversionBonus ✓",
        "idle_1/3/5 idleMult → upgrades.ts ✓",
        "idle_2 offlineCapBonusHours → offline.ts ✓",
        "idle_4 offlineBaseBonus → progression.ts ✓",
        "event_1/4 patrolRewardMult → events.ts bossSurviveReward ✓",
        "event_2 penaltyReduction → 无消费方（events.ts onBossTap 未使用）✗",
        "event_3 memeRewardMult → events.ts onMemeTap ✓",
        "event_4 patrolWarnSeconds → 无消费方（render/scene.ts 未使用，横幅不提前）✗",
        "event_5 surviveToIdle → upgrades.ts conversionBonus ✓",
      ].join("\n"),
    );
  });
});
