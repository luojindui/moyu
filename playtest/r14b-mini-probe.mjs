// r14b 小探针：焦点保持细节 / 社交无同事静默 / 省心组合按钮 / 用完播报（有同事时）
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const URL = "http://127.0.0.1:5173/";
const OUT = {};
const clickSel = async (c, sel, wait = 300) => {
  const b = await c.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()`);
  if (!b) return false;
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await sleep(wait);
  return true;
};
const key = async (c, key, code, vk, text, wait = 400) => {
  await c.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(text ? { text } : {}) });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(wait);
};
const activeInfo = `(() => { const a = document.activeElement; return { tag:a?.tagName, id:a?.id, cls:a?.className, role:a?.getAttribute?.('role'), text:(a?.textContent||'').trim().slice(0,30), act:a?.dataset?.act ?? null, dataId:a?.dataset?.id ?? null, isBody:a===document.body, insideDialog:!!(a?.closest && a.closest('#team')), tabIndex:a?.tabIndex }; })()`;
const snap = `(() => ({ live: document.getElementById('sr-live').textContent,
  head: document.querySelector('#team-body .branch h3')?.textContent.replace(/\\s+/g,' ').trim(),
  summary: document.querySelector('.team-summary')?.textContent.replace(/\\s+/g,' ').trim(),
  decor: document.getElementById('decor-summary').textContent,
  toast: document.getElementById('dom-toast')?.textContent,
  toastCls: document.getElementById('dom-toast')?.className }))()`;

await runChrome(async ({ port }) => {
  const c = await connect(port);
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("Accessibility.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  const waitApp = async () => {
    for (let i = 0; i < 150; i++) { if (await c.ev("!!window.__MOYU__ && !!document.getElementById('btn-team')")) { await sleep(400); return true; } await sleep(100); }
    return false;
  };
  const seed = async (blobExpr) => {
    await c.send("Page.navigate", { url: "about:blank" }); await sleep(120);
    await c.send("Page.navigate", { url: URL }); await waitApp();
    await c.ev("localStorage.clear(); 'ok'");
    await c.ev(blobExpr);
    await c.send("Page.reload"); await waitApp(); await sleep(800);
  };
  const openDecor = async () => {
    await clickSel(c, "#btn-team", 450);
    await clickSel(c, "#tab-decor", 450);
  };

  // ---------- 1. 无同事：点「跟同事聊天」是否静默无反应 ----------
  await seed(`(() => { const d = new Date().toLocaleDateString('sv-SE'); const now = Date.now();
    localStorage.setItem('moyu-save', JSON.stringify({ v:2, moyu:1e9, totalEarned:1e9, levels:{}, savedAt:now, createdAt:now-86400000,
      collected:{quotes:[],flavors:[]}, daily:null, surviveStreak:0, patrolSurvives:0, cards:null, decor:[],
      energy:{date:d,left:100,used:[],boosted:{idleMult:1,patrolRewardMult:1,clickMult:1}}, totalClicks:0, visits:{date:'',count:0},
      lifetimeEarned:1e9, prestige:0, team:null, talents:null })); return 'ok'; })()`);
  await openDecor();
  OUT.noColleague = { before: await c.ev(snap) };
  OUT.noColleague.socialBtn = await c.ev(`(() => { const b = document.querySelector('button[data-act="energy"][data-id="social"]'); return b ? { disabled:b.disabled, aria:b.getAttribute('aria-label') } : null; })()`);
  await clickSel(c, '[data-id="social"]', 500);
  OUT.noColleague.after = await c.ev(snap);
  OUT.noColleague.headAfter = await c.ev("document.querySelector('#team-body .branch h3')?.textContent.replace(/\\s+/g,' ').trim()");

  // ---------- 2. 省心组合按钮状态 ----------
  OUT.combo = await c.ev(`(() => { const b = document.querySelector('button[data-act="energy-all"]');
    return b ? { text:b.textContent.trim(), disabled:b.disabled, aria:b.getAttribute('aria-label') } : null; })()`);

  // ---------- 3. 有同事时：键盘 Enter 购买 → 焦点落点 / 播报 ----------
  await seed(`(() => { const d = new Date().toLocaleDateString('sv-SE'); const now = Date.now();
    localStorage.setItem('moyu-save', JSON.stringify({ v:2, moyu:1e9, totalEarned:1e9, levels:{}, savedAt:now, createdAt:now-86400000,
      collected:{quotes:[],flavors:[]}, daily:null, surviveStreak:0, patrolSurvives:0, cards:null, decor:[],
      energy:{date:d,left:100,used:[],boosted:{idleMult:1,patrolRewardMult:1,clickMult:1}}, totalClicks:0, visits:{date:'',count:0},
      lifetimeEarned:1e9, prestige:0,
      team:{ colleagues: { zhou: { level:1, missionId:null, startedAt:0, endsAt:0, favor:0, autoRepeat:false, rewardSnapshot:0 } } },
      talents:null })); return 'ok'; })()`);
  await openDecor();
  OUT.withColleague = { before: await c.ev(snap) };
  // 键盘聚焦第一个可买家具有 → Enter
  OUT.withColleague.focusedBuy = await c.ev(`(() => { const b = document.querySelector('#team-body button[data-act="decor"]:not([disabled])'); if (!b) return null; b.scrollIntoView({block:'center'}); b.focus(); return { text:b.textContent.trim(), aria:b.getAttribute('aria-label'), act:b.dataset.act, id:b.dataset.id, isFocused: document.activeElement===b }; })()`);
  await key(c, "Enter", "Enter", 13, "\r");
  OUT.withColleague.afterBuy = { active: await c.ev(activeInfo), snap: await c.ev(snap) };
  OUT.withColleague.rowMatch = await c.ev(`(() => { const row = document.querySelector('#team-body [data-act="decor"][data-id="plant"]'); return row ? { tag:row.tagName, cls:row.className, tabIndex:row.tabIndex, focusable: row.tabIndex >= 0 } : null; })()`);
  OUT.withColleague.selectorProbe = await c.ev(`(() => { const bySel = document.querySelector('#team-body [data-act="decor"][data-id="plant"]'); return { found: !!bySel, tag: bySel?.tagName }; })()`);

  // ---------- 4. 有同事：social+fake-work+slack 用尽 → 用完播报时序 ----------
  // 用键盘/鼠标依次点击（social 需要同事，已播种 zhou）
  OUT.usedUp = { uses: [] };
  for (const id of ["social", "fake-work", "slack"]) {
    const before = await c.ev(snap);
    await clickSel(c, `[data-id="${id}"]`, 350);
    const after = await c.ev(snap);
    OUT.usedUp.uses.push({ id, before, after, active: await c.ev(activeInfo) });
  }
  // 时序采样
  {
    const samples = [];
    const t0 = Date.now();
    for (const ms of [120, 350, 430, 520, 700, 1100]) {
      const wait = ms - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
      samples.push({ ms, at: Date.now() - t0, live: await c.ev("document.getElementById('sr-live').textContent") });
    }
    OUT.usedUp.samples = samples;
  }
  OUT.usedUp.final = await c.ev(snap);
  OUT.usedUp.buttons = await c.ev(`[...document.querySelectorAll('#team-body .branch button')].map(b => ({ text:b.textContent.trim(), disabled:b.disabled }))`);

  // ---------- 5. 鼠标购买后的焦点 + 是否 Chrome 点击聚焦按钮 ----------
  await seed(`(() => { const d = new Date().toLocaleDateString('sv-SE'); const now = Date.now();
    localStorage.setItem('moyu-save', JSON.stringify({ v:2, moyu:1e9, totalEarned:1e9, levels:{}, savedAt:now, createdAt:now-86400000,
      collected:{quotes:[],flavors:[]}, daily:null, surviveStreak:0, patrolSurvives:0, cards:null, decor:[],
      energy:{date:d,left:100,used:[],boosted:{idleMult:1,patrolRewardMult:1,clickMult:1}}, totalClicks:0, visits:{date:'',count:0},
      lifetimeEarned:1e9, prestige:0, team:null, talents:null })); return 'ok'; })()`);
  await openDecor();
  const box = await c.ev(`(() => { const b = document.querySelector('button[data-act="decor"][data-id="plant"]'); b.scrollIntoView({block:'center'}); const r=b.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()`);
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  const during = await c.ev(activeInfo);
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(350);
  OUT.mouseBuy = { duringPress: during, after: { active: await c.ev(activeInfo), snap: await c.ev(snap) } };

  writeFileSync("playtest/r14b-mini-evidence.json", JSON.stringify(OUT, null, 2));
  return "done";
}, { timeoutMs: 240_000 });
console.log(JSON.stringify(OUT, null, 1).slice(0, 9000));