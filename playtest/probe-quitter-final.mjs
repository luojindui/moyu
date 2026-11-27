/**
 * 终验·弃坑型新玩家（线上 v0.5.0）
 * 全新账号 390x844 触屏（mobile emulation），从 navigation 开始逐秒记录 120 秒：
 *  - 每秒截图 + DOM 快照（模态/角标/toast/HUD/任务条/商店）
 *  - 模拟自然新手行为：先看 4 秒 → 戳屏幕（任务条说"再戳 15 下"）→ 8 下弹每日卡 → 选卡 →
 *    买咖啡/刷手机 → 遇上第一次王总回合制（choice）→ 打开 👥 / 🎮 / 📔 看一眼 → 继续戳
 *  - 记录全部 DOM 变更事件（toast / announce / 面板开合 / 角标）
 *  - 面板信息量体检：文本量 / 滚动高度 / 按钮数 / 价格门槛 vs 当前余额
 * 只用线上 https://luojindui.github.io/moyu/ ；不改 src/。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const URL = "https://luojindui.github.io/moyu/";
const DIR = "playtest/quitter-final";
mkdirSync(DIR + "/shots", { recursive: true });

const OUT = {
  meta: {},
  firstScreen: {},
  frames: [],
  events: [],
  actions: [],
  panels: {},
  screens: {},
  endState: {},
};

// ---------------------------------------------------------------------------
// 注入脚本（在 document-start 执行）：事件记录器 + 快照函数 + 画布黄点坐标捕获
// ---------------------------------------------------------------------------
function initScript() {
  window.__qlog = [];
  window.__frames = 0;
  const rec = (k, d) => {
    try {
      window.__qlog.push({ t: +(performance.now()).toFixed(0), k, d });
    } catch (e) {
      /* ignore */
    }
  };
  window.__qrec = rec;
  window.addEventListener("error", (e) => rec("error", String(e && e.message)));
  window.addEventListener("unhandledrejection", (e) => rec("rejection", String(e && e.reason)));

  // rAF 计数（估算 fps / 判断首帧）
  const raf0 = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return raf0(function (t) {
      window.__frames += 1;
      return cb(t);
    });
  };

  // 关键节点变更：模态开合 / toast 文本 / 读屏播报 / 任务条 / HUD 数字 / 角标
  const watch = (id) => {
    const el = document.getElementById(id);
    if (!el) {
      rec("missing", id);
      return;
    }
    rec("init", { id, cls: String(el.className), text: (el.textContent || "").slice(0, 120) });
    new MutationObserver(function (ms) {
      for (const m of ms) {
        if (m.type === "attributes") rec("attr", { id, cls: String(el.className), aria: el.getAttribute("aria-label") });
        else rec("text", { id, text: (el.textContent || "").trim().slice(0, 260) });
      }
    }).observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
  };
  document.addEventListener("DOMContentLoaded", function () {
    [
      "welcome", "cards", "cards-body", "boss-choice", "arcade", "team", "journal",
      "dom-toast", "sr-live", "quest", "hud-card", "hud-combo", "hud-streak",
      "btn-arcade", "btn-team", "btn-mute", "btn-journal",
    ].forEach(watch);
    rec("dom-ready", null);
  });

  // 场景里"老周丢梗"黄点：画布 arc(#ffd76e) 的圆心 → 换算 CSS 坐标
  const origArc = CanvasRenderingContext2D.prototype.arc;
  CanvasRenderingContext2D.prototype.arc = function (x, y, r, a0, a1) {
    try {
      if (r > 4 && this.fillStyle === "#ffd76e") {
        const cv = this.canvas;
        const b = cv.getBoundingClientRect();
        window.__memeArc = {
          x: +(b.left + (x / cv.width) * b.width).toFixed(1),
          y: +(b.top + (y / cv.height) * b.height).toFixed(1),
          t: +performance.now().toFixed(0),
        };
      }
    } catch (e) {
      /* ignore */
    }
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
    const txt = (id) => {
      const el = document.getElementById(id);
      return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "";
    };
    const open = (id) => {
      const el = document.getElementById(id);
      return !!el && !el.classList.contains("hidden");
    };
    const rect = (id) => {
      const el = document.getElementById(id);
      if (!el || !vis(el)) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const toastEl = document.getElementById("dom-toast");
    const meme = window.__memeArc;
    const shop = Array.from(document.querySelectorAll("#shop-cards .shop-card")).map((c) => ({
      id: c.dataset.upgrade || "",
      name: (c.querySelector(".shop-name") || {}).textContent || "",
      cost: (c.querySelector(".shop-cost b") || {}).textContent || "",
      disabled: !!c.disabled,
      confirming: c.classList.contains("confirming"),
      unlocked: c.classList.contains("just-unlocked"),
    }));
    const badge = (sel) => {
      const el = document.querySelector(sel);
      return el ? (el.textContent || "").trim() : "";
    };
    return {
      t: +performance.now().toFixed(0),
      frames: window.__frames,
      modals: ["welcome", "cards", "boss-choice", "arcade", "team", "journal"].filter(open),
      hud: {
        moyu: txt("hud-moyu"), click: txt("hud-click"), idle: txt("hud-idle"), rank: txt("hud-rank"),
        card: txt("hud-card"), combo: txt("hud-combo"), streak: txt("hud-streak"),
      },
      quest: {
        vis: open("quest"), text: txt("quest-text"),
        bar: (document.getElementById("quest-bar") || {}).style ? document.getElementById("quest-bar").style.width : "",
      },
      toast: toastEl && toastEl.classList.contains("show") ? (toastEl.textContent || "").trim() : "",
      sr: txt("sr-live"),
      btn: {
        arcade: txt("btn-arcade"), arcadeBadge: badge("#btn-arcade .arcade-badge"),
        team: txt("btn-team"), teamAria: (document.getElementById("btn-team") || {}).getAttribute ? document.getElementById("btn-team").getAttribute("aria-label") : "",
        teamBadges: Array.from(document.querySelectorAll("#btn-team .badge, #btn-team .talent-badge, #btn-team .energy-badge")).map((e) => (e.textContent || "").trim()),
        mute: txt("btn-mute"),
        journal: txt("btn-journal"), journalReward: !!(document.getElementById("btn-journal") || {}).classList && document.getElementById("btn-journal").classList.contains("has-reward"),
      },
      shop,
      rects: { hud: rect("hud"), canvas: rect("stage"), shop: rect("shop"), quest: rect("quest"), btnTeam: rect("btn-team"), cardsPanel: rect("cards") },
      cardsText: open("cards") ? txt("cards-body").slice(0, 700) : "",
      boss: open("boss-choice")
        ? {
            tell: txt("boss-tell"),
            opts: Array.from(document.querySelectorAll("#boss-opts button")).map((b) => (b.innerText || "").trim()),
            timer: txt("boss-timer"),
          }
        : null,
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
      const fs = Math.round(parseFloat(cs.fontSize) || 0);
      texts.push({ t: t.slice(0, 40), x: Math.round(r.x), y: Math.round(r.y), size: fs });
    }
    const inter = Array.from(document.querySelectorAll("button, [role=button], a, input, textarea"))
      .filter(vis)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          tag: el.tagName, id: el.id || "", cls: String(el.className).slice(0, 40),
          text: ((el.innerText || el.getAttribute("aria-label") || "") + "").replace(/\s+/g, " ").trim().slice(0, 40),
          x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
          fs: Math.round(parseFloat(cs.fontSize) || 0),
        };
      });
    return {
      t: +performance.now().toFixed(0),
      nText: texts.length,
      chars: texts.reduce((a, b) => a + b.t.length, 0),
      minFont: texts.length ? Math.min.apply(null, texts.map((x) => x.size)) : 0,
      smallTexts: texts.filter((x) => x.size <= 11).slice(0, 25),
      texts: texts.slice(0, 90),
      nInteractive: inter.length,
      interactive: inter.slice(0, 45),
      bodyText: (document.body.innerText || "").replace(/\n{2,}/g, "\n").trim().slice(0, 2500),
    };
  };
}

const INIT = "(" + initScript.toString() + ")();";

// ---------------------------------------------------------------------------
await runChrome(
  async ({ port }) => {
    const c = await connect(port);
    const { send, ev } = c;
    const writeB64 = (file, b64) => writeFileSync(file, Buffer.from(b64, "base64"));
    const shot = async (file, fmt) => {
      const params = fmt === "png" ? { format: "png" } : { format: "jpeg", quality: 62 };
      const r = await send("Page.captureScreenshot", params);
      writeB64(file, r.data);
      return file;
    };
    const pageError = (v) => v && typeof v === "object" && v.__err;

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: INIT });
    const tNav = Date.now();
    await send("Page.navigate", { url: URL });

    const waitFor = async (expr, timeout = 20000, step = 100) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        const v = await ev(expr);
        if (v) return v;
        await sleep(step);
      }
      return null;
    };
    await waitFor("document.readyState === 'complete' && !!window.__snap");
    await waitFor("window.__frames > 5");
    const pn = await ev("performance.now()");
    const wall0 = Date.now() - pn;
    const pageNow = () => Date.now() - wall0;
    OUT.meta = {
      url: URL,
      viewport: "390x844@2 mobile",
      ua: await ev("navigator.userAgent"),
      navToReadyMs: Date.now() - tNav,
      pageNowAtReady: Math.round(pn),
    };

    // ---------- 通用操作 ----------
    const rectOf = async (sel) =>
      ev(
        "(() => { const el = document.querySelector(" + JSON.stringify(sel) + "); if (!el) return null; const b = el.getBoundingClientRect(); if (b.width < 1 || b.height < 1) return null; return { x: b.x + b.width/2, y: b.y + b.height/2, w: b.width, h: b.height }; })()",
      );
    const clickAt = async (x, y) => {
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await sleep(24);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    };
    const clickSel = async (sel) => {
      const r = await rectOf(sel);
      if (!r) return false;
      await clickAt(r.x, r.y);
      return true;
    };
    const tapCanvas = async (fx, fy) => {
      const r = await rectOf("#stage");
      if (!r) return false;
      await clickAt(r.x - r.w / 2 + r.w * (fx || 0.45), r.y - r.h / 2 + r.h * (fy || 0.6));
      S.taps += 1;
      S.lastTapWall = Date.now();
      return true;
    };
    const panelInfo = async (rootId, panelSel) =>
      ev(
        "(() => { const root = document.getElementById(" + JSON.stringify(rootId) + "); if (!root) return null; const panel = root.querySelector(" + JSON.stringify(panelSel) + ") || root; const t = (panel.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim(); return { open: !root.classList.contains('hidden'), textLen: t.length, text: t.slice(0, 6000), scrollH: panel.scrollHeight, clientH: panel.clientHeight, nButtons: panel.querySelectorAll('button').length, buttons: Array.from(panel.querySelectorAll('button')).slice(0, 32).map(function (b) { const r = b.getBoundingClientRect(); return { t: ((b.innerText || '') + '').trim().slice(0, 40), disabled: !!b.disabled, h: Math.round(r.height), fs: Math.round(parseFloat(getComputedStyle(b).fontSize) || 0) }; }), nRows: panel.querySelectorAll('.talent, .card, .game-card, .colleague, .decor-card, .journal-cell').length }; })()",
      );

    const S = {
      taps: 0,
      lastTapWall: 0,
      cardShown: null,
      cardHandled: false,
      cardChoice: null,
      bossShown: null,
      bossHandled: false,
      bossAnswer: null,
      memes: [],
      memeTapped: [],
      coffeeBought: false,
      phoneBought: false,
      waterBought: false,
      phase: "observe",
      questGone: null,
      panelsDone: false,
      muteTried: false,
      firstTapTaken: false,
      cardsShot: false,
      bossShot: false,
      keyFrames: [],
    };
    const act = (p, k, d) => {
      const a = { p: Math.round(p), k, d: d === undefined ? null : d };
      OUT.actions.push(a);
      return a;
    };
    const keyShot = async (p, name, fmt) => {
      const file = DIR + "/shots/" + name + (fmt === "png" ? ".png" : ".jpg");
      await shot(file, fmt || "png");
      S.keyFrames.push({ p: Math.round(p), name: file });
      return file;
    };

    // ---------- 逐秒记录主循环 ----------
    let nextShot = 700;
    let lastDrain = 0;
    const drainEvents = async () => {
      const q = await ev("window.__qlog.splice(0)");
      if (Array.isArray(q) && q.length) {
        for (const e of q) OUT.events.push(e);
      }
    };

    // 面板体检（顺序：👥 → 🎮 → 📔），只在第一次进入
    const runPanels = async () => {
      S.phase = "panels";
      let p = pageNow();
      act(p, "panels-start");

      // 👥 小队
      await clickSel("#btn-team");
      await sleep(520);
      let snap = await ev("window.__snap()");
      if (snap && snap.modals && snap.modals.indexOf("team") >= 0) {
        act(pageNow(), "team-open-colleagues");
        await keyShot(pageNow(), "key-team-colleagues");
        OUT.panels.teamColleagues = { p: Math.round(pageNow()), snap, info: await panelInfo("team", ".team-panel") };
        await clickSel("#tab-talents");
        await sleep(420);
        await keyShot(pageNow(), "key-team-talents");
        OUT.panels.teamTalents = { p: Math.round(pageNow()), info: await panelInfo("team", ".team-panel") };
        await clickSel("#tab-decor");
        await sleep(420);
        await keyShot(pageNow(), "key-team-decor");
        OUT.panels.teamDecor = { p: Math.round(pageNow()), info: await panelInfo("team", ".team-panel") };
        await clickSel("#team-close");
        await sleep(420);
        act(pageNow(), "team-close");
      } else {
        act(pageNow(), "team-open-failed", snap && snap.modals);
      }
      await drainEvents();

      // 🎮 摸鱼站
      await clickSel("#btn-arcade");
      await sleep(520);
      snap = await ev("window.__snap()");
      if (snap && snap.modals && snap.modals.indexOf("arcade") >= 0) {
        act(pageNow(), "arcade-open");
        await keyShot(pageNow(), "key-arcade-menu");
        OUT.panels.arcade = { p: Math.round(pageNow()), snap, info: await panelInfo("arcade", ".arcade-panel") };
        await clickSel("#arcade-close");
        await sleep(420);
        act(pageNow(), "arcade-close");
      } else {
        act(pageNow(), "arcade-open-failed", snap && snap.modals);
      }
      await drainEvents();

      // 📔 日报
      await clickSel("#btn-journal");
      await sleep(560);
      snap = await ev("window.__snap()");
      if (snap && snap.modals && snap.modals.indexOf("journal") >= 0) {
        act(pageNow(), "journal-open");
        await keyShot(pageNow(), "key-journal-top");
        const top = await panelInfo("journal", ".journal-panel");
        await ev("(() => { const el = document.querySelector('#journal .journal-panel'); if (el) el.scrollTop = el.scrollHeight; return (el||{}).scrollTop; })()");
        await sleep(420);
        await keyShot(pageNow(), "key-journal-bottom");
        const bottom = await panelInfo("journal", ".journal-panel");
        OUT.panels.journal = { p: Math.round(pageNow()), snapTop: snap, top, bottom };
        // 原样滚回顶部并关闭
        await clickSel("#journal-close");
        await sleep(420);
        act(pageNow(), "journal-close");
      } else {
        act(pageNow(), "journal-open-failed", snap && snap.modals);
      }
      await drainEvents();

      // 🔊 静音开关（顺手确认它不是新系统）
      const before = await ev("document.getElementById('btn-mute').getAttribute('aria-label')");
      await clickSel("#btn-mute");
      await sleep(260);
      const after = await ev("document.getElementById('btn-mute').getAttribute('aria-label')");
      act(pageNow(), "mute-toggle", { before, after });
      S.muteTried = true;
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
        // 每秒一帧
        if (p >= nextShot) {
          const name = "sec-" + String(Math.round(p)).padStart(3, "0");
          const file = DIR + "/shots/" + name + ".jpg";
          await shot(file);
          OUT.frames.push({ p: Math.round(p), file, snap: s });
          nextShot += 1000;
        }
        // 任务条消失时刻
        if (S.questGone === null && s.quest && s.quest.vis === false) {
          S.questGone = Math.round(p);
          act(p, "quest-gone");
        }

        const modals = s.modals || [];
        const inModal = modals.length > 0;

        // ---------- ① 每日摸鱼卡 ----------
        if (modals.indexOf("cards") >= 0) {
          if (!S.cardShown) {
            S.cardShown = p;
            act(p, "cards-shown", s.cardsText);
            if (!S.cardsShot) {
              S.cardsShot = true;
              await keyShot(p, "key-cards");
              OUT.screens.cards = { p: Math.round(p), snap: s, info: await ev("window.__info()") };
            }
          }
          if (!S.cardHandled && p - S.cardShown > 2400) {
            const ok = await clickSel("#cards .card");
            if (ok) {
              S.cardHandled = true;
              S.cardChoice = s.cardsText;
              act(p, "cards-chose-first", s.cardsText);
            }
          }
          await drainEvents();
          await sleep(90);
          continue;
        }

        // ---------- ② 回合制老板（第一次固定 choice） ----------
        if (modals.indexOf("boss-choice") >= 0) {
          if (!S.bossShown) {
            S.bossShown = p;
            act(p, "boss-choice-shown", s.boss);
            if (!S.bossShot) {
              S.bossShot = true;
              await keyShot(p, "key-boss-choice");
              OUT.screens.boss = { p: Math.round(p), snap: s };
            }
          }
          if (!S.bossHandled && p - S.bossShown > 1800) {
            const ok = await clickSel("#boss-opts button");
            if (ok) {
              S.bossHandled = true;
              S.bossAnswer = s.boss;
              act(p, "boss-answered-first", s.boss);
            }
          }
          await drainEvents();
          await sleep(90);
          continue;
        }

        if (inModal) {
          // 其他模态（正常流程里不应在 2 分钟内出现）
          await drainEvents();
          await sleep(90);
          continue;
        }

        // ---------- ③ 自然操作 ----------
        const nowWall = Date.now();
        // 记录丢梗
        if (s.meme && s.meme.t) {
          if (!S.memes.some((m) => m.t === s.meme.t)) {
            S.memes.push(s.meme);
            act(p, "meme-appeared", s.meme);
            await keyShot(p, "key-meme", "jpg");
          }
        }

        // 商店购买（可买就买）
        for (const it of s.shop || []) {
          if (it.disabled || it.confirming) continue;
          if (it.id === "coffee" && !S.coffeeBought) {
            if (await clickSel('#shop-cards .shop-card[data-upgrade="coffee"]')) {
              S.coffeeBought = true;
              act(p, "buy-coffee", it);
            }
          } else if (it.id === "phone" && !S.phoneBought) {
            if (await clickSel('#shop-cards .shop-card[data-upgrade="phone"]')) {
              S.phoneBought = true;
              act(p, "buy-phone", it);
            }
          } else if (it.id === "water" && !S.waterBought && p > 90_000) {
            if (await clickSel('#shop-cards .shop-card[data-upgrade="water"]')) {
              S.waterBought = true;
              act(p, "buy-water", it);
            }
          }
        }

        // 点屏幕（新手会照着任务条做）
        const canTap = p >= 4200 && !S.panelsDone && nowWall - S.lastTapWall > 460;
        if (canTap && !S.cardHandled) {
          // 8 下前戳；8 下后停手等每日卡弹出（弹窗要求 800ms 无点击）
          if (S.taps < 8) {
            await tapCanvas();
            if (!S.firstTapTaken) {
              S.firstTapTaken = true;
              act(p, "first-tap");
              await sleep(160);
              await keyShot(p, "key-first-tap", "jpg");
            }
          }
        } else if (canTap && S.cardHandled) {
          if (!S.phoneBought || p < 46_000) {
            // 若黄点出现，先戳黄点
            if (s.meme && !S.memeTapped.some((m) => m.t === s.meme.t)) {
              await clickAt(s.meme.x, s.meme.y);
              S.memeTapped.push(s.meme);
              act(p, "meme-tap", s.meme);
            } else {
              await tapCanvas();
            }
          }
        }

        // 面板体检进场时机
        if (!S.panelsDone && p >= 46_000 && S.phoneBought) {
          await runPanels();
        }

        // 2 分钟尾段：继续戳（看还有没有新东西）
        if (S.panelsDone && p >= 92_000 && p < 119_000 && nowWall - S.lastTapWall > 480) {
          await tapCanvas(0.45, 0.55);
        }
      }
      await drainEvents();
      await sleep(85);
    }

    // 120s 结束帧
    await keyShot(pageNow(), "key-final-120s");
    OUT.firstScreen.first = OUT.frames[0] ? OUT.frames[0].snap : null;

    // ---------- 收尾数据 ----------
    OUT.endState.snap = await ev("window.__snap()");
    OUT.endState.info = await ev("window.__info()");
    OUT.endState.saveRaw = await ev("localStorage.getItem('moyu-save')");
    OUT.endState.saveKeys = await ev("Object.keys(localStorage)");
    OUT.endState.navTiming = await ev(
      "(() => { const n = performance.getEntriesByType('navigation')[0]; const p = performance.getEntriesByType('paint'); return { ttfb: n ? Math.round(n.responseStart) : null, dcl: n ? Math.round(n.domContentLoadedEventEnd) : null, load: n ? Math.round(n.loadEventEnd) : null, paints: p.map(function (x) { return { name: x.name, t: Math.round(x.startTime) }; }), transferKB: Math.round(performance.getEntriesByType('resource').reduce(function (a, r) { return a + (r.transferSize || 0); }, 0) / 1024), nRes: performance.getEntriesByType('resource').length }; })()",
    );
    OUT.endState.resources = await ev(
      "performance.getEntriesByType('resource').map(function (r) { return { n: r.name.split('/').slice(-2).join('/'), kb: Math.round((r.transferSize || 0) / 1024), ms: Math.round(r.duration), st: r.responseStatus }; })",
    );
    OUT.endState.fps = await ev(
      "(() => { const t = performance.now(); return { frames: window.__frames, elapsed: Math.round(t), avgFps: +(window.__frames / (t / 1000)).toFixed(1) }; })()",
    );
    OUT.endState.localErrors = OUT.events.filter((e) => e.k === "error" || e.k === "rejection" || e.k === "missing");
    OUT.endState.runtimeExceptionCount = c.errors.length;

    // ---------- 附：桌面 1280x800 首屏（仅版面参考） ----------
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(900);
    await shot(DIR + "/shots/desktop-1280x800.png", "png");
    OUT.endState.desktopInfo = await ev("window.__info()");

    c.close();
    writeFileSync(DIR + "/evidence.json", JSON.stringify(OUT, null, 2));
    writeFileSync(
      DIR + "/summary.txt",
      [
        "url=" + URL,
        "frames=" + OUT.frames.length,
        "events=" + OUT.events.length,
        "actions=" + OUT.actions.length,
        "cardsShownAt=" + S.cardShown,
        "cardChosen=" + S.cardHandled,
        "bossShownAt=" + S.bossShown,
        "bossAnswered=" + S.bossHandled,
        "memeCount=" + S.memes.length,
        "memeTapped=" + S.memeTapped.length,
        "coffeeBought=" + S.coffeeBought,
        "phoneBought=" + S.phoneBought,
        "questGoneAt=" + S.questGone,
        "panelsDone=" + S.panelsDone,
        "taps=" + S.taps,
      ].join("\n"),
    );
    console.log("[probe] done", JSON.stringify({ frames: OUT.frames.length, events: OUT.events.length, cards: S.cardShown, boss: S.bossShown, memes: S.memes.length, taps: S.taps }));
  },
  { timeoutMs: 300_000 },
);
console.log("[probe] evidence written to", DIR + "/evidence.json");