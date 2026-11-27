// r14 探针 C：键盘 Enter/Space 激活家具购买与精力使用；播报/焦点；家具区标题语义
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const URL = "http://127.0.0.1:5173/";
const OUT = { at: new Date().toISOString() };
const DIR = "playtest/r14-shots";
const shot = async (c, name, clip) => {
  const params = { format: "png" };
  if (clip) params.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: clip.scale ?? 2 };
  const r = await c.send("Page.captureScreenshot", params);
  writeFileSync(`${DIR}/${name}.png`, Buffer.from(r.data, "base64"));
};
const clickSel = async (c, sel) => {
  const b = await c.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`);
  if (!b) return false;
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await sleep(300);
  return true;
};
const pressKey = async (c, key, code, vk, text) => {
  await c.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(text ? { text } : {}) });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(450);
};

const ax = async (c) => {
  const t = await c.send("Accessibility.getFullAXTree");
  const prop = (n, k) => (n.properties || []).find((p) => p.name === k)?.value?.value;
  return t.nodes
    .filter((n) => n.role && !n.ignored)
    .map((n) => ({ role: n.role.value, name: n.name?.value ?? "", disabled: prop(n, "disabled"), live: prop(n, "live"), selected: prop(n, "selected") }));
};

await runChrome(async ({ port }) => {
  const c = await connect(port);
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("Accessibility.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });

  await c.send("Page.navigate", { url: URL });
  for (let i = 0; i < 120; i++) {
    if (await c.ev("!!document.getElementById('btn-team')")) break;
    await sleep(100);
  }
  await c.ev(`(() => {
    const d = new Date().toLocaleDateString('sv-SE');
    const now = Date.now();
    localStorage.setItem('moyu-save', JSON.stringify({ v: 2, moyu: 1e9, totalEarned: 1e9, levels: {}, savedAt: now,
      createdAt: now - 86400000, collected: { quotes: [], flavors: [] }, daily: null, surviveStreak: 0, patrolSurvives: 0,
      cards: null, decor: [], energy: { date: d, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1 } },
      totalClicks: 0, visits: { date: '', count: 0 }, lifetimeEarned: 1e9, prestige: 0, team: null, talents: null }));
    return 'seeded';
  })()`);
  await c.send("Page.reload");
  for (let i = 0; i < 120; i++) {
    if (await c.ev("!!window.__MOYU__ && !!document.getElementById('btn-team')")) break;
    await sleep(100);
  }
  await sleep(1200);
  await clickSel(c, "#btn-team");
  await sleep(700);
  await clickSel(c, "#tab-decor");
  await sleep(900);

  // AX 标题 / 家具区是否有标题
  const ax1 = await ax(c);
  OUT.headings = ax1.filter((n) => n.role === "heading");
  OUT.tabAx = ax1.filter((n) => ["同事", "天赋", "工位"].includes(n.name));
  OUT.energyButtonsAx = ax1.filter((n) => n.name === "使用");
  OUT.decorButtonsAx = ax1.filter((n) => n.role === "button" && /^[\d.]+(万|亿)?$/.test(n.name));

  // 键盘 Enter 购买绿萝
  const focusPlant = await c.ev(`(() => {
    const b = document.querySelector('#team-body button[data-act="decor"]');
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    b.focus();
    const a = document.activeElement;
    return { text: a.textContent.trim(), disabled: a.disabled, act: a.dataset.act, id: a.dataset.id, focused: a === b, live: document.getElementById('sr-live').textContent,
      summary: document.querySelector('.team-summary')?.textContent.replace(/\\s+/g,' ').trim() };
  })()`);
  await pressKey(c, "Enter", "Enter", 13, "\r");
  const afterEnter = await c.ev(`(() => { const a = document.activeElement; const t = document.getElementById('dom-toast');
    return { live: document.getElementById('sr-live').textContent, summary: document.querySelector('.team-summary')?.textContent.replace(/\\s+/g,' ').trim(),
      toast: t?.textContent, toastCls: t?.className, active: { tag: a?.tagName, text: (a?.textContent||'').trim().slice(0,20), isBody: a === document.body, insideDialog: !!(a.closest && a.closest('#team')) } }; })()`);
  OUT.keyboardBuy = { focusPlant, afterEnter };

  // 键盘 Space 使用精力（第一项）
  const focusUse = await c.ev(`(() => {
    const b = document.querySelector('button[data-act="energy"]');
    if (!b) return null;
    b.scrollIntoView({ block: 'center' }); b.focus();
    const a = document.activeElement;
    return { text: a.textContent.trim(), focused: a === b, head: document.querySelector('#team-body .branch h3')?.textContent.replace(/\\s+/g,' ').trim(), live: document.getElementById('sr-live').textContent };
  })()`);
  await pressKey(c, " ", "Space", 32, " ");
  const afterSpace = await c.ev(`(() => { const a = document.activeElement; const t = document.getElementById('dom-toast');
    return { live: document.getElementById('sr-live').textContent, head: document.querySelector('#team-body .branch h3')?.textContent.replace(/\\s+/g,' ').trim(),
      toast: t?.textContent, toastCls: t?.className, active: { tag: a?.tagName, text: (a?.textContent||'').trim().slice(0,20), isBody: a === document.body, insideDialog: !!(a.closest && a.closest('#team')) },
      remainingUseButtons: document.querySelectorAll('button[data-act="energy"]').length }; })()`);
  OUT.keyboardUseEnergy = { focusUse, afterSpace };

  // 记录整段可用文字（读屏线性阅读能听到什么）
  OUT.panelInnerText = await c.ev("document.getElementById('team-body').innerText.replace(/\\n+/g,' | ')");
  OUT.axHeadingsAll = (await ax(c)).filter((n) => n.role === "heading" || n.role === "status" || n.role === "dialog");

  // 说明：工位家具区没有 heading / list，读屏只能线性读
  OUT.decorSectionAria = await c.ev(`(() => {
    const body = document.getElementById('team-body');
    const sections = [...body.children].map((el) => ({ tag: el.tagName, cls: el.className, role: el.getAttribute('role'), label: el.getAttribute('aria-label'), heading: el.querySelector('h1,h2,h3,h4')?.textContent.trim() ?? null, text: el.textContent.replace(/\\s+/g,' ').trim().slice(0,40) }));
    return sections;
  })()`);

  // 最终面板截图（键盘操作后）
  const pr = await c.ev(`(() => { const r = document.querySelector('.team-panel').getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; })()`);
  await shot(c, "C-keyboard-after", pr);
  return "done";
}, { timeoutMs: 150_000 });

writeFileSync("playtest/r14-a11y-evidence-c.json", JSON.stringify(OUT, null, 2));
console.log(JSON.stringify(OUT, null, 2));