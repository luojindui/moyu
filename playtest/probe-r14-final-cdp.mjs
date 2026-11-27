/**
 * R14 最终复验 CDP（HEAD 600487a）：
 *  S1 1280×800 全家具场景 + 鱼缸 bbox（是否避开公告板 / 是否压到投影仪/吊灯）
 *  S2 矮屏 768×1024 / 高 1440×900 鱼缸位置与重叠
 *  S3 存档 used 满 + left=100 → 收敛 0；focus 不可用
 *  S4 离线 A/B：rug 是否 +0.05（ratio 1.0625）而非 +0.10
 *  S5 8/8 集齐 idle ×1.1（面板 ×1.58）+ 精力 4 项取舍仍成立
 *  S6 boosted 注入仍被忽略（回归）
 * 证据：playtest/r14-final-cdp.json + 截图
 */
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { writeFileSync } from "node:fs";

const URL = process.env.MOYU_URL ?? "http://127.0.0.1:5173/";
const ALL_DECOR = ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"];
const COLORS = {
  plant: [0x4f, 0x8f, 0x53], fridge: [0xd8, 0xe3, 0xea], aquaWater: [0x3f, 0x6f, 0x8a],
  aquaFrame: [0x8a, 0x9a, 0xa5], aquaBase: [0x6b, 0x78, 0x80], aquaFishP: [0xff, 0x9e, 0x9e],
  projector: [0x6f, 0x74, 0x88], catbed: [0xc4, 0x7a, 0x4f], boardTan: [0xd9, 0xc9, 0xa3],
  boardFrame: [0x5f, 0x45, 0x29], clockCream: [0xe8, 0xe2, 0xd0], ceilingLamp: [0x4b, 0x52, 0x71],
};
const report = { startedAt: new Date().toISOString(), url: URL, head: "600487a", scenarios: {} };

await runChrome(
  async ({ port }) => {
    const b = await connect(port);
    await b.send("Page.enable", {});
    await b.send("Runtime.enable", {});
    const evaluate = async (expr) => {
      const r = await b.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
      return r.result.value;
    };
    const evj = async (expr) => JSON.parse(await evaluate(`JSON.stringify((${expr}))`));
    const state = () => evj("window.__MOYU__.state");
    const text = (sel) => evj(`(() => { const el=document.querySelector(${JSON.stringify(sel)}); return el?el.textContent:null; })()`);
    const click = (sel) => evj(`(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return "missing"; el.click(); return "ok"; })()`);
    const waitReady = async () => {
      for (let i = 0; i < 250; i++) {
        try { if ((await evaluate("!!window.__MOYU__")) === true) return; } catch {}
        await sleep(100);
      }
      throw new Error("not ready");
    };
    const reload = async () => { await b.send("Page.reload", { ignoreCache: false }); await sleep(1100); await waitReady(); await sleep(300); };
    const shot = async (name) => { const r = await b.send("Page.captureScreenshot", { format: "png" }); const f = `playtest/r14-final-${name}.png`; writeFileSync(f, Buffer.from(r.data, "base64")); return f; };
    const dismiss = async () => {
      await evj(`(() => { const w=document.getElementById('welcome'); if(w&&!w.classList.contains('hidden')){const b=document.getElementById('welcome-ok'); if(b)b.click();} return 1; })()`);
      await sleep(180);
      await evj(`(() => { const c=document.getElementById('cards'); if(c&&!c.classList.contains('hidden')){const b=document.getElementById('cards-skip'); if(b)b.click();} return 1; })()`);
      await sleep(300);
    };
    const openTeam = async (tab = "decor") => { await click("#btn-team"); await sleep(600); if (tab === "decor") await click("#tab-decor"); await sleep(350); };
    const closeTeam = async () => { if ((await evj(`document.getElementById('team').classList.contains('hidden')`)) === false) { await click("#team-close"); await sleep(250); } };
    const seedSave = async (blob) => {
      const src = `(() => { try { localStorage.setItem("moyu-save", ${JSON.stringify(JSON.stringify(blob))}); } catch (e) {} })()`;
      const r = await b.send("Page.addScriptToEvaluateOnNewDocument", { source: src });
      await reload();
      await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: r.identifier });
      await sleep(200);
    };
    const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
    const blob = (over = {}) => ({
      v: 2, moyu: 0, totalEarned: 0, lifetimeEarned: 0, levels: {}, savedAt: Date.now() + 60_000,
      createdAt: Date.now() - 3 * 86400_000, collected: { quotes: [], flavors: [] }, daily: null,
      surviveStreak: 0, patrolSurvives: 0, totalClicks: 0, visits: { date: "", count: 0 }, prestige: 0,
      team: { colleagues: {} }, talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: today() },
      ...over,
    });
    const bbox = (rgb) =>
      evj(`(() => { const c=document.getElementById('stage'); const ctx=c.getContext('2d'); const d=ctx.getImageData(0,0,c.width,c.height).data; let n=0,x0=1e9,y0=1e9,x1=-1,y1=-1; for(let i=0;i<d.length;i+=4){ if(d[i]===${rgb[0]}&&d[i+1]===${rgb[1]}&&d[i+2]===${rgb[2]}&&d[i+3]>200){ n++; const p=i/4,x=p%c.width,y=(p/c.width)|0; if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; } } return { n, bbox: n?[x0,y0,x1,y1]:null, w:c.width, h:c.height }; })()`);
    const canvasInfo = () => evj(`(() => { const el=document.getElementById('stage'); const r=el.getBoundingClientRect(); return { w:el.width, h:el.height, cssW:r.width, cssH:r.height }; })()`);

    await b.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__errs=[]; addEventListener('error',e=>window.__errs.push(String(e.message)));` });

    try {
      // ───────── S1：1280×800 全家具 + 鱼缸 bbox ─────────
      await b.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await b.send("Page.navigate", { url: URL });
      await waitReady(); await dismiss();
      await evaluate("window.__MOYU__.grant(1e11)"); await sleep(200);
      await openTeam("decor");
      for (const id of ALL_DECOR) { await click(`#team-body button[data-act="decor"][data-id="${id}"]`); await sleep(200); }
      const s1 = { summary: await text("#team-body .team-summary"), hud: { idle: await text("#hud-idle"), click: await text("#hud-click") } };
      await closeTeam(); await dismiss();
      s1.canvas = await canvasInfo();
      s1.bboxes = {};
      for (const [k, rgb] of Object.entries(COLORS)) s1.bboxes[k] = await bbox(rgb);
      s1.scene = await shot("s1-desktop");
      // 虚拟坐标换算（canvas 内像素 → 虚拟单位，scale 由 canvas 尺寸推断）
      const maxV = Math.round(Math.max(s1.canvas.cssW / 130, 0));
      s1.note = `canvas ${s1.canvas.w}x${s1.canvas.h}`;
      report.scenarios.S1 = s1;

      // ───────── S2：矮屏/高屏鱼缸位置 ─────────
      const S2 = {};
      for (const vp of [{ w: 768, h: 1024, mobile: true, tag: "tablet" }, { w: 1440, h: 900, mobile: false, tag: "tall" }, { w: 390, h: 844, mobile: true, tag: "mobile" }]) {
        await b.send("Emulation.setDeviceMetricsOverride", { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile });
        await reload();
        await sleep(300);
        await dismiss();
        const info = await canvasInfo();
        const aqua = await bbox(COLORS.aquaWater);
        const board = await bbox(COLORS.boardTan);
        S2[vp.tag] = { viewport: `${vp.w}x${vp.h}`, canvas: info, aqua, board, scene: await shot(`s2-${vp.tag}`) };
      }
      report.scenarios.S2 = S2;

      // ───────── S3：used 满 + left=100 → 收敛 ─────────
      await b.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await seedSave(blob({ team: { colleagues: { zhou: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 10, autoRepeat: false, rewardSnapshot: 0 } } }, energy: { date: today(), left: 100, used: ["social", "fake-work", "slack"], boosted: {} } }));
      const s3pre = await state();
      await openTeam("decor");
      const s3 = {
        restored: { left: s3pre.energy.left, used: s3pre.energy.used, boosted: s3pre.energy.boosted, heading: await text("#team-body .branch h3") },
        focusBtn: await evj(`(() => { const el=document.querySelector('#team-body button[data-act="energy"][data-id="focus"]'); return el?{disabled:el.disabled,label:el.textContent}:null; })()`),
      };
      await click(`#team-body button[data-act="energy"][data-id="focus"]`); await sleep(300);
      const s3after = await state();
      s3.afterFocusClick = { left: s3after.energy.left, used: s3after.energy.used };
      report.scenarios.S3 = s3;
      await closeTeam();

      // ───────── S4：离线 A/B（rug 只 +0.05） ─────────
      const mkOffline = (decor, energy) => blob({ moyu: 0, levels: { retire: 1 }, totalEarned: 0, lifetimeEarned: 0, decor, savedAt: Date.now() - 3600_000, createdAt: Date.now() - 3 * 86400_000, energy: energy ?? { date: today(), left: 100, used: [], boosted: {} } });
      await seedSave(mkOffline([]));
      const s4a = await state();
      await seedSave(mkOffline(["rug"]));
      const s4b = await state();
      await seedSave(mkOffline(["rug", "chair", "catbed"]));
      const s4c = await state();
      const rateOf = (moyu) => +(moyu / (700.2 * 3600)).toFixed(4);
      report.scenarios.S4 = {
        noDecor: { moyu: s4a.moyu, rate: rateOf(s4a.moyu) },
        rug: { moyu: s4b.moyu, rate: rateOf(s4b.moyu) },
        allThree: { moyu: s4c.moyu, rate: rateOf(s4c.moyu) },
        rugRatio: +(s4b.moyu / s4a.moyu).toFixed(5), rugSpecRatio: 1.0625,
        allThreeRatio: +(s4c.moyu / s4a.moyu).toFixed(5), allThreeSpecRatio: +(0.93 / 0.8).toFixed(5),
      };

      // ───────── S5：8/8 ×1.1 + 精力取舍 + boosted 注入回归 ─────────
      await seedSave(blob({ decor: ALL_DECOR, moyu: 1000, team: { colleagues: { zhou: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 10, autoRepeat: false, rewardSnapshot: 0 } } }, energy: { date: today(), left: 100, used: [], boosted: { idleMult: 2, patrolRewardMult: 3, clickMult: 9 } } }));
      const s5state = await state();
      await openTeam("decor");
      const s5 = { boostedIgnored: s5state.energy.boosted, left: s5state.energy.left, summary: await text("#team-body .team-summary"), hudIdle: await text("#hud-idle") };
      for (const a of ["social", "fake-work", "slack"]) { await click(`#team-body button[data-act="energy"][data-id="${a}"]`); await sleep(250); }
      const s5after = await state();
      s5.afterCombo = { left: s5after.energy.left, used: s5after.energy.used, focusBtn: await evj(`(() => { const el=document.querySelector('#team-body button[data-act="energy"][data-id="focus"]'); return el?{disabled:el.disabled}:null; })()`) };
      report.scenarios.S5 = s5;
      await closeTeam();

      report.consoleErrors = b.errors.slice(0, 20);
      report.pageErrors = (await evj("window.__errs")) ?? [];
    } finally {
      b.close();
    }
  },
  { timeoutMs: 200_000, port: 9568 },
);

writeFileSync("playtest/r14-final-cdp.json", JSON.stringify(report, null, 2));
const s = report.scenarios;
console.log("S1 summary:", s.S1?.summary?.trim(), "| hud:", JSON.stringify(s.S1?.hud), "| canvas:", JSON.stringify(s.S1?.canvas));
console.log("S1 bbox:", JSON.stringify(s.S1?.bboxes));
console.log("S2:", JSON.stringify(Object.fromEntries(Object.entries(s.S2 ?? {}).map(([k, v]) => [k, { viewport: v.viewport, canvas: v.canvas, aqua: v.aqua?.bbox, board: v.board?.bbox }])), null, 1));
console.log("S3:", JSON.stringify(s.S3));
console.log("S4:", JSON.stringify(s.S4));
console.log("S5:", JSON.stringify(s.S5));
console.log("errors:", report.consoleErrors, report.pageErrors);