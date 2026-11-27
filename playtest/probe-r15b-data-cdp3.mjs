/**
 * R15b 实机复验 v3（当前 HEAD cd1bcea，dev 5173）
 *  A) 找老板：打 12 个正确（≈1.5s）后 Esc → 是否按 600 分结算并拿满奖励（提前退出=满奖励？）
 *  B) 接咖啡：按视觉（杯口）自动接；故意漏前 3 个 → 漏接是否计入 / 奖励公式
 *  C) 节奏：同一 task 内点击开始 + t0 对齐节拍 → 正拍完美 ≈1180 / 奖励
 * 用 playtest/lib/chrome.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect } from "./lib/chrome.mjs";

const OUT = "playtest/r15-data";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = { url: "http://127.0.0.1:5173/", phases: {}, consoleErrors: [] };
const IDLE = 0.2;
const formula = (score) => {
  const ratio = Math.min(1, Math.min(score, 8000) / 600);
  return Math.max(Math.floor(IDLE * 25 * ratio), Math.ceil(30 * ratio));
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
    const waitFor = async (expr, timeout = 45_000, step = 100) => {
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
    const TOKEN = `probe-${Date.now()}`;
    const prepare = async () => {
      // 页面若被 HMR 重载则重新注入探针
      const ok = await c.ev(`!!window.__MOYU__ && window.__probeToken === ${JSON.stringify(TOKEN)}`);
      if (ok === true) return;
      await waitFor("!!window.__MOYU__", 40_000);
      await c.ev(`(() => {
        window.__probeToken = ${JSON.stringify(TOKEN)};
        window.__toasts = [];
        const el = document.getElementById('dom-toast');
        if (el) new MutationObserver(() => window.__toasts.push({ t: Math.round(performance.now()), text: el.textContent }))
          .observe(el, { childList: true, characterData: true, subtree: true });
        return true;
      })()`);
    };
    const forceClose = async () => {
      await c.ev(`(() => {
        const root = document.getElementById('arcade');
        if (!root.classList.contains('hidden')) { const b = document.getElementById('arcade-close'); if (b) b.click(); }
        return root.classList.contains('hidden');
      })()`);
      await sleep(150);
    };
    const resetGame = async () => {
      await forceClose();
      await c.ev("__MOYU__.reset(); true");
      await sleep(400);
      await prepare();
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
    await c.send("Page.navigate", { url: ev.url });
    ev.phases.ready = await waitFor("!!window.__MOYU__", 40_000);
    await prepare();
    await resetGame();

    /* ============ A) 找老板：12 个正确（~1.5s）→ Esc 结算 ============ */
    await openArcade();
    await c.ev(`document.querySelector('#arcade-body button[data-game="findboss"]').click(); true`);
    await c.ev(`(() => {
      window.__q = { clicks: 0 };
      window.__qTimer = setInterval(() => {
        const b = document.querySelector('button.face.boss');
        if (!b) { clearInterval(window.__qTimer); return; }
        b.click();
        window.__q.clicks++;
        if (window.__q.clicks >= 12) clearInterval(window.__qTimer);
      }, 120);
      return true;
    })()`);
    await sleep(2200);
    const fbLive = await evJson(`JSON.stringify({ clicks: window.__q.clicks, score: document.getElementById('play-score')?.textContent, timer: document.getElementById('play-timer')?.textContent })`);
    const tBefore = Date.now();
    await c.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
    await sleep(400);
    const fbQuit = await evJson(`JSON.stringify({ arcade: __MOYU__.state.arcade, closed: document.getElementById('arcade').classList.contains('hidden'), toasts: window.__toasts })`);
    ev.phases.findbossQuitEarly = {
      live: fbLive,
      elapsedMs: Date.now() - tBefore,
      after: fbQuit,
      settledScoreExpected: 50 * (fbLive.clicks ?? 0),
      rewardExpected: formula(50 * (fbLive.clicks ?? 0)),
    };
    await resetGame();

    /* ============ B) 接咖啡：按杯口自动接（故意漏前 3 个） ============ */
    await openArcade();
    await c.ev(`(() => {
      document.querySelector('#arcade-body button[data-game="coffee"]').click();
      window.__auto = { t0: performance.now(), seen: 0, tapped: 0, tops: [], lastTopAt: 0, areaBefore: !!document.getElementById('play-area') };
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
    await shot("v3-coffee-falling");
    await waitFor(`!!document.getElementById('arcade-back')`, 34_000, 200);
    await sleep(250);
    const coffee = await resultOf();
    await shot("v3-coffee-result");
    ev.phases.coffee = {
      ...coffee,
      score: parseScore(coffee.scoreText),
      rewardExpected: formula(parseScore(coffee.scoreText) ?? 0),
      auto: await evJson(`JSON.stringify({ seen: window.__auto?.seen, tapped: window.__auto?.tapped, tops: window.__auto?.tops, areaBefore: window.__auto?.areaBefore })`),
    };
    await resetGame();

    /* ============ C) 节奏：同一 task 对齐正拍 ============ */
    await openArcade();
    await c.ev(`(() => {
      document.querySelector('#arcade-body button[data-game="rhythm"]').click();
      const t0 = performance.now();
      window.__beatT0 = t0;
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
    await shot("v3-rhythm-result");
    ev.phases.rhythmPerfect = {
      ...rhythm,
      score: parseScore(rhythm.scoreText),
      rewardExpected: formula(parseScore(rhythm.scoreText) ?? 0),
    };

    ev.consoleErrors = c.errors;
    c.close();
  },
  { timeoutMs: 240_000 },
);

const arcadeToasts = (arr) => (arr ?? []).filter((t) => /摸鱼站|没拿到奖励/.test(t.text ?? ""));
ev.rewardVerification = {
  assumedStationIdle: IDLE,
  formula: "reward = max(floor(idle*25*min(1,score/600)), ceil(30*min(1,score/600)))",
  findbossQuitEarly: { score: ev.phases.findbossQuitEarly?.settledScoreExpected, expected: ev.phases.findbossQuitEarly?.rewardExpected, toasts: arcadeToasts(ev.phases.findbossQuitEarly?.after?.toasts) },
  coffee: { score: ev.phases.coffee?.score, expected: ev.phases.coffee?.rewardExpected, toasts: arcadeToasts(ev.phases.coffee?.toasts) },
  rhythmPerfect: { score: ev.phases.rhythmPerfect?.score, expected: ev.phases.rhythmPerfect?.rewardExpected, toasts: arcadeToasts(ev.phases.rhythmPerfect?.toasts) },
};
writeFileSync(`${OUT}/v3-live-evidence.json`, JSON.stringify(ev, null, 2));
console.log("V3-LIVE-EVIDENCE-WRITTEN");
console.log(JSON.stringify(ev, null, 1));