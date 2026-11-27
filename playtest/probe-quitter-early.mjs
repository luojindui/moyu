/**
 * 终验·弃坑型：补充探针——新手按开局 toast「点 👥 看看」在第 3/6/9 秒点开三个入口时看到什么（零进度）。
 * 线上 https://luojindui.github.io/moyu/ ，390x844；只截图+取文本，不玩游戏。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const DIR = "playtest/quitter-final";
mkdirSync(DIR + "/shots", { recursive: true });
const OUT = { p: {}, meta: {} };

await runChrome(
  async ({ port }) => {
    const c = await connect(port);
    const { send, ev } = c;
    const writeB64 = (f, b) => writeFileSync(f, Buffer.from(b, "base64"));
    const cap = async (f) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeB64(f, r.data); };
    const clickSel = async (sel) => {
      const r = await ev("(() => { const el = document.querySelector(" + JSON.stringify(sel) + "); if (!el) return null; const b = el.getBoundingClientRect(); if (b.width < 1) return null; return { x: b.x + b.width/2, y: b.y + b.height/2 }; })()");
      if (!r) return false;
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 });
      await sleep(24);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
      return true;
    };
    const panel = async (rootId, sel) => ev("(() => { const root = document.getElementById(" + JSON.stringify(rootId) + "); const p = root.querySelector(" + JSON.stringify(sel) + ") || root; const t = (p.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim(); return { scrollH: p.scrollHeight, clientH: p.clientHeight, textLen: t.length, text: t.slice(0, 5000), buttons: Array.from(p.querySelectorAll('button')).slice(0, 30).map(function (b) { return ((b.innerText || '') + '').trim().slice(0, 30) + (b.disabled ? '(禁)' : ''); }) }; })()");
    const st = () => ev("(() => ({ moyu: document.getElementById('hud-moyu').textContent, click: document.getElementById('hud-click').textContent, idle: document.getElementById('hud-idle').textContent, badges: Array.from(document.querySelectorAll('#btn-team .badge, #btn-team .talent-badge, #btn-team .energy-badge')).map(function (e) { return e.textContent; }), arcade: Array.from(document.querySelectorAll('#btn-arcade .arcade-badge')).map(function (e) { return e.textContent; }) }))()");

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send("Page.navigate", { url: "https://luojindui.github.io/moyu/" });
    for (let i = 0; i < 120; i++) { if (await ev("document.readyState === 'complete' && !!document.getElementById('hud-moyu')")) break; await sleep(100); }
    await sleep(2000);
    OUT.meta.atOpen = { p: Math.round(await ev("performance.now()")), state: await st() };

    // 3s 左右：按 toast 提示点 👥
    await clickSel("#btn-team"); await sleep(500);
    OUT.p.team3s = { at: Math.round(await ev("performance.now()")), info: await panel("team", ".team-panel") };
    await cap(DIR + "/shots/early-team.png");
    if (await clickSel("#tab-talents")) { await sleep(400); OUT.p.team3sTalents = await panel("team", ".team-panel"); }
    if (await clickSel("#tab-decor")) { await sleep(400); await cap(DIR + "/shots/early-team-decor.png"); }
    await clickSel("#team-close"); await sleep(350);

    // 6s 左右：🎮
    await clickSel("#btn-arcade"); await sleep(500);
    OUT.p.arcade6s = { at: Math.round(await ev("performance.now()")), info: await panel("arcade", ".arcade-panel") };
    await cap(DIR + "/shots/early-arcade.png");
    await clickSel("#arcade-close"); await sleep(350);

    // 9s 左右：📔
    await clickSel("#btn-journal"); await sleep(500);
    OUT.p.journal9s = { at: Math.round(await ev("performance.now()")), info: await panel("journal", ".journal-panel") };
    await cap(DIR + "/shots/early-journal.png");
    await clickSel("#journal-close"); await sleep(300);
    OUT.meta.afterClose = { p: Math.round(await ev("performance.now()")), state: await st() };

    c.close();
    writeFileSync(DIR + "/early-entry.json", JSON.stringify(OUT, null, 2));
    console.log("[early] done", JSON.stringify({ atOpen: OUT.meta.atOpen.p, team: OUT.p.team3s.info.textLen, arcade: OUT.p.arcade6s.info.textLen, journal: OUT.p.journal9s.info.textLen }));
  },
  { timeoutMs: 90_000 },
);