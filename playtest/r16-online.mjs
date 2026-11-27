// R16 线上交付物核验（v0.5.0 GitHub Pages）：构建一致性、生产包无调试钩子、无报错、点击/节奏反馈可用、无节拍音轨
// 运行：node playtest/r16-online.mjs
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep, waitFor, INIT_SCRIPT, evj } from "./r16-action-lib.mjs";

const OUT = new URL("./r16-online.json", import.meta.url).pathname;
const URL_ONLINE = "https://luojindui.github.io/moyu/";

await runChrome(async ({ port }) => {
  const c = await connect(port);
  const { send, ev } = c;
  const result = { section: "online", url: URL_ONLINE, ts: Date.now() };
  try {
    await send("Runtime.enable");
    await send("Page.enable");
    try { await send("Log.enable"); } catch { /* 忽略 */ }
    await send("Page.addScriptToEvaluateOnNewDocument", { source: INIT_SCRIPT });
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: "portraitPrimary", angle: 0 } });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await send("Page.navigate", { url: URL_ONLINE });
    await waitFor(ev, 'document.readyState === "complete"', { timeout: 30000, label: "readyState" });
    await waitFor(ev, "__R16.raf.length > 120", { timeout: 20000, label: "raf" });
    await sleep(800);
    result.hooks = await evj(ev, "typeof window.__MOYU__");
    result.build = await evj(ev, "(() => { const s = document.querySelector('script[src*=\\'assets/\\']'); return s ? s.src : null; })()");
    result.title = await evj(ev, "document.title");
    result.version = await evj(ev, "(document.getElementById('about-version')||{}).textContent || null");
    result.updates = await evj(ev, "fetch('./updates.json').then(r=>r.json()).then(j=>j.version).catch(()=>null)");
    result.fps = await evj(ev, "(() => { const r = __R16.raf; const n = Math.min(120, r.length - 1); const d = (r[r.length-1] - r[r.length-1-n]) / n; return { frames: n, avgFrameMs: Number(d.toFixed(2)), fps: Number((1000/d).toFixed(1)) }; })()");
    result.audioCtx = await evj(ev, "__R16.meta.ctx || null");
    result.sw = await evj(ev, "navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r => r.length).catch(() => -1) : -1");
    result.assets = await evj(ev, "performance.getEntriesByType('resource').filter(e => /sprites\\//.test(e.name)).map(e => ({ n: e.name.split('/').pop(), ok: e.transferSize >= 0 })).slice(0, 8)");
    result.audioBtn = await evj(ev, "(document.getElementById('btn-mute')||{}).textContent || null");
    result.updateBar = await evj(ev, "!!document.getElementById('update-bar')");

    // 1) 真实触摸点击 canvas：反馈（HUD 数字 + 音频振荡器）
    const cv = await evj(ev, "(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height*0.42, w: r.width, h: r.height }; })()");
    const mark = await evj(ev, "(__R16.marker = performance.now())");
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cv.x, y: cv.y, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
    await sleep(28);
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(300);
    result.click = await evj(ev, `(() => {
      const cap = __R16.ptr.filter(p => p.ph === 'cap' && p.t >= ${mark})[0] || null;
      const bub = __R16.ptr.filter(p => p.ph === 'bub' && p.t >= ${mark})[0] || null;
      const audio = __R16.audio.filter(a => a.tStart >= ${mark});
      return {
        cap: cap && { t: Number((cap.t - ${mark}).toFixed(1)), pt: cap.pt },
        handlerMs: cap && bub ? Number((bub.t - cap.t).toFixed(2)) : null,
        audio: audio.map(a => ({ freq: a.freq, dt: Number((a.tStart - ${mark}).toFixed(1)) })),
        hudMoyu: (document.getElementById('hud-moyu')||{}).textContent,
        hudCombo: (document.getElementById('hud-combo')||{}).textContent,
      };
    })()`);

    // 2) 摸鱼站：菜单/节奏开局/无节拍音轨/判定文字
    await evj(ev, "document.getElementById('btn-arcade').click()");
    await waitFor(ev, "!document.getElementById('arcade').classList.contains('hidden')", { timeout: 4000, label: "arcade" });
    await sleep(200);
    result.arcadeMenu = await evj(ev, "(() => ({ left: (document.getElementById('arcade-left')||{}).textContent, cards: Array.from(document.querySelectorAll('#arcade-body .arcade-card')).map(c => c.innerText.split('\\n')[0]), buttons: Array.from(document.querySelectorAll('#arcade-body button')).map(b => b.textContent) }))()");
    const mark2 = await evj(ev, "(__R16.audio.length)");
    await evj(ev, "document.querySelector('#arcade-body button[data-game=\"rhythm\"]').click()");
    await waitFor(ev, "!!document.getElementById('play-area')", { timeout: 4000, label: "rhythm" });
    await sleep(2500); // 2.5s 内不点：若真有节拍音轨，应有音频
    result.rhythmNoTapAudio = await evj(ev, `(() => {
      const a = __R16.audio.slice(${mark2});
      return { count: a.length, freqs: a.map(x => x.freq), judge: (document.getElementById('judge-text')||{}).textContent, beats: document.querySelectorAll('#beat-row .beat').length, beatsMissed: document.querySelectorAll('#beat-row .beat.missed').length };
    })()`);
    // 打几下，看判定文字
    const judges = [];
    for (let i = 0; i < 4; i++) {
      await evj(ev, "(() => { const a = document.getElementById('play-area'); const r = a.getBoundingClientRect(); a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2, pointerId: 5, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 })); return true; })()");
      await sleep(420);
      judges.push(await evj(ev, "(() => { const j = document.getElementById('judge-text'); return j ? j.textContent + '|' + j.className : null; })()"));
    }
    result.rhythmJudges = judges;
    result.rhythmAudioAfterTaps = await evj(ev, `(() => { const a = __R16.audio.slice(${mark2}); return { count: a.length, freqs: a.map(x => Math.round(x.freq)) }; })()`);
    result.rhythmTimer = await evj(ev, "(document.getElementById('play-timer')||{}).textContent || null");
    result.errors = c.errors.slice();
  } catch (e) {
    result.fatal = String(e && e.stack ? e.stack : e);
  } finally {
    writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({
      ok: !result.fatal, fatal: result.fatal, build: result.build, title: result.title, hooks: result.hooks, version: result.version, updates: result.updates,
      fps: result.fps, audioCtx: result.audioCtx, sw: result.sw, assets: result.assets, audioBtn: result.audioBtn,
      updateBar: result.updateBar, click: result.click, arcadeMenu: result.arcadeMenu,
      rhythmNoTapAudio: result.rhythmNoTapAudio, rhythmJudges: result.rhythmJudges,
      rhythmAudioAfterTaps: result.rhythmAudioAfterTaps, rhythmTimer: result.rhythmTimer, errors: result.errors,
    }, null, 2));
    c.close();
  }
}, { timeoutMs: 180_000 });