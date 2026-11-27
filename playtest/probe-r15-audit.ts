// R15 审计党探针：摸鱼站引擎/存档净化/判定边界（只读，不改 src）
// 运行：npx vite-node playtest/probe-r15-audit.ts
import { initialState, gain } from "../src/engine/state";
import {
  ARCADE_DAILY_LIMIT,
  GAMES,
  arcadeLeft,
  coffeeScore,
  emptyArcade,
  ensureArcade,
  finishGame,
  findScore,
  genBeats,
  genDrops,
  genFindRounds,
  judgeBeat,
  judgeCatch,
} from "../src/engine/minigames";
import { restore, serialize, type SaveAdapter } from "../src/engine/save";

const out: Record<string, unknown> = {};
const results: Array<{ name: string; pass: boolean; detail: string }> = [];
function check(name: string, pass: boolean, detail = ""): void {
  results.push({ name, pass, detail });
}

const TODAY = "2026-11-27";
const NOW = 1795948800000; // 2026-11-27T00:00:00Z 附近
const fresh = (): ReturnType<typeof initialState> => ({ ...gain(initialState(), 0), arcade: emptyArcade(TODAY) });

/* ---------------- 1) 奖励公式 ---------------- */
{
  const idle = 1000;
  const s = fresh();
  const r = finishGame(s, "coffee", 120, idle)!;
  const expected = Math.floor((idle * 0.6 + 20) * (120 / 100));
  check("reward formula idle=1000 score=120", r.reward === expected, `got=${r.reward} expected=${expected}`);
  check(
    "reward books moyu/totalEarned/lifetimeEarned",
    r.state.moyu === s.moyu + expected &&
      r.state.totalEarned === s.totalEarned + expected &&
      r.state.lifetimeEarned === s.lifetimeEarned + expected,
    `moyu=${r.state.moyu}`,
  );
  check("best recorded", r.state.arcade.best.coffee === 120, `best=${r.state.arcade.best.coffee}`);

  // 规格公式 floor((idle*0.6+20) * score / 100) vs 实现的 floor(rate * (score/100))
  // 浮点结合顺序差异是否造成 ±1
  let mism = 0;
  const samples: string[] = [];
  let seed = 1234567;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const rates = [0.2, 1, 5.2, 10.2, 13.333333, 99.9, 1000, 12345.678];
  for (const idleRate of rates) {
    const rate = idleRate * 0.6 + 20;
    for (let score = 1; score <= 9999; score++) {
      const impl = Math.floor(rate * (score / 100));
      const spec = Math.floor((rate * score) / 100);
      if (impl !== spec) {
        mism++;
        if (samples.length < 3) samples.push(`idle=${idleRate} score=${score} impl=${impl} spec=${spec}`);
      }
    }
  }
  for (let i = 0; i < 20000; i++) {
    const score = 1 + Math.floor(rnd() * 9999);
    const idleRate = rnd() * 1e6;
    const rate = idleRate * 0.6 + 20;
    const impl = Math.floor(rate * (score / 100));
    const spec = Math.floor((rate * score) / 100);
    if (impl !== spec) {
      mism++;
      if (samples.length < 3) samples.push(`rand idle=${idleRate} score=${score}`);
    }
  }
  check("reward 浮点结合顺序与规格公式一致（±1 检查）", mism === 0, `mismatch=${mism} ${samples.join(" | ")}`);
}

/* ---------------- 2) 次数/上限/重复 finish ---------------- */
{
  let s = fresh();
  s = finishGame(s, "coffee", 50, 100)!.state;
  check("play1 played=1 left=2", s.arcade.played === 1 && arcadeLeft(s) === 2, "");
  s = finishGame(s, "findboss", 50, 100)!.state; // 跨游戏共享
  check("play2 跨游戏共享次数", s.arcade.played === 2 && arcadeLeft(s) === 1, `played=${s.arcade.played}`);
  s = finishGame(s, "rhythm", 50, 100)!.state;
  check("play3 played=3 left=0", s.arcade.played === 3 && arcadeLeft(s) === 0, "");
  const fourth = finishGame(s, "coffee", 50, 100);
  check("第4次返回 null（封顶）", fourth === null, `got=${JSON.stringify(fourth)}`);
  const fifth = finishGame(s, "findboss", 9999, 1e6);
  check("第5次仍 null", fifth === null, "");
  // 预置已满档直接 null
  const capped = { ...fresh(), arcade: { date: TODAY, played: 3, best: {} } };
  check("played=3 预置档立即 null", finishGame(capped, "coffee", 50, 100) === null, "");
}

/* ---------------- 3) 0 分 / 非法分数 / 上限 ---------------- */
{
  const s = fresh();
  const r0 = finishGame(s, "coffee", 0, 100)!;
  check("0 分：消耗次数、奖励 0", r0.reward === 0 && r0.state.arcade.played === 1, `played=${r0.state.arcade.played}`);
  check("0 分：不写 best", r0.state.arcade.best.coffee === undefined, `best=${JSON.stringify(r0.state.arcade.best)}`);
  for (const bad of [Infinity, -Infinity, NaN, -5]) {
    const rb = finishGame(fresh(), "coffee", bad as number, 100)!;
    check(`非法分 ${String(bad)}：按 0 处理并消耗次数`, rb !== null && rb.reward === 0 && rb.state.arcade.played === 1, "");
  }
  const rBig = finishGame(fresh(), "rhythm", 1e9, 1000)!;
  const expBig = Math.floor((1000 * 0.6 + 20) * (9999 / 100));
  check("分数上限：best 截到 9999、奖励按 9999 算", rBig.state.arcade.best.rhythm === 9999 && rBig.reward === expBig, `best=${rBig.state.arcade.best.rhythm} reward=${rBig.reward} exp=${expBig}`);
  // best 只增不减
  let s2 = finishGame(fresh(), "coffee", 120, 100)!.state;
  s2 = finishGame(s2, "coffee", 30, 100)!.state;
  check("best 只增不减", s2.arcade.best.coffee === 120, `best=${s2.arcade.best.coffee}`);
  // played 不被外部分数污染
  check("played 只 +1", s2.arcade.played === 2, "");
}

/* ---------------- 4) 跨日/ensureArcade ---------------- */
{
  let s = finishGame(fresh(), "coffee", 80, 100)!.state;
  const next = ensureArcade(s, "2026-11-28");
  check("跨日重置次数、保留 best", next.arcade.played === 0 && next.arcade.best.coffee === 80 && next.arcade.date === "2026-11-28", "");
  check("ensureArcade 同日幂等（同引用）", ensureArcade(next, "2026-11-28") === next, "");
  check("跨日后可再玩 3 次", arcadeLeft(next) === ARCADE_DAILY_LIMIT, "");
  check("GAMES 时长/次数", GAMES.every((g) => g.duration === 30) && GAMES.length === 3, JSON.stringify(GAMES.map((g) => [g.id, g.duration, g.dailyLimit])));
}

/* ---------------- 5) 接咖啡判定边界 ---------------- */
{
  const drops = [{ id: 0, at: 10, x: 0.5 }];
  check("+0.3199 边界内命中", judgeCatch(drops, 10.3199, 0.5).hit?.id === 0, "");
  check("+0.3201 不命中", judgeCatch(drops, 10.3201, 0.5).hit === null, "");
  check("-0.3199 边界内命中", judgeCatch(drops, 9.6801, 0.5).hit?.id === 0, "");
  check("-0.3201 不命中", judgeCatch(drops, 9.6799, 0.5).hit === null, "");
  // 浮点边界注记：10.32-10 = 0.3200000000000003 > 0.32，字面精确边界实为「不命中」
  out.floatBoundary = {
    catchAtExact: judgeCatch(drops, 10.32, 0.5).hit === null ? "exact 0.32 → miss（浮点表示 0.3200000000000003）" : "hit",
  };
  check("纵向 ±0.13 边界内命中", judgeCatch(drops, 10, 0.63).hit?.id === 0, "");
  check("纵向 0.1301 不命中", judgeCatch(drops, 10, 0.6301).hit === null, "");
  const two = [
    { id: 0, at: 10, x: 0.5 },
    { id: 1, at: 10.5, x: 0.5 },
  ];
  check("多掉落取最近", judgeCatch(two, 10.2, 0.5).hit?.id === 0 && judgeCatch(two, 10.4, 0.5).hit?.id === 1, "");
  check("负数 tapAt 不崩（返回 null）", judgeCatch(drops, -100, 0.5).hit === null, "");
  check("空掉落列表返回 null", judgeCatch([], 1, 0.5).hit === null, "");
  check("NaN tapAt 不命中", judgeCatch(drops, NaN, 0.5).hit === null, "");
}

/* ---------------- 6) 节奏判定边界 ---------------- */
{
  const beats = [10, 10.5];
  const u = (): Set<number> => new Set<number>();
  check("perfect（+0.05）", judgeBeat(beats, 10.05, u()).kind === "perfect", "");
  check("good（+0.10）", judgeBeat(beats, 10.1, u()).kind === "good", "");
  check("good（+0.15）", judgeBeat(beats, 10.15, u()).kind === "good", "");
  check("miss（+0.17）", judgeBeat(beats, 10.17, u()).kind === "miss", "");
  // 浮点边界注记：10.08-10 = 0.08000000000000007 > 0.08
  out.floatBoundary = { ...(out.floatBoundary as object), beatAtExact: `${judgeBeat(beats, 10.08, u()).kind}（10.08-10=0.08000000000000007）`, beatGoodExact: `${judgeBeat(beats, 10.16, u()).kind}（10.16-10=0.16000000000000014）` };
  check("负数 tapAt 不崩", judgeBeat(beats, -50, u()).kind === "miss", "");
  // 重复点同一节拍：已用集合阻止二次得分
  const used = new Set<number>();
  const first = judgeBeat(beats, 10.01, used);
  used.add(first.index);
  const second = judgeBeat(beats, 10.01, used);
  check(
    "同一节拍二次点击不会重复得分",
    first.kind === "perfect" && second.kind === "miss" && second.index === -1,
    `first=${first.kind}/${first.score} second=${second.kind}/${second.index}`,
  );
  // 双押最近未用节拍：10.0 与 10.46 各命中一个（0.5s 间隔 > 窗口不重叠）
  const u2 = new Set<number>();
  const a = judgeBeat(beats, 10.02, u2);
  u2.add(a.index);
  const b = judgeBeat(beats, 10.48, u2);
  check("两次点击分别命中两个节拍（不重复）", a.index === 0 && b.index === 1 && b.kind === "perfect", `a=${a.index} b=${b.index}`);
  check("空节拍 miss", judgeBeat([], 1, u()).kind === "miss", "");
  check("NaN tapAt 不崩", judgeBeat(beats, NaN, u()).kind === "miss", "");

  const beatsReal = genBeats(30, 120, 0.6);
  const at = { count: beatsReal.length, first: beatsReal[0], last: beatsReal[beatsReal.length - 1] };
  out.rhythmBeats = at;
  const perfectAll = beatsReal.length * 20 + beatsReal.length * 5;
  out.rhythmMaxScore = perfectAll; // 全 perfect（含规格的 perfect 额外 +5）
}

/* ---------------- 7) 找老板计分边界 ---------------- */
{
  check("5 正确 + 剩余 29.9s", findScore(5, 0, 29.9) === 549, `got=${findScore(5, 0, 29.9)}`);
  check("0 正确 5 错误 + 剩余 29.9s", findScore(0, 5, 29.9) === 199, `got=${findScore(0, 5, 29.9)}`);
  check("负剩余时间不产生负分（下限 0）", findScore(0, 5, -100) === 0 && findScore(1, 0, -100) === 0, "");
  check("正确+50/错误-20 线性", findScore(3, 1, 0) === 130 && findScore(1, 1, 0) === 30, "");
  const rounds = genFindRounds(5, 3, (() => {
    let s = 7;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
  })());
  check("找老板 5 轮、格子在 0-8", rounds.length === 5 && rounds.every((r) => r.bossAt >= 0 && r.bossAt <= 8 && r.size === 3), JSON.stringify(rounds.map((r) => r.bossAt)));
}

/* ---------------- 8) 掉落/节拍生成 ---------------- */
{
  let seed = 42;
  const rng = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 4294967296);
  const drops = genDrops(30, rng);
  out.drops = { count: drops.length, first: drops[0], last: drops[drops.length - 1] };
  check("掉落递增、范围内、x∈[0.12,0.88]", drops.every((d, i) => i === 0 || d.at > drops[i - 1]!.at) && drops.every((d) => d.at > 0 && d.at < 29.5 && d.x >= 0.12 && d.x <= 0.88), `count=${drops.length}`);
  check("genDrops 时长为 0 → 空", genDrops(0, rng).length === 0, "");
  check("genDrops 负时长 → 空", genDrops(-5, rng).length === 0, "");
  check("genBeats 负数 offset 会产出负时间（仅引擎裸调时）", genBeats(2, 120, -0.4)[0]! < 0, JSON.stringify(genBeats(2, 120, -0.4)));
  check("genBeats 时长为 0 → 空", genBeats(0, 120, 0.6).length === 0, "");
}

/* ---------------- 9) 接咖啡计分 ---------------- */
{
  check("接住 10 个无 combo = 100", coffeeScore(10, 0, 0) === 100, "");
  check("漏接 5 个 -10", coffeeScore(10, 5, 0) === 90, "");
  check("combo 满档 ×2（maxCombo≥20）", coffeeScore(10, 0, 20) === 200 && coffeeScore(10, 0, 100) === 200, "");
  check("combo ×1.05（maxCombo=1）→ 取整", coffeeScore(1, 0, 1) === 10, `got=${coffeeScore(1, 0, 1)}`);
  check("负分存在（UI 在结算时 clamp 0）", coffeeScore(0, 3, 0) === -6, `got=${coffeeScore(0, 3, 0)}`);
  out.coffeeMaxScore = coffeeScore(37, 0, 37); // 完美接住全部 37 个（combo 封顶 ×2）
}

/* ---------------- 10) 咖啡 UI 渲染/漏接逻辑复现（静态复现 arcade.ts tick） ---------------- */
{
  let seed = 42;
  const rng = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 4294967296);
  const drops = genDrops(30, rng);
  const FRAME = 1000 / 60;
  let lastIdx = -1;
  const used = new Set<number>();
  const created: Array<{ id: number; at: number; addElapsedMs: number; topPct: number; removeElapsedMs: number | null }> = [];
  const domIds = new Set<number>();
  let missed = 0;
  const missesTriggeredAt: number[] = [];
  const tick = (elapsed: number): void => {
    const visible = drops.filter((d) => d.at > elapsed - 0.4 && d.at < elapsed + 3);
    for (const d of visible) {
      if (used.has(d.id) || d.id <= lastIdx) continue;
      const left = (d.at - elapsed) / 3;
      if (left < 0) {
        if (!used.has(d.id)) {
          used.add(d.id);
          missed++;
          missesTriggeredAt.push(elapsed);
        }
        continue;
      }
      const el = { id: d.id, at: d.at, addElapsedMs: elapsed * 1000, topPct: Math.max(0, left * 100), removeElapsedMs: null as number | null };
      created.push(el);
      domIds.add(d.id);
      // setTimeout(() => el.remove(), 400)
      el.removeElapsedMs = elapsed * 1000 + 400;
    }
    if (visible.length) lastIdx = Math.max(lastIdx, visible[visible.length - 1]!.id);
  };
  for (let ms = 0; ms <= 30_000; ms += FRAME) tick(ms / 1000);
  const lifetimes = created.map((c) => (c.removeElapsedMs ?? 0) - c.addElapsedMs);
  const beforeArrival = created.map((c) => {
    const arrivalMs = c.at * 1000;
    return { id: c.id, arrivalMs: Math.round(arrivalMs), removedAtMs: Math.round(c.removeElapsedMs ?? 0), removedBeforeArrivalMs: Math.round(arrivalMs - (c.removeElapsedMs ?? 0)) };
  });
  out.coffeeTick = {
    drops: drops.length,
    domCreated: created.length,
    missedCounter: missed,
    missesTriggeredAt,
    dropLifetimeMsRange: [Math.min(...lifetimes), Math.max(...lifetimes)],
    first4: beforeArrival.slice(0, 4),
    last: beforeArrival[beforeArrival.length - 1],
    createdCountEqualsDrops: created.length === drops.length,
  };
  check("复现：漏接计数永远为 0（left<0 分支不可达）", missed === 0, `missed=${missed} triggeredAt=${JSON.stringify(missesTriggeredAt)}`);
  check("复现：每个掉落 DOM 只存在 400ms，且都在其判定时刻前消失（≥300ms）", lifetimes.every((l) => l <= 420) && beforeArrival.every((b) => b.removedBeforeArrivalMs >= 300), JSON.stringify(beforeArrival.slice(0, 2)));
  check("复现：判定时刻无任何可见掉落（DOM 已全部移除）", created.every((c) => (c.removeElapsedMs ?? 0) <= c.at * 1000), "");
}

/* ---------------- 11) 存档净化：arcade 边界 ---------------- */
{
  const nowMs = NOW;
  const base = (extra: Record<string, unknown>): Record<string, unknown> => ({
    v: 2,
    moyu: 100,
    totalEarned: 100,
    lifetimeEarned: 100,
    levels: {},
    savedAt: nowMs - 1000,
    createdAt: nowMs - 1000,
    ...extra,
  });
  const mem = (obj: Record<string, unknown> | string): SaveAdapter => {
    const raw = typeof obj === "string" ? obj : JSON.stringify(obj);
    const store = new Map<string, string>([["moyu-save", raw]]);
    return { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) };
  };
  const arc = (a: unknown): unknown => restore(mem(base({ arcade: a })), nowMs).state!.arcade;
  out.sanitize = {
    absent: arc(undefined),
    null: arc(null),
    array: arc([]),
    string: arc("ghost"),
    wrongShapes: {
      dateNum: arc({ date: 123, played: 0, best: {} }),
      badDate: arc({ date: "2026-1-1", played: 0, best: {} }),
      badDate2: arc({ date: "2026-11-27T00:00", played: 0, best: {} }),
      okDate: arc({ date: "2026-11-27", played: 0, best: {} }),
      played99: arc({ date: TODAY, played: 99, best: {} }),
      playedNeg: arc({ date: TODAY, played: -5, best: {} }),
      playedFrac: arc({ date: TODAY, played: 2.9, best: {} }),
      playedStr: arc({ date: TODAY, played: "2", best: {} }),
      bestGhost: arc({ date: TODAY, played: 0, best: { ghost: 1e9 } }),
      bestHuge: arc({ date: TODAY, played: 0, best: { coffee: 1e9, findboss: 9999.9, rhythm: 12.7 } }),
      bestNeg: arc({ date: TODAY, played: 0, best: { coffee: -3 } }),
      bestStr: arc({ date: TODAY, played: 0, best: { coffee: "50" } }),
      bestNull: arc({ date: TODAY, played: 0, best: null }),
      bestArray: arc({ date: TODAY, played: 0, best: [] }),
      bestNum: arc({ date: TODAY, played: 0, best: 42 }),
      proto: arc(JSON.parse('{"date":"2026-11-27","played":0,"best":{"__proto__":{"polluted":1},"coffee":10}}')),
    },
    pollution: ({} as Record<string, unknown>).polluted ?? "none",
  };
  const sanit = out.sanitize as Record<string, any>;
  check("arcade 缺失/null/数组/字符串 → 空档", JSON.stringify(sanit.absent) === JSON.stringify({ date: "", played: 0, best: {} }) && JSON.stringify(sanit.null) === JSON.stringify({ date: "", played: 0, best: {} }), JSON.stringify([sanit.absent, sanit.null, sanit.array, sanit.string]));
  check("date 正则：非法拒绝、合法保留", sanit.wrongShapes.badDate.date === "" && sanit.wrongShapes.badDate2.date === "" && sanit.wrongShapes.dateNum.date === "" && sanit.wrongShapes.okDate.date === "2026-11-27", JSON.stringify(sanit.wrongShapes.okDate));
  check("played 钳制 0-3（99→3、-5→0、2.9→2、字符串→0）", sanit.wrongShapes.played99.played === 3 && sanit.wrongShapes.playedNeg.played === 0 && sanit.wrongShapes.playedFrac.played === 2 && sanit.wrongShapes.playedStr.played === 0, JSON.stringify([sanit.wrongShapes.played99, sanit.wrongShapes.playedNeg, sanit.wrongShapes.playedFrac, sanit.wrongShapes.playedStr]));
  check("best 只认已知游戏（ghost 丢弃）", JSON.stringify(sanit.wrongShapes.bestGhost.best) === "{}", JSON.stringify(sanit.wrongShapes.bestGhost.best));
  check("best 上限 9999 且向下取整", sanit.wrongShapes.bestHuge.best.coffee === 9999 && sanit.wrongShapes.bestHuge.best.findboss === 9999 && sanit.wrongShapes.bestHuge.best.rhythm === 12, JSON.stringify(sanit.wrongShapes.bestHuge.best));
  check("best 负数/字符串/非法容器忽略", JSON.stringify(sanit.wrongShapes.bestNeg.best) === "{}" && JSON.stringify(sanit.wrongShapes.bestStr.best) === "{}" && JSON.stringify(sanit.wrongShapes.bestNull.best) === "{}" && JSON.stringify(sanit.wrongShapes.bestArray.best) === "{}" && JSON.stringify(sanit.wrongShapes.bestNum.best) === "{}", JSON.stringify([sanit.wrongShapes.bestNeg.best, sanit.wrongShapes.bestNull.best, sanit.wrongShapes.bestArray.best]));
  check("原型污染防护（best.__proto__ 不污染）", sanit.pollution === "none" && JSON.stringify(sanit.wrongShapes.proto.best) === JSON.stringify({ coffee: 10 }), JSON.stringify(sanit.wrongShapes.proto));

  // 存档 roundtrip
  let state = fresh();
  state = finishGame(state, "coffee", 321, 100)!.state;
  state = ensureArcade(state, "2026-11-26"); // 昨日日期，保证 date 原样保存
  const mem2 = mem({ v: 1 });
  serialize(state, mem2, nowMs);
  const back = restore(mem2, nowMs + 500).state!;
  check("serialize→restore 保留 arcade（date/played/best）", JSON.stringify(back.arcade) === JSON.stringify(state.arcade), `got=${JSON.stringify(back.arcade)} want=${JSON.stringify(state.arcade)}`);
}

/* ---------------- 12) 结论 ---------------- */
out.results = results;
out.failed = results.filter((r) => !r.pass).map((r) => `${r.name} :: ${r.detail}`);
console.log(JSON.stringify(out, null, 2));
process.exitCode = out.failed.length ? 1 : 0;