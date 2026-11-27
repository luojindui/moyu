/**
 * R15b 实机复验 v2（HEAD 14057dc，dev 5173）—— 修正阶段切换与节拍对齐
 * 验证：
 *  A) 找老板：中途退出按"当前分数"结算并扣次数；过程分含时间奖励、结算时间奖励归零（分数回落）
 *  B) 接咖啡：逐帧下落（视觉=判定）、漏接真的计入、奖励公式
 *  C) 找老板：30 秒无限轮、时长、原始分、best 截断 2000、满奖励
 *  D) 节奏：100ms 乱点惩罚（分数≈0）；正拍点击（逐拍对齐）≈1180 满分
 *  E) 三次用尽文案
 * 用 playtest/lib/chrome.mjs（无残留进程）
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect } from "./lib/chrome.mjs";

const OUT = "playtest/r15-data";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = { url: "http://127.0.0.1:5173/", phases: {}, consoleErrors: [] };
const IDLE = 0.2;
const formula = (score) => {
  const ratio = Math.min(1, Math.min(score, 2000) / 600);
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
    const forceCloseArcade = async () => {
      await c.ev(`(() => {
        const root = document.getElementById('arcade');
        if (!root.classList.contains('hidden')) {
          const btn = document.getElementById('arcade-close');
          if (btn) btn.click();
        }
        return root.classList.contains('hidden');
      })()`);
      await sleep(150);
    };
    const resetGame = async () => {
      await forceCloseArcade();
      await c.ev("__MOYU__.reset(); true");
      await sleep(400);
    };
    const openArcade = async () => {
      const open = await c.ev(`!document.getElementById('arcade').classList.contains('hidden')`);
      if (!open) {
        await c.ev("document.getElementById('btn-arcade').click(); true");
        await sleep(150);
      }
    };
    const startGame = async (g) => {
      await openArcade();
      await c.ev(`document.querySelector('#arcade-body button[data-game="${g}"]').click(); true`);
      await sleep(120);
      return await evJson(`(() => {
        const s = __MOYU__.state;
        return JSON.stringify({
          started: !!document.getElementById('play-area') || !!document.getElementById('play-grid') || !!document.getElementById('beat-row'),
          html: document.getElementById('arcade-body').textContent.slice(0, 60),
          played: s.arcade.played,
          left: document.getElementById('arcade-left').textContent,
        });
      })()`);
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
    const ready = await waitFor("!!window.__MOYU__", 40_000);
    ev.phases.ready = ready;
    if (!ready) {
      ev.consoleErrors = c.errors;
      return;
    }
    await resetGame();
    await c.ev(`(() => {
      window.__toasts = [];
      const el = document.getElementById('dom-toast');
      if (el) new MutationObserver(() => window.__toasts.push({ t: Math.round(performance.now()), text: el.textContent }))
        .observe(el, { childList: true, characterData: true, subtree: true });
      return true;
    })()`);
    ev.initial = await evJson(`JSON.stringify({ arcade: __MOYU__.state.arcade, hud: document.getElementById('hud-idle')?.textContent })`);

    /* ============ A) 找老板：中途退出 = 当前分数结算 + 扣次数 ============ */
    let started = await startGame("findboss");
    await sleep(400);
    await c.ev(`document.querySelector('button.face.boss').click(); true`);
    await sleep(120);
    const fbLive = await evJson(`JSON.stringify({ score: document.getElementById('play-score')?.textContent, timer: document.getElementById('play-timer')?.textContent })`);
    await c.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
    await sleep(400);
    const fbQuit = await evJson(`JSON.stringify({ arcade: __MOYU__.state.arcade, closed: document.getElementById('arcade').classList.contains('hidden'), toasts: window.__toasts })`);
    ev.phases.quitMidGame = {
      started,
      liveScoreIncludingTimeBonus: fbLive,
      settled: fbQuit,
      expectedSettledScore: 50, // findScore(1,0,0) = 50（时间奖励在结算归零）
      expectedReward: formula(50),
    };
    await resetGame();

    /* ============ B) 接咖啡：自动接（故意漏前 3 个） ============ */
    started = await startGame("coffee");
    ev.phases.coffeeStarted = started;
    await c.ev(`(() => {
      window.__auto = { t0: performance.now(), seen: 0, tapped: 0, tops: [], lastTopAt: 0 };
      const area = document.getElementById('play-area');
      if (!area) return false;
      window.__autoTimer = setInterval(() => {
        const a = document.getElementById('play-area');
        if (!a) { clearInterval(window.__autoTimer); return; }
        const ar = a.getBoundingClientRect();
        document.querySelectorAll('#play-drops .drop').forEach((el) => {
          if (!el.__sid) el.__sid = ++window.__auto.seen;
          if (el.__sid === 1 && !el.__tapped && window.__auto.tops.length < 16 && performance.now() - window.__auto.lastTopAt > 180) {
            window.__auto.lastTopAt = performance.now();
            const r = el.getBoundingClientRect();
            window.__auto.tops.push({ t: Math.round(performance.now() - window.__auto.t0), rel: +(((r.top + r.height / 2 - ar.top) / ar.height) * 100).toFixed(1) });
          }
          if (el.__tapped) return;
          if (el.__sid <= 3) return; // 故意漏接前 3 个
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
    await sleep(3500);
    await shot("v2b-coffee-mid-falling");
    await waitFor(`!!document.getElementById('arcade-back')`, 33_000, 200);
    await sleep(250);
    const coffee = await resultOf();
    await shot("v2b-coffee-result");
    ev.phases.coffee = {
      ...coffee,
      score: parseScore(coffee.scoreText),
      rewardExpected: formula(parseScore(coffee.scoreText) ?? 0),
      auto: await evJson(`JSON.stringify({ seen: window.__auto?.seen, tapped: window.__auto?.tapped, tops: window.__auto?.tops })`),
    };
    await resetGame();

    /* ============ C) 找老板：30 秒无限轮 ============ */
    started = await startGame("findboss");
    const tFb = Date.now();
    await sleep(600);
    const fbT0 = await evJson(`JSON.stringify({ score: document.getElementById('play-score')?.textContent, timer: document.getElementById('play-timer')?.textContent })`);
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
    const fbLive2 = await evJson(`JSON.stringify({ score: document.getElementById('play-score')?.textContent, timer: document.getElementById('play-timer')?.textContent, clicks: window.__fbClicks })`);
    await shot("v2b-findboss-mid");
    await waitFor(`!!document.getElementById('arcade-back')`, 33_000, 200);
    await sleep(250);
    const fb = await resultOf();
    await shot("v2b-findboss-result");
    ev.phases.findboss = {
      started,
      durationMs: Date.now() - tFb,
      scoreAtStart: fbT0,
      liveMid: fbLive2,
      ...fb,
      score: parseScore(fb.scoreText),
      rewardExpected: formula(parseScore(fb.scoreText) ?? 0),
      clicks: await c.ev("window.__fbClicks"),
    };
    await resetGame();

    /* ============ D1) 节奏：100ms 乱点惩罚 ============ */
    started = await startGame("rhythm");
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
    await shot("v2b-rhythm-spam");
    await c.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
    await sleep(400);
    const spamAfter = await evJson(`JSON.stringify({ arcade: __MOYU__.state.arcade, toasts: window.__toasts })`);
    ev.phases.rhythmSpam = { started, ...spamMid, after: spamAfter, expectedReward: formula(parseInt(spamMid.score, 10) || 0) };
    await resetGame();

    /* ============ D2) 节奏：正拍（按真实 startAt 对齐） ============ */
    started = await startGame("rhythm");
    await c.ev(`(() => {
      const timerTxt = document.getElementById('play-timer')?.textContent ?? '';
      const left = parseFloat(timerTxt);
      const elapsed = Number.isFinite(left) ? Math.max(0, 30 - left) : 0;
      const startAt = performance.now() - elapsed * 1000;
      window.__beatInfo = { timerTxt, elapsed: +elapsed.toFixed(3) };
      for (let k = 0; k < 59; k++) {
        const target = startAt + (0.6 + k * 0.5) * 1000;
        setTimeout(() => {
          const a = document.getElementById('play-area');
          if (a) a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
        }, Math.max(0, target - performance.now()));
      }
      return true;
    })()`);
    await waitFor(`!!document.getElementById('arcade-back')`, 35_000, 200);
    await sleep(250);
    const rhythm = await resultOf();
    await shot("v2b-rhythm-result");
    ev.phases.rhythmPerfect = {
      started,
      ...rhythm,
      score: parseScore(rhythm.scoreText),
      rewardExpected: formula(parseScore(rhythm.scoreText) ?? 0),
      beatInfo: await c.ev("window.__beatInfo"),
    };
    await resetGame();

    /* ============ E) 三次用尽（快速退出） ============ */
    for (let i = 0; i < 3; i++) {
      await startGame(i % 2 === 0 ? "coffee" : "rhythm");
      await sleep(350);
      await c.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
      await sleep(250);
    }
    await openArcade();
    ev.phases.exhausted = await evJson(`(() => {
      const s = __MOYU__.state;
      return JSON.stringify({
        played: s.arcade.played,
        leftText: document.getElementById('arcade-left').textContent,
        locked: document.querySelectorAll('#arcade-body .arcade-card.locked').length,
        buttons: [...document.querySelectorAll('#arcade-body button[data-game]')].map(b => ({ g: b.dataset.game, text: b.textContent, disabled: b.disabled })),
      });
    })()`);
    await shot("v2b-menu-exhausted");

    ev.consoleErrors = c.errors;
    c.close();
  },
  { timeoutMs: 260_000 },
);

const arcadeToasts = (arr) => (arr ?? []).filter((t) => /摸鱼站|没拿到奖励/.test(t.text ?? ""));
ev.rewardVerification = {
  assumedStationIdle: IDLE,
  formula: "reward = max(floor(idle*25*min(1,score/600)), ceil(30*min(1,score/600)))",
  coffee: { score: ev.phases.coffee?.score, expected: ev.phases.coffee?.rewardExpected, toasts: arcadeToasts(ev.phases.coffee?.toasts) },
  findboss: { score: ev.phases.findboss?.score, expected: ev.phases.findboss?.rewardExpected, toasts: arcadeToasts(ev.phases.findboss?.toasts) },
  rhythmPerfect: { score: ev.phases.rhythmPerfect?.score, expected: ev.phases.rhythmPerfect?.rewardExpected, toasts: arcadeToasts(ev.phases.rhythmPerfect?.toasts) },
  rhythmSpam: { score: parseInt(ev.phases.rhythmSpam?.score ?? "0", 10), expected: ev.phases.rhythmSpam?.expectedReward, toasts: arcadeToasts(ev.phases.rhythmSpam?.after?.toasts) },
  quitMidGame: { expected: ev.phases.quitMidGame?.expectedReward, toasts: arcadeToasts(ev.phases.quitMidGame?.settled?.toasts) },
};
writeFileSync(`${OUT}/v2b-live-evidence.json`, JSON.stringify(ev, null, 2));
console.log("V2B-LIVE-EVIDENCE-WRITTEN");
console.log(JSON.stringify(ev, null, 1));