import { describe, it } from "vitest";
import {
  DAY_S,
  DRAFT_TEAM,
  colleagueMaxCost,
  colleagueUpgradeCost,
  simulate,
  type TeamCfg,
} from "./probe-b1-lib";

/**
 * 候选数值扫描：首招时间 / 同事挂机占比 / 派遣占比 / 7 天曲线。
 * 运行：npx vitest run --config playtest/vitest.b1.config.ts playtest/probe-b1-sweep.test.ts
 */

const base = (over: Partial<TeamCfg> = {}): TeamCfg => ({ ...DRAFT_TEAM, ...over, colleagues: DRAFT_TEAM.colleagues, missions: DRAFT_TEAM.missions } as TeamCfg);
const _unusedBase = (over: Partial<TeamCfg> = {}): TeamCfg => ({
  colleagues: [
    { id: "zhou", name: "老周", skill: "chat", cost: 1500, idlePerLevel: 8, sharePerLevel: 0, upgradeCoef: 0.4 },
    { id: "mei", name: "小美", skill: "meeting", cost: 25000, idlePerLevel: 100, sharePerLevel: 0, upgradeCoef: 0.4 },
    { id: "qiang", name: "强哥", skill: "toilet", cost: 400000, idlePerLevel: 1000, sharePerLevel: 0, upgradeCoef: 0.4 },
    { id: "li", name: "小李", skill: "errand", cost: 5_000_000, idlePerLevel: 10000, sharePerLevel: 0, upgradeCoef: 0.4 },
    { id: "wang", name: "王师傅", skill: "coffee", cost: 80_000_000, idlePerLevel: 100000, sharePerLevel: 0, upgradeCoef: 0.4 },
  ],
  missions: [
    { id: "quick", type: "errand", seconds: 15 * 60, mult: 1.2 },
    { id: "chat", type: "chat", seconds: 30 * 60, mult: 1.3 },
    { id: "meeting", type: "meeting", seconds: 60 * 60, mult: 1.6 },
    { id: "toilet", type: "toilet", seconds: 4 * 3600, mult: 2.2 },
    { id: "coffee", type: "coffee", seconds: 8 * 3600, mult: 2.8 },
  ],
  maxLevel: 50,
  upgradeBase: 1.35,
  matchBonus: 0.5,
  dispatchCoef: 0.012,
  dispatchFloor: 150,
  dispatchBase: "workstation",
  offlineTeamFactor: 0.5,
  idleWhileDispatched: true,
  dispatchLevelFactor: 0,
  ...over,
});

const NO_TALENT = {
  idleMult: 1, offlineCapBonus: 0, offlineBaseBonus: 0, clickMult: 1, comboMaxBonus: 0,
  critChance: 0, critMult: 1, clickToIdlePer1k: 0, clickToIdleCap: 0, patrolRewardMult: 1,
  penaltyReduction: 0, memeRewardMult: 1, patrolIntervalCut: 0, patrolIdlePerPatrol: 0, patrolIdleCap: 0,
};

const baseOpts = (cps: number, team: TeamCfg) => ({
  days: 7,
  visitHours: [9, 13, 20],
  sessionSeconds: 600,
  cps,
  recruit: true,
  dispatch: true,
  levelColleagues: true,
  team,
  talent: NO_TALENT,
  prestige: true,
  dailyClaim: true,
  events: true,
});

describe("B1 候选扫描", () => {
  it("同事表投入产出", () => {
    const cfg = base();
    for (const c of cfg.colleagues) {
      const maxCost = colleagueMaxCost(c, cfg);
      console.log(
        `${c.name} 招募=${c.cost} 每级=${c.idlePerLevel}+${(c.sharePerLevel * 100).toFixed(2)}%/级 满级=+${c.idlePerLevel * cfg.maxLevel}+${(c.sharePerLevel * cfg.maxLevel * 100).toFixed(1)}% 满级总投入=${(maxCost / 1e8).toFixed(1)}e8 招募回本=${(c.cost / c.idlePerLevel).toFixed(0)}s`,
      );
      console.log(`   升级价 Lv1→2=${colleagueUpgradeCost(c, 1, cfg)} Lv10→11=${colleagueUpgradeCost(c, 10, cfg)} Lv25→26=${colleagueUpgradeCost(c, 25, cfg)} Lv49→50=${colleagueUpgradeCost(c, 49, cfg)}`);
    }
  });

  it("首招时间（单次连续会话，贪心买升级 + 攒钱招人）", () => {
    const cfg = base();
    for (const cost of [6000, 10000, 16000, 25000, 40000]) {
      const t = base(cfg as unknown as Partial<TeamCfg>);
      t.colleagues = t.colleagues.map((c) => (c.id === "zhou" ? { ...c, cost } : c));
      for (const cps of [0, 1, 2, 3]) {
        const r = simulate({
          ...baseOpts(cps, t),
          days: 1,
          visitHours: [0],
          sessionSeconds: 1200,
          prestige: false,
          dailyClaim: false,
          events: false,
          dispatch: false,
          levelColleagues: false,
        });
        console.log(`价格=${cost} cps=${cps} 首招=${r.firstRecruitMinute === null ? "未招到" : r.firstRecruitMinute.toFixed(1) + "min"}`);
      }
    }
  });

  it("7 天：不招募 vs 招募不派遣 vs 招募+派遣（cps=0 / 3）", () => {
    const cfg = base();
    for (const cps of [0, 3]) {
      const rows: string[] = [];
      for (const strategy of ["none", "noDispatch", "dispatch"] as const) {
        const r = simulate({
          ...baseOpts(cps, cfg),
          recruit: strategy !== "none",
          dispatch: strategy === "dispatch",
          levelColleagues: strategy !== "none",
        });
        const t = r.totals;
        rows.push(
          `cps=${cps} ${strategy}: total=${(t.total / 1e8).toFixed(1)}e8 idle=${(t.idleBase / 1e8).toFixed(1)}e8 teamIdle=${((t.teamIdle / t.idleBase) * 100).toFixed(1)}% dispatch=${(t.dispatch / t.total * 100).toFixed(1)}% click=${(t.click / t.total * 100).toFixed(1)}% lifetime=${(r.final.lifetime / 1e8).toFixed(0)}e8 idleRate=${r.final.idleRate.toFixed(0)}/s team=${(r.final.teamIdle / r.final.idleRate * 100).toFixed(1)}% 转生=${r.prestiges} 首招=${r.firstRecruitMinute === null ? "-" : r.firstRecruitMinute.toFixed(1) + "min"} teamLv=${JSON.stringify(r.final.teamLevels)} M=${r.final.prestigeMult.toFixed(1)}`,
        );
      }
      console.log(rows.join("\n"));
    }
  });

  it("派遣系数 × 基准扫描（7 天，cps=0，全派满）", () => {
    for (const baseType of ["workstation", "total", "own"] as const) {
      for (const coef of [0.006, 0.01, 0.015, 0.02, 0.03]) {
        const cfg = base({ dispatchBase: baseType, dispatchCoef: coef });
        const r = simulate(baseOpts(0, cfg));
        const t = r.totals;
        console.log(
          `base=${baseType} coef=${coef}: total=${(t.total / 1e8).toFixed(1)}e8 派遣占比=${(t.dispatch / t.total * 100).toFixed(1)}% 同事挂机占比=${(t.teamIdle / t.total * 100).toFixed(1)}% 7天收入相对无小队=${((r.totals.total / simulate({ ...baseOpts(0, cfg), recruit: false, dispatch: false, levelColleagues: false }).totals.total - 1) * 100).toFixed(0)}%`,
        );
      }
    }
  });
});
