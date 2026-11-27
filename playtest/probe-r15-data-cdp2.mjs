/**
 * R15 补充：接咖啡「掉落元素生命周期 vs 判定窗口」逐帧取证（只读，无残留进程）
 * 证据链：
 *  A) 掉落元素在创建瞬间位于底部（top≈100%），元素寿命 400ms，期间 top 不变（无动画）
 *  B) 创建后 ~2.9s 才是它的判定窗口中心（±0.32s），此时元素早已被移除 → 判定窗口内不可见
 *  C) 中途 Esc 退出后 played 不增加（不消耗每日次数）
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect } from "./lib/chrome.mjs";

const OUT = "playtest/r15-data";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = {};

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
    const waitFor = async (expr, timeout = 30_000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        if ((await c.ev(expr)) === true) return true;
        await sleep(60);
      }
      return false;
    };
    const shot = async (name) => {
      const r = await c.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, "base64"));
    };

    await c.send("Page.enable");
    await c.send("Runtime.enable");
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
    await c.send("Page.navigate", { url: "http://127.0.0.1:5173/" });
    if (!(await waitFor("!!window.__MOYU__"))) return;
    await c.ev("__MOYU__.reset(); true");
    await sleep(350);
    await c.ev(`document.getElementById('btn-arcade').click(); true`);
    await sleep(120);
    await c.ev(`document.querySelector('#arcade-body button[data-game="coffee"]').click(); true`);

    // 抢在第一个掉落元素出现时抓拍
    const got = await waitFor(`(() => {
      window.__t0 = window.__t0 ?? performance.now();
      const el = document.querySelector('#play-drops .drop');
      if (!el) return false;
      window.__d0 = el;
      window.__d0Info = {
        createdAtMs: Math.round(performance.now() - window.__t0),
        top: el.style.top,
        left: el.style.left,
        rectY: Math.round(el.getBoundingClientRect().top),
        areaRect: (() => { const a = document.getElementById('play-area').getBoundingClientRect(); return { top: Math.round(a.top), height: Math.round(a.height) }; })(),
      };
      return true;
    })()`, 5000);
    ev.firstDrop = { got, info: await evJson("JSON.stringify(window.__d0Info ?? null)") };
    await shot("live-coffee-drop-bottom");

    // 等到该元素的判定窗口中心（创建 + 3.0s ≈ 掉落时间 at），此时元素应已移除
    await sleep(2900);
    ev.atCatchWindow = await evJson(`(() => {
      const el = window.__d0;
      const info = window.__d0Info;
      const nowMs = Math.round(performance.now() - window.__t0);
      return JSON.stringify({
        createdAtMs: info?.createdAtMs,
        nowMs,
        sinceCreatedMs: nowMs - (info?.createdAtMs ?? nowMs),
        sameElementConnected: !!(el && el.isConnected),
        sameElementTop: el ? el.style.top : null,
        liveDropCount: document.querySelectorAll('#play-drops .drop').length,
        note: '判定窗口 = 创建 + 2.68s ~ 3.32s（at±0.32s）',
      });
    })()`);
    await shot("live-coffee-at-catch-window");

    const playedBefore = await evJson("JSON.stringify(__MOYU__.state.arcade)");
    await c.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
    await sleep(300);
    const playedAfter = await evJson("JSON.stringify(__MOYU__.state.arcade)");
    ev.quit = { playedBefore, playedAfter, closed: await c.ev(`document.getElementById('arcade').classList.contains('hidden')`) };
    c.close();
  },
  { timeoutMs: 60_000 },
);

writeFileSync(`${OUT}/live-drop-cycle.json`, JSON.stringify(ev, null, 2));
console.log(JSON.stringify(ev, null, 1));