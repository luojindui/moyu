/**
 * v0.6.0 终验复验探针（弃坑型）
 * 3 种用法（环境变量）：
 *   LABEL=r1 DURATION_MS=200000 MODE=quitter   → 新手自然跑 200 秒（逐秒记录，跟目标条走，老板题按"随手点第一个"）
 *   LABEL=r2 DURATION_MS=100000 MODE=quitter   → 第一分钟核对（开屏 toast / 角标隐藏 / 目标条连续）
 *   LABEL=long DURATION_MS=720000 MODE=tester   → 长跑验证目标链第 6-10 步（会按线索答题、自动买升级、攒钱招人、玩一局街机）
 * 输出：playtest/v06-verify/<LABEL>/{evidence.json,summary.txt,shots/}
 * 只用线上 https://luojindui.github.io/moyu/ ；不改 src/。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const URL = "https://luojindui.github.io/moyu/";
const LABEL = process.env.LABEL || "r1";
const DURATION = Number(process.env.DURATION_MS || 200000);
const MODE = process.env.MODE || "quitter"; // quitter | tester
const FLOW = process.env.FLOW === "1"; // 在"招募第一位同事"步骤注入存档并刷新，验证第 8-10 步流程
const DIR = `playtest/v06-verify/${LABEL}`;
mkdirSync(DIR + "/shots", { recursive: true });

const OUT = { meta: {}, frames: [], events: [], actions: [], panels: {}, steps: [], endState: {} };

function initScript() {
  window.__qlog = [];
  window.__frames = 0;
  const rec = (k, d) => { try { window.__qlog.push({ t: +(performance.now()).toFixed(0), k, d }); } catch (e) { /* */ } };
  window.__qrec = rec;
  window.addEventListener("error", (e) => rec("error", String(e && e.message)));
  window.addEventListener("unhandledrejection", (e) => rec("rejection", String(e && e.reason)));

  const raf0 = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) { return raf0(function (t) { window.__frames += 1; return cb(t); }); };

  const watch = (id) => {
    const el = document.getElementById(id);
    if (!el) { rec("missing", id); return; }
    rec("init", { id, cls: String(el.className), text: (el.textContent || "").slice(0, 140) });
    new MutationObserver(function (ms) {
      for (const m of ms) {
        if (m.type === "attributes") rec("attr", { id, cls: String(el.className), aria: el.getAttribute("aria-label") });
        else rec("text", { id, text: (el.textContent || "").trim().slice(0, 300) });
      }
    }).observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
  };
  document.addEventListener("DOMContentLoaded", function () {
    ["welcome", "cards", "cards-body", "boss-choice", "arcade", "arcade-body", "team", "team-body", "journal",
      "journal-goals", "journal-claim", "dom-toast", "sr-live", "quest", "quest-text",
      "btn-arcade", "btn-team", "btn-mute", "btn-journal"].forEach(watch);
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
    } catch (e) { /* */ }
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
    const badgeInfo = (sel) => {
      const els = Array.from(document.querySelectorAll(sel));
      return {
        n: els.length,
        texts: els.map((e) => (e.textContent || "").trim()),
        displays: els.map((e) => getComputedStyle(e).display),
        visible: els.filter((e) => getComputedStyle(e).display !== "none" && vis(e)).length,
      };
    };
    const shop = Array.from(document.querySelectorAll("#shop-cards .shop-card")).map((c) => ({
      id: c.dataset.upgrade || "", name: (c.querySelector(".shop-name") || {}).textContent || "",
      cost: (c.querySelector(".shop-cost b") || {}).textContent || "",
      disabled: !!c.disabled, confirming: c.classList.contains("confirming"),
    }));
    const toastEl = document.getElementById("dom-toast");
    const meme = window.__memeArc;
    const claimEl = document.getElementById("journal-claim");
    const goalsEl = document.getElementById("journal-goals");
    const arcadeBtns = Array.from(document.querySelectorAll("#arcade-body button[data-game]")).map((b) => ({ game: b.dataset.game, text: (b.textContent || "").trim(), disabled: !!b.disabled }));
    const recruitBtn = document.querySelector('#team-body button[data-act="recruit"][data-id="zhou"]');
    const energyBtns = Array.from(document.querySelectorAll('#team-body button[data-act="energy"]')).map((b) => ({ id: b.dataset.id, text: (b.textContent || "").trim(), disabled: !!b.disabled }));
    return {
      t: +performance.now().toFixed(0), frames: window.__frames,
      modals: ["welcome", "cards", "boss-choice", "arcade", "team", "journal"].filter(open),
      onboarding: document.body.classList.contains("onboarding"),
      hud: { moyu: txt("hud-moyu"), click: txt("hud-click"), idle: txt("hud-idle"), rank: txt("hud-rank"), card: txt("hud-card"), combo: txt("hud-combo"), streak: txt("hud-streak") },
      quest: { vis: open("quest"), text: txt("quest-text"), bar: (document.getElementById("quest-bar") || {}).style ? document.getElementById("quest-bar").style.width : "" },
      toast: toastEl && toastEl.classList.contains("show") ? (toastEl.textContent || "").trim() : "",
      sr: txt("sr-live"),
      badges: {
        arcade: badgeInfo("#btn-arcade .arcade-badge"),
        talent: badgeInfo("#btn-team .talent-badge"),
        energy: badgeInfo("#btn-team .energy-badge"),
        mission: badgeInfo("#btn-team .badge"),
      },
      shop,
      journal: {
        open: open("journal"),
        claim: claimEl ? { text: (claimEl.textContent || "").trim(), disabled: !!claimEl.disabled } : null,
        goals: goalsEl ? (goalsEl.innerText || "").replace(/\n+/g, " / ").trim().slice(0, 300) : "",
      },
      team: {
        open: open("team"),
        recruit: recruitBtn ? { text: (recruitBtn.textContent || "").trim(), disabled: !!recruitBtn.disabled } : null,
        energy: energyBtns,
        body: open("team") ? (document.getElementById("team-body").innerText || "").replace(/\n+/g, " / ").slice(0, 600) : "",
      },
      arcade: {
        open: open("arcade"),
        menu: arcadeBtns,
        playing: !!document.querySelector("#play-area, #play-grid, .arcade-play #play-drops") || !!document.querySelector("#play-timer"),
        result: !!document.getElementById("arcade-again"),
        resultText: document.getElementById("arcade-again") ? (document.getElementById("arcade-body").innerText || "").replace(/\n+/g, " / ").slice(0, 300) : "",
        leftText: (document.getElementById("arcade-left") || {}).textContent || "",
      },
      cardsText: open("cards") ? (document.getElementById("cards-body").textContent || "").trim().slice(0, 600) : "",
      boss: open("boss-choice") ? { tell: txt("boss-tell"), opts: Array.from(document.querySelectorAll("#boss-opts button")).map((b) => (b.innerText || "").trim()) } : null,
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
      texts.push({ t: t.slice(0, 40), size: Math.round(parseFloat(cs.fontSize) || 0) });
    }
    const inter = Array.from(document.querySelectorAll("button, [role=button], a, input, textarea")).filter(vis);
    return {
      t: +performance.now().toFixed(0), nText: texts.length,
      chars: texts.reduce((a, b) => a + b.t.length, 0),
      minFont: texts.length ? Math.min.apply(null, texts.map((x) => x.size)) : 0,
      nInteractive: inter.length,
      bodyText: (document.body.innerText || "").replace(/\n{2,}/g, "\n").trim().slice(0, 3000),
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
      const params = fmt === "jpg" ? { format: "jpeg", quality: 60 } : { format: "png" };
      const r = await send("Page.captureScreenshot", params);
      writeB64(file, r.data);
    };
    const jsClick = async (sel) => ev("(() => { const el = document.querySelector(" + JSON.stringify(sel) + "); if (!el) return false; el.click(); return true; })()");
    const clickAt = async (x, y) => {
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await sleep(22);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    };
    const rectOf = async (sel) => ev("(() => { const el = document.querySelector(" + JSON.stringify(sel) + "); if (!el) return null; const b = el.getBoundingClientRect(); if (b.width < 1 || b.height < 1) return null; return { x: b.x + b.width/2, y: b.y + b.height/2, w: b.width, h: b.height }; })()");
    const snap = async () => ev("window.__snap()");

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
    let wall0 = Date.now() - pn;
    const pageNow = () => Date.now() - wall0;
    OUT.meta = { url: URL, label: LABEL, mode: MODE, durationMs: DURATION, viewport: "390x844@2", ua: await ev("navigator.userAgent") };
    OUT.firstScreen = { infoAt1s: null, infoAt3s: null };

    const act = (p, k, d) => { const a = { p: Math.round(p), k, d: d === undefined ? null : d }; OUT.actions.push(a); console.log("[" + LABEL + "] " + a.p + "ms " + k + (d ? " " + JSON.stringify(d).slice(0, 180) : "")); return a; };
    const keyShot = async (name, fmt) => {
      const file = DIR + "/shots/" + name + (fmt === "jpg" ? ".jpg" : ".png");
      await cap(file, fmt);
      return file;
    };
    const drain = async () => {
      const q = await ev("window.__qlog.splice(0)");
      if (Array.isArray(q)) OUT.events.push(...q);
    };

    const S = {
      taps: 0, lastTapWall: 0, cardPicked: false, bossShownAt: 0, bossDone: false,
      cardShownAt: 0, stepTexts: [], stepShots: {}, questDoneAt: null, questGoneAt: null,
      journalWallShot: false, recruitWallShot: false, energyShot: false, arcadeShot: false,
      banner: null, memeTapped: 0, lastMemeAct: 0, doneShots: false, claimAt: null, recruitAt: null,
      postShots: 0, lastStepText: "", injected: false, recruitWallSeen: false, startWall: Date.now(),
    };
    const stepLog = async (s, p) => {
      const qt = (s.quest && s.quest.vis) ? s.quest.text : null;
      if (qt && qt !== S.lastStepText) {
        S.lastStepText = qt;
        const item = { p: Math.round(p), phase: S.injected ? "post" : "pre", text: qt, bar: s.quest.bar, hud: s.hud, badges: s.badges };
        OUT.steps.push(item);
        act(p, "quest-step", { text: qt, moyu: s.hud.moyu });
      }
    };

    // ---------- 动作 ----------
    const tapCanvas = async () => {
      const r = await rectOf("#stage");
      if (!r) return false;
      await clickAt(r.x - r.w / 2 + r.w * 0.44, r.y - r.h / 2 + r.h * 0.6);
      S.taps += 1; S.lastTapWall = Date.now();
      return true;
    };
    const buyCard = async (id) => {
      const okMove = await ev("(() => { const c = document.querySelector('#shop-cards .shop-card[data-upgrade=" + JSON.stringify(id) + "]'); if (!c || c.disabled) return false; c.scrollIntoView({ block: 'nearest', inline: 'center' }); return true; })()");
      if (!okMove) return false;
      await sleep(180);
      const r = await rectOf('#shop-cards .shop-card[data-upgrade="' + id + '"]');
      if (!r) return false;
      await clickAt(r.x, r.y);
      return true;
    };
    const answerBoss = async (p, s) => {
      const opts = (s.boss && s.boss.opts) || [];
      let pick = 0;
      if (MODE === "tester") {
        const tell = (s.boss && s.boss.tell) || "";
        if (/又快又重|两三步/.test(tell)) pick = opts.findIndex((t) => /装忙/.test(t)) >= 0 ? opts.findIndex((t) => /装忙/.test(t)) : 0;
        else if (/盯着别人的屏幕/.test(tell)) pick = opts.findIndex((t) => /工作界面/.test(t)) >= 0 ? opts.findIndex((t) => /工作界面/.test(t)) : 1;
        else if (/边走边看手机|眼神是散的/.test(tell)) pick = opts.findIndex((t) => /继续摸鱼/.test(t)) >= 0 ? opts.findIndex((t) => /继续摸鱼/.test(t)) : 2;
      }
      const btns = await ev("Array.from(document.querySelectorAll('#boss-opts button')).map(function (b, i) { return { i: i, t: (b.innerText || '').trim() }; })");
      const target = btns && btns[pick] ? btns[pick] : (btns && btns[0]);
      if (!target) return;
      await ev("(() => { const bs = document.querySelectorAll('#boss-opts button'); if (bs[" + target.i + "]) bs[" + target.i + "].click(); return true; })()");
      S.bossDone = true;
      act(p, "boss-answer", { mode: MODE, pick: target.t, tell: s.boss && s.boss.tell });
    };
    const handleModals = async (p, s) => {
      if ((s.modals || []).indexOf("cards") >= 0 && !S.cardPicked) {
        if (!S.cardShownAt) { S.cardShownAt = p; act(p, "cards-shown", s.cardsText); await keyShot("cards"); }
        if (p - S.cardShownAt > 1500) {
          await ev("(() => { const c = document.querySelector('#cards .card'); if (!c) return false; c.click(); return true; })()");
          S.cardPicked = true; act(p, "cards-pick-first");
        }
        return true;
      }
      if ((s.modals || []).indexOf("boss-choice") >= 0) {
        if (!S.bossShownAt) { S.bossShownAt = p; act(p, "boss-shown", s.boss); await keyShot("boss"); }
        if (p - S.bossShownAt > 1300 && !S.bossDone) await answerBoss(p, s);
        return true;
      }
      return false;
    };
    const journalFlow = async (p) => {
      if (await ev("!document.getElementById('journal').classList.contains('hidden')")) {
        // already open
      } else {
        await jsClick("#btn-journal"); await sleep(450);
      }
      let s = await snap();
      if (!s.modals.includes("journal")) { act(p, "journal-open-fail"); return false; }
      if (!S.journalWallShot) {
        S.journalWallShot = true;
        await keyShot("journal-top");
        OUT.panels.journal = { p: Math.round(pageNow()), top: { textLen: (await ev("(document.querySelector('#journal .journal-panel')||{}).innerText.length")) || 0, claim: s.journal.claim, goals: s.journal.goals } };
        act(p, "journal-wall", { claim: s.journal.claim, goals: s.journal.goals });
      }
      if (s.journal.claim && !s.journal.claim.disabled) {
        await jsClick("#journal-claim"); await sleep(500);
        const s2 = await snap();
        S.claimAt = Math.round(appRound(pageNow()));
        await keyShot("journal-claimed");
        act(pageNow(), "journal-claim", { before: s.journal.claim, toast: s2.toast, hud: s2.hud, goals: s2.journal.goals });
        if (await ev("!document.getElementById('journal').classList.contains('hidden')")) { await jsClick("#journal-close"); await sleep(350); }
        return true;
      }
      // 未可领：记录当前目标缺口，然后关闭去完成
      act(p, "journal-not-ready", { claim: s.journal.claim, goals: s.journal.goals });
      await jsClick("#journal-close"); await sleep(320);
      return false;
    };
    const appRound = (n) => n;
    const teamFlow = async (p) => {
      if (await ev("document.getElementById('team').classList.contains('hidden')")) { await jsClick("#btn-team"); await sleep(480); }
      let s = await snap();
      if (!s.modals.includes("team")) { act(p, "team-open-fail"); return false; }
      if (s.team.recruit) {
        if (!S.recruitWallShot) {
          S.recruitWallShot = true; S.recruitWallSeen = true;
          await keyShot("team-recruit-wall");
          OUT.panels.recruitWall = { p: Math.round(pageNow()), balance: s.hud.moyu, recruit: s.team.recruit, body: s.team.body };
          act(p, "recruit-wall", { balance: s.hud.moyu, recruit: s.team.recruit });
        }
        if (!s.team.recruit.disabled) {
          await jsClick('#team-body button[data-act="recruit"][data-id="zhou"]'); await sleep(600);
          const s2 = await snap();
          S.recruitAt = Math.round(pageNow());
          await keyShot("team-recruited");
          act(pageNow(), "recruit-success", { recruit: s2.team.recruit, hud: s2.hud, body: s2.team.body });
          if (await ev("!document.getElementById('team').classList.contains('hidden')")) { await jsClick("#team-close"); await sleep(320); }
          return true;
        }
      }
      if (await ev("!document.getElementById('team').classList.contains('hidden')")) { await jsClick("#team-close"); await sleep(300); }
      return false;
    };
    const energyFlow = async (p) => {
      if (await ev("document.getElementById('team').classList.contains('hidden')")) { await jsClick("#btn-team"); await sleep(480); }
      await jsClick("#tab-decor"); await sleep(420);
      const btn = await ev("(() => { const bs = Array.from(document.querySelectorAll('#team-body button[data-act=\\'energy\\']')).filter(function (b) { return !b.disabled; }); if (!bs.length) return null; const t = (bs[0].innerText || '').trim(); bs[0].click(); return t; })()");
      await sleep(400);
      const s = await snap();
      if (!S.energyShot) { S.energyShot = true; await keyShot("team-energy"); }
      act(p, "energy-use", { clicked: btn, toast: s.toast, hud: s.hud, energy: s.team.energy });
      if (await ev("!document.getElementById('team').classList.contains('hidden')")) { await jsClick("#team-close"); await sleep(320); }
      return !!btn;
    };
    const arcadeFlow = async (p) => {
      if (await ev("document.getElementById('arcade').classList.contains('hidden')")) { await jsClick("#btn-arcade"); await sleep(500); }
      await keyShot("arcade-menu");
      const started = await ev("(() => { const b = document.querySelector('#arcade-body button[data-game]'); if (!b) return null; const g = b.dataset.game; b.click(); return g; })()");
      act(p, "arcade-start", { game: started });
      if (!started) return false;
      // 等游戏结束（最多 40s），期间点游玩区（咖啡掉落）
      const t0 = pageNow();
      let shotMid = false;
      while (pageNow() - t0 < 42000) {
        const s = await snap();
        await drain();
        if (s.arcade.result) break;
        if (!shotMid && pageNow() - t0 > 6000) { shotMid = true; await keyShot("arcade-playing"); }
        const area = await rectOf("#play-area");
        if (area) await clickAt(area.x + (Math.random() - 0.5) * area.w * 0.5, area.y - 20);
        await sleep(220);
      }
      const s = await snap();
      await keyShot("arcade-result");
      OUT.panels.arcade = { p: Math.round(pageNow()), result: s.arcade.result, resultText: s.arcade.resultText, leftText: s.arcade.leftText };
      act(pageNow(), "arcade-result", { resultText: s.arcade.resultText, leftText: s.arcade.leftText });
      await jsClick("#arcade-close"); await sleep(350);
      return true;
    };


    const injectAndReload = async (p) => {
      // 1) 等一次 autosave 落盘（最多 15s）
      const t0 = Date.now();
      let raw = await ev("localStorage.getItem('moyu-save')");
      while (Date.now() - t0 < 15000) {
        if (raw) { try { if ((JSON.parse(raw).savedAt || 0) > S.startWall) break; } catch (e) { /* */ } }
        await sleep(600);
        raw = await ev("localStorage.getItem('moyu-save')");
      }
      // 2) 拦住 pagehide 自动存档（否则会把注入值覆盖回真实值）
      await ev("(() => { if (!window.__origSetItem) { window.__origSetItem = localStorage.setItem.bind(localStorage); localStorage.setItem = function (k, v) { if (window.__blockSave && String(k).indexOf('moyu-save') === 0) return; return window.__origSetItem(k, v); }; } window.__blockSave = true; return true; })()");
      const blob = raw ? JSON.parse(raw) : null;
      if (!blob) { act(p, "inject-fail", { raw: String(raw).slice(0, 80) }); return false; }
      blob.moyu = (blob.moyu || 0) + 20000;
      blob.totalEarned = (blob.totalEarned || 0) + 20000;
      blob.lifetimeEarned = (blob.lifetimeEarned || 0) + 20000;
      blob.savedAt = Date.now();
      const json = JSON.stringify(blob);
      await ev("window.__origSetItem('moyu-save', " + JSON.stringify(json) + "); window.__blockSave = true; true");
      act(p, "inject-save", { moyu: blob.moyu, levels: blob.levels, dailyClaimed: blob.daily && blob.daily.claimed });
      // 3) 刷新（新文档会重新执行 init script）
      await send("Page.reload", { ignoreCache: false });
      await waitFor("document.readyState === 'complete' && !!window.__snap");
      await waitFor("window.__frames > 5");
      await sleep(700);
      const pn2 = await ev("performance.now()");
      wall0 = Date.now() - pn2;
      S.injected = true;
      shotIdx = 0;
      shotSchedule.length = 0;
      for (let x = 0; x <= 90000; x += 2000) shotSchedule.push(x);
      const s2 = await snap();
      act(pageNow(), "reloaded-after-inject", { hud: s2.hud, onboarding: s2.onboarding, quest: s2.quest.text, badges: { arcade: s2.badges.arcade, talent: s2.badges.talent } });
      await keyShot("post-reload");
      return true;
    };

    const shotSchedule = [300, 700, 1000, 1500, 2000, 3000];
    for (let s = 4000; s <= Math.min(DURATION, 200000); s += 1000) shotSchedule.push(s);
    for (let s = 205000; s <= DURATION; s += 5000) shotSchedule.push(s);
    let shotIdx = 0;

    // 主循环
    while (true) {
      const p = pageNow();
      if (p > DURATION || Date.now() - S.startWall > DURATION + 150000) break;
      if (S.questDoneAt && p > S.questDoneAt + 20000) break;
      const s = await snap();
      if (!s || s.__err) { await sleep(80); continue; }

      if (!OUT.firstScreen.infoAt1s && p >= 1000) OUT.firstScreen.infoAt1s = await ev("window.__info()");
      if (!OUT.firstScreen.infoAt3s && p >= 3000) { OUT.firstScreen.infoAt3s = await ev("window.__info()"); await keyShot("first-screen"); }

      // 逐秒/逐5秒截图
      if (shotIdx < shotSchedule.length && p >= shotSchedule[shotIdx]) {
        const name = (S.injected ? "post-" : "sec-") + String(Math.round(p)).padStart(3, "0");
        await cap(DIR + "/shots/" + name + ".jpg", "jpg");
        OUT.frames.push({ p: Math.round(p), file: DIR + "/shots/" + name + ".jpg", snap: s });
        shotIdx += 1;
      }
      await stepLog(s, p);

      // 新手期角标隐藏核对（只记变化）
      const badgeKey = s.onboarding + "|" + JSON.stringify(s.badges);
      if (OUT.badgeStates === undefined) OUT.badgeStates = [];
      if (!OUT.badgeStates.length || OUT.badgeStates[OUT.badgeStates.length - 1].key !== badgeKey) {
        OUT.badgeStates.push({ p: Math.round(p), key: badgeKey, onboarding: s.onboarding, badges: s.badges });
      }

      // 目标链完成（必须见过目标条后才判定）
      if (S.questDoneAt === null && s.quest.vis) S.questSeen = true;
      if (!s.quest.vis && S.questSeen && S.questDoneAt === null) {
        S.questDoneAt = Math.round(p);
        act(p, "quest-finished");
        await keyShot("quest-finished");
      }

      // 弹窗优先
      if (await handleModals(p, s)) { await drain(); await sleep(90); continue; }

      // 其他模态（journal/team/arcade 由流程主动开，这里只防卡）
      if ((s.modals || []).length) { await drain(); await sleep(90); continue; }

      // FLOW 模式：到"招募第一位同事"步骤时注入存档并刷新，验证后面 3 步
      const qtNow = s.quest.vis ? s.quest.text : "";
      if (FLOW && !S.injected && S.recruitWallSeen && /招募第一位同事/.test(qtNow)) {
        const ok = await injectAndReload(p);
        if (ok) { await drain(); continue; }
      }

      // 目标条动作
      const qt = s.quest.vis ? s.quest.text : "";
      let didAction = false;
      if (S.questDoneAt === null) {
        if (/点右下 📔|领掉今天的工资/.test(qt)) {
          if (p - (S.lastJournalTry || 0) > 6000) { S.lastJournalTry = p; await journalFlow(p); didAction = true; }
        } else if (/招募第一位同事/.test(qt)) {
          if (p - (S.lastTeamTry || 0) > 2500) { S.lastTeamTry = p; await teamFlow(p); didAction = true; }
        } else if (/分配今天的精力/.test(qt)) {
          if (p - (S.lastEnergyTry || 0) > 2500) { S.lastEnergyTry = p; await energyFlow(p); didAction = true; }
        } else if (/玩一局摸鱼站/.test(qt)) {
          if (p - (S.lastArcadeTry || 0) > 3000) { S.lastArcadeTry = p; await arcadeFlow(p); didAction = true; }
        } else if (/等 10 秒/.test(qt)) {
          // 挂机步骤：不点击（等收入自然涨）
        } else if (/买下点亮的「咖啡续命」/.test(qt)) {
          await buyCard("coffee"); didAction = true;
        } else if (/买下「刷手机」/.test(qt)) {
          await buyCard("phone"); didAction = true;
        } else if (/再戳|攒够 50/.test(qt)) {
          await tapCanvas(); didAction = true;
        } else if (/选一张「今日摸鱼卡」/.test(qt)) {
          if (!s.cardsText) { /* 等卡弹窗 */ }
        }
      }

      // 丢梗
      if (s.meme && p - S.lastMemeAct > 4000) { S.lastMemeAct = p; act(p, "meme-appear", s.meme); }
      if (s.meme && p - (S.lastMemeTap || 0) > 4000) { await clickAt(s.meme.x, s.meme.y); S.lastMemeTap = p; S.memeTapped += 1; act(p, "meme-tap"); }

      // 自动买：有确认的再点一次；其余时间买最便宜的可买项（招募攒钱 >8000 时停买）
      const numOf = (t) => {
        const v = parseFloat((t || "0").replace(/[^\d.]/g, "")) || 0;
        if ((t || "").indexOf("亿") >= 0) return v * 1e8;
        if ((t || "").indexOf("万") >= 0) return v * 1e4;
        return v;
      };
      const confirmCard = (s.shop || []).find((c) => c.confirming);
      if (confirmCard) { await buyCard(confirmCard.id); await sleep(150); }
      else if (S.questDoneAt === null && !(FLOW && S.injected)) {
        const savingForRecruit = /招募第一位同事/.test(qt);
        const bal = numOf(s.hud.moyu);
        const stopBuy = savingForRecruit || (FLOW && S.injected);
        const enabled = (s.shop || []).filter((c) => !c.disabled);
        if (enabled.length && !stopBuy && p - (S.lastBuy || 0) > 650) {
          const target = enabled.slice().sort((a, b) => numOf(a.cost) - numOf(b.cost))[0];
          S.lastBuy = p;
          await buyCard(target.id);
          didAction = true;
        }
      }

      // 空闲点击（tap 阶段、攒钱阶段、长跑攒钱）
      const canTap = p > 4200 && !S.cardPicked ? false : true;
      if (S.questDoneAt === null && /再戳|攒够 50|招募|什么都不点/.test(qt) === false && /等 10 秒/.test(qt)) {
        // idle 步骤不点
      } else if (p > 4200 && Date.now() - S.lastTapWall > 260) {
        if (S.questDoneAt === null) {
          if (/再戳|攒够 50/.test(qt)) { await tapCanvas(); didAction = true; }
          else if (/买下点亮的|买下「刷手机」/.test(qt)) {
            const need = /咖啡/.test(qt) ? "coffee" : "phone";
            const card = (s.shop || []).find((x) => x.id === need);
            if (card && card.disabled) { await tapCanvas(); didAction = true; }
          } else if (/今日摸鱼卡/.test(qt)) { /* 等弹窗 */ }
          else if (/招募第一位同事/.test(qt)) { await tapCanvas(); didAction = true; }
          else if (/点右下 📔|领掉今天的工资/.test(qt)) { await tapCanvas(); didAction = true; }
          else if (/分配今天的精力|玩一局摸鱼站/.test(qt)) { /* 有模态流程 */ }
        } else {
          // post：继续戳（观察角标解锁后的画面）
          await tapCanvas(); didAction = true;
          if (!S.doneShots && p > S.questDoneAt + 2000) { S.doneShots = true; await keyShot("post-onboarding"); OUT.postOnboarding = { p: Math.round(p), snap: await snap(), info: await ev("window.__info()") }; }
        }
      }

      await drain();
      await sleep(75);
    }

    // 收尾
    const end = await snap();
    OUT.endState = {
      p: Math.round(pageNow()), snap: end, info: await ev("window.__info()"),
      nav: await ev("(() => { const n = performance.getEntriesByType('navigation')[0]; const p = performance.getEntriesByType('paint'); return { ttfb: n ? Math.round(n.responseStart) : null, dcl: n ? Math.round(n.domContentLoadedEventEnd) : null, load: n ? Math.round(n.loadEventEnd) : null, paints: p.map(function (x) { return { name: x.name, t: Math.round(x.startTime) }; }) }; })()"),
      fps: await ev("(() => { const t = performance.now(); return { frames: window.__frames, elapsed: Math.round(t), avgFps: +(window.__frames / (t / 1000)).toFixed(1) }; })()"),
      saveRaw: await ev("localStorage.getItem('moyu-save')"),
      aboutVersion: await ev("(document.getElementById('about-version') || {}).textContent || ''"),
      errors: (c.errors || []).slice(0, 8),
    };
    await drain();
    writeFileSync(DIR + "/evidence.json", JSON.stringify(OUT, null, 2));
    writeFileSync(DIR + "/summary.txt", [
      "label=" + LABEL, "mode=" + MODE,
      "frames=" + OUT.frames.length, "events=" + OUT.events.length, "steps=" + OUT.steps.length,
      "firstToasts=" + JSON.stringify(OUT.events.filter((e) => e.k === "text" && e.d && e.d.id === "dom-toast").slice(0, 4).map((e) => e.t + ":" + e.d.text)),
      "questDoneAt=" + S.questDoneAt, "claimAt=" + S.claimAt, "recruitAt=" + S.recruitAt,
      "recruitWall=" + JSON.stringify(OUT.panels.recruitWall && { balance: OUT.panels.recruitWall.balance, recruit: OUT.panels.recruitWall.recruit }),
      "arcadeResult=" + JSON.stringify(OUT.panels.arcade && OUT.panels.arcade.resultText),
      "taps=" + S.taps, "finalHud=" + JSON.stringify(end.hud),
      "badgeStates=" + OUT.badgeStates.length,
      "endOnboarding=" + end.onboarding, "endBadges=" + JSON.stringify(end.badges),
    ].join("\n"));
    console.log("[v06] done label=" + LABEL, JSON.stringify({
      questSteps: OUT.steps.length, questDoneAt: S.questDoneAt, claimAt: S.claimAt, recruitAt: S.recruitAt,
      taps: S.taps, finalHud: end.hud, onboarding: end.onboarding,
      arcade: OUT.panels.arcade ? OUT.panels.arcade.resultText : null,
    }));
    c.close();
  },
  { timeoutMs: DURATION + 180_000 },
);
console.log("[v06] written " + DIR + "/evidence.json");