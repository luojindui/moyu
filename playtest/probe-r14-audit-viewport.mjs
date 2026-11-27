/**
 * R14 视口矩阵：鱼缸（aquarium）在各视口下是否可见
 * 只做像素统计 + 源码几何推算，用于 D1 缺陷定级
 */
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { writeFileSync } from "node:fs";

const URL = process.env.MOYU_URL ?? "http://127.0.0.1:5173/";
const VIEWPORTS = [
  { w: 1920, h: 1080, mobile: false },
  { w: 1440, h: 900, mobile: false },
  { w: 1280, h: 800, mobile: false },
  { w: 1024, h: 768, mobile: false },
  { w: 768, h: 1024, mobile: true },
  { w: 390, h: 844, mobile: true },
];
const ALL_DECOR = ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"];
const out = { startedAt: new Date().toISOString(), viewports: {} };

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
    const waitReady = async () => {
      for (let i = 0; i < 250; i++) {
        try {
          if ((await evaluate("!!window.__MOYU__")) === true) return;
        } catch {}
        await sleep(100);
      }
      throw new Error("not ready");
    };
    const today = () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const blob = {
      v: 2, moyu: 1e6, totalEarned: 1e6, lifetimeEarned: 1e6, levels: {},
      savedAt: Date.now() + 60_000, createdAt: Date.now() - 3600_000,
      collected: { quotes: [], flavors: [] }, daily: null, surviveStreak: 0, patrolSurvives: 0,
      totalClicks: 0, visits: { date: "", count: 0 }, prestige: 0, team: { colleagues: {} },
      talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: today() },
      decor: ALL_DECOR, energy: { date: today(), left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1 } },
    };
    const seed = await b.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => { try { localStorage.setItem("moyu-save", ${JSON.stringify(JSON.stringify(blob))}); } catch (e) {} })();`,
    });
    try {
      for (const vp of VIEWPORTS) {
        await b.send("Emulation.setDeviceMetricsOverride", { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile });
        await b.send("Page.navigate", { url: URL });
        await waitReady();
        await sleep(600);
        await evaluate(`(() => { const w=document.getElementById('welcome'); if(w&&!w.classList.contains('hidden')) document.getElementById('welcome-ok').click(); const c=document.getElementById('cards'); if(c&&!c.classList.contains('hidden')) document.getElementById('cards-skip').click(); return 1; })()`);
        await sleep(300);
        const info = await evj(`(() => {
          const el = document.getElementById('stage');
          const ctx = el.getContext('2d');
          const d = ctx.getImageData(0,0,el.width,el.height).data;
          let water=0, frame=0, fishRed=0;
          for (let i=0;i<d.length;i+=4) {
            if (d[i]===0x3f && d[i+1]===0x6f && d[i+2]===0x8a) water++;
            if (d[i]===0x8a && d[i+1]===0x9a && d[i+2]===0xa5) frame++;
            if (d[i]===0xff && d[i+1]===0x9e && d[i+2]===0x9e) fishRed++;
          }
          const cssW = el.clientWidth, cssH = el.clientHeight;
          const scale = Math.max(2, Math.min(6, Math.min(Math.round(cssW/130), Math.floor(cssH/124))));
          const vh = cssH/scale, groundY = vh - 4.2*16;
          return { cssW, cssH, canvasW: el.width, canvasH: el.height, scale, vh: +vh.toFixed(2), groundY: +groundY.toFixed(2), aquariumY: +(groundY-6.1*16).toFixed(2), waterPx: water, framePx: frame, redFishPx: fishRed };
        })()`);
        info.visible = info.waterPx > 0;
        out.viewports[`${vp.w}x${vp.h}`] = info;
      }
    } finally {
      await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: seed.identifier }).catch(() => {});
      b.close();
    }
  },
  { timeoutMs: 150_000, port: 9564 },
);

writeFileSync("playtest/r14-audit-viewport-report.json", JSON.stringify(out, null, 2));
for (const [k, v] of Object.entries(out.viewports)) {
  console.log(`${k.padEnd(10)} canvas ${v.cssW}x${v.cssH} scale=${v.scale} groundY=${v.groundY} aquariumY=${v.aquariumY} waterPx=${v.waterPx} visible=${v.visible}`);
}