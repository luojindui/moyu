// o4：线上「<2 秒误触退出」与「≥2 秒背景点击确认」行为核对
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const BASE = "https://luojindui.github.io/moyu/";
const OUT = "playtest/r15-frag-online-shots";
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const R = { phase: "o4", steps: [] };
const write = () => writeFileSync("playtest/r15-frag-online-o4.json", JSON.stringify(R, null, 2));
try {
  await runChrome(
    async ({ port }) => {
      const c = await connect(port);
      const rawSend = c.send.bind(c);
      c.send = (m, p) => Promise.race([rawSend(m, p), new Promise((_, rej) => setTimeout(() => rej(new Error("CDP timeout " + m)), 9000))]);
      await c.send("Page.enable");
      await c.send("Runtime.enable");
      const J = (v) => JSON.stringify(v);
      const shot = async (n) => {
        try {
          const r = await c.send("Page.captureScreenshot", { format: "png" });
          writeFileSync(`${OUT}/${n}.png`, Buffer.from(r.data, "base64"));
          log("shot", n);
        } catch (e) {}
      };
      const safeEv = async (e) => {
        try {
          return await c.ev(e);
        } catch (err) {
          return { __err: String(err).slice(0, 150) };
        }
      };
      const waitFor = async (e, ms = 10000) => {
        const st = Date.now();
        while (Date.now() - st < ms) {
          const v = await safeEv(e);
          if (v) return v;
          await sleep(150);
        }
        return null;
      };
      const clickSel = (sel) => safeEv(`(()=>{const e=document.querySelector(${J(sel)}); if(!e) return 'no-el'; e.click(); return 'ok';})()`);
      const snap = () =>
        safeEv(`(()=>{try{
          const $=(id)=>document.getElementById(id), toast=$('dom-toast');
          const b=(()=>{try{return JSON.parse(localStorage.getItem('moyu-save')||'null')}catch(e){return null}})();
          return {saveArcade:b?.arcade??null,leftText:$('arcade-left').textContent,open:!$('arcade').classList.contains('hidden'),
            title:$('arcade-title').textContent,body:($('arcade-body').innerText||'').slice(0,300),
            resultShown:!!$('arcade-back'),timer:$('play-timer')?.textContent??null,
            badge:(()=>{const ab=$('btn-arcade'); const bg=ab?.querySelector('.arcade-badge'); return {text:bg?bg.textContent:null,aria:ab?.getAttribute('aria-label')};})(),
            toast:{text:(toast?.textContent||'').slice(0,160),show:!!toast?.classList.contains('show')}};
        }catch(e){return {__err:String(e).slice(0,150)};}})()`);
      const installConfirm = (answer) => safeEv(`(()=>{window.__cm=[];window.__ca=${answer};window.confirm=(m)=>{window.__cm.push(String(m));return window.__ca;};return 1;})()`);
      const backdropClick = () => safeEv(`document.getElementById('arcade').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
      const msgs = () => safeEv(`window.__cm ?? []`);

      await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
      await c.send("Page.navigate", { url: BASE });
      await sleep(500);
      await waitFor("document.readyState==='complete' && !!document.getElementById('btn-arcade')", 25000);
      await sleep(1500);
      R.bundle = await safeEv(`performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/\\/assets\\/index-[^/]+\\.js$/.test(n)).map(n=>n.split('/').pop())`);
      await installConfirm(false); // 先设为"取消"，用于验证 <2s 是否根本不弹确认
      await clickSel("#btn-arcade");
      await sleep(300);

      // 1) 开局 0.8s 误触背景：预期"无确认 + 直接结算扣次数"
      log("A: 0.8s backdrop tap");
      await clickSel('#arcade-body button[data-game="coffee"]');
      await sleep(800);
      const beforeA = await snap();
      await backdropClick();
      await sleep(500);
      const afterA = await snap();
      await shot("o4-01-under2s-backdrop");
      R.under2s = { before: { played: beforeA.saveArcade?.played, open: beforeA.open, timer: beforeA.timer }, confirmMsgs: await msgs(), after: { open: afterA.open, played: afterA.saveArcade?.played, left: afterA.leftText, toast: afterA.toast, resultShown: afterA.resultShown, badge: afterA.badge } };

      // 2) 2.5s 背景点击：预期弹确认 → 取消后游戏继续（计时继续）
      log("B: 2.5s backdrop tap, cancel");
      await installConfirm(false);
      await clickSel("#btn-arcade");
      await sleep(300);
      await clickSel('#arcade-body button[data-game="coffee"]');
      await sleep(2600);
      const beforeB = await snap();
      await backdropClick();
      await sleep(500);
      const afterB = await snap();
      await shot("o4-02-2s-backdrop-cancel");
      await sleep(1500);
      const laterB = await snap();
      R.over2sCancel = {
        before: { played: beforeB.saveArcade?.played, timer: beforeB.timer, open: beforeB.open },
        confirmMsgs: await msgs(),
        after: { open: afterB.open, played: afterB.saveArcade?.played, timer: afterB.timer, toast: afterB.toast },
        timerContinues: laterB.timer,
      };

      // 3) 2.5s 背景点击：确认 → 结算并扣次数；再验证 5s 后无幽灵
      log("C: backdrop tap, accept");
      await installConfirm(true);
      await backdropClick();
      await sleep(500);
      const afterC = await snap();
      await shot("o4-03-2s-backdrop-accept");
      R.over2sAccept = { confirmMsgs: await msgs(), open: afterC.open, played: afterC.saveArcade?.played, left: afterC.leftText, toast: afterC.toast, resultShown: afterC.resultShown };
      await sleep(5000);
      const ghost = await snap();
      R.over2sAccept.ghostAfter5s = { played: ghost.saveArcade?.played, open: ghost.open, toast: ghost.toast };
      // 4) 第 3 次消耗：开一局 1.2s 直接 ✕（≥2s 才确认；1.2s 无确认）→ 应扣次数
      log("D: 1.2s X close");
      await installConfirm(false);
      await clickSel("#btn-arcade");
      await sleep(300);
      await clickSel('#arcade-body button[data-game="findboss"]');
      await sleep(1200);
      const beforeD = await snap();
      await clickSel("#arcade-close");
      await sleep(400);
      const afterD = await snap();
      R.under2sX = { confirmMsgs: await msgs(), before: { played: beforeD.saveArcade?.played }, after: { open: afterD.open, played: afterD.saveArcade?.played, left: afterD.leftText, toast: afterD.toast, badge: afterD.badge } };
      await shot("o4-04-under2s-x-close");
      // 5) 3 次用完后入口状态
      const done = await snap();
      R.finalEntry = { badge: done.badge, saveArcade: done.saveArcade };
      R.durationMs = Date.now() - Date.parse(new Date().toISOString());
      c.close();
    },
    { timeoutMs: 120_000 },
  );
} catch (e) {
  R.crash = String(e?.stack || e).slice(0, 1200);
  log("CRASH", R.crash.slice(0, 300));
}
write();
console.log("DONE o4");