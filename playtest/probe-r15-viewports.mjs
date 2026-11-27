/**
 * R15 批次3 复验·多视口：1920/1440/1280/1024/768/390（另加 320 小屏）。
 * 每个视口独立干净启动：截 0 装修基线 → 买全 8 件 → 截最终场景；
 * 输出几何（裁剪/重叠/区域像素变化）用于判定"可见且不穿模"。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const SHOTS = "playtest/r15-shots";
mkdirSync(SHOTS, { recursive: true });
const OUT = {};

const GEOM = `(() => {
  const el = document.getElementById('stage');
  const w = el.clientWidth, h = el.clientHeight;
  const scale = Math.max(2, Math.min(6, Math.min(Math.round(w / 130), Math.floor(h / 124))));
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const u = 16, vw = w / scale, vh = h / scale, groundY = vh - 4.2 * u;
  const f = scale * dpr;
  const rx = (x, y, ww, hh) => ({ x: +(x * f).toFixed(1), y: +(y * f).toFixed(1), w: +(ww * f).toFixed(1), h: +(hh * f).toFixed(1) });
  const shortView = groundY < 90;
  const ax = shortView ? vw - 6.9 * u : vw - 2.9 * u;
  const ay = Math.max(0.6 * u, groundY - 6.1 * u);
  const px = vw / 2 + 1.4 * u;
  const furniture = {
    plant:    rx(1.0 * u, groundY - 2.6 * u, 1.35 * u, 2.6 * u),
    lamp:     rx(vw / 2 - 2.2 * u, groundY - 3.8 * u, 1.8 * u, 2.2 * u),
    rug:      rx(vw / 2 - 3.1 * u, groundY + 1.1 * u, 6.2 * u, 1.5 * u),
    fridge:   rx(0, groundY - 2.1 * u, 1.0 * u, 2.1 * u),
    chair:    rx(vw / 2 + 1.5 * u, groundY - 2.2 * u, 1.35 * u, 1.7 * u),
    aquarium: rx(ax - 0.07 * u, ay - 0.1 * u, 1.78 * u, 1.5 * u),
    projector:rx(px - 0.75 * u, 0.15 * u, 2.1 * u, 1.75 * u),
    catbed:   rx(vw / 2 - 0.6 * u, groundY - 0.8 * u, 1.5 * u, 0.8 * u),
  };
  const props = {
    window:   rx(1.25 * u, 1.05 * u, 4.3 * u, 3.1 * u),
    clock:    rx(vw - 2.62 * u, 2 * u - 0.72 * u, 1.44 * u, 1.44 * u),
    board:    rx(vw - 3.9 * u, Math.min(4.6 * u, groundY - 4.4 * u), 2.5 * u, 1.6 * u),
    cooler:   rx(vw - 1.9 * u, groundY - 1.05 * u, 1.0 * u, 1.0 * u),
    pendant:  rx(vw / 2 - 0.9 * u, 1.0 * u, 1.8 * u, 0.42 * u),
    desk:     rx(vw / 2 - 2.1 * u, groundY - 2 * u, 4.2 * u, 0.5 * u),
    rugZone:  rx(vw / 2 - 3.1 * u, groundY + 1.1 * u, 6.2 * u, 1.5 * u),
  };
  const stageW = el.width, stageH = el.height;
  const inter = (a, b) => {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    if (x2 <= x1 || y2 <= y1) return null;
    return { w: +(x2 - x1).toFixed(1), h: +(y2 - y1).toFixed(1), area: +((x2 - x1) * (y2 - y1)).toFixed(0) };
  };
  const clipped = {};
  for (const [k, r] of Object.entries(furniture)) {
    const cx = r.x, cy = r.y, cr = r.x + r.w, cb = r.y + r.h;
    const parts = [];
    if (cy < 0) parts.push('top');
    if (cx < 0) parts.push('left');
    if (cr > stageW) parts.push('right');
    if (cb > stageH) parts.push('bottom');
    if (parts.length) clipped[k] = parts.join('+');
  }
  const overlaps = [];
  for (const [fk, fr] of Object.entries(furniture)) {
    for (const [pk, pr] of Object.entries(props)) {
      if (fk === 'rug' && pk === 'rugZone') continue;
      const it = inter(fr, pr);
      if (it) overlaps.push({ a: fk, b: pk, ...it, pctOfFurniture: +(it.area / (fr.w * fr.h) * 100).toFixed(1) });
    }
  }
  for (let i = 0; i < Object.keys(furniture).length; i++) {
    const [fa, fr] = Object.entries(furniture)[i];
    for (const [fb, sr] of Object.entries(furniture).slice(i + 1)) {
      const it = inter(fr, sr);
      if (it) overlaps.push({ a: fa, b: fb, ...it, pctOfA: +(it.area / (fr.w * fr.h) * 100).toFixed(1) });
    }
  }
  return { canvasCss: { w, h }, stagePx: { w: stageW, h: stageH }, scale, dpr, vw: +vw.toFixed(1), vh: +vh.toFixed(1), groundY: +groundY.toFixed(1), shortView,
           furniture, props, clipped, overlaps: overlaps.sort((x, y) => (y.area ?? 0) - (x.area ?? 0)) };
})()`;

const VIEWPORTS = [
  { label: "1920x1080", width: 1920, height: 1080, dsf: 1, mobile: false },
  { label: "1440x900", width: 1440, height: 900, dsf: 1, mobile: false },
  { label: "1280x800", width: 1280, height: 800, dsf: 1, mobile: false },
  { label: "1024x768", width: 1024, height: 768, dsf: 1, mobile: true },
  { label: "768x1024", width: 768, height: 1024, dsf: 1, mobile: true },
  { label: "390x844", width: 390, height: 844, dsf: 2, mobile: true },
  { label: "320x568", width: 320, height: 568, dsf: 2, mobile: true },
];

for (const vp of VIEWPORTS) {
  OUT[vp.label] = await runChrome(
    async ({ port }) => {
      const c = await connect(port);
      const { send, ev } = c;
      const writeB64 = (file, b64) => writeFileSync(file, Buffer.from(b64, "base64"));
      const waitFor = async (expr, timeout = 15000, step = 120) => {
        const t0 = Date.now();
        while (Date.now() - t0 < timeout) { const v = await ev(expr); if (v) return v; await sleep(step); }
        return null;
      };
      const dismiss = async () => {
        for (let k = 0; k < 5; k++) {
          if (await ev("!document.getElementById('cards').classList.contains('hidden')")) { await ev("document.getElementById('cards-skip').click()"); await sleep(240); continue; }
          if (await ev("!document.getElementById('welcome').classList.contains('hidden')")) { await ev("document.querySelector('#welcome button')?.click()"); await sleep(240); continue; }
          break;
        }
      };
      const canvasPng = async (file) => {
        const d = await ev("document.getElementById('stage').toDataURL('image/png')");
        if (typeof d === "string") writeB64(file, d.slice(d.indexOf(",") + 1));
      };
      await send("Page.enable");
      await send("Runtime.enable");
      await send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: vp.dsf, mobile: vp.mobile });
      await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
      await waitFor("!!window.__MOYU__ && !!window.__MOYU__.state");
      await waitFor("(() => { const a = window.__MOYU__.assets; if (!a) return false; const vs = Object.values(a); return vs.length > 0 && vs.every(v => v === 'loaded'); })()");
      await sleep(1000);
      await dismiss();
      // 加钱（让 quest 栏消失、布局稳定）
      await ev("window.__MOYU__.grant(1e11)");
      await sleep(2400);
      await dismiss();
      await sleep(300);
      const geo = await ev(GEOM);
      await canvasPng(`${SHOTS}/vp-${vp.label}-baseline-canvas.png`);
      // 买全 8 件
      await ev("document.getElementById('btn-team').click()"); await sleep(350);
      await ev("document.getElementById('tab-decor').click()"); await sleep(250);
      for (const id of ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"]) {
        await ev(`document.querySelector('button[data-act="decor"][data-id="${id}"]')?.click()`);
        await sleep(260);
      }
      const decor = await ev("window.__MOYU__.state.decor");
      await ev("document.getElementById('team-close').click()");
      await sleep(1400);
      await dismiss();
      const summary = await ev("(() => { document.getElementById('btn-team').click(); return null; })()");
      await sleep(350);
      await ev("document.getElementById('tab-decor').click()"); await sleep(300);
      const panelSummary = await ev("document.querySelector('#team-body .team-summary')?.textContent?.trim() ?? ''");
      await ev("document.getElementById('team-close').click()"); await sleep(250);
      const r = await send("Page.captureScreenshot", { format: "png" });
      writeB64(`${SHOTS}/vp-${vp.label}-all8-full.png`, r.data);
      await canvasPng(`${SHOTS}/vp-${vp.label}-all8-canvas.png`);
      return {
        viewport: vp, decor, geo, panelSummary,
        hud: { idle: await ev("document.getElementById('hud-idle').textContent"), click: await ev("document.getElementById('hud-click').textContent") },
        errors: c.errors.slice(),
      };
    },
    { timeoutMs: 120_000 },
  );
  const g = OUT[vp.label].geo;
  console.log(vp.label, JSON.stringify({ canvas: g.canvasCss, scale: g.scale, shortView: g.shortView, clipped: g.clipped }), 'overlaps:', g.overlaps.length, 'decor:', OUT[vp.label].decor?.length);
}

writeFileSync("playtest/r15-evidence-viewports.json", JSON.stringify(OUT, null, 2));
console.log("done");