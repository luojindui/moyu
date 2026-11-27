// r14b 终验 S4'/S5/S6：买满 8 件播报/焦点/描述、键盘焦点、Tab 陷阱、toast 重叠、对比度
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const URL = "http://127.0.0.1:5173/";
const OUT = { at: new Date().toISOString(), head: "658a610" };
const DIR = "playtest/r14b-shots";
const log = (...a) => console.log("[v4]", ...a);

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
      btn: (()=>{ const b=r.querySelector('button'); if(!b) return null; return { aria:b.getAttribute('aria-label'), text:b.textContent.trim(), disabled:b.disabled, h:Math.round(b.getBoundingClientRect().height) }; })(),
    }));
    const heads = [...document.querySelectorAll('#team-body h3')].map(h=>({ text:h.textContent.replace(/\s+/g,' ').trim(), small: (()=>{ const s=h.querySelector('small'); return s? info(s) : null; })() }));
    const btns = [...document.querySelectorAll('#team button')].map(b=>({ text:b.textContent.trim().slice(0,24), aria:b.getAttribute('aria-label'), h:Math.round(b.getBoundingClientRect().height), w:Math.round(b.getBoundingClientRect().width), disabled:b.disabled }));
    return { rows, heads, btns, summary: info(document.querySelector('.team-summary')), hidden: document.getElementById('team').classList.contains('hidden') };
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
  const dismissOverlays = async () => {
    // 卡片选择弹窗 / 欢迎弹窗 会挡住点击
    for (let i=0;i<4;i++) {
      const state = await c.ev(`(() => ({ cards: !document.getElementById('cards').classList.contains('hidden'), welcome: !document.getElementById('welcome').classList.contains('hidden') }))()`);
      if (!state.cards && !state.welcome) return true;
      if (state.cards) await click(c, "#cards-skip", 450);
      if (state.welcome) await click(c, "#welcome-ok", 450);
    }
    return false;
  };
  const bootClean = async () => {
    await c.send("Page.navigate", { url: "about:blank" }); await sleep(150);
    await c.send("Page.navigate", { url: URL }); await waitApp();
    await c.ev("__MOYU__.reset(); 'ok'"); await sleep(300);
    await dismissOverlays();
  };
  const openPanel = async () => {
    await dismissOverlays();
    for (let i=0;i<4;i++){
      if (!(await c.ev("document.getElementById('team').classList.contains('hidden')"))) return true;
      await click(c, "#btn-team", 550);
      await dismissOverlays();
    }
    return !(await c.ev("document.getElementById('team').classList.contains('hidden')"));
  };
  const openDecor = async () => { await openPanel(); await click(c, "#tab-decor", 500); return c.ev("document.querySelector('.team-tabs .tab.active')?.textContent"); };
  const grant = async () => { await c.ev("__MOYU__.grant(1e11); 'ok'"); await sleep(1500); };

  // ============ S4' 买满 8 件 ============
  await bootClean(); await grant();
  OUT.s4 = { opened: await openDecor() };
  OUT.shots = {};
  OUT.s4.before = await c.ev(`(() => ({ live: document.getElementById('sr-live').textContent, head: document.querySelector('#team-body .branch h3')?.textContent.replace(/\\s+/g,' ').trim(), rows: document.querySelectorAll('#team-body .talent').length }))()`);
  OUT.s4.buys = [];
  for (const id of ["plant","lamp","rug","fridge","chair","aquarium","projector","catbed"]) {
    const ok = await click(c, `button[data-act="decor"][data-id="${id}"]`, 340);
    OUT.s4.buys.push({ id, clickOk: ok, live: await c.ev("document.getElementById('sr-live').textContent"), decor: await c.ev("document.getElementById('decor-summary').textContent"), toast: await c.ev("document.getElementById('dom-toast')?.textContent"), active: await c.ev(ACT) });
  }
  OUT.s4.measured = await c.ev(`(${measure.toString()})()`);
  OUT.shots.s4owned = await shot(c, "s4-owned", await rect(c,".team-panel"));
  await click(c, "#team-close", 550);
  OUT.s4.closed = await c.ev(`(() => ({ hidden: document.getElementById('team').classList.contains('hidden'), decor: document.getElementById('decor-summary').textContent, decorCls: document.getElementById('decor-summary').className, active: ${ACT}, canvas: (()=>{const s=document.getElementById('stage'); return {label:s.getAttribute('aria-label'), desc:s.getAttribute('aria-describedby')};})() }))()`);
  OUT.s4.ax = await axDump(c);
  OUT.s4.canvasAx = OUT.s4.ax.filter(n=>n.name.includes("点击摸鱼"));
  OUT.s4.decorTextAx = OUT.s4.ax.filter(n=>/工位已装修|工位尚未装修/.test(n.name)).map(n=>({role:n.role,name:n.name.slice(0,60)}));
  OUT.shots.s4scene = await shot(c, "s4-scene");
  log("S4 done; buys live:", JSON.stringify(OUT.s4.buys.map(b=>b.live).slice(0,3)), "...last:", OUT.s4.buys.at(-1)?.live, "canvasAx:", JSON.stringify(OUT.s4.canvasAx));

  // ============ S5 键盘购买/使用焦点 ============
  await bootClean(); await grant();
  OUT.s5 = { opened: await openDecor() };
  OUT.s5.focusBuy = await c.ev(`(() => { const b=document.querySelector('#team-body button[data-act="decor"]:not([disabled])'); if(!b) return null; b.scrollIntoView({block:'center'}); b.focus(); return { aria:b.getAttribute('aria-label'), isFocused: document.activeElement===b, act:b.dataset.act, id:b.dataset.id }; })()`);
  await press(c, "Enter", "Enter", 13, "\r", 600);
  OUT.s5.afterBuy = { live: await c.ev("document.getElementById('sr-live').textContent"), decor: await c.ev("document.getElementById('decor-summary').textContent"), active: await c.ev(ACT) };
  OUT.s5.focusUse = await c.ev(`(() => { const b=document.querySelector('#team-body button[data-act="energy"]:not([disabled])'); if(!b) return null; b.scrollIntoView({block:'center'}); b.focus(); return { aria:b.getAttribute('aria-label'), isFocused: document.activeElement===b }; })()`);
  await press(c, "Enter", "Enter", 13, "\r", 600);
  OUT.s5.afterUse = { live: await c.ev("document.getElementById('sr-live').textContent"), head: await c.ev("document.querySelector('#team-body .branch h3')?.textContent.replace(/\\s+/g,' ').trim()"), active: await c.ev(ACT) };
  log("S5 done; afterBuy:", JSON.stringify(OUT.s5.afterBuy.active), "afterUse:", JSON.stringify(OUT.s5.afterUse.active));

  // ============ S6 toast 重叠 + Tab 陷阱 ============
  OUT.s6 = {};
  // 再买一件以触发 toast，立即量 toast/tabs 矩形
  await click(c, 'button[data-act="decor"]:not([disabled])', 120);
  OUT.s6.toastOverlap = await c.ev(`(() => { const t=document.getElementById('dom-toast'); const tabs=document.querySelector('.team-tabs'); const tr=t.getBoundingClientRect(), br=tabs.getBoundingClientRect();
    return { toast:{x:Math.round(tr.x),y:Math.round(tr.y),w:Math.round(tr.width),h:Math.round(tr.height)}, tabs:{x:Math.round(br.x),y:Math.round(br.y),w:Math.round(br.width),h:Math.round(br.height)},
      overlap: !(tr.right<br.left||t.left>br.right||tr.bottom<br.top||tr.top>br.bottom), cls:t.className, z:getComputedStyle(t).zIndex }; })()`);
  // tab 陷阱
  await c.ev("document.getElementById('team-close').focus(); 'ok'");
  const stops = [];
  for (let i=0;i<16;i++) { await press(c, "Tab", "Tab", 9, null, 85); stops.push(await c.ev(ACT)); }
  OUT.s6.stops = stops;
  OUT.s6.escapedAt = stops.findIndex(s=>!s.insideDialog && !s.isBody);
  OUT.s6.firstOutside = OUT.s6.escapedAt >= 0 ? stops[OUT.s6.escapedAt] : null;
  // 小屏
  await c.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 667, deviceScaleFactor: 2, mobile: false });
  await sleep(450);
  OUT.s6.small = await c.ev(`(() => { const p=document.querySelector('.team-panel').getBoundingClientRect();
    return { docScrollW:document.documentElement.scrollWidth, docClientW:document.documentElement.clientWidth, panelW:Math.round(p.width), panelH:Math.round(p.height),
      bodyScrollH:document.getElementById('team-body').scrollHeight, bodyClientH:document.getElementById('team-body').clientHeight,
      clipped:[...document.querySelectorAll('#team-body button')].filter(b=>{const r=b.getBoundingClientRect(); return r.right>p.right+1||r.left<p.left-1;}).length,
      hidden: document.getElementById('team').classList.contains('hidden') }; })()`);
  OUT.shots.s6small = await shot(c, "s6-small", await rect(c,".team-panel"));
  await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await sleep(250);
  OUT.s6.reducedMotion = await c.ev("matchMedia('(prefers-reduced-motion: reduce)').matches");
  log("S6 done; escapedAt:", OUT.s6.escapedAt, "toast:", JSON.stringify(OUT.s6.toastOverlap));

  return "done";
}, { timeoutMs: 240_000 });

writeFileSync("playtest/r14b-final2-evidence.json", JSON.stringify(OUT, null, 2));
log("WROTE playtest/r14b-final2-evidence.json");