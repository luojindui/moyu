// r14 复验：线上 3 次连续打开（同一存档，模拟碎片党一天开 3 次）
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(".scratch/r14-frag-verify");
mkdirSync(OUT, { recursive: true });
const LIVE = "https://luojindui.github.io/moyu/";
const R = { meta: { url: LIVE, note: "同一 Chrome profile / 同一存档，连续 reload 3 次" }, opens: [] };
let send, ev;
const js = (code) => ev(`(()=>{${code}})()`);
async function waitFor(expr, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    let v = false;
    try { v = await ev(expr); } catch { /* ignore */ }
    if (v) return { ok: true, ms: Date.now() - t0 };
    await sleep(100);
  }
  return { ok: false, ms: Date.now() - t0 };
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, "base64"));
}
async function tapSel(sel) {
  const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const b=e.getBoundingClientRect();if(b.width<1||b.height<1)return {bad:true};const cx=b.left+b.width/2,cy=b.top+b.height/2;const h=document.elementFromPoint(cx,cy);return {x:cx,y:cy,w:+b.width.toFixed(1),h:+b.height.toFixed(1),text:(e.textContent||'').trim().slice(0,50),hit:h?(h.id||(typeof h.className==='string'?h.className:'')||h.tagName):null,hitSelf:!!h&&(h===e||e.contains(h))};})()`);
  if (!r || r.bad) return { ok: false, rect: r };
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await sleep(35);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await sleep(180);
  return { ok: true, rect: r };
}
const hudSnap = () => js(`
  const btn = document.getElementById('btn-team');
  const eb = btn.querySelector('.energy-badge');
  return {
    energyBadge: eb ? eb.textContent : null,
    badgeRect: eb ? (() => { const r = eb.getBoundingClientRect(); return { x: +r.x.toFixed(0), y: +r.y.toFixed(0), w: +r.width.toFixed(0), h: +r.height.toFixed(0) }; })() : null,
    aria: btn.getAttribute('aria-label'),
    overlays: {
      cards: !document.getElementById('cards').classList.contains('hidden'),
      team: !document.getElementById('team').classList.contains('hidden'),
      welcome: !document.getElementById('welcome').classList.contains('hidden'),
      boss: !document.getElementById('boss-choice').classList.contains('hidden'),
    },
  };
`);
const decorSnap = () => js(`
  const body = document.getElementById('team-body');
  if (!body) return null;
  const raw = body.innerText || '';
  const btns = [...body.querySelectorAll('button')].map((b) => ({ act: b.dataset.act, id: b.dataset.id ?? '', text: (b.textContent ?? '').trim(), disabled: b.disabled }));
  return {
    activeTab: document.querySelector('.team-tabs .tab.active')?.textContent ?? null,
    enabledActions: btns.filter((b) => !b.disabled && b.act !== 'energy-all').length,
    energyLine: (raw.match(/今日精力[^\\n]*/) ?? [null])[0],
    oneClick: btns.find((b) => b.act === 'energy-all')?.text ?? null,
    onCount: body.querySelectorAll('.talent.on').length,
    summary: document.querySelector('.team-summary')?.innerText ?? '',
  };
`);
async function boot() {
  const t0 = Date.now();
  await send("Page.navigate", { url: LIVE });
  const b = await waitFor(`document.readyState === 'complete' && !!document.getElementById('hud-moyu')`, 25000);
  await sleep(900);
  return { boot: b, ms: Date.now() - t0 };
}

async function main() {
  await runChrome(async ({ port }) => {
    const c = await connect(port);
    send = c.send; ev = c.ev;
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });

    /* OPEN 1：首日首开——从首页角标到精力用完 */
    {
      const t0 = Date.now();
      const o = { name: "打开1（首开）", steps: [], notes: [] };
      o.boot = await boot();
      o.hudBefore = await hudSnap();
      o.steps.push("看到 HUD 「精力 " + (o.hudBefore.energyBadge ?? "无") + "」角标");
      await shot("open1-01-home");
      await tapSel("#btn-team"); await waitFor(`!document.getElementById('team').classList.contains('hidden')`, 2500); await sleep(250);
      o.steps.push("点 👥（落同事页）");
      await tapSel("#tab-decor"); await waitFor(`document.querySelector('.team-tabs .tab.active')?.textContent === '工位'`, 2500); await sleep(350);
      o.steps.push("点「工位」");
      o.decorOnEnter = await decorSnap();
      await shot("open1-02-decor");
      // 等摸鱼卡（首日 12s 门控）——看它会不会盖住工位
      const card = await waitFor(`!document.getElementById('cards').classList.contains('hidden')`, 15000);
      o.cardInterrupt = card.ok;
      if (card.ok) {
        o.cardStack = await js(`const team=!document.getElementById('team').classList.contains('hidden'); const buy=document.querySelector('#team-body .talent button'); const r=buy.getBoundingClientRect(); const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2); return { teamStillOpen: team, hit: hit?((hit.id||'')+' '+(typeof hit.className==='string'?hit.className:'')).trim().slice(0,40):null };`);
        await shot("open1-03-cards-over-decor");
        await tapSel("#cards-skip"); await waitFor(`document.getElementById('cards').classList.contains('hidden')`, 2500);
        o.steps.push("摸鱼卡盖住工位 → 点「今天先不选」（+1 步）");
      }
      // ② 一键全用
      const one = await tapSel(`#team-body button[data-act="energy-all"]`);
      await sleep(400);
      o.oneClick = { tapOk: one.ok, text: one.rect?.text, after: await decorSnap(), toast: await js(`const t=document.getElementById('dom-toast');return {text:t.textContent, visible:parseFloat(getComputedStyle(t).opacity)>0.5};`), hudAfter: await hudSnap() };
      o.steps.push("点「一键全用」（1 步）");
      await shot("open1-04-oneclick");
      // 关面板
      await tapSel("#team-close");
      await waitFor(`document.getElementById('team').classList.contains('hidden')`, 2500);
      o.tapsTarget = 3; // 理想路径：👥→工位→一键全用
      o.tapsActual = card.ok ? 4 : 3;
      o.msTotal = Date.now() - t0;
      R.opens.push(o);
    }

    /* OPEN 2：同日再开（reload） */
    {
      const t0 = Date.now();
      const o = { name: "打开2（同日稍后）", steps: [] };
      o.boot = await boot();
      o.hudBefore = await hudSnap();
      await shot("open2-01-home");
      await tapSel("#btn-team"); await waitFor(`!document.getElementById('team').classList.contains('hidden')`, 2500); await sleep(250);
      await tapSel("#tab-decor"); await waitFor(`document.querySelector('.team-tabs .tab.active')?.textContent === '工位'`, 2500); await sleep(350);
      o.decor = await decorSnap();
      await shot("open2-02-decor-dead");
      o.cardInterrupt = !(await hudSnap()).overlays.cards && false;
      o.meaningfulActions = o.decor.enabledActions;
      o.taps = 2;
      o.msTotal = Date.now() - t0;
      await tapSel("#team-close");
      R.opens.push(o);
    }

    /* OPEN 3：同日再开（reload，模拟第 3 次打开） */
    {
      const t0 = Date.now();
      const o = { name: "打开3（同日第 3 次）", steps: [] };
      o.boot = await boot();
      o.hudBefore = await hudSnap();
      await tapSel("#btn-team"); await waitFor(`!document.getElementById('team').classList.contains('hidden')`, 2500); await sleep(250);
      await tapSel("#tab-decor"); await waitFor(`document.querySelector('.team-tabs .tab.active')?.textContent === '工位'`, 2500); await sleep(350);
      o.decor = await decorSnap();
      await shot("open3-01-decor-dead");
      o.meaningfulActions = o.decor.enabledActions;
      o.taps = 2;
      o.msTotal = Date.now() - t0;
      await tapSel("#team-close");
      R.opens.push(o);
    }

    c.close();
  }, { timeoutMs: 150_000, port: 9985 });

  writeFileSync(`${OUT}/evidence-opens.json`, JSON.stringify(R, null, 2));
  console.log(JSON.stringify(R.opens, null, 2));
}
await main();