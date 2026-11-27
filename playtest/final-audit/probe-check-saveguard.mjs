// 验证：reload 前手工写 localStorage 是否会被 pagehide 自动存档覆盖；以及阻断方案
import { runChrome, connect } from "../lib/chrome.mjs";
import { DEV, sleep, setViewport, goto, ev, waitFor } from "./lib.mjs";

const r = { a: {}, b: {}, c: {} };
await runChrome(async ({ port }) => {
  const c = await connect(port);
  await setViewport(c);
  const ready = `typeof window.__MOYU__ === "object"`;
  await goto(c, DEV, ready);
  await sleep(500);
  // 1) 直接写档后 reload：pagehide 会不会覆盖？
  const crafted = await ev(c, `(() => {
    const b = JSON.parse(localStorage.getItem("moyu-save") ?? "{}");
    b.moyu = 777777; b.totalEarned = 777777; b.lifetimeEarned = 777777;
    localStorage.setItem("moyu-save", JSON.stringify(b));
    return true;
  })()`);
  await c.send("Page.reload", {});
  await waitFor(c, ready, 20000);
  await sleep(400);
  r.a.state = await ev(c, `window.__MOYU__.state.moyu`);
  r.a.raw = await ev(c, `JSON.parse(localStorage.getItem("moyu-save")).moyu`);
  // 2) 阻断方案：先写档，再 patch Storage.prototype.setItem 拦 moyu-save，再 reload
  const crafted2 = await ev(c, `(() => {
    const b = JSON.parse(localStorage.getItem("moyu-save") ?? "{}");
    b.moyu = 555555; b.totalEarned = 555555; b.lifetimeEarned = 555555;
    localStorage.setItem("moyu-save", JSON.stringify(b));
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === "moyu-save") return; return real.call(this, k, v); };
    window.__auditMark = 1;
    return true;
  })()`);
  await c.send("Page.reload", {});
  const back = await waitFor(c, `typeof window.__auditMark === "undefined" && ${ready}`, 20000);
  await sleep(400);
  r.b.navigated = back;
  r.b.state = await ev(c, `window.__MOYU__.state.moyu`);
  r.b.raw = await ev(c, `JSON.parse(localStorage.getItem("moyu-save")).moyu`);
  c.close();
}, { timeoutMs: 120_000 });
console.log(JSON.stringify(r, null, 2));