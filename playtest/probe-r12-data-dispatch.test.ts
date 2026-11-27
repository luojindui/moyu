import { describe, it } from "vitest";
import { fmt, pct, secs, simulate, DAY, ownIdleRate, netDispatchProfit, dispatchRewardOf } from "./probe-r12-data-lib";
import { initialState, gain } from "../src/engine/state";
import { stationIdleScaled } from "../src/engine/upgrades";
import {
  MISSIONS,
  COLLEAGUES,
  DISPATCH_COEF,
  DISPATCH_FLOOR,
  AWAY_IDLE_FACTOR,
  recruit,
  dispatch,
  claimMission,
  missionSecondsFor,
  colleagueDef,
  dispatchReward,
} from "../src/engine/team";
import { buyUpgrade } from "../src/engine/actions";

const HOUR = 3600;

function withTeam(ids: string[] = ["zhou"], levels: Record<string, number> = {}, favors: Record<string, number> = {}): ReturnType<typeof initialState> extends infer T ? T : never {
  let s = gain(initialState(), 1e15);
  for (const id of ids) {
    s = recruit(s, id)!;
    for (let i = 1; i < (levels[id] ?? 1); i++) {
      const { upgradeColleague } = require("../src/engine/team");
      s = upgradeColleague(s, id)!;
    }
  }
  const cols = { ...s.team.colleagues };
  for (const id of ids) cols[id] = { ...cols[id]!, favor: favors[id] ?? 0 };
  return { ...s, team: { colleagues: cols } };
}

describe("R12R2-2 派遣 vs 挂机（加入 50% 挂机代价）", () => {
  it("① 单任务毛收益（%/h，占同期挂机收入）", () => {
    console.log("\n### 毛收益 = max(300, 工位×秒×0.011) × 任务倍率 × 匹配1.5 × 等级 × 好感 × 被动");
    console.log("### %/h = 单次毛奖励 ÷ (工位×任务秒数)，比例段与 S 无关");
    const rows: string[] = [["任务", "时长", "lv1不匹配", "lv1匹配", "lv5匹配", "lv5匹配好感100"].join(" | ")];
    for (const m of MISSIONS) {
      const rate = (lv: number, match: boolean, favor = 0) => {
        const lvF = 1 + 0.5 * ((lv - 1) / 4);
        const favorF = favor >= 100 ? 1.5 : 1;
        return DISPATCH_COEF * m.mult * (match ? 1.5 : 1) * lvF * favorF;
      };
      rows.push(
        [m.name, `${m.seconds / HOUR}h`, pct(rate(1, false)), pct(rate(1, true)), pct(rate(5, true)), pct(rate(5, true, 100))].join(" | "),
      );
    }
    console.log(rows.join("\n"));
    console.log(
      "\n### 独特被动对毛收益的放大：",
      COLLEAGUES.map((d) => `${d.name}:${d.trait === "短任务加成" || d.trait === "长任务加成" ? `任务+${d.traitValue * 100}%` : d.trait}`).join(" | "),
    );
  });

  it("② 净收益（扣 50% 挂机代价）与盈亏平衡工位", () => {
    console.log("\n### 净收益/小时 = 毛收益/小时 − 0.5×该同事在岗挂机/秒×3600；S* = 盈亏平衡工位");
    const Ss = [10, 50, 100, 500, 1e3, 1e4, 1e5, 1e6];
    for (const id of ["zhou", "li", "wang"]) {
      const def = colleagueDef(id)!;
      for (const m of MISSIONS) {
        // 老周：coffee 不匹配；小李 quick 匹配+短任务；王师傅 coffee 匹配+长任务
        const match = def.skill === m.type;
        let traitMul = 1;
        if (def.trait === "短任务加成" && m.seconds <= 3600) traitMul = 1.5;
        if (def.trait === "长任务加成" && m.seconds >= 4 * 3600) traitMul = 1.5;
        const rewardRate = DISPATCH_COEF * m.mult * (match ? 1.5 : 1) * traitMul; // ×S
        const lossRate = 0.5 * (def.idlePerLevel + 0 * def.sharePerLevel); // 固定部分 + share 见下
        const cells = Ss.map((S) => {
          const rewardPerHour = rewardRate * S * HOUR;
          const lossPerHour = 0.5 * (def.idlePerLevel + S * def.sharePerLevel) * HOUR;
          const net = rewardPerHour - lossPerHour;
          return `S=${fmt(S)}:${net >= 0 ? "+" : ""}${fmt(net)}/h`;
        });
        // 盈亏平衡：rewardRate×S = 0.5×(fixed + S×share) → S = 0.5×fixed/(rewardRate−0.5×share)
        const Sstar = (0.5 * def.idlePerLevel) / (rewardRate - 0.5 * def.sharePerLevel);
        console.log(`${def.name} ${m.name}(${m.seconds / HOUR}h${match ? " 匹配" : ""}${traitMul > 1 ? " 被动" : ""}): S*=${fmt(Sstar)}/s | ${cells.slice(2, 6).join("  ")}`);
      }
    }
  });

  it("③ 最优任务（净收益/小时 argmax）：被动是否改变任务选择", () => {
    const Ss = [50, 100, 500, 1e3, 1e4, 1e5, 1e6];
    console.log("\n### 每个同事在工位 S 下的净收益最优任务（lv1 好感0）");
    for (const def of COLLEAGUES) {
      const line = Ss.map((S) => {
        // 手工构造状态：只有该同事
        let s = gain(initialState(), 1e15);
        s = recruit(s, def.id)!;
        // 用工位等级造 S：直接用 stationIdleScaled 不可控，退化为公式计算
        let best = MISSIONS[0]!;
        let bestRate = -Infinity;
        for (const m of MISSIONS) {
          const match = def.skill === m.type;
          let traitMul = 1;
          if (def.trait === "短任务加成" && m.seconds <= 3600) traitMul = 1.5;
          if (def.trait === "长任务加成" && m.seconds >= 4 * 3600) traitMul = 1.5;
          const rewardRate = DISPATCH_COEF * m.mult * (match ? 1.5 : 1) * traitMul * S;
          const lossPerSec = 0.5 * (def.idlePerLevel + S * def.sharePerLevel);
          const sec = missionSecondsFor(def.id, m.id);
          const netRate = rewardRate - lossPerSec;
          void sec;
          if (netRate > bestRate) {
            bestRate = netRate;
            best = m;
          }
        }
        return `S=${fmt(S)}→${best.name}`;
      });
      console.log(`${def.name}(${def.skill}，被动=${def.trait}): ${line.join("  ")}`);
    }
  });

  it("④ 派遣还值得吗：净收益占日常收入（各阶段）", () => {
    console.log("\n### 假设每人每天 2 单 8h 咖啡（老周按 coffee、王师傅匹配、小李 coffee 不匹配），净收益/天");
    for (const [label, lv, favor] of [
      ["lv1/好感0", 1, 0],
      ["lv5/好感0", 5, 0],
      ["lv5/好感100", 5, 100],
    ] as const) {
      for (const S of [1e3, 1e4, 1e5, 1e6]) {
        let gross = 0;
        let loss = 0;
        for (const def of COLLEAGUES) {
          const m = MISSIONS[4]!;
          const match = def.skill === m.type;
          let traitMul = 1;
          if (def.trait === "短任务加成" && m.seconds <= 3600) traitMul = 1.5;
          if (def.trait === "长任务加成" && m.seconds >= 4 * 3600) traitMul = 1.5;
          const lvF = 1 + 0.5 * ((lv - 1) / 4);
          const favorF = favor >= 100 ? 1.5 : 1;
          const reward = Math.max(DISPATCH_FLOOR, S * m.seconds * DISPATCH_COEF) * m.mult * (match ? 1.5 : 1) * lvF * favorF * traitMul;
          gross += reward * 2;
          loss += 0.5 * (def.idlePerLevel * lv + S * def.sharePerLevel * lv) * m.seconds * 2;
        }
        const net = gross - loss;
        console.log(
          `${label} S=${fmt(S)}/s: 毛=${fmt(gross)}/天 代价=${fmt(loss)}/天 净=${net >= 0 ? "+" : ""}${fmt(net)}/天（占日常 ${pct(net / (S * DAY))}）`,
        );
      }
    }
  });

  it("⑤ 派单快照：先升级再领不再放大", () => {
    let s = gain(initialState(), 1e12);
    s = recruit(s, "zhou")!;
    const before = stationIdleScaled(s);
    s = dispatch(s, "zhou", MISSIONS[4]!.id, 0, stationIdleScaled(s))!;
    const snap = s.team.colleagues.zhou!.rewardSnapshot;
    // 领奖前疯狂升级
    for (let i = 0; i < 200; i++) s = buyUpgrade(s, "phone") ?? s;
    const after = stationIdleScaled(s);
    const r = claimMission(s, "zhou", MISSIONS[4]!.seconds * 1000, stationIdleScaled(s))!;
    console.log(
      `\n### 派单时工位=${fmt(before)}/s 快照奖励=${fmt(snap)}；领取时工位=${fmt(after)}/s，实领=${fmt(r.reward)}（放大 ${pct(r.reward / snap - 1)}）`,
    );
  });

  it("⑥ 每日最优排班：8h 咖啡 2 单/天 vs 4h 蹲点 4 单/天（净收益）", () => {
    // 同 lv1 满队，S 扫描：比较单日净收益
    for (const S of [1e3, 1e5]) {
      const calc = (missionId: string, perDay: number) => {
        let gross = 0;
        let loss = 0;
        for (const def of COLLEAGUES) {
          const m = MISSIONS.find((x) => x.id === missionId)!;
          const match = def.skill === m.type;
          let traitMul = 1;
          if (def.trait === "短任务加成" && m.seconds <= 3600) traitMul = 1.5;
          if (def.trait === "长任务加成" && m.seconds >= 4 * 3600) traitMul = 1.5;
          const reward = Math.max(DISPATCH_FLOOR, S * m.seconds * DISPATCH_COEF) * m.mult * (match ? 1.5 : 1) * traitMul;
          gross += reward * perDay;
          loss += 0.5 * (def.idlePerLevel + S * def.sharePerLevel) * m.seconds * perDay;
        }
        return { gross, loss, net: gross - loss };
      };
      const coffee = calc("coffee", 2);
      const toilet = calc("toilet", 4);
      const meeting = calc("meeting", 8);
      console.log(
        `S=${fmt(S)}: 咖啡8h×2 净=${fmt(coffee.net)}/天 | 蹲点4h×4 净=${fmt(toilet.net)}/天 | 开会1h×8 净=${fmt(meeting.net)}/天`,
      );
    }
  });
});
