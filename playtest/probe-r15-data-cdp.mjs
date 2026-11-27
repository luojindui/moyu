/**
 * R15「摸鱼站」实机探针（只读 src/，无残留进程）
 * 验证：
 *  1) 三游戏实际可达分数 & 结算奖励是否符合引擎公式 floor((stationIdle*0.6+20)*score/100)
 *  2) 找老板是否 30 秒前提前结束（规格 30s 不符）
 *  3) 接咖啡：掉落元素生命周期 vs 判定窗口（视觉/判定错位）
 *  4) 节奏点击：4 次/秒乱点保底分
 *  5) 中途退出（Esc）是否不消耗次数（刷分空间）
 *  6) 0 分是否消耗次数
 *  7) 用尽 3 次后是否锁定
 * 产出：playtest/r15-data/live-evidence.json + 截图
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect } from "./lib/chrome.mjs";

const OUT = "playtest/r15-data";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = { url: "http://127.0.0.1:5173/", checks: {}, consoleErrors: [] };

await runChrome(
  async ({ port }) => {
    const c = await connect(port);
    const evJson = async (expr) => {
      const v = await c.ev(expr);
      if (v && typeof v === "object" && v.__err) throw new Error(v.__err);
      if (typeof v !== "string") return v;
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    };
    const waitFor = async (expr, timeout = 40_000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        if ((await c.ev(expr)) === true) return true;
        await sleep(120);
      }
      return false;
    };
    const shot = async (name) => {
      const r = await c.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, "base64"));
    };

    await c.send("Page.enable");
    await c.send("Runtime.enable");
    await c.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 860,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await c.send("Page.navigate", { url: ev.url });
    const ready = await waitFor("!!window.__MOYU__", 40_000);
    ev.checks.pageReady = ready;
    if (!ready) {
      ev.consoleErrors = c.errors;
      return;
    }
    // 干净存档
    await c.ev("__MOYU__.reset(); true");
    await sleep(400);
    // 装 toast 探针
    await c.ev(`(() => {
      window.__toasts = [];
      const el = document.getElementById('dom-toast');
      if (!el) return false;
      new MutationObserver(() => window.__toasts.push({ t: Math.round(performance.now()), text: el.textContent }))
        .observe(el, { childList: true, characterData: true, subtree: true });
      return true;
    })()`);

    ev.checks.initial = await evJson(`(() => {
      const s = __MOYU__.state;
      return JSON.stringify({ arcade: s.arcade, moyu: s.moyu, levels: s.levels, idleHud: document.getElementById('hud-idle')?.textContent });
    })()`);

    /* ---------- 打开摸鱼站 ---------- */
    await c.ev(`document.getElementById('btn-arcade').click(); true`);
    await sleep(150);
    ev.checks.menuOpen = await evJson(`(() => {
      const root = document.getElementById('arcade');
      return JSON.stringify({
        open: !root.classList.contains('hidden'),
        left: document.getElementById('arcade-left').textContent,
        cards: [...document.querySelectorAll('#arcade-body .arcade-card')].map(c => c.textContent.trim()),
        enabledButtons: [...document.querySelectorAll('#arcade-body button[data-game]')].map(b => ({ g: b.dataset.game, disabled: b.disabled })),
      });
    })()`);

    /* ---------- 1) 找老板：极速 5 连点 ---------- */
    const tFbStart = Date.now();
    await c.ev(`document.querySelector('#arcade-body button[data-game="findboss"]').click(); true`);
    await sleep(120);
    const fbResult = await evJson(`(() => {
      const startAt = performance.now();
      let clicks = 0;
      for (let i = 0; i < 8; i++) {
        const b = document.querySelector('button.face.boss');
        if (!b) break;
        b.click();
        clicks++;
      }
      const endAt = performance.now();
      return JSON.stringify({
        clicks,
        clickElapsedMs: Number((endAt - startAt).toFixed(1)),
        finished: !!document.getElementById('arcade-back'),
        scoreText: document.querySelector('.arcade-score')?.textContent ?? null,
        txt: document.getElementById('arcade-body').textContent.replace(/\\s+/g, ' ').trim(),
      });
    })()`);
    await sleep(250);
    const fbState = await evJson(`(() => {
      const s = __MOYU__.state;
      return JSON.stringify({ arcade: s.arcade, moyu: s.moyu, toasts: window.__toasts });
    })()`);
    ev.checks.findboss = { ...fbResult, wallMs: Date.now() - tFbStart, state: fbState };

    /* ---------- 2) 中途退出（Esc）是否消耗次数 ---------- */
    await c.ev(`document.getElementById('arcade-back').click(); true`);
    await sleep(150);
    const playedBeforeQuit = (await evJson(`JSON.stringify(__MOYU__.state.arcade)`)).played;
    await c.ev(`document.querySelector('#arcade-body button[data-game="coffee"]').click(); true`);
    await sleep(1300);
    const midDropCount = await c.ev(`document.querySelectorAll('#play-drops .drop').length`);
    await c.ev(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`,
    );
    await sleep(400);
    const quitAudit = await evJson(`(() => {
      const s = __MOYU__.state;
      return JSON.stringify({
        arcadeClosed: document.getElementById('arcade').classList.contains('hidden'),
        played: s.arcade.played,
        best: s.arcade.best,
        moyu: s.moyu,
      });
    })()`);
    ev.checks.quitMidGame = { playedBeforeQuit, midDropCount, after: quitAudit };

    /* ---------- 3) 接咖啡：0 点击跑满 30s（视觉审计 + 0 分消耗次数） ---------- */
    await c.ev(`document.getElementById('btn-arcade').click(); true`);
    await sleep(150);
    await c.ev(`document.querySelector('#arcade-body button[data-game="coffee"]').click(); true`);
    await c.ev(`(() => {
      window.__dropLog = [];
      window.__gameStart = performance.now();
      const host = document.getElementById('play-drops');
      const obs = new MutationObserver((ms) => {
        for (const m of ms) {
          m.addedNodes.forEach((n) => {
            if (n.classList && n.classList.contains('drop')) {
              const rec = { kind: 'add', t: Math.round(performance.now() - window.__gameStart), left: n.style.left, top: n.style.top };
              window.__dropLog.push(rec);
              setTimeout(() => {
                window.__dropLog.push({ kind: 'check200', ref: rec.t, t: Math.round(performance.now() - window.__gameStart), top: n.style.top, connected: n.isConnected });
              }, 200);
              setTimeout(() => {
                window.__dropLog.push({ kind: 'check380', ref: rec.t, t: Math.round(performance.now() - window.__gameStart), connected: n.isConnected });
              }, 380);
            }
          });
          m.removedNodes.forEach((n) => {
            if (n.classList && n.classList.contains('drop')) window.__dropLog.push({ kind: 'remove', t: Math.round(performance.now() - window.__gameStart) });
          });
        }
      });
      obs.observe(host, { childList: true, subtree: true });
      return true;
    })()`);
    await sleep(2100);
    await shot("live-coffee-mid");
    await sleep(29_500);
    const coffeeDone = await waitFor(`!!document.getElementById('arcade-back')`, 9000);
    await sleep(250);
    const coffeeAudit = await evJson(`(() => {
      const s = __MOYU__.state;
      const log = window.__dropLog;
      return JSON.stringify({
        finished: ${coffeeDone},
        scoreText: document.querySelector('.arcade-score')?.textContent ?? null,
        played: s.arcade.played,
        best: s.arcade.best,
        toasts: window.__toasts,
        dropAdds: log.filter(x => x.kind === 'add').length,
        dropRemoves: log.filter(x => x.kind === 'remove').length,
        sampleAdds: log.filter(x => x.kind === 'add').slice(0, 6),
        sampleChecks: log.filter(x => x.kind === 'check200').slice(0, 6),
        lifetimes: (() => {
          const adds = log.filter(x => x.kind === 'add');
          const rems = log.filter(x => x.kind === 'remove');
          return adds.slice(0, 10).map((a, i) => (rems[i] ? rems[i].t - a.t : null));
        })(),
      });
    })()`);
    ev.checks.coffee = coffeeAudit;

    /* ---------- 4) 节奏点击：250ms 乱点 ---------- */
    await c.ev(`document.getElementById('arcade-back').click(); true`);
    await sleep(150);
    const rhythmStartState = await evJson(`JSON.stringify(__MOYU__.state.arcade)`);
    await c.ev(`document.querySelector('#arcade-body button[data-game="rhythm"]').click(); true`);
    await c.ev(`(() => {
      window.__rhythmStart = performance.now();
      window.__spamTaps = 0;
      window.__spam = setInterval(() => {
        const a = document.getElementById('play-area');
        if (!a) { clearInterval(window.__spam); return; }
        const r = a.getBoundingClientRect();
        a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
        window.__spamTaps++;
      }, 250);
      return true;
    })()`);
    const rhythmDone = await waitFor(`!!document.getElementById('arcade-back')`, 38_000);
    const rhythmAudit = await evJson(`(() => {
      const s = __MOYU__.state;
      return JSON.stringify({
        finished: ${rhythmDone},
        durationMs: Math.round(performance.now() - window.__rhythmStart),
        taps: window.__spamTaps,
        scoreText: document.querySelector('.arcade-score')?.textContent ?? null,
        played: s.arcade.played,
        best: s.arcade.best,
        toasts: window.__toasts,
      });
    })()`);
    ev.checks.rhythm = { rhythmStartState, ...rhythmAudit };
    await shot("live-rhythm-result");

    /* ---------- 5) 次数用尽后的锁定 ---------- */
    await c.ev(`document.getElementById('arcade-back').click(); true`);
    await sleep(200);
    ev.checks.exhausted = await evJson(`(() => {
      const s = __MOYU__.state;
      return JSON.stringify({
        played: s.arcade.played,
        leftText: document.getElementById('arcade-left').textContent,
        buttons: [...document.querySelectorAll('#arcade-body button[data-game]')].map(b => ({ g: b.dataset.game, disabled: b.disabled })),
        lockedCards: document.querySelectorAll('#arcade-body .arcade-card.locked').length,
        toasts: window.__toasts,
      });
    })()`);

    ev.consoleErrors = c.errors;
    c.close();
  },
  { timeoutMs: 150_000 },
);

/* ---------- node 侧：用公式核对奖励 ---------- */
const idle = 0.2; // reset 后 stationIdleScaled = BASE_IDLE_RATE
const formula = (score) => Math.floor((idle * 0.6 + 20) * (Math.min(score, 9999) / 100));
const arcadeToasts = (arr) => (arr ?? []).filter((t) => /摸鱼站|没拿到奖励/.test(t.text ?? ""));
const parseScore = (txt) => {
  const m = /(-?\d+)\s*分/.exec(txt ?? "");
  return m ? Number(m[1]) : null;
};
ev.rewardVerification = {
  stationIdleAssumed: idle,
  findboss: {
    score: parseScore(ev.checks.findboss?.scoreText),
    expectedReward: formula(parseScore(ev.checks.findboss?.scoreText) ?? 0),
    toasts: arcadeToasts(ev.checks.findboss?.state?.toasts),
  },
  coffee: {
    score: parseScore(ev.checks.coffee?.scoreText),
    expectedReward: formula(parseScore(ev.checks.coffee?.scoreText) ?? 0),
    toasts: arcadeToasts(ev.checks.coffee?.toasts),
  },
  rhythm: {
    score: parseScore(ev.checks.rhythm?.scoreText),
    expectedReward: formula(parseScore(ev.checks.rhythm?.scoreText) ?? 0),
    toasts: arcadeToasts(ev.checks.rhythm?.toasts),
  },
};

writeFileSync(`${OUT}/live-evidence.json`, JSON.stringify(ev, null, 2));
console.log("LIVE-EVIDENCE-WRITTEN");
console.log(
  JSON.stringify(
    {
      pageReady: ev.checks.pageReady,
      findboss: {
        clicks: ev.checks.findboss?.clicks,
        elapsedMs: ev.checks.findboss?.clickElapsedMs,
        score: parseScore(ev.checks.findboss?.scoreText),
        toast: ev.checks.findboss?.state?.toasts,
      },
      quitMidGame: ev.checks.quitMidGame,
      coffee: {
        score: parseScore(ev.checks.coffee?.scoreText),
        dropAdds: ev.checks.coffee?.dropAdds,
        dropRemoves: ev.checks.coffee?.dropRemoves,
        lifetimes: ev.checks.coffee?.lifetimes,
        sampleAdds: ev.checks.coffee?.sampleAdds,
        toasts: arcadeToasts(ev.checks.coffee?.toasts),
      },
      rhythm: {
        taps: ev.checks.rhythm?.taps,
        durationMs: ev.checks.rhythm?.durationMs,
        score: parseScore(ev.checks.rhythm?.scoreText),
        toasts: arcadeToasts(ev.checks.rhythm?.toasts),
      },
      exhausted: ev.checks.exhausted,
      consoleErrors: ev.consoleErrors,
      rewardVerification: ev.rewardVerification,
    },
    null,
    1,
  ),
);