import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { doClick, buyUpgrade, clickPowerOf } from "../src/engine/actions";
import { advance } from "../src/engine/tick";
import { UPGRADES, costOf, effectOf } from "../src/engine/upgrades";
import { offlineEarn } from "../src/engine/offline";

/**
 * 休闲玩家探针②：第一次玩的 0-30s / 0-2min 显微镜
 *  - 新手兴奋期实际能摸到什么（第一件几秒到手、30s 末状态、2min 末状态）
 *  - 多少秒解锁"刷手机"（第一个挂机来源 = 放置游戏真正的开始）
 *  - "零离线收益窗口"：没买刷手机前退出，离线收益恒为 0，欢迎面板不弹。量化这个坑有多宽。
 *  - 点击贡献衰减：点击力相对挂机速率何时变得可有可无
 */

const DT = 0.05;

/** 模拟新手前 N 秒：兴奋点击 3/s（摸到门道后通常降速），看到可买就买最便宜 */
function firstTime(seconds: number, taps: (t: number) => number) {
  let s = initialState();
  let tapCredit = 0;
  let clicks = 0;
  const marks: { t: number; event: string }[] = [];
  let lastBuyCheck = -1;
  for (let t = 0; t < seconds; t += DT) {
    tapCredit += taps(t) * DT;
    while (tapCredit >= 1) {
      s = doClick(s);
      tapCredit -= 1;
      clicks++;
      if (clicks === 1) marks.push({ t: +t.toFixed(1), event: "第 1 次点击（+1 飘字）" });
    }
    s = advance(s, DT);
    if (t - lastBuyCheck >= 1) {
      lastBuyCheck = t;
      const affordable = UPGRADES.filter((u) => s.moyu >= costOf(u.id, s.levels[u.id] ?? 0)).sort(
        (a, b) => costOf(a.id, s.levels[a.id] ?? 0) - costOf(b.id, s.levels[b.id] ?? 0),
      );
      const target = affordable[0];
      if (target) {
        const before = clickPowerOf(s);
        const next = buyUpgrade(s, target.id);
        if (next) {
          s = next;
          const isNew = !(target.id in (next.levels ?? {})) || next.levels[target.id] === 1;
          marks.push({
            t: +t.toFixed(1),
            event: `买 ${target.name}${next.levels[target.id] === 1 ? "(新解锁!)" : ""} → 点击力 ${before}→${clickPowerOf(s)}`,
          });
          if (isNew && target.id === "phone") marks.push({ t: +t.toFixed(1), event: "★ 挂机 +1/秒 达成（放置循环启动）" });
        }
      }
    }
  }
  return { state: s, clicks, marks };
}

describe("休闲玩家探针②：首次体验显微镜", () => {
  it("0-30s：新手知道该干什么吗（兴奋期 3/s）", () => {
    const r = firstTime(30, () => 3);
    console.log("[0-30s] 点击", r.clicks, "次; 末状态 moyu=", Math.round(r.state.moyu), "clickPower=", clickPowerOf(r.state), "idle=", effectOf(r.state).idleRate, "levels=", r.state.levels);
    for (const m of r.marks) console.log("  ", m.t + "s", m.event);
    expect(r.clicks).toBeGreaterThan(60); // 30s@3/s 应有 90 次左右
  });

  it("0-2min：碎片 session 结束时有没有盼头", () => {
    // 更真实的休闲曲线：前 20s 兴奋 3/s，之后掉到 1/s（手酸/被老板瞄了一眼）
    const r = firstTime(120, (t) => (t < 20 ? 3 : 1));
    const s = r.state;
    const idle = effectOf(s).idleRate;
    const locked = UPGRADES.filter((u) => !(u.id in s.levels));
    console.log("[0-2min] 点击", r.clicks, "; moyu=", Math.round(s.moyu), "; click=", clickPowerOf(s), "; idle=", idle, "; levels=", s.levels);
    console.log("[0-2min] 未解锁:", locked.map((u) => `${u.name}(需${costOf(u.id, 0)})`).join(", "));
    // 离开 30 分钟后的盼头（若此时退出）
    const off = offlineEarn(s, 30 * 60);
    console.log("[0-2min→离线30min] 收益", Math.round(off.earned), "→ 面板", off.earned > 0 ? "弹" : "不弹(earned=0)");
    expect(true).toBe(true);
  });

  it("零离线收益窗口：多长时间内退出 = 白离开", () => {
    // 从 0 开始按休闲节奏玩 X 秒后退出 30min，找 earned 仍为 0 的最晚退出点
    // 休闲节奏取 keen：前 15s 2.5/s 后衰减
    const taps = (t: number) => (t < 15 ? 2.5 : Math.max(0.6, 2.5 - t * 0.014));
    let worst = 0;
    const rows: string[] = [];
    for (let quitAt = 30; quitAt <= 300; quitAt += 30) {
      const r = firstTime(quitAt, taps);
      const off = offlineEarn(r.state, 30 * 60);
      const idle = effectOf(r.state).idleRate;
      rows.push(`玩${String(quitAt).padStart(3)}s后走 → idle=${idle}/s → 30min离线=${Math.round(off.earned)} → ${off.earned > 0 ? "有面板" : "★零收益无面板"}`);
      if (off.earned <= 0) worst = quitAt;
    }
    rows.forEach((x) => console.log(x));
    console.log("[结论] 零收益窗口至少覆盖到第", worst, "秒才退出");
    // ✅ 已修复（回归）：底薪 0.2/s 后零收益窗口消失——任何时候退出都有收益
    expect(worst).toBe(0);
  });

  it("点击贡献衰减：点击一次值几秒挂机", () => {
    // 复刻 report.json casual 画像各检查点的 click vs idle
    const pts = [
      { m: 1, click: 3, idle: 0 },
      { m: 3, click: 7, idle: 0 },
      { m: 10, click: 17, idle: 5 },
      { m: 30, click: 51, idle: 32 },
      { m: 60, click: 90, idle: 148 },
      { m: 120, click: 152, idle: 789 },
      { m: 180, click: 173, idle: 1048 },
    ];
    for (const p of pts) {
      const sec = p.idle > 0 ? (p.click / p.idle).toFixed(2) : "∞(无挂机)";
      console.log(`m=${p.m}: 点1次=${p.click} 值 ${sec}s 挂机 ${p.idle > 0 && p.click / p.idle < 1 ? "← 点击已不如挂机1秒" : ""}`);
    }
    expect(pts[4]!.click / pts[4]!.idle).toBeLessThan(1); // m=60 起点击贬值
  });
});
