/**
 * R15b 实机复验（HEAD 14057dc，dev 5173）
 * 验证修复：
 *  ① 咖啡：逐帧下落（视觉=判定）、漏接真的计入
 *  ② 找老板：30 秒内无限轮（不再提前结束）；分数尺度/时间奖励归零问题
 *  ③ 节奏：乱点 -5 惩罚是否生效；正拍满分
 *  ④ 中途退出是否消耗次数（并按当前分数结算）
 *  ⑤ 奖励是否 = 新公式 max(floor(idle*25*ratio), ceil(30*ratio))（开局 idle=0.2）
 *  ⑥ 三次用尽文案
 * 用 playtest/lib/chrome.mjs（无残留进程）
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect } from "./lib/chrome.mjs";

const OUT = "playtest/r15-data";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = { url: "http://127.0.0.1:5173/", phases: {}, consoleErrors: [] };
const IDLE = 0.2; // reset 后 stationIdleScaled = BASE_IDLE_RATE
const REF = 600;
const formula = (score) => {
  const ratio = Math.min(1, Math.min(score, 2000) / REF);
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
    const reset = async () => {
      await c.ev("__MOYU__.reset(); true");
      await sleep(350);
    };
    const openArcade = async () => {
      await c.ev("document.getElementById('btn-arcade').click(); true");
      await sleep(130);
    };
    const startGame = async (g) => {
      await c.ev(`document.querySelector('#arcade-body button[data-game="${g}"]').click(); true`);
      await sleep(80);
    };
    const readToasts = () => evJson("JSON.stringify(window.__toasts ?? [])");

    await c.send("Page.enable");
    await c.send("Runtime.enable");
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
    await c.send("Page.navigate", { url: ev.url });
    const ready = await waitFor("!!window.__MOYU__", 40_000);
    ev.phases.ready = ready;
    if (!ready) {
      ev.consoleErrors = c.errors;
      return;
    }
    await reset();
    await c.ev(`(() => {
      window.__toasts = [];
      const el = document.getElementById('dom-toast');
      if (el) new MutationObserver(() => window.__toasts.push({ t: Math.round(performance.now()), text: el.textContent }))
        .observe(el, { childList: true, characterData: true, subtree: true });
      return true;
    })()`);
    ev.initial = await evJson(`JSON.stringify({ arcade: __MOYU__.state.arcade, hud: document.getElementById('hud-idle')?.textContent })`);

    /* ================= ⑤ 三次用尽文案（快速 3 次中途退出） ================= */
    await openArcade();
    for (let i = 0; i < 3; i++) {
      await startGame("coffee");
      await sleep(500);
      await c.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
      await sleep(250);
      await openArcade();
    }
    ev.phases.exhausted = await evJson(`(() => {
      const s = __MOYU__.state;
      return JSON.stringify({
        played: s.arcade.played,
        leftText: document.getElementById('arcade-left').textContent,
        locked: document.querySelectorAll('#arcade-body .arcade-card.locked').length,
        buttons: [...document.querySelectorAll('#arcade-body button[data-game]')].map(b => ({ g: b.dataset.game, text: b.textContent, disabled: b.disabled })),
      });
    })()`);
    await shot("v2-menu-exhausted");
    await reset();

    /* ================= ①④ 中途退出：按当前分数结算并扣次数 ================= */
    await openArcade();
    await startGame("coffee");
    await sleep(2200);
    const quitMid = await evJson(`(() => {
      const s0 = __MOYU__.state.arcade;
      const scoreTxt = document.getElementById('play-score')?.textContent ?? null;
      return JSON.stringify({ playedBefore: s0, liveScore: scoreTxt });
    })()`);
    await c.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
    await sleep(400);
    const quitAfter = await evJson(`JSON.stringify({ arcade: __MOYU__.state.arcade, closed: document.getElementById('arcade').classList.contains('hidden'), toasts: window.__toasts })`);
    ev.phases.quitMidGame = { ...quitMid, after: quitAfter, rewardExpected: formula(parseScore(quitMid.liveScore) ?? 0) };
    await reset();

    /* ================= ① 接咖啡：自动接（故意漏前 3 个） ================= */
    await openArcade();
    await c.ev(`(() => {
      window.__auto = { t0: performance.now(), seen: 0, tapped: 0, tops: [], lastTopAt: 0 };
      const area = document.getElementById('play-area');
      window.__autoTimer = setInterval(() => {
        const a = document.getElementById('play-area');
        if (!a) { clearInterval(window.__autoTimer); return; }
        const ar = a.getBoundingClientRect();
        document.querySelectorAll('#play-drops .drop').forEach((el) => {
          if (!el.__sid) el.__sid = ++window.__auto.seen;
          if (el.__sid === 1 && !el.__tapped && window.__auto.tops.length < 14 && performance.now() - window.__auto.lastTopAt > 180) {
            window.__auto.lastTopAt = performance.now();
            const r = el.getBoundingClientRect();
            window.__auto.tops.push({ t: Math.round(performance.now() - window.__auto.t0), rel: +(((r.top + r.height / 2 - ar.top) / ar.height) * 100).toFixed(1) });
          }
          if (el.__tapped) return;
          if (el.__sid <= 3) return; // 故意漏接前 3 个 → 验证"漏接计入"
          const r = el.getBoundingClientRect();
          const rel = (r.top + r.height / 2 - ar.top) / ar.height;
          if (rel >= 0.8) {
            el.__tapped = true;
            a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
            window.__auto.tapped++;
          }
        });
      }, 25);
      return true;
    })()`);
    await sleep(3200);
    await shot("v2-coffee-mid-falling");
    await waitFor(`!!document.getElementById('arcade-back')`, 32_000, 200);
    await sleep(250);
    const coffee = await evJson(`(() => {
      const s = __MOYU__.state;
      return JSON.stringify({
        scoreText: document.querySelector('.arcade-score')?.textContent ?? null,
        rewardText: document.querySelector('.arcade-reward')?.textContent ?? null,
        detail: [...document.querySelectorAll('.arcade-hint')].map(x => x.textContent).join(' | '),
        result: document.getElementById('arcade-body').textContent.replace(/\\s+/g, ' ').trim(),
        played: s.arcade.played,
        best: s.arcade.best,
        auto: { seen: window.__auto.seen, tapped: window.__auto.tapped, tops: window.__auto.tops },
        toasts: window.__toasts,
      });
    })()`);
    await shot("v2-coffee-result");
    ev.phases.coffee = { ...coffee, score: parseScore(coffee.scoreText), rewardExpected: formula(parseScore(coffee.scoreText) ?? 0) };
    await reset();

    /* ================= ② 找老板：30s 无限轮 ================= */
    await openArcade();
    const tFb = Date.now();
    await startGame("findboss");
    await sleep(500);
    const fbT0 = await evJson(`JSON.stringify({ score: document.getElementById('play-score')?.textContent, timer: document.getElementById('play-timer')?.textContent })`);
    await sleep(2500);
    const fbT3 = await evJson(`JSON.stringify({ score: document.getElementById('play-score')?.textContent, timer: document.getElementById('play-timer')?.textContent })`);
    await sleep(2500);
    const fbT5 = await evJson(`JSON.stringify({ score: document.getElementById('play-score')?.textContent, timer: document.getElementById('play-timer')?.textContent })`);
    await c.ev(`(() => {
      window.__fbClicks = 0;
      window.__fbTimer = setInterval(() => {
        const b = document.querySelector('button.face.boss');
        if (!b) { clearInterval(window.__fbTimer); return; }
        b.click();
        window.__fbClicks++;
      }, 120);
      return true;
    })()`);
    await sleep(3000);
    await shot("v2-findboss-mid");
    await waitFor(`!!document.getElementById('arcade-back')`, 32_000, 200);
    await sleep(250);
    const fb = await evJson(`(() => {
      const s = __MOYU__.state;
      return JSON.stringify({
        scoreText: document.querySelector('.arcade-score')?.textContent ?? null,
        rewardText: document.querySelector('.arcade-reward')?.textContent ?? null,
        result: document.getElementById('arcade-body').textContent.replace(/\\s+/g, ' ').trim(),
        played: s.arcade.played,
        best: s.arcade.best,
        clicks: window.__fbClicks,
        toasts: window.__toasts,
      });
    })()`);
    await shot("v2-findboss-result");
    ev.phases.findboss = {
      scoreAt: { t0: fbT0, t3: fbT3, t5: fbT5 },
      durationMs: Date.now() - tFb,
      ...fb,
      score: parseScore(fb.scoreText),
      rewardExpected: formula(parseScore(fb.scoreText) ?? 0),
    };
    await reset();

    /* ================= ③ 节奏：乱点惩罚 ================= */
    await openArcade();
    await startGame("rhythm");
    await c.ev(`(() => {
      window.__spam = setInterval(() => {
        const a = document.getElementById('play-area');
        if (!a) { clearInterval(window.__spam); return; }
        a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
      }, 100);
      return true;
    })()`);
    await sleep(6000);
    const spamMid = await evJson(`JSON.stringify({ score: document.getElementById('play-score')?.textContent, timer: document.getElementById('play-timer')?.textContent })`);
    await shot("v2-rhythm-spam");
    await c.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
    await sleep(350);
    ev.phases.rhythmSpam = { ...spamMid, after: await evJson(`JSON.stringify({ arcade: __MOYU__.state.arcade, toasts: window.__toasts })`) };
    await reset();

    /* ================= ③b 节奏：正拍完美 ================= */
    await openArcade();
    await startGame("rhythm");
    await c.ev(`(() => {
      const t0 = performance.now();
      window.__beatPlan = [];
      for (let k = 0; k < 59; k++) {
        const target = (0.6 + k * 0.5) * 1000;
        const delay = Math.max(0, target - (performance.now() - t0));
        window.__beatPlan.push({ k, target });
        setTimeout(() => {
          const a = document.getElementById('play-area');
          if (!a) return;
          a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
        }, delay);
      }
      return true;
    })()`);
    await waitFor(`!!document.getElementById('arcade-back')`, 34_000, 200);
    await sleep(250);
    const rhythm = await evJson(`(() => {
      const s = __MOYU__.state;
      return JSON.stringify({
        scoreText: document.querySelector('.arcade-score')?.textContent ?? null,
        rewardText: document.querySelector('.arcade-reward')?.textContent ?? null,
        result: document.getElementById('arcade-body').textContent.replace(/\\s+/g, ' ').trim(),
        played: s.arcade.played,
        best: s.arcade.best,
        toasts: window.__toasts,
      });
    })()`);
    await shot("v2-rhythm-result");
    ev.phases.rhythmPerfect = { ...rhythm, score: parseScore(rhythm.scoreText), rewardExpected: formula(parseScore(rhythm.scoreText) ?? 0) };

    ev.consoleErrors = c.errors;
    c.close();
  },
  { timeoutMs: 240_000 },
);

const arcadeToasts = (arr) => (arr ?? []).filter((t) => /摸鱼站|没拿到奖励|得分/.test(t.text ?? ""));
ev.rewardVerification = {
  assumedStationIdle: IDLE,
  note: "开局 stationIdleScaled=0.2；reward=max(floor(0.2*25*ratio), ceil(30*ratio)), ratio=min(1,score/600)",
  coffee: { score: ev.phases.coffee?.score, expected: ev.phases.coffee?.rewardExpected, toasts: arcadeToasts(ev.phases.coffee?.toasts) },
  findboss: { score: ev.phases.findboss?.score, expected: ev.phases.findboss?.rewardExpected, toasts: arcadeToasts(ev.phases.findboss?.toasts) },
  rhythm: { score: ev.phases.rhythmPerfect?.score, expected: ev.phases.rhythmPerfect?.rewardExpected, toasts: arcadeToasts(ev.phases.rhythmPerfect?.toasts) },
  quitMidGame: { score: ev.phases.quitMidGame?.rewardExpected, toasts: arcadeToasts(ev.phases.quitMidGame?.after?.toasts) },
};

writeFileSync(`${OUT}/v2-live-evidence.json`, JSON.stringify(ev, null, 2));
console.log("V2-LIVE-EVIDENCE-WRITTEN");
console.log(
  JSON.stringify(
    {
      ready: ev.phases.ready,
      exhausted: ev.phases.exhausted,
      quitMidGame: ev.phases.quitMidGame,
      coffee: {
        score: ev.phases.coffee?.score,
        rewardText: ev.phases.coffee?.rewardText,
        detail: ev.phases.coffee?.detail,
        auto: ev.phases.coffee?.auto ? { seen: ev.phases.coffee.auto.seen, tapped: ev.phases.coffee.auto.tapped, tops: ev.phases.coffee.auto.tops } : null,
        best: ev.phases.coffee?.best,
        expected: ev.phases.coffee?.rewardExpected,
      },
      findboss: {
        scoreAt: ev.phases.findboss?.scoreAt,
        durationMs: ev.phases.findboss?.durationMs,
        clicks: ev.phases.findboss?.clicks,
        score: ev.phases.findboss?.score,
        rewardText: ev.phases.findboss?.rewardText,
        best: ev.phases.findboss?.best,
        expected: ev.phases.findboss?.rewardExpected,
      },
      rhythmSpam: ev.phases.rhythmSpam,
      rhythmPerfect: {
        score: ev.phases.rhythmPerfect?.score,
        rewardText: ev.phases.rhythmPerfect?.rewardText,
        best: ev.phases.rhythmPerfect?.best,
        expected: ev.phases.rhythmPerfect?.rewardExpected,
      },
      rewardVerification: ev.rewardVerification,
      consoleErrors: ev.consoleErrors,
    },
    null,
    1,
  ),
);