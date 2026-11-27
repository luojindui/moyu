import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { buyUpgrade } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { settleReturn } from "../src/engine/resume";
import { UPGRADES, costOf, effectOf } from "../src/engine/upgrades";
import { ensureVisits, offlineEfficiency } from "../src/engine/progression";
import { prestigeGain, doPrestige, canPrestige } from "../src/engine/prestige";

/**
 * 转生策略对比（competitor 报告 P0 复验）：
 * 7 天、每天 3 次回访，比较「从不转生 / 尽早转生(>=1点) / 攒到 3 点转 / 攒到 20 点转」的历史累计。
 */
const DAY = 86_400_000;
const MIN_PER_VISIT = 6;

function visit(state: ReturnType<typeof initialState>, nowMs: number) {
  let s = ensureVisits(state, nowMs);
  // 模拟离线：按距上次访问的时间结算（简化：每次访问间隔按 1/3 天）
  const gapMs = nowMs - (state as never as { _last?: number })._last!;
  if (isFinite(gapMs) && gapMs > 60_000) {
    const rate = offlineEfficiency(s, 0, nowMs);
    const r = settleReturn(s, nowMs - gapMs, nowMs, rate);
    s = r.state;
  }
  let t = 0;
  while (t < MIN_PER_VISIT * 60) {
    s = advance(s, 1);
    t += 1;
    if (t % 5 === 0) {
      const sorted = [...UPGRADES].sort((a, b) => {
        const la = s.levels[a.id] ?? 0;
        const lb = s.levels[b.id] ?? 0;
        return costOf(a.id, la) - costOf(b.id, lb);
      });
      for (const u of sorted) {
        const next = buyUpgrade(s, u.id);
        if (next) {
          s = next;
          break;
        }
      }
    }
  }
  (s as never as { _last?: number })._last = nowMs;
  return s;
}

function run7d(mode: "never" | "greedy1" | "greedy3" | "wait20") {
  let s = initialState();
  (s as never as { _last?: number })._last = 0;
  let now = 0;
  let prestiges = 0;
  for (let d = 0; d < 7; d++) {
    for (const h of [9, 13, 20]) {
      now = d * DAY + h * 3600_000;
      s = visit(s, now);
      if (canPrestige(s)) {
        const gain = prestigeGain(s);
        const want = mode === "greedy1" ? 1 : mode === "greedy3" ? 3 : mode === "wait20" ? 20 : Infinity;
        if (mode !== "never" && gain >= want) {
          const r = doPrestige(s);
          if (r) {
            s = r.state;
            (s as never as { _last?: number })._last = now;
            prestiges++;
          }
        }
      }
    }
  }
  return { lifetime: s.lifetimeEarned, prestige: s.prestige, prestiges };
}

describe("转生策略对比（7 天）", () => {
  it("四种策略的历史累计对比", () => {
    const rows = (["never", "greedy1", "greedy3", "wait20"] as const).map((m) => ({
      mode: m,
      ...run7d(m),
    }));
    console.log(rows.map((r) => `${r.mode}: lifetime=${(r.lifetime / 1e8).toFixed(1)}e8 转生=${r.prestiges}次 点数=${r.prestige}`).join("\n"));
    expect(rows.length).toBe(4);
  }, 240_000);
});
