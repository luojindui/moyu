// r14b 最终复验（HEAD 658a610，src clean）：播报/焦点/名称/tab/摘要/44px/对比度/社交门控/用完播报/AX
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const URL = "http://127.0.0.1:5173/";
const OUT = { at: new Date().toISOString(), head: "658a610" };
const DIR = "playtest/r14b-shots";
const log = (...a) => console.log("[v3]", ...a);

const shot = async (c, name, clip) => {
  if (clip && (clip.width < 1 || clip.height < 1)) return "SKIP";
  const params = { format: "png" };
  if (clip) params.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: clip.scale ?? 2 };
  const r = await c.send("Page.captureScreenshot", params);
  writeFileSync(`${DIR}/${name}.png`, Buffer.from(r.data, "base64"));
  return `${DIR}/${name}.png`;
};
const rect = (c, sel) => c.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; })()`);
const click = async (c, sel, wait = 320) => {
  const b = await c.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()`);
  if (!b) return false;
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await sleep(wait);
  return true;
};
const press = async (c, k, code, vk, text, wait = 450) => {
  await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(text ? { text } : {}) });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(wait);
};

const ACT = `(() => { const a=document.activeElement; return { tag:a?.tagName, id:a?.id, role:a?.getAttribute?.('role'), text:(a?.textContent||'').trim().slice(0,22), act:a?.dataset?.act ?? null, isBody:a===document.body, insideDialog:!!(a?.closest && a.closest('#team')) }; })()`;
const SNAP = `(() => ({
  live: document.getElementById('sr-live').textContent,
  head: document.querySelector('#team-body .branch h3')?.textContent.replace(/\\s+/g,' ').trim(),
  summary: document.querySelector('.team-summary')?.textContent.replace(/\\s+/g,' ').trim(),
  decor: document.getElementById('decor-summary').textContent,
  toast: document.getElementById('dom-toast')?.textContent,
  toastCls: document.getElementById('dom-toast')?.className,
  hidden: document.getElementById('team').classList.contains('hidden'),
  buttons: [...document.querySelectorAll('#team-body button')].map(b=>({ text:b.textContent.trim(), aria:b.getAttribute('aria-label'), disabled:b.disabled, h:Math.round(b.getBoundingClientRect().height), w:Math.round(b.getBoundingClientRect().width) })),
  socialDesc: [...document.querySelectorAll('#team-body .talent')].find(r=>r.dataset.id==='social')?.querySelector('.talent-desc')?.textContent.trim(),
  socialBtnDisabled: document.querySelector('button[data-act="energy"][data-id="social"]')?.disabled ?? null,
  combo: (() => { const b=document.querySelector('button[data-act="energy-all"]'); return b ? { text:b.textContent.trim(), disabled:b.disabled, h:Math.round(b.getBoundingClientRect().height) } : null; })(),
  active: ${ACT},
}))()`;

function measure() {
  try {
    const pc = (s) => { const m = String(s).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/); return m ? { r:+m[1], g:+m[2], b:+m[3], a:m[4]===undefined?1:+m[4] } : null; };
    const lum = (c) => { const f = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126*f(c.r/255)+0.7152*f(c.g/255)+0.0722*f(c.b/255); };
    const blend = (fg, bg, a) => ({ r: fg.r*a+bg.r*(1-a), g: fg.g*a+bg.g*(1-a), b: fg.b*a+bg.b*(1-a) });
    const contrast = (a, b) => { const L1=lum(a), L2=lum(b); return Math.round(((Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05))*100)/100; };
    const opacityOf = (el) => { let o=1,e=el; while(e){ o*=parseFloat(getComputedStyle(e).opacity||"1"); e=e.parentElement; } return o; };
    const bgOf = (el) => { let e=el; while(e){ const c=pc(getComputedStyle(e).backgroundColor); if(c&&c.a>0.999) return c; e=e.parentElement; } return {r:47,g:47,b:68}; };
    const info = (el) => { if(!el) return null; const cs=getComputedStyle(el); const fg=pc(cs.color); const bg=bgOf(el); const op=opacityOf(el);
      return { text:(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,80), fs:cs.fontSize, color:cs.color, opacity:Math.round(op*100)/100, contrast:contrast(fg,bg), effectiveContrast:contrast(blend(fg,bg,op),bg) }; };
    const rows = [...document.querySelectorAll('#team-body .talent')].map(r=>({
      id:r.dataset.id, act:r.dataset.act, disabledState:r.dataset.disabled, rowH:Math.round(r.getBoundingClientRect().height), opacity:Math.round(opacityOf(r)*100)/100,
      name: info(r.querySelector('.talent-name')), desc: info(r.querySelector('.talent-desc')),
      srOnly:[...r.querySelectorAll('.sr-only')].map(s=>s.textContent.trim()),
      dotAriaHidden: r.querySelector('.talent-dot')?.getAttribute('aria-hidden'),
      btn: (()=>{ const b=r.querySelector('button'); if(!b) return null; return { aria:b.getAttribute('aria-label'), text:b.textContent.trim(), disabled:b.disabled, h:Math.round(b.getBoundingClientRect().height), w:Math.round(b.getBoundingClientRect().width) }; })(),
    }));
    const heads = [...document.querySelectorAll('#team-body h3')].map(h=>({ text:h.textContent.replace(/\s+/g,' ').trim(), info:info(h), small: (()=>{ const s=h.querySelector('small'); return s? info(s) : null; })() }));
    const tabs = [...document.querySelectorAll('.team-tabs .tab')].map(t=>({ text:t.textContent.trim(), role:t.getAttribute('role'), selected:t.getAttribute('aria-selected'), h:Math.round(t.getBoundingClientRect().height), w:Math.round(t.getBoundingClientRect().width), fs:getComputedStyle(t).fontSize }));
    const allBtns = [...document.querySelectorAll('#team button')].map(b=>({ text:b.textContent.trim().slice(0,26), aria:b.getAttribute('aria-label'), role:b.getAttribute('role'), selected:b.getAttribute('aria-selected'), h:Math.round(b.getBoundingClientRect().height), w:Math.round(b.getBoundingClientRect().width), disabled:b.disabled, minH:getComputedStyle(b).minHeight }));
    return { heads, tabs, rows, allBtns, tablist: document.querySelector('.team-tabs')?.getAttribute('role'), summary: info(document.querySelector('.team-summary')) };
  } catch (e) { return { __error: String((e&&e.stack)||e) }; }
}

const axDump = async (c) => {
  const t = await c.send("Accessibility.getFullAXTree");
  const p = (n,k) => (n.properties||[]).find(x=>x.name===k)?.value?.value;
  return t.nodes.filter(n=>n.role && !n.ignored).map(n=>({ role:n.role.value, name:n.name?.value??"", description:n.description?.value??"", disabled:p(n,"disabled"), selected:p(n,"selected"), level:p(n,"level") }));
};

await runChrome(async ({ port }) => {
  const c = await connect(port);
  await c.send("Page.enable"); await c.send("Runtime.enable"); await c.send("Accessibility.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  const waitApp = async () => { for (let i=0;i<150;i++){ if (await c.ev("!!window.__MOYU__ && !!document.getElementById('btn-team')")) { await sleep(350); return true; } await sleep(100);} return false; };
  const bootClean = async () => {
    await c.send("Page.navigate", { url: "about:blank" }); await sleep(120);
    await c.send("Page.navigate", { url: URL }); await waitApp();
    await c.ev("__MOYU__.reset(); 'ok'"); await sleep(300);
  };
  const openPanel = async () => { for (let i=0;i<3;i++){ if (!(await c.ev("document.getElementById('team').classList.contains('hidden')"))) return true; await click(c, "#btn-team", 500); } return false; };
  const openTab = async (t) => { await click(c, `#tab-${t}`, 450); };
  const grant = async () => { await c.ev("__MOYU__.grant(1e11); 'ok'"); await sleep(1400); };
  const recruit = async () => {
    await openPanel(); await openTab("colleagues"); await sleep(300);
    const ok = await click(c, 'button[data-act="recruit"][data-id="zhou"]', 500);
    return ok;
  };

  // ================= S1 无同事 =================
  await bootClean(); await grant();
  await openPanel(); await openTab("decor"); await sleep(400);
  OUT.s1 = { snap: await c.ev(SNAP), measure: await c.ev(`(${measure.toString()})()`) };
  OUT.s1.ax = await axDump(c);
  OUT.s1.axButtons = OUT.s1.ax.filter(n=>n.role==="button" && (n.name.includes("使用")||n.name.includes("购买")||n.name.includes("省心")));
  OUT.s1.axTabs = OUT.s1.ax.filter(n=>["tab","tablist"].includes(n.role));
  OUT.s1.axHeadings = OUT.s1.ax.filter(n=>n.role==="heading");
  OUT.shots = {};
  OUT.shots.s1 = await shot(c, "s1-no-colleague", await rect(c,".team-panel"));
  log("S1 done; socialDisabled:", OUT.s1.snap.socialBtnDisabled, "combo:", JSON.stringify(OUT.s1.snap.combo));

  // ================= S2 招募后：社交启用 + 省心组合 =================
  OUT.s2 = { recruited: await recruit() };
  await openTab("decor"); await sleep(500);
  OUT.s2.snap = await c.ev(SNAP);
  OUT.shots.s2 = await shot(c, "s2-colleague", await rect(c,".team-panel"));
  // 点省心组合
  OUT.s2.comboClicked = await click(c, 'button[data-act="energy-all"]', 200);
  const comboSub = [];
  { const t0 = Date.now(); for (const ms of [120, 400, 700, 1200]) { const w = ms-(Date.now()-t0); if (w>0) await sleep(w); comboSub.push({ ms, live: await c.ev("document.getElementById('sr-live').textContent") }); } }
  OUT.s2.samples = comboSub;
  OUT.s2.after = await c.ev(SNAP);
  OUT.s2.measure = await c.ev(`(${measure.toString()})()`);
  OUT.shots.s2after = await shot(c, "s2-combo-after", await rect(c,".team-panel"));
  log("S2 done; samples:", JSON.stringify(comboSub.map(s=>s.live)));

  // ================= S3 逐项用完 → 用完播报时序 =================
  await bootClean(); await grant();
  OUT.s3 = { recruited: await recruit() };
  await openTab("decor"); await sleep(400);
  OUT.s3.before = await c.ev(SNAP);
  OUT.s3.uses = [];
  for (const id of ["social","fake-work","slack"]) { await click(c, `button[data-act="energy"][data-id="${id}"]`, 400); OUT.s3.uses.push({ id, snap: await c.ev(SNAP) }); }
  { const samples=[]; const t0=Date.now(); for (const ms of [100,300,420,480,560,750,1100]) { const w=ms-(Date.now()-t0); if (w>0) await sleep(w); samples.push({ ms, live: await c.ev("document.getElementById('sr-live').textContent") }); } OUT.s3.samples = samples; }
  OUT.s3.after = await c.ev(SNAP);
  log("S3 done; samples:", JSON.stringify(OUT.s3.samples.map(s=>s.live)));

  // ================= S4 买满 8 件：播报/焦点/摘要/描述 + 关闭后 canvas AX =================
  await bootClean(); await grant();
  await openPanel(); await openTab("decor"); await sleep(400);
  OUT.s4 = { buys: [] };
  for (const id of ["plant","lamp","rug","fridge","chair","aquarium","projector","catbed"]) {
    await click(c, `button[data-act="decor"][data-id="${id}"]`, 300);
    OUT.s4.buys.push({ id, live: await c.ev("document.getElementById('sr-live').textContent"), decorLen: (await c.ev("document.getElementById('decor-summary').textContent")).length, active: await c.ev(ACT) });
  }
  OUT.s4.measured = await c.ev(`(${measure.toString()})()`);
  OUT.shots.s4owned = await shot(c, "s4-owned", await rect(c,".team-panel"));
  // 关闭面板 → 场景 AX
  await click(c, "#team-close", 500);
  OUT.s4.closed = await c.ev(`(() => ({ hidden: document.getElementById('team').classList.contains('hidden'), decor: document.getElementById('decor-summary').textContent, active: ${ACT} }))()`);
  OUT.s4.ax = await axDump(c);
  OUT.s4.canvasAx = OUT.s4.ax.filter(n=>n.name.includes("点击摸鱼"));
  OUT.shots.s4scene = await shot(c, "s4-scene");
  log("S4 done; canvasAx:", JSON.stringify(OUT.s4.canvasAx));

  // ================= S5 键盘购买/使用焦点 =================
  await bootClean(); await grant();
  await openPanel(); await openTab("decor"); await sleep(400);
  OUT.s5 = {};
  OUT.s5.focusBuy = await c.ev(`(() => { const b=document.querySelector('#team-body button[data-act="decor"]:not([disabled])'); if(!b) return null; b.scrollIntoView({block:'center'}); b.focus(); return { aria:b.getAttribute('aria-label'), isFocused: document.activeElement===b }; })()`);
  await press(c, "Enter", "Enter", 13, "\r", 500);
  OUT.s5.afterBuy = { live: await c.ev("document.getElementById('sr-live').textContent"), active: await c.ev(ACT) };
  OUT.s5.focusUse = await c.ev(`(() => { const b=document.querySelector('#team-body button[data-act="energy"]:not([disabled])'); if(!b) return null; b.scrollIntoView({block:'center'}); b.focus(); return { aria:b.getAttribute('aria-label'), isFocused: document.activeElement===b }; })()`);
  await press(c, "Enter", "Enter", 13, "\r", 500);
  OUT.s5.afterUse = { live: await c.ev("document.getElementById('sr-live').textContent"), active: await c.ev(ACT) };
  log("S5 done; afterBuy:", JSON.stringify(OUT.s5.afterBuy.active), "afterUse:", JSON.stringify(OUT.s5.afterUse.active));

  // ================= S6 Tab 陷阱 / toast 重叠 / 小屏 =================
  await c.ev("document.getElementById('team-close').focus(); 'ok'");
  const stops = [];
  for (let i=0;i<14;i++) { await press(c, "Tab", "Tab", 9, null, 80); stops.push(await c.ev(ACT)); }
  OUT.s6 = { stops, escapedAt: stops.findIndex(s=>!s.insideDialog && !s.isBody) };
  OUT.s6.toastOverlap = await c.ev(`(() => { const t=document.getElementById('dom-toast'); const tabs=document.querySelector('.team-tabs'); const tr=t.getBoundingClientRect(), br=tabs.getBoundingClientRect();
    return { toast:{x:Math.round(tr.x),y:Math.round(tr.y),w:Math.round(tr.width),h:Math.round(tr.height)}, tabs:{x:Math.round(br.x),y:Math.round(br.y),w:Math.round(br.width),h:Math.round(br.height)}, overlap: !(tr.right<br.left||tr.left>br.right||tr.bottom<br.top||tr.top>br.bottom), z:getComputedStyle(t).zIndex }; })()`);
  await c.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 667, deviceScaleFactor: 2, mobile: false });
  await sleep(450);
  OUT.s6.small = await c.ev(`(() => { const p=document.querySelector('.team-panel').getBoundingClientRect();
    return { docScrollW:document.documentElement.scrollWidth, docClientW:document.documentElement.clientWidth, panelW:Math.round(p.width), panelH:Math.round(p.height),
      bodyScrollH:document.getElementById('team-body').scrollHeight, bodyClientH:document.getElementById('team-body').clientHeight,
      clipped:[...document.querySelectorAll('#team-body button')].filter(b=>{const r=b.getBoundingClientRect(); return r.right>p.right+1||r.left<p.left-1;}).length }; })()`);
  OUT.shots.small = await shot(c, "s6-small", await rect(c,".team-panel"));
  await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await sleep(250);
  OUT.s6.reducedMotion = await c.ev("matchMedia('(prefers-reduced-motion: reduce)').matches");

  return "done";
}, { timeoutMs: 300_000 });

writeFileSync("playtest/r14b-final-evidence.json", JSON.stringify(OUT, null, 2));
log("WROTE playtest/r14b-final-evidence.json");