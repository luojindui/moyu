// R14 复验 live：① 精力 4 项 UI/预算 ② 「省心组合」 ③ 跨日离线 A/B（真实 localStorage 存档注入 + reload）
// 必须使用 playtest/lib/chrome.mjs 以保证 kill Chrome
// 运行：node_modules/.bin/vite-node playtest/probe-r14b-live.mjs
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { initialState } from "../src/engine/state";
import { serialize, SAVE_KEY } from "../src/engine/save";
import { ENERGY_ACTIONS } from "../src/engine/energy";

const URL = "http://127.0.0.1:5173/";
const NOW = Date.now();
const DAY = 86_400_000;

function makeSaveJson(used) {
  const st = {
    ...initialState(),
    moyu: 5e9,
    totalEarned: 5e9,
    lifetimeEarned: 5e9,
    levels: { phone: 20, toilet: 20, group: 20, meeting: 20, deep: 15 },
    energy: {
      date: "2000-01-01",
      left: 100 - used.reduce((a, id) => a + (ENERGY_ACTIONS.find((e) => e.id === id)?.cost ?? 0), 0),
      used,
      boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 },
    },
    visits: { date: "2026-01-01", count: 3 },
    daily: { date: "2026-01-01", goals: [], streak: 14, lastCompleteDate: null, claimed: false, window: 0, claimsToday: 0 },
  };
  const store = new Map();
  store.set(SAVE_KEY, JSON.stringify({ savedAt: NOW - 12 * 3600 * 1000, createdAt: NOW - 10 * DAY }));
  const adapter = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) };
  serialize(st, adapter, NOW - 12 * 3600 * 1000);
  return store.get(SAVE_KEY);
}

await runChrome(async ({ port }) => {
  const c = await connect(port);
  const { send, ev } = c;
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const out = {};

  const bootWait = async () => {
    for (let i = 0; i < 80; i++) {
      if ((await ev("typeof window.__MOYU__ === 'object' && !!window.__MOYU__.state")) === true) return true;
      await sleep(250);
    }
    return false;
  };
  const load = async () => {
    await send("Page.navigate", { url: URL });
    await sleep(1800);
    return bootWait();
  };

  // ---------- A/B：跨日离线是否吃昨日精力 ----------
  const saveA = makeSaveJson(["slack", "fake-work"]);
  const saveB = makeSaveJson([]);
  const BASE = 5e9;
  let scriptSeq = 0;
  const round = async (saveJson) => {
    // 用 addScriptToEvaluateOnNewDocument 在文档初始化前写入存档（避开 pagehide 保存覆盖）
    const { identifier } = await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { localStorage.setItem(${JSON.stringify(SAVE_KEY)}, ${JSON.stringify(saveJson)}); } catch (e) {}`,
    });
    scriptSeq++;
    await send("Page.reload", { ignoreCache: false });
    await sleep(2000);
    const ok = await bootWait();
    await sleep(700);
    const st = JSON.parse(await ev("JSON.stringify(window.__MOYU__.state)"));
    await send("Page.removeScriptToEvaluateOnNewDocument", { identifier }).catch(() => {});
    return { ok, moyu: st.moyu, levelPhone: st.levels?.phone, earned: st.moyu - BASE, energy: st.energy };
  };
  const booted0 = await load();
  out.booted = booted0;
  const A = await round(saveA);
  const B = await round(saveB);
  out.offlineAB = {
    A: { earned: A.earned, energy: A.energy },
    B: { earned: B.earned, energy: B.energy },
    ratio: B.earned > 0 ? A.earned / B.earned : null,
  };

  // ---------- 全新档：精力 UI / 省心组合 / 4 项不可全点 ----------
  await ev("localStorage.clear()");
  await send("Page.reload");
  await sleep(1800);
  out.bootedFresh = await bootWait();
  await sleep(400);
  await ev("window.__MOYU__.grant(1e11)");
  await sleep(300);
  await ev("document.getElementById('btn-team').click()");
  await sleep(400);
  await ev("document.getElementById('tab-decor').click()");
  await sleep(400);
  out.energyButtonsFresh = await ev(`[...document.querySelectorAll('button[data-act="energy"]')].map(b=>({id:b.dataset.id,disabled:b.disabled}))`);
  out.comboBtnFresh = await ev(`(() => { const b=document.querySelector('button[data-act="energy-all"]'); return b ? {text:b.textContent, disabled:b.disabled} : null; })()`);

  // 招募老周（12k）后 social 应可用
  await ev("document.getElementById('tab-colleagues')?.click()");
  await sleep(400);
  out.recruitZhou = await ev(`(() => { const b=[...document.querySelectorAll('button[data-act="recruit"]')].find(x=>x.dataset.id==='zhou'); if(!b) return 'no-button'; b.click(); return 'clicked'; })()`);
  await sleep(500);
  await ev("document.getElementById('tab-decor').click()");
  await sleep(400);
  out.energyButtonsAfterRecruit = await ev(`[...document.querySelectorAll('button[data-act="energy"]')].map(b=>({id:b.dataset.id,disabled:b.disabled}))`);
  out.energyBefore = JSON.parse(await ev("JSON.stringify(window.__MOYU__.state.energy)"));

  // 逐个使用：slack→fake-work→social 后应剩 0、focus 禁用；再点 focus 无效
  const seq = [];
  for (const id of ["slack", "fake-work", "social"]) {
    const r = await ev(`(() => { const b=[...document.querySelectorAll('button[data-act]')].find(x=>x.dataset.act==='energy' && x.dataset.id==='${id}'); if(!b) return 'no-btn'; if(b.disabled) return 'disabled'; b.click(); return 'clicked'; })()`);
    await sleep(300);
    seq.push({ id, action: r, energy: JSON.parse(await ev("JSON.stringify(window.__MOYU__.state.energy)")) });
  }
  out.energySeq = seq;
  out.energyAfter3 = JSON.parse(await ev("JSON.stringify(window.__MOYU__.state.energy)"));
  out.focusAfter3 = await ev(`(() => { const b=[...document.querySelectorAll('button[data-act="energy"]')].find(x=>x.dataset.id==='focus'); return b ? b.disabled : 'not-found'; })()`);
  // 强行用引擎外的方式点第 4 项：直接触发 data-act 元素点击（若禁用则无效）
  out.clickFocusResult = await ev(`(() => { const b=[...document.querySelectorAll('button[data-act="energy"]')].find(x=>x.dataset.id==='focus'); if(!b) return 'no-btn'; const before=JSON.stringify(window.__MOYU__.state.energy); b.click(); return before === JSON.stringify(window.__MOYU__.state.energy) ? 'unchanged(禁用)' : 'CHANGED'; })()`);

  // 省心组合按钮（新档已用完三项 → 应禁用）
  out.comboBtnAfter = await ev(`(() => { const b=document.querySelector('button[data-act="energy-all"]'); return b ? {text:b.textContent, disabled:b.disabled} : null; })()`);
  out.panelText = await ev("document.querySelector('.team-panel')?.innerText ?? ''");

  // 截图
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync("playtest/r14b-hardcore-energy.png", Buffer.from(shot.data, "base64"));

  out.consoleErrors = c.errors;
  writeFileSync("playtest/r14b-hardcore-live.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  c.close();
}, { timeoutMs: 150_000 });
console.log("chrome cleaned");