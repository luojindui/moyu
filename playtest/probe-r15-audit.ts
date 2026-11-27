// R15 审计党探针 v2：摸鱼站引擎/存档净化/判定边界 + 规格对比
// 运行：npx vite-node playtest/probe-r15-audit.ts
// 审计快照：HEAD 14057dc（fix(batch4 P1)），src 在审计期间被并发修改过（见最终报告）
import { initialState, gain } from "../src/engine/state";
import {
  ARCADE_DAILY_LIMIT,
  EARLY_FLOOR,
  GAMES,
  MAX_SCORE,
  REF_SCORE,
  TARGET_IDLE_SECONDS,
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
const NOW = 1795948800000;
const fresh = () => ({ ...gain(initialState(), 0), arcade: emptyArcade(TODAY) });

/* ---------- 1) 奖励：规格公式 vs 现行实现 ---------- */
{
  const specFormula = (idle: number, score: number): number => Math.floor((idle * 0.6 + 20) * (score / 100));
  const implFormula = (idle: number, score: number): number => {
    const capped = Math.min(score, MAX_SCORE);
    const ratio = Math.min(1, capped / REF_SCORE);
    return Math.max(Math.floor(idle * TARGET_IDLE_SECONDS * ratio), Math.ceil(EARLY_FLOOR * ratio));
  };
  const table: Array<{ idle: number; score: number; spec: number; impl: number; got: number }> = [];
  for (const idle of [0.2, 1, 10.2, 1000]) {
    for (const score of [0, 1, 100, 300, 600, 1000]) {
      const r = finishGame(fresh(), "rhythm", score, idle);
      table.push({ idle, score, spec: score > 0 ? specFormula(idle, score) : 0, impl: score > 0 ? implFormula(idle, score) : 0, got: r!.reward });
    }
  }
  out.rewardTable = table;
  const allMatchImpl = table.every((t) => t.got === t.impl);
  const anySpecMismatch = table.some((t) => t.got !== t.spec);
  check("实现与注释公式一致（idle*25*ratio，含 EARLY_FLOOR 保底）", allMatchImpl, JSON.stringify(table.slice(0, 4)));
  check("与批次4规格公式不符（规格= floor((idle*0.6+20)*score/100)）", anySpecMismatch, JSON.stringify(table.filter((t) => t.got !== t.spec).slice(0, 6)));

  const r600 = finishGame(fresh(), "rhythm", 600, 1000)!;
  check("满分(600 分)奖励 = 25 秒挂机收益（idle=1000 → 25000）", r600.reward === 25000, `got=${r600.reward}`);
  const rEarly = finishGame(fresh(), "rhythm", 600, 0.2)!;
  check("早期保底：idle=0.2 满分 = EARLY_FLOOR=30", rEarly.reward === 30, `got=${rEarly.reward}`);
  const rZero = finishGame(fresh(), "coffee", 0, 1000)!;
  check("0 分：消耗次数、奖励 0、不写 best", rZero.reward === 0 && rZero.state.arcade.played === 1 && rZero.state.arcade.best.coffee === undefined, "");
  for (const bad of [Infinity, -Infinity, NaN, -5]) {
    const rb = finishGame(fresh(), "coffee", bad as number, 100)!;
    check(`非法分 ${String(bad)}：按 0 处理并消耗次数`, rb !== null && rb.reward === 0 && rb.state.arcade.played === 1, "");
  }
  const rCap = finishGame(fresh(), "rhythm", 1e9, 1000)!;
  out.scoreCap = { MAX_SCORE, REF_SCORE, bestOn1e9: rCap.state.arcade.best.rhythm, rewardOn1e9: rCap.reward };
  check("MAX_SCORE=2000 生效：1e9 分 → best=2000、ratio 封顶", rCap.state.arcade.best.rhythm === MAX_SCORE && rCap.reward === 25000, JSON.stringify(out.scoreCap));
  // best 只增不减
  let s2 = finishGame(fresh(), "coffee", 120, 100)!.state;
  s2 = finishGame(s2, "coffee", 30, 100)!.state;
  check("best 只增不减", s2.arcade.best.coffee === 120 && s2.arcade.played === 2, "");
}

/* ---------- 2) 次数封顶 / 跨游戏共享 / 跨日 ---------- */
{
  let s = fresh();
  s = finishGame(s, "coffee", 50, 100)!.state;
  check("play1 played=1 left=2", s.arcade.played === 1 && arcadeLeft(s) === 2, "");
  s = finishGame(s, "findboss", 50, 100)!.state;
  check("跨游戏共享次数", s.arcade.played === 2 && arcadeLeft(s) === 1, "");
  s = finishGame(s, "rhythm", 50, 100)!.state;
  check("play3 played=3 left=0", s.arcade.played === 3 && arcadeLeft(s) === 0, "");
  check("第 4 次返回 null（封顶）", finishGame(s, "coffee", 50, 100) === null, "");
  check("第 5 次仍 null", finishGame(s, "findboss", 9999, 1e6) === null, "");
  const preCapped = { ...fresh(), arcade: { date: TODAY, played: 3, best: {} } };
  check("played=3 预置档立即 null", finishGame(preCapped, "coffee", 50, 100) === null, "");
  const next = ensureArcade(s, "2026-11-28");
  check("跨日重置次数、保留 best", next.arcade.played === 0 && next.arcade.best.rhythm === 50 && next.arcade.date === "2026-11-28", "");
  check("ensureArcade 同日幂等（同引用）", ensureArcade(next, "2026-11-28") === next, "");
  check("GAMES 均为 30 秒", GAMES.every((g) => g.duration === 30) && GAMES.length === 3, "");
}

/* ---------- 3) 判定边界 ---------- */
{
  const drops = [{ id: 0, at: 10, x: 0.5 }];
  check("接咖啡 +0.3199 命中 / +0.3201 不命中", judgeCatch(drops, 10.3199, 0.5).hit?.id === 0 && judgeCatch(drops, 10.3201, 0.5).hit === null, "");
  check("接咖啡 -0.3199 命中 / -0.3201 不命中", judgeCatch(drops, 9.6801, 0.5).hit?.id === 0 && judgeCatch(drops, 9.6799, 0.5).hit === null, "");
  check("横向 ±0.13 边界内/外", judgeCatch(drops, 10, 0.63).hit?.id === 0 && judgeCatch(drops, 10, 0.6301).hit === null, "");
  const two = [{ id: 0, at: 10, x: 0.5 }, { id: 1, at: 10.5, x: 0.5 }];
  check("多掉落取最近", judgeCatch(two, 10.2, 0.5).hit?.id === 0 && judgeCatch(two, 10.4, 0.5).hit?.id === 1, "");
  check("负数/NaN tapAt 不崩", judgeCatch(drops, -100, 0.5).hit === null && judgeCatch(drops, NaN, 0.5).hit === null, "");
  out.floatBoundary = {
    note: "浮点表示导致字面精确边界偏向外侧（10.32-10=0.3200000000000003 → 不命中；10.08-10=0.08000000000000007 → good），对真人输入无实际影响",
    exactCatch: judgeCatch(drops, 10.32, 0.5).hit === null ? "miss" : "hit",
  };

  const beats = [10, 10.5];
  const u = () => new Set<number>();
  check("节奏 perfect/good/miss 区间", judgeBeat(beats, 10.05, u()).kind === "perfect" && judgeBeat(beats, 10.1, u()).kind === "good" && judgeBeat(beats, 10.15, u()).kind === "good" && judgeBeat(beats, 10.17, u()).kind === "miss", "");
  const used = new Set<number>();
  const first = judgeBeat(beats, 10.01, used);
  used.add(first.index);
  const second = judgeBeat(beats, 10.01, used);
  check("同一节拍二次点击不重复得分", first.kind === "perfect" && second.kind === "miss" && second.index === -1, `first=${first.kind}/${first.score} second=${second.kind}`);
  check("节奏负数/NaN tapAt 不崩", judgeBeat(beats, -50, u()).kind === "miss" && judgeBeat(beats, NaN, u()).kind === "miss", "");
  check("empty beats → miss", judgeBeat([], 1, u()).kind === "miss", "");
  out.rhythm = { beatCount: genBeats(30, 120, 0.6).length, perfectScore: judgeBeat([10], 10, new Set()).score, specSaysPerfectExtra: 5 };
}

/* ---------- 4) 三游戏理论上限 vs REF_SCORE / MAX_SCORE ---------- */
{
  let seed = 42;
  const rng = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 4294967296);
  const drops = genDrops(30, rng);
  const coffeeMax = coffeeScore(drops.length, 0, drops.length);
  const rhythmMax = genBeats(30, 120, 0.6).length * 20; // 全 perfect、无额外 +5
  // 找老板：30s 内每次点击正确得 50，结束剩余时间=0 → 分数 = 点击数*50（可轻松 > REF_SCORE）
  out.scoreCeilings = {
    coffee: { drops: drops.length, maxScore: coffeeMax },
    rhythm: { beats: genBeats(30, 120, 0.6).length, maxScore: rhythmMax },
    findboss: { maxScore: "unbounded（30s 内点击数×50，封顶 MAX_SCORE=2000）" },
    REF_SCORE,
    MAX_SCORE,
  };
  check("接咖啡理论上限 560 < REF_SCORE 600（永远打不满）", coffeeMax < REF_SCORE, `coffee max=${coffeeMax} (本局 rng 掉 ${drops.length} 个)`);
  check("节奏满分 ≥ REF_SCORE 但远小于 2×（600 分即饱和）", rhythmMax >= REF_SCORE && rhythmMax < REF_SCORE * 2, `rhythm max=${rhythmMax}`);
}

/* ---------- 5) 找老板计分：结束时剩余时间恒为 0 ---------- */
{
  check("findScore 线性（+50/-20/剩余 0.1s+1）", findScore(3, 1, 0) === 130 && findScore(5, 0, 29.9) === 549, "");
  check("结束时按剩余 0 秒结算 → 时间奖励分恒为 0", findScore(5, 0, 0) === 250, `got=${findScore(5, 0, 0)}`);
  check("负剩余时间不产生负分", findScore(1, 0, -100) === 0, "");
  const rounds = genFindRounds(5, 3, rngFactory());
  check("genFindRounds 兼容（旧 API 仍在，UI 已不用）", rounds.length === 5 && rounds.every((r) => r.bossAt >= 0 && r.bossAt <= 8), "");
}
function rngFactory(): () => number {
  let s = 7;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
}

/* ---------- 6) 咖啡计分（现改为下限 0） ---------- */
{
  check("coffeeScore 下限 0（(0,20,0)=0，规格漏接 -2 的负分被抹平）", coffeeScore(0, 20, 0) === 0, `got=${coffeeScore(0, 20, 0)}`);
  check("接住 10 个无 combo = 100 / 漏接 5 个 = 90", coffeeScore(10, 0, 0) === 100 && coffeeScore(10, 5, 0) === 90, "");
  check("combo 满档 ×2", coffeeScore(10, 0, 20) === 200 && coffeeScore(10, 0, 100) === 200, "");
  check("combo ×1.05 取整（1 个 → 10）", coffeeScore(1, 0, 1) === 10, `got=${coffeeScore(1, 0, 1)}`);
  // 掉落间隔：0.8 + rng*0.55
  let seed = 42;
  const rng = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 4294967296);
  const drops = genDrops(30, rng);
  out.drops = { count: drops.length, first: drops[0], last: drops[drops.length - 1], minGap: "0.8s" };
  check("掉落递增、在时长内、x∈[0.12,0.88]", drops.every((d, i) => i === 0 || d.at > drops[i - 1]!.at) && drops.every((d) => d.at > 0 && d.at < 29.5 && d.x >= 0.12 && d.x <= 0.88), `count=${drops.length}`);
  check("genDrops(0)/负时长 → 空", genDrops(0, rng).length === 0 && genDrops(-5, rng).length === 0, "");
  check("genBeats 负数 offset 会产生负时间（裸调边界，UI 不触发）", genBeats(2, 120, -0.4)[0]! < 0, JSON.stringify(genBeats(2, 120, -0.4)));
}

/* ---------- 7) 存档净化（save.ts 未变，逐项回归） ---------- */
{
  const base = (extra: Record<string, unknown>): Record<string, unknown> => ({
    v: 2, moyu: 100, totalEarned: 100, lifetimeEarned: 100, levels: {}, savedAt: NOW - 1000, createdAt: NOW - 1000, ...extra,
  });
  const mem = (obj: Record<string, unknown>): SaveAdapter => {
    const raw = JSON.stringify(obj);
    const store = new Map<string, string>([["moyu-save", raw]]);
    return { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) };
  };
  const arc = (a: unknown): any => restore(mem(base({ arcade: a })), NOW).state!.arcade;
  const sane = {
    absent: arc(undefined), null: arc(null), array: arc([]), string: arc("ghost"),
    badDate: arc({ date: "2026-1-1", played: 0, best: {} }),
    okDate: arc({ date: TODAY, played: 0, best: {} }),
    played99: arc({ date: TODAY, played: 99, best: {} }),
    playedNeg: arc({ date: TODAY, played: -5, best: {} }),
    playedFrac: arc({ date: TODAY, played: 2.9, best: {} }),
    playedStr: arc({ date: TODAY, played: "2", best: {} }),
    bestGhost: arc({ date: TODAY, played: 0, best: { ghost: 1e9 } }),
    bestHuge: arc({ date: TODAY, played: 0, best: { coffee: 1e9, findboss: 9999.9, rhythm: 12.7 } }),
    bestNeg: arc({ date: TODAY, played: 0, best: { coffee: -3 } }),
    bestStr: arc({ date: TODAY, played: 0, best: { coffee: "50" } }),
    bestNull: arc({ date: TODAY, played: 0, best: null }),
    bestNum: arc({ date: TODAY, played: 0, best: 42 }),
    proto: arc(JSON.parse('{"date":"2026-11-27","played":0,"best":{"__proto__":{"polluted":1},"coffee":10}}')),
    pollution: ({} as Record<string, unknown>).polluted ?? "none",
  };
  out.sanitize = sane;
  check("arcade 缺失/null/数组/字符串 → 空档", [sane.absent, sane.null, sane.array, sane.string].every((x) => JSON.stringify(x) === JSON.stringify({ date: "", played: 0, best: {} })), "");
  check("date 正则：非法拒绝、合法保留", sane.badDate.date === "" && sane.okDate.date === TODAY, JSON.stringify([sane.badDate.date, sane.okDate.date]));
  check("played 钳制 0-3（99→3、-5→0、2.9→2、字符串→0）", sane.played99.played === 3 && sane.playedNeg.played === 0 && sane.playedFrac.played === 2 && sane.playedStr.played === 0, "");
  check("best 只认已知游戏（ghost 丢弃）", JSON.stringify(sane.bestGhost.best) === "{}", "");
  check("best 上限 9999 且向下取整", sane.bestHuge.best.coffee === 9999 && sane.bestHuge.best.findboss === 9999 && sane.bestHuge.best.rhythm === 12, JSON.stringify(sane.bestHuge.best));
  check("best 负数/字符串/null/数字容器忽略", [sane.bestNeg, sane.bestStr, sane.bestNull, sane.bestNum].every((x) => JSON.stringify(x.best) === "{}"), "");
  check("原型污染防护（best.__proto__ 不污染）", sane.pollution === "none" && JSON.stringify(sane.proto.best) === JSON.stringify({ coffee: 10 }), JSON.stringify(sane.proto));
  check("净化上限 9999 与引擎 MAX_SCORE=2000 不一致（save 允许 >2000 的 best 原样保留）", (() => {
    const a = arc({ date: TODAY, played: 0, best: { coffee: 5000 } });
    return a.best.coffee === 5000 && MAX_SCORE === 2000;
  })(), JSON.stringify({ saveCap: 9999, engineCap: MAX_SCORE }));

  let state = fresh();
  state = finishGame(state, "coffee", 321, 100)!.state;
  const mem2 = mem({ v: 1 });
  serialize(state, mem2, NOW);
  const back = restore(mem2, NOW + 500).state!;
  check("serialize→restore 保留 arcade（date/played/best）", JSON.stringify(back.arcade) === JSON.stringify(state.arcade), "");
}

/* ---------- 8) 输出 ---------- */
out.results = results;
out.failed = results.filter((r) => !r.pass).map((r) => `${r.name} :: ${r.detail}`);
out.summary = { total: results.length, passed: results.length - out.failed.length, failed: out.failed.length };
console.log(JSON.stringify(out, null, 2));
process.exitCode = out.failed.length ? 1 : 0;