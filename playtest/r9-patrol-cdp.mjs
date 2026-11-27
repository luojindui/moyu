/**
 * R9 · 音游/节奏党 · 老板巡逻变体探针（CDP 变速快进到 90-150s 的巡逻窗口）。只读，不改 src/。
 * 关注：type/blitz 变体的"点击死区"（宽限 0.8s）、实际计数进度、达标/失败文案、2.5cps 够不够。
 *
 * 用法：node playtest/r9-patrol-cdp.mjs
 * 产出：playtest/r9-patrol-evidence.json、playtest/r9-rhythm-screens/r9-patrol-*.png
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openBrowser, setupMobilePage, waitForGame, sleep } from "./r9-cdp-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const INJECT = readFileSync(join(HERE, "r9-inject.js"), "utf8");
const EVIDENCE = join(HERE, "r9-patrol-evidence.json");
const SHOTS = join(HERE, "r9-rhythm-screens");
mkdirSync(SHOTS, { recursive: true });

const b = await openBrowser({ port: 9462, tag: "patrol" });
const out = { meta: {}, patrols: [], errors: [] };
try {
  await setupMobilePage(b, { injectSource: INJECT, url: "http://127.0.0.1:5173/" });
  const bootMs = await waitForGame(b);
  await sleep(1500);
  out.meta = { bootMs, viewport: "390x844 dpr3", clickPt: await b.ev("JSON.stringify(window.__r9.clickPoint())") };

  await b.ev("window.__MOYU__.reset(); 1");
  await sleep(1800);
  await b.ev(
    "window.__r9.patrols.length = 0; window.__r9.patrolBursts.length = 0; window.__r9.texts.length = 0; window.__r9.banners.length = 0; window.__r9.speed = 12; 1",
  );

  const huntStart = Date.now();
  const handled = new Set();
  const shotTaken = new Set();
  let blitzSeen = 0;
  let typeSeen = 0;
  let lastPatrolCount = 0;
  let followB = null;
  const actions = [];
  while (Date.now() - huntStart < 170000) {
    const boss = await b.evj("JSON.stringify(window.__r9.boss)");
    if (boss.active && boss.variant !== "hold" && !handled.has(boss.firstAt)) {
      handled.add(boss.firstAt);
      if (boss.variant === "type" && typeSeen === 0) {
        typeSeen++;
        const opts = { cps: 3, ms: 1600, jitter: 0.1 };
        actions.push({ variant: "type", firstAt: boss.firstAt, opts });
        await b.ev(`window.__r9.runBurst(${JSON.stringify(opts)}).then((r)=>{ window.__r9.patrolBursts.push({variant:"type", firstAt:${Math.round(boss.firstAt)}, stage:"A", opts:${JSON.stringify(opts)}, clicks: r.clicks.map((c)=>({t:c.t,dMoyu:c.dMoyu,dClicks:c.dClicks}))}); }); 1`);
        console.log("[patrol] type: 3cps 连点");
      } else if (boss.variant === "blitz") {
        blitzSeen++;
        const opts = { cps: 2.5, ms: 5000, jitter: 0.15 };
        actions.push({ variant: "blitz", firstAt: boss.firstAt, opts, stage: "A" });
        await b.ev(`window.__r9.runBurst(${JSON.stringify(opts)}).then((r)=>{ window.__r9.patrolBursts.push({variant:"blitz", firstAt:${Math.round(boss.firstAt)}, stage:"A", opts:${JSON.stringify(opts)}, clicks: r.clicks.map((c)=>({t:c.t,dMoyu:c.dMoyu,dClicks:c.dClicks}))}); }); 1`);
        followB = { firstAt: boss.firstAt };
        console.log("[patrol] blitz: 按题面 2.5cps 打 5.2s");
      }
      if (!shotTaken.has(boss.variant)) {
        shotTaken.add(boss.variant);
        await b.shot(join(SHOTS, `r9-patrol-${boss.variant}.png`));
      }
    }
    if (followB) {
      const bursts = await b.evj(
        "JSON.stringify(window.__r9.patrolBursts.map((x)=>({variant:x.variant,stage:x.stage,firstAt:x.firstAt})))",
      );
      if (bursts.some((x) => x.variant === "blitz" && x.stage === "A" && x.firstAt === Math.round(followB.firstAt))) {
        const opts = { cps: 12, ms: 2600, jitter: 0.1 };
        actions.push({ variant: "blitz", firstAt: followB.firstAt, opts, stage: "B" });
        await b.ev(`window.__r9.runBurst(${JSON.stringify(opts)}).then((r)=>{ window.__r9.patrolBursts.push({variant:"blitz", firstAt:${Math.round(followB.firstAt)}, stage:"B", opts:${JSON.stringify(opts)}, clicks: r.clicks.map((c)=>({t:c.t,dMoyu:c.dMoyu,dClicks:c.dClicks}))}); }); 1`);
        console.log("[patrol] blitz: 12cps 补完");
        followB = null;
      }
    }
    const ps = await b.evj("JSON.stringify(window.__r9.patrols)");
    if (ps.length !== lastPatrolCount) {
      lastPatrolCount = ps.length;
      await b.ev("window.__r9.speed = 12; 1");
      console.log("[patrol] done", ps[ps.length - 1].variant);
    }
    if (blitzSeen >= 1 && typeSeen >= 1) {
      const landed = await b.evj("JSON.stringify(window.__r9.patrols.map((x)=>x.variant))");
      if (landed.includes("blitz")) break;
    }
    await sleep(80);
  }
  await b.ev("window.__r9.speed = 1; 1");
  await sleep(500);

  const raw = await b.evj(`JSON.stringify({
    patrols: window.__r9.patrols,
    patrolBursts: window.__r9.patrolBursts,
    errorList: window.__r9.errors
  })`);
  out.meta.huntMs = Date.now() - huntStart;
  out.actions = actions;

  for (const p of raw.patrols) {
    const win = [p.firstAt - 80, p.endedAt + 900];
    const bursts = raw.patrolBursts.filter((x) => x.firstAt >= p.firstAt - 200 && x.firstAt <= p.endedAt);
    const clicks = bursts.flatMap((x) => x.clicks);
    const bannerNums = p.log
      .map((l) => ({ t: l.t, m: l.s.match(/(\d+)\/(\d+)/) }))
      .filter((x) => x.m)
      .map((x) => ({ t: x.t, n: Number(x.m[1]), total: Number(x.m[2]) }));
    const prog = bannerNums.filter((x, i, arr) => i === 0 || x.n !== arr[i - 1].n);
    const firstProgress = prog.find((x) => x.n > 0);
    const inst = await b.evj(`JSON.stringify(window.__r9.distinctTexts(${win[0]}, ${win[1]}))`);
    const stages = bursts.map((x) => {
      const c = x.clicks;
      const eaten = c.filter((y) => y.dClicks === 0 && y.dMoyu === 0).length;
      return {
        stage: x.stage,
        cps: x.opts.cps,
        taps: c.length,
        eaten,
        firstTapAt: c.length ? c[0].t - p.firstAt : null,
        lastTapAt: c.length ? c[c.length - 1].t - p.firstAt : null,
      };
    });
    const entry = {
      variant: p.variant,
      firstAt: p.firstAt,
      endedAt: p.endedAt,
      bannerFirst: p.log[0] ? p.log[0].s : null,
      deadZoneMs: firstProgress ? firstProgress.t - p.firstAt : null,
      progress: prog.map((x) => ({ dt: x.t - p.firstAt, n: x.n, total: x.total })),
      progressFinal: prog.length ? prog[prog.length - 1].n : 0,
      progressTotal: prog.length ? prog[0].total : null,
      progressFinalAt: prog.length ? prog[prog.length - 1].t - p.firstAt : null,
      tapsSent: clicks.length,
      tapsEaten: clicks.filter((y) => y.dClicks === 0 && y.dMoyu === 0).length,
      stages,
      zeroTapTexts: inst.filter((x) => x.s.indexOf("偷点 +0") >= 0).length,
      tapLabelKinds: [...new Set(inst.filter((x) => /偷点/.test(x.s)).map((x) => x.s.replace(/\d+/g, "N")))],
      resultTexts: [...new Set(inst.filter((x) => /安然度过|没达标|成功|冲刺/.test(x.s)).map((x) => x.s))],
      resultTextsDetailed: inst.filter((x) => /安然度过|没达标|成功|冲刺/.test(x.s)),
    };
    out.patrols.push(entry);
    console.log(
      `[patrol ${entry.variant}] 死区=${entry.deadZoneMs}ms 发送=${entry.tapsSent} 被吞=${entry.tapsEaten} 进度=${entry.progressFinal}/${entry.progressTotal} 文案=${JSON.stringify(entry.resultTexts)} 标签=${JSON.stringify(entry.tapLabelKinds)}`,
    );
  }
  out.meta.errors = raw.errorList;
} catch (e) {
  out.errors.push(String(e && e.stack ? e.stack : e));
  console.error("[patrol probe error]", e);
} finally {
  b.close();
}
writeFileSync(EVIDENCE, JSON.stringify(out, null, 2));
console.log("wrote", EVIDENCE);
process.exit(0);
