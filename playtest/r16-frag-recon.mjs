// r16 终验玩家 recon：线上新玩家首屏 + dev 中局四系统面板 DOM 结构
// 运行：node playtest/r16-frag-recon.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const BASE_ONLINE = "https://luojindui.github.io/moyu/";
const BASE_DEV = "http://127.0.0.1:5173/";
const OUT = "playtest/r16-shots";
mkdirSync(OUT, { recursive: true });
const R = { startedAt: new Date().toISOString(), online: {}, dev: {}, errors: [] };
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

await runChrome(async ({ port }) => {
  const c = await connect(port);
  const rawSend = c.send.bind(c);
  c.send = (m, p) => Promise.race([rawSend(m, p), new Promise((_, rej) => setTimeout(() => rej(new Error("CDP timeout " + m)), 12000))]);
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  const J = (v) => JSON.stringify(v);
  const ev = async (expr) => {
    try { return await c.ev(expr); } catch (e) { return { __err: String(e).slice(0, 300) }; }
  };
  const shot = async (n) => {
    try {
      const r = await c.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${OUT}/${n}.png`, Buffer.from(r.data, "base64"));
      log("shot", n);
    } catch (e) { log("shot FAIL", n, String(e).slice(0, 80)); }
  };
  const waitFor = async (expr, ms = 15000) => {
    const st = Date.now();
    while (Date.now() - st < ms) {
      if (await ev(expr)) return true;
      await sleep(120);
    }
    return false;
  };
  const nav = async (url) => {
    await c.send("Page.navigate", { url });
    await sleep(400);
    await waitFor("document.readyState==='complete' && !!document.getElementById('btn-arcade')", 30000);
    await sleep(1200);
  };
  const inventory = () =>
    ev(`(()=>{
      const $=(id)=>document.getElementById(id);
      const rect=(e)=>{const b=e.getBoundingClientRect();return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}};
      const vis=(e)=>!!e&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;
      const btn=[...document.querySelectorAll('button')].filter(vis).map(b=>({id:b.id||null,aria:b.getAttribute('aria-label'),text:(b.textContent||'').trim().slice(0,50),disabled:!!b.disabled,rect:rect(b),badge:(b.querySelector('.badge,.arcade-badge,.energy-badge')?.textContent||null)}));
      return {
        viewport:{w:innerWidth,h:innerHeight},
        title:document.title,
        hudMoyu:$('hud-moyu')?.textContent, hudSub:$('hud')?.querySelector('.hud-sub')?.innerText,
        quest:{hidden:$('quest')?.classList.contains('hidden'),text:$('quest-text')?.textContent},
        shopCards:[...document.querySelectorAll('#shop-cards > *')].map(e=>({cls:e.className,text:(e.innerText||'').replace(/\\n+/g,' | ').slice(0,160)})),
        buttons:btn,
        panels:{journal:vis($('journal')),team:vis($('team')),arcade:vis($('arcade')),cards:vis($('cards')),boss:vis($('boss-choice')),welcome:vis($('welcome'))},
        bodyText:(document.body.innerText||'').replace(/\\n{2,}/g,'\\n').slice(0,2500),
        save:(()=>{try{const b=JSON.parse(localStorage.getItem('moyu-save')||'null');return b?{v:b.v,moyu:b.moyu,totalEarned:b.totalEarned,levels:b.levels,savedAt:b.savedAt,createdAt:b.createdAt,daily:b.daily,team:b.team,talents:b.talents,decor:b.decor,energy:b.energy,arcade:b.arcade,cards:b.cards}:null}catch(e){return {err:String(e)}}})(),
        hasDevHook:typeof window.__MOYU__,
      };
    })()`);
  const tap = async (x, y) => {
    await c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, radiusX: 1, radiusY: 1 }] });
    await sleep(40);
    await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(60);
  };
  const tapCenter = async (sel) => {
    const r = await ev(`(()=>{const e=document.querySelector(${J(sel)});if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`);
    if (r && !r.__err) { await tap(r.x, r.y); return true; }
    return false;
  };
  const clickSel = (sel) => ev(`(()=>{const e=document.querySelector(${J(sel)});if(!e)return 'no-el';if(e.disabled)return 'disabled';e.click();return 'ok';})()`);
  const clickData = (act, id, extra) =>
    ev(`(()=>{const s=${J(`button[data-act="${act}"]${id ? `[data-id="${id}"]` : ""}${extra ? `[${extra}]` : ""}`)};const e=document.querySelector(s);if(!e)return {err:'no-el',s};if(e.disabled)return {err:'disabled',s};e.click();return {ok:true,s};})()`);
  const panelHTML = (id) => ev(`document.getElementById(${J(id)})?.innerHTML?.slice(0,6000) ?? null`);

  // ---------- ONLINE 新玩家 ----------
  await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await nav(BASE_ONLINE);
  R.online.boot = await ev(`({ready:document.readyState, hook:typeof window.__MOYU__, nav:performance.now()|0, resources:performance.getEntriesByType('resource').length})`);
  R.online.firstScreen = await inventory();
  await shot("recon-online-01-first");

  // 戳 10 下（学生自然点击）
  const canvas = await ev(`(()=>{const r=document.getElementById('stage').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
  for (let i = 0; i < 10; i++) {
    await tap(canvas.x + canvas.w * (0.3 + 0.4 * Math.random()), canvas.y + canvas.h * (0.4 + 0.3 * Math.random()));
    await sleep(220);
  }
  await sleep(1500);
  R.online.after10Taps = await inventory();
  await shot("recon-online-02-after10");

  // 卡片弹窗
  const cardsOpen = await ev(`!document.getElementById('cards').classList.contains('hidden')`);
  if (cardsOpen) {
    R.online.cards = await ev(`[...document.querySelectorAll('#cards .card')].map(c=>({id:c.dataset.id,cls:c.className,text:(c.innerText||'').replace(/\\n+/g,' | ').slice(0,240)}))`);
    R.online.cardsSkipBtn = await ev(`document.getElementById('cards-skip')?.textContent`);
    await shot("recon-online-03-cards");
    await ev(`document.getElementById('cards').classList.add('hidden')`); // 先不选，看别的
  } else {
    R.online.cards = null;
  }

  // shop DOM
  R.online.shopHTML = await ev(`document.getElementById('shop-cards')?.innerHTML?.slice(0,5000)`);
  // journal
  await tapCenter("#btn-journal");
  await sleep(500);
  R.online.journal = await ev(`(()=>{const e=document.getElementById('journal');return {vis:!e.classList.contains('hidden'), text:(e.innerText||'').replace(/\\n{2,}/g,'\\n').slice(0,2500), buttons:[...e.querySelectorAll('button')].map(b=>({id:b.id,text:(b.textContent||'').trim().slice(0,40),disabled:b.disabled}))};})()`);
  await shot("recon-online-04-journal");
  await tapCenter("#journal-close");
  await sleep(400);

  // arcade menu
  await tapCenter("#btn-arcade");
  await sleep(600);
  R.online.arcade = await ev(`(()=>{const e=document.getElementById('arcade');return {vis:!e.classList.contains('hidden'),left:document.getElementById('arcade-left')?.textContent,html:document.getElementById('arcade-body')?.innerHTML?.slice(0,4000)};})()`);
  await shot("recon-online-05-arcade");
  await ev(`document.getElementById('arcade').classList.add('hidden')`);

  // team panel (online 新玩家没钱)
  await tapCenter("#btn-team");
  await sleep(500);
  R.online.team = await ev(`(()=>{const e=document.getElementById('team');return {vis:!e.classList.contains('hidden'),text:(e.innerText||'').replace(/\\n{2,}/g,'\\n').slice(0,2000),html:document.getElementById('team-body')?.innerHTML?.slice(0,4000)};})()`);
  await shot("recon-online-06-team");
  await ev(`document.getElementById('team').classList.add('hidden')`);

  R.online.errors = c.errors.slice(0, 5);

  // ---------- DEV 中局 ----------
  await nav(BASE_DEV);
  R.dev.boot = await ev(`({hook:typeof window.__MOYU__, fps:window.__MOYU__?.fps, state:!!window.__MOYU__?.state})`);
  // 建一个"已开荒一天"的中局：15 万摸鱼值
  await ev(`window.__MOYU__.reset()`);
  await sleep(300);
  await ev(`window.__MOYU__.grant(150000)`);
  await sleep(1200);
  R.dev.afterGrant = await inventory();
  await shot("recon-dev-01-grant");

  // team: 同事 / 天赋 / 工位
  await tapCenter("#btn-team");
  await sleep(600);
  R.dev.teamColleaguesHTML = await panelHTML("team-body");
  await shot("recon-dev-02-team-colleagues");
  await clickSel("#tab-talents");
  await sleep(500);
  R.dev.teamTalentsHTML = await panelHTML("team-body");
  await shot("recon-dev-03-team-talents");
  await clickSel("#tab-decor");
  await sleep(500);
  R.dev.teamDecorHTML = await panelHTML("team-body");
  await shot("recon-dev-04-team-decor");
  R.dev.teamText = await ev(`document.getElementById('team').innerText.replace(/\\n{2,}/g,'\\n').slice(0,3000)`);
  await ev(`document.getElementById('team').classList.add('hidden')`);

  // 招募老周
  R.dev.recruit = await clickData("recruit", "zhou");
  await sleep(300);
  R.dev.afterRecruit = await ev(`(()=>{try{return JSON.parse(localStorage.getItem('moyu-save')).team}catch(e){return String(e)}})()`);

  R.dev.errors = c.errors.slice(0, 10);
  console.log("errors:", c.errors.slice(0, 5));
  writeFileSync("playtest/r16-recon.json", JSON.stringify(R, null, 2));
  log("evidence -> playtest/r16-recon.json");
});
log("done");