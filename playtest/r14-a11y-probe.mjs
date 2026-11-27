// r14 无障碍专项探针：工位 tab（8 家具 + 每日精力）+ canvas 装饰可见性
// 必须通过 lib/chrome.mjs 运行（保证 kill Chrome、清 user-data-dir）
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const URL = "http://127.0.0.1:5173/";
const OUT = { url: URL, at: new Date().toISOString() };
const SHOT_DIR = "playtest/r14-shots";
const shot = async (c, name, clip) => {
  const params = { format: "png" };
  if (clip) params.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: clip.scale ?? 2 };
  const r = await c.send("Page.captureScreenshot", params);
  writeFileSync(`${SHOT_DIR}/${name}.png`, Buffer.from(r.data, "base64"));
  return `${SHOT_DIR}/${name}.png`;
};
const rectOf = async (c, sel) =>
  c.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scrollH: el.scrollHeight, clientH: el.clientHeight }; })()`);

const clickSel = async (c, sel, { scroll = true } = {}) => {
  const box = await c.ev(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    if (${scroll}) el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  })()`);
  if (!box) return null;
  await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(260);
  return box;
};

/* ---------- 页面内注入的小工具（Node 里定义函数，toString 注入，避免转义地狱） ---------- */
function installHelpers() {
  const parseColor = (s) => {
    const m = String(s).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  };
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const effBg = (el) => {
    const stack = [];
    let e = el;
    while (e) {
      const c = parseColor(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0.999) stack.push(c), (e = null);
      else {
        if (c && c.a > 0.001) stack.push(c);
        e = e.parentElement;
      }
    }
    let bg = { r: 43, g: 43, b: 58, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) bg = blend(stack[i], bg);
    return bg;
  };
  const contrast = (fg, bg) => {
    const L1 = lum(fg);
    const L2 = lum(bg);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  };
  const c2 = (v) => Math.round(v * 100) / 100;
  const elInfo = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const fg = parseColor(cs.color);
    const bg = effBg(el);
    return {
      tag: el.tagName,
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100),
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      color: cs.color,
      bgColor: cs.backgroundColor,
      effBg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
      contrast: c2(contrast(fg, bg)),
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      disabled: el.disabled === true,
      ariaLabel: el.getAttribute("aria-label"),
      role: el.getAttribute("role"),
      ariaSelected: el.getAttribute("aria-selected"),
      ariaChecked: el.getAttribute("aria-checked"),
      ariaLive: el.getAttribute("aria-live"),
      tabIndex: el.tabIndex,
    };
  };
  window.__A11Y__ = { parseColor, lum, blend, effBg, contrast, c2, elInfo };
  return "helpers-ok";
}

function extractPanel() {
  const H = window.__A11Y__;
  const rows = [...document.querySelectorAll("#team-body .talent")].map((row, i) => {
    const name = row.querySelector(".talent-name");
    const desc = row.querySelector(".talent-desc");
    const dot = row.querySelector(".talent-dot");
    const btn = row.querySelector("button");
    return {
      i,
      name: name ? name.textContent.trim() : null,
      desc: desc ? desc.textContent.trim() : null,
      nameStyle: name ? { fs: getComputedStyle(name).fontSize, color: getComputedStyle(name).color } : null,
      descStyle: desc
        ? { fs: getComputedStyle(desc).fontSize, color: getComputedStyle(desc).color, contrast: H.c2(H.contrast(H.parseColor(getComputedStyle(desc).color), H.effBg(desc))) }
        : null,
      dot: dot
        ? {
            text: dot.textContent.trim(),
            fs: getComputedStyle(dot).fontSize,
            color: getComputedStyle(dot).color,
            bg: getComputedStyle(dot).backgroundColor,
            border: getComputedStyle(dot).borderColor,
            w: Math.round(dot.getBoundingClientRect().width),
            h: Math.round(dot.getBoundingClientRect().height),
            textContrast: H.c2(H.contrast(H.parseColor(getComputedStyle(dot).color), H.parseColor(getComputedStyle(dot).backgroundColor))),
          }
        : null,
      button: H.elInfo(btn),
      rowBg: getComputedStyle(row).backgroundColor,
    };
  });
  const summary = document.querySelector(".team-summary");
  const heads = [...document.querySelectorAll("#team-body .branch h3")].map((h) => h.textContent.replace(/\s+/g, " ").trim());
  const hint = document.querySelector("#team-body .team-hint");
  return {
    summaryText: summary ? summary.textContent.replace(/\s+/g, " ").trim() : null,
    summaryStyle: H.elInfo(summary),
    energyHeads: heads,
    energyHeadSmall: (() => {
      const s = document.querySelector("#team-body .branch h3 small");
      return s ? H.elInfo(s) : null;
    })(),
    hint: hint ? H.elInfo(hint) : null,
    rows,
  };
}

function extractGlobal() {
  const H = window.__A11Y__;
  const tabs = [...document.querySelectorAll(".team-tabs .tab")].map((b) => H.elInfo(b));
  const dialog = document.getElementById("team");
  const live = document.getElementById("sr-live");
  const toast = document.getElementById("dom-toast");
  const canvas = document.getElementById("stage");
  const active = document.activeElement;
  return {
    tabs,
    dialog: {
      ariaModal: dialog.getAttribute("aria-modal"),
      ariaLabelledby: dialog.getAttribute("aria-labelledby"),
      titleText: document.getElementById("team-title")?.textContent,
      role: dialog.getAttribute("role"),
    },
    liveRegion: live
      ? { role: live.getAttribute("role"), ariaLive: live.getAttribute("aria-live"), text: live.textContent, id: live.id }
      : null,
    toast: toast
      ? { text: toast.textContent, role: toast.getAttribute("role"), ariaLive: toast.getAttribute("aria-live"), cls: toast.className, opacity: getComputedStyle(toast).opacity }
      : null,
    canvas: canvas
      ? {
          role: canvas.getAttribute("role"),
          ariaLabel: canvas.getAttribute("aria-label"),
          tabIndex: canvas.tabIndex,
          ariaDescribedby: canvas.getAttribute("aria-describedby"),
          w: canvas.width,
          h: canvas.height,
        }
      : null,
    activeElement: {
      tag: active?.tagName,
      id: active?.id,
      cls: active?.className,
      text: (active?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
      insideDialog: !!(active && active.closest && active.closest("#team")),
      isBody: active === document.body,
    },
    focusablesInDialog: [...document.querySelectorAll('#team button, #team [tabindex]:not([tabindex="-1"])')].map((el) => ({
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
      ariaLabel: el.getAttribute("aria-label"),
      disabled: el.disabled === true,
      act: el.dataset ? el.dataset.act ?? null : null,
      id: el.id,
      rect: (() => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      })(),
    })),
    bodyScrollTop: document.getElementById("team-body")?.scrollTop,
  };
}

const axSnapshot = async (c) => {
  const ax = await c.send("Accessibility.getFullAXTree");
  const prop = (n, key) => {
    const p = (n.properties || []).find((x) => x.name === key);
    return p ? p.value?.value : undefined;
  };
  const nodes = ax.nodes
    .filter((n) => n.role && !n.ignored)
    .map((n) => ({
      id: n.nodeId,
      role: n.role.value,
      name: n.name?.value ?? "",
      disabled: prop(n, "disabled"),
      selected: prop(n, "selected"),
      modal: prop(n, "modal"),
      live: prop(n, "live"),
      level: prop(n, "level"),
    }));
  return nodes;
};

const findInAx = (nodes, needles) => {
  const hits = [];
  for (const n of nodes) {
    for (const needle of needles) {
      if (n.name.includes(needle)) hits.push({ role: n.role, name: n.name, needle });
    }
  }
  return hits;
};

await runChrome(
  async ({ port }) => {
    const c = await connect(port);
    await c.send("Page.enable");
    await c.send("Runtime.enable");
    await c.send("Accessibility.enable");
    await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });

    const goto = async () => {
      await c.send("Page.navigate", { url: URL });
      for (let i = 0; i < 120; i++) {
        const ok = await c.ev("!!window.__MOYU__ && !!document.getElementById('btn-team')");
        if (ok) break;
        await sleep(100);
      }
      await sleep(700);
      await c.ev(`(${installHelpers.toString()})()`);
    };

    // ---------- 0) 干净档 ----------
    await c.send("Page.navigate", { url: URL });
    for (let i = 0; i < 120; i++) {
      if (await c.ev("!!document.getElementById('btn-team')")) break;
      await sleep(100);
    }
    await c.ev("localStorage.clear(); 'ok'");
    await c.send("Page.reload");
    for (let i = 0; i < 120; i++) {
      if (await c.ev("!!window.__MOYU__ && !!document.getElementById('btn-team')")) break;
      await sleep(100);
    }
    await sleep(800);
    await c.ev(`(${installHelpers.toString()})()`);

    // 打开面板 → 工位 tab
    await clickSel(c, "#btn-team");
    OUT.focusAfterOpen = await c.ev(`(${(() => {
      const a = document.activeElement;
      return { tag: a?.tagName, id: a?.id, insideDialog: !!(a && a.closest && a.closest("#team")), text: (a?.textContent || "").trim().slice(0, 30) };
    }).toString()})()`);
    await clickSel(c, "#tab-decor");
    OUT.empty = { panel: await c.ev(`(${extractPanel.toString()})()`), global: await c.ev(`(${extractGlobal.toString()})()`) };

    // 空档截屏（0 摸鱼值，家具按钮全部 disabled）
    const panelRect = await rectOf(c, ".team-panel");
    OUT.shots = {};
    OUT.shots.empty = await shot(c, "decor-empty", panelRect);
    // 放大关键行（第一行 + 精力区），用于像素级检查
    const rowRect = await rectOf(c, "#team-body .talent");
    OUT.shots.emptyZoom = await shot(c, "decor-empty-zoom", { ...rowRect, height: rowRect.height * 6, scale: 3 });

    // AX 树（面板打开、工位 tab）
    OUT.axDialogOpen = await axSnapshot(c);
    OUT.axOpenButtons = OUT.axDialogOpen.filter((n) => n.role === "button");
    OUT.axOpenStatus = OUT.axDialogOpen.filter((n) => ["status", "alert", "dialog"].includes(n.role));

    // 键盘 tab 顺序（从第一个 tab 开始连按 6 次 Tab）
    await c.ev(`document.getElementById('team-close').focus(); 'ok'`);
    const tabStops = [];
    for (let i = 0; i < 8; i++) {
      await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
      await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
      await sleep(60);
      tabStops.push(await c.ev(`(() => { const a = document.activeElement; return { tag: a?.tagName, id: a?.id, cls: a?.className, text: (a?.textContent||'').replace(/\s+/g,' ').trim().slice(0,30), insideDialog: !!(a && a.closest && a.closest('#team')) }; })()`));
    }
    OUT.tabStops = tabStops;

    // ---------- 1) grant 后：按钮可用态 ----------
    await c.ev("__MOYU__.grant(1e11); 'ok'");
    await sleep(500);
    OUT.afterGrant = {
      panel: await c.ev(`(${extractPanel.toString()})()`),
      live: await c.ev("document.getElementById('sr-live').textContent"),
    };
    OUT.shots.enabled = await shot(c, "decor-enabled", await rectOf(c, ".team-panel"));

    // ---------- 2) 买 8 件家具：每次记录播报 / 焦点 / toast ----------
    OUT.buys = [];
    for (const id of ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"]) {
      const sel = `button[data-act="decor"][data-id="${id}"]`;
      const before = await c.ev(`(() => ({
        live: document.getElementById('sr-live').textContent,
        toast: document.getElementById('dom-toast')?.textContent ?? null,
        toastClass: document.getElementById('dom-toast')?.className ?? null,
        active: { tag: document.activeElement?.tagName, text: (document.activeElement?.textContent||'').trim().slice(0,20) },
        summary: document.querySelector('.team-summary')?.textContent.replace(/\s+/g,' ').trim(),
        rowCount: document.querySelectorAll('#team-body .talent').length,
        scrollTop: document.getElementById('team-body')?.scrollTop,
      }))()`);
      const box = await clickSel(c, sel);
      if (!box) {
        OUT.buys.push({ id, error: "button-not-found", before });
        continue;
      }
      const after = await c.ev(`(() => {
        const t = document.getElementById('dom-toast');
        const a = document.activeElement;
        return {
          live: document.getElementById('sr-live').textContent,
          toast: t ? t.textContent : null,
          toastClass: t ? t.className : null,
          toastRole: t ? t.getAttribute('role') : null,
          toastAriaLive: t ? t.getAttribute('aria-live') : null,
          toastVisible: t ? getComputedStyle(t).opacity : null,
          active: { tag: a?.tagName, id: a?.id, text: (a?.textContent||'').replace(/\s+/g,' ').trim().slice(0,25), isBody: a === document.body, insideDialog: !!(a && a.closest && a.closest('#team')) },
          summary: document.querySelector('.team-summary')?.textContent.replace(/\s+/g,' ').trim(),
          ownedDots: [...document.querySelectorAll('#team-body .talent-dot')].map(d => d.textContent.trim()),
          scrollTop: document.getElementById('team-body')?.scrollTop,
        };
      })()`);
      OUT.buys.push({ id, before, after });
      await sleep(120);
    }
    OUT.afterBuys = { panel: await c.ev(`(${extractPanel.toString()})()`), global: await c.ev(`(${extractGlobal.toString()})()`) };
    OUT.axAfterBuys = await axSnapshot(c);

    // 面板顶部/底部截图
    await c.ev("document.getElementById('team-body').scrollTop = 0; 'ok'");
    await sleep(200);
    OUT.shots.ownedTop = await shot(c, "decor-owned-top", await rectOf(c, ".team-panel"));
    await c.ev("document.getElementById('team-body').scrollTop = 1e6; 'ok'");
    await sleep(200);
    OUT.shots.ownedBottom = await shot(c, "decor-owned-bottom", await rectOf(c, ".team-panel"));
    const energyRect = await c.ev(`(() => { const b = document.querySelector('#team-body .branch'); if (!b) return null; const r = b.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; })()`);
    OUT.shots.energyZoom = await shot(c, "energy-before-zoom", { ...energyRect, scale: 3 });

    // ---------- 3) 使用精力（3 次）：播报 / 焦点 / 最终提示 ----------
    OUT.energy = [];
    for (const id of ["slack", "fake-work", "social"]) {
      const sel = `button[data-act="energy"][data-id="${id}"]`;
      const before = await c.ev(`(() => ({
        live: document.getElementById('sr-live').textContent,
        head: document.querySelector('#team-body .branch h3')?.textContent.replace(/\s+/g,' ').trim(),
        active: { tag: document.activeElement?.tagName, text: (document.activeElement?.textContent||'').trim().slice(0,20) },
      }))()`);
      const box = await clickSel(c, sel);
      const after = await c.ev(`(() => {
        const t = document.getElementById('dom-toast');
        const a = document.activeElement;
        return {
          live: document.getElementById('sr-live').textContent,
          toast: t ? t.textContent : null,
          toastClass: t ? t.className : null,
          toastVisible: t ? getComputedStyle(t).opacity : null,
          active: { tag: a?.tagName, id: a?.id, isBody: a === document.body, insideDialog: !!(a && a.closest && a.closest('#team')) },
          head: document.querySelector('#team-body .branch h3')?.textContent.replace(/\s+/g,' ').trim(),
          energyBtns: [...document.querySelectorAll('button[data-act="energy"]')].map(b => ({ id: b.dataset.id, disabled: b.disabled, text: b.textContent.trim() })),
          dots: [...document.querySelectorAll('#team-body .branch .talent-dot')].map(d => d.textContent.trim()),
        };
      })()`);
      OUT.energy.push({ id, clicked: !!box, before, after });
      await sleep(150);
    }
    OUT.afterEnergy = {
      panel: await c.ev(`(${extractPanel.toString()})()`),
      global: await c.ev(`(${extractGlobal.toString()})()`),
      bodyText: await c.ev("document.getElementById('team-body').innerText.replace(/\\s+/g,' ').trim()"),
    };
    OUT.axAfterEnergy = await axSnapshot(c);
    await c.ev("document.getElementById('team-body').scrollTop = 120; 'ok'");
    await sleep(200);
    OUT.shots.energyUsed = await shot(c, "energy-used", await rectOf(c, ".team-panel"));
    const energyRect2 = await c.ev(`(() => { const b = document.querySelector('#team-body .branch'); if (!b) return null; const r = b.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; })()`);
    OUT.shots.energyUsedZoom = await shot(c, "energy-used-zoom", { ...energyRect2, scale: 3 });

    // ---------- 4) 关闭面板：canvas 场景对读屏是否可见 ----------
    await clickSel(c, "#team-close");
    await sleep(400);
    OUT.afterClose = { global: await c.ev(`(${extractGlobal.toString()})()`) };
    OUT.axScene = await axSnapshot(c);
    OUT.axSceneDecorMentions = findInAx(OUT.axScene, ["绿萝", "台灯", "地毯", "冰箱", "按摩椅", "鱼缸", "投影", "猫窝", "装修", "家具", "工位"]);
    OUT.axSceneCanvas = OUT.axScene.filter((n) => n.name.includes("点击摸鱼") || n.role === "Canvas");
    OUT.shots.scene = await shot(c, "scene-with-all-decor");
    // 场景 DOM 里是否有家具文字（排除 canvas）
    OUT.sceneDomText = await c.ev("document.getElementById('stage-wrap').innerText");

    // ---------- 5) prefers-reduced-motion：canvas 动效是否停 ----------
    await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await sleep(500);
    OUT.shots.reducedMotion1 = await shot(c, "reduced-motion-frame1");
    await sleep(700);
    OUT.shots.reducedMotion2 = await shot(c, "reduced-motion-frame2");
    OUT.reducedMotionQuery = await c.ev("matchMedia('(prefers-reduced-motion: reduce)').matches");

    // ---------- 6) 播种存档：energy.left=20 → 触达「使用」禁用态 ----------
    await c.send("Emulation.setEmulatedMedia", { features: [] });
    await c.ev(`(() => {
      const d = new Date().toLocaleDateString('sv-SE');
      const blob = { v: 2, moyu: 0, totalEarned: 0, levels: {}, savedAt: Date.now(), createdAt: Date.now() - 86400000,
        collected: { quotes: [], flavors: [] }, daily: null, surviveStreak: 0, patrolSurvives: 0, cards: null,
        decor: [], energy: { date: d, left: 20, used: [], boosted: { idleMult: 1, patrolRewardMult: 1 } },
        totalClicks: 0, visits: { date: '', count: 0 }, lifetimeEarned: 0, prestige: 0, team: null, talents: null };
      localStorage.setItem('moyu-save', JSON.stringify(blob));
      return 'seeded';
    })()`);
    await c.send("Page.reload");
    for (let i = 0; i < 120; i++) {
      if (await c.ev("!!window.__MOYU__ && !!document.getElementById('btn-team')")) break;
      await sleep(100);
    }
    await sleep(800);
    await c.ev(`(${installHelpers.toString()})()`);
    await clickSel(c, "#btn-team");
    await clickSel(c, "#tab-decor");
    OUT.disabledEnergy = {
      panel: await c.ev(`(${extractPanel.toString()})()`),
      global: await c.ev(`(${extractGlobal.toString()})()`),
    };
    await sleep(200);
    OUT.shots.disabledEnergy = await shot(c, "energy-disabled", await rectOf(c, ".team-panel"));
    OUT.axDisabledEnergy = await axSnapshot(c);
    OUT.axDisabledButtons = OUT.axDisabledEnergy.filter((n) => n.role === "button");

    // 焦点丢失复测（禁用按钮 click 无效果，用「工位」tab 重新进入后点启用按钮）
    // 已足够：上面 buys/energy 已记录 activeElement。

    return "done";
  },
  { timeoutMs: 180_000 },
);

writeFileSync("playtest/r14-a11y-evidence.json", JSON.stringify(OUT, null, 2));
console.log("evidence written:", JSON.stringify({ buys: OUT.buys?.length, energy: OUT.energy?.length, shots: OUT.shots }, null, 2));