import { initialState, type GameState } from "../src/engine/state";
import { effectOf } from "../src/engine/upgrades";
import { bossSurviveReward } from "../src/engine/events";
import { ENERGY_PER_DAY } from "../src/engine/energy";
// 极端纯点击玩家：完全不升挂机升级（station 仅底薪 0.2）
let s: GameState = { ...initialState(), moyu: 1e12, levels: { coffee: 20, water: 20, chair: 20 } };
const idle0 = effectOf(s).idleRate;
const sSlack: GameState = { ...s, energy: { date: "x", left: 0, used: ["slack"], boosted: { idleMult: 1.25, patrolRewardMult: 1 } } };
const slackOnline = (effectOf(sSlack).idleRate - idle0) * 7200;
const es = { nextBossAt: 0, bossUntil: 0, nextMemeAt: 0, memeUntil: 0, bossCaught: false, bossStartAt: 0, surviveStreak: 5, bossVariant: "hold", bossTaps: 0, bossPenaltyTotal: 0, patrolCount: 10, memeCount: 0, bossPersonality: "hasty", bossChoiceDone: false, forcedVariant: null } as any;
const r0 = bossSurviveReward(s, es);
const r1 = bossSurviveReward({ ...s, energy: { date: "x", left: 0, used: ["fake-work"], boosted: { idleMult: 1, patrolRewardMult: 1.8 } } }, es);
const variantAvg = 0.35 + 0.30 + 0.2 * 1.5 + 0.15 * 1.8;
const fake = (r1 - r0) * variantAvg * (7200 / 120);
console.log("纯点击(不升挂机) idleRate=", idle0, "slack在线/天=", slackOnline, "fake/天=", fake, "ratio=", slackOnline / fake, "reward0=", r0);
