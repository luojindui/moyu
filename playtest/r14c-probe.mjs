// r14c 复验：HEAD acefd7a（焦点恢复 / 用完播报 / 已获得行对比度 / toast 位置）
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const URL = "http://127.0.0.1:5173/";
const OUT = { at: new Date().toISOString(), head: "acefd7a" };
const DIR = "playtest/r14c-shots";
const log = (...a) => console.log("[r14c]", ...a);

const shot = async (c, name, clip) => {
  if (clip && (clip.width < 1 || clip.height < 1)) return "SKIP";
  const params = { format: "png" };
  if (clip) params.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: clip.scale ?? 2 };
  const r = await c.send("Page.captureScreenshot", params);
  writeFileSync(`${DIR}/${name}.png`, Buffer.from(r.data, "base64"));
  return `${DIR}/${name}.png`;
};
const rect = (c, sel) => c.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, bottom:r.bottom, right:r.right }; })()`);
const click = async (c, sel, wait = 340) => {
  const b = await c.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()`);
  if (!b) return false;
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 });
  await sleep(wait);
  return true;
};
const press = async (c, k, code, vk, text, wait = 600) => {
  await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(text ? { text } : {}) });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(wait);
};
const ACT = `(() => { const a=document.activeElement; return { tag:a?.tagName, id:a?.id, role:a?.getAttribute?.('role'), text:(a?.textContent||'').trim().slice(0,22), act:a?.dataset?.act ?? null, dataId:a?.dataset?.id ?? null, isBody:a===document.body, insideDialog:!!(a?.closest && a.closest('#team')) }; })()`;
const SNAP = `(() => ({ live: document.getElementById('sr-live').textContent,
  head: document.querySelector('#team-body .branch h3')?.textContent.replace(/\\s+/g,' ').trim(),
  decor: document.getElementById('decor-summary').textContent,
  toast: document.getElementById('dom-toast')?.textContent,
  toastCls: document.getElementById('dom-toast')?.className,
  active: ${ACT} }))()`;

function measure() {
  try {
    const pc = (s) => { const m = String(s).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/); return m ? { r:+m[1], g:+m[2], b:+m[3], a:m[4]===undefined?1:+m[4] } : null; };
    const lum = (c) => { const f = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126*f(c.r/255)+0.7152*f(c.g/255)+0.0722*f(c.b/255); };
    const blend = (fg, bg, a) => ({ r: fg.r*a+bg.r*(1-a), g: fg.g*a+bg.g*(1-a), b: fg.b*a+bg.b*(1-a) });
    const contrast = (a, b) => { const L1=lum(a), L2=lum(b); return Math.round(((Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05))*100)/100; };
    const opacityOf = (el) => { let o=1,e=el; while(e){ o*=parseFloat(getComputedStyle(e).opacity||"1"); e=e.parentElement; } return o; };
    const bgOf = (el) => { let e=el; while(e){ const c=pc(getComputedStyle(e).backgroundColor); if(c&&c.a>0.999) return c; e=e.parentElement; } return {r:47,g:47,b:68}; };
    const info = (el) => { if(!el) return null; const cs=getComputedStyle(el); const fg=pc(cs.color); const bg=bgOf(el); const op=opacityOf(el);
      return { text:(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,70), fs:cs.fontSize, color:cs.color, rowBg:`rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`, opacity:Math.round(op*100)/100, contrast:contrast(fg,bg), effectiveContrast:contrast(blend(fg,bg,op),bg) }; };
    const rows = [...document.querySelectorAll('#team-body .talent')].map(r=>({
      id:r.dataset.id, act:r.dataset.act, disabledState:r.dataset.disabled, op:Math.round(opacityOf(r)*100)/100,
      rowStyle:{ bg:getComputedStyle(r).backgroundColor, border:getComputedStyle(r).borderColor },
      name: info(r.querySelector('.talent-name')), desc: info(r.querySelector('.talent-desc')), srOnly:[...r.querySelectorAll('.sr-only')].map(s=>s.textContent.trim()),
      btn: (()=>{ const b=r.querySelector('button'); return b?{ aria:b.getAttribute('aria-label'), text:b.textContent.trim(), disabled:b.disabled, h:Math.round(b.getBoundingClientRect().height) }:null; })(),
    }));
    const heads = [...document.querySelectorAll('#team-body h3')].map(h=>({ text:h.textContent.replace(/\s+/g,' ').trim(), small:(()=>{const s=h.querySelector('small'); return s?info(s):null;})() }));
    const btns = [...document.querySelectorAll('#team button')].map(b=>({ text:b.textContent.trim().slice(0,20), aria:b.getAttribute('aria-label'), role:b.getAttribute('role'), selected:b.getAttribute('aria-selected'), h:Math.round(b.getBoundingClientRect().height), disabled:b.disabled }));
    return { rows, heads, btns, summary: info(document.querySelector('.team-summary')), tablist: document.querySelector('.team-tabs')?.getAttribute('role'), hidden: document.getElementById('team').classList.contains('hidden') };
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
  const dismiss = async () => {
    for (let i=0;i<5;i++) {
      const st = await c.ev(`(() => ({ cards: !document.getElementById('cards').classList.contains('hidden'), welcome: !document.getElementById('welcome').classList.contains('hidden') }))()`);
      if (!st.cards && !st.welcome) return true;
      if (st.cards) await click(c, "#cards-skip", 420);
      if (st.welcome) await click(c, "#welcome-ok", 420);
    }
    return false;
  };
  const boot = async () => {
    await c.send("Page.navigate", { url: "about:blank" }); await sleep(150);
    await c.send("Page.navigate", { url: URL }); await waitApp();
    await c.ev("__MOYU__.reset(); 'ok'"); await sleep(350);
    await dismiss();
  };
  const grant = async () => { await c.ev("__MOYU__.grant(1e11); 'ok'"); await sleep(1500); };
  const openPanel = async () => {
    await dismiss();
    for (let i=0;i<4;i++){ if (!(await c.ev("document.getElementById('team').classList.contains('hidden')"))) return true; await click(c,"#btn-team",550); await dismiss(); }
    return false;
  };
  const openDecor = async () => { await openPanel(); await click(c,"#tab-decor",500); return c.ev("document.querySelector('.team-tabs .tab.active')?.textContent"); };
  const recruit = async () => {
    await openPanel(); await click(c,"#tab-colleagues",500);
    const ok = await click(c, 'button[data-act="recruit"][data-id="zhou"]', 500);
    return ok;
  };

  // ============ T1 焦点恢复：键盘 Enter 购买 / 使用 ============
  await boot(); await grant();
  OUT.t1 = { tab: await openDecor() };
  OUT.t1.focusBuy = await c.ev(`(() => { const b=document.querySelector('#team-body button[data-act="decor"]:not([disabled])'); if(!b) return null; b.scrollIntoView({block:'center'}); b.focus(); return { aria:b.getAttribute('aria-label'), act:b.dataset.act, dataId:b.dataset.id, isFocused: document.activeElement===b }; })()`);
  await press(c, "Enter", "Enter", 13, "\r", 650);
  OUT.t1.afterBuy = { live: await c.ev("document.getElementById('sr-live').textContent"), decor: await c.ev("document.getElementById('decor-summary').textContent"), active: await c.ev(ACT) };
  OUT.t1.focusUse = await c.ev(`(() => { const b=document.querySelector('#team-body button[data-act="energy"]:not([disabled])'); if(!b) return null; b.scrollIntoView({block:'center'}); b.focus(); return { aria:b.getAttribute('aria-label'), isFocused: document.activeElement===b }; })()`);
  await press(c, "Enter", "Enter", 13, "\r", 650);
  OUT.t1.afterUse = { live: await c.ev("document.getElementById('sr-live').textContent"), head: await c.ev("document.querySelector('#team-body .branch h3')?.textContent.replace(/\\s+/g,' ').trim()"), active: await c.ev(ACT) };
  log("T1 afterBuy:", JSON.stringify(OUT.t1.afterBuy.active), "afterUse:", JSON.stringify(OUT.t1.afterUse.active));

  // ============ T2 逐项用完播报 ============
  await boot(); await grant(); OUT.t2 = { recruited: await recruit() };
  await click(c,"#tab-decor",500);
  OUT.t2.uses = [];
  for (const id of ["social","fake-work","slack"]) { await click(c, `button[data-act="energy"][data-id="${id}"]`, 500); OUT.t2.uses.push({ id, live: await c.ev("document.getElementById('sr-live').textContent") }); }
  { const s=[]; const t0=Date.now(); for (const ms of [100,400,620,700,850,1200]) { const w=ms-(Date.now()-t0); if(w>0) await sleep(w); s.push({ ms, live: await c.ev("document.getElementById('sr-live').textContent") }); } OUT.t2.samples = s; }
  OUT.t2.head = await c.ev("document.querySelector('#team-body .branch h3')?.textContent.replace(/\\s+/g,' ').trim()");
  log("T2 samples:", JSON.stringify(OUT.t2.samples.map(s=>s.live)));

  // ============ T3 省心组合用完播报 ============
  await boot(); await grant(); OUT.t3 = { recruited: await recruit() };
  await click(c,"#tab-decor",500);
  OUT.t3.comboBefore = await c.ev(`(() => { const b=document.querySelector('button[data-act="energy-all"]'); return b?{text:b.textContent.trim(),disabled:b.disabled,h:Math.round(b.getBoundingClientRect().height)}:null; })()`);
  const comboBox = await click(c, 'button[data-act="energy-all"]', 150);
  { const s=[]; const t0=Date.now(); for (const ms of [120,500,700,820,1000,1400]) { const w=ms-(Date.now()-t0); if(w>0) await sleep(w); s.push({ ms, live: await c.ev("document.getElementById('sr-live').textContent") }); } OUT.t3.samples = s; }
  OUT.t3.after = { head: await c.ev("document.querySelector('#team-body .branch h3')?.textContent.replace(/\\s+/g,' ').trim()"), active: await c.ev(ACT) };
  log("T3 samples:", JSON.stringify(OUT.t3.samples.map(s=>s.live)));

  // ============ T4 对比度：已获得行 / 禁用行 ============
  // 4a: 买 1 件 + 用 1 项（已获得/已使用行）
  await boot(); await grant(); await openDecor();
  await click(c, 'button[data-act="decor"][data-id="plant"]', 400);
  await click(c, 'button[data-act="energy"][data-id="slack"]', 400);
  OUT.t4owned = await c.ev(`(${measure.toString()})()`);
  // 4b: 无钱 + 无同事（禁用行）
  await boot();
  await openDecor();
  OUT.t4disabled = await c.ev(`(${measure.toString()})()`);
  OUT.shots = {};
  OUT.shots.disabled = await shot(c, "t4-disabled", await rect(c,".team-panel"));

  // ============ T5 toast 位置 vs tab 行 ============
  await boot(); await grant(); await openDecor();
  const tabsRect = await rect(c, ".team-tabs");
  const summaryRect = await rect(c, ".team-summary");
  await click(c, 'button[data-act="decor"][data-id="lamp"]', 120);
  OUT.t5 = {
    tabsRect, summaryRect,
    toastRect: await rect(c, "#dom-toast"),
    toastText: await c.ev("document.getElementById('dom-toast')?.textContent"),
    toastCls: await c.ev("document.getElementById('dom-toast')?.className"),
    overlapTabs: await c.ev(`(() => { const t=document.getElementById('dom-toast').getBoundingClientRect(), b=document.querySelector('.team-tabs').getBoundingClientRect();
      return !(t.right<b.left||t.left>b.right||t.bottom<b.top||t.top>b.bottom); })()`),
    overlapSummary: await c.ev(`(() => { const t=document.getElementById('dom-toast').getBoundingClientRect(), b=document.querySelector('.team-summary').getBoundingClientRect();
      return !(t.right<b.left||t.left>b.right||t.bottom<b.top||t.top>b.bottom); })()`),
  };
  OUT.shots.toast = await shot(c, "t5-toast");
  log("T5 toast/tabs:", JSON.stringify({toast:OUT.t5.toastRect, tabs:OUT.t5.tabsRect, overlapTabs:OUT.t5.overlapTabs, overlapSummary:OUT.t5.overlapSummary}));

  // ============ T6 回归：44px / AX 名称 / tab 语义 / 摘要 / 陷阱 ============
  await boot(); await grant(); await openDecor();
  await click(c, 'button[data-act="decor"][data-id="plant"]', 400);
  OUT.t6 = { measure: await c.ev(`(${measure.toString()})()`) };
  const ax = await axDump(c);
  OUT.t6.axTabs = ax.filter(n=>["tab","tablist"].includes(n.role));
  OUT.t6.axHeadings = ax.filter(n=>n.role==="heading");
  OUT.t6.axButtons = ax.filter(n=>n.role==="button" && /使用|购买|省心/.test(n.name)).map(n=>({name:n.name,disabled:n.disabled}));
  OUT.t6.axSr = ax.filter(n=>/已装修|已使用/.test(n.name)).map(n=>({role:n.role,name:n.name.slice(0,30)}));
  OUT.t6.axCheckmarks = ax.filter(n=>n.name==="✓").length;
  // 陷阱：从关闭按钮 Tab
  await c.ev("document.getElementById('team-close').focus(); 'ok'");
  const stops=[]; for (let i=0;i<14;i++){ await press(c,"Tab","Tab",9,null,90); stops.push(await c.ev(ACT)); }
  OUT.t6.stops = stops; OUT.t6.escapedAt = stops.findIndex(s=>!s.insideDialog && !s.isBody);
  await c.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 667, deviceScaleFactor: 2, mobile: false });
  await sleep(450);
  OUT.t6.small = await c.ev(`(() => { const p=document.querySelector('.team-panel').getBoundingClientRect();
    return { docScrollW:document.documentElement.scrollWidth, docClientW:document.documentElement.clientWidth, panelW:Math.round(p.width), panelH:Math.round(p.height),
      clipped:[...document.querySelectorAll('#team-body button')].filter(b=>{const r=b.getBoundingClientRect(); return r.right>p.right+1||r.left<p.left-1;}).length }; })()`);
  OUT.shots.small = await shot(c, "t6-small", await rect(c,".team-panel"));
  await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await sleep(250);
  OUT.t6.reduced = await c.ev("matchMedia('(prefers-reduced-motion: reduce)').matches");

  return "done";
}, { timeoutMs: 280_000, port: 9823 });

writeFileSync("playtest/r14c-evidence.json", JSON.stringify(OUT, null, 2));
log("WROTE playtest/r14c-evidence.json");