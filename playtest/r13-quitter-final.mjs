/**
 * R13 弃坑型最终复验：线上 v0.4.0 卡弹窗三路跳过 + 连点守卫 + HUD/中文名 + 首次巡逻必为 choice + 就地结果。
 * 只读探针。输出 playtest/r13-q-final.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { openBrowser, setupMobilePage, sleep } from "./r9-cdp-lib.mjs";

const OUT = "playtest/r13-q-final.json";
const SCREENS = "playtest/r13-q-screens-final";
mkdirSync(SCREENS, { recursive: true });
const out = {};
let n = 400;
const sh = async (b, name) => { n++; const p = `${SCREENS}/${n}-${name}.png`; await b.shot(p); return p; };
const rectOf = (b, sel, text = null) => b.ev(`(() => { const els=[...document.querySelectorAll(${JSON.stringify(sel)})]; const el=${text ? `els.find(e=>e.textContent.includes(${JSON.stringify(text)}))` : "els[0]"}; if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
const tapAt = async (b, pt) => { if (!pt) return false; await b.touch("touchStart", [{ x: pt.x, y: pt.y, id: 1 }]); await b.touch("touchEnd", []); return true; };
const LIVE = "https://luojindui.github.io/moyu/";
const SNAP = `(() => {
  const q=(id)=>document.getElementById(id); const vis=(id)=>{const e=q(id);return !!e&&!e.classList.contains('hidden');};
  const t=q('dom-toast');
  return { cardsOpen:vis('cards'), skipBtn:!!(q('cards-skip')&&q('cards-skip').offsetParent!==null),
    cardTexts:[...document.querySelectorAll('#cards-body .card')].map(e=>e.innerText.replace(/\\n/g,' | ')),
    bossOpen:vis('boss-choice'), tell:q('boss-tell')?.textContent||'', opts:[...document.querySelectorAll('#boss-opts button')].map(x=>x.textContent),
    result:[...document.querySelectorAll('#boss-opts .boss-result')].map(x=>x.textContent), resultCount:document.querySelectorAll('#boss-opts .boss-result').length,
    hudCard:q('hud-card')?{text:q('hud-card').textContent,hidden:q('hud-card').classList.contains('hidden')}:null,
    toast:t?t.textContent:'', toastShown:t?t.classList.contains('show'):false,
    moyu:q('hud-moyu')?.textContent||'', choiceOpenBody:document.body.classList.contains('choice-open') };
})()`;
const esc = async (b) => { await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); };
const tapN = async (b, count, gap = 300) => { const fr = []; for (let i = 0; i < count; i++) { await tapAt(b, { x: 195, y: 430 }); await sleep(gap); fr.push({ i: i + 1, cardsOpen: (await b.ev(SNAP)).cardsOpen }); } return fr; };
async function waitCards(b, maxMs) { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { const s = await b.ev(SNAP); if (s.cardsOpen) return { at: Date.now() - t0, s }; await sleep(50); } return { at: -1, s: await b.ev(SNAP) }; }
async function waitBoss(b, maxMs) { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { const s = await b.ev(SNAP); if (s.bossOpen) return { at: Date.now() - t0, s }; await sleep(60); } return { at: -1, s: await b.ev(SNAP) }; }

// ===== S1：连点守卫 + skip 按钮 =====
{
  const b = await openBrowser({ port: 9501, tag: "r13finA" });
  await setupMobilePage(b, { url: LIVE });
  await sleep(1500);
  const S = { frames: [] };
  const tStart = Date.now();
  S.frames = await tapN(b, 10, 300); // 连点期间不应弹
  const tapEnd = Date.now();
  S.modalDuringTaps = S.frames.some((f) => f.cardsOpen);
  // 停手后等待弹窗
  const w = await waitCards(b, 4000);
  S.appearAfterStopTapsMs = w.at >= 0 ? Date.now() - tapEnd : -1;
  S.appear = { cardsOpen: w.s.cardsOpen, skipBtn: w.s.skipBtn, texts: w.s.cardTexts };
  await sh(b, "S1-appear-after-stop");
  // 1.2s 防误触：弹窗出现后立刻点第 1 张卡 → 应无效
  const card1 = await b.ev(`(() => { const el=document.querySelector('#cards-body .card'); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await tapAt(b, card1);
  await sleep(150);
  const guard = await b.ev(SNAP);
  S.guard1_2s = { stillOpen: guard.cardsOpen, hudCard: guard.hudCard };
  await sh(b, "S1-guard-tap");
  await sleep(1200); // 过守卫
  // skip 按钮
  const sk = await rectOf(b, "#cards-skip");
  S.skipRect = sk;
  await tapAt(b, sk);
  await sleep(400);
  S.hiddenAfterSkip = !(await b.ev(SNAP)).cardsOpen;
  await sh(b, "S1-after-skip");
  let stay = true; const t0 = Date.now();
  while (Date.now() - t0 < 8000) { if ((await b.ev(SNAP)).cardsOpen) stay = false; await sleep(300); }
  S.staysHidden8s = stay;
  S.hudAfterSkip = (await b.ev(SNAP)).hudCard;
  S.totalMs = Date.now() - tStart;
  out.S1_skip_guard = S;
  b.close();
}

// ===== S2：0 戳 12s fallback + 点遮罩跳过 =====
{
  const b = await openBrowser({ port: 9502, tag: "r13finB" });
  await setupMobilePage(b, { url: LIVE });
  const t0 = Date.now();
  const w = await waitCards(b, 20000);
  const S = { appearAtS: +((Date.now() - t0) / 1000).toFixed(1), found: w.at >= 0, skipBtn: w.s?.skipBtn };
  await sh(b, "S2-fallback");
  await tapAt(b, { x: 25, y: 120 }); // 点遮罩
  await sleep(500);
  S.hiddenAfterMask = !(await b.ev(SNAP)).cardsOpen;
  let stay = true; const t1 = Date.now();
  while (Date.now() - t1 < 6000) { if ((await b.ev(SNAP)).cardsOpen) stay = false; await sleep(300); }
  S.staysHidden6s = stay;
  await sh(b, "S2-after-mask");
  out.S2_mask = S;
  b.close();
}

// ===== S3：8 下门槛 + 选卡 → 中文 toast + HUD「生效中」 =====
{
  const b = await openBrowser({ port: 9503, tag: "r13finC" });
  await setupMobilePage(b, { url: LIVE });
  await sleep(1200);
  const frames = await tapN(b, 8, 300);
  const S = { taps8: frames, modalDuringTaps: frames.some((f) => f.cardsOpen) };
  const w = await waitCards(b, 3000);
  S.appearAfter8 = w.at >= 0;
  await sleep(1400);
  const cards = await b.ev(`[...document.querySelectorAll('#cards-body .card')].map(e=>e.innerText.split('\\n')[1]||'')`);
  S.offers = cards;
  const card2 = await b.ev(`(() => { const el=[...document.querySelectorAll('#cards-body .card')][1]; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await tapAt(b, card2);
  await sleep(350);
  const after = await b.ev(SNAP);
  S.afterChoose = { cardsOpen: after.cardsOpen, toast: after.toast, toastShown: after.toastShown, hudCard: after.hudCard };
  await sh(b, "S3-after-choose");
  await sleep(6000);
  S.hudAfter6s = (await b.ev(SNAP)).hudCard;
  await sh(b, "S3-hud");
  out.S3_choose = S;
  b.close();
}

// ===== S4：线上首次巡逻必为 choice + 就地结果 + Enter =====
{
  const b = await openBrowser({ port: 9504, tag: "r13finD" });
  await setupMobilePage(b, { url: LIVE });
  const t0 = Date.now();
  await sleep(1200);
  await tapN(b, 8, 300);
  const w = await waitCards(b, 3000);
  if (w.at >= 0) { await sleep(1400); const sk = await rectOf(b, "#cards-skip"); await tapAt(b, sk); }
  const S = { cardSkippedOk: !(await b.ev(SNAP)).cardsOpen };
  const bw = await waitBoss(b, 45000);
  S.firstBossAtS = bw.at >= 0 ? +((Date.now() - t0) / 1000).toFixed(1) : -1;
  S.tell = bw.s.tell;
  S.opts = bw.s.opts;
  S.boss = bw.s.bossOpen;
  await sh(b, "S4-first-choice");
  if (bw.s.bossOpen) {
    const openT = Date.now();
    // 键盘 Enter：先聚焦第 1 个按钮，再发 Enter
    const focused = await b.ev(`(() => { const el=document.querySelector('#boss-opts button'); if(!el) return false; el.focus(); return document.activeElement === el; })()`);
    S.enterFocused = focused;
    await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    const samples = [];
    for (let i = 0; i < 12; i++) { const s = await b.ev(SNAP); samples.push({ at: Date.now() - openT, bossOpen: s.bossOpen, result: s.result, toast: s.toastShown ? s.toast : "", hud: s.moyu }); await sleep(50); }
    S.afterEnter = samples;
    await sh(b, "S4-after-enter");
    await sleep(500);
    S.final = { bossOpen: (await b.ev(SNAP)).bossOpen, toast: (await b.ev(SNAP)).toast };
  }
  out.S4_firstChoice = S;
  b.close();
}

writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
