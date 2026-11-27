/**
 * 终验·管理党 线上/Dev 行为探针（v0.5.0，HEAD 9760eab）
 * 用法：node playtest/final-mgr-live.mjs [url] [--grant]
 * 证据：playtest/final-mgr/live-*.json / live-*.png
 */
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { writeFileSync, mkdirSync } from "node:fs";

const URL_ARG = process.argv[2] || "https://luojindui.github.io/moyu/";
const GRANT = process.argv.includes("--grant");
const OUT = "playtest/final-mgr";
mkdirSync(OUT, { recursive: true });
const tag = URL_ARG.includes("5173") ? "dev" : "live";

await runChrome(async ({ port }) => {
  const c = await connect(port);
  const { send, ev } = c;
  await send("Page.enable", {});
  await send("Runtime.enable", {});
  const errors = [];
  c.errors.forEach?.(() => undefined);
  const out = { url: URL_ARG, tag, grant: GRANT, steps: {}, texts: {}, errors: [], shots: [] };

  const evalSafe = async (expr) => {
    try { return await ev(expr); } catch (e) { return { __err: String(e).slice(0, 200) }; }
  };
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    const p = `${OUT}/${tag}-${name}.png`;
    writeFileSync(p, Buffer.from(r.data, "base64"));
    out.shots.push(p);
    return p;
  };
  const txt = async (sel) => evalSafe(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});return e?e.innerText:null})()`);

  // 1) 打开线上
  await send("Page.navigate", { url: URL_ARG });
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    const ready = await evalSafe("document.querySelector('#hud-moyu')?.textContent");
    if (ready !== null && ready !== undefined && ready !== "") break;
  }
  await sleep(1200);
  out.steps.boot = {
    title: await evalSafe("document.title"),
    hudMoyu: await txt("#hud-moyu"),
    hudClick: await txt("#hud-click"),
    hudIdle: await txt("#hud-idle"),
    hudRank: await txt("#hud-rank"),
    hasMoyuHook: await evalSafe("typeof window.__MOYU__"),
    save: await evalSafe("Object.keys(localStorage)"),
    cardsOpen: await evalSafe("!document.getElementById('cards').classList.contains('hidden')"),
  };
  await shot("01-boot");

  // 2) 点 20 下（真实鼠标事件走 canvas 中心；卡片弹窗要 8 击或开机 12s 后才弹）
  const rect = await evalSafe(`(()=>{const r=document.getElementById('stage').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`);
  for (let i = 0; i < 20; i++) {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x + (i % 5) * 8, y: rect.y + (i % 3) * 8, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x + (i % 5) * 8, y: rect.y + (i % 3) * 8, button: "left", clickCount: 1 });
    await sleep(70);
  }
  await sleep(500);
  out.steps.afterTaps = {
    hudMoyu: await txt("#hud-moyu"),
    hudCombo: await evalSafe("document.getElementById('hud-combo').className"),
    questText: await evalSafe("document.getElementById('quest-text')?.textContent"),
    dailyGoals: await evalSafe(`[...document.querySelectorAll('#journal-goals .goal')].map(e=>e.innerText)`),
  };
  await shot("03-after-taps");

  // 2b) 卡片弹窗（点击≥8 后应弹出）
  await sleep(900);
  const cardInfo = await evalSafe(`(()=>{
    const root=document.getElementById('cards');
    const open=root && !root.classList.contains('hidden');
    const cards=[...document.querySelectorAll('#cards .card, #cards [data-card]')].map(e=>e.innerText.slice(0,160));
    return {open, count: cards.length, cards, html: (root?.innerText||'').slice(0,900)};
  })()`);
  out.steps.cardModal = cardInfo;
  if (cardInfo && cardInfo.open) {
    await shot("02-card-modal");
    const clicked = await evalSafe(`(()=>{
      const btn=[...document.querySelectorAll('#cards .card, #cards button')].find(e=>e.offsetParent!==null && !/不选/.test(e.innerText));
      if(!btn) return 'none'; btn.click(); return btn.innerText.slice(0,80);
    })()`);
    await sleep(500);
    out.steps.cardChosen = { clicked, cardTag: await txt("#hud-card"), toast: await txt("#dom-toast") };
    await shot("02b-card-chosen");
  }

  // 4) 商店：★最优 / 还差提示 / 价格
  out.steps.shop = await evalSafe(`(()=>[...document.querySelectorAll('.shop-card')].slice(0,9).map(c=>({
    name:c.querySelector('.shop-name')?.textContent, next:c.querySelector('.shop-next')?.textContent,
    value:c.querySelector('.shop-value')?.textContent, cost:c.querySelector('.shop-cost b')?.textContent,
    remain:c.querySelector('.shop-remain')?.textContent, disabled:c.disabled })))()`);
  if (GRANT) {
    await evalSafe("window.__MOYU__.grant(1e12);1");
    await sleep(300);
  }

  // 5) 👥 小队面板（同事/天赋/工位）
  await evalSafe("document.getElementById('btn-team').click();1");
  await sleep(500);
  out.steps.teamPanel = {
    open: await evalSafe("!document.getElementById('team').classList.contains('hidden')"),
    tabs: await evalSafe(`[...document.querySelectorAll('#team .team-tabs .tab')].map(e=>e.innerText)`),
    points: await evalSafe("document.getElementById('team-points')?.textContent"),
    firstTabText: (await txt("#team-body"))?.slice(0, 900),
  };
  await shot("04-team-colleagues");

  // dev+grant：招募老周，读派遣按钮（净收益/h 与 ★）
  if (GRANT) {
    const recruited = await evalSafe(`(()=>{const b=document.querySelector('#team-body button[data-act="recruit"][data-id="zhou"]'); if(!b||b.disabled) return false; b.click(); return true;})()`);
    await sleep(500);
    out.steps.recruit = recruited;
    out.steps.dispatchButtons = await evalSafe(`(()=>[...document.querySelectorAll('#team-body button[data-act="dispatch"]')].map(b=>b.innerText.replace(/\\n/g,' ')))()`);
    await evalSafe(`(()=>{const b=[...document.querySelectorAll('#team-body button[data-act="dispatch"]')][0]; if(!b) return false; b.click(); return true;})()`);
    await sleep(400);
    out.steps.colleagueCards = await evalSafe(`(()=>[...document.querySelectorAll('#team-body .mate')].slice(0,3).map(e=>e.innerText.slice(0,260)))()`);
    await shot("05-team-dispatch");
  }

  // 天赋页
  await evalSafe("document.querySelector('#team .team-tabs .tab:nth-child(2)').click();1");
  await sleep(400);
  out.steps.talentsTab = { text: (await txt("#team-body"))?.slice(0, 1200) };
  await shot("06-talents");
  // 工位页
  await evalSafe("document.querySelector('#team .team-tabs .tab:nth-child(3)').click();1");
  await sleep(400);
  out.steps.decorTab = { text: (await txt("#team-body"))?.slice(0, 1600) };
  out.steps.energyButtons = await evalSafe(`(()=>[...document.querySelectorAll('#team-body [data-act="energy"]')].map(e=>({text:e.innerText.replace(/\\n/g,' ').slice(0,120), disabled:e.disabled??null, rowDisabled:e.dataset?.disabled})))()`);
  out.steps.energyComboBtn = await evalSafe(`(()=>{const b=document.querySelector('#team-body [data-act="energy-all"]');return b?{text:b.innerText,disabled:b.disabled}:null})()`);
  await shot("07-decor-energy");

  // dev+grant：买家具 + 精力
  if (GRANT) {
    const buy = await evalSafe(`(()=>{const b=document.querySelector('#team-body button[data-act="decor"][data-id="plant"]'); if(!b) return 'nobtn'; if(b.disabled) return 'disabled'; b.click(); return 'ok';})()`);
    await sleep(400);
    out.steps.buyDecor = { result: buy, summary: await txt(".team-summary"), toast: await txt("#dom-toast") };
    const combo = await evalSafe(`(()=>{const b=document.querySelector('#team-body [data-act="energy-all"]'); if(!b) return 'nobtn'; if(b.disabled) return 'disabled:'+b.innerText; b.click(); return 'ok';})()`);
    await sleep(500);
    out.steps.energyCombo = { result: combo, text: (await txt("#team-body"))?.slice(0, 500), toast: await txt("#dom-toast") };
    await shot("08-after-decor-energy");
  }
  await evalSafe("document.getElementById('team-close').click();1");

  // 6) 🎮 摸鱼站
  await evalSafe("document.getElementById('btn-arcade').click();1");
  await sleep(500);
  out.steps.arcade = {
    open: await evalSafe("!document.getElementById('arcade').classList.contains('hidden')"),
    text: (await evalSafe("document.getElementById('arcade')?.innerText"))?.slice(0, 900),
  };
  await shot("09-arcade");
  await evalSafe("(()=>{const b=document.querySelector('#arcade .arcade-close, #arcade [data-close]'); if(b) b.click();})()");
  await sleep(300);

  // 7) 📔 日报/图鉴/转生/关于
  await evalSafe("document.getElementById('btn-journal').click();1");
  await sleep(600);
  out.steps.journal = {
    version: await evalSafe("document.getElementById('about-version')?.textContent"),
    notes: await evalSafe("document.getElementById('about-notes')?.textContent"),
    prestigeDesc: await evalSafe("document.querySelector('.prestige-desc:not(#about-notes)')?.textContent"),
    prestigeInfo: await evalSafe("document.getElementById('prestige-info')?.textContent"),
    prestigeBtn: await evalSafe("document.getElementById('prestige-btn')?.textContent"),
    prestigeDisabled: await evalSafe("document.getElementById('prestige-btn')?.disabled"),
    stats: await evalSafe(`(()=>[...document.querySelectorAll('#stats-list .stat-row')].map(e=>e.innerText.replace(/\\n/g,' ')))()`),
    goals: await evalSafe(`(()=>[...document.querySelectorAll('#journal-goals .goal')].map(e=>e.innerText))()`),
    claimBtn: await evalSafe("document.getElementById('journal-claim')?.textContent"),
    saveCode: await evalSafe("document.getElementById('savecode')?.placeholder"),
  };
  await shot("10-journal");
  await evalSafe("document.getElementById('journal-close').click();1");

  // 8) 控制台错误 + 移动端截图
  out.errors = c.errors.slice(0, 20);
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  await shot("11-mobile");
  await send("Emulation.clearDeviceMetricsOverride", {});
  await sleep(300);
  await shot("12-desktop");

  writeFileSync(`${OUT}/${tag}-evidence.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ tag, steps: Object.keys(out.steps), errors: out.errors.length, shots: out.shots.length }));
  console.log(JSON.stringify(out.steps, null, 1).slice(0, 6000));
  c.close();
}, { timeoutMs: 90_000 });
console.log("CHROME_DONE");