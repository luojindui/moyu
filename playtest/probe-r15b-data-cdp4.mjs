/**
 * R15b 实机复验 v4 —— 打「固定快照」避免 HMR 干扰
 * 目标：http://127.0.0.1:5199/（vite preview /tmp/r15-dist，对应 HEAD 8d4b598 的 src 快照）
 *
 *  A) 启动态：🎮 角标剩余次数 / 菜单"满分≈25秒挂机"文案
 *  B) <2s 误触退出：退还次数（played 不变、无奖励）
 *  C) ~3s 退出：按 playedSeconds 折算（ratio = playedSec/10），结算当前分数
 *  D) 接咖啡：杯口自动接（漏前 3 个）→ 漏接计入 / 奖励公式
 *  E) 节奏：正拍 perfect → 1180 / 奖励
 * 用 playtest/lib/chrome.mjs（无残留进程）
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect } from "./lib/chrome.mjs";

const OUT = "playtest/r15-data";
mkdirSync(OUT, { recursive: true });
const URL_ = process.env.R15_URL ?? "http://127.0.0.1:5199/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = { url: URL_, phases: {}, consoleErrors: [] };
const IDLE = 0.2;
/** 复刻 HEAD 8d4b598 finishGame 公式（playedSeconds 折算） */
const rewardCalc = (score, playedSeconds, idle = IDLE) => {
  const capped = Math.min(score, 8000);
  const scoreRatio = Math.min(1, capped / 600);
  const timeRatio = Math.max(0, Math.min(1, playedSeconds / 30));
  const ratio = scoreRatio * (timeRatio >= 1 / 3 ? 1 : timeRatio * 3);
  return Math.max(Math.floor(idle * 25 * ratio), Math.ceil(30 * ratio));
};
const parseScore = (txt) => {
  const m = /(-?\d+)\s*分/.exec(txt ?? "");
  return m ? Number(m[1]) : null;
};

await runChrome(
  async ({ port }) => {
    const c = await connect(port);
    const evJson = async (expr) => {
      const v = await c.ev(expr);
      if (typeof v !== "string") return v;
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    };
    const waitFor = async (expr, timeout = 40_000, step = 100) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        if ((await c.ev(expr)) === true) return true;
        await sleep(step);
      }
      return false;
    };
    const shot = async (name) => {
      const r = await c.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, "base64"));
    };
    const forceClose = async () => {
      await c.ev("window.__confirmBypass = true; (() => { const r = document.getElementById('arcade'); if (!r.classList.contains('hidden')) { const b = document.getElementById('arcade-close'); if (b) b.click(); } return true; })()");
      await sleep(150);
    };
    const resetGame = async () => {
      await forceClose();
      await c.ev("__MOYU__.reset(); true");
      await sleep(350);
      await c.ev("window.confirm = () => window.__confirmAnswer !== false; window.__confirmAnswer = true; true");
    };
    const openArcade = async () => {
      const isOpen = await c.ev(`!document.getElementById('arcade').classList.contains('hidden')`);
      if (!isOpen) {
        await c.ev("document.getElementById('btn-arcade').click(); true");
        await sleep(150);
      }
    };
    const resultOf = () =>
      evJson(`(() => {
        const s = __MOYU__.state;
        return JSON.stringify({
          scoreText: document.querySelector('.arcade-score')?.textContent ?? null,
          rewardText: document.querySelector('.arcade-reward')?.textContent ?? null,
          detail: [...document.querySelectorAll('.arcade-hint')].map(x => x.textContent).join(' | '),
          result: document.getElementById('arcade-body').textContent.replace(/\\s+/g, ' ').trim(),
          played: s.arcade.played,
          best: s.arcade.best,
          toasts: window.__toasts,
        });
      })()`);

    await c.send("Page.enable");
    await c.send("Runtime.enable");
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
    await c.send("Page.navigate", { url: URL_ });
    ev.phases.ready = await waitFor("!!window.__MOYU__", 40_000);
    await c.ev(`(() => {
      window.confirm = () => window.__confirmAnswer !== false;
      window.__confirmAnswer = true;
      window.__toasts = [];
      const el = document.getElementById('dom-toast');
      if (el) new MutationObserver(() => window.__toasts.push({ t: Math.round(performance.now()), text: el.textContent }))
        .observe(el, { childList: true, characterData: true, subtree: true });
      return true;
    })()`);
    await resetGame();

    /* ===== A) 启动态：角标 / 菜单文案 ===== */
    ev.phases.boot = await evJson(`JSON.stringify({
      arcadeBtn: document.getElementById('btn-arcade')?.textContent,
      badge: document.querySelector('#btn-arcade .arcade-badge')?.textContent ?? null,
      aria: document.getElementById('btn-arcade')?.getAttribute('aria-label'),
    })`);
    await openArcade();
    ev.phases.menu = await evJson(`JSON.stringify({
      left: document.getElementById('arcade-left').textContent,
      body: document.getElementById('arcade-body').textContent.replace(/\\s+/g, ' ').trim(),
    })`);
    await shot("v4-menu");

    /* ===== B) <2s 误触退出：退还次数 ===== */
    await c.ev(`document.querySelector('#arcade-body button[data-game="coffee"]').click(); true`);
    await sleep(1000);
    await c.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
    await sleep(400);
    ev.phases.exitUnder2s = await evJson(`JSON.stringify({
      arcade: __MOYU__.state.arcade,
      hidden: document.getElementById('arcade').classList.contains('hidden'),
      toasts: window.__toasts,
    })`);
    await resetGame();

    /* ===== C) ~3s 退出：按 playedSeconds 折算 ===== */
    await openArcade();
    await c.ev(`document.querySelector('#arcade-body button[data-game="findboss"]').click(); true`);
    await c.ev(`(() => {
      window.__q = { clicks: 0 };
      const t = setInterval(() => {
        const b = document.querySelector('button.face.boss');
        if (!b) { clearInterval(t); return; }
        b.click();
        window.__q.clicks++;
        if (window.__q.clicks >= 12) clearInterval(t);
      }, 120);
      return true;
    })()`);
    await sleep(2000);
    const preExit = await evJson(`JSON.stringify({
      clicks: window.__q.clicks,
      timer: document.getElementById('play-timer')?.textContent,
      liveScore: document.getElementById('play-score')?.textContent,
    })`);
    const playedSec = Number((30 - parseFloat(preExit.timer)).toFixed(2));
    await c.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
    await sleep(450);
    const exit3s = await evJson(`JSON.stringify({
      arcade: __MOYU__.state.arcade,
      hidden: document.getElementById('arcade').classList.contains('hidden'),
      toasts: window.__toasts,
    })`);
    ev.phases.exitAt3s = {
      preExit,
      playedSeconds: playedSec,
      settledScoreExpected: 50 * preExit.clicks,
      rewardExpected: rewardCalc(50 * preExit.clicks, playedSec),
      after: exit3s,
    };
    await resetGame();

    /* ===== D) 接咖啡：自动接（漏前 3 个） ===== */
    await openArcade();
    await c.ev(`(() => {
      document.querySelector('#arcade-body button[data-game="coffee"]').click();
      window.__auto = { t0: performance.now(), seen: 0, tapped: 0, tops: [], lastTopAt: 0 };
      window.__autoTimer = setInterval(() => {
        const a = document.getElementById('play-area');
        if (!a) { clearInterval(window.__autoTimer); return; }
        const ar = a.getBoundingClientRect();
        document.querySelectorAll('#play-drops .drop').forEach((el) => {
          if (!el.__sid) el.__sid = ++window.__auto.seen;
          if (el.__sid === 1 && !el.__tapped && window.__auto.tops.length < 18 && performance.now() - window.__auto.lastTopAt > 180) {
            window.__auto.lastTopAt = performance.now();
            const r = el.getBoundingClientRect();
            window.__auto.tops.push({ t: Math.round(performance.now() - window.__auto.t0), rel: +(((r.top + r.height / 2 - ar.top) / ar.height) * 100).toFixed(1) });
          }
          if (el.__tapped) return;
          if (el.__sid <= 3) return;
          const r = el.getBoundingClientRect();
          const rel = (r.top + r.height / 2 - ar.top) / ar.height;
          if (rel >= 0.895) {
            el.__tapped = true;
            a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
            window.__auto.tapped++;
          }
        });
      }, 25);
      return true;
    })()`);
    await sleep(4200);
    await shot("v4-coffee-falling");
    await waitFor(`!!document.getElementById('arcade-back')`, 34_000, 200);
    await sleep(250);
    const coffee = await resultOf();
    await shot("v4-coffee-result");
    ev.phases.coffee = {
      ...coffee,
      score: parseScore(coffee.scoreText),
      rewardExpected: rewardCalc(parseScore(coffee.scoreText) ?? 0, 30),
      auto: await evJson(`JSON.stringify({ seen: window.__auto?.seen, tapped: window.__auto?.tapped, tops: window.__auto?.tops })`),
    };
    await resetGame();

    /* ===== E) 节奏：正拍 perfect ===== */
    await openArcade();
    await c.ev(`(() => {
      document.querySelector('#arcade-body button[data-game="rhythm"]').click();
      const t0 = performance.now();
      for (let k = 0; k < 59; k++) {
        const target = t0 + (0.6 + k * 0.5) * 1000;
        setTimeout(() => {
          const a = document.getElementById('play-area');
          if (a) a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
        }, Math.max(0, target - performance.now()));
      }
      return true;
    })()`);
    await waitFor(`!!document.getElementById('arcade-back')`, 36_000, 200);
    await sleep(250);
    const rhythm = await resultOf();
    await shot("v4-rhythm-result");
    ev.phases.rhythmPerfect = {
      ...rhythm,
      score: parseScore(rhythm.scoreText),
      rewardExpected: rewardCalc(parseScore(rhythm.scoreText) ?? 0, 30),
    };

    /* ===== F) 用完 3 次后的角标/菜单 ===== */
    ev.phases.afterAll = await evJson(`JSON.stringify({
      arcade: __MOYU__.state.arcade,
      badge: document.querySelector('#btn-arcade .arcade-badge')?.textContent ?? null,
      aria: document.getElementById('btn-arcade')?.getAttribute('aria-label'),
    })`);

    ev.consoleErrors = c.errors;
    c.close();
  },
  { timeoutMs: 220_000 },
);

const arcadeToasts = (arr) => (arr ?? []).filter((t) => /摸鱼站|没拿到奖励/.test(t.text ?? ""));
ev.rewardVerification = {
  assumedStationIdle: IDLE,
  formula: "ratio = min(1,score/600) * (playedSec>=10 ? 1 : playedSec/10)；reward = max(floor(0.2*25*ratio), ceil(30*ratio))",
  exitUnder2s: { played: ev.phases.exitUnder2s?.arcade?.played, expectedPlayed: 0, toasts: arcadeToasts(ev.phases.exitUnder2s?.toasts) },
  exitAt3s: { playedSeconds: ev.phases.exitAt3s?.playedSeconds, settledScore: ev.phases.exitAt3s?.settledScoreExpected, expected: ev.phases.exitAt3s?.rewardExpected, toasts: arcadeToasts(ev.phases.exitAt3s?.after?.toasts) },
  coffee: { score: ev.phases.coffee?.score, expected: ev.phases.coffee?.rewardExpected, detail: ev.phases.coffee?.detail, toasts: arcadeToasts(ev.phases.coffee?.toasts) },
  rhythm: { score: ev.phases.rhythmPerfect?.score, expected: ev.phases.rhythmPerfect?.rewardExpected, toasts: arcadeToasts(ev.phases.rhythmPerfect?.toasts) },
};
writeFileSync(`${OUT}/v4-live-evidence.json`, JSON.stringify(ev, null, 2));
console.log("V4-LIVE-EVIDENCE-WRITTEN");
console.log(JSON.stringify(ev, null, 1));