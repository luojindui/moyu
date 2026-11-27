import { describe, it, expect } from "vitest";
import { runBot, DEFAULT_CFG, formatMoyu, type DayLog, type VisitLog } from "./probe-r6-ret-lib";
import { initialState, type GameState } from "../src/engine/state";
import { offlineEarn, OFFLINE_CAP_SECONDS } from "../src/engine/offline";
import { effectOf, costOf, UPGRADES } from "../src/engine/upgrades";
import { clickPowerOf, buyUpgrade } from "../src/engine/actions";
import { prestigeGain, prestigeMultiplier, PRESTIGE_UNLOCK } from "../src/engine/prestige";
import { restore, serialize, type SaveAdapter } from "../src/engine/save";
import { collectionCount } from "../src/engine/collection";
import { rankFor } from "../src/engine/titles";
import { dailyReward } from "../src/engine/daily";

/**
 * R8 商业化评估（付费心理/变现）探针 —— 只读 src/，不改游戏文件。
 * 全部数值来自 src/engine 真实函数 + r6-ret 14 天回访机器人（3 次/天 × 3 分钟、2cps、collector 策略）。
 *
 * ① 离线 8h 封顶 + 0.7 效率的真实经济权重（→「离线扩容」值多少钱）
 * ② localStorage 篡改（任何付费点能否被免费绕过）
 * ③ 转生点 ×1.08 复利的可购买价值（出售是否破坏曲线）
 * ④ 广告槽位盘点（每天自然出现几个领奖时刻、各值多少日收入）
 * ⑤ 自动点击的价值形状（早期 vs 后期）
 */

const H = 3600;
const CAP_H = OFFLINE_CAP_SECONDS / H; // 8
const bot = runBot({ ...DEFAULT_CFG, days: 14 });
const dayOf = (n: number): DayLog => bot.days[n - 1]!;
const visitsOfDay = (n: number): VisitLog[] => bot.visits.filter((v) => v.day === n);
const stateOfDay = (d: DayLog): GameState => ({ ...initialState(), levels: { ...d.levels } });
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
/** 封顶假设下的额外离线收益（一阶估算：按原挂机率与原效率） */
function extraIfCap(visits: VisitLog[], capH: number): number {
  return visits.reduce(
    (a, v) => a + v.idleRate * Math.max(0, Math.min(v.offlineSeconds, capH * H) - v.offlineApplied) * v.rate,
    0,
  );
}

describe("R8① 离线 8h 封顶的经济权重（→ 卖「离线扩容」值多少钱）", () => {
  it("按真实回访间隔：把封顶放宽到 12h / 24h，每天多多少离线收入", () => {
    console.log("\n===== 封顶放宽的收益（真实回访间隔：09:05→12:30→20:00，隔夜 12.95h）=====");
    console.log("天  挂机率/s    日收入       离线上限+12h（占日收入）  +24h（占日收入）");
    let sumIncome = 0;
    let sum12 = 0;
    let sum24 = 0;
    for (let n = 1; n <= 14; n++) {
      const d = dayOf(n);
      const vs = visitsOfDay(n);
      const e12 = extraIfCap(vs, 12);
      const e24 = extraIfCap(vs, 24);
      sumIncome += d.dayIncome;
      sum12 += e12;
      sum24 += e24;
      if ([1, 3, 7, 14].includes(n)) {
        console.log(
          `D${String(n).padStart(2)} ${formatMoyu(d.idleRate).padStart(8)}/s ${formatMoyu(d.dayIncome).padStart(10)}   +${formatMoyu(e12).padStart(9)}（${pct(e12 / d.dayIncome)}）  +${formatMoyu(e24).padStart(9)}（${pct(e24 / d.dayIncome)}）`,
        );
      }
    }
    console.log(`\n  14 天合计：封顶 12h 多赚 ${pct(sum12 / sumIncome)}，封顶 24h 多赚 ${pct(sum24 / sumIncome)}（一阶估算）`);
    console.log(`  → 只有隔夜（12.95h）那一次被 8h 卡掉 4.95h；日常 3 次回访下 12h 与 24h 差别很小（${pct((sum24 - sum12) / sumIncome)}）`);
    console.log("  → 真正的大头是「周末/一整天不登录」：离场 24h 时 8h 封顶只结算 33%");
    // 单次离场对比表（手动算术，绕过 offlineEarn 的 8h 封顶）
    console.log("\n  单次离场 8h/13h/16h/24h 结算占比（D3/D7/D14 实测挂机率、效率 0.7）：");
    for (const n of [3, 7, 14]) {
      const d = dayOf(n);
      const idle = d.idleRate;
      const row = [8, 13, 16, 24].map((absent) => {
        const cur = idle * Math.min(absent, CAP_H) * H * 0.7;
        const full = idle * absent * H * 0.7;
        return `${absent}h:${pct(cur / full)}`;
      });
      console.log(`  D${n}：${row.join("  ")}  → 8h 封顶在 13h 离场下少结算 ${pct((13 - 8) / 13)}`);
    }
    expect(sum12 / sumIncome).toBeGreaterThan(0.05);
  });

  it("0.7 → 1.0 离线效率的权重（这是现有留存把戏，不是付费点）", () => {
    console.log("\n===== 离线效率 0.7 vs 1.0（真实离线结算口径）=====");
    for (const n of [3, 7, 14]) {
      const d = dayOf(n);
      const delta = d.offlineEarned * (1 / 0.7 - 1); // 0.7 → 1.0 的增量
      console.log(
        `  D${n}：离线实收 ${formatMoyu(d.offlineEarned)}，若 1.0 = +${formatMoyu(delta)} = 日收入的 ${pct(delta / d.dayIncome)}`,
      );
    }
    const d14 = dayOf(14);
    const delta14 = d14.offlineEarned * (1 / 0.7 - 1);
    console.log(`  → 「3 次回访把 0.7 挣回 1.0」值日收入 ${pct(delta14 / d14.dayIncome)}，已是全游戏最大的单一可玩性杠杆`);
    console.log("  → 付费卖「离线效率」= 直接把现有留存的唯一硬钩子卖掉");
    expect(delta14 / d14.dayIncome).toBeGreaterThan(0.25);
  });
});

describe("R8② 存档可篡改（任何付费点都能被 localStorage 免费绕过）", () => {
  it("直接改存档 prestige / moyu / levels / 图鉴：restore 全部接受", () => {
    const now = 1_800_000_000_000;
    const store = new Map<string, string>();
    const adapter: SaveAdapter = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    };
    // 玩家在 DevTools 里改一行 JSON：prestige=200（1.08^200 ≈ 4.9e6 倍）
    const cheat = {
      v: 1,
      moyu: 1e15,
      totalEarned: 1e15,
      levels: { coffee: 1000, phone: 1000, retire: 1000 },
      savedAt: now - 60_000,
      createdAt: now - 3 * 86_400_000,
      collected: { quotes: [...Array(10).keys()], flavors: [...Array(45).keys()] },
      lifetimeEarned: 1e15,
      prestige: 200,
    };
    store.set("moyu-save", JSON.stringify(cheat));
    const s = restore(adapter, now).state!;
    const eff = effectOf(s);
    console.log("\n===== 篡改存档（localStorage 一行 JSON）=====");
    console.log(
      `  restore 接受：prestige=${s.prestige}（×${formatMoyu(prestigeMultiplier(s.prestige))}）、moyu=${formatMoyu(s.moyu)}、图鉴=${collectionCount(s)}/55（白拿 ×1.2 永久挂机）、段位「${rankFor(s.lifetimeEarned).current}」`,
    );
    console.log(
      `  效果：挂机 ${formatMoyu(eff.idleRate)}/s、点击 ${formatMoyu(clickPowerOf(s))}/次（正常 D14：挂机 ${formatMoyu(dayOf(14).idleRate)}/s）`,
    );
    console.log("  → restore() 只做形状/数值范围净化（levels≤1000、图鉴去重裁剪），没有签名/校验；付费标记同样可改");
    console.log("  → 只要存档在本地，任何「解锁/皮肤/加速」都等于免费；要卖就必须有服务端校验，而这与「零后端」定位冲突");
    expect(s.prestige).toBe(200);
    expect(collectionCount(s)).toBe(55);
    expect(eff.idleRate).toBeGreaterThan(dayOf(14).idleRate * 1000);
  });
});

describe("R8②b 时钟快进 = 免费离线加速（比改 JSON 更低门槛的刷法）", () => {
  it("把系统时钟往前拨 8h，每次开页都白拿一次 8h 离线结算，可无限重复", () => {
    const store = new Map<string, string>();
    const adapter: SaveAdapter = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    };
    let now = 1_800_000_000_000;
    // 以 D3 实测存档为起点（挂机 9.48万/s）
    let s: GameState = stateOfDay(dayOf(3));
    s = { ...s, moyu: 0, totalEarned: 0, lifetimeEarned: 0 };
    serialize(s, adapter, now);
    const earnedPerJump: number[] = [];
    for (let i = 0; i < 10; i++) {
      now += 8 * H * 1000; // 系统时钟拨快 8 小时（或第二天再拨）
      const r = restore(adapter, now);
      const before = r.state!.moyu;
      const off = offlineEarn(r.state!, r.offlineSeconds, 0.7);
      s = off.state;
      earnedPerJump.push(s.moyu - before);
      serialize(s, adapter, now);
    }
    const total = earnedPerJump.reduce((a, b) => a + b, 0);
    console.log("\n===== 时钟快进刷离线（D3 挂机率 9.48万/s 的存档）=====");
    console.log(`  每次拨快 8h → 结算 ${formatMoyu(earnedPerJump[0]!)}（离线秒数 ${(8 * H).toFixed(0)}，无上限钳制）`);
    console.log(
      `  连拨 10 次（约 1 分钟操作）→ ${formatMoyu(total)} = D3 日收入（29.49亿）的 ${(total / dayOf(3).dayIncome).toFixed(1)} 倍；转生解锁 1e8 只需 ${Math.ceil(PRESTIGE_UNLOCK / earnedPerJump[0]!)} 次`,
    );
    console.log("  → restore 只按 savedAt 与 now 的差值算离线，没有服务端时钟/最大间隔校验；任何「离线扩容/加速」付费点都可被免费绕过");
    expect(earnedPerJump[0]!).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(dayOf(3).dayIncome);
  });
});

describe("R8③ 转生点（×1.08 复利）作为付费点的价值与破坏性", () => {
  it("转生点收益曲线 + 每轮农场速度（复利无上限）", () => {
    console.log("\n===== 转生点价值 =====");
    console.log("  " + [1, 2, 5, 10, 20, 50, 100].map((n) => `${n}点=×${prestigeMultiplier(n).toFixed(2)}`).join("  "));
    console.log("  实测累计（r6 14 天表）：D1 1.82e7 / D2 6.31e8 / D3 3.54e9 / D14 3.03e12");
    for (const x of [1e8, 6.31e8, 3.54e9, 3.03e12]) {
      console.log(`  totalEarned=${formatMoyu(x)} → 可换 ${prestigeGain({ totalEarned: x } as GameState)} 点`);
    }
    // 每轮「一到 1e8 立刻转」= 2 点/轮；日收入按实测线性缩放
    console.log("\n  转生农场估算（到 1e8 立刻转 = 2 点/轮；日收入按实测 D1 1.82e7 / D2 6.12e8 线性缩放）：");
    for (const n of [0, 10, 20, 40, 60]) {
      const m = prestigeMultiplier(n);
      const d1 = 1.8246e7 * m;
      const d2 = 6.12e8 * m;
      const cycleDays = d1 >= PRESTIGE_UNLOCK ? PRESTIGE_UNLOCK / d1 : 1 + (PRESTIGE_UNLOCK - d1) / d2;
      const ptsPerDay = 2 / cycleDays;
      console.log(
        `    ${String(n).padStart(2)} 点（×${m.toFixed(2)}）：一轮 ${(cycleDays * 24).toFixed(1)}h → ${ptsPerDay.toFixed(1)} 点/天 → 每天乘 ×${prestigeMultiplier(ptsPerDay).toFixed(3)}`,
      );
      expect(cycleDays).toBeGreaterThan(0);
    }
    console.log("  → 点数越多单轮越快、每轮固定 +2 点；「单局封顶 20 点」不封总分 → 复利无上限，可被无限刷");
    console.log("  → 若出售点数：卖 20 点（×4.66）= 直接跳过约 10 天；卖 60 点（×101）游戏曲线作废，且无排行榜可炫耀（付了也没人看见）");
  });
});

describe("R8④ 广告槽位盘点（每天自然出现的领奖时刻值多少）", () => {
  it("回访/巡逻/丢梗/日报的次数与价值权重", () => {
    const days = bot.days.slice(2);
    const avg = (f: (d: DayLog) => number): number => days.reduce((a, d) => a + f(d), 0) / days.length;
    const d14 = dayOf(14);
    const patrols = avg((d) => d.patrols);
    const memes = avg((d) => d.memeHits);
    const dailyPct = dailyReward(stateOfDay(d14)) / d14.dayIncome;
    const bossPct = (patrols * 4 * d14.idleRate) / d14.dayIncome;
    const activePct = avg((d) => d.activeEarned / d.dayIncome);
    console.log("\n===== 每天自然的「可插入广告」时刻（D3+ 均值）=====");
    console.log(`  开页离线结算：3 次/天，离线 = 日收入 ${pct(d14.offlineRatio)} —— 唯一有价值的广告位`);
    console.log(`  老板巡逻：${patrols.toFixed(0)} 次/天，安然奖励合计 ≈ 日收入 ${pct(bossPct)}`);
    console.log(`  同事丢梗：${memes.toFixed(0)} 次/天，奖励量级 = 主动收入（主动仅占日收入 ${pct(activePct)}）`);
    console.log(`  日报领取：1 次/天，奖励 ${formatMoyu(dailyReward(stateOfDay(d14)))} = 日收入 ${(dailyPct * 100).toFixed(2)}%`);
    console.log(`  → 「看广告 ×2 离线」若放每次开页：3 次/天，每次值日收入 ${pct(d14.offlineRatio)}，理论上限 +${pct(d14.offlineRatio * 3)}`);
    console.log("  → 巡逻/丢梗/日报奖励都 <2% 日收入，绑广告只会让玩家觉得「广告比奖励值钱」");
    expect(dailyPct).toBeLessThan(0.03);
    expect(bossPct).toBeLessThan(0.05);
    expect(activePct).toBeLessThan(0.05);
  });
});

describe("R8⑤ 自动点击的价值形状（早期破坏、后期鸡肋）", () => {
  it("同等预算下「纯点击线」vs「纯挂机线」，再折算自动点击", () => {
    /** 把预算全部灌进指定升级线（贪心买最便宜的下一级） */
    function buildAll(budget: number, ids: string[]): GameState {
      let s: GameState = { ...initialState(), moyu: budget };
      let any = true;
      while (any) {
        any = false;
        for (const id of ids) {
          const n = buyUpgrade(s, id);
          if (n) {
            s = n;
            any = true;
          }
        }
      }
      return s;
    }
    const clickIds = UPGRADES.filter((u) => u.clickPower).map((u) => u.id);
    const idleIds = UPGRADES.filter((u) => u.idleRate).map((u) => u.id);
    console.log("\n===== 同等预算：纯点击线 vs 纯挂机线（预算 = D14 累计 3.03e12）=====");
    for (const [label, budget] of [
      ["1 万（开局 ~2 分钟）", 1e4],
      ["100 万（开局 ~7 分钟）", 1e6],
      ["3.03e12（D14）", 3.03e12],
    ] as const) {
      const c = buildAll(budget, clickIds);
      const i = buildAll(budget, idleIds);
      const cp = clickPowerOf(c);
      const ci = effectOf(c).idleRate;
      const ii = effectOf(i).idleRate;
      console.log(
        `  ${label}：点击线 点击力 ${formatMoyu(cp)}/次（挂机 ${formatMoyu(ci)}/s）｜挂机线 ${formatMoyu(ii)}/s → 3cps 自动点 = 挂机线的 ${pct((3 * cp) / ii)}`,
      );
      expect(ii).toBeGreaterThan(0);
    }
    console.log("  → 早期（1 万预算）点击线按 3cps 是挂机线的数倍；后期（3e12）挂机线反超一个量级");
    console.log("  → 自动点击 = 把「只有手点才有的早期爆发」变成常驻：恰好破坏最强的新手 3 分钟");
    console.log(`  → 后期即使 24h 自动点，也只相当于挂机收入的十几 %，卖不出价（D14 巡逻 ${dayOf(14).patrols} 次/天，罚款≈日收入 0.1%，挡不住）`);
    expect(dayOf(14).patrols).toBeGreaterThan(0);
  });
});
