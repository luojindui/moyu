// R16 操作党探针 D：回合制老板「150ms 防误触守卫」真实触摸验证 + 巡逻 type/blitz 目标达成反馈
// 运行：node playtest/r16-boss-patrol.mjs
import { writeFileSync } from "node:fs";
import {
  runChrome, connect, bootDev, evj, rect, sleep, waitFor, tapMouse, tapTouch, BASE_URL,
} from "./r16-action-lib.mjs";

const OUT = new URL("./r16-boss-patrol.json", import.meta.url).pathname;

const HELPER = String.raw`
(function(){
  var R = window.__R16;
  R.watchPanel = function(){
    var root = document.getElementById('boss-choice');
    R.panel = { root: root, shownAt: null, hiddenAt: null, events: [] };
    var wasHidden = root.classList.contains('hidden');
    new MutationObserver(function(){
      var hidden = root.classList.contains('hidden');
      if (wasHidden && !hidden) { R.panel.shownAt = performance.now(); R.panel.events.push({ t: R.panel.shownAt, ev: 'show' }); }
      if (!wasHidden && hidden) { R.panel.hiddenAt = performance.now(); R.panel.events.push({ t: R.panel.hiddenAt, ev: 'hide' }); }
      wasHidden = hidden;
      var res = root.querySelector('.boss-result');
      if (res) R.panel.result = { t: performance.now(), text: res.textContent };
      var shake = root.querySelector('.shake');
      if (shake) R.panel.shake = { t: performance.now(), text: shake.textContent };
      var picked = root.querySelector('.picked');
      if (picked) R.panel.picked = { t: performance.now(), text: picked.textContent };
    }).observe(root, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
    return true;
  };
  R.tryBoss = async function(pickDelayMs, which){
    R.panel = { shownAt: null, hiddenAt: null, events: [] };
    await __MOYU__.forceBoss('choice');
    var t0 = performance.now();
    for (var i = 0; i < 300 && R.panel.shownAt == null; i++) await new Promise(function(r){ setTimeout(r, 10); });
    var btn = document.querySelectorAll('#boss-choice .boss-opts > button')[which || 1];
    var r = btn.getBoundingClientRect();
    return {
      t0: t0, shownAt: R.panel.shownAt,
      showDelayMs: R.panel.shownAt != null ? Number((R.panel.shownAt - t0).toFixed(1)) : null,
      btn: { x: r.x + r.width / 2, y: r.y + r.height / 2, text: btn.textContent },
      moyuBefore: __MOYU__.state.moyu,
    };
  };
  R.panelState = function(){
    var root = document.getElementById('boss-choice');
    return {
      t: performance.now(),
      open: !root.classList.contains('hidden'),
      confirmed: R.panel.confirmed || null,
      result: R.panel.result || null,
      shake: R.panel.shake || null,
      picked: R.panel.picked || null,
      events: R.panel.events.slice(),
      moyu: __MOYU__.state.moyu,
      survive: __MOYU__.state.surviveStreak,
      choiceOpen: !root.classList.contains('hidden'),
    };
  };
})()`;

async function reloadReset(send, ev) {
  await send("Page.navigate", { url: BASE_URL });
  await waitFor(ev, 'document.readyState === "complete"', { timeout: 20000, label: "reload" });
  await waitFor(ev, "typeof window.__MOYU__ !== 'undefined' && !!window.__R16", { timeout: 20000, label: "hooks" });
  await waitFor(ev, "window.__MOYU__.fps >= 20", { timeout: 10000, label: "fps" }).catch(() => undefined);
  await sleep(500);
  await evj(ev, "__MOYU__.reset()");
  await sleep(250);
}

await runChrome(async ({ port }) => {
  const c = await connect(port);
  const { send, ev } = c;
  const result = { section: "boss-patrol", ts: Date.now() };
  try {
    await bootDev(send, ev);
    result.fps = await evj(ev, "__MOYU__.fps");

    // ============ 1) 守卫期真实触摸：80ms 时点按，看是否真的被拦下 ============
    await reloadReset(send, ev);
    await evj(ev, HELPER);
    await evj(ev, "__R16.watchPanel()");
    // 先做一次真实触摸 80ms 点按
    const setup = await evj(ev, "__R16.tryBoss(80, 1)");
    result.guardTouch = { setup };
    // 等面板出现后 80ms，用真实触摸点按钮
    await sleep(Math.max(0, setup.showDelayMs != null ? 80 : 80));
    await tapTouch(send, setup.btn.x, setup.btn.y, 28);
    await sleep(400);
    result.guardTouch.after = await evj(ev, "__R16.panelState()");
    // 再点一次（若第一次被吞，则这次应生效）
    await sleep(300);
    const mid = await evj(ev, "__R16.panelState()");
    result.guardTouch.mid = mid;
    if (mid.open) {
      const bs = await evj(ev, "(() => { const b = document.querySelectorAll('#boss-choice .boss-opts > button')[1]; if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()");
      if (bs) { await tapTouch(send, bs.x, bs.y, 28); await sleep(500); }
    }
    result.guardTouch.final = await evj(ev, "__R16.panelState()");

    // ============ 2) 巡逻 type：5 次点击达标后，是否立刻有"达标"反馈 ============
    await reloadReset(send, ev);
    const patrolType = await evj(ev, `(async () => {
      const R = __R16;
      const canvas = document.getElementById('stage');
      const r = canvas.getBoundingClientRect();
      const cx = r.x + r.width * 0.5, cy = r.y + r.height * 0.42;
      const tap = () => canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, pointerId: 71, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 }));
      const st = () => ({ t: performance.now(), clicks: __MOYU__.state.totalClicks, moyu: __MOYU__.state.moyu, toast: (document.getElementById('dom-toast')||{}).textContent, fx: (__MOYU__.fxTexts ? __MOYU__.fxTexts() : []), audioN: R.audio.length });
      const wait = (ms) => new Promise(res => setTimeout(res, ms));
      await wait(300);
      const audioStart = R.audio.length;
      const t0 = performance.now();
      await __MOYU__.forceBoss('type');
      await wait(200);
      const before = st();
      const taps = [];
      for (let i = 0; i < 5; i++) {
        await R.at(performance.now() + 300, () => { tap(); return null; });
        taps.push({ t: Number((performance.now() - t0).toFixed(0)), clicks: __MOYU__.state.totalClicks });
      }
      const justAfter = st();
      // 达标后 300ms 内有没有新 toast/音效/飘字？
      await wait(1200);
      const after1200 = st();
      // 等窗口结束（8s 从开启算）
      await wait(6500);
      const ended = st();
      return { t0: t0, before, taps, justAfter, after1200, ended, audio: R.audio.slice(audioStart).map(a => ({ freq: a.freq, t: Number((a.tStart - t0).toFixed(0)) })) };
    })()`);
    result.patrolType = patrolType;

    // ============ 3) 巡逻 blitz：16 次点击达标反馈 ============
    await reloadReset(send, ev);
    const patrolBlitz = await evj(ev, `(async () => {
      const R = __R16;
      const canvas = document.getElementById('stage');
      const r = canvas.getBoundingClientRect();
      const cx = r.x + r.width * 0.5, cy = r.y + r.height * 0.42;
      const tap = () => canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, pointerId: 72, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 }));
      const wait = (ms) => new Promise(res => setTimeout(res, ms));
      await wait(300);
      const t0 = performance.now();
      const audioStart = R.audio.length;
      await __MOYU__.forceBoss('blitz');
      await wait(200);
      const taps = [];
      for (let i = 0; i < 16; i++) { await R.at(performance.now() + 120, () => { tap(); return null; }); taps.push(__MOYU__.state.totalClicks); }
      const justAfter = { t: performance.now(), clicks: __MOYU__.state.totalClicks, toast: (document.getElementById('dom-toast')||{}).textContent, fx: (__MOYU__.fxTexts ? __MOYU__.fxTexts() : []), audioN: R.audio.length };
      await wait(1000);
      const after1000 = { t: performance.now(), toast: (document.getElementById('dom-toast')||{}).textContent, audioN: R.audio.length };
      await wait(6000);
      const ended = { t: performance.now(), toast: (document.getElementById('dom-toast')||{}).textContent, audioN: R.audio.length, clicks: __MOYU__.state.totalClicks };
      return { t0, tapCount: taps.length, clicks: taps, justAfter, after1000, ended, audio: R.audio.slice(audioStart).map(a => ({ freq: a.freq, t: Number((a.tStart - t0).toFixed(0)) })) };
    })()`);
    result.patrolBlitz = patrolBlitz;
    result.errors = c.errors.slice();
  } catch (e) {
    result.fatal = String(e && e.stack ? e.stack : e);
  } finally {
    writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({
      ok: !result.fatal, fatal: result.fatal, fps: result.fps,
      guardTouch: result.guardTouch && { setup: result.guardTouch.setup, after: result.guardTouch.after, mid: result.guardTouch.mid, final: result.guardTouch.final },
      patrolType: result.patrolType && { before: result.patrolType.before, taps: result.patrolType.taps, justAfter: result.patrolType.justAfter, after1200: result.patrolType.after1200, ended: result.patrolType.ended, audioFreqs: result.patrolType.audio.map(a => a.freq) },
      patrolBlitz: result.patrolBlitz && { tapCount: result.patrolBlitz.tapCount, justAfter: result.patrolBlitz.justAfter, after1000: result.patrolBlitz.after1000, ended: result.patrolBlitz.ended, audioFreqs: result.patrolBlitz.audio.map(a => a.freq) },
      errors: result.errors,
    }, null, 2));
    c.close();
  }
}, { timeoutMs: 240_000 });