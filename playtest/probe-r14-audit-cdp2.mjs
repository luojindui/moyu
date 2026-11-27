/**
 * R14 补充实机验证（CDP，playtest/lib/chrome.mjs）：
 *  P1 桌面 1280×800：全家具场景 → 鱼缸像素可见性（怀疑 y<0 被裁掉）
 *  P2 手机 390×844：同档位 → 鱼缸是否可见（视口相关缺陷确认）
 *  P3 余额变化时工位页按钮是否刷新（UI 滞后缺陷确认）
 *  P4 社交 +3 好感实机接线
 */
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { writeFileSync } from "node:fs";

const URL = process.env.MOYU_URL ?? "http://127.0.0.1:5173/";
const report = { startedAt: new Date().toISOString(), url: URL, scenarios: {} };
const COLORS = {
  plant: [0x4f, 0x8f, 0x53],
  lamp: [0xff, 0xd7, 0x6e],
  fridge: [0xd8, 0xe3, 0xea],
  chair: [0x4a, 0x3b, 0x52],
  aquariumWater: [0x3f, 0x6f, 0x8a],
  aquariumFrame: [0x8a, 0x9a, 0xa5],
  aquariumBase: [0x6b, 0x78, 0x80],
  aquariumFish: [0xff, 0x9e, 0x9e],
  projector: [0x6f, 0x74, 0x88],
  catbed: [0xc4, 0x7a, 0x4f],
};

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
    const evj = async (expr) => {
      const s = await evaluate(`(() => { const v = (${expr}); return JSON.stringify(v === undefined ? null : v); })()`);
      return s === undefined ? null : JSON.parse(s);
    };
    const state = () => evj("window.__MOYU__.state");
    const waitReady = async () => {
      for (let i = 0; i < 250; i++) {
        try {
          if ((await evaluate("!!window.__MOYU__")) === true) return;
        } catch {
          /* retry */
        }
        await sleep(100);
      }
      throw new Error("not ready");
    };
    const reload = async () => {
      await b.send("Page.reload", { ignoreCache: false });
      await sleep(1200);
      await waitReady();
      await sleep(300);
    };
    const shot = async (name) => {
      const r = await b.send("Page.captureScreenshot", { format: "png" });
      const file = `playtest/r14-audit-${name}.png`;
      writeFileSync(file, Buffer.from(r.data, "base64"));
      return file;
    };
    const colorCount = (rgb) =>
      evj(`(() => { const c = document.getElementById('stage'); if (!c) return null; const ctx = c.getContext('2d'); const d = ctx.getImageData(0,0,c.width,c.height).data; let n=0; for (let i=0;i<d.length;i+=4) { if (d[i]===${rgb[0]} && d[i+1]===${rgb[1]} && d[i+2]===${rgb[2]} && d[i+3]>200) n++; } return { count:n, w:c.width, h:c.height, cssW:c.clientWidth, cssH:c.clientHeight }; })()`);
    const dismissOverlays = async () => {
      await evj(`(() => { const w=document.getElementById('welcome'); if (w && !w.classList.contains('hidden')) { const b=document.getElementById('welcome-ok'); if(b) b.click(); } return true; })()`);
      await sleep(250);
      await evj(`(() => { const c=document.getElementById('cards'); if (c && !c.classList.contains('hidden')) { const b=document.getElementById('cards-skip'); if(b) b.click(); } return true; })()`);
      await sleep(350);
    };
    const seedSave = async (blob) => {
      const src = `(() => { try { localStorage.setItem("moyu-save", ${JSON.stringify(JSON.stringify(blob))}); } catch (e) {} })()`;
      const r = await b.send("Page.addScriptToEvaluateOnNewDocument", { source: src });
      await reload();
      await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: r.identifier });
      await sleep(200);
    };
    const today = () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const blob = (over = {}) => ({
      v: 2,
      moyu: 0,
      totalEarned: 0,
      lifetimeEarned: 0,
      levels: {},
      savedAt: Date.now() + 60_000,
      createdAt: Date.now() - 3600_000,
      collected: { quotes: [], flavors: [] },
      daily: null,
      surviveStreak: 0,
      patrolSurvives: 0,
      totalClicks: 0,
      visits: { date: "", count: 0 },
      prestige: 0,
      team: { colleagues: {} },
      talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: today() },
      ...over,
    });
    const ALL_DECOR = ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"];

    await b.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.__errs = []; window.addEventListener('error', (e) => window.__errs.push(String(e.message)));`,
    });

    try {
      // ───────── P1：桌面 1280×800 场景像素 ─────────
      await b.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await b.send("Page.navigate", { url: URL });
      await waitReady();
      await seedSave(blob({ decor: ALL_DECOR, moyu: 1e6, totalEarned: 1e6, lifetimeEarned: 1e6 }));
      await dismissOverlays();
      const p1 = { viewport: "1280x800", colors: {} };
      for (const [k, rgb] of Object.entries(COLORS)) p1.colors[k] = await colorCount(rgb);
      p1.canvas = p1.colors.aquariumWater;
      p1.scene = await shot("desktop-aquarium");
      // 计算量：按源码公式推算鱼缸 y（scale=round/clamp）
      const cw = p1.canvas.cssW;
      const ch = p1.canvas.cssH;
      const scale = Math.max(2, Math.min(6, Math.min(Math.round(cw / 130), Math.floor(ch / 124))));
      const vh = ch / scale;
      const groundY = vh - 4.2 * 16;
      p1.geometry = { cssW: cw, cssH: ch, scale, vh: +vh.toFixed(2), groundY: +groundY.toFixed(2), aquariumY: +(groundY - 6.1 * 16).toFixed(2), aquariumH: 1.1 * 16, visibleIfYge0: groundY - 6.1 * 16 >= 0 };
      report.scenarios.P1 = p1;

      // ───────── P2：手机 390×844，全家具 ─────────
      await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await b.send("Page.navigate", { url: URL });
      await waitReady();
      await seedSave(blob({ decor: ALL_DECOR, moyu: 1e6, totalEarned: 1e6, lifetimeEarned: 1e6 }));
      await dismissOverlays();
      const p2 = { viewport: "390x844", colors: {} };
      for (const [k, rgb] of Object.entries(COLORS)) p2.colors[k] = await colorCount(rgb);
      p2.scene = await shot("mobile-aquarium");
      const c2 = await colorCount(COLORS.aquariumWater);
      const scale2 = Math.max(2, Math.min(6, Math.min(Math.round(c2.cssW / 130), Math.floor(c2.cssH / 124))));
      const vh2 = c2.cssH / scale2;
      const groundY2 = vh2 - 4.2 * 16;
      p2.geometry = { cssW: c2.cssW, cssH: c2.cssH, scale: scale2, vh: +vh2.toFixed(2), groundY: +groundY2.toFixed(2), aquariumY: +(groundY2 - 6.1 * 16).toFixed(2), visibleIfYge0: groundY2 - 6.1 * 16 >= 0 };
      report.scenarios.P2 = p2;

      // ───────── P3：余额变化时工位页按钮是否刷新 ─────────
      await b.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await b.send("Page.navigate", { url: URL });
      await waitReady();
      await seedSave(
        blob({
          moyu: 0,
          levels: { retire: 1 }, // 700.2/s，约 4.3 秒攒到 3000
          energy: { date: today(), left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1 } },
        }),
      );
      const p3 = { poll: [] };
      await evj(`document.getElementById('btn-team').click()`);
      await sleep(600);
      await evj(`document.getElementById('tab-decor').click()`);
      await sleep(350);
      const stOpen = await state();
      p3.moneyAtOpen = +stOpen.moyu.toFixed(2);
      p3.hudIdleAtOpen = await evj("document.getElementById('hud-idle').textContent");
      p3.plantAtOpen = await evj(`(() => { const el = document.querySelector('#team-body button[data-act="decor"][data-id="plant"]'); return el ? { disabled: el.disabled, label: el.textContent } : null; })()`);
      for (let i = 0; i < 30; i++) {
        await sleep(200);
        const st = await state();
        const btn = await evj(`(() => { const el = document.querySelector('#team-body button[data-act="decor"][data-id="plant"]'); return el ? { disabled: el.disabled, label: el.textContent } : null; })()`);
        p3.poll.push({ ms: (i + 1) * 200, moyu: +st.moyu.toFixed(2), disabled: btn?.disabled, label: btn?.label });
        if (st.moyu > 3200) break;
      }
      const crossed = p3.poll[p3.poll.length - 1];
      p3.crossed = crossed;
      p3.staleWhileEnough = crossed?.disabled === true;
      // 切换 tab 强制重绘
      await evj(`document.getElementById('tab-colleagues').click()`);
      await sleep(250);
      await evj(`document.getElementById('tab-decor').click()`);
      await sleep(350);
      p3.plantAfterTabSwitch = await evj(`(() => { const el = document.querySelector('#team-body button[data-act="decor"][data-id="plant"]'); return el ? { disabled: el.disabled, label: el.textContent } : null; })()`);
      if (p3.plantAfterTabSwitch && p3.plantAfterTabSwitch.disabled === false) {
        await evj(`document.querySelector('#team-body button[data-act="decor"][data-id="plant"]').click()`);
        await sleep(350);
      }
      p3.decorAfterBuy = (await state()).decor;
      p3.screenshot = await shot("stale-button");
      report.scenarios.P3 = p3;

      // ───────── P4：social 全体好感 +3（实机） ─────────
      await seedSave(
        blob({
          moyu: 1000,
          team: { colleagues: { zhou: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 10, autoRepeat: false, rewardSnapshot: 0 } } },
          energy: { date: today(), left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1 } },
        }),
      );
      await evj(`document.getElementById('btn-team').click()`);
      await sleep(600);
      await evj(`document.getElementById('tab-decor').click()`);
      await sleep(350);
      const p4 = { favorBefore: (await state()).team.colleagues.zhou?.favor };
      await evj(`document.querySelector('#team-body button[data-act="energy"][data-id="social"]').click()`);
      await sleep(400);
      const afterSocial = await state();
      p4.favorAfter = afterSocial.team.colleagues.zhou?.favor;
      p4.energyAfter = afterSocial.energy;
      report.scenarios.P4 = p4;

      report.consoleErrors = b.errors.slice(0, 20);
      report.pageErrors = (await evj("window.__errs")) ?? [];
    } finally {
      b.close();
    }
  },
  { timeoutMs: 180_000, port: 9563 },
);

writeFileSync("playtest/r14-audit-cdp2-report.json", JSON.stringify(report, null, 2));
console.log("R14 CDP2 done:", JSON.stringify(Object.keys(report.scenarios)));
console.log("P1 aquarium water:", JSON.stringify(report.scenarios.P1?.colors?.aquariumWater), "geometry:", JSON.stringify(report.scenarios.P1?.geometry));
console.log("P2 aquarium water:", JSON.stringify(report.scenarios.P2?.colors?.aquariumWater), "geometry:", JSON.stringify(report.scenarios.P2?.geometry));
console.log("P3 staleWhileEnough:", report.scenarios.P3?.staleWhileEnough, "crossed:", JSON.stringify(report.scenarios.P3?.crossed), "afterSwitch:", JSON.stringify(report.scenarios.P3?.plantAfterTabSwitch));
console.log("P4 favor:", JSON.stringify(report.scenarios.P4));