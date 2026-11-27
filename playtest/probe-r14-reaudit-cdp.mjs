/**
 * R14 复验 CDP（HEAD 6be96e2）：
 *  S1 D1 场景 8/8 + 集齐 +10%（面板 ×1.58 vs spec 1.43）
 *  S2 D2 余额跨价 → 家具按钮下一帧自动可用（不切页签）
 *  S3 D4 boosted 由 used 推导（注入 {2,3} 被忽略）
 *  S4 D4 残留：left 与 used 不交叉校验 → 可白嫖第 4 项
 *  S5 D5 跨日离线不再吃昨日加成（A/B 对照）
 *  S6 4 项精力无法全点（实机）
 *  S7 social 无同事 UI 残留（引擎拒绝但按钮可点）
 *  S8 「省心组合」死按钮（left>=145 恒 false）
 * 证据：playtest/r14-reaudit-cdp-v2.json + 截图
 */
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { writeFileSync } from "node:fs";

const URL = process.env.MOYU_URL ?? "http://127.0.0.1:5173/";
const ALL_DECOR = ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"];
const COLORS = {
  plant: [0x4f, 0x8f, 0x53],
  fridge: [0xd8, 0xe3, 0xea],
  aquaWater: [0x3f, 0x6f, 0x8a],
  projector: [0x6f, 0x74, 0x88],
  catbed: [0xc4, 0x7a, 0x4f],
};
const report = { startedAt: new Date().toISOString(), url: URL, head: "6be96e2", scenarios: {} };

await runChrome(
  async ({ port }) => {
    const b = await connect(port);
    await b.send("Page.enable", {});
    await b.send("Runtime.enable", {});
    await b.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
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
    const text = (sel) => evj(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.textContent : null; })()`);
    const click = (sel) => evj(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return "missing"; el.click(); return "ok"; })()`);
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
      await sleep(1100);
      await waitReady();
      await sleep(300);
    };
    const shot = async (name) => {
      const r = await b.send("Page.captureScreenshot", { format: "png" });
      const file = `playtest/r14-reaudit-${name}.png`;
      writeFileSync(file, Buffer.from(r.data, "base64"));
      return file;
    };
    const dismiss = async () => {
      await evj(`(() => { const w=document.getElementById('welcome'); if(w&&!w.classList.contains('hidden')){const b=document.getElementById('welcome-ok'); if(b)b.click();} return 1; })()`);
      await sleep(200);
      await evj(`(() => { const c=document.getElementById('cards'); if(c&&!c.classList.contains('hidden')){const b=document.getElementById('cards-skip'); if(b)b.click();} return 1; })()`);
      await sleep(300);
    };
    const openTeam = async (tab = "decor") => {
      await click("#btn-team");
      await sleep(600);
      if (tab === "decor") await click("#tab-decor");
      await sleep(350);
    };
    const closeTeam = async () => {
      if ((await evj(`document.getElementById('team').classList.contains('hidden')`)) === false) {
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
    const today = () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const yesterday = () => {
      const d = new Date(Date.now() - 86400_000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const blob = (over = {}) => ({
      v: 2, moyu: 0, totalEarned: 0, lifetimeEarned: 0, levels: {},
      savedAt: Date.now() + 60_000, createdAt: Date.now() - 3 * 86400_000,
      collected: { quotes: [], flavors: [] }, daily: null, surviveStreak: 0, patrolSurvives: 0,
      totalClicks: 0, visits: { date: "", count: 0 }, prestige: 0, team: { colleagues: {} },
      talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: today() },
      ...over,
    });
    const zhou = { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 10, autoRepeat: false, rewardSnapshot: 0 };
    const countColor = (rgb) =>
      evj(`(() => { const c=document.getElementById('stage'); const ctx=c.getContext('2d'); const d=ctx.getImageData(0,0,c.width,c.height).data; let n=0; for(let i=0;i<d.length;i+=4){ if(d[i]===${rgb[0]}&&d[i+1]===${rgb[1]}&&d[i+2]===${rgb[2]}&&d[i+3]>200) n++; } return { n, w:c.width, h:c.height }; })()`);

    await b.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.__errs=[]; addEventListener('error', e=>window.__errs.push(String(e.message)));`,
    });

    try {
      await b.send("Page.navigate", { url: URL });
      await waitReady();
      await dismiss();

      // ───── S1：8/8 家具 + 集齐奖励 ─────
      await evaluate("window.__MOYU__.grant(1e11)");
      await sleep(200);
      await openTeam("decor");
      const s1 = { purchases: {}, summaryBefore: await text("#team-body .team-summary") };
      for (const id of ALL_DECOR) {
        const sel = `#team-body button[data-act="decor"][data-id="${id}"]`;
        s1.purchases[id] = await click(sel);
        await sleep(220);
      }
      const s1state = await state();
      s1.decor = s1state.decor;
      s1.summaryAfter = await text("#team-body .team-summary");
      s1.energyHeading = await text("#team-body .branch h3");
      // 集齐奖励提示（toast/announce）
      s1.doneToasts = await evj(`Array.from(document.querySelectorAll('.toast')).map((e) => e.textContent)`);
      await closeTeam();
      await dismiss();
      const s1canvas = {};
      for (const [k, rgb] of Object.entries(COLORS)) s1canvas[k] = await countColor(rgb);
      s1.scenePixels = s1canvas;
      s1.canvasShot = await shot("s1-scene-1280");
      s1.hud = { idle: await text("#hud-idle"), click: await text("#hud-click") };
      report.scenarios.S1 = s1;

      // ───── S2：D2 余额跨价，按钮自动可用（不切页签） ─────
      await seedSave(blob({ moyu: 0, levels: { retire: 1 }, energy: { date: today(), left: 100, used: [], boosted: {} } }));
      const s2 = { poll: [] };
      await openTeam("decor");
      s2.moneyAtOpen = +(await state()).moyu.toFixed(2);
      s2.plantAtOpen = await evj(`(() => { const el=document.querySelector('#team-body button[data-act="decor"][data-id="plant"]'); const row=el?.closest('.row-tap'); return el ? { disabled: el.disabled, rowDisabled: row?.dataset.disabled } : null; })()`);
      for (let i = 0; i < 40; i++) {
        await sleep(200);
        const st = await state();
        const btn = await evj(`(() => { const el=document.querySelector('#team-body button[data-act="decor"][data-id="plant"]'); const row=el?.closest('.row-tap'); return el ? { disabled: el.disabled, rowDisabled: row?.dataset.disabled } : null; })()`);
        s2.poll.push({ ms: (i + 1) * 200, moyu: +st.moyu.toFixed(2), disabled: btn?.disabled });
        if (st.moyu > 3200) {
          s2.crossed = { at: (i + 1) * 200, moyu: +st.moyu.toFixed(2), button: btn };
          break;
        }
      }
      s2.autoEnabled = s2.crossed?.button?.disabled === false;
      if (s2.crossed?.button?.disabled === false) {
        await click(`#team-body button[data-act="decor"][data-id="plant"]`);
        await sleep(300);
        s2.decorAfterBuy = (await state()).decor;
      }
      report.scenarios.S2 = s2;
      await closeTeam();

      // ───── S3：D4 注入 boosted:{2,3} 被忽略 ─────
      await seedSave(blob({ energy: { date: today(), left: 100, used: [], boosted: { idleMult: 2, patrolRewardMult: 3, clickMult: 9 } } }));
      const s3state = await state();
      report.scenarios.S3 = {
        boosted: s3state.energy.boosted, left: s3state.energy.left, used: s3state.energy.used,
        hudIdle: await text("#hud-idle"),
      };

      // ───── S4：D4 残留 —— used 3 项 + left=100 可再白嫖 focus ─────
      await seedSave(blob({ team: { colleagues: { zhou } }, energy: { date: today(), left: 100, used: ["social", "fake-work", "slack"], boosted: {} } }));
      const s4pre = await state();
      await openTeam("decor");
      const s4 = {
        preState: { left: s4pre.energy.left, used: s4pre.energy.used, boosted: s4pre.energy.boosted },
        heading: await text("#team-body .branch h3"),
        focusBtn: await evj(`(() => { const el=document.querySelector('#team-body button[data-act="energy"][data-id="focus"]'); return el ? { disabled: el.disabled, label: el.textContent } : null; })()`),
      };
      if (s4.focusBtn && s4.focusBtn.disabled === false) {
        await click(`#team-body button[data-act="energy"][data-id="focus"]`);
        await sleep(350);
        const s4after = await state();
        s4.after = { left: s4after.energy.left, used: s4after.energy.used, clickMult: s4after.energy.boosted.clickMult };
      }
      report.scenarios.S4 = s4;
      await closeTeam();

      // ───── S5：D5 跨日离线 A/B ─────
      const mkOfflineBlob = (energy) =>
        blob({
          moyu: 0, levels: { retire: 1 }, totalEarned: 0, lifetimeEarned: 0,
          savedAt: Date.now() - 3600_000, createdAt: Date.now() - 3 * 86400_000, energy,
        });
      await seedSave(mkOfflineBlob({ date: yesterday(), left: 60, used: ["slack"], boosted: { idleMult: 1.25, patrolRewardMult: 1, clickMult: 1 } }));
      const s5a = await state();
      await seedSave(mkOfflineBlob({ date: today(), left: 100, used: [], boosted: {} }));
      const s5b = await state();
      report.scenarios.S5 = {
        staleA: { moyu: s5a.moyu, energyDate: s5a.energy.date, left: s5a.energy.left, boosted: s5a.energy.boosted },
        freshB: { moyu: s5b.moyu, energyDate: s5b.energy.date, left: s5b.energy.left, boosted: s5b.energy.boosted },
        ratio: s5a.moyu / s5b.moyu,
      };

      // ───── S6：4 项精力无法全点（实机） ─────
      await seedSave(blob({ moyu: 1000, team: { colleagues: { zhou } }, energy: { date: today(), left: 100, used: [], boosted: {} } }));
      await openTeam("decor");
      const s6 = { steps: [] };
      for (const a of ["social", "fake-work", "slack"]) {
        const sel = `#team-body button[data-act="energy"][data-id="${a}"]`;
        const before = await state();
        const btn = await evj(`(() => { const el=document.querySelector(${JSON.stringify(sel)}); return el ? { disabled: el.disabled } : null; })()`);
        const r = await click(sel);
        await sleep(280);
        const after = await state();
        s6.steps.push({ action: a, buttonBefore: btn, clickRes: r, leftBefore: before.energy.left, leftAfter: after.energy.left, usedAfter: after.energy.used });
      }
      s6.final = { left: (await state()).energy.left, used: (await state()).energy.used, heading: await text("#team-body .branch h3") };
      s6.focusBtn = await evj(`(() => { const el=document.querySelector('#team-body button[data-act="energy"][data-id="focus"]'); return el ? { disabled: el.disabled } : null; })()`);
      s6.focusClick = await click(`#team-body button[data-act="energy"][data-id="focus"]`);
      await sleep(250);
      s6.afterFocusAttempt = (await state()).energy;
      report.scenarios.S6 = s6;
      await closeTeam();

      // ───── S7：social 无同事 UI 残留 ─────
      await seedSave(blob({ moyu: 1000, team: { colleagues: {} }, energy: { date: today(), left: 100, used: [], boosted: {} } }));
      await openTeam("decor");
      const s7 = {
        socialRow: await evj(`(() => { const row=document.querySelector('#team-body .row-tap[data-act="energy"][data-id="social"]'); const btn=document.querySelector('#team-body button[data-act="energy"][data-id="social"]'); return { rowDataDisabled: row?.dataset.disabled ?? null, btnDisabled: btn ? btn.disabled : null, btnExists: !!btn }; })()`),
      };
      const s7before = await state();
      await click(`#team-body button[data-act="energy"][data-id="social"]`);
      await sleep(350);
      const s7after = await state();
      s7.clickEffect = { leftBefore: s7before.energy.left, leftAfter: s7after.energy.left, usedAfter: s7after.energy.used };
      report.scenarios.S7 = s7;
      await closeTeam();

      // ───── S8：「省心组合」死按钮 ─────
      await seedSave(blob({ moyu: 1000, team: { colleagues: { zhou } }, energy: { date: today(), left: 100, used: [], boosted: {} } }));
      await openTeam("decor");
      const s8 = {
        energyAll: await evj(`(() => { const el=document.querySelector('#team-body button[data-act="energy-all"]'); return el ? { disabled: el.disabled, label: el.textContent } : null; })()`),
        left: (await state()).energy.left,
      };
      if (s8.energyAll && s8.energyAll.disabled === false) {
        await click(`#team-body button[data-act="energy-all"]`);
        await sleep(400);
        s8.after = { left: (await state()).energy.left, used: (await state()).energy.used };
      }
      report.scenarios.S8 = s8;
      await closeTeam();

      // ───── S9：面板打开期间卡片弹窗抑制（6be96e2） ─────
      await openTeam("decor");
      await sleep(2200);
      report.scenarios.S9_cardModalSuppressed = await evj(`document.getElementById('cards').classList.contains('hidden')`);
      await closeTeam();

      // ───── S10：D11 实机 A/B —— rug 离线加成是否被计两次 ─────
      const mkOffline = (decor) =>
        blob({
          moyu: 0, levels: { retire: 1 }, totalEarned: 0, lifetimeEarned: 0, decor,
          savedAt: Date.now() - 3600_000, createdAt: Date.now() - 3 * 86400_000,
          energy: { date: today(), left: 100, used: [], boosted: {} },
        });
      await seedSave(mkOffline([]));
      const s10a = await state();
      await seedSave(mkOffline(["rug"]));
      const s10b = await state();
      const rate = (moyu) => +(moyu / (700.2 * 3600)).toFixed(4); // 基准 700.2/s×1h
      report.scenarios.S10_offlineRugAB = {
        noDecorMoyu: s10a.moyu, noDecorRate: rate(s10a.moyu),
        rugMoyu: s10b.moyu, rugRate: rate(s10b.moyu),
        ratio: +(s10b.moyu / s10a.moyu).toFixed(5),
        specExpectRate: 0.85, specExpectRatio: +(0.85 / 0.8).toFixed(5),
        note: "visits=1 使基准离线效率 0.8；spec 期望 rug 后 0.85（+0.05），若为 0.90 则 decorBonus 被计两次",
      };

      report.consoleErrors = b.errors.slice(0, 20);
      report.pageErrors = (await evj("window.__errs")) ?? [];
    } finally {
      b.close();
    }
  },
  { timeoutMs: 200_000, port: 9566 },
);

writeFileSync("playtest/r14-reaudit-cdp-v2.json", JSON.stringify(report, null, 2));
const s = report.scenarios;
console.log("S1 summary:", s.S1?.summaryAfter?.trim(), "| pixels:", JSON.stringify(s.S1?.scenePixels), "| hud:", JSON.stringify(s.S1?.hud));
console.log("S2 open:", s.S2?.moneyAtOpen, "crossed:", JSON.stringify(s.S2?.crossed), "autoEnabled:", s.S2?.autoEnabled, "buy:", JSON.stringify(s.S2?.decorAfterBuy));
console.log("S3 boosted:", JSON.stringify(s.S3));
console.log("S4:", JSON.stringify(s.S4));
console.log("S5:", JSON.stringify(s.S5));
console.log("S6:", JSON.stringify(s.S6?.steps?.map((x) => [x.action, x.leftBefore, x.leftAfter])), "final:", JSON.stringify(s.S6?.final), "focus:", JSON.stringify(s.S6?.focusBtn), "afterFocus:", JSON.stringify(s.S6?.afterFocusAttempt));
console.log("S7:", JSON.stringify(s.S7));
console.log("S8:", JSON.stringify(s.S8));
console.log("cardModalHidden:", s.S9_cardModalSuppressed, "errors:", report.consoleErrors, report.pageErrors);