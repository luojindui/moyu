/**
 * R14 补充探针：跨日精力重置 + 精力使用后 UI 状态 + 桌面/移动布局差异。
 * 只访问 dev server，不改 src/。用 runChrome 保证 Chrome 必被杀。
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
      while (Date.now() - t0 < timeout) {
        const v = await ev(expr);
        if (v) return v;
        await sleep(step);
      }
      return null;
    };
    const st = async () => ev("window.__MOYU__.state");
    const hud = async () => ev(`({ moyu: document.getElementById('hud-moyu').textContent, idle: document.getElementById('hud-idle').textContent, click: document.getElementById('hud-click').textContent })`);
    const dismiss = async () => {
      for (let k = 0; k < 4; k++) {
        if (await ev("!document.getElementById('cards').classList.contains('hidden')")) {
          await ev("document.getElementById('cards-skip').click()"); await sleep(260); continue;
        }
        if (await ev("!document.getElementById('welcome').classList.contains('hidden')")) {
          await ev("document.querySelector('#welcome button')?.click()"); await sleep(260); continue;
        }
        break;
      }
    };
    const boot = async () => {
      await waitFor("!!window.__MOYU__ && !!window.__MOYU__.state", 15000);
      await waitFor("(() => { const a = window.__MOYU__.assets; if (!a) return false; const vs = Object.values(a); return vs.length > 0 && vs.every(v => v === 'loaded'); })()", 15000);
      await sleep(800);
      await dismiss();
    };
    const fullShot = async (file) => {
      const res = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeB64(file, res.data);
    };
    const panelOpen = async () => {
      if (await ev("document.getElementById('team').classList.contains('hidden')")) {
        await ev("document.getElementById('btn-team').click()"); await sleep(300);
      }
      await ev("document.getElementById('tab-decor').click()"); await sleep(220);
    };
    const panelText = async () => ev(`document.getElementById('team-body').innerText.replace(/\\n+/g,' | ')`);

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
    await boot();

    // 1) 今日精力全用掉（不买家具，保持"新玩家"状态）
    await ev("window.__MOYU__.grant(1e8)");
    await sleep(1500);
    await dismiss();
    await panelOpen();
    const before = (await st()).energy;
    for (const act of ["slack", "fake-work", "social"]) {
      await ev(`document.querySelector('button[data-act="energy"][data-id="${act}"]')?.click()`);
      await sleep(260);
    }
    const afterUse = (await st()).energy;
    OUT.energyBefore = before;
    OUT.energyAfterUse = afterUse;
    OUT.panelTextAfterUse = await panelText();
    OUT.hudAfterUse = await hud();
    await fullShot(`${SHOTS}/panel-energy-all-used.png`);
    await ev("document.getElementById('team-close').click()");
    await sleep(300);

    // 2) 存档并"跨日"：用 addScriptToEvaluateOnNewDocument 在页面脚本前把 energy.date 改成昨天
    await ev("window.__MOYU__.saveNow()");
    await sleep(300);
    const raw = await ev("JSON.parse(localStorage.getItem('moyu-save'))");
    OUT.savedEnergy = raw?.energy;
    const script = await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { const raw = JSON.parse(localStorage.getItem('moyu-save') || 'null');
        if (raw && raw.energy) { raw.energy.date = '2000-01-01'; raw.savedAt = Date.now(); localStorage.setItem('moyu-save', JSON.stringify(raw)); } } catch (e) {}`,
    });
    OUT.patchScriptId = script.identifier;
    await ev("location.reload()");
    await boot();
    await sleep(1200); // 等主循环 ensureEnergy
    const s = await st();
    OUT.crossday = {
      energy: s.energy,
      hud: await hud(),
      decor: s.decor,
    };
    await panelOpen();
    OUT.crossday.panelText = await panelText();
    await fullShot(`${SHOTS}/crossday-energy-panel.png`);
    await ev("document.getElementById('team-close').click()");
    await sleep(200);

    // 3) 能量使用是否可重入（同日不能重复用同一项）
    await ev("window.__MOYU__.grant(1e8)");
    await sleep(400);
    await panelOpen();
    await ev(`document.querySelector('button[data-act="energy"][data-id="slack"]')?.click()`);
    await sleep(250);
    const once = (await st()).energy;
    const btnAfter = await ev(`(() => { const b=document.querySelector('button[data-act="energy"][data-id="slack"]'); return b ? {exists:true, disabled:b.disabled} : {exists:false}; })()`);
    OUT.energyRepeat = { once, slackButtonAfterUse: btnAfter };

    // 4) 面板遮罩挡住场景 → 证明"购买后必须关面板才看得到"
    OUT.overlay = await ev(`(() => {
      const team = document.getElementById('team');
      const bg = getComputedStyle(team).backgroundColor;
      const stage = document.getElementById('stage').getBoundingClientRect();
      const panel = document.querySelector('.team-panel').getBoundingClientRect();
      return { teamBg: bg, stage: {x:Math.round(stage.x),y:Math.round(stage.y),w:Math.round(stage.width),h:Math.round(stage.height)},
               panel: {x:Math.round(panel.x),y:Math.round(panel.y),w:Math.round(panel.width),h:Math.round(panel.height)},
               panelCoversStagePct: Math.round(100*panel.width*panel.height/(stage.width*stage.height)) };
    })()`);

    // 5) 工位 tab 是否只在 👥 内可见：列出所有可能入口
    OUT.entries = await ev(`(() => {
      const ids = ['btn-team','btn-journal','btn-mute'];
      const out = {};
      for (const id of ids) { const el=document.getElementById(id); out[id]= el ? {aria: el.getAttribute('aria-label'), text: el.textContent} : null; }
      const hud = document.getElementById('hud').innerText;
      return { buttons: out, hudText: hud.replace(/\\n+/g,' | '), mentionsEnergy: /精力/.test(document.body.innerText),
               hasDecorRedDot: !!document.querySelector('#btn-team .badge, #btn-team .talent-badge') };
    })()`);
    await fullShot(`${SHOTS}/hud-entry.png`);

    // 6) 桌面已购布局截图（刷新后仍是 390x844，改为 1280x800 再看）
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(800);
    await dismiss();
    await fullShot(`${SHOTS}/desktop-panel.png`);
    const d = await ev("window.__MOYU__.state");
    OUT.desktopState = { decor: d.decor, energy: d.energy };
    // 关闭面板后场景
    if (!(await ev("document.getElementById('team').classList.contains('hidden')"))) {
      await ev("document.getElementById('team-close').click()");
      await sleep(300);
    }
    await fullShot(`${SHOTS}/desktop-scene.png`);

    // 7) 移动端小屏 320x568（最窄）布局：家具会不会更挤
    await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
    await sleep(800);
    await fullShot(`${SHOTS}/mobile-320-scene.png`);
    OUT.mobile320 = await ev(`(() => {
      const el = document.getElementById('stage');
      const w = el.clientWidth, h = el.clientHeight;
      const scale = Math.max(2, Math.min(6, Math.min(Math.round(w / 130), Math.floor(h / 124))));
      return { cssW:w, cssH:h, scale, vw: w/scale, vh: h/scale, groundY: h/scale - 4.2*16 };
    })()`);
    OUT.errors = c.errors.slice();
  },
  { timeoutMs: 180_000 },
);

writeFileSync("playtest/r14-evidence2.json", JSON.stringify(OUT, null, 2));
console.log(JSON.stringify({ crossday: OUT.crossday?.energy, energyAfterUse: OUT.energyAfterUse, entries: OUT.entries, overlay: OUT.overlay, mobile320: OUT.mobile320 }, null, 1));
console.log("errors:", OUT.errors);