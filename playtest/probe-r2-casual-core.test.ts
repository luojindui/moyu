import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { doClick, buyUpgrade, clickPowerOf } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { UPGRADES, costOf, effectOf, BASE_IDLE_RATE, marginalEffect, milestoneGap } from "../src/engine/upgrades";
import { offlineEarn } from "../src/engine/offline";
import { settleReturn, RESUME_SETTLE_THRESHOLD_SECONDS } from "../src/engine/resume";
import { serialize, restore, type SaveAdapter } from "../src/engine/save";
import { flavorFor, CLICK_MEMES, UPGRADE_FLAVOR } from "../src/engine/flavor";
import { rankFor, RANKS } from "../src/engine/titles";

/**
 * R2 复测点①③④：底薪后的新手体验 / 彩蛋文案覆盖 / 切后台 resume 路径
 */

const DT = 0.05;

function memAdapter() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } satisfies SaveAdapter;
}

describe("R2-① 底薪后慢手党（1/s）前 30 秒", () => {
  it("佛系 1/s：首购时间 / 底薪起步 / 离线兜底", () => {
    let s = initialState();
    let tapCredit = 0;
    let firstBuy: number | null = null;
    let lastCheck = -1;
    const marks: string[] = [];
    for (let t = 0; t < 30; t += DT) {
      tapCredit += 1 * DT;
      while (tapCredit >= 1) { s = doClick(s); tapCredit -= 1; }
      s = advance(s, DT);
      if (t - lastCheck >= 1) {
        lastCheck = t;
        const afford = UPGRADES.filter((u) => s.moyu >= costOf(u.id, s.levels[u.id] ?? 0))
          .sort((a, b) => costOf(a.id, s.levels[a.id] ?? 0) - costOf(b.id, s.levels[b.id] ?? 0))[0];
        if (afford) { const n = buyUpgrade(s, afford.id); if (n) { s = n; if (firstBuy === null) firstBuy = t; } }
      }
    }
    const idle = effectOf(s).idleRate;
    console.log(`[1/s 30s] 首购 ${firstBuy!.toFixed(1)}s | 末 moyu=${Math.round(s.moyu)} click=${clickPowerOf(s)} idle=${idle}/s levels=${JSON.stringify(s.levels)}`);
    console.log(`[1/s 30s] 开局即有底薪 ${BASE_IDLE_RATE}/s（30 秒白送 ${BASE_IDLE_RATE * 30}）`);
    // 就算 0 秒退出（什么都没干）也有离线收益
    const quit0 = offlineEarn(initialState(), 30 * 60);
    console.log(`[白离开] 0s 退出 30min → 底薪给 ${quit0.earned}（>0 → 面板会弹）`);
    expect(firstBuy!).toBeLessThan(20); // 上轮 15.1s，底薪应更快
    expect(quit0.earned).toBeGreaterThan(0);
    marks.forEach((m) => console.log(m));
  });

  it("0-2min 慢手党结束态与盼头", () => {
    let s = initialState();
    let tapCredit = 0;
    let lastCheck = -1;
    for (let t = 0; t < 120; t += DT) {
      tapCredit += 1 * DT;
      while (tapCredit >= 1) { s = doClick(s); tapCredit -= 1; }
      s = advance(s, DT);
      if (t - lastCheck >= 5) {
        lastCheck = t;
        const afford = UPGRADES.filter((u) => s.moyu >= costOf(u.id, s.levels[u.id] ?? 0))
          .sort((a, b) => costOf(a.id, s.levels[a.id] ?? 0) - costOf(b.id, s.levels[b.id] ?? 0))[0];
        if (afford) { const n = buyUpgrade(s, afford.id); if (n) s = n; }
      }
    }
    const locked = UPGRADES.filter((u) => !(u.id in s.levels));
    const idle = effectOf(s).idleRate;
    console.log(`[1/s 2min] moyu=${Math.round(s.moyu)} click=${clickPowerOf(s)} idle=${idle} 解锁=${Object.keys(s.levels).length}/9`);
    console.log(`[1/s 2min] 未解锁: ${locked.map((u) => `${u.name}(${costOf(u.id, 0)})`).join(" ")}；下一件纯挂机 ${((costOf(locked[0]!.id, 0) - s.moyu) / idle).toFixed(0)}s`);
    expect(Object.keys(s.levels).length).toBeGreaterThanOrEqual(3);
  });
});

describe("R2-③ 彩蛋与商店增量文案覆盖", () => {
  it("9 档升级 × Lv1/5/10 彩蛋全覆盖", () => {
    expect(UPGRADES.length).toBe(9);
    for (const u of UPGRADES) {
      const lines = UPGRADE_FLAVOR[u.id]!;
      const l1 = flavorFor(u.id, 1)!, l5 = flavorFor(u.id, 5)!, l10 = flavorFor(u.id, 10)!;
      expect(l1).toBe(lines[0]); expect(l5).toBe(lines[1]); expect(l10).toBe(lines[2]);
      console.log(`${u.name} Lv1「${l1}」 Lv5「${l5}」 Lv10「${l10}」`);
    }
    expect(flavorFor("coffee", 0)).toBeNull();
  });

  it("商店卡在 Lv5/Lv19/Lv20 的实际文案（增量+里程碑倒计时）", () => {
    // 复刻 shop.ts refresh 的拼接
    const render = (id: string, lv: number) => {
      const m = marginalEffect(id, lv);
      const inc = m.clickPower > 0 ? `+${m.clickPower} 点击力` : `+${m.idleRate}/秒`;
      return `${inc}｜×2还差${milestoneGap(id, lv)}级` + (flavorFor(id, lv) ? `｜${flavorFor(id, lv)}` : "");
    };
    console.log(`coffee Lv19 → ${render("coffee", 19)}`);
    console.log(`coffee Lv20 → ${render("coffee", 20)}`);
    console.log(`phone  Lv19 → ${render("phone", 19)}`);
    console.log(`phone  Lv20 → ${render("phone", 20)}`);
    // 里程碑数值验证（错峰后）：coffee（偏移0）19→20 吃到 ×2 跳变；phone（偏移15）跳变口在 lv4→5
    expect(marginalEffect("coffee", 19).clickPower).toBe(21); // 40 - 19：里程碑口
    expect(marginalEffect("coffee", 20).clickPower).toBe(2); // 42 - 40：常态口
    expect(marginalEffect("phone", 4).idleRate).toBe(6); // 4 → 10：错峰里程碑口
    expect(marginalEffect("phone", 19).idleRate).toBe(2); // 38 → 40：常态口
    // 点击飘字梗池
    console.log(`点击梗池 ${CLICK_MEMES.length} 条: ${CLICK_MEMES.join(" / ")}`);
    expect(CLICK_MEMES.length).toBeGreaterThanOrEqual(6);
  });

  it("段位表与 HUD 进度", () => {
    for (const r of RANKS) console.log(`${r.name} @ ${r.at}`);
    const mid = rankFor(50_000);
    console.log(`累计5万 → ${mid.current}，升 ${mid.next!.name} 进度 ${(mid.progress * 100).toFixed(0)}%`);
    expect(rankFor(0).current).toBe("摸鱼实习生");
    expect(rankFor(1e9).current).toBe("带薪摸鱼传说");
  });
});

describe("R2-④ 切后台 resume 路径（上轮丢 99.7% 的修复验证）", () => {
  it("settleReturn：≥5s 补算+弹面板，<5s 不打扰", () => {
    let s = initialState();
    s.levels = { coffee: 15, phone: 5, water: 2, toilet: 1 }; // idle ≈ 10.2/s 的 session1 末态
    s.moyu = 605;
    const idle = effectOf(s).idleRate;
    // 切走 5 分钟（真实主循环 lastActiveMs → 回前台）
    const r = settleReturn(s, Date.now() - 5 * 60 * 1000, Date.now());
    console.log(`切走5min: 结算${r.applied}s 得 ${r.earned}（旧 bug 只得 ${idle * 1}）→ 面板=${r.showPanel}，回收率 ${(r.earned / (idle * 300) * 100).toFixed(1)}%`);
    expect(r.earned).toBeCloseTo(idle * 300, 0);
    expect(r.showPanel).toBe(true);
    // 3 秒误触（看一眼微信就回来）不该弹
    const quick = settleReturn(s, Date.now() - 3 * 1000, Date.now());
    expect(quick.applied).toBe(0);
    expect(quick.showPanel).toBe(false);
    expect(RESUME_SETTLE_THRESHOLD_SECONDS).toBe(5);
  });

  it("全链路：玩2min→存档→切后台30min→回前台（visibilitychange 路径）", () => {
    const mem = memAdapter();
    let s = initialState();
    s.levels = { coffee: 17, phone: 8, water: 4 };
    s.moyu = 128; s.totalEarned = 3000;
    serialize(s, mem, Date.now()); // pagehide 存档
    // 回前台：main.ts settleForeground(state, lastActiveMs, Date.now(), rate)
    const rate = 1; // 建档首日
    const r = settleReturn(s, Date.now() - 30 * 60 * 1000, Date.now(), rate);
    console.log(`切后台30min(首日rate=1): 得 ${r.earned} → 余额 ${Math.round(r.state.moyu)}（离开时的 ${(r.earned / 128).toFixed(0)} 倍）面板=${r.showPanel}`);
    expect(r.earned).toBeGreaterThan(14_000); // idle 8.2/s × 1800
  });

  it("次日回归 rate=0.7：同样的 30 分钟给七成", () => {
    let s = initialState();
    s.levels = { coffee: 30, phone: 20, water: 15, toilet: 10, chair: 5 };
    const day1 = settleReturn(s, Date.now() - 1800_000, Date.now(), 1);
    const day2 = settleReturn(s, Date.now() - 1800_000, Date.now(), 0.7);
    console.log(`idle=${effectOf(s).idleRate.toFixed(1)}/s：首日 30min=${day1.earned}，次日=${day2.earned}（${(day2.earned / day1.earned * 100).toFixed(0)}%）`);
    expect(day2.earned / day1.earned).toBeCloseTo(0.7, 5);
  });

  it("boot 路径等价性：杀页面重开 与 切后台回来 数值一致（同 rate）", () => {
    const mem = memAdapter();
    let s = initialState();
    s.levels = { phone: 5 };
    serialize(s, mem, Date.now());
    const back = restore(mem, Date.now() + 1800_000);
    const bootPath = offlineEarn(back.state!, back.offlineSeconds, 1);
    const resumePath = settleReturn(s, Date.now(), Date.now() + 1800_000, 1);
    expect(bootPath.earned).toBeCloseTo(resumePath.earned, 6);
    console.log(`两条路径 30min 各得 ${bootPath.earned}：一致 ✓（不再"杀页面反而更赚"）`);
  });
});
