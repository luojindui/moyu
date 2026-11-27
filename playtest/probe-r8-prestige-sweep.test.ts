import { describe, it } from "vitest";
import { initialState } from "../src/engine/state";
import { buyUpgrade } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { settleReturn } from "../src/engine/resume";
import { UPGRADES, costOf } from "../src/engine/upgrades";
import { ensureVisits, offlineEfficiency } from "../src/engine/progression";
import { prestigeGain, doPrestige, canPrestige, PRESTIGE_TUNING } from "../src/engine/prestige";

const DAY = 86_400_000;

function visit(state: any, nowMs: number) {
  let s = ensureVisits(state, nowMs);
  const gap = nowMs - (state._last ?? 0);
  if (gap > 60_000) s = settleReturn(s, nowMs - gap, nowMs, offlineEfficiency(s, 0, nowMs)).state;
  for (let t = 0; t < 360; t++) {
    s = advance(s, 1);
    if (t % 5 === 0) {
      const sorted = [...UPGRADES].sort((a, b) => costOf(a.id, s.levels[a.id] ?? 0) - costOf(b.id, s.levels[b.id] ?? 0));
      for (const u of sorted) {
        const nx = buyUpgrade(s, u.id);
        if (nx) { s = nx; break; }
      }
    }
  }
  s._last = nowMs;
  return s;
}

function run7d(mode: "never" | "greedy" | "wait", minGain: number) {
  let s: any = { ...initialState(), _last: 0 };
  let now = 0;
  let prestiges = 0;
  for (let d = 0; d < 7; d++) {
    for (const h of [9, 13, 20]) {
      now = d * DAY + h * 3600_000;
      s = visit(s, now);
      if (mode !== "never" && canPrestige(s) && prestigeGain(s) >= minGain) {
        const r = doPrestige(s);
        if (r) { s = { ...r.state, _last: now }; prestiges++; }
      }
    }
  }
  return { lifetime: s.lifetimeEarned, prestige: s.prestige, prestiges };
}

describe("转生参数扫描", () => {
  it("找一组让「转生 > 不转生」的参数", () => {
    const configs = [
      { perPoint: 0.25, gainA: 2, gainB: 0.35, keepLevelRatio: 0.5 },
      { perPoint: 0.35, gainA: 2, gainB: 0.35, keepLevelRatio: 0.5 },
      { perPoint: 0.5, gainA: 2, gainB: 0.35, keepLevelRatio: 0.6 },
      { perPoint: 0.5, gainA: 3, gainB: 0.4, keepLevelRatio: 0.7 },
      { perPoint: 0.75, gainA: 3, gainB: 0.4, keepLevelRatio: 0.8 },
    ];
    const rows: string[] = [];
    for (const cfg of configs) {
      Object.assign(PRESTIGE_TUNING, cfg);
      const never = run7d("never", 0);
      const greedy = run7d("greedy", 1);
      const wait = run7d("greedy", 8);
      rows.push(
        `per=${cfg.perPoint} A=${cfg.gainA} B=${cfg.gainB} keep=${cfg.keepLevelRatio} | 不转=${(never.lifetime / 1e8).toFixed(0)}e8 | 见转=${(greedy.lifetime / 1e8).toFixed(0)}e8(${greedy.prestiges}转) | 攒8点=${(wait.lifetime / 1e8).toFixed(0)}e8(${wait.prestiges}转)`,
      );
    }
    console.log(rows.join("\n"));
  }, 600_000);
});
