/**
 * R14 审计党实机验证（CDP）：工位经营 + 每日精力
 * 必须使用 playtest/lib/chrome.mjs（保证 kill Chrome，不自己 spawn）
 * 运行：export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" && node playtest/probe-r14-audit-cdp.mjs
 * 输出：playtest/r14-audit-cdp-report.json + r14-audit-decor-*.png
 */
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { writeFileSync } from "node:fs";

const URL = process.env.MOYU_URL ?? "http://127.0.0.1:5173/";
const SCENE_COLORS = {
  plant: [0x4f, 0x8f, 0x53],
  lamp: [0xff, 0xd7, 0x6e],
  fridge: [0xd8, 0xe3, 0xea],
  chair: [0x4a, 0x3b, 0x52],
  aquarium: [0x3f, 0x6f, 0x8a],
  projector: [0x6f, 0x74, 0x88],
  catbed: [0xc4, 0x7a, 0x4f],
};
const DECOR_IDS = ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"];
const DECOR_COSTS = {
  plant: 3000,
  lamp: 20000,
  rug: 120000,
  fridge: 600000,
  chair: 4000000,
  aquarium: 30000000,
  projector: 200000000,
  catbed: 2000000000,
};
const report = { startedAt: new Date().toISOString(), url: URL, scenarios: {}, consoleErrors: [] };
let shotSeq = 0;

await runChrome(
  async ({ port }) => {
    const b = await connect(port);
    await b.send("Page.enable", {});
    await b.send("Runtime.enable", {});
    await b.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expr) => {
      const r = await b.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r.exceptionDetails) throw new Error("page eval failed: " + JSON.stringify(r.exceptionDetails).slice(0, 400));
      return r.result.value;
    };
    const evj = async (expr) => {
      const s = await evaluate(`(() => { const v = (${expr}); return JSON.stringify(v === undefined ? null : v); })()`);
      return s === undefined ? null : JSON.parse(s);
    };
    const state = () => evj("window.__MOYU__.state");
    const text = (sel) => evj(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.textContent : null; })()`);
    const click = async (sel) => {
      const ok = await evj(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return "missing"; el.click(); return "ok"; })()`);
      return ok;
    };
    const waitReady = async () => {
      for (let i = 0; i < 250; i++) {
        try {
          if ((await evaluate("!!window.__MOYU__")) === true) return true;
        } catch {
          /* retry */
        }
        await sleep(100);
      }
      throw new Error("game not ready");
    };
    const reload = async () => {
      await b.send("Page.reload", { ignoreCache: false });
      await sleep(1200);
      await waitReady();
      await sleep(250);
    };
    const shot = async (name) => {
      const r = await b.send("Page.captureScreenshot", { format: "png" });
      const file = `playtest/r14-audit-${name}.png`;
      writeFileSync(file, Buffer.from(r.data, "base64"));
      return file;
    };
    // 场景像素证据：统计指定 RGB 的像素数量（家具为纯色块填充）
    const colorCount = (rgb) =>
      evj(`(() => { const c = document.getElementById('stage'); const ctx = c.getContext('2d'); if (!ctx) return null; const d = ctx.getImageData(0,0,c.width,c.height).data; let n=0; for (let i=0;i<d.length;i+=4) { if (d[i]===${rgb[0]} && d[i+1]===${rgb[1]} && d[i+2]===${rgb[2]} && d[i+3]>200) n++; } return { count: n, w: c.width, h: c.height }; })()`);
    const rugRegionMean = () =>
      evj(`(() => { const c = document.getElementById('stage'); const ctx = c.getContext('2d'); const w=c.width,h=c.height; const x0=Math.floor(w*0.30), y0=Math.floor(h*0.70), ww=Math.floor(w*0.40), hh=Math.floor(h*0.16); const d=ctx.getImageData(x0,y0,ww,hh).data; let r=0,g=0,bl=0,n=0; for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];bl+=d[i+2];n++;} return { r:+(r/n).toFixed(2), g:+(g/n).toFixed(2), b:+(bl/n).toFixed(2), n }; })()`);
    const openTeam = async (tab = "decor") => {
      await click("#btn-team");
      await sleep(650);
      if (tab === "decor") await click("#tab-decor");
      else if (tab === "talents") await click("#tab-talents");
      else await click("#tab-colleagues");
      await sleep(400);
    };
    const closeTeam = async () => {
      const hidden = await evj(`document.getElementById('team').classList.contains('hidden')`);
      if (!hidden) {
        await click("#team-close");
        await sleep(250);
      }
    };
    const seedSave = async (blob) => {
      const src = `(() => { try { localStorage.setItem("moyu-save", ${JSON.stringify(JSON.stringify(blob))}); } catch (e) {} })()`;
      const r = await b.send("Page.addScriptToEvaluateOnNewDocument", { source: src });
      await reload();
      await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: r.identifier });
      await sleep(200);
    };
    const readSaveBlob = () => evj(`(() => { try { return JSON.parse(localStorage.getItem('moyu-save')); } catch (e) { return null; } })()`);
    const today = () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const yesterday = () => {
      const d = new Date(Date.now() - 86400_000);
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

    // 注入每页错误收集
    await b.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.__errs = []; window.addEventListener('error', (e) => window.__errs.push(String(e.message))); window.addEventListener('unhandledrejection', (e) => window.__errs.push('rej:' + String(e.reason)));`,
    });

    try {
      // ───────── S0：全新档基线 ─────────
      await b.send("Page.navigate", { url: URL });
      await waitReady();
      await sleep(400);
      const s0 = await state();
      report.scenarios.S0 = {
        freshState: { decor: s0.decor, energy: s0.energy, moyu: s0.moyu, prestige: s0.prestige },
        hudBefore: { idle: await text("#hud-idle"), click: await text("#hud-click"), moyu: await text("#hud-moyu") },
        scenes: await shot("empty"),
      };

      // ───────── S1：UI 购买 8 件家具（含场景渲染像素证据） ─────────
      await evaluate("window.__MOYU__.grant(1e11)");
      await sleep(250);
      await openTeam("decor");
      const s1 = { summaryBefore: await text("#team-body .team-summary"), hudIdleBefore: await text("#hud-idle"), hudClickBefore: await text("#hud-click"), purchases: {}, costDiffs: {} };
      const rugMeanBefore = await rugRegionMean();
      const sceneBefore = {};
      for (const id of Object.keys(SCENE_COLORS)) sceneBefore[id] = await colorCount(SCENE_COLORS[id]);
      await closeTeam();
      await sleep(200);
      await openTeam("decor");

      for (const id of DECOR_IDS) {
        const before = await state();
        const sel = `#team-body button[data-act="decor"][data-id="${id}"]`;
        const btn = await evj(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? { disabled: el.disabled, label: el.textContent } : null; })()`);
        const clickRes = await click(sel);
        await sleep(320);
        const after = await state();
        const btnAfter = await evj(`(() => !!document.querySelector(${JSON.stringify(sel)}))()`);
        const entry = {
          clickRes,
          buttonBefore: btn,
          buttonGoneAfter: btnAfter === false,
          ownsAfter: after.decor.includes(id),
          decorAfter: [...after.decor],
          balanceDiff: +(before.moyu - after.moyu).toFixed(4),
          expectedCost: DECOR_COSTS[id],
        };
        if (SCENE_COLORS[id]) {
          await closeTeam();
          await sleep(200);
          const afterCount = await colorCount(SCENE_COLORS[id]);
          entry.scenePixels = { before: sceneBefore[id].count, after: afterCount.count, canvas: `${afterCount.w}x${afterCount.h}` };
          await openTeam("decor");
        }
        if (id === "rug") {
          await closeTeam();
          await sleep(200);
          const afterMean = await rugRegionMean();
          entry.scenePixels = { beforeMean: rugMeanBefore, afterMean, changed: JSON.stringify(rugMeanBefore) !== JSON.stringify(afterMean) };
          await openTeam("decor");
        }
        s1.purchases[id] = entry;
      }
      const sAll = await state();
      s1.afterAll = {
        decor: [...sAll.decor],
        decorCount: sAll.decor.length,
        totalCost: DECOR_IDS.reduce((a, id) => a + DECOR_COSTS[id], 0),
        hudIdleAfter: await text("#hud-idle"),
        hudClickAfter: await text("#hud-click"),
        summaryAfter: await text("#team-body .team-summary"),
        remainingDecorButtons: await evj(`document.querySelectorAll('#team-body button[data-act="decor"]').length`),
        energyPanelText: await text("#team-body .branch h3"),
      };
      await closeTeam();
      await sleep(300);
      s1.sceneAfter = await shot("decor-all");
      // 重开面板确认「已装修 8/8」且无按钮可再买
      await openTeam("decor");
      s1.reopenSummary = await text("#team-body .team-summary");
      s1.reopenButtons = await evj(`document.querySelectorAll('#team-body button[data-act="decor"]').length`);
      report.scenarios.S1 = s1;

      // ───────── S2：精力使用（同日不可重复/用完后按钮消失）+ HUD 挂机变化 ─────────
      const s2 = { hudIdleBefore: await text("#hud-idle"), steps: {} };
      for (const a of ["slack", "fake-work", "social"]) {
        const sel = `#team-body button[data-act="energy"][data-id="${a}"]`;
        const btn = await evj(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? { disabled: el.disabled } : null; })()`);
        const clickRes = await click(sel);
        await sleep(300);
        const st = await state();
        s2.steps[a] = {
          buttonBefore: btn,
          clickRes,
          left: st.energy.left,
          used: [...st.energy.used],
          buttonGone: (await evj(`!!document.querySelector(${JSON.stringify(sel)})`)) === false,
          hudIdle: await text("#hud-idle"),
        };
      }
      s2.after = {
        energy: (await state()).energy,
        heading: await text("#team-body .branch h3"),
        energyButtonsLeft: await evj(`document.querySelectorAll('#team-body button[data-act="energy"]').length`),
      };
      report.scenarios.S2 = s2;

      // ───────── S3：刷新后保留（decor + energy + boosted） ─────────
      await evaluate("window.__MOYU__.saveNow()");
      await sleep(200);
      const blobBeforeReload = await readSaveBlob();
      const beforeReload = await state();
      await reload();
      const afterReload = await state();
      report.scenarios.S3 = {
        blobSaved: {
          decor: blobBeforeReload?.decor,
          energy: blobBeforeReload?.energy,
          v: blobBeforeReload?.v,
        },
        before: { decor: beforeReload.decor, energy: beforeReload.energy },
        after: { decor: afterReload.decor, energy: afterReload.energy, hudIdle: await text("#hud-idle"), hudClick: await text("#hud-click") },
        decorPreserved: JSON.stringify(beforeReload.decor) === JSON.stringify(afterReload.decor),
        energyPreserved:
          afterReload.energy?.left === beforeReload.energy?.left &&
          JSON.stringify(afterReload.energy?.used) === JSON.stringify(beforeReload.energy?.used) &&
          afterReload.energy?.boosted?.idleMult === beforeReload.energy?.boosted?.idleMult,
      };
      // 刷新后场景家具仍渲染
      await closeTeam();
      await sleep(250);
      report.scenarios.S3.sceneAfterReload = {};
      for (const id of Object.keys(SCENE_COLORS)) report.scenarios.S3.sceneAfterReload[id] = (await colorCount(SCENE_COLORS[id])).count;
      report.scenarios.S3.scenes = await shot("after-reload");

      // ───────── S4：转生保留家具/精力 ─────────
      await openTeam("decor");
      const beforePrestige = await state();
      await click("#btn-journal");
      await sleep(500);
      const prestigeBtn = await evj(`(() => { const el = document.getElementById('prestige-btn'); return el ? { disabled: el.disabled, label: el.textContent } : null; })()`);
      const prestigeClick = await click("#prestige-btn");
      await sleep(700);
      const afterPrestige = await state();
      report.scenarios.S4 = {
        beforeState: { decor: beforePrestige.decor, energy: beforePrestige.energy, prestige: beforePrestige.prestige, totalEarned: beforePrestige.totalEarned },
        prestigeBtn,
        prestigeClick,
        afterState: { decor: afterPrestige.decor, energy: afterPrestige.energy, prestige: afterPrestige.prestige, moyu: afterPrestige.moyu },
        decorPreserved: JSON.stringify(beforePrestige.decor) === JSON.stringify(afterPrestige.decor),
      };
      // 转生后存档往返
      await evaluate("window.__MOYU__.saveNow()");
      await sleep(200);
      await reload();
      const afterPrestigeReload = await state();
      report.scenarios.S4.afterReload = { decor: afterPrestigeReload.decor, prestige: afterPrestigeReload.prestige, energy: afterPrestigeReload.energy };
      // 关闭日报面板
      const journalHidden = await evj(`document.getElementById('journal').classList.contains('hidden')`);
      if (!journalHidden) await click("#journal-close");
      await sleep(250);

      // ───────── S5：跨日重置 ─────────
      await seedSave(blob({ decor: ["plant"], energy: { date: yesterday(), left: 20, used: ["slack"], boosted: { idleMult: 1.25, patrolRewardMult: 1 } } }));
      const s5 = {
        state: (await state()).energy,
        hudIdle: await text("#hud-idle"),
        dateIsToday: (await state()).energy.date === today(),
      };
      await openTeam("decor");
      s5.heading = await text("#team-body .branch h3");
      s5.buttons = await evj(`Array.from(document.querySelectorAll('#team-body button[data-act="energy"]')).map((b) => ({ id: b.dataset.id, disabled: b.disabled }))`);
      report.scenarios.S5 = s5;
      await closeTeam();

      // ───────── S6：精力不足 → 按钮禁用；禁用按钮点击无效 ─────────
      await seedSave(blob({ moyu: 1000, energy: { date: today(), left: 30, used: [], boosted: { idleMult: 1, patrolRewardMult: 1 } } }));
      await openTeam("decor");
      const s6 = { buttonsBefore: await evj(`Array.from(document.querySelectorAll('#team-body button[data-act="energy"]')).map((b) => ({ id: b.dataset.id, disabled: b.disabled }))`) };
      await evaluate(`document.querySelector('#team-body button[data-act="energy"][data-id="slack"]').click()`);
      await sleep(300);
      s6.afterClickDisabledSlack = { left: (await state()).energy.left, used: (await state()).energy.used };
      const socialClick = await click(`#team-body button[data-act="energy"][data-id="social"]`);
      await sleep(300);
      const s6b = await state();
      s6.socialClick = socialClick;
      s6.afterSocial = { left: s6b.energy.left, used: [...s6b.energy.used] };
      s6.buttonsAfter = await evj(`Array.from(document.querySelectorAll('#team-body button[data-act="energy"]')).map((b) => ({ id: b.dataset.id, disabled: b.disabled }))`);
      report.scenarios.S6 = s6;
      await closeTeam();

      // ───────── S7：存档篡改净化 ─────────
      await seedSave(
        blob({
          decor: ["plant", "plant", "ghost", "lamp"],
          energy: { date: today(), left: 999, used: ["ghost", "slack", "slack"], boosted: { idleMult: 99, patrolRewardMult: 99 } },
        }),
      );
      const tampered = await state();
      await openTeam("decor");
      const s7 = {
        decor: [...tampered.decor],
        energy: tampered.energy,
        hudIdle: await text("#hud-idle"),
        heading: await text("#team-body .branch h3"),
        summary: await text("#team-body .team-summary"),
        buttons: await evj(`Array.from(document.querySelectorAll('#team-body button[data-act="energy"], #team-body button[data-act="decor"]')).map((b) => ({ act: b.dataset.act, id: b.dataset.id, disabled: b.disabled, label: b.textContent }))`),
      };
      report.scenarios.S7 = s7;
      await closeTeam();
      // 额外：decor 全非法 + 精力 date 非法 / left 越界
      await seedSave(blob({ decor: ["ghost"], energy: { date: "bad-date", left: -5, used: ["bogus"], boosted: { idleMult: "x", patrolRewardMult: null } } }));
      const s7b = await state();
      report.scenarios.S7b = { decor: s7b.decor, energy: s7b.energy, hudIdle: await text("#hud-idle") };

      // ───────── S8：UI 刷新滞后（余额够了但按钮仍禁用？） ─────────
      // 种子：0 余额 + 高挂机（retire 5 ≈ 3500/s），savedAt 置未来避免离线结算
      await seedSave(blob({ moyu: 0, levels: { retire: 5 }, energy: { date: today(), left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1 } } }));
      const s8 = { moneyAtOpen: null, plantDisabledAtOpen: null, crossed: null, poll: [] };
      await openTeam("decor");
      s8.moneyAtOpen = (await state()).moyu;
      s8.plantAtOpen = await evj(`(() => { const el = document.querySelector('#team-body button[data-act="decor"][data-id="plant"]'); return el ? { disabled: el.disabled, label: el.textContent } : null; })()`);
      for (let i = 0; i < 20; i++) {
        await sleep(200);
        const st = await state();
        const btn = await evj(`(() => { const el = document.querySelector('#team-body button[data-act="decor"][data-id="plant"]'); return el ? { disabled: el.disabled, label: el.textContent } : null; })()`);
        s8.poll.push({ t: i * 200, moyu: +st.moyu.toFixed(2), button: btn });
        if (st.moyu > 3000) {
          s8.crossed = { afterMs: (i + 1) * 200, moyu: +st.moyu.toFixed(2), button: btn };
          break;
        }
      }
      s8.staleAfterCross = s8.crossed ? s8.crossed.button?.disabled === true : "not-crossed";
      // 切换 tab 强制重绘后应恢复可用
      await click("#tab-colleagues");
      await sleep(250);
      await click("#tab-decor");
      await sleep(300);
      s8.plantAfterTabSwitch = await evj(`(() => { const el = document.querySelector('#team-body button[data-act="decor"][data-id="plant"]'); return el ? { disabled: el.disabled, label: el.textContent } : null; })()`);
      const buyClick = await click(`#team-body button[data-act="decor"][data-id="plant"]`);
      await sleep(300);
      s8.buyClick = buyClick;
      s8.decorAfterBuy = (await state()).decor;
      report.scenarios.S8 = s8;
      await closeTeam();

      // 页面错误汇总
      report.consoleErrors = b.errors.slice(0, 20);
      report.pageErrors = (await evj("window.__errs")) ?? [];
    } finally {
      b.close();
    }
  },
  { timeoutMs: 180_000, port: 9562 },
);

writeFileSync("playtest/r14-audit-cdp-report.json", JSON.stringify(report, null, 2));
console.log("R14 CDP probe done:", JSON.stringify(Object.keys(report.scenarios)));
console.log("shots:", shotSeq);