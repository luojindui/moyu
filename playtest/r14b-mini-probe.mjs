// r14b 定向探针 C：社交无同事 / 用完播报（有同事）/ 省心组合按钮 / 鼠标焦点 / AX
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const URL = "http://127.0.0.1:5173/";
const OUT = { at: new Date().toISOString() };
const clickSel = async (c, sel, wait = 350) => {
  const b = await c.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()`);
  if (!b) return false;
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await sleep(wait);
  return true;
};
const actInfo = `(() => { const a=document.activeElement; return { tag:a?.tagName, role:a?.getAttribute?.('role'), text:(a?.textContent||'').trim().slice(0,24), act:a?.dataset?.act ?? null, isBody:a===document.body, insideDialog:!!(a?.closest && a.closest('#team')) }; })()`;
const snap = `(() => ({ live: document.getElementById('sr-live').textContent,
  head: document.querySelector('#team-body .branch h3')?.textContent.replace(/\\s+/g,' ').trim(),
  decor: document.getElementById('decor-summary').textContent,
  toast: document.getElementById('dom-toast')?.textContent,
  toastCls: document.getElementById('dom-toast')?.className,
  active: ${actInfo} }))()`;

const seedSave = (withColleague) => `(() => {
  const d = new Date().toLocaleDateString('sv-SE'); const now = Date.now();
  const team = ${withColleague ? `{ colleagues: { zhou: { level:1, missionId:null, startedAt:0, endsAt:0, favor:0, autoRepeat:false, rewardSnapshot:0 } } }` : "null"};
  localStorage.setItem('moyu-save', JSON.stringify({ v:2, moyu:1e9, totalEarned:1e9, levels:{}, savedAt:now, createdAt:now-86400000,
    collected:{quotes:[],flavors:[]}, daily:null, surviveStreak:0, patrolSurvives:0, cards:null, decor:[],
    energy:{date:d,left:100,used:[],boosted:{idleMult:1,patrolRewardMult:1,clickMult:1}}, totalClicks:0, visits:{date:'',count:0},
    lifetimeEarned:1e9, prestige:0, team, talents:null }));
  return 'seeded'; })()`;

await runChrome(async ({ port }) => {
  const c = await connect(port);
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("Accessibility.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });

  const boot = async (seed) => {
    await c.send("Page.navigate", { url: "about:blank" });
    await sleep(150);
    await c.send("Page.navigate", { url: URL });
    for (let i = 0; i < 120; i++) { if (await c.ev("!!window.__MOYU__ && !!document.getElementById('btn-team')")) break; await sleep(100); }
    await c.ev("localStorage.clear(); 'ok'");
    await c.ev(seed);
    await c.send("Page.reload");
    for (let i = 0; i < 120; i++) { if (await c.ev("!!window.__MOYU__ && !!document.getElementById('btn-team')")) break; await sleep(100); }
    await sleep(900);
    for (let i = 0; i < 3; i++) {
      if (!(await c.ev("document.getElementById('team').classList.contains('hidden')"))) break;
      await clickSel(c, "#btn-team", 450);
    }
    await clickSel(c, "#tab-decor", 450);
    return c.ev("document.querySelector('.team-tabs .tab.active')?.textContent");
  };

  // ---------- 1. 无同事：社交按钮可点但静默 ----------
  OUT.noColleague = { tab: await boot(seedSave(false)) };
  OUT.noColleague.before = await c.ev(snap);
  OUT.noColleague.socialBtn = await c.ev(`(() => { const b = document.querySelector('button[data-act="energy"][data-id="social"]'); return b ? { disabled:b.disabled, aria:b.getAttribute('aria-label') } : null; })()`);
  OUT.noColleague.clicked = await clickSel(c, '[data-id="social"]', 600);
  OUT.noColleague.after = await c.ev(snap);
  OUT.noColleague.buttonsAfter = await c.ev(`[...document.querySelectorAll('#team-body .branch button')].map(b=>({ text:b.textContent.trim(), disabled:b.disabled }))`);

  // ---------- 2. 有同事：social+fake-work+slack → 用完播报时序 ----------
  OUT.withColleague = { tab: await boot(seedSave(true)) };
  OUT.withColleague.before = await c.ev(snap);
  OUT.withColleague.socialBtn = await c.ev(`(() => { const b = document.querySelector('button[data-act="energy"][data-id="social"]'); return b ? { disabled:b.disabled, aria:b.getAttribute('aria-label') } : null; })()`);
  OUT.withColleague.uses = [];
  for (const id of ["social", "fake-work", "slack"]) {
    await clickSel(c, `[data-id="${id}"]`, 400);
    OUT.withColleague.uses.push({ id, snap: await c.ev(snap) });
  }
  {
    const samples = [];
    const t0 = Date.now();
    for (const ms of [100, 300, 420, 480, 560, 750, 1100]) {
      const wait = ms - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
      samples.push({ ms, live: await c.ev("document.getElementById('sr-live').textContent") });
    }
    OUT.withColleague.samples = samples;
  }
  OUT.withColleague.combo = await c.ev(`(() => { const b=document.querySelector('button[data-act="energy-all"]'); return b ? { text:b.textContent.trim(), disabled:b.disabled } : null; })()`);
  OUT.withColleague.finalHead = await c.ev("document.querySelector('#team-body .branch h3')?.textContent.replace(/\\s+/g,' ').trim()");
  OUT.withColleague.buttons = await c.ev(`[...document.querySelectorAll('#team-body .branch button')].map(b=>({ text:b.textContent.trim(), disabled:b.disabled }))`);

  // ---------- 3. 省心组合按钮（金额充足、无消耗时） ----------
  OUT.comboFresh = { tab: await boot(seedSave(true)) };
  await sleep(400);
  OUT.comboFresh.combo = await c.ev(`(() => { const b=document.querySelector('button[data-act="energy-all"]'); return b ? { text:b.textContent.trim(), disabled:b.disabled, h:Math.round(b.getBoundingClientRect().height), aria:b.getAttribute('aria-label') } : null; })()`);
  OUT.comboFresh.head = await c.ev("document.querySelector('#team-body .branch h3')?.textContent.replace(/\\s+/g,' ').trim()");
  // 点一次（若可用）看播报
  await clickSel(c, 'button[data-act="energy-all"]', 500);
  OUT.comboFresh.after = await c.ev(snap);

  // ---------- 4. 鼠标购买：按住/点击后焦点 ----------
  OUT.mouse = { tab: await boot(seedSave(false)) };
  const box = await c.ev(`(() => { const b=document.querySelector('button[data-act="decor"][data-id="plant"]'); if(!b) return null; b.scrollIntoView({block:'center'}); const r=b.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()`);
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  OUT.mouse.duringPress = await c.ev(actInfo);
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(400);
  OUT.mouse.after = { snap: await c.ev(snap), active: await c.ev(actInfo) };
  OUT.mouse.rowInfo = await c.ev(`(() => { const row=document.querySelector('#team-body [data-act="decor"][data-id="plant"]'); return row ? { tag:row.tagName, tabIndex:row.tabIndex, focusable: row.tabIndex>=0, cls:row.className } : null; })()`);

  // ---------- 5. 键盘购买：Enter 后焦点落点 ----------
  OUT.kb = { tab: await boot(seedSave(false)) };
  OUT.kb.focused = await c.ev(`(() => { const b=document.querySelector('#team-body button[data-act="decor"]:not([disabled])'); if(!b) return null; b.scrollIntoView({block:'center'}); b.focus(); return { text:b.textContent.trim(), aria:b.getAttribute('aria-label'), isFocused: document.activeElement===b }; })()`);
  await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r" });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sleep(500);
  OUT.kb.after = { snap: await c.ev(snap), active: await c.ev(actInfo) };

  // ---------- 6. 关闭面板 → canvas AX 描述（确认 sr-only 摘要进 AX） ----------
  await clickSel(c, "#team-close", 500);
  OUT.closed = await c.ev(`(() => ({ hidden: document.getElementById('team').classList.contains('hidden'), active: ${actInfo}, decor: document.getElementById('decor-summary').textContent }))()`);
  const ax = await c.send("Accessibility.getFullAXTree");
  OUT.canvasAx = ax.nodes.filter((n) => n.role && !n.ignored && (n.name?.value || "").includes("点击摸鱼")).map((n) => ({
    role: n.role.value, name: n.name?.value, description: n.description?.value ?? "",
  }));
  OUT.decorSummaryInAx = ax.nodes.filter((n) => n.role && !n.ignored && /工位已装修|工位尚未装修/.test(n.name?.value ?? "")).map((n) => ({ role: n.role.value, name: (n.name?.value ?? "").slice(0, 80) }));

  writeFileSync("playtest/r14b-mini-evidence.json", JSON.stringify(OUT, null, 2));
  return "done";
}, { timeoutMs: 240_000 });
console.log("WROTE r14b-mini-evidence.json");