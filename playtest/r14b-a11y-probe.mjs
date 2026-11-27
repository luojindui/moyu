// r14b 复验探针：HEAD 3580947 无障碍修复复验
// 重点：播报(含家具名/效果) / 焦点保持 / 按钮名称 / tab 语义 / 装修摘要 / 44px / 禁用态 / 用完播报时序 / 对比度(含 opacity)
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const URL = "http://127.0.0.1:5173/";
const OUT = { at: new Date().toISOString(), head: "3580947" };
const DIR = "playtest/r14b-shots";

const shot = async (c, name, clip) => {
  const params = { format: "png" };
  if (clip && (clip.width < 1 || clip.height < 1)) return "SKIP-zero-size";
  if (clip) params.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: clip.scale ?? 2 };
  const r = await c.send("Page.captureScreenshot", params);
  writeFileSync(`${DIR}/${name}.png`, Buffer.from(r.data, "base64"));
  return `${DIR}/${name}.png`;
};
const rect = (c, sel) =>
  c.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; })()`);
const clickSel = async (c, sel, opts = {}) => {
  const b = await c.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()`);
  if (!b) return { ok: false };
  await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: b.x, y: b.y });
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: b.x, y: b.y, button: "left", clickCount: 1 });
  if (opts.measurePress) await sleep(60);
  const duringPress = opts.measurePress ? await c.ev(`(() => { const a = document.activeElement; return { tag:a?.tagName, text:(a?.textContent||'').trim().slice(0,20), act:a?.dataset?.act ?? null, id:a?.dataset?.id ?? null, isBody: a===document.body }; })()`) : null;
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await sleep(280);
  return { ok: true, duringPress };
};
const key = async (c, key, code, vk, text) => {
  await c.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(text ? { text } : {}) });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(300);
};

function helpers() {
  const pc = (s) => {
    const m = String(s).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const lum = (c) => {
    const f = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c.r / 255) + 0.7152 * f(c.g / 255) + 0.0722 * f(c.b / 255);
  };
  const blend = (fg, bg, a) => ({ r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) });
  const contrast = (a, b) => {
    const L1 = lum(a), L2 = lum(b);
    return Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100;
  };
  const opacityOf = (el) => {
    let o = 1, e = el;
    while (e) {
      o *= parseFloat(getComputedStyle(e).opacity || "1");
      e = e.parentElement;
    }
    return o;
  };
  const bgOf = (el) => {
    let e = el;
    while (e) {
      const c = pc(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0.999) return c;
      e = e.parentElement;
    }
    return { r: 47, g: 47, b: 68 };
  };
  const textInfo = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const fg = pc(cs.color);
    const bg = bgOf(el);
    const op = opacityOf(el);
    const eff = blend(fg, bg, op);
    return {
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
      fs: cs.fontSize,
      color: cs.color,
      opacity: Math.round(op * 100) / 100,
      contrast: contrast(fg, bg),
      effectiveContrast: contrast(eff, bg),
    };
  };
  window.__A2__ = { pc, contrast, textInfo, opacityOf, bgOf };
  return "ok";
}

function extractDialog() {
 try {
  const H = window.__A2__;
  const btns = [...document.querySelectorAll("#team button")].map((b) => {
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    return {
      text: (b.textContent || "").trim().slice(0, 30),
      ariaLabel: b.getAttribute("aria-label"),
      role: b.getAttribute("role"),
      ariaSelected: b.getAttribute("aria-selected"),
      disabled: b.disabled === true,
      tabIndex: b.tabIndex,
      w: Math.round(r.width),
      h: Math.round(r.height),
      fs: cs.fontSize,
      minHeight: cs.minHeight,
    };
  });
  const rows = [...document.querySelectorAll("#team-body .talent")].map((row) => {
    const name = row.querySelector(".talent-name");
    const desc = row.querySelector(".talent-desc");
    const dot = row.querySelector(".talent-dot");
    const btn = row.querySelector("button");
    return {
      cls: row.className,
      dataAct: row.dataset.act,
      dataId: row.dataset.id,
      dataDisabled: row.dataset.disabled,
      rowH: Math.round(row.getBoundingClientRect().height),
      opacity: H.opacityOf(row),
      name: name?.textContent.trim(),
      nameInfo: H.textInfo(name),
      desc: desc?.textContent.trim(),
      descInfo: H.textInfo(desc),
      srOnly: [...row.querySelectorAll(".sr-only")].map((s) => s.textContent.trim()),
      dotAriaHidden: dot?.getAttribute("aria-hidden"),
      btn: btn
        ? {
            ariaLabel: btn.getAttribute("aria-label"),
            text: btn.textContent.trim(),
            disabled: btn.disabled,
            w: Math.round(btn.getBoundingClientRect().width),
            h: Math.round(btn.getBoundingClientRect().height),
          }
        : null,
    };
  });
  const heads = [...document.querySelectorAll("#team-body h3, .team-panel h3")].map((h) => H.textInfo(h));
  const tabs = [...document.querySelectorAll(".team-tabs .tab")].map((t) => ({
    text: t.textContent.trim(),
    role: t.getAttribute("role"),
    ariaSelected: t.getAttribute("aria-selected"),
    ariaControls: t.getAttribute("aria-controls"),
    h: Math.round(t.getBoundingClientRect().height),
    w: Math.round(t.getBoundingClientRect().width),
    fs: getComputedStyle(t).fontSize,
  }));
  const tablist = document.querySelector(".team-tabs");
  const live = document.getElementById("sr-live");
  const toast = document.getElementById("dom-toast");
  const summary = document.querySelector(".team-summary");
  const decorSummary = document.getElementById("decor-summary");
  const active = document.activeElement;
  return {
    btns,
    rows,
    heads,
    tabs,
    tablistRole: tablist?.getAttribute("role"),
    tablistLabel: tablist?.getAttribute("aria-label"),
    summary: H.textInfo(summary),
    decorSummary: decorSummary ? { text: decorSummary.textContent, cls: decorSummary.className } : null,
    live: { text: live.textContent, role: live.getAttribute("role"), ariaLive: live.getAttribute("aria-live") },
    toast: toast ? { text: toast.textContent, role: toast.getAttribute("role"), ariaLive: toast.getAttribute("aria-live"), cls: toast.className } : null,
    active: { tag: active?.tagName, text: (active?.textContent || "").trim().slice(0, 20), act: active?.dataset?.act ?? null, id: active?.dataset?.id ?? null, isBody: active === document.body, insideDialog: !!(active?.closest && active.closest("#team")) },
    stage: (() => {
      const s = document.getElementById("stage");
      return { ariaLabel: s.getAttribute("aria-label"), describedby: s.getAttribute("aria-describedby"), role: s.getAttribute("role") };
    })(),
    layout: {
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
      bodyScrollH: document.getElementById("team-body")?.scrollHeight,
      bodyClientH: document.getElementById("team-body")?.clientHeight,
      bodyScrollTop: document.getElementById("team-body")?.scrollTop,
    },
  };
 } catch (e) { return { __error: String(e && e.stack || e) }; }
}

const axDump = async (c) => {
  const t = await c.send("Accessibility.getFullAXTree");
  const prop = (n, k) => (n.properties || []).find((p) => p.name === k)?.value?.value;
  return t.nodes
    .filter((n) => n.role && !n.ignored)
    .map((n) => ({
      role: n.role.value,
      name: n.name?.value ?? "",
      description: n.description?.value ?? "",
      disabled: prop(n, "disabled"),
      selected: prop(n, "selected"),
      live: prop(n, "live"),
      level: prop(n, "level"),
    }));
};

await runChrome(
  async ({ port }) => {
    const c = await connect(port);
    await c.send("Page.enable");
    await c.send("Runtime.enable");
    await c.send("Accessibility.enable");
    await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });

    const waitApp = async () => {
      for (let i = 0; i < 120; i++) {
        if (await c.ev("!!window.__MOYU__ && !!document.getElementById('btn-team')")) return true;
        await sleep(100);
      }
      return false;
    };
    const gotoFresh = async (seed) => {
      await c.send("Page.navigate", { url: URL });
      await waitApp();
      await c.ev("localStorage.clear(); 'ok'");
      if (seed) await c.ev(seed);
      await c.send("Page.reload");
      await waitApp();
      await sleep(1000);
      const hk = await c.ev(`(${helpers.toString()})()`);
      if (!OUT.helperDebug) OUT.helperDebug = [];
      OUT.helperDebug.push({ hk, type: await c.ev("typeof window.__A2__") });
    };

    // ---------- A. 干净档：初始 AX / 摘要 / 打开焦点 ----------
    await gotoFresh(null);
    const opened = await clickSel(c, "#btn-team");
    await sleep(500);
    OUT.panelState = await c.ev(`(() => ({ hidden: document.getElementById('team').classList.contains('hidden'), btnTeamHidden: !!document.getElementById('team').className.match(/hidden/), active: { tag: document.activeElement?.tagName, id: document.activeElement?.id, role: document.activeElement?.getAttribute?.('role') } }))()`);
    console.log("panelState after open:", JSON.stringify(OUT.panelState), "clickOk:", opened.ok);
    if (OUT.panelState.hidden) { await clickSel(c, "#btn-team"); await sleep(600); OUT.panelState2 = await c.ev("document.getElementById('team').classList.contains('hidden')"); console.log("retry open -> hidden:", OUT.panelState2); }
    OUT.panelRectDbg = await rect(c, ".team-panel");
    console.log("panelRect:", JSON.stringify(OUT.panelRectDbg));
    const rawFD = await c.ev(extractDialog.toString());
    OUT.focusAfterOpenRaw = rawFD && rawFD.__err ? rawFD : "ok";
    OUT.focusAfterOpen = rawFD?.active;
    await clickSel(c, "#tab-decor");
    await sleep(400);
    OUT.tabState = await c.ev(`(() => ({ activeTab: document.querySelector('.team-tabs .tab.active')?.textContent, hidden: document.getElementById('team').classList.contains('hidden'), bodyRows: document.querySelectorAll('#team-body .talent').length }))()`);
    console.log("tabState:", JSON.stringify(OUT.tabState));
    const initRaw = await c.ev(extractDialog.toString());
    if (initRaw && initRaw.__error) { console.log("EXTRACT ERROR:", initRaw.__error.slice(0, 500)); OUT.extractError = initRaw.__error; }
    OUT.initial = initRaw;
    OUT.initialAx = await axDump(c);
    OUT.initialAxButtons = OUT.initialAx.filter((n) => n.role === "button" && (n.name.includes("使用") || n.name.includes("购买") || /^[\d.]+(万|亿)?$/.test(n.name)));
    OUT.initialAxTabs = OUT.initialAx.filter((n) => ["tab", "tablist"].includes(n.role));
    OUT.initialAxHeadings = OUT.initialAx.filter((n) => n.role === "heading");
    OUT.shots = {};
    OUT.shots.initialTop = await shot(c, "init-top", await rect(c, ".team-panel"));
    await c.ev("document.getElementById('team-body').scrollTop = 1e6; 'ok'");
    await sleep(200);
    OUT.shots.initialBottom = await shot(c, "init-bottom", await rect(c, ".team-panel"));
    await c.ev("document.getElementById('team-body').scrollTop = 0; 'ok'");

    // ---------- B. grant 后买家具（真实鼠标点击 + 焦点/播报/摘要） ----------
    await c.ev("__MOYU__.grant(1e11); 'ok'");
    await sleep(1500);
    OUT.beforeBuy = await c.ev(`(() => ({ live: document.getElementById('sr-live').textContent, decor: document.getElementById('decor-summary').textContent }))()`);
    OUT.buys = [];
    for (const id of ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"]) {
      const sel = `button[data-act="decor"][data-id="${id}"]`;
      const pre = await c.ev(`(() => { const a = document.activeElement; return { tag:a?.tagName, act:a?.dataset?.act ?? null, id:a?.dataset?.id ?? null, text:(a?.textContent||'').trim().slice(0,20) }; })()`);
      const r = await clickSel(c, sel, { measurePress: id === "plant" });
      const post = await c.ev(`(() => { const a = document.activeElement; const t = document.getElementById('dom-toast');
        return { live: document.getElementById('sr-live').textContent,
          decor: document.getElementById('decor-summary').textContent,
          summary: document.querySelector('.team-summary')?.textContent.replace(/\\s+/g,' ').trim(),
          toast: t ? t.textContent : null, toastCls: t ? t.className : null,
          active: { tag:a?.tagName, text:(a?.textContent||'').trim().slice(0,20), act:a?.dataset?.act ?? null, id:a?.dataset?.id ?? null, role:a?.getAttribute?.('role') ?? null, isBody:a===document.body, insideDialog:!!(a?.closest && a.closest('#team')) } }; })()`);
      OUT.buys.push({ id, pre, duringPress: r.duringPress, post });
      await sleep(180);
    }
    OUT.shots.ownedTop = await shot(c, "owned-top", await rect(c, ".team-panel"));
    await c.ev("document.getElementById('team-body').scrollTop = 1e6; 'ok'");
    await sleep(200);
    OUT.shots.ownedBottom = await shot(c, "owned-bottom", await rect(c, ".team-panel"));

    // ---------- C. 精力逐项使用 + 用完播报时序 ----------
    await c.ev("document.getElementById('team-body').scrollTop = 0; 'ok'");
    await sleep(150);
    OUT.energy = [];
    for (const [idx, id] of ["slack", "fake-work", "social"].entries()) {
      const sel = `button[data-act="energy"][data-id="${id}"]`;
      const r = await clickSel(c, sel, { measurePress: idx === 0 });
      const post = await c.ev(`(() => { const a = document.activeElement; const t = document.getElementById('dom-toast');
        return { live: document.getElementById('sr-live').textContent, head: document.querySelector('#team-body .branch h3')?.textContent.replace(/\\s+/g,' ').trim(),
          toast: t ? t.textContent : null, active: { tag:a?.tagName, text:(a?.textContent||'').trim().slice(0,20), act:a?.dataset?.act ?? null, id:a?.dataset?.id ?? null, isBody:a===document.body, insideDialog:!!(a?.closest && a.closest('#team')) } }; })()`);
      OUT.energy.push({ id, duringPress: r.duringPress, post });
      await sleep(150);
      // 用完时序采样（第 3 项后）
      if (idx === 2) {
        const samples = [];
        const t0 = Date.now();
        for (const ms of [120, 350, 430, 520, 700, 1100]) {
          const wait = ms - (Date.now() - t0);
          if (wait > 0) await sleep(wait);
          samples.push({ ms, at: Date.now() - t0, live: await c.ev("document.getElementById('sr-live').textContent") });
        }
        OUT.energyUsedUpSamples = samples;
      }
    }
    OUT.afterEnergy = await c.ev(extractDialog.toString());
    OUT.afterEnergyAx = await axDump(c);
    OUT.shots.energyUsed = await shot(c, "energy-used", await rect(c, ".team-panel"));

    // ---------- D. 关闭面板：canvas 摘要 / AX 描述 ----------
    await clickSel(c, "#team-close");
    await sleep(400);
    OUT.afterClose = await c.ev(`(() => { const s = document.getElementById('stage'); const a = document.activeElement; const d = document.getElementById('decor-summary');
      return { decorSummary: d.textContent, canvas: { role:s.getAttribute('role'), label:s.getAttribute('aria-label'), describedby:s.getAttribute('aria-describedby') },
        active: { tag:a?.tagName, id:a?.id, isBody:a===document.body, insideDialog:!!(a?.closest && a.closest('#team')) } }; })()`);
    OUT.sceneAx = await axDump(c);
    OUT.sceneCanvasAx = OUT.sceneAx.filter((n) => n.name.includes("点击摸鱼"));
    OUT.shots.scene = await shot(c, "scene-all-decor");

    // ---------- E. 播种 energy=100 → 一键全用路径 ----------
    await gotoFresh(`(() => {
      const d = new Date().toLocaleDateString('sv-SE'); const now = Date.now();
      localStorage.setItem('moyu-save', JSON.stringify({ v:2, moyu:1e9, totalEarned:1e9, levels:{}, savedAt:now, createdAt:now-86400000,
        collected:{quotes:[],flavors:[]}, daily:null, surviveStreak:0, patrolSurvives:0, cards:null, decor:[],
        energy:{date:d,left:100,used:[],boosted:{idleMult:1,patrolRewardMult:1}}, totalClicks:0, visits:{date:'',count:0},
        lifetimeEarned:1e9, prestige:0, team:null, talents:null }));
      return 'seeded'; })()`);
    await clickSel(c, "#btn-team");
    await sleep(400);
    await clickSel(c, "#tab-decor");
    await sleep(400);
    OUT.energyAll = { before: await c.ev(`(() => ({ label: document.querySelector('button[data-act="energy-all"]')?.textContent.trim(), disabled: document.querySelector('button[data-act="energy-all"]')?.disabled, live: document.getElementById('sr-live').textContent }))()`) };
    const allBox = await clickSel(c, 'button[data-act="energy-all"]');
    const allSamples = [];
    const t0 = Date.now();
    for (const ms of [150, 500, 800, 1300]) {
      const wait = ms - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
      allSamples.push({ ms, live: await c.ev("document.getElementById('sr-live').textContent") });
    }
    OUT.energyAll.after = {
      clicked: allBox.ok,
      samples: allSamples,
      state: await c.ev(`(() => { const a = document.activeElement; const t = document.getElementById('dom-toast');
        return { head: document.querySelector('#team-body .branch h3')?.textContent.replace(/\\s+/g,' ').trim(),
          toast: t ? t.textContent : null,
          active: { tag:a?.tagName, text:(a?.textContent||'').trim().slice(0,20), act:a?.dataset?.act ?? null, isBody:a===document.body, insideDialog:!!(a?.closest && a.closest('#team')) },
          buttonsLeft: [...document.querySelectorAll('#team-body .branch button')].map(b => ({ text:b.textContent.trim(), disabled:b.disabled })) }; })()`),
    };
    OUT.energyAllAx = (await axDump(c)).filter((n) => n.role === "button" && (n.name.includes("一键") || n.name.includes("使用")));
    await c.ev("document.getElementById('team-body').scrollTop = 0; 'ok'");
    await sleep(150);
    OUT.shots.energyAll = await shot(c, "energy-all", await rect(c, ".team-panel"));

    // ---------- F. 焦点陷阱 / Tab 顺序（Tab 到面板外） ----------
    await c.ev("document.getElementById('team-close').focus(); 'ok'");
    const stops = [];
    for (let i = 0; i < 14; i++) {
      await key(c, "Tab", "Tab", 9);
      stops.push(await c.ev(`(() => { const a = document.activeElement; return { tag:a?.tagName, text:(a?.textContent||'').trim().slice(0,16), id:a?.id, role:a?.getAttribute('role'), isBody:a===document.body, insideDialog:!!(a?.closest && a.closest('#team')) }; })()`));
    }
    OUT.tabStops = stops;

    // ---------- G. 键盘 Enter 购买（focus 保持） ----------
    await clickSel(c, "#tab-decor");
    await sleep(400);
    // 先确保有可买项：用 grant
    await c.ev("__MOYU__.grant(1e11); 'ok'");
    await sleep(900);
    const kf = await c.ev(`(() => { const b = document.querySelector('#team-body button[data-act="decor"]'); if (!b) return null; b.scrollIntoView({block:'center'}); b.focus();
      const a = document.activeElement; return { text:a.textContent.trim(), act:a.dataset.act, id:a.dataset.id, focused: a===b, live: document.getElementById('sr-live').textContent }; })()`);
    await key(c, "Enter", "Enter", 13, "\r");
    const ka = await c.ev(`(() => { const a = document.activeElement; return { live: document.getElementById('sr-live').textContent,
      decor: document.getElementById('decor-summary').textContent,
      active: { tag:a?.tagName, text:(a?.textContent||'').trim().slice(0,20), act:a?.dataset?.act ?? null, id:a?.dataset?.id ?? null, role:a?.getAttribute?.('role') ?? null, isBody:a===document.body, insideDialog:!!(a?.closest && a.closest('#team')) } }; })()`);
    OUT.keyboardBuy = { focused: kf, after: ka };

    // ---------- H. toast 与 tab 行重叠（未修项复测） ----------
    OUT.toastOverlap = await c.ev(`(() => {
      const t = document.getElementById('dom-toast'); const tabs = document.querySelector('.team-tabs');
      const tr = t.getBoundingClientRect(), br = tabs.getBoundingClientRect();
      return { toastRect:{x:Math.round(tr.x),y:Math.round(tr.y),w:Math.round(tr.width),h:Math.round(tr.height)},
        tabsRect:{x:Math.round(br.x),y:Math.round(br.y),w:Math.round(br.width),h:Math.round(br.height)},
        overlap: !(tr.right<br.left||tr.left>br.right||tr.bottom<br.top||tr.top>br.bottom),
        toastZ:getComputedStyle(t).zIndex, toastCls:t.className };
    })()`);

    // ---------- I. 375x667 小屏溢出/布局 ----------
    await c.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 667, deviceScaleFactor: 2, mobile: false });
    await sleep(500);
    OUT.smallScreen = await c.ev(`(() => ({
      docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
      panel: (() => { const r=document.querySelector('.team-panel').getBoundingClientRect(); return {x:Math.round(r.x),w:Math.round(r.width),h:Math.round(r.height)}; })(),
      bodyScrollH: document.getElementById('team-body').scrollHeight, bodyClientH: document.getElementById('team-body').clientHeight,
      clippedButtons: [...document.querySelectorAll('#team-body button')].filter(b => { const r=b.getBoundingClientRect(); const p=document.querySelector('.team-panel').getBoundingClientRect(); return r.right > p.right || r.left < p.left; }).length,
    }))()`);
    await c.ev("document.getElementById('team-body').scrollTop = 0; 'ok'");
    await sleep(150);
    OUT.shots.small = await shot(c, "small-375x667", await rect(c, ".team-panel"));

    // ---------- J. reduced-motion 生效确认 ----------
    await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await sleep(300);
    OUT.reducedMotion = await c.ev("matchMedia('(prefers-reduced-motion: reduce)').matches");
    OUT.shots.reduced = await shot(c, "reduced-motion");

    return "done";
  },
  { timeoutMs: 240_000 },
);

writeFileSync("playtest/r14b-a11y-evidence.json", JSON.stringify(OUT, null, 2));
console.log("WROTE playtest/r14b-a11y-evidence.json");
console.log("buys:", OUT.buys?.length, "energy:", OUT.energy?.length);
console.log("usedUpSamples:", JSON.stringify(OUT.energyUsedUpSamples));
console.log("energyAll:", JSON.stringify(OUT.energyAll));
console.log("keyboardBuy:", JSON.stringify(OUT.keyboardBuy));