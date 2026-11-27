/**
 * R14 诊断：移动端/桌面端 canvas 内各家具颜色 bbox + canvas 裁剪图
 */
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { writeFileSync } from "node:fs";

const URL = process.env.MOYU_URL ?? "http://127.0.0.1:5173/";
const ALL_DECOR = ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"];
const COLORS = {
  plant: [0x4f, 0x8f, 0x53],
  lampShade: [0xff, 0xd7, 0x6e],
  lampPole: [0x8a, 0x8f, 0x9c],
  fridge: [0xd8, 0xe3, 0xea],
  chairBack: [0x4a, 0x3b, 0x52],
  chairSeat: [0x5d, 0x4a, 0x66],
  chairPillow: [0x6b, 0x56, 0x80],
  aquaWater: [0x3f, 0x6f, 0x8a],
  aquaFrame: [0x8a, 0x9a, 0xa5],
  aquaBase: [0x6b, 0x78, 0x80],
  aquaFishY: [0xff, 0xd7, 0x6e],
  aquaFishP: [0xff, 0x9e, 0x9e],
  projector: [0x6f, 0x74, 0x88],
  catbed: [0xc4, 0x7a, 0x4f],
  rug: [0x6b, 0x4f, 0x43],
};
const out = { startedAt: new Date().toISOString(), runs: {} };

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
        try { if ((await evaluate("!!window.__MOYU__")) === true) return; } catch {}
        await sleep(100);
      }
      throw new Error("not ready");
    };
    const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
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
      for (const vp of [{ w: 1280, h: 800, mobile: false, tag: "desktop" }, { w: 390, h: 844, mobile: true, tag: "mobile" }]) {
        await b.send("Emulation.setDeviceMetricsOverride", { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile });
        await b.send("Page.navigate", { url: URL });
        await waitReady();
        await sleep(700);
        await evaluate(`(() => { const w=document.getElementById('welcome'); if(w&&!w.classList.contains('hidden')) document.getElementById('welcome-ok').click(); const c=document.getElementById('cards'); if(c&&!c.classList.contains('hidden')) document.getElementById('cards-skip').click(); return 1; })()`);
        await sleep(400);
        const data = await evj(`(() => {
          const el = document.getElementById('stage');
          const rect = el.getBoundingClientRect();
          const ctx = el.getContext('2d');
          const W = el.width, H = el.height;
          const d = ctx.getImageData(0,0,W,H).data;
          const COLORSDEF = ${JSON.stringify(COLORS)};
          const out = {};
          for (const [k, c] of Object.entries(COLORSDEF)) {
            let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
            for (let i = 0; i < d.length; i += 4) {
              if (d[i] === c[0] && d[i+1] === c[1] && d[i+2] === c[2]) {
                n++;
                const p = i / 4, x = p % W, y = (p / W) | 0;
                if (x < x0) x0 = x; if (x > x1) x1 = x;
                if (y < y0) y0 = y; if (y > y1) y1 = y;
              }
            }
            out[k] = { n, bbox: n ? [x0,y0,x1,y1] : null };
          }
          return {
            canvas: { W, H, cssW: rect.width, cssH: rect.height, offsetX: rect.left, offsetY: rect.top },
            decor: window.__MOYU__.state.decor,
            colors: out,
            dataURL: el.toDataURL('image/png').slice(0, 8) /* 仅占位，图另取 */,
          };
        })()`);
        // canvas 裁剪图
        const crop = await evj(`(() => {
          const el = document.getElementById('stage');
          const rect = el.getBoundingClientRect();
          return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
        })()`);
        const r = await b.send("Page.captureScreenshot", {
          format: "png",
          clip: { x: crop.x, y: crop.y, width: crop.w, height: crop.h, scale: 1 },
        });
        const file = `playtest/r14-audit-canvas-${vp.tag}.png`;
        writeFileSync(file, Buffer.from(r.data, "base64"));
        data.canvasShot = file;
        out.runs[vp.tag] = data;
      }
    } finally {
      await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: seed.identifier }).catch(() => {});
      b.close();
    }
  },
  { timeoutMs: 150_000, port: 9565 },
);

writeFileSync("playtest/r14-audit-diagnostic.json", JSON.stringify(out, null, 2));
for (const [tag, d] of Object.entries(out.runs)) {
  console.log("==", tag, "canvas", JSON.stringify(d.canvas), "decor", d.decor.length, "shot", d.canvasShot);
  for (const [k, v] of Object.entries(d.colors)) console.log(`   ${k.padEnd(11)} n=${String(v.n).padStart(5)} bbox=${JSON.stringify(v.bbox)}`);
}