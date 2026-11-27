/**
 * R9 中老年/低熟练度用户试玩探针（只读，不改 src/）
 * 1) 全可见文本 computed fontSize + 对比度（WCAG，含祖先背景合成）
 * 2) canvas 文本字号（patch fillText 抓 font/颜色）
 * 3) 慢速点击 1 次/1.5s 容错 + 快慢点击收益对比
 * 4) 误触：点灰色商店卡、商店横向滑动、点 📔 后点遮罩外
 * 5) 首屏信息密度（HUD/目标条/场景/商店高度、可点目标数、数字 token 数）
 * 输出 playtest/r9-senior-evidence.json + 截图
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9581;
const W = 390, H = 844;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync("playtest/r9-screens", { recursive: true });

const SCRIPT = `
(() => {
  const P = window.__r9 = { fill: [], clicks: [], touches: [] };
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, x, y) {
    try {
      const s = String(t);
      const font = this.font;
      const key = font + '|' + this.fillStyle + '|' + s.replace(/[0-9]+(\\.[0-9]+)?/g, '#');
      const hit = P.fill.find((e) => e.key === key);
      if (hit) hit.n++;
      else P.fill.push({ key, font, fill: String(this.fillStyle), text: s.slice(0, 60), w: Math.round(this.measureText(s).width * 10) / 10, n: 1 });
    } catch (e) {}
    return orig.apply(this, arguments);
  };
  const origST = CanvasRenderingContext2D.prototype.strokeText;
  CanvasRenderingContext2D.prototype.strokeText = function () { return origST.apply(this, arguments); };
  document.addEventListener('click', (e) => {
    const t = e.target;
    P.clicks.push({ ts: Math.round(performance.now()), tag: t.tagName, up: t.closest && t.closest('[data-upgrade]') ? t.closest('[data-upgrade]').dataset.upgrade : null, id: t.id || null, cls: (t.className && String(t.className).slice(0, 30)) || null });
  }, true);
  // 原始 pointerdown 记录（游戏监听之前的捕获阶段）
  document.addEventListener('pointerdown', (e) => {
    P.touches.push({ ts: Math.round(performance.now()), x: Math.round(e.clientX), y: Math.round(e.clientY), tgt: e.target.id || e.target.className || e.target.tagName });
  }, true);
})();
`;

const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r9-senior-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
async function waitJson(url, tries = 150) { for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return r.json(); } catch {} await sleep(100); } throw new Error("CDP not ready"); }
await waitJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };
const state = () => ev("JSON.stringify(__MOYU__.state)").then(JSON.parse);
const tap = async (x, y) => {
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1, radiusX: 10, radiusY: 10, force: 1 }] });
  await sleep(60);
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(`playtest/r9-screens/${name}.png`, Buffer.from(r.data, "base64"));
  return `playtest/r9-screens/${name}.png`;
};
const rectOf = (sel) => ev(`JSON.stringify((()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),cx:Math.round(r.x+r.width/2),cy:Math.round(r.y+r.height/2)};})())`).then(JSON.parse);

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.addScriptToEvaluateOnNewDocument", { source: SCRIPT });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(2600);

const out = { viewport: { w: W, h: H, dpr: 3 }, ta: {} };

// ---------- 0) 首屏结构 / 密度 ----------
out.layout = await ev(`JSON.stringify((()=>{
  const R=(sel)=>{const e=document.querySelector(sel);if(!e)return null;const r=e.getBoundingClientRect();return {y:Math.round(r.y),h:Math.round(r.height),bottom:Math.round(r.bottom)}};
  const jour=R('#btn-journal'), shop=R('#shop'), hud=R('#hud'), stage=R('#stage-wrap');
  const target=[...document.querySelectorAll('button,[role=button],a,input,select')].filter(b=>{const r=b.getBoundingClientRect();const st=getComputedStyle(b);return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&st.visibility!=='hidden'&&st.display!=='none'&&b.offsetParent!==null;});
  const sizes=target.map(b=>{const r=b.getBoundingClientRect();return {id:b.id||b.dataset.upgrade||String(b.className).slice(0,24),w:Math.round(r.width),h:Math.round(r.height)}});
  return { hud, quest: R('#quest'), stage, shop, journalBtn: jour, journalOverlapsShop: !!(jour&&shop&&jour.bottom>shop.y),
    visibleButtons: sizes.length, targets: sizes,
    textNodes: [...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();if(!(r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0))return false;return [...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())}).length };
})())`).then(JSON.parse);

// ---------- 1) 字号 + 对比度全量清点 ----------
out.textAudit = await ev(`JSON.stringify((()=>{
  const parse=(s)=>{const m=String(s).match(/rgba?\\(([^)]+)\\)/);if(!m)return null;const p=m[1].split(',').map(Number);return [p[0],p[1],p[2],p.length>3?p[3]:1];};
  const comp=(fg,bg)=>{const a=fg[3];return [fg[0]*a+bg[0]*(1-a),fg[1]*a+bg[1]*(1-a),fg[2]*a+bg[2]*(1-a),1];};
  const lum=([r,g,b])=>{const f=(c)=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);};
  const ratio=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);};
  const bgFor=(el)=>{const chain=[];let n=el;while(n&&n!==document.documentElement){chain.push(n);n=n.parentElement;}chain.push(document.documentElement);chain.reverse();let bg=[255,255,255,1];for(const e of chain){const c=parse(getComputedStyle(e).backgroundColor);if(c&&c[3]>0.01)bg=comp(c,bg);}return bg;};
  const opacityOf=(el)=>{let o=1,n=el;while(n&&n!==document.documentElement){o*=parseFloat(getComputedStyle(n).opacity);n=n.parentElement;}return o;};
  const vis=(el)=>{const r=el.getBoundingClientRect();if(!(r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0))return false;return opacityOf(el)>0.1;};
  const rows=[];
  for(const el of document.querySelectorAll('body *')){
    const txt=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).filter(Boolean).join(' ');
    if(!txt) continue;
    if(!vis(el)) continue;
    const cs=getComputedStyle(el);
    if(cs.visibility==='hidden'||cs.display==='none') continue;
    const fs=parseFloat(cs.fontSize), fw=parseInt(cs.fontWeight)||400;
    const bg=bgFor(el);
    let fg=parse(cs.color)||[0,0,0,1];
    fg=comp(fg,bg);
    const cr=ratio(fg,bg);
    const r=el.getBoundingClientRect();
    const parent=el.closest('[data-upgrade]');
    rows.push({ text:txt.slice(0,42), fs:Math.round(fs*10)/10, fw, color:cs.color, cr:Math.round(cr*100)/100,
      large: fs>=24||(fs>=18.66&&fw>=700), tag:el.tagName, id:el.id||null,
      cls:String(el.className||'').slice(0,34), up: parent?parent.dataset.upgrade:null,
      disabled: !!(el.closest('button')&&el.closest('button').disabled), w:Math.round(r.width), h:Math.round(r.height) });
  }
  // 去重（同文案同字号同色）
  const seen=new Set(); const uniq=[];
  for(const r of rows){const k=r.text+'|'+r.fs+'|'+r.color+'|'+r.cls+'|'+r.up;if(seen.has(k))continue;seen.add(k);uniq.push(r);}
  return uniq;
})())`).then(JSON.parse);

// ---------- 2) canvas 文本 ----------
await sleep(600);
out.canvasText = JSON.parse(await ev("JSON.stringify(__r9.fill)")).map((e) => {
  const m = String(e.font).match(/([\d.]+)px/);
  return { ...e, px: m ? Number(m[1]) : null };
}).filter((e) => e.px !== null);

out.baseShot = await shot("r9-first-screen");

// ---------- 3a) 慢速点击 1 次 / 1.5s ----------
const slow = [];
for (let i = 0; i < 8; i++) {
  const before = await state();
  const t0 = Date.now();
  await tap(195, 420);
  await sleep(350);
  const after = await state();
  slow.push({ i: i + 1, totalClicksDelta: after.totalClicks - before.totalClicks, DT: after.totalEarned - before.totalEarned, idleRate: null, ms: Date.now() - t0 });
  await sleep(Math.max(0, 1500 - (Date.now() - t0)));
}
out.slowClicks = slow;
out.afterSlow = await state();
out.slowTexts = JSON.parse(await ev("JSON.stringify(__r9.fill.filter(e=>/[+连击]/.test(e.text)).map(e=>e.text))"));

// ---------- 3b) 快速点击（与慢速同屏对比，证明连击只对快手指可用）----------
const fast = [];
for (let i = 0; i < 8; i++) {
  const before = await state();
  await tap(195, 420);
  await sleep(140);
  const after = await state();
  fast.push({ i: i + 1, DT: Math.round((after.totalEarned - before.totalEarned) * 1000) / 1000 });
}
out.fastClicks = fast;

// ---------- 4a) 误触：点灰色（不可买）商店卡 ----------
const waterCard = await rectOf('[data-upgrade=water]');
const s0 = await state();
const mutBase = await ev("__r9.clicks.length");
await tap(waterCard.cx, waterCard.cy);
await sleep(400);
const s1 = await state();
out.misTapDisabledCard = { card: waterCard, price: 100, moyuBefore: Math.round(s0.moyu * 10) / 10, moyuAfter: Math.round(s1.moyu * 10) / 10, clickLog: (await ev("__r9.clicks.length")) - mutBase, shakeClass: await ev("document.querySelector('[data-upgrade=water]').classList.contains('shake')"), purchased: (s1.levels.water ?? 0) > 0, totalClicksSame: s0.totalClicks === (await state()).totalClicks };

// ---------- 4b) 误触：商店横向滑动（滑动中是否会误买）----------
const shopRect = await rectOf('#shop-cards');
const preScroll = await ev("document.getElementById('shop-cards').scrollLeft");
const preMoyu = (await state()).moyu;
await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 340, y: shopRect.cy, id: 2, radiusX: 10, radiusY: 10, force: 1 }] });
for (let i = 1; i <= 8; i++) {
  await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 340 - i * 34, y: shopRect.cy + (i % 2 ? 6 : -4), id: 2, radiusX: 10, radiusY: 10, force: 1 }] });
  await sleep(20);
}
await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await sleep(500);
const postScroll = await ev("document.getElementById('shop-cards').scrollLeft");
const s2 = await state();
out.misSwipeShop = { cardArea: shopRect, scrollLeftBefore: preScroll, scrollLeftAfter: postScroll, scrollChanged: postScroll !== preScroll, moyuDelta: Math.round((s2.moyu - preMoyu) * 10) / 10, clickLog: await ev("JSON.stringify(__r9.clicks.slice(-6))").then(JSON.parse) };

// ---------- 4c) 误触点 📔 后的封闭性 ----------
const jb = await rectOf('#btn-journal');
await tap(jb.cx, jb.cy);
await sleep(500);
const journalOpen = !(await ev("document.getElementById('journal').classList.contains('hidden')"));
// 点面板外遮罩（老人第一反应：点外面关闭）
await tap(20, 60);
await sleep(300);
const stillOpenAfterOutsideTap = !(await ev("document.getElementById('journal').classList.contains('hidden')"));
const journalTextAudit = await ev(`JSON.stringify((()=>{
  const parse=(s)=>{const m=String(s).match(/rgba?\\(([^)]+)\\)/);if(!m)return null;const p=m[1].split(',').map(Number);return [p[0],p[1],p[2],p.length>3?p[3]:1];};
  const comp=(fg,bg)=>{const a=fg[3];return [fg[0]*a+bg[0]*(1-a),fg[1]*a+bg[1]*(1-a),fg[2]*a+bg[2]*(1-a),1];};
  const lum=([r,g,b])=>{const f=(c)=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);};
  const ratio=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);};
  const bgFor=(el)=>{const chain=[];let n=el;while(n&&n!==document.documentElement){chain.push(n);n=n.parentElement;}chain.push(document.documentElement);chain.reverse();let bg=[255,255,255,1];for(const e of chain){const c=parse(getComputedStyle(e).backgroundColor);if(c&&c[3]>0.01)bg=comp(c,bg);}return bg;};
  const rows=[];
  for(const el of document.querySelectorAll('#journal *')){
    const txt=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).filter(Boolean).join(' ');
    if(!txt) continue; const r=el.getBoundingClientRect(); if(!(r.width>0&&r.height>0)) continue;
    const cs=getComputedStyle(el); const bg=bgFor(el); const fg=comp(parse(cs.color)||[0,0,0,1],bg);
    rows.push({text:txt.slice(0,36),fs:Math.round(parseFloat(cs.fontSize)*10)/10,cr:Math.round(ratio(fg,bg)*100)/100,color:cs.color});
  }
  const seen=new Set();const u=[];for(const r of rows){const k=r.text+r.fs+r.color;if(seen.has(k))continue;seen.add(k);u.push(r);}return u;
})())`).then(JSON.parse);
out.misTapJournal = { btn: jb, journalOpen, stillOpenAfterOutsideTap, closeBtn: await rectOf('#journal-close'), texts: journalTextAudit, shot: await shot("r9-journal-open") };
await ev("document.getElementById('journal').click(); document.getElementById('journal-close').click()");
await sleep(300);
out.journalClosed = await ev("document.getElementById('journal').classList.contains('hidden')");

// ---------- 5) 场景输入区大小 / 文案（canvas 提示）----------
out.stage = await rectOf('#stage');
out.canvasHint = out.canvasText.filter((e) => /戳屏幕摸鱼|丢梗|老板|连点|假装工作|忍住/.test(e.text));
out.questNow = await ev("document.getElementById('quest-text').textContent + ' | bar=' + document.getElementById('quest-bar').style.width");
out.hudText = await ev("document.getElementById('hud').innerText.replace(/\\n/g,' | ')");
out.shopCard0 = await ev("document.querySelector('[data-upgrade=coffee]').innerText.replace(/\\n/g,' | ')");
out.shopCard1 = await ev("document.querySelector('[data-upgrade=phone]').innerText.replace(/\\n/g,' | ')");
out.shopHint = await ev("document.getElementById('shop-hint').innerText + ' | hidden=' + document.getElementById('shop-hint').classList.contains('hidden')");
out.finalShot = await shot("r9-after-play");

out.raw = { clicks: await ev("JSON.stringify(__r9.clicks)").then(JSON.parse), touches: await ev("JSON.stringify(__r9.touches)").then(JSON.parse) };

writeFileSync("playtest/r9-senior-evidence.json", JSON.stringify(out, null, 2));
console.log("WROTE playtest/r9-senior-evidence.json");
console.log(JSON.stringify({ textAudit: out.textAudit.length, canvas: out.canvasText.length, slow: out.slowClicks.map((s) => s.totalClicksDelta), hud: out.hudText, quest: out.questNow }, null, 2));
ws.close();
proc.kill();
process.exit(0);
