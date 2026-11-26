import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { doClick, buyUpgrade, clickPowerOf } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { UPGRADES, costOf, effectOf } from "../src/engine/upgrades";
import { serialize, restore, type SaveAdapter } from "../src/engine/save";
import { offlineEarn, OFFLINE_CAP_SECONDS } from "../src/engine/offline";
import { formatMoyu } from "../src/engine/format";

/**
 * 休闲玩家探针①：真实碎片化游玩
 * 5 次 × 120 秒碎片 session，中间隔 30 分钟离线（走 serialize→restore→offlineEarn 完整链路）。
 * 模拟真实休闲节奏：
 *  - keen（新手向）：每次回场前 15 秒兴奋 2.5/s，之后衰减到 0.8/s（上班间隙偷玩）
 *  - chill（佛系）：全程 1/s
 * 购买策略模拟"看到亮了才买"：每 5 秒检查一次商店，优先解锁没买过的卡（收集欲），否则买最便宜可负担的。
 */

const DT = 0.05;
const SESSION_SECONDS = 120;
const OFFLINE_SECONDS = 30 * 60;
const BUY_CHECK_EVERY = 5; // 休闲玩家大概每 5 秒瞄一眼商店

interface Mood {
  tapsAt: (tInSession: number) => number; // tInSession: 秒
}

const MOODS: Record<string, Mood> = {
  keen: { tapsAt: (t) => (t < 15 ? 2.5 : Math.max(0.6, 2.5 - t * 0.014)) }, // 15s 后从 2.29 衰减到 ~0.8
  chill: { tapsAt: () => 1 },
};

function session(state: { moyu: number; levels: Record<string, number> }, mood: Mood) {
  let s = { ...state, levels: { ...state.levels } };
  let tapCredit = 0;
  let lastBuyCheck = -BUY_CHECK_EVERY;
  const purchases: { t: number; item: string }[] = [];
  let clicks = 0;
  let maxNoBuyGap = 0;
  let lastBuyAt = 0;

  for (let t = 0; t < SESSION_SECONDS; t += DT) {
    tapCredit += mood.tapsAt(t) * DT;
    while (tapCredit >= 1) {
      s = doClick(s);
      tapCredit -= 1;
      clicks++;
    }
    s = advance(s, DT);

    if (t - lastBuyCheck >= BUY_CHECK_EVERY) {
      lastBuyCheck = t;
      const owned = new Set(Object.keys(s.levels));
      const affordable = UPGRADES.filter((u) => s.moyu >= costOf(u.id, s.levels[u.id] ?? 0));
      // 优先解锁新卡（收集感），否则最便宜
      const target =
        affordable.find((u) => !owned.has(u.id)) ??
        affordable.sort((a, b) => costOf(a.id, s.levels[a.id] ?? 0) - costOf(b.id, s.levels[b.id] ?? 0))[0];
      if (target) {
        const next = buyUpgrade(s, target.id);
        if (next) {
          s = next;
          purchases.push({ t: +t.toFixed(1), item: target.name });
          maxNoBuyGap = Math.max(maxNoBuyGap, t - lastBuyAt);
          lastBuyAt = t;
        }
      }
    }
  }
  maxNoBuyGap = Math.max(maxNoBuyGap, SESSION_SECONDS - lastBuyAt);
  return { state: s, purchases, clicks, maxNoBuyGap };
}

/** 下一件"未解锁新卡"还差多少秒（纯挂机攒） */
function secondsToNextUnlock(s: { moyu: number; levels: Record<string, number> }) {
  const locked = UPGRADES.filter((u) => !(u.id in s.levels));
  if (!locked.length) return null;
  const rate = effectOf(s).idleRate;
  const need = Math.min(...locked.map((u) => costOf(u.id, 0) - s.moyu));
  return { lockedName: locked.find((u) => costOf(u.id, 0) - s.moyu === need)!.name, need, seconds: rate > 0 ? need / rate : Infinity };
}

function runFragments(moodName: string) {
  const mood = MOODS[moodName]!;
  const store = new Map<string, string>();
  const mem: SaveAdapter = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
  let clock = 0; // 毫秒
  let s = initialState();
  const log: Record<string, unknown>[] = [];

  for (let i = 1; i <= 5; i++) {
    // ---- 回来（离线结算，与 main.ts boot 相同链路）----
    serialize(s, mem, clock);
    const back = restore(mem, clock + OFFLINE_SECONDS * 1000);
    const off = offlineEarn(back.state!, back.offlineSeconds);
    s = off.state;
    const cheapest = Math.min(...UPGRADES.map((u) => costOf(u.id, s.levels[u.id] ?? 0)));
    const welcomeShown = off.earned > 0; // main.ts: earned>0 才显示面板

    // ---- 2 分钟碎片 session ----
    const r = session(s, mood);
    s = r.state;
    clock += (OFFLINE_SECONDS + SESSION_SECONDS) * 1000;

    const idle = effectOf(s).idleRate;
    log.push({
      session: i,
      回来时离线收益: Math.round(off.earned),
      离线收益文本: formatMoyu(off.earned),
      欢迎面板: welcomeShown ? "显示" : "不显示(earned=0)",
      离线收益可买最便宜件数: Math.floor(off.earned / cheapest),
      session内购买数: r.purchases.length,
      session内点击数: r.clicks,
      最长无购买间隔s: +r.maxNoBuyGap.toFixed(1),
      结束余额: Math.round(s.moyu),
      点击力: clickPowerOf(s),
      挂机每秒: +idle.toFixed(1),
      已解锁: Object.keys(s.levels).length + "/6",
      下一件新卡: secondsToNextUnlock(s),
      购买明细: r.purchases.map((p) => `${p.t}s${p.item}`).join(" → "),
    });
  }
  return log;
}

describe("休闲玩家探针①：5×2min 碎片 session + 30min 离线", () => {
  it("keen 新手向节奏", () => {
    const log = runFragments("keen");
    console.table ? console.table : 0;
    for (const row of log) console.log(JSON.stringify(row));
    // 基本断言：5 个 session 后至少解锁 3 种升级
    const last = log.at(-1)!;
    expect(Number(String(last.已解锁).split("/")[0])).toBeGreaterThanOrEqual(3);
  });

  it("chill 佛系节奏", () => {
    const log = runFragments("chill");
    for (const row of log) console.log(JSON.stringify(row));
    const first = log[0]!;
    // 佛系 1/s 第一个 session 结束未必解锁挂机（刷手机 50 咖啡更便宜）
    console.log("[chill] session1 后已解锁:", first.已解锁, "挂机:", first.挂机每秒, "欢迎面板:", first.欢迎面板);
  });

  it("离线 8h 封顶验证（休闲玩家周末回来）", () => {
    const s = initialState();
    s.levels.phone = 3; // 与 simulate.test.ts 的 offlineCheck 同起点，便于对照
    const off = offlineEarn(s, 100 * 3600);
    expect(off.applied).toBe(OFFLINE_CAP_SECONDS);
    console.log("[cap] 100h 离线只结算", off.applied / 3600, "h, 收益", off.earned);
  });
});
