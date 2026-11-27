// 诊断：dev 页面是否在中途被重载？addScriptToEvaluateOnNewDocument 换种子是否生效？
import { runChrome, connect } from "../lib/chrome.mjs";
import { DEV, sleep, setViewport, ev, waitFor } from "./lib.mjs";

const OUT = process.env.AUDIT_OUT ?? "/Users/p/Desktop/workspace/code/moyu/playtest/final-audit/out";
const today = new Date().toLocaleDateString("sv-SE");
const dayWindow = Math.floor(new Date().getHours() / 6);
const seedA = { v: 2, moyu: 0, totalEarned: 0, levels: {}, savedAt: Date.now(), createdAt: Date.now() - 60000, daily: { date: today, window: dayWindow, streak: 0, lastCompleteDate: null, claimed: false, claimsToday: 0, goals: [{ id: "visit_1", target: 1, progress: 0, done: false }, { id: "idle_earn", target: 1, progress: 0, done: false }, { id: "click_100", target: 100, progress: 0, done: false }] } };
const seedB = { v: 2, moyu: 100, totalEarned: 500000, lifetimeEarned: 500000, levels: { phone: 5 }, savedAt: Date.now(), createdAt: Date.now() - 60000, prestige: 2 };

await runChrome(async ({ port }) => {
  const c = await connect(port);
  await setViewport(c, { width: 1100, height: 800 });
  const out = {};
  const addSeed = async (blob) => {
    const r = await c.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        try {
          window.__seedRan = (window.__seedRan ?? 0) + 1;
          sessionStorage.setItem("audit-loads", String(Number(sessionStorage.getItem("audit-loads") || "0") + 1));
          localStorage.clear();
          localStorage.setItem("moyu-save", ${JSON.stringify(JSON.stringify(blob))});
        } catch (e) {}
      })();`,
    });
    return r.identifier;
  };
  let id = await addSeed(seedA);
  await c.send("Page.navigate", { url: DEV });
  await waitFor(c, `typeof window.__MOYU__ === "object"`, 25000);
  await ev(c, `window.confirm = () => true; true`);
  await sleep(800);
  out.A = await ev(c, `({ loads: sessionStorage.getItem("audit-loads"), levels: window.__MOYU__.state.levels, lifetime: window.__MOYU__.state.lifetimeEarned, onboarding: document.body.classList.contains("onboarding"), quest: document.getElementById("quest-text")?.textContent })`);
  // 等 3 秒看是否被重载（loads 增加 / quest 跳动）
  await sleep(3000);
  out.A2 = await ev(c, `({ loads: sessionStorage.getItem("audit-loads"), quest: document.getElementById("quest-text")?.textContent })`);

  // 换种子 B
  await c.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: id });
  id = await addSeed(seedB);
  await c.send("Page.navigate", { url: DEV });
  await waitFor(c, `typeof window.__MOYU__ === "object"`, 25000);
  await sleep(800);
  out.B = await ev(c, `({ loads: sessionStorage.getItem("audit-loads"), levels: window.__MOYU__.state.levels, lifetime: window.__MOYU__.state.lifetimeEarned, prestige: window.__MOYU__.state.prestige, onboarding: document.body.classList.contains("onboarding"), quest: document.getElementById("quest-text")?.textContent, rawMoyu: JSON.parse(localStorage.getItem("moyu-save")||"{}").moyu })`);
  // 再 navigate 一次到相同 URL，看是否真的重载
  const before = await ev(c, `sessionStorage.getItem("audit-loads")`);
  await c.send("Page.navigate", { url: DEV });
  await waitFor(c, `typeof window.__MOYU__ === "object"`, 25000);
  await sleep(600);
  out.B2 = await ev(c, `({ before: ${JSON.stringify(before)}, loads: sessionStorage.getItem("audit-loads"), lifetime: window.__MOYU__.state.lifetimeEarned, prestige: window.__MOYU__.state.prestige, onboarding: document.body.classList.contains("onboarding") })`);
  console.log(JSON.stringify(out, null, 2));
  c.close();
}, { timeoutMs: 120_000 });