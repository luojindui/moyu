/**
 * R14 桌面/小屏布局探针：8 件全买后在不同视口看家具是否被裁掉/跑出场景。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const SHOTS = "playtest/r14-shots";
mkdirSync(SHOTS, { recursive: true });
const OUT = {};

await runChrome(
  async ({ port }) => {
    const c = await connect(port);
    const { send, ev } = c;
    const writeB64 = (file, b64) => writeFileSync(file, Buffer.from(b64, "base64"));
    const waitFor = async (expr, timeout = 15000, step = 120) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) { const v = await ev(expr); if (v) return v; await sleep(step); }
      return null;
    };
    const st = async () => ev("window.__MOYU__.state");
    const dismiss = async () => {
      for (let k = 0; k < 4; k++) {
        if (await ev("!document.getElementById('cards').classList.contains('hidden')")) { await ev("document.getElementById('cards-skip').click()"); await sleep(250); continue; }
        if (await ev("!document.getElementById('welcome').classList.contains('hidden')")) { await ev("document.querySelector('#welcome button')?.click()"); await sleep(250); continue; }
        break;
      }
    };
    const boot = async () => {
      await waitFor("!!window.__MOYU__ && !!window.__MOYU__.state", 15000);
      await waitFor("(() => { const a = window.__MOYU__.assets; if (!a) return false; const vs = Object.values(a); return vs.length > 0 && vs.every(v => v === 'loaded'); })()", 15000);
      await sleep(800); await dismiss();
    };
    const fullShot = async (file) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeB64(file, r.data); };
    const canvasPng = async (file) => { const d = await ev("document.getElementById('stage').toDataURL('image/png')"); if (typeof d === 'string') writeB64(file, d.slice(d.indexOf(',') + 1)); };
    const geo = async () => ev(`(() => {
      const el = document.getElementById('stage');
      const w = el.clientWidth, h = el.clientHeight;
      const scale = Math.max(2, Math.min(6, Math.min(Math.round(w / 130), Math.floor(h / 124))));
      const vw = w/scale, vh = h/scale, groundY = vh - 4.2*16, u = 16;
      const rects = {
        plant:      [0.9*u, groundY-2.49*u, 1.05*u, 2.49*u],
        lamp:       [vw/2+0.95*u, groundY-3.6*u, 0.97*u, 3.3*u],
        rug:        [vw/2-3.1*u, groundY+1.1*u, 6.2*u, 1.5*u],
        fridge:     [0.2*u, groundY-2.05*u, 1.0*u, 2.05*u],
        chair:      [vw/2+1.95*u, groundY-1.61*u, 1.25*u, 1.61*u],
        aquarium:   [vw-2.97*u, groundY-6.2*u, 1.64*u, 1.5*u],
        projector:  [vw/2-1.3*u, 0.2*u, 2.0*u, 1.65*u],
        catbed:     [vw/2-0.6*u, groundY-0.75*u, 1.5*u, 0.77*u],
        clock:      [vw-2.62*u, 2*u-0.72*u, 1.44*u, 1.44*u],
        board:      [vw-3.9*u, Math.min(4.6*u, groundY-4.4*u), 2.5*u, 1.6*u],
        window:     [1.6*u, 1.4*u, 3.6*u, 2.4*u],
        pendant:    [vw/2-0.9*u, 1*u, 1.8*u, 0.42*u],
      };
      const status = {};
      for (const [k, r] of Object.entries(rects)) {
        status[k] = { x: +r[0].toFixed(1), y: +r[1].toFixed(1), w: +r[2].toFixed(1), h: +r[3].toFixed(1),
          clippedTop: r[1] < 0, clippedBottom: r[1] + r[3] > vh, clippedLeft: r[0] < 0, clippedRight: r[0] + r[2] > vw };
      }
      return { cssW:w, cssH:h, scale, vw:+vw.toFixed(1), vh:+vh.toFixed(1), groundY:+groundY.toFixed(1), status };
    })()`);

    await send("Page.enable"); await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
    await boot();
    await ev("window.__MOYU__.grant(1e10)");
    await sleep(2200); await dismiss();
    OUT.desktopGeo = await geo();

    // 买全 8 件
    const ORDER = ['plant','lamp','rug','fridge','chair','aquarium','projector','catbed'];
    for (const id of ORDER) {
      if (await ev("document.getElementById('team').classList.contains('hidden')")) {
        await ev("document.getElementById('btn-team').click()"); await sleep(300);
      }
      await ev("document.getElementById('tab-decor').click()"); await sleep(200);
      await ev(`document.querySelector('button[data-act="decor"][data-id="${id}"]')?.scrollIntoView({block:'center'})`);
      await sleep(120);
      await ev(`document.querySelector('button[data-act="decor"][data-id="${id}"]').click()`);
      await sleep(220);
    }
    await ev("document.getElementById('team-close').click()");
    await sleep(2300); await dismiss();
    OUT.desktopState = { decor: (await st()).decor, hud: await ev("document.getElementById('hud-moyu').textContent") };
    await fullShot(`${SHOTS}/desktop-all8-full.png`);
    await canvasPng(`${SHOTS}/desktop-all8-canvas.png`);

    // 768x1024 平板竖屏
    await send("Emulation.setDeviceMetricsOverride", { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true });
    await sleep(900);
    OUT.tabletGeo = await geo();
    await fullShot(`${SHOTS}/tablet-all8-full.png`);
    await canvasPng(`${SHOTS}/tablet-all8-canvas.png`);

    // 320x568 小屏
    await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
    await sleep(900);
    OUT.smallGeo = await geo();
    await fullShot(`${SHOTS}/small-all8-full.png`);
    await canvasPng(`${SHOTS}/small-all8-canvas.png`);

    // 390x844 基准
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(900);
    OUT.mobileGeo = await geo();
    await fullShot(`${SHOTS}/mobile-all8-full.png`);
    await canvasPng(`${SHOTS}/mobile-all8-canvas.png`);

    OUT.errors = c.errors.slice();
  },
  { timeoutMs: 180_000 },
);

writeFileSync("playtest/r14-evidence-viewport.json", JSON.stringify(OUT, null, 2));
for (const k of ['desktopGeo', 'tabletGeo', 'smallGeo', 'mobileGeo']) {
  console.log(k, JSON.stringify({ cssW: OUT[k].cssW, cssH: OUT[k].cssH, scale: OUT[k].scale, vw: OUT[k].vw, vh: OUT[k].vh, groundY: OUT[k].groundY }));
  const bad = Object.entries(OUT[k].status).filter(([, v]) => v.clippedTop || v.clippedBottom || v.clippedLeft || v.clippedRight);
  console.log('  clipped:', JSON.stringify(bad));
}
console.log('errors:', OUT.errors);