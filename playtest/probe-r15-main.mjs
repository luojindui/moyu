/**
 * R15 批次3 复验·主流程（390x844 手机）：
 *  ① 三阶段截图（初始 / 前3件 / 全8件）+ 逐件购买后截图（含 8/8 庆祝 toast）
 *  ② 8/8 完成加成（面板 ×1.58）+ 精力 4 选取舍（合计145>100，省心组合）
 *  ③ 离线家具实测：rug+chair vs 无家具，1h 回拨离线收益比（期望 ≈1.13）
 * 只访问 dev server，不改 src/。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const SHOTS = "playtest/r15-shots";
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
    const hud = async () => ev(`({
      moyu: document.getElementById('hud-moyu').textContent,
      click: document.getElementById('hud-click').textContent,
      idle: document.getElementById('hud-idle').textContent,
      rank: document.getElementById('hud-rank').textContent,
      teamBtn: document.getElementById('btn-team').textContent,
      teamAria: document.getElementById('btn-team').getAttribute('aria-label')
    })`);
    const dismiss = async () => {
      for (let k = 0; k < 5; k++) {
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
      await sleep(900);
      await dismiss();
    };
    const fullShot = async (file) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeB64(file, r.data); };
    const canvasPng = async (file) => {
      const d = await ev("document.getElementById('stage').toDataURL('image/png')");
      if (typeof d === "string" && d.startsWith("data:image/png")) writeB64(file, d.slice(d.indexOf(",") + 1));
    };
    const toast = async () => ev(`(() => { const el = document.getElementById('dom-toast'); return { text: el.textContent, shown: el.classList.contains('show') }; })()`);
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
    const readPanel = async () => ev(`(() => {
      const body = document.getElementById('team-body');
      const kids = [...body.children];
      const pick = (el) => {
        const btn = el.querySelector('button');
        const r = btn ? btn.getBoundingClientRect() : null;
        return { name: el.querySelector('.talent-name')?.textContent ?? '',
                 desc: el.querySelector('.talent-desc')?.textContent ?? '',
                 dot: el.querySelector('.talent-dot')?.textContent ?? '',
                 btnText: btn?.textContent ?? null, btnDisabled: btn ? btn.disabled : null,
                 btnRect: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null };
      };
      return {
        summary: body.querySelector('.team-summary')?.textContent?.trim() ?? '',
        energyTitle: body.querySelector('.branch h3')?.textContent?.trim() ?? '',
        energy: [...body.querySelectorAll('.branch .talent')].map(pick),
        decor: kids.filter((k) => k.classList.contains('talent')).map(pick),
        buttons: [...body.querySelectorAll('button')].map((b) => ({ act: b.dataset.act, id: b.dataset.id ?? '', text: b.textContent.trim(), disabled: b.disabled })),
        text: body.innerText.replace(/\\n+/g, ' | ').slice(0, 4000),
      };
    })()`);

    // ---------- 启动 390x844 ----------
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
    await boot();
    await sleep(400);

    // 阶段 0：真初始
    OUT.s0 = { state: await st(), hud: await hud(), canvas: await ev("(() => { const e=document.getElementById('stage'); return {w:e.width,h:e.height,cw:e.clientWidth,ch:e.clientHeight}; })()") };
    await fullShot(`${SHOTS}/s0-initial-full.png`);
    await canvasPng(`${SHOTS}/s0-initial-canvas.png`);

    // 加钱 → 0 装修基线（同时 quest 栏消失，画布尺寸稳定）
    await ev("window.__MOYU__.grant(1e11)");
    await sleep(2800);
    await dismiss();
    OUT.baseline = { state: await st(), hud: await hud() };
    await fullShot(`${SHOTS}/b0-nobuy-full.png`);
    await canvasPng(`${SHOTS}/b0-nobuy-canvas.png`);
    await sleep(380);
    await canvasPng(`${SHOTS}/b0-nobuy-canvas-b.png`);

    // ---------- 面板：买前 + 精力 4 选 ----------
    await panelOpen();
    OUT.panelBefore = await readPanel();
    await fullShot(`${SHOTS}/panel-before.png`);
    await ev("document.getElementById('team-body').scrollTop = 1e6");
    await sleep(220); await fullShot(`${SHOTS}/panel-before-bottom.png`);
    await ev("document.getElementById('team-body').scrollTop = 0"); await sleep(160);

    // 招募一位同事（社交项需要同事；省心组合也需要）
    await ev("document.getElementById('tab-colleagues').click()"); await sleep(320);
    OUT.recruit = await ev(`(() => {
      const btns = [...document.querySelectorAll('button[data-act="recruit"]')];
      const b = btns.find((x) => !x.disabled);
      if (!b) return { ok: false, total: btns.length, disabled: btns.map(x=>x.disabled) };
      const t = b.textContent.trim(); b.click();
      return { ok: true, btn: t };
    })()`);
    await sleep(600);
    OUT.recruit.colleagues = await ev("Object.keys(window.__MOYU__.state.team.colleagues).length");
    await ev("document.getElementById('tab-decor').click()"); await sleep(260);

    // 精力：4 项 145 → 100，省心组合（100）
    OUT.energyBefore = { state: (await st()).energy, hud: await hud(), panel: await readPanel() };
    await fullShot(`${SHOTS}/panel-energy-4actions.png`);
    OUT.energyComboBtn = await ev(`(() => { const b = document.querySelector('button[data-act="energy-all"]'); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null; })()`);
    await ev(`document.querySelector('button[data-act="energy-all"]')?.click()`);
    await sleep(450);
    OUT.energyAfterCombo = {
      state: (await st()).energy,
      toast: await toast(),
      hud: await hud(),
      buttons: await ev(`[...document.querySelectorAll('button[data-act="energy"]')].map(b => ({ id: b.dataset.id, disabled: b.disabled }))`),
      panel: await readPanel(),
    };
    await fullShot(`${SHOTS}/panel-energy-after-combo.png`);

    // ---------- 逐件购买（前 3 件 + 全部） ----------
    const ORDER = ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"];
    OUT.buys = [];
    for (let i = 0; i < ORDER.length; i++) {
      const id = ORDER[i];
      await dismiss();
      await panelOpen();
      await ev("document.getElementById('team-body').scrollTop = 1e6"); await sleep(150);
      await ev(`document.querySelector('button[data-act="decor"][data-id="${id}"]')?.scrollIntoView({block:'center'})`);
      await sleep(150);
      const before = await st();
      const btn = await ev(`(() => { const b = document.querySelector('button[data-act="decor"][data-id="${id}"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { text: b.textContent, disabled: b.disabled, w: Math.round(r.width), h: Math.round(r.height) }; })()`);
      await canvasPng(`${SHOTS}/buy-${i + 1}-${id}-before.png`);
      await ev(`document.querySelector('button[data-act="decor"][data-id="${id}"]').click()`);
      await sleep(300);
      const t = await toast();
      const after = await st();
      const panelNow = await readPanel();
      await canvasPng(`${SHOTS}/buy-${i + 1}-${id}-behind-panel.png`);
      OUT.buys.push({
        i: i + 1, id, btn, toast: t,
        moneyBefore: before.moyu, moneyAfter: after.moyu, spent: before.moyu - after.moyu,
        decor: after.decor, summary: panelNow.summary,
        ownedRow: panelNow.decor.find((d) => d.name === panelNow.decor.find(() => false)) ?? null,
      });
      if (i === 7) {
        // 8/8 庆祝瞬间：面板还开着，toast 在最上层
        await fullShot(`${SHOTS}/celebration-panel-open.png`);
        OUT.celebration = { toast: t, state: after, hud: await hud(), summary: panelNow.summary, panelText: panelNow.text };
      }
      await panelClose();
      await sleep(1250);
      await canvasPng(`${SHOTS}/after-${i + 1}-${id}.png`);
      await sleep(320);
      await canvasPng(`${SHOTS}/after-${i + 1}-${id}-b.png`);
      if (i === 2) await fullShot(`${SHOTS}/s2-buy3-full.png`);
      if (i === 7) await fullShot(`${SHOTS}/celebration-scene.png`);
    }

    // ---------- 8/8 面板 + 最终场景 ----------
    await panelOpen();
    OUT.panelAfter = await readPanel();
    OUT.panelAfter.hud = await hud();
    await fullShot(`${SHOTS}/panel-all.png`);
    await ev("document.getElementById('team-body').scrollTop = 0"); await sleep(200);
    await fullShot(`${SHOTS}/panel-all-top.png`);
    await panelClose();
    await sleep(1200);
    OUT.final = { state: await st(), hud: await hud() };
    await fullShot(`${SHOTS}/s3-all-full.png`);
    await canvasPng(`${SHOTS}/s3-all-canvas.png`);
    await sleep(380);
    await canvasPng(`${SHOTS}/s3-all-canvas-b.png`);

    // ---------- 离线家具实测：rug+chair vs 无 ----------
    const injectPatch = async (source) => (await send("Page.addScriptToEvaluateOnNewDocument", { source })).identifier;
    const removePatch = async (id) => send("Page.removeScriptToEvaluateOnNewDocument", { identifier: id });
    const patchSource = (decorArr) => `(() => { try {
      const raw = JSON.parse(localStorage.getItem('moyu-save') || 'null');
      if (!raw) return;
      const today = new Date().toLocaleDateString('sv-SE');
      raw.createdAt = Date.now() - 3 * 86400000;
      raw.savedAt = Date.now() - 3600000;
      raw.decor = ${JSON.stringify(decorArr)};
      raw.visits = { date: today, count: 2 };
      raw.energy = raw.energy || {};
      raw.energy.date = today;
      localStorage.setItem('moyu-save', JSON.stringify(raw));
    } catch (e) {} })();`;
    const offlineRun = async (decorArr, label) => {
      await ev("window.__MOYU__.saveNow()");
      await sleep(350);
      const before = await st();
      const sid = await injectPatch(patchSource(decorArr));
      await ev("location.reload()");
      await boot();
      await sleep(1600);
      const post = await st();
      const welcome = await ev(`(() => { const w = document.getElementById('welcome'); return {
        open: !w.classList.contains('hidden'),
        time: document.getElementById('welcome-time')?.textContent ?? null,
        gain: document.getElementById('welcome-gain')?.textContent ?? null,
        rule: document.getElementById('welcome-rule')?.textContent ?? null,
      }; })()`);
      await fullShot(`${SHOTS}/offline-${label}-full.png`);
      await removePatch(sid);
      const earned = post.totalEarned - before.totalEarned;
      return { label, decor: decorArr, earnedRaw: earned, beforeTotalEarned: before.totalEarned, postTotalEarned: post.totalEarned, welcome, idleHud: (await hud()).idle, energy: post.energy };
    };
    OUT.offline = {};
    OUT.offline.withRugChair = await offlineRun(["rug", "chair"], "rug-chair");
    OUT.offline.none = await offlineRun([], "none");
    OUT.offline.ratio = OUT.offline.withRugChair.earnedRaw / OUT.offline.none.earnedRaw;

    OUT.errors = c.errors.slice();
  },
  { timeoutMs: 240_000 },
);

writeFileSync("playtest/r15-evidence-main.json", JSON.stringify(OUT, null, 2));
console.log(JSON.stringify({
  s0hud: OUT.s0?.hud, baseline: OUT.baseline?.hud, final: OUT.final?.hud,
  celebration: OUT.celebration?.toast, panelAfterSummary: OUT.panelAfter?.summary,
  energyBefore: OUT.energyBefore?.state, energyCombo: OUT.energyComboBtn, energyAfter: OUT.energyAfterCombo?.state,
  energyButtons: OUT.energyAfterCombo?.buttons,
  offline: { withRugChair: OUT.offline?.withRugChair?.earnedRaw, none: OUT.offline?.none?.earnedRaw, ratio: OUT.offline?.ratio },
}, null, 1));
console.log("errors:", OUT.errors);