// r14b 复验探针 v2：HEAD 3580947 无障碍修复复验（自包含提取函数，避免 HMR 重载丢全局）
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const URL = "http://127.0.0.1:5173/";
const OUT = { at: new Date().toISOString(), head: "3580947" };
const DIR = "playtest/r14b-shots";
const log = (...a) => console.log("[probe]", ...a);

const shot = async (c, name, clip) => {
  if (clip && (clip.width < 1 || clip.height < 1)) return "SKIP-zero-size";
  const params = { format: "png" };
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
  const duringPress = opts.measurePress ? await c.ev(`(() => { const a = document.activeElement; return { tag:a?.tagName, text:(a?.textContent||'').trim().slice(0,20), act:a?.dataset?.act ?? null, id:a?.dataset?.id ?? null, isBody:a===document.body }; })()`) : null;
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await sleep(opts.wait ?? 300);
  return { ok: true, duringPress };
};
const key = async (c, key, code, vk, text, wait = 350) => {
  await c.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(text ? { text } : {}) });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(wait);
};

/* ============ 自包含提取：不依赖任何注入全局 ============ */
function extractDialog() {
  try {
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
      while (e) { o *= parseFloat(getComputedStyle(e).opacity || "1"); e = e.parentElement; }
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
      return {
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90),
        fs: cs.fontSize, color: cs.color, opacity: Math.round(op * 100) / 100,
        contrast: contrast(fg, bg), effectiveContrast: contrast(blend(fg, bg, op), bg),
      };
    };
    const btns = [...document.querySelectorAll("#team button")].map((b) => {
      const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      return {
        text: (b.textContent || "").trim().slice(0, 34),
        ariaLabel: b.getAttribute("aria-label"),
        role: b.getAttribute("role"), ariaSelected: b.getAttribute("aria-selected"),
        disabled: b.disabled === true, tabIndex: b.tabIndex,
        w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
        fs: cs.fontSize, minHeight: cs.minHeight,
      };
    });
    const rows = [...document.querySelectorAll("#team-body .talent")].map((row) => {
      const name = row.querySelector(".talent-name");
      const desc = row.querySelector(".talent-desc");
      const dot = row.querySelector(".talent-dot");
      const btn = row.querySelector("button");
      const r = row.getBoundingClientRect();
      return {
        cls: row.className, dataAct: row.dataset.act, dataId: row.dataset.id, dataDisabled: row.dataset.disabled,
        rowH: Math.round(r.height), opacity: Math.round(opacityOf(row) * 100) / 100,
        name: name?.textContent.trim(), nameInfo: textInfo(name),
        desc: desc?.textContent.trim(), descInfo: textInfo(desc),
        srOnly: [...row.querySelectorAll(".sr-only")].map((s) => s.textContent.trim()),
        dotAriaHidden: dot?.getAttribute("aria-hidden"),
        btn: btn ? {
          ariaLabel: btn.getAttribute("aria-label"), text: btn.textContent.trim(), disabled: btn.disabled,
          w: Math.round(btn.getBoundingClientRect().width), h: Math.round(btn.getBoundingClientRect().height),
        } : null,
      };
    });
    const heads = [...document.querySelectorAll("#team-body h3")].map((h) => textInfo(h));
    const tabs = [...document.querySelectorAll(".team-tabs .tab")].map((t) => ({
      text: t.textContent.trim(), role: t.getAttribute("role"), ariaSelected: t.getAttribute("aria-selected"),
      ariaControls: t.getAttribute("aria-controls"),
      h: Math.round(t.getBoundingClientRect().height), w: Math.round(t.getBoundingClientRect().width), fs: getComputedStyle(t).fontSize,
    }));
    const tablist = document.querySelector(".team-tabs");
    const live = document.getElementById("sr-live");
    const toast = document.getElementById("dom-toast");
    const decorSummary = document.getElementById("decor-summary");
    const stage = document.getElementById("stage");
    const active = document.activeElement;
    return {
      btns, rows, heads, tabs,
      tablistRole: tablist?.getAttribute("role"), tablistLabel: tablist?.getAttribute("aria-label"),
      summary: textInfo(document.querySelector(".team-summary")),
      decorSummary: decorSummary ? { text: decorSummary.textContent, cls: decorSummary.className } : null,
      live: live ? { text: live.textContent, role: live.getAttribute("role"), ariaLive: live.getAttribute("aria-live") } : null,
      toast: toast ? { text: toast.textContent, role: toast.getAttribute("role"), ariaLive: toast.getAttribute("aria-live"), cls: toast.className } : null,
      active: {
        tag: active?.tagName, text: (active?.textContent || "").trim().slice(0, 24),
        act: active?.dataset?.act ?? null, id: active?.dataset?.id ?? null,
        role: active?.getAttribute?.("role") ?? null,
        isBody: active === document.body, insideDialog: !!(active?.closest && active.closest("#team")),
      },
      stage: stage ? { ariaLabel: stage.getAttribute("aria-label"), describedby: stage.getAttribute("aria-describedby"), role: stage.getAttribute("role") } : null,
      hidden: document.getElementById("team")?.classList.contains("hidden"),
      layout: {
        docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
        bodyScrollH: document.getElementById("team-body")?.scrollHeight,
        bodyClientH: document.getElementById("team-body")?.clientHeight,
        bodyScrollTop: document.getElementById("team-body")?.scrollTop,
      },
    };
  } catch (e) { return { __error: String((e && e.stack) || e) }; }
}

const axDump = async (c) => {
  const t = await c.send("Accessibility.getFullAXTree");
  const prop = (n, k) => (n.properties || []).find((p) => p.name === k)?.value?.value;
  return t.nodes.filter((n) => n.role && !n.ignored).map((n) => ({
    role: n.role.value, name: n.name?.value ?? "", description: n.description?.value ?? "",
    disabled: prop(n, "disabled"), selected: prop(n, "selected"), live: prop(n, "live"), level: prop(n, "level"),
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
      for (let i = 0; i < 150; i++) {
        const ok = await c.ev("!!window.__MOYU__ && !!document.getElementById('btn-team')");
        if (ok) { await sleep(400); return true; }
        await sleep(100);
      }
      return false;
    };
    const fresh = async (seed) => {
      await c.send("Page.navigate", { url: "about:blank" });
      await sleep(150);
      await c.send("Page.navigate", { url: URL });
      await waitApp();
      await c.ev("localStorage.clear(); 'ok'");
      if (seed) await c.ev(seed);
      await c.send("Page.reload");
      await waitApp();
      await sleep(900);
    };
    const openPanel = async () => {
      for (let i = 0; i < 3; i++) {
        const hidden = await c.ev("document.getElementById('team').classList.contains('hidden')");
        if (!hidden) return true;
        await clickSel(c, "#btn-team", { wait: 500 });
      }
      return !(await c.ev("document.getElementById('team').classList.contains('hidden')"));
    };
    const openDecor = async () => {
      await openPanel();
      await clickSel(c, "#tab-decor", { wait: 450 });
      return await c.ev("document.querySelector('.team-tabs .tab.active')?.textContent");
    };
    const ex = async () => {
      const r = await c.ev(`(${extractDialog.toString()})()`);
      if (r && r.__error) log("EXTRACT ERROR:", r.__error.slice(0, 300));
      return r;
    };

    // ================= A. 干净档 =================
    await fresh(null);
    OUT.phaseA = {};
    await openPanel();
    await sleep(450);
    OUT.phaseA.focusAfterOpen = await c.ev(`(() => { const a = document.activeElement; return { tag:a?.tagName, id:a?.id, role:a?.getAttribute?.('role'), text:(a?.textContent||'').trim().slice(0,10), insideDialog:!!(a?.closest && a.closest('#team')) }; })()`);
    OUT.phaseA.tabForced = await openDecor();
    OUT.phaseA.dialog = await ex();
    OUT.phaseA.ax = await axDump(c);
    OUT.phaseA.axButtons = OUT.phaseA.ax.filter((n) => n.role === "button" && (n.name.includes("使用") || n.name.includes("购买") || n.name.includes("一键")));
    OUT.phaseA.axTabs = OUT.phaseA.ax.filter((n) => ["tab", "tablist"].includes(n.role));
    OUT.phaseA.axHeadings = OUT.phaseA.ax.filter((n) => n.role === "heading");
    OUT.shots = {};
    OUT.shots.initialTop = await shot(c, "init-top", await rect(c, ".team-panel"));
    await c.ev("document.getElementById('team-body').scrollTop = 1e6; 'ok'");
    await sleep(200);
    OUT.shots.initialBottom = await shot(c, "init-bottom", await rect(c, ".team-panel"));
    log("A done; rows:", OUT.phaseA.dialog?.rows?.length, "error:", OUT.phaseA.dialog?.__error ? "yes" : "no");

    // ================= B. grant → 鼠标买 8 件 =================
    await c.ev("__MOYU__.grant(1e11); 'ok'");
    await sleep(1500);
    OUT.phaseB = { before: await c.ev("(() => ({ live: document.getElementById('sr-live').textContent, decor: document.getElementById('decor-summary').textContent }))()"), buys: [] };
    for (const id of ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"]) {
      const r = await clickSel(c, `[data-act="decor"][data-id="${id}"]`, { measurePress: id === "plant", wait: 320 });
      const post = await c.ev(`(() => { const a = document.activeElement; const t = document.getElementById('dom-toast');
        return { live: document.getElementById('sr-live').textContent,
          decor: document.getElementById('decor-summary').textContent,
          summary: document.querySelector('.team-summary')?.textContent.replace(/\\s+/g,' ').trim(),
          toast: t ? t.textContent : null,
          active: { tag:a?.tagName, text:(a?.textContent||'').trim().slice(0,24), act:a?.dataset?.act ?? null, id:a?.dataset?.id ?? null, role:a?.getAttribute?.('role') ?? null, isBody:a===document.body, insideDialog:!!(a?.closest && a.closest('#team')) } }; })()`);
      OUT.phaseB.buys.push({ id, duringPress: r.duringPress, post });
      await sleep(150);
    }
    // 播报 700ms 后是否仍保持（不被系统播报覆盖）
    OUT.phaseB.liveAfter700 = await (async () => { await sleep(700); return c.ev("document.getElementById('sr-live').textContent"); })();
    OUT.shots.ownedTop = await shot(c, "owned-top", await rect(c, ".team-panel"));
    await c.ev("document.getElementById('team-body').scrollTop = 1e6; 'ok'");
    await sleep(200);
    OUT.shots.ownedBottom = await shot(c, "owned-bottom", await rect(c, ".team-panel"));
    log("B done; buys:", OUT.phaseB.buys.length, "last live:", OUT.live_?.slice?.(0, 5));

    // ================= C. 精力逐项 + 用完时序 =================
    await c.ev("document.getElementById('team-body').scrollTop = 0; 'ok'");
    await sleep(150);
    OUT.phaseC = { uses: [] };
    for (const [idx, id] of ["slack", "fake-work", "social"].entries()) {
      const r = await clickSel(c, `[data-act="energy"][data-id="${id}"]`, { measurePress: idx === 0, wait: 320 });
      const post = await c.ev(`(() => { const a = document.activeElement; const t = document.getElementById('dom-toast');
        return { live: document.getElementById('sr-live').textContent,
          head: document.querySelector('#team-body .branch h3')?.textContent.replace(/\\s+/g,' ').trim(),
          toast: t ? t.textContent : null,
          active: { tag:a?.tagName, text:(a?.textContent||'').trim().slice(0,24), act:a?.dataset?.act ?? null, isBody:a===document.body, insideDialog:!!(a?.closest && a.closest('#team')) } }; })()`);
      OUT.phaseC.uses.push({ id, duringPress: r.duringPress, post });
      if (idx === 2) {
        const samples = [];
        const t0 = Date.now();
        for (const ms of [120, 350, 430, 520, 700, 1100]) {
          const wait = ms - (Date.now() - t0);
          if (wait > 0) await sleep(wait);
          samples.push({ ms, at: Date.now() - t0, live: await c.ev("document.getElementById('sr-live').textContent") });
        }
        OUT.phaseC.usedUpSamples = samples;
      } else await sleep(120);
    }
    OUT.phaseC.dialog = await ex();
    OUT.phaseC.ax = await axDump(c);
    OUT.shots.energyUsed = await shot(c, "energy-used", await rect(c, ".team-panel"));
    log("C done; usedUpSamples:", JSON.stringify(OUT.phaseC.usedUpSamples?.map((s) => s.live)));

    // ================= D. 关面板 → 场景摘要/AX =================
    await clickSel(c, "#team-close", { wait: 400 });
    OUT.phaseD = await c.ev(`(() => { const s = document.getElementById('stage'); const d = document.getElementById('decor-summary'); const a = document.activeElement;
      return { decorSummary: d.textContent, decorCls: d.className,
        canvas: { role:s.getAttribute('role'), label:s.getAttribute('aria-label'), describedby:s.getAttribute('aria-describedby') },
        active: { tag:a?.tagName, id:a?.id, isBody:a===document.body, insideDialog:!!(a?.closest && a.closest('#team')) } }; })()`);
    OUT.phaseD.ax = await axDump(c);
    OUT.phaseD.canvasAx = OUT.phaseD.ax.filter((n) => n.name.includes("点击摸鱼"));
    OUT.shots.scene = await shot(c, "scene-all-decor");
    log("D done; decorSummary len:", OUT.phaseD.decorSummary?.length);

    // ================= E. 播种：money 1e9 + energy 100 + decor 空 → 一键全用 & 键盘购买 =================
    await fresh(`(() => {
      const d = new Date().toLocaleDateString('sv-SE'); const now = Date.now();
      localStorage.setItem('moyu-save', JSON.stringify({ v:2, moyu:1e9, totalEarned:1e9, levels:{}, savedAt:now, createdAt:now-86400000,
        collected:{quotes:[],flavors:[]}, daily:null, surviveStreak:0, patrolSurvives:0, cards:null, decor:[],
        energy:{date:d,left:100,used:[],boosted:{idleMult:1,patrolRewardMult:1}}, totalClicks:0, visits:{date:'',count:0},
        lifetimeEarned:1e9, prestige:0, team:null, talents:null }));
      return 'seeded'; })()`);
    OUT.phaseE = {};
    OUT.phaseE.tab = await openDecor();
    OUT.phaseE.dialog = await ex();
    OUT.phaseE.energyAllBefore = await c.ev(`(() => { const b = document.querySelector('button[data-act="energy-all"]'); return b ? { text:b.textContent.trim(), disabled:b.disabled, h:Math.round(b.getBoundingClientRect().height) } : null; })()`);
    // 键盘：聚焦第一个可买家具有 → Enter → 焦点/播报/摘要
    const kf = await c.ev(`(() => { const b = document.querySelector('#team-body button[data-act="decor"]:not([disabled])'); if (!b) return null; b.scrollIntoView({block:'center'}); b.focus();
      const a = document.activeElement; return { text:a.textContent.trim(), act:a.dataset.act, id:a.dataset.id, focused:a===b, live:document.getElementById('sr-live').textContent }; })()`);
    await key(c, "Enter", "Enter", 13, "\r");
    OUT.phaseE.keyboardBuy = { focused: kf, after: await c.ev(`(() => { const a = document.activeElement; return { live: document.getElementById('sr-live').textContent, decor: document.getElementById('decor-summary').textContent,
      active: { tag:a?.tagName, text:(a?.textContent||'').trim().slice(0,24), act:a?.dataset?.act ?? null, id:a?.dataset?.id ?? null, role:a?.getAttribute?.('role') ?? null, isBody:a===document.body, insideDialog:!!(a?.closest && a.closest('#team')) } }; })()`) };
    log("E keyboardBuy:", JSON.stringify(OUT.phaseE.keyboardBuy.after.active));
    // 一键全用
    const allBox = await clickSel(c, 'button[data-act="energy-all"]', { measurePress: true, wait: 200 });
    const allSamples = [];
    const t0 = Date.now();
    for (const ms of [120, 400, 650, 900, 1200]) {
      const wait = ms - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
      allSamples.push({ ms, live: await c.ev("document.getElementById('sr-live').textContent") });
    }
    OUT.phaseE.energyAll = {
      clicked: allBox.ok, duringPress: allBox.duringPress, samples: allSamples,
      state: await c.ev(`(() => { const a = document.activeElement; const t = document.getElementById('dom-toast');
        return { head: document.querySelector('#team-body .branch h3')?.textContent.replace(/\\s+/g,' ').trim(),
          toast: t ? t.textContent : null,
          active: { tag:a?.tagName, text:(a?.textContent||'').trim().slice(0,24), act:a?.dataset?.act ?? null, isBody:a===document.body, insideDialog:!!(a?.closest && a.closest('#team')) },
          buttons: [...document.querySelectorAll('#team-body .branch button')].map(b=>({ text:b.textContent.trim(), disabled:b.disabled })) }; })()`),
    };
    OUT.phaseE.ax = await axDump(c);
    OUT.phaseE.axEnergy = OUT.phaseE.ax.filter((n) => n.role === "button" && (n.name.includes("一键") || n.name.includes("使用")));
    OUT.phaseE.dialogAfter = await ex();
    await c.ev("document.getElementById('team-body').scrollTop = 0; 'ok'");
    await sleep(150);
    OUT.shots.energyAll = await shot(c, "energy-all-after", await rect(c, ".team-panel"));
    log("E done; energyAll samples:", JSON.stringify(allSamples.map((s) => s.live)));

    // ================= F. Tab 顺序 / 焦点陷阱 =================
    await c.ev("document.getElementById('team-close').focus(); 'ok'");
    const stops = [];
    for (let i = 0; i < 16; i++) {
      await key(c, "Tab", "Tab", 9, null, 90);
      stops.push(await c.ev(`(() => { const a = document.activeElement; return { tag:a?.tagName, text:(a?.textContent||'').trim().slice(0,16), id:a?.id, role:a?.getAttribute?.('role'), isBody:a===document.body, insideDialog:!!(a?.closest && a.closest('#team')) }; })()`));
    }
    OUT.phaseF = { stops };
    log("F done; escaped at:", stops.findIndex((s) => !s.insideDialog && !s.isBody));

    // ================= G. toast 重叠 / 小屏 / reduced-motion =================
    OUT.phaseG = {};
    OUT.phaseG.toastOverlap = await c.ev(`(() => { const t = document.getElementById('dom-toast'); const tabs = document.querySelector('.team-tabs');
      const tr = t.getBoundingClientRect(), br = tabs.getBoundingClientRect();
      return { toastRect:{x:Math.round(tr.x),y:Math.round(tr.y),w:Math.round(tr.width),h:Math.round(tr.height)},
        tabsRect:{x:Math.round(br.x),y:Math.round(br.y),w:Math.round(br.width),h:Math.round(br.height)},
        overlap: !(tr.right<br.left||tr.left>br.right||tr.bottom<br.top||tr.top>br.bottom), z:getComputedStyle(t).zIndex }; })()`);
    await c.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 667, deviceScaleFactor: 2, mobile: false });
    await sleep(500);
    OUT.phaseG.small = await c.ev(`(() => { const p = document.querySelector('.team-panel').getBoundingClientRect();
      return { docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
        panel:{x:Math.round(p.x),w:Math.round(p.width),h:Math.round(p.height)},
        bodyScrollH: document.getElementById('team-body').scrollHeight, bodyClientH: document.getElementById('team-body').clientHeight,
        clipped: [...document.querySelectorAll('#team-body button')].filter(b=>{const r=b.getBoundingClientRect(); return r.right>p.right+1||r.left<p.left-1;}).length }; })()`);
    OUT.shots.small = await shot(c, "small-375", await rect(c, ".team-panel"));
    await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await sleep(300);
    OUT.phaseG.reducedMotion = await c.ev("matchMedia('(prefers-reduced-motion: reduce)').matches");

    return "done";
  },
  { timeoutMs: 300_000 },
);

writeFileSync("playtest/r14b-a11y-evidence.json", JSON.stringify(OUT, null, 2));
log("WROTE playtest/r14b-a11y-evidence.json");