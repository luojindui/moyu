/**
 * R14 收集/装修党试玩探针：工位 8 件家具的"视觉成长" + 每日精力分配。
 * 只访问 dev server，不改 src/。
 * 产出：playtest/r14-shots/*.png + playtest/r14-evidence.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const SHOTS = "playtest/r14-shots";
mkdirSync(SHOTS, { recursive: true });

const OUT = {
  meta: {},
  stages: [],
  buys: [],
  panelBefore: null,
  panelAfter: null,
  energy: {},
  persistence: {},
  crossday: {},
  desktop: {},
  errors: [],
};

const writeB64 = (file, b64) => writeFileSync(file, Buffer.from(b64, "base64"));

await runChrome(
  async ({ port }) => {
    const c = await connect(port);
    const { send, ev } = c;
    OUT.errors = c.errors;

    // ---------- helpers ----------
    const waitFor = async (expr, timeout = 12000, step = 120) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        const v = await ev(expr);
        if (v) return v;
        await sleep(step);
      }
      return null;
    };
    const fullShot = async (file) => {
      const res = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeB64(file, res.data);
    };
    /** 直接读 canvas 像素：不受 HUD / 弹窗遮挡影响，且尺寸稳定，便于像素对比 */
    const canvasPng = async (file) => {
      const d = await ev("document.getElementById('stage').toDataURL('image/png')");
      if (typeof d === "string" && d.startsWith("data:image/png")) writeB64(file, d.slice(d.indexOf(",") + 1));
      return d?.length ?? 0;
    };
    const dismiss = async () => {
      for (let k = 0; k < 4; k++) {
        if (await ev("!document.getElementById('cards').classList.contains('hidden')")) {
          await ev("document.getElementById('cards-skip').click()");
          await sleep(260);
          continue;
        }
        if (await ev("!document.getElementById('welcome').classList.contains('hidden')")) {
          await ev("document.querySelector('#welcome button')?.click()");
          await sleep(260);
          continue;
        }
        break;
      }
    };
    const st = async () => ev("window.__MOYU__.state");
    const hud = async () =>
      ev(`({
        moyu: document.getElementById('hud-moyu').textContent,
        click: document.getElementById('hud-click').textContent,
        idle: document.getElementById('hud-idle').textContent,
        rank: document.getElementById('hud-rank').textContent
      })`);
    const panelOpen = async () => {
      if (await ev("document.getElementById('team').classList.contains('hidden')")) {
        await ev("document.getElementById('btn-team').click()");
        await sleep(300);
      }
      await ev("document.getElementById('tab-decor').click()");
      await sleep(220);
    };
    const panelClose = async () => {
      if (!(await ev("document.getElementById('team').classList.contains('hidden')"))) {
        await ev("document.getElementById('team-close').click()");
        await sleep(200);
      }
    };
    const readPanel = async () =>
      ev(`(() => {
        const body = document.getElementById('team-body');
        const kids = [...body.children];
        const pick = (el) => {
          const btn = el.querySelector('button');
          const r = btn ? btn.getBoundingClientRect() : null;
          return {
            name: el.querySelector('.talent-name')?.textContent ?? '',
            desc: el.querySelector('.talent-desc')?.textContent ?? '',
            dot: el.querySelector('.talent-dot')?.textContent ?? '',
            btnText: btn?.textContent ?? null,
            btnDisabled: btn ? btn.disabled : null,
            btnRect: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
          };
        };
        const energy = [...body.querySelectorAll('.branch .talent')].map(pick);
        const decor = kids.filter((k) => k.classList.contains('talent')).map(pick);
        return {
          summary: body.querySelector('.team-summary')?.textContent?.trim() ?? '',
          energyTitle: body.querySelector('.branch h3')?.textContent?.trim() ?? '',
          energy,
          decor,
          imagesInPanel: body.querySelectorAll('img,svg,canvas,picture').length,
          bodyText: body.innerText.replace(/\\n+/g, ' | ').slice(0, 4000),
          scrollHeight: body.scrollHeight,
          clientHeight: body.clientHeight,
        };
      })()`);

    // ---------- boot ----------
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
    await waitFor("!!window.__MOYU__ && !!window.__MOYU__.state", 15000);
    // 等精灵资源加载完（避免占位色块干扰视觉判定）
    await waitFor(
      "(() => { const a = window.__MOYU__.assets; if (!a) return false; const vs = Object.values(a); return vs.length > 0 && vs.every(v => v === 'loaded'); })()",
      15000,
    );
    await sleep(900);
    await dismiss();
    await sleep(300);

    const geometry = await ev(`(() => {
      const el = document.getElementById('stage');
      const w = el.clientWidth, h = el.clientHeight;
      const u = 16;
      const scale = Math.max(2, Math.min(6, Math.min(Math.round(w / 130), Math.floor(h / 124))));
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const vw = w / scale, vh = h / scale, groundY = vh - 4.2 * u;
      const f = scale * dpr; // 虚拟坐标 -> canvas 像素
      const rect = (x, y, ww, hh) => ({
        x: Math.round(x * f), y: Math.round(y * f), w: Math.round(ww * f), h: Math.round(hh * f),
      });
      const regions = {
        plant: rect(0.4*u, groundY - 2.7*u, 1.9*u, 2.7*u),
        lamp: rect(vw/2 + 0.5*u, groundY - 4.0*u, 3.0*u, 2.7*u),
        rug: rect(vw/2 - 3.3*u, groundY + 0.9*u, 6.6*u, 1.9*u),
        fridge: rect(0, groundY - 2.25*u, 1.5*u, 2.25*u),
        chair: rect(vw/2 + 1.7*u, groundY - 1.9*u, 1.8*u, 1.9*u),
        aquarium: rect(vw - 3.2*u, groundY - 6.4*u, 2.1*u, 1.8*u),
        projector: rect(vw/2 - 1.6*u, 0, 3.4*u, 2.2*u),
        catbed: rect(vw/2 - 0.9*u, groundY - 1.1*u, 2.3*u, 1.1*u),
        clock: rect(vw - 2.8*u, 1.1*u, 1.9*u, 1.9*u),
        cooler: rect(vw - 1.95*u, groundY - 1.1*u, 1.1*u, 1.1*u),
        pendant: rect(vw/2 - 0.95*u, 0.95*u, 1.9*u, 0.55*u),
        board: rect(vw - 3.9*u, groundY - 4.4*u, 2.5*u, 1.6*u),
      };
      const rects = {
        plantPot: [0.9*u, groundY - 0.85*u, 1.05*u, 0.85*u],
        plantLeaves: [0.52*u, groundY - 2.49*u, 1.4*u, 1.7*u],
        fridge: [0.2*u, groundY - 2.05*u, 1.0*u, 2.05*u],
        chair: [vw/2 + 1.95*u, groundY - 1.61*u, 1.25*u, 1.61*u],
        aquarium: [vw - 2.97*u, groundY - 6.2*u, 1.64*u, 1.5*u],
        clockBox: [vw - 2.62*u, 2*u - 0.72*u, 1.44*u, 1.44*u],
        projector: [vw/2 - 1.3*u, 1.1*u, 2.0*u, 0.75*u],
        pendantShade: [vw/2 - 0.9*u, 1*u, 1.8*u, 0.42*u],
        coolerBox: [vw - 1.9*u, groundY - 1.05*u, 1.0*u, 1.0*u],
        catbed: [vw/2 - 0.6*u, groundY - 0.75*u, 1.5*u, 0.77*u],
      };
      const inter = (a, b) => {
        const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
        const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
        return x2 > x1 && y2 > y1 ? { w: +(x2 - x1).toFixed(1), h: +(y2 - y1).toFixed(1) } : null;
      };
      const overlaps = {
        '冰箱×绿萝': inter(rects.fridge, rects.plantPot),
        '鱼缸×挂钟': inter(rects.aquarium, rects.clockBox),
        '投影仪×吊灯': inter(rects.projector, rects.pendantShade),
        '按摩椅×饮水机': inter(rects.chair, rects.coolerBox),
        '猫窝×猫窝区(地面)': inter(rects.catbed, rects.catbed),
      };
      return {
        viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
        canvas: { cssW: w, cssH: h, pxW: el.width, pxH: el.height, scale, dpr, vw, vh, groundY },
        f,
        regions,
        overlaps,
      };
    })()`);
    OUT.meta.geometry = geometry;
    OUT.meta.viewport = await ev("({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })");

    const stage = async (id, label) => {
      await dismiss();
      await panelClose();
      await sleep(2200); // 等 toast / 飘字消失，避免干扰截图
      const s = await st();
      const h = await hud();
      const layer = {
        id,
        label,
        decor: s.decor,
        decorCount: s.decor.length,
        moyu: s.moyu,
        hud: h,
        hintVisible: await ev("window.__MOYU__.frames > 0"),
      };
      await fullShot(`${SHOTS}/${id}-full.png`);
      await canvasPng(`${SHOTS}/${id}-canvas.png`);
      await sleep(380);
      await canvasPng(`${SHOTS}/${id}-canvas-b.png`);
      OUT.stages.push(layer);
      return layer;
    };

    // ---------- 阶段 0：初始（0 装修） ----------
    await stage("s0-initial", "初始（0 装修，未加钱）");

    // 面板：买前
    await panelOpen();
    OUT.panelBefore = await readPanel();
    await fullShot(`${SHOTS}/panel-decor-before.png`);
    await ev("document.getElementById('team-body').scrollTop = 1e6");
    await sleep(200);
    await fullShot(`${SHOTS}/panel-decor-before-bottom.png`);
    await ev("document.getElementById('team-body').scrollTop = 0");
    await sleep(150);
    await panelClose();

    // ---------- 加钱（0 装修的公平基线） ----------
    await ev("window.__MOYU__.grant(1e10)");
    await sleep(2600); // 等段位/天赋 toast
    await dismiss();
    OUT.grant = { state: await st(), hud: await hud() };
    await stage("s1-grant-nobuy", "已加钱（1e10）但 0 装修");
    await canvasPng(`${SHOTS}/s1-canvas-c.png`);

    // ---------- 逐件购买 ----------
    const ORDER = ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"];
    for (let i = 0; i < ORDER.length; i++) {
      const id = ORDER[i];
      await dismiss();
      await panelOpen();
      await ev("document.getElementById('team-body').scrollTop = 1e6");
      await sleep(160);
      await ev(`document.querySelector('button[data-act="decor"][data-id="${id}"]')?.scrollIntoView({block:'center'})`);
      await sleep(160);
      const before = await st();
      const btn = await ev(`(() => {
        const b = document.querySelector('button[data-act="decor"][data-id="${id}"]');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        const row = b.closest('.talent')?.getBoundingClientRect();
        return { text: b.textContent, disabled: b.disabled, w: Math.round(r.width), h: Math.round(r.height),
                 rowH: row ? Math.round(row.height) : null, vw: innerWidth };
      })()`);
      await canvasPng(`${SHOTS}/buy-${String(i + 1).padStart(2, "0")}-${id}-canvas-before.png`);
      await ev(`document.querySelector('button[data-act="decor"][data-id="${id}"]').click()`);
      await sleep(260);
      const toast = await ev(`(() => {
        const el = document.getElementById('dom-toast');
        const r = el.getBoundingClientRect();
        return { text: el.textContent, shown: el.classList.contains('show'), y: Math.round(r.y), h: Math.round(r.height) };
      })()`);
      const after = await st();
      const panelRowOwned = await ev(`(() => {
        const rows = [...document.querySelectorAll('#team-body > .talent')];
        const row = rows.find(r => r.querySelector('.talent-name')?.textContent === ${JSON.stringify(
          { plant: "绿萝", lamp: "护眼台灯", rug: "毛绒地毯", fridge: "迷你冰箱", chair: "按摩椅", aquarium: "鱼缸", projector: "投影仪", catbed: "工位猫窝" }[id],
        )});
        return row ? { dot: row.querySelector('.talent-dot')?.textContent ?? '', hasButton: !!row.querySelector('button') } : null;
      })()`);
      // 面板还开着时场景已经更新？（canvas 不受弹窗遮挡）
      await canvasPng(`${SHOTS}/buy-${String(i + 1).padStart(2, "0")}-${id}-canvas-behind-panel.png`);
      if (i === 0) await fullShot(`${SHOTS}/panel-buy-toast.png`);
      await panelClose();
      await sleep(2150);
      await canvasPng(`${SHOTS}/buy-${String(i + 1).padStart(2, "0")}-${id}-canvas-after.png`);
      await sleep(380);
      await canvasPng(`${SHOTS}/buy-${String(i + 1).padStart(2, "0")}-${id}-canvas-after-b.png`);
      await fullShot(`${SHOTS}/buy-${String(i + 1).padStart(2, "0")}-${id}-full.png`);
      OUT.buys.push({
        i: i + 1,
        id,
        btnText: btn?.text,
        buyBtnRect: btn ? { w: btn.w, h: btn.h } : null,
        rowH: btn?.rowH,
        disabledBefore: btn?.disabled ?? null,
        moneyBefore: before.moyu,
        moneyAfter: after.moyu,
        spent: before.moyu - after.moyu,
        decorBefore: before.decor,
        decorAfter: after.decor,
        toast,
        panelRowOwned,
        sceneCanvasBytes: { before: null, after: null },
      });
    }

    // 前 3 件买完的显式阶段（可比对）
    OUT.stagesBuy3 = {
      label: "买完前 3 件（绿萝/台灯/地毯）",
      files: [`${SHOTS}/buy-03-rug-full.png`, `${SHOTS}/buy-03-rug-canvas-after.png`],
      decor: OUT.buys[2]?.decorAfter,
    };

    // ---------- 全买完 ----------
    await panelOpen();
    await ev("document.getElementById('team-body').scrollTop = 0");
    await sleep(250);
    await fullShot(`${SHOTS}/panel-decor-all-top.png`);
    OUT.panelAfter = await readPanel();
    OUT.panelAfter.hud = await hud();
    await ev("document.getElementById('team-body').scrollTop = 1e6");
    await sleep(250);
    await fullShot(`${SHOTS}/panel-decor-all-bottom.png`);
    await ev("document.getElementById('team-body').scrollTop = 0");
    await sleep(150);
    await panelClose();
    await stage("s3-all", "8 件全买");
    // 全买后连续帧（估算动画噪声）
    await canvasPng(`${SHOTS}/s3-canvas-c.png`);
    await sleep(400);
    await canvasPng(`${SHOTS}/s3-canvas-d.png`);

    // ---------- 每日精力 ----------
    await dismiss();
    await panelOpen();
    await ev("document.getElementById('team-body').scrollTop = 0");
    await sleep(250);
    const energyBefore = await st();
    const hudBefore = await hud();
    OUT.energy = {
      before: { energy: energyBefore.energy, hud: hudBefore },
      actions: [],
      panelScreenshotBefore: `${SHOTS}/panel-energy-before.png`,
    };
    await fullShot(`${SHOTS}/panel-energy-before.png`);
    await canvasPng(`${SHOTS}/energy-canvas-before.png`);
    for (const [act, label] of [
      ["slack", "认真摸鱼"],
      ["fake-work", "假装工作"],
      ["social", "跟同事聊天"],
    ]) {
      const btn = await ev(`(() => {
        const b = document.querySelector('button[data-act="energy"][data-id="${act}"]');
        if (!b) return null;
        b.scrollIntoView({ block: 'center' });
        const r = b.getBoundingClientRect();
        return { text: b.textContent, disabled: b.disabled, w: Math.round(r.width), h: Math.round(r.height) };
      })()`);
      await sleep(160);
      await ev(`document.querySelector('button[data-act="energy"][data-id="${act}"]').click()`);
      await sleep(280);
      const s = await st();
      const toast = await ev(`(() => { const el = document.getElementById('dom-toast'); return { text: el.textContent, shown: el.classList.contains('show') }; })()`);
      const hudNow = await hud();
      const panelNow = await readPanel();
      OUT.energy.actions.push({
        act,
        label,
        btn,
        energy: s.energy,
        hud: hudNow,
        toast,
        panelEnergyTitle: panelNow.energyTitle,
        energyRows: panelNow.energy.map((r) => ({ name: r.name, dot: r.dot, btnText: r.btnText, disabled: r.btnDisabled })),
      });
      await fullShot(`${SHOTS}/panel-energy-after-${act}.png`);
    }
    OUT.energy.after = { energy: (await st()).energy, hud: await hud() };
    await fullShot(`${SHOTS}/panel-energy-after.png`);
    // 使用精力后：场景是否变化（从像素看应无变化，只有动画噪声）
    await panelClose();
    await sleep(2100);
    await canvasPng(`${SHOTS}/energy-canvas-after.png`);
    await fullShot(`${SHOTS}/energy-full-after.png`);
    await canvasPng(`${SHOTS}/energy-canvas-after-b.png`);
    await sleep(380);
    await canvasPng(`${SHOTS}/energy-canvas-after-c.png`);

    // ---------- 持久化：刷新后装修/精力是否保留 ----------
    await ev("window.__MOYU__.saveNow()");
    await sleep(300);
    await ev("location.reload()");
    await waitFor("!!window.__MOYU__ && !!window.__MOYU__.state", 15000);
    await waitFor(
      "(() => { const a = window.__MOYU__.assets; if (!a) return false; const vs = Object.values(a); return vs.length > 0 && vs.every(v => v === 'loaded'); })()",
      15000,
    );
    await sleep(900);
    await dismiss();
    OUT.persistence = {
      state: await st(),
      hud: await hud(),
    };
    OUT.persistence.decorCount = OUT.persistence.state.decor.length;
    OUT.persistence.energy = OUT.persistence.state.energy;
    await sleep(600);
    await canvasPng(`${SHOTS}/persist-canvas.png`);
    await fullShot(`${SHOTS}/persist-full.png`);

    // ---------- 跨日重置：把存档 energy.date 改成昨天，刷新应重置为 100 ----------
    const patched = await ev(`(() => {
      const raw = JSON.parse(localStorage.getItem('moyu-save') || 'null');
      if (!raw) return null;
      raw.energy.date = '2000-01-01';
      raw.savedAt = Date.now();
      localStorage.setItem('moyu-save', JSON.stringify(raw));
      return { energy: raw.energy, decor: raw.decor };
    })()`);
    OUT.crossday.patched = patched;
    await ev("location.reload()");
    await waitFor("!!window.__MOYU__ && !!window.__MOYU__.state", 15000);
    await waitFor(
      "(() => { const a = window.__MOYU__.assets; if (!a) return false; const vs = Object.values(a); return vs.length > 0 && vs.every(v => v === 'loaded'); })()",
      15000,
    );
    await sleep(1200);
    await dismiss();
    OUT.crossday.energy = (await st()).energy;
    OUT.crossday.decor = (await st()).decor;
    OUT.crossday.hud = await hud();
    await fullShot(`${SHOTS}/crossday-full.png`);

    // ---------- 桌面视口：家具位置是否变形/扎堆 ----------
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(900);
    await dismiss();
    OUT.desktop.geometry = await ev(`(() => {
      const el = document.getElementById('stage');
      const w = el.clientWidth, h = el.clientHeight;
      const scale = Math.max(2, Math.min(6, Math.min(Math.round(w / 130), Math.floor(h / 124))));
      return { cssW: w, cssH: h, scale, pxW: el.width, pxH: el.height };
    })()`);
    await sleep(500);
    await fullShot(`${SHOTS}/desktop-all-full.png`);
    await canvasPng(`${SHOTS}/desktop-all-canvas.png`);

    // ---------- 收尾 ----------
    OUT.meta.errorsAfter = c.errors.slice();
    OUT.meta.finalHud = await hud();
    // 恢复成移动视口便于人工复看
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  },
  { timeoutMs: 240_000 },
);

writeFileSync("playtest/r14-evidence.json", JSON.stringify(OUT, null, 2));
console.log("done. stages:", OUT.stages.length, "buys:", OUT.buys.length, "errors:", OUT.errors.length);
console.log("energy:", JSON.stringify(OUT.energy.before?.energy), "->", JSON.stringify(OUT.energy.after?.energy));
console.log("crossday:", JSON.stringify(OUT.crossday?.energy));