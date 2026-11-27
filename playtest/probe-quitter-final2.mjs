/**
 * 终验·弃坑型新玩家（线上 v0.5.0）——干净版 120 秒记录（v2）
 * 修正 v1 的三个探针问题：📔 滚动后关闭、黄点重复计数、商店第 3 张卡不可见需滑动。
 * 新增：日报奖励领取、商店滑动购买、徽章 DOM 重复检查、关闭按钮可点性检查、首屏信息量采集。
 * 只用线上 https://luojindui.github.io/moyu/ ；不改 src/。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const URL = "https://luojindui.github.io/moyu/";
const DIR = "playtest/quitter-final";
mkdirSync(DIR + "/shots", { recursive: true });

const OUT = {
  meta: {}, firstScreen: {}, frames: [], events: [], actions: [], panels: {}, screens: {}, endState: {},
};

function initScript() {
  window.__qlog = [];
  window.__frames = 0;
  const rec = (k, d) => {
    try { window.__qlog.push({ t: +(performance.now()).toFixed(0), k, d }); } catch (e) { /* ignore */ }
  };
  window.__qrec = rec;
  window.addEventListener("error", (e) => rec("error", String(e && e.message)));
  window.addEventListener("unhandledrejection", (e) => rec("rejection", String(e && e.reason)));

  const raf0 = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return raf0(function (t) { window.__frames += 1; return cb(t); });
  };

  const watch = (id) => {
    const el = document.getElementById(id);
    if (!el) { rec("missing", id); return; }
    rec("init", { id, cls: String(el.className), text: (el.textContent || "").slice(0, 120) });
    new MutationObserver(function (ms) {
      for (const m of ms) {
        if (m.type === "attributes") rec("attr", { id, cls: String(el.className), aria: el.getAttribute("aria-label") });
        else rec("text", { id, text: (el.textContent || "").trim().slice(0, 260) });
      }
    }).observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
  };
  document.addEventListener("DOMContentLoaded", function () {
    ["welcome", "cards", "cards-body", "boss-choice", "arcade", "team", "journal", "dom-toast", "sr-live",
      "quest", "hud-card", "hud-combo", "hud-streak", "btn-arcade", "btn-team", "btn-mute", "btn-journal"].forEach(watch);
    rec("dom-ready", null);
  });

  const origArc = CanvasRenderingContext2D.prototype.arc;
  CanvasRenderingContext2D.prototype.arc = function (x, y, r, a0, a1) {
    try {
      if (r > 4 && this.fillStyle === "#ffd76e") {
        const cv = this.canvas;
        const b = cv.getBoundingClientRect();
        window.__memeArc = { x: +(b.left + (x / cv.width) * b.width).toFixed(1), y: +(b.top + (y / cv.height) * b.height).toFixed(1), t: +performance.now().toFixed(0) };
      }
    } catch (e) { /* ignore */ }
    return origArc.apply(this, arguments);
  };

  const vis = (el) => {
    if (!el || !el.isConnected) return false;
    let n = el;
    while (n && n !== document.body) {
      const cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      n = n.parentElement;
    }
    return true;
  };

  window.__snap = function () {
    const txt = (id) => { const el = document.getElementById(id); return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : ""; };
    const open = (id) => { const el = document.getElementById(id); return !!el && !el.classList.contains("hidden"); };
    const rect = (id) => { const el = document.getElementById(id); if (!el || !vis(el)) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const toastEl = document.getElementById("dom-toast");
    const meme = window.__memeArc;
    const shop = Array.from(document.querySelectorAll("#shop-cards .shop-card")).map((c) => ({
      id: c.dataset.upgrade || "", name: (c.querySelector(".shop-name") || {}).textContent || "",
      cost: (c.querySelector(".shop-cost b") || {}).textContent || "",
      disabled: !!c.disabled, confirming: c.classList.contains("confirming"),
      lv: (c.querySelector(".shop-level") || {}).textContent || "",
    }));
    return {
      t: +performance.now().toFixed(0), frames: window.__frames,
      modals: ["welcome", "cards", "boss-choice", "arcade", "team", "journal"].filter(open),
      hud: { moyu: txt("hud-moyu"), click: txt("hud-click"), idle: txt("hud-idle"), rank: txt("hud-rank"), card: txt("hud-card"), combo: txt("hud-combo"), streak: txt("hud-streak") },
      quest: { vis: open("quest"), text: txt("quest-text"), bar: (document.getElementById("quest-bar") || {}).style ? document.getElementById("quest-bar").style.width : "" },
      toast: toastEl && toastEl.classList.contains("show") ? (toastEl.textContent || "").trim() : "",
      sr: txt("sr-live"),
      btn: {
        arcade: txt("btn-arcade"), arcadeBadge: (document.querySelector("#btn-arcade .arcade-badge") || {}).textContent || "",
        team: txt("btn-team"), teamAria: (document.getElementById("btn-team") || {}).getAttribute ? document.getElementById("btn-team").getAttribute("aria-label") : "",
        teamBadges: Array.from(document.querySelectorAll("#btn-team .badge, #btn-team .talent-badge, #btn-team .energy-badge")).map((e) => (e.textContent || "").trim()),
        mute: txt("btn-mute"),
        journal: txt("btn-journal"), journalReward: !!(document.getElementById("btn-journal") || {}).classList && document.getElementById("btn-journal").classList.contains("has-reward"),
      },
      badgeCounts: {
        arcade: document.querySelectorAll("#btn-arcade .arcade-badge").length,
        arcadeTexts: Array.from(document.querySelectorAll("#btn-arcade .arcade-badge")).map((e) => e.textContent),
        teamBadge: document.querySelectorAll("#btn-team .badge").length,
        talent: document.querySelectorAll("#btn-team .talent-badge").length,
        energy: document.querySelectorAll("#btn-team .energy-badge").length,
      },
      shop,
      rects: { hud: rect("hud"), canvas: rect("stage"), shop: rect("shop"), quest: rect("quest"), btnTeam: rect("btn-team") },
      cardsText: open("cards") ? txt("cards-body").slice(0, 700) : "",
      boss: open("boss-choice") ? { tell: txt("boss-tell"), opts: Array.from(document.querySelectorAll("#boss-opts button")).map((b) => (b.innerText || "").trim()), timer: txt("boss-timer") } : null,
      meme: meme && performance.now() - meme.t < 5200 ? meme : null,
    };
  };

  window.__info = function () {
    const texts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = (node.textContent || "").trim();
      if (!t) continue;
      const el = node.parentElement;
      if (!el || !vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el);
      texts.push({ t: t.slice(0, 40), x: Math.round(r.x), y: Math.round(r.y), size: Math.round(parseFloat(cs.fontSize) || 0) });
    }
    const inter = Array.from(document.querySelectorAll("button, [role=button], a, input, textarea")).filter(vis).map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, id: el.id || "", cls: String(el.className).slice(0, 40), text: ((el.innerText || el.getAttribute("aria-label") || "") + "").replace(/\s+/g, " ").trim().slice(0, 40), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    return {
      t: +performance.now().toFixed(0), nText: texts.length, chars: texts.reduce((a, b) => a + b.t.length, 0),
      minFont: texts.length ? Math.min.apply(null, texts.map((x) => x.size)) : 0,
      smallTexts: texts.filter((x) => x.size <= 11).map((x) => x.t).slice(0, 25),
      texts: texts.slice(0, 90), nInteractive: inter.length, interactive: inter.slice(0, 45),
      bodyText: (document.body.innerText || "").replace(/\n{2,}/g, "\n").trim().slice(0, 2500),
    };
  };
}
const INIT = "(" + initScript.toString() + ")();";

await runChrome(
  async ({ port }) => {
    const c = await connect(port);
    const { send, ev } = c;
    const writeB64 = (file, b64) => writeFileSync(file, Buffer.from(b64, "base64"));
    const cap = async (file, fmt) => {
      const params = fmt === "jpg" ? { format: "jpeg", quality: 62 } : { format: "png" };
      const r = await send("Page.captureScreenshot", params);
      writeB64(file, r.data);
      return file;
    };
    const pageError = (v) => v && typeof v === "object" && v.__err;

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: INIT });
    await send("Page.navigate", { url: URL });

    const waitFor = async (expr, timeout = 20000, step = 100) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) { const v = await ev(expr); if (v) return v; await sleep(step); }
      return null;
    };
    await waitFor("document.readyState === 'complete' && !!window.__snap");
    await waitFor("window.__frames > 5");
    const pn = await ev("performance.now()");
    const wall0 = Date.now() - pn;
    const pageNow = () => Date.now() - wall0;
    const readyNav = await ev("window.__snap()");
    OUT.meta = { url: URL, viewport: "390x844@2 mobile", ua: await ev("navigator.userAgent"), navReadyAt: Math.round(pn), snapAtReady: readyNav };

    const rectOf = async (sel) => ev("(() => { const el = document.querySelector(" + JSON.stringify(sel) + "); if (!el) return null; const b = el.getBoundingClientRect(); if (b.width < 1 || b.height < 1) return null; return { x: b.x + b.width/2, y: b.y + b.height/2, w: b.width, h: b.height }; })()");
    const clickAt = async (x, y) => {
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await sleep(24);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    };
    const clickSel = async (sel) => { const r = await rectOf(sel); if (!r) return false; await clickAt(r.x, r.y); return true; };
    const jsClick = async (sel) => ev("(() => { const el = document.querySelector(" + JSON.stringify(sel) + "); if (!el) return false; el.click(); return true; })()");
    const tapCanvas = async (fx, fy) => {
      const r = await rectOf("#stage");
      if (!r) return false;
      await clickAt(r.x - r.w / 2 + r.w * (fx || 0.42), r.y - r.h / 2 + r.h * (fy || 0.62));
      S.taps += 1;
      S.lastTapWall = Date.now();
      return true;
    };
    const buyUpgrade = async (id) => {
      const moved = await ev("(() => { const c = document.querySelector('#shop-cards .shop-card[data-upgrade=" + JSON.stringify(id) + "]'); if (!c) return false; c.scrollIntoView({ block: 'nearest', inline: 'center' }); return true; })()");
      if (!moved) return false;
      await sleep(210);
      return clickSel('#shop-cards .shop-card[data-upgrade="' + id + '"]');
    };
    const panelInfo = async (rootId, panelSel) => ev(
      "(() => { const root = document.getElementById(" + JSON.stringify(rootId) + "); if (!root) return null; const panel = root.querySelector(" + JSON.stringify(panelSel) + ") || root; const t = (panel.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim(); return { open: !root.classList.contains('hidden'), textLen: t.length, text: t.slice(0, 7000), scrollH: panel.scrollHeight, clientH: panel.clientHeight, scrollTop: panel.scrollTop, nButtons: panel.querySelectorAll('button').length, buttons: Array.from(panel.querySelectorAll('button')).slice(0, 36).map(function (b) { const r = b.getBoundingClientRect(); return { t: ((b.innerText || '') + '').trim().slice(0, 40), disabled: !!b.disabled, y: Math.round(r.y), h: Math.round(r.height), fs: Math.round(parseFloat(getComputedStyle(b).fontSize) || 0) }; }), nRows: panel.querySelectorAll('.talent, .card, .game-card, .colleague, .decor-card, .c-item').length }; })()",
    );

    const S = {
      taps: 0, lastTapWall: 0, cardShown: null, cardHandled: false, cardChoice: null,
      bossShown: null, bossHandled: false, bossAnswer: null,
      memeEvents: [], lastMemeAct: 0,
      bought: {}, phase: "observe", questGone: null, questGoneShot: false,
      panelsDone: false, firstTapTaken: false, cardsShot: false, bossShot: false,
      journalStarSeen: false, starSeenAt: null, claimDone: false, claimResult: null,
      muteTest: null, info1s: null, info3s: null, keyFrames: [],
    };
    const act = (p, k, d) => { const a = { p: Math.round(p), k, d: d === undefined ? null : d }; OUT.actions.push(a); return a; };
    const keyShot = async (p, name, fmt) => {
      const real = fmt === "jpg" ? "jpg" : "png";
      const file = DIR + "/shots/v2-" + name + "." + real;
      await cap(file, real);
      S.keyFrames.push({ p: Math.round(p), name: file });
      return file;
    };

    const shotSchedule = [300, 700, 1000, 1500, 2000, 3000];
    for (let s = 4000; s <= 120000; s += 1000) shotSchedule.push(s);
    let shotIdx = 0;

    const drainEvents = async () => {
      const q = await ev("window.__qlog.splice(0)");
      if (Array.isArray(q)) for (const e of q) OUT.events.push(e);
    };

    const runPanels = async () => {
      S.phase = "panels";
      let p = pageNow();
      act(p, "panels-start");

      // 👥 小队
      await clickSel("#btn-team");
      await sleep(520);
      let snap = await ev("window.__snap()");
      if (snap && snap.modals && snap.modals.indexOf("team") >= 0) {
        act(pageNow(), "team-open");
        await keyShot(pageNow(), "team-colleagues");
        OUT.panels.teamColleagues = { p: Math.round(pageNow()), snap, info: await panelInfo("team", ".team-panel") };
        await clickSel("#tab-talents"); await sleep(430);
        await keyShot(pageNow(), "team-talents");
        OUT.panels.teamTalents = { p: Math.round(pageNow()), info: await panelInfo("team", ".team-panel") };
        await clickSel("#tab-decor"); await sleep(430);
        await keyShot(pageNow(), "team-decor");
        OUT.panels.teamDecor = { p: Math.round(pageNow()), info: await panelInfo("team", ".team-panel") };
        // 记录关闭按钮位置（面板是否可滚）
        OUT.panels.teamClose = await ev("(() => { const b = document.getElementById('team-close').getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })()");
        await clickSel("#team-close"); await sleep(420);
        act(pageNow(), "team-close");
      } else act(pageNow(), "team-open-failed", snap && snap.modals);
      await drainEvents();

      // 🎮 摸鱼站
      await clickSel("#btn-arcade");
      await sleep(520);
      snap = await ev("window.__snap()");
      if (snap && snap.modals && snap.modals.indexOf("arcade") >= 0) {
        act(pageNow(), "arcade-open");
        await keyShot(pageNow(), "arcade-menu");
        OUT.panels.arcade = { p: Math.round(pageNow()), snap, info: await panelInfo("arcade", ".arcade-panel") };
        await clickSel("#arcade-close"); await sleep(420);
        act(pageNow(), "arcade-close");
      } else act(pageNow(), "arcade-open-failed", snap && snap.modals);
      await drainEvents();

      // 📔 日报
      await clickSel("#btn-journal");
      await sleep(560);
      snap = await ev("window.__snap()");
      if (snap && snap.modals && snap.modals.indexOf("journal") >= 0) {
        act(pageNow(), "journal-open");
        await keyShot(pageNow(), "journal-top");
        const top = await panelInfo("journal", ".journal-panel");
        // 领日报奖励
        const claim = await ev("(() => { const b = document.getElementById('journal-claim'); if (!b) return { ok: false }; const t = (b.textContent || '').trim(); if (b.disabled) return { ok: false, text: t }; b.click(); return { ok: true, text: t }; })()");
        S.claimResult = claim;
        await sleep(420);
        await keyShot(pageNow(), "journal-claimed");
        act(pageNow(), "journal-claim", claim);
        // 滚到底
        await ev("(() => { const el = document.querySelector('#journal .journal-panel'); if (el) el.scrollTop = el.scrollHeight; return (el || {}).scrollTop; })()");
        await sleep(420);
        await keyShot(pageNow(), "journal-bottom");
        const bottom = await panelInfo("journal", ".journal-panel");
        const closeInfo = await ev("(() => { const b = document.getElementById('journal-close'); const r = b.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height), visible: r.top >= 0 && r.bottom <= innerHeight }; })()");
        // 试试点面板外（真实手机会随手点空白处）
        await clickAt(6, 420);
        await sleep(320);
        const closedByBackdrop = await ev("document.getElementById('journal').classList.contains('hidden')");
        OUT.panels.journal = { p: Math.round(pageNow()), snapTop: snap, top, bottom, closeInfo, closedByBackdrop };
        act(pageNow(), "journal-close-try", { closeInfo, closedByBackdrop });
        if (!closedByBackdrop) {
          await jsClick("#journal-close");
          await sleep(320);
        }
        act(pageNow(), "journal-closed", { nowOpen: !(await ev("document.getElementById('journal').classList.contains('hidden')")) });
      } else act(pageNow(), "journal-open-failed", snap && snap.modals);
      await drainEvents();

      // 🔊
      const before = await ev("({ text: document.getElementById('btn-mute').textContent, aria: document.getElementById('btn-mute').getAttribute('aria-label') })");
      await clickSel("#btn-mute");
      await sleep(260);
      const after = await ev("({ text: document.getElementById('btn-mute').textContent, aria: document.getElementById('btn-mute').getAttribute('aria-label') })");
      S.muteTest = { before, after };
      act(pageNow(), "mute-toggle", S.muteTest);
      await drainEvents();

      S.panelsDone = true;
      S.phase = "tap2";
      act(pageNow(), "panels-end");
    };

    while (true) {
      const p = pageNow();
      if (p > 121_000) break;
      const s = await ev("window.__snap()");
      if (!pageError(s)) {
        // 首屏信息量
        if (!S.info1s && p >= 1000) { S.info1s = await ev("window.__info()"); OUT.firstScreen.infoAt1s = S.info1s; }
        if (!S.info3s && p >= 3000) { S.info3s = await ev("window.__info()"); OUT.firstScreen.infoAt3s = S.info3s; await keyShot(p, "first-screen-3s"); }

        // 切好的截图计划
        if (shotIdx < shotSchedule.length && p >= shotSchedule[shotIdx]) {
          const t = shotSchedule[shotIdx];
          const name = "sec2-" + String(Math.round(p)).padStart(3, "0");
          const file = DIR + "/shots/" + name + ".jpg";
          await cap(file, "jpg");
          OUT.frames.push({ p: Math.round(p), file, snap: s });
          shotIdx += 1;
        }
        if (S.questGone === null && s.quest && s.quest.vis === false) {
          S.questGone = Math.round(p);
          act(p, "quest-gone");
          if (!S.questGoneShot) { S.questGoneShot = true; await keyShot(p, "quest-gone"); }
        }
        if (!S.journalStarSeen && s.btn && s.btn.journalReward) {
          S.journalStarSeen = true;
          S.starSeenAt = Math.round(p);
          act(p, "journal-star", { badges: s.btn.teamBadges, arcadeBadge: s.btn.arcadeBadge });
          await keyShot(p, "journal-star");
        }

        const modals = s.modals || [];
        const inModal = modals.length > 0;

        if (modals.indexOf("cards") >= 0) {
          if (!S.cardShown) {
            S.cardShown = p;
            act(p, "cards-shown", s.cardsText);
            if (!S.cardsShot) { S.cardsShot = true; await keyShot(p, "cards"); OUT.screens.cards = { p: Math.round(p), snap: s, info: await ev("window.__info()") }; }
          }
          if (!S.cardHandled && p - S.cardShown > 2400) {
            const ok = await clickSel("#cards .card");
            if (ok) { S.cardHandled = true; S.cardChoice = s.cardsText; act(p, "cards-chose-first", s.cardsText); }
          }
          await drainEvents();
          await sleep(90);
          continue;
        }

        if (modals.indexOf("boss-choice") >= 0) {
          if (!S.bossShown) {
            S.bossShown = p;
            act(p, "boss-choice-shown", s.boss);
            if (!S.bossShot) { S.bossShot = true; await keyShot(p, "boss-choice"); OUT.screens.boss = { p: Math.round(p), snap: s }; }
          }
          if (!S.bossHandled && p - S.bossShown > 1800) {
            const ok = await clickSel("#boss-opts button");
            if (ok) { S.bossHandled = true; S.bossAnswer = s.boss; act(p, "boss-answered-first", s.boss); }
          }
          await drainEvents();
          await sleep(90);
          continue;
        }

        if (inModal) { await drainEvents(); await sleep(90); continue; }

        // 黄点：一个事件窗口算一次（5 秒窗口，远大于相邻事件间隔）
        if (s.meme && p - S.lastMemeAct > 4000) {
          S.memeEvents.push({ p: Math.round(p), ...s.meme });
          S.lastMemeAct = p;
          act(p, "meme-appeared", s.meme);
          await keyShot(p, "meme", "jpg");
        }

        // 商店（可买就买；第 3 张之后要滑动）
        const canBuy = S.cardHandled;
        for (const it of canBuy ? s.shop || [] : []) {
          if (it.disabled || it.confirming) continue;
          const id = it.id;
          if (["coffee", "phone", "water", "toilet"].indexOf(id) < 0) continue;
          if (S.bought[id]) continue;
          if (await buyUpgrade(id)) {
            S.bought[id] = { p: Math.round(p), cost: it.cost, lv: it.lv };
            act(p, "buy-" + id, it);
          }
        }

        const nowWall = Date.now();
        const canTap = p >= 4200 && !S.panelsDone && nowWall - S.lastTapWall > 460;
        if (canTap && !S.cardHandled) {
          if (S.taps < 8) {
            await tapCanvas();
            if (!S.firstTapTaken) {
              S.firstTapTaken = true;
              act(p, "first-tap");
              await sleep(150);
              await keyShot(p, "first-tap", "jpg");
            }
          }
        } else if (canTap && S.cardHandled) {
          if (!S.bought.phone || p < 46_000) {
            if (s.meme && p - S.lastMemeAct <= 4000 && S.lastMemeTapped !== S.lastMemeAct) {
              await clickAt(s.meme.x, s.meme.y);
              S.lastMemeTapped = S.lastMemeAct;
              act(p, "meme-tap", s.meme);
            } else {
              await tapCanvas();
            }
          }
        }

        if (!S.panelsDone && p >= 45_000 && S.bought.phone) {
          await runPanels();
          OUT.panels.endBalance = (await ev("window.__snap()")).hud;
        }

        if (S.panelsDone && p >= 92_000 && p < 119_000 && nowWall - S.lastTapWall > 470) {
          await tapCanvas(0.42, 0.6);
        }
      }
      await drainEvents();
      await sleep(80);
    }

    await keyShot(pageNow(), "final-120s");
    OUT.endState.snap = await ev("window.__snap()");
    OUT.endState.info = await ev("window.__info()");
    OUT.endState.saveRaw = await ev("localStorage.getItem('moyu-save')");
    OUT.endState.saveKeys = await ev("Object.keys(localStorage)");
    OUT.endState.navTiming = await ev("(() => { const n = performance.getEntriesByType('navigation')[0]; const p = performance.getEntriesByType('paint'); return { ttfb: n ? Math.round(n.responseStart) : null, dcl: n ? Math.round(n.domContentLoadedEventEnd) : null, load: n ? Math.round(n.loadEventEnd) : null, paints: p.map(function (x) { return { name: x.name, t: Math.round(x.startTime) }; }), transferKB: Math.round(performance.getEntriesByType('resource').reduce(function (a, r) { return a + (r.transferSize || 0); }, 0) / 1024), nRes: performance.getEntriesByType('resource').length }; })()");
    OUT.endState.resources = await ev("performance.getEntriesByType('resource').map(function (r) { return { n: r.name.split('/').slice(-2).join('/'), kb: Math.round((r.transferSize || 0) / 1024), ms: Math.round(r.duration), st: r.responseStatus }; })");
    OUT.endState.fps = await ev("(() => { const t = performance.now(); return { frames: window.__frames, elapsed: Math.round(t), avgFps: +(window.__frames / (t / 1000)).toFixed(1) }; })()");
    OUT.endState.localErrors = OUT.events.filter((e) => e.k === "error" || e.k === "rejection" || e.k === "missing");
    OUT.endState.runtimeExceptions = c.errors.slice(0, 10);

    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(900);
    await cap(DIR + "/shots/v2-desktop-1280.png", "png");
    OUT.endState.desktopInfo = await ev("window.__info()");

    c.close();
    writeFileSync(DIR + "/evidence2.json", JSON.stringify(OUT, null, 2));
    writeFileSync(DIR + "/summary2.txt", [
      "url=" + URL,
      "frames=" + OUT.frames.length,
      "events=" + OUT.events.length,
      "actions=" + OUT.actions.length,
      "cardsShownAt=" + S.cardShown,
      "cardHandled=" + S.cardHandled,
      "bossShownAt=" + S.bossShown,
      "bossHandled=" + S.bossHandled,
      "memeEvents=" + S.memeEvents.length,
      "bought=" + JSON.stringify(S.bought),
      "questGoneAt=" + S.questGone,
      "journalStarAt=" + S.starSeenAt,
      "claim=" + JSON.stringify(S.claimResult),
      "mute=" + JSON.stringify(S.muteTest),
      "panelsDone=" + S.panelsDone,
      "taps=" + S.taps,
    ].join("\n"));
    console.log("[probe2] done", JSON.stringify({ frames: OUT.frames.length, events: OUT.events.length, cards: S.cardShown, boss: S.bossShown, memes: S.memeEvents.length, bought: S.bought, questGone: S.questGone, star: S.starSeenAt, claim: S.claimResult, taps: S.taps }));
  },
  { timeoutMs: 300_000 },
);
console.log("[probe2] written", DIR + "/evidence2.json");