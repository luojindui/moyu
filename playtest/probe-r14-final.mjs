/**
 * R14 收尾探针（当前工作区版本）：三阶段截图 + 当前工位/精力 UI + 一键全用。
 * 只访问 dev server，不改 src/。
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
    const hud = async () => ev(`({ moyu: document.getElementById('hud-moyu').textContent, idle: document.getElementById('hud-idle').textContent, click: document.getElementById('hud-click').textContent, rank: document.getElementById('hud-rank').textContent, teamBtn: document.getElementById('btn-team').textContent, teamAria: document.getElementById('btn-team').getAttribute('aria-label') })`);
    const dismiss = async () => {
      for (let k = 0; k < 4; k++) {
        if (await ev("!document.getElementById('cards').classList.contains('hidden')")) {
          await ev("document.getElementById('cards-skip').click()"); await sleep(250); continue;
        }
        if (await ev("!document.getElementById('welcome').classList.contains('hidden')")) {
          await ev("document.querySelector('#welcome button')?.click()"); await sleep(250); continue;
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
    const canvasPng = async (file) => {
      const d = await ev("document.getElementById('stage').toDataURL('image/png')");
      if (typeof d === "string" && d.startsWith("data:image/png")) writeB64(file, d.slice(d.indexOf(",") + 1));
    };
    const panelOpen = async () => {
      if (await ev("document.getElementById('team').classList.contains('hidden')")) {
        await ev("document.getElementById('btn-team').click()"); await sleep(320);
      }
      await ev("document.getElementById('tab-decor').click()"); await sleep(240);
    };
    const panelClose = async () => {
      if (!(await ev("document.getElementById('team').classList.contains('hidden')"))) {
        await ev("document.getElementById('team-close').click()"); await sleep(220);
      }
    };
    const panelText = async () => ev(`document.getElementById('team-body').innerText.replace(/\\n+/g,' | ')`);

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
    await boot();

    // 阶段 0：初始
    await dismiss(); await sleep(700);
    OUT.stage0 = { state: await st(), hud: await hud() };
    await fullShot(`${SHOTS}/final-s0-initial-full.png`);
    await canvasPng(`${SHOTS}/final-s0-initial-canvas.png`);

    // 空工位面板（当前版本）
    await panelOpen();
    OUT.panelEmpty = { text: await panelText(), hud: await hud() };
    OUT.panelEmpty.decorSummaryEl = await ev("document.getElementById('decor-summary')?.textContent ?? null");
    await fullShot(`${SHOTS}/final-panel-empty.png`);
    await ev("document.getElementById('team-body').scrollTop = 1e6"); await sleep(200);
    await fullShot(`${SHOTS}/final-panel-empty-bottom.png`);
    await ev("document.getElementById('team-body').scrollTop = 0"); await sleep(150);
    await panelClose();

    // 加钱
    await ev("window.__MOYU__.grant(1e10)");
    await sleep(2600); await dismiss();
    OUT.stage1 = { state: await st(), hud: await hud() };
    await fullShot(`${SHOTS}/final-s1-grant-nobuy-full.png`);
    await canvasPng(`${SHOTS}/final-s1-grant-nobuy-canvas.png`);

    // 买前 3 件
    const buy = async (ids) => {
      for (const id of ids) {
        await panelOpen();
        await ev(`document.querySelector('button[data-act="decor"][data-id="${id}"]')?.scrollIntoView({block:'center'})`);
        await sleep(160);
        await ev(`document.querySelector('button[data-act="decor"][data-id="${id}"]').click()`);
        await sleep(300);
        const toast = await ev(`(() => { const el=document.getElementById('dom-toast'); return {text: el.textContent, shown: el.classList.contains('show')}; })()`);
        OUT[`buy_${id}`] = { toast, state: await st() };
        await panelClose();
        await sleep(400);
      }
    };
    await buy(["plant", "lamp", "rug"]);
    await sleep(2000); await dismiss();
    OUT.stage3 = { state: await st(), hud: await hud() };
    await fullShot(`${SHOTS}/final-s2-buy3-full.png`);
    await canvasPng(`${SHOTS}/final-s2-buy3-canvas.png`);

    // 买剩下 5 件
    await buy(["fridge", "chair", "aquarium", "projector", "catbed"]);
    await sleep(2200); await dismiss();
    OUT.stageAll = { state: await st(), hud: await hud() };
    await fullShot(`${SHOTS}/final-s3-all-full.png`);
    await canvasPng(`${SHOTS}/final-s3-all-canvas.png`);

    // 全买后打开面板：8/8 是否有完成反馈
    await panelOpen();
    OUT.panelAll = { text: await panelText(), hud: await hud() };
    OUT.panelAll.toastAfterCatbed = OUT.buy_catbed?.toast;
    OUT.panelAll.decorSummaryEl = await ev("document.getElementById('decor-summary')?.textContent ?? null");
    OUT.panelAll.oneClickEnergy = await ev(`(() => { const b=document.querySelector('button[data-act="energy-all"]'); return b ? {text:b.textContent, disabled:b.disabled} : null; })()`);
    await fullShot(`${SHOTS}/final-panel-all.png`);
    await ev("document.getElementById('team-body').scrollTop = 1e6"); await sleep(200);
    await fullShot(`${SHOTS}/final-panel-all-bottom.png`);
    await ev("document.getElementById('team-body').scrollTop = 0"); await sleep(150);

    // 一键全用
    const energyBefore = (await st()).energy;
    await ev(`document.querySelector('button[data-act="energy-all"]')?.click()`);
    await sleep(400);
    const energyAfter = (await st()).energy;
    OUT.energyOneClick = {
      before: energyBefore,
      after: energyAfter,
      toast: await ev(`document.getElementById('dom-toast').textContent`),
      idleHud: (await hud()).idle,
      oneClickBtnAfter: await ev(`(() => { const b=document.querySelector('button[data-act="energy-all"]'); return b ? {text:b.textContent, disabled:b.disabled} : null; })()`),
    };
    await fullShot(`${SHOTS}/final-panel-energy-oneclick.png`);
    await panelClose();

    // 精力是否让场景有任何视觉变化（应无）
    await sleep(1800);
    await canvasPng(`${SHOTS}/final-energy-canvas-after.png`);
    await fullShot(`${SHOTS}/final-s3-all-energy-used-full.png`);

    // HUD 精力角标是否可见（截图区域放大由外部处理）
    OUT.finalHud = await hud();
    OUT.finalState = await st();
    OUT.offscreen = await ev(`(() => { const b=document.getElementById('btn-team').getBoundingClientRect(); const eb=document.querySelector('#btn-team .energy-badge'); return { btn: {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}, energyBadge: eb ? {text: eb.textContent, rect: (r=>({x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}))(eb.getBoundingClientRect())} : null }; })()`);
    OUT.errors = c.errors.slice();
    OUT.srcSnapshot = { gitHead: null };
  },
  { timeoutMs: 180_000 },
);

writeFileSync("playtest/r14-evidence3.json", JSON.stringify(OUT, null, 2));
console.log(JSON.stringify({ stage0hud: OUT.stage0?.hud, stage1hud: OUT.stage1?.hud, panelEmpty: OUT.panelEmpty?.text?.slice(0,600), energyOneClick: OUT.energyOneClick, finalHud: OUT.finalHud, offscreen: OUT.offscreen }, null, 1));
console.log("errors:", OUT.errors);