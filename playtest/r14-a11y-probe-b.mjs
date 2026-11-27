// r14 探针 B：禁用态（使用按钮）、键盘焦点环、canvas 动效可关性、toast 遮挡
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
  return `${DIR}/${name}.png`;
};
const rect = (c, sel) =>
  c.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);

const clickSel = async (c, sel) => {
  const b = await c.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`);
  if (!b) return false;
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await sleep(300);
  return true;
};

const key = async (c, k, code, vk) => {
  await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(80);
};

function installHelpers() {
  const parseColor = (s) => {
    const m = String(s).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const lum = (c) => {
    const f = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c.r / 255) + 0.7152 * f(c.g / 255) + 0.0722 * f(c.b / 255);
  };
  const contrast = (a, b) => {
    const L1 = lum(a), L2 = lum(b);
    return Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100;
  };
  window.__A11Y2__ = { parseColor, contrast };
  return "ok";
}

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
  // 播种：money 1e9（部分家具可买）、energy 剩 20（三项使用全禁用）
  await c.ev(`(() => {
    const d = new Date().toLocaleDateString('sv-SE');
    const now = Date.now();
    const blob = { v: 2, moyu: 1e9, totalEarned: 1e9, levels: {}, savedAt: now, createdAt: now - 86400000,
      collected: { quotes: [], flavors: [] }, daily: null, surviveStreak: 0, patrolSurvives: 0, cards: null,
      decor: [], energy: { date: d, left: 20, used: [], boosted: { idleMult: 1, patrolRewardMult: 1 } },
      totalClicks: 0, visits: { date: '', count: 0 }, lifetimeEarned: 1e9, prestige: 0,
      team: null, talents: null };
    localStorage.setItem('moyu-save', JSON.stringify(blob));
    return 'seeded';
  })()`);
  await c.send("Page.reload");
  for (let i = 0; i < 120; i++) {
    if (await c.ev("!!window.__MOYU__ && !!document.getElementById('btn-team')")) break;
    await sleep(100);
  }
  await sleep(1200);
  await c.ev(`(${installHelpers.toString()})()`);

  // 打开面板 → 工位，等足渲染
  await clickSel(c, "#btn-team");
  await sleep(700);
  await clickSel(c, "#tab-decor");
  await sleep(900);

  OUT.rows = await c.ev(`(() => {
    const H = window.__A11Y2__;
    return [...document.querySelectorAll('#team-body .talent')].map((row, i) => {
      const name = row.querySelector('.talent-name');
      const desc = row.querySelector('.talent-desc');
      const dot = row.querySelector('.talent-dot');
      const btn = row.querySelector('button');
      const cs = btn ? getComputedStyle(btn) : null;
      const fg = cs ? H.parseColor(cs.color) : null;
      const bg = cs ? H.parseColor(cs.backgroundColor) : null;
      const r = btn ? btn.getBoundingClientRect() : null;
      return {
        i, name: name?.textContent.trim(), desc: desc?.textContent.trim(),
        dot: dot ? { text: dot.textContent.trim(), bg: getComputedStyle(dot).backgroundColor, fs: getComputedStyle(dot).fontSize } : null,
        btn: btn ? { text: btn.textContent.trim(), disabled: btn.disabled, ariaLabel: btn.getAttribute('aria-label'),
          fs: cs.fontSize, color: cs.color, bg: cs.backgroundColor, contrast: H.contrast(fg, bg),
          w: Math.round(r.width), h: Math.round(r.height) } : null,
      };
    });
  })()`);
  OUT.heading = await c.ev("document.querySelector('#team-body .branch h3')?.textContent.replace(/\\s+/g,' ').trim()");
  OUT.headingSmall = await c.ev(`(() => { const s = document.querySelector('#team-body .branch h3 small'); if (!s) return null; const cs = getComputedStyle(s); const H = window.__A11Y2__; return { text: s.textContent, fs: cs.fontSize, color: cs.color, bg: getComputedStyle(s.parentElement.parentElement).backgroundColor, contrast: H.contrast(H.parseColor(cs.color), H.parseColor(getComputedStyle(s.parentElement.parentElement).backgroundColor)) }; })()`);
  OUT.summary = await c.ev("document.querySelector('.team-summary')?.textContent.replace(/\\s+/g,' ').trim()");
  OUT.panelRect = await rect(c, ".team-panel");
  OUT.shots = {};
  OUT.shots.disabled = await shot(c, "B-disabled-usage", OUT.panelRect);
  const energyRect = await rect(c, "#team-body .branch");
  OUT.shots.energyDisabledZoom = await shot(c, "B-energy-disabled-zoom", { ...energyRect, scale: 3 });
  // toast 与 tab 行是否重叠
  OUT.toastOverlap = await c.ev(`(() => {
    const t = document.getElementById('dom-toast');
    const tabs = document.querySelector('.team-tabs');
    const tr = t.getBoundingClientRect(), br = tabs.getBoundingClientRect();
    return { toastRect: {x:tr.x,y:tr.y,w:tr.width,h:tr.height}, tabsRect: {x:br.x,y:br.y,w:br.width,h:br.height},
      overlap: !(tr.right < br.left || tr.left > br.right || tr.bottom < br.top || tr.top > br.bottom),
      toastZ: getComputedStyle(t).zIndex, tabsZ: getComputedStyle(tabs).zIndex };
  })()`);

  // 键盘焦点环：从 team-close 起 Tab 到第一个启用按钮（家具价格按钮），量取 outline
  await c.ev("document.getElementById('team-close').focus(); 'ok'");
  const stops = [];
  for (let i = 0; i < 12; i++) {
    await key(c, "Tab", "Tab", 9);
    stops.push(await c.ev(`(() => { const a = document.activeElement; const cs = getComputedStyle(a);
      return { tag: a.tagName, text: (a.textContent||'').trim().slice(0,12), id: a.id, disabled: a.disabled === true,
        outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: cs.outlineColor,
        boxShadow: cs.boxShadow, insideDialog: !!(a.closest && a.closest('#team')) }; })()`));
  }
  OUT.tabStopsWithOutline = stops;
  const focusShots = [];
  // 找到第一个启用家具按钮并截图焦点环
  const firstEnabled = stops.findIndex((s) => s.tag === "BUTTON" && !s.disabled && s.text && s.insideDialog);
  OUT.firstEnabledFocus = firstEnabled >= 0 ? stops[firstEnabled] : null;
  if (firstEnabled >= 0) {
    // 重新聚焦到该元素：用 DOM 顺序定位
    await c.ev(`(() => {
      const btns = [...document.querySelectorAll('#team-body button[data-act="decor"]:not([disabled])')];
      if (btns[0]) btns[0].focus();
      return 'ok';
    })()`);
    await sleep(100);
    const fr = await rect(c, '#team-body button[data-act="decor"]:not([disabled])');
    if (fr) OUT.shots.focusRing = await shot(c, "B-focus-ring", { x: fr.x - 20, y: fr.y - 20, width: fr.width + 40, height: fr.height + 40, scale: 4 });
    focusShots.push(await c.ev(`(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { text: a.textContent.trim(), outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: cs.outlineColor, outlineOffset: cs.outlineOffset }; })()`));
  }
  OUT.focusRing = focusShots;

  // 键盘 Enter 购买：验证焦点丢失 + 播报
  const beforeEnter = await c.ev(`(() => ({ live: document.getElementById('sr-live').textContent, summary: document.querySelector('.team-summary')?.textContent.replace(/\\s+/g,' ').trim() }))()`);
  await key(c, "Enter", "Enter", 13);
  await sleep(600);
  OUT.keyboardBuy = {
    before: beforeEnter,
    after: await c.ev(`(() => { const a = document.activeElement; return { live: document.getElementById('sr-live').textContent,
      summary: document.querySelector('.team-summary')?.textContent.replace(/\\s+/g,' ').trim(),
      toast: document.getElementById('dom-toast')?.textContent,
      active: { tag: a?.tagName, isBody: a === document.body, insideDialog: !!(a && a.closest && a.closest('#team')) } }; })()`),
  };

  // 动效：rAF 是否在跑；两帧截图是否有差异（canvas 装饰动效）
  const f1 = await c.ev("__MOYU__.frames");
  const m1 = await c.ev("matchMedia('(prefers-reduced-motion: reduce)').matches");
  await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await sleep(600);
  const f2 = await c.ev("__MOYU__.frames");
  const m2 = await c.ev("matchMedia('(prefers-reduced-motion: reduce)').matches");
  OUT.motion = { framesBefore: f1, framesAfter: f2, framesDelta: f2 - f1, reducedBefore: m1, reducedAfter: m2 };
  OUT.shots.motionA = await shot(c, "B-motion-a");
  await sleep(700);
  OUT.shots.motionB = await shot(c, "B-motion-b");

  return "done";
}, { timeoutMs: 180_000 });

writeFileSync("playtest/r14-a11y-evidence-b.json", JSON.stringify(OUT, null, 2));
console.log(JSON.stringify(OUT, null, 2).slice(0, 6000));