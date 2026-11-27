import { describe, it, expect } from "vitest";
import { runBot, longestNoChangeRun, DEFAULT_CFG, formatMoyu, TOTAL_ITEMS } from "./probe-r6-ret-lib";
import { RANKS } from "../src/engine/titles";
import { OFFLINE_CAP_SECONDS } from "../src/engine/offline";

/**
 * 探针③：Day3 / Day7 / Day14 三个节点的「回访动机」评估 + 最小改动数值方案。
 * 评估口径：玩家打开游戏时，能拿到哪些「确定新变化」（段位晋升/图鉴新增/新升级）？
 * 剩下的只有：日报（可完成率/ streak）、数字增长（日收入增速）。
 */

const bot = runBot();
const b30 = runBot({ ...DEFAULT_CFG, days: 30 });
const last = bot.days.at(-1)!;

function byDay(n: number) {
  return bot.days.find((d) => d.day === n)!;
}
function lastChangeDay(): number {
  const withChange = bot.days.filter((d) => d.newChanges.length > 0);
  return withChange.at(-1)!.day;
}

describe("R6 留存③：Day3/7/14 回访动机评估", () => {
  it("Day3：段位刚触顶（唯一最强周期目标消失），图鉴只剩 5 格可拿", () => {
    const d3 = byDay(3);
    const reachable = 43 - d3.collection; // 理性玩家图鉴上限 43，D5 之后不再增长
    console.log("\n===== Day3（D3 = 11-29）=====");
    console.log(
      `  段位：${d3.rankName} ${d3.rankIdx + 1}/7 100%（Day3 当天从第 5 档连跳 2 档到终点，之后 12 天不会再晋升）`,
    );
    console.log(
      `  图鉴：${d3.collection}/55，当天 +4；理性玩家可拿的只剩 5 格（43-38），按当天速度 2 天后到顶（实际 D5 到 43/55）`,
    );
    console.log(`  升级：9/9 已解锁（Day1 全部解完）；挂机率 ${formatMoyu(d3.idleRate)}/s，日收入 ${formatMoyu(d3.dayIncome)}（×${(d3.dayIncome / byDay(2).dayIncome).toFixed(2)}）`);
    console.log(
      `  日报：streak=3，奖励 ${formatMoyu(d3.daily!.reward)}（日收入的 ${(d3.dailyRewardRatio * 100).toFixed(2)}%）`,
    );
    console.log(`  → 回来理由：图鉴还会每天+4 的「新彩蛋」期待（但只剩 5 格 / 2 天），段位已无。`);
    expect(d3.rankIdx).toBe(6);
    expect(reachable).toBe(5);
    // 最后一天出现图鉴新增
    expect(lastChangeDay()).toBe(5);
  });

  it("Day7：所有离散目标已归零 2 天，只剩 streak 数字", () => {
    const d7 = byDay(7);
    console.log("\n===== Day7（D7 = 12-03）=====");
    console.log(`  段位：${d7.rankName} 100%，已满 ${d7.day - 3} 天`);
    console.log(`  图鉴：${d7.collection}/55，距上次新增 ${d7.day - lastChangeDay()} 天（D5 之后永久 43/55）`);
    console.log(`  升级：9/9（距上次新升级 ${d7.day - 1} 天）；挂机率 ${formatMoyu(d7.idleRate)}/s`);
    console.log(
      `  日收入：${formatMoyu(d7.dayIncome)}（×${(d7.dayIncome / byDay(6).dayIncome).toFixed(2)}；靠挂机率翻倍，不是新内容）`,
    );
    console.log(
      `  日报：streak=${d7.daily!.streak}（今天没有任何里程碑奖励），奖励 ${formatMoyu(d7.daily!.reward)}（日收入的 ${(d7.dailyRewardRatio * 100).toFixed(2)}%）`,
    );
    console.log(`  → 回来理由：只剩「streak 不能断」的惯性；今天打开游戏拿到的新东西 = 0（严格口径已连续 2 天）。`);
    expect(d7.newChanges).toEqual([]);
    expect(d7.rankIdx).toBe(6);
    expect(d7.collection).toBe(43);
    expect(d7.dailyRewardRatio).toBeLessThan(0.002);
  });

  it("Day14：连续 9 天零新变化，游戏只剩每日几乎不变的数字", () => {
    const d14 = byDay(14);
    const d13 = byDay(13);
    console.log("\n===== Day14（D14 = 12-10）=====");
    console.log(
      `  段位：${d14.rankName} 100%，已满 ${d14.day - 3} 天；图鉴 ${d14.collection}/55，距上次新增 ${d14.day - lastChangeDay()} 天；升级 9/9（距上次 ${d14.day - 1} 天）`,
    );
    console.log(
      `  日收入 ${formatMoyu(d14.dayIncome)}（×${(d14.dayIncome / d13.dayIncome).toFixed(2)}/天，D8 以后每天只 +1%~5%）`,
    );
    console.log(`  streak=${d14.daily!.streak}（14 天满签）是唯一还在变的数字；日报奖励占日收入 ${(d14.dailyRewardRatio * 100).toFixed(3)}%`);
    console.log(`  累计 ${formatMoyu(d14.totalEarned)}，HUD 常驻「宇宙尽头」= 终点；30 天外推：连续 ${longestNoChangeRun(b30.days).length} 天零新变化`);
    console.log(`  → 回来理由：无（除非玩家把 streak 当目标，而 streak 断掉的惩罚只是从头再来）。`);
    expect(d14.newChanges).toEqual([]);
    expect(d14.dayIncome / d13.dayIncome).toBeLessThan(1.1);
    expect(longestNoChangeRun(b30.days).length).toBeGreaterThanOrEqual(25);
  });

  it("最少改动方案①：段位阶梯延长（按实测累计曲线给触发日）", () => {
    // 现有 7 档终点 2.5e9 在 D3 就被打穿；之后累计值曲线（实测）：
    const ladder = [5e9, 1e10, 2e10, 4e10, 8e10, 1.6e11, 3.2e11, 6.4e11, 1.28e12, 2.56e12];
    const fire = ladder.map((t) => ({ at: t, day: b30.days.find((d) => d.totalEarned >= t)?.day ?? null }));
    console.log("\n===== 建议①：终点 2.5e9 之后按 ×2 续档 =====");
    console.log(`  终点后累计值实测：D3 ${formatMoyu(byDay(3).totalEarned)} / D5 ${formatMoyu(byDay(5).totalEarned)} / D14 ${formatMoyu(last.totalEarned)} / D30 ${formatMoyu(b30.days.at(-1)!.totalEarned)}`);
    console.log(
      `  新增档位触发日：${fire.map((f) => `${formatMoyu(f.at)}→D${f.day ?? ">30"}`).join("  ")}`,
    );
    const in14 = fire.filter((f) => f.day !== null && f.day <= 14);
    console.log(`  → 14 天内可补 ${in14.length} 次晋升（现在 D3 之后 0 次）；D14 之后每 ~4-5 天一次，覆盖 2 周+留存`);
    expect(in14.length).toBeGreaterThanOrEqual(6);
    expect(fire.some((f) => f.day !== null && f.day > 14)).toBe(true);
    // 现有档位表只有 7 档
    expect(RANKS.length).toBe(7);
  });

  it("最少改动方案②：把「回访」接进离线效率（0.7 从固定税变成可挣回）", () => {
    const d14 = last;
    const offline = d14.offlineEarned;
    const uplift = offline / 0.7 - offline; // 0.7 → 1.0
    // 少来一次的代价（3 次回访的间隔：3.45h / 7.45h / 12.95h，封顶 8h）
    const cap = OFFLINE_CAP_SECONDS / 3600;
    const settled = (gaps: number[]) => gaps.reduce((a, g) => a + Math.min(g, cap), 0);
    const base = settled([3.45, 7.45, 12.95]);
    const morning = settled([7.45, 16.45]); // 少来早班
    const noon = settled([11.05, 12.95]); // 少来午班
    const evening = settled([3.45, 20.5]); // 少来晚班
    console.log("\n===== 建议②：回访 → 离线效率 =====");
    console.log(
      `  现状：3 次回访主动游玩只值日收入的 ${(100 * d14.activeEarned / d14.dayIncome).toFixed(2)}%；离线 98.7% 开页即到账，和「玩得好不好」无关`,
    );
    console.log(
      `  改法：离线效率 0.7 起，当日每次回访 +0.1（3 次到 1.0，断签回落 0.7）→ D14 单日多 ${formatMoyu(uplift)}（日收入 +${(100 * uplift / d14.dayIncome).toFixed(0)}%）`,
    );
    console.log(
      `  另外把「缺席代价」显性化（现在面板只显示结算了 8h，玩家不知道少来一次亏多少）：`,
    );
    console.log(
      `    ${base.toFixed(2)}h → 少来早班 ${morning.toFixed(2)}h（-${((base - morning) / base * 100).toFixed(0)}%）/ 少来午班 ${noon.toFixed(2)}h（-${((base - noon) / base * 100).toFixed(0)}%）/ 少来晚班 ${evening.toFixed(2)}h（-${((base - evening) / base * 100).toFixed(0)}%）`,
    );
    console.log(`    D14 换算：晚班缺席一次 = 少 ${formatMoyu(offline * 0.39)} 离线收益（日收入 ${(0.39 * offline / d14.dayIncome * 100).toFixed(0)}%）`);
    expect(uplift / d14.dayIncome).toBeGreaterThan(0.3);
    expect((base - evening) / base).toBeGreaterThan(0.35);
  });

  it("最少改动方案③：日报/streak 长线化（目标缩放 + 里程碑永久加成）", () => {
    const d7 = byDay(7);
    const d14 = last;
    console.log("\n===== 建议③：日报/streak =====");
    console.log(
      `  现状：奖励 = max(500, 60×挂机率) = 60 秒挂机；D7 ${formatMoyu(d7.daily!.reward)}（${(d7.dailyRewardRatio * 100).toFixed(2)}% 日收入）、D14 ${formatMoyu(d14.daily!.reward)}（${(d14.dailyRewardRatio * 100).toFixed(3)}%）`,
    );
    console.log(`  现状：目标池只有 4 个模板选 3，14 天里「买 3 级」出现 12 次、「点 100 下」13 次；D14 因升级太贵，3 分钟内只买得起 2 次 → 首次 3/3 拖到 12:30`);
    const big = Math.max(500, 1800 * d14.idleRate); // 30 分钟挂机
    console.log(`  改法 a：奖励改 max(500, 1800×挂机率)（30 分钟挂机）→ D14 = ${formatMoyu(big)}（日收入 ${(100 * big / d14.dayIncome).toFixed(1)}%，×${(big / d14.daily!.reward).toFixed(0)}）`);
    console.log(`  改法 b：目标池扩到 8 个并按经济缩放（买 3 级→买 1 级 / 花余额 20%），3 分钟内可完成率回到 14/14（现在 13/14）`);
    console.log(`  改法 c：streak 3/7/14 天各发「离线效率 +0.05 永久」→ D7 满签 +7% 离线收入，D14 满签 +0.15（0.7→0.85，+21% 离线）`);
    console.log(
      `    D14 断签代价 = 永久少 ${formatMoyu((d14.offlineEarned / 0.85) * 0.15)} 离线/天（= 日收入 ${((d14.offlineEarned / 0.85) * 0.15 / d14.dayIncome * 100).toFixed(0)}%）→ 把「streak 14」变成有数值的损失厌恶目标`,
    );
    expect(big / d14.daily!.reward).toBeGreaterThan(20);
  });

  it("最少改动方案④：图鉴最后一格不锁在点击线上", () => {
    console.log("\n===== 建议④：图鉴 43/55 死锁 =====");
    console.log(
      `  现状：理性玩家 ${last.collection}/${TOTAL_ITEMS} 永久封顶（10 语录 + 30 挂机彩蛋 + 3 点击线 Lv1 彩蛋）；剩 12 格全是点击线 Lv5/10/20/50`,
    );
    console.log(
      `  但点击力 ${last.clickPower} vs 挂机 ${formatMoyu(last.idleRate)}/s → 点 1 下 = ${(last.clickPower / last.idleRate).toExponential(1)} 秒挂机收益，买点击线纯亏 → 12 格永远拿不到`,
    );
    const clicksPerDay = Math.round(bot.days.reduce((a, d) => a + d.clicks, 0) / bot.days.length);
    console.log(`  改法：把这 12 格改成「累计点击次数」档（500 / 3000 / 8000 / 20000 次，3 条点击线各一套）`);
    console.log(
      `    实测每天点击 ${clicksPerDay} 次（2cps × 3 分钟 × 3 次）→ 500 次 D1、3000 次 D3、8000 次 D8、20000 次 D19：把 4 格/线的解锁日铺到 D1/D3/D8/D19，直接补住 D6-D14 空窗`,
    );
    console.log(`    （兜底方案：档位降到 Lv3/5/8/10，总价 672万 → 约 1.4万，收集党 D2 就能收满，但内容池会更早见底）`);
    console.log(
      `  同时补「55/55 终奖」：挂机 ×1.2 永久 → D14 日收入 +20%（${formatMoyu(last.dayIncome * 0.2)}），给收集一个数值终点`,
    );
    expect(clicksPerDay).toBeGreaterThan(1000);
    expect(last.clickPower).toBeLessThan(10);
  });
});
