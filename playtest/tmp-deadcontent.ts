import { initialState } from "../src/engine/state";
import { offlineEfficiency } from "../src/engine/progression";
import { offlineEarn } from "../src/engine/offline";
import { effectOf } from "../src/engine/upgrades";
import { ACHIEVEMENTS, achDone, achEffects } from "../src/engine/achievements";
const now = Date.now(), DAY = 86400000;
const base = () => ({ ...initialState(), moyu: 1e13, totalEarned: 1e12, lifetimeEarned: 1e12 });
function mk(o: { visits: number; streak: number; decor?: string[]; talents?: string[]; mei?: boolean }) {
  let s = { ...base(), visits: { date: "x", count: o.visits }, daily: { date: "x", goals: [], streak: o.streak, lastCompleteDate: null, claimed: false, window: 0, claimsToday: 0 }, decor: o.decor ?? [], talents: { unlocked: o.talents ?? [], points: 0, rankGranted: -1, dailyGiftDate: "", overflow: 0 } };
  if (o.mei) s = { ...s, team: { colleagues: { mei: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 } } } };
  return s;
}
const full = ["plant","lamp","rug","fridge","chair","aquarium","projector","catbed"];
console.log("画像：每日回访 3 次 + 连签 21 天（硬核认真玩）");
const cases: Array<[string, any]> = [
  ["裸状态(无家具/天赋/小美)", mk({ visits: 3, streak: 21 })],
  ["+全套家具(含离线+23%)", mk({ visits: 3, streak: 21, decor: full })],
  ["+天赋 idle_4(+0.08)+事件终极(+0.2)", mk({ visits: 3, streak: 21, decor: full, talents: ["idle_4", "event_5b", "event_1","event_2","event_3","event_4"] })],
  ["+小美(离线+2%)", mk({ visits: 3, streak: 21, decor: full, talents: ["idle_4","event_5b","event_1","event_2","event_3","event_4"], mei: true })],
];
for (const [name, s] of cases) {
  const eff = offlineEfficiency(s, now - 30 * DAY, now);
  const e12 = offlineEarn(s, 12 * 3600, eff).earned;
  console.log(`  ${name}: eff=${eff.toFixed(4)} | 12h 离线收入=${e12.toFixed(0)}`);
}
console.log("\n画像：低活跃（回访 1 次 + 无连签）——离线加成还有意义");
for (const [name, s] of [
  ["裸状态", mk({ visits: 1, streak: 0 })],
  ["+全套家具", mk({ visits: 1, streak: 0, decor: full })],
  ["+天赋全套", mk({ visits: 1, streak: 0, decor: full, talents: ["idle_4","event_5b","event_1","event_2","event_3","event_4"] })],
]) {
  const eff = offlineEfficiency(s, now - 30 * DAY, now);
  console.log(`  ${name}: eff=${eff.toFixed(4)}`);
}
