import { describe, it } from "vitest";
import { fmt, pct, secs, simulate, DAY } from "./probe-r12-data-lib";
import { initialState } from "../src/engine/state";
import { MISSIONS, COLLEAGUES, DISPATCH_COEF, DISPATCH_FLOOR, dispatchReward, recruit, claimMission, missionDone, dispatch } from "../src/engine/team";
import { gain } from "../src/engine/state";
import { buyUpgrade } from "../src/engine/actions";
import { stationIdleScaled, effectOf } from "../src/engine/upgrades";

const HOUR = 3600;

describe("R12-2 派遣 vs 挂机", () => {
  it("① 各任务派遣收益率（单次奖励折算成挂机秒 + 每小时占挂机收入 %）", () => {
    console.log("\n### 派遣公式：奖励 = max(300, 工位/秒×秒数×0.011) × 任务倍率 × 匹配1.5 × 等级系数(1~1.5) × 好感(100→1.5)");
    console.log("### 口径：%/h = 单次奖励 ÷ (工位/秒 × 任务秒数)，即任务占用期间额外赚了同期挂机收入的百分之几（比例段与 S 无关）");
    const rows: string[] = [];
    rows.push(["任务", "时长", "秒数", "不匹配%/h lv1", "匹配%/h lv1", "不匹配%/h lv5", "匹配%/h lv5", "地板阈值S*"].join(" | "));
    for (const m of MISSIONS) {
      const sec = m.seconds;
      const floorS = DISPATCH_FLOOR / (DISPATCH_COEF * sec);
      const rate = (lv: number, match: boolean) => {
        const lvF = 1 + 0.5 * ((lv - 1) / 4);
        // 比例段：单次 reward = 0.011×sec×mult×match×lvF×S；
        // 任务占用 sec 秒，同期挂机收入 = S×sec → 收益占比 = 0.011×mult×match×lvF
        return DISPATCH_COEF * m.mult * (match ? 1.5 : 1) * lvF;
      };
      rows.push(
        [
          m.name,
          `${sec / HOUR}h`,
          String(sec),
          pct(rate(1, false)),
          pct(rate(1, true)),
          pct(rate(5, false)),
          pct(rate(5, true)),
          `S<${fmt(floorS)}`,
        ].join(" | "),
      );
    }
    console.log(rows.join("\n"));

    // 具体数字：S=1e4 时单次奖励 ≈ 多少分钟挂机
    console.log("\n### S=1万/s 时单次奖励（等效挂机时长）");
    for (const m of MISSIONS) {
      const base = Math.max(DISPATCH_FLOOR, 1e4 * m.seconds * DISPATCH_COEF);
      const lv1 = base * m.mult;
      const lv5match = base * m.mult * 1.5 * 1.5 * 1.5; // lv5系数1.5 × 匹配1.5 × 好感100 1.5
      console.log(
        `${m.name}(${m.seconds / HOUR}h): lv1不匹配=${secs(lv1 / 1e4)}挂机 · lv5匹配好感100=${secs(lv5match / 1e4)}挂机`,
      );
    }
  });

  it("② 地板段（S 很小时）：短任务反而更赚 → 任务选择会翻转", () => {
    const Ss = [0.2, 0.5, 1, 3, 10, 30, 100];
    console.log("\n### 每秒占用收益最高的任务（★=同事技能匹配；同事 Lv1 好感0）");
    for (const def of COLLEAGUES) {
      const line = Ss.map((S) => {
        let best = MISSIONS[0]!;
        let bestRate = -1;
        for (const m of MISSIONS) {
          const base = Math.max(DISPATCH_FLOOR, S * m.seconds * DISPATCH_COEF);
          const match = def.skill === m.type ? 1.5 : 1;
          const rate = (base * m.mult * match) / m.seconds;
          if (rate > bestRate) {
            bestRate = rate;
            best = m;
          }
        }
        return `S=${fmt(S)}→${best.name}`;
      });
      console.log(`${def.name}(${def.skill}，匹配=${MISSIONS.find((m) => m.type === def.skill)!.name}): ${line.join("  ")}`);
    }
  });

  it("③ 派遣机会成本 = 0：派遣中同事照常挂机", () => {
    let s = gain(initialState(), 1e9);
    s = recruit(s, "zhou")!;
    const before = effectOf(s).idleRate;
    s = dispatch(s, "zhou", MISSIONS[4]!.id, 0)!;
    const after = effectOf(s).idleRate;
    console.log(`\n### 老周派遣前后 idleRate：${before.toFixed(3)} → ${after.toFixed(3)}/s（差 ${(after - before).toFixed(6)}）`);
  });

  it("④ 全天派遣收益占比（3 回访/天，每个同事 2 次 8h 咖啡/天）", () => {
    const calc = (lvF: number, fav: number) => {
      let sum = 0;
      for (const def of COLLEAGUES) {
        const m = MISSIONS[4]!;
        const match = def.skill === m.type ? 1.5 : 1;
        sum += DISPATCH_COEF * m.seconds * m.mult * match * lvF * fav * 2; // 挂机秒/天
      }
      return sum;
    };
    for (const [label, lvF, fav] of [
      ["Lv1 好感0", 1, 1],
      ["Lv3 好感60", 1.25, 1],
      ["Lv5 好感0", 1.5, 1],
      ["Lv5 好感100", 1.5, 1.5],
    ] as const) {
      const eq = calc(lvF, fav);
      console.log(`${label}: 派遣等效挂机 ${secs(eq)}/天 = 日常收入的 ${pct(eq / DAY)}`);
    }
  });

  it("⑤ 派遣奖励按领取时刻结算（先升级再领可放大奖励）", () => {
    let s = gain(initialState(), 1e9);
    s = recruit(s, "zhou")!;
    s = dispatch(s, "zhou", MISSIONS[4]!.id, 0)!;
    const at = MISSIONS[4]!.seconds * 1000;
    const rewardBefore = claimMission(s, "zhou", at, stationIdleScaled(s))!.reward;
    let s2 = s;
    for (let i = 0; i < 200; i++) {
      const n = buyUpgrade(s2, "phone");
      if (!n) break;
      s2 = n;
    }
    const rewardAfter = claimMission(s2, "zhou", at, stationIdleScaled(s2))!.reward;
    console.log(
      `\n### 同一单 8h 咖啡：派遣时工位=${stationIdleScaled(s).toFixed(2)}/s → 领取=${fmt(rewardBefore)}；先升 200 级 phone（工位=${fmt(stationIdleScaled(s2))}/s）再领=${fmt(rewardAfter)}（+${pct(rewardAfter / rewardBefore - 1)}）`,
    );
  });
});
