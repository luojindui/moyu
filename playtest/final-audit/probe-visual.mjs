// 家具场景变化视觉证据：装修前后各一张干净场景截图（面板关闭）
import { runChrome, connect } from "../lib/chrome.mjs";
import { DEV, sleep, setViewport, goto, ev, click, waitFor, closeAllModals, openPanel, shot, text } from "./lib.mjs";

await runChrome(async ({ port }) => {
  const c = await connect(port);
  await setViewport(c, { width: 1100, height: 800 });
  await goto(c, DEV, `typeof window.__MOYU__ === "object"`);
  await ev(c, `window.confirm = () => true; true`);
  await closeAllModals(c);
  await ev(c, "window.__MOYU__.grant(2300000000)");
  await sleep(400);
  // 装修前：干净场景
  await shot(c, "V-scene-before");
  const before = await text(c, "#decor-summary");
  const hudBefore = await text(c, "#hud-idle");
  // 买齐 8 件
  await openPanel(c, "#btn-team", "#team");
  await click(c, "#tab-decor");
  await waitFor(c, `document.querySelector('button[data-act="decor"][data-id="plant"]') !== null`, 4000);
  for (const id of ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"]) {
    await ev(c, `(() => { const b = document.querySelector('button[data-act="decor"][data-id="${id}"]'); if (b) b.click(); return true; })()`);
    await sleep(280);
  }
  const decor = (await ev(c, "window.__MOYU__.state.decor")).length;
  await closeAllModals(c);
  await sleep(800);
  await shot(c, "V-scene-after");
  const after = await text(c, "#decor-summary");
  const hudAfter = await text(c, "#hud-idle");
  console.log(JSON.stringify({ decor, before, after, hudBefore, hudAfter }, null, 2));
  c.close();
}, { timeoutMs: 120_000 });