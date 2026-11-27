import { initialState } from "../src/engine/state";
import { effectOf } from "../src/engine/upgrades";
import { DECOR, buyDecor } from "../src/engine/decor";
import { COLLEAGUES, recruit } from "../src/engine/team";
let s = { ...initialState(), moyu: 1e12, totalEarned: 1e12, lifetimeEarned: 1e12 };
for (const c of COLLEAGUES) s = recruit(s, c.id)!;
const inc = effectOf(s).idleRate;
console.log("income", inc);
for (const d of DECOR) {
  const probe = { ...s, decor: [...s.decor, d.id] };
  console.log(d.name, "dIdle", (effectOf(probe).idleRate - inc).toFixed(2), "cost", d.cost, "canBuy", !!buyDecor(s, d.id));
}
