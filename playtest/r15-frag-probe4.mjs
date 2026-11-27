// r15-frag 探针 v4：当前工作树回归核对（node playtest/r15-frag-probe4.mjs）
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const BASE = "http://127.0.0.1:5173/";
const OUT = "playtest/r15-frag-shots";
mkdirSync(OUT, { recursive: true });
const WATCH = ["src/ui/arcade.ts", "src/engine/minigames.ts", "src/style.css", "src/main.ts", "index.html"];
const hashFiles = () => Object.fromEntries(WATCH.map((f) => [f, createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 12)]));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const R = { phase: "s6-latest", hashesBefore: hashFiles(), steps: [] };
const write = () => {
  R.hashesAfter = hashFiles();
  writeFileSync("playtest/r15-frag-s6-latest.json", JSON.stringify(R, null, 2));
  log("evidence written");
};
try {
  await runChrome(
    async ({ port }) => {
      const c = await connect(port);
      const rawSend = c.send.bind(c);
      c.send = (m, p) => Promise.race([rawSend(m, p), new Promise((_, rej) => setTimeout(() => rej(new Error("CDP timeout " + m)), 8000))]);
      await c.send("Page.enable");
      await c.send("Runtime.enable");
      const J = (v) => JSON.stringify(v);
      const shot = async (n) => {
        try {
          const r = await c.send("Page.captureScreenshot", { format: "png" });
          writeFileSync(`${OUT}/${n}.png`, Buffer.from(r.data, "base64"));
          log("shot", n);
        } catch (e) {
          log("shot fail", n);
        }
      };
      const safeEv = async (e) => {
        try {
          return await c.ev(e);
        } catch (err) {
          return { __err: String(err).slice(0, 160) };
        }
      };
      const waitFor = async (e, ms = 8000) => {
        const st = Date.now();
        while (Date.now() - st < ms) {
          const v = await safeEv(e);
          if (v) return v;
          await sleep(120);
        }
        return null;
      };
      const clickSel = (sel) => safeEv(`(()=>{const e=document.querySelector(${J(sel)}); if(!e) return 'no-el'; e.click(); return 'ok';})()`);
      const snap = () =>
        safeEv(`(()=>{try{
          const s=__MOYU__.state,$=(id)=>document.getElementById(id),toast=$('dom-toast');
          return {moyu:s.moyu,arcade:s.arcade,hudIdle:$('hud-idle').textContent,leftText:$('arcade-left').textContent,
            open:!$('arcade').classList.contains('hidden'),title:$('arcade-title').textContent,
            body:($('arcade-body').innerText||'').slice(0,600),resultShown:!!$('arcade-back'),
            bossOpen:!$('boss-choice').classList.contains('hidden'),
            toast:{text:(toast?.textContent||'').slice(0,200),show:!!toast?.classList.contains('show')}};
        }catch(e){return {__err:String(e).slice(0,150)};}})()`);

      // 移动端加载
      await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
      await c.send("Page.navigate", { url: BASE });
      await sleep(400);
      await waitFor("document.readyState==='complete' && !!window.__MOYU__ && !!document.getElementById('btn-arcade')", 15000);
      await sleep(900);
      await shot("s6-01-first-screen");
      // 打开菜单，观察 left 文案是否被 refresh 覆盖
      await clickSel("#btn-arcade");
      await sleep(120);
      R.leftTextAtOpenImmediate = await safeEv(`document.getElementById('arcade-left').textContent`);
      await sleep(900);
      R.leftTextAfter900ms = await safeEv(`document.getElementById('arcade-left').textContent`);
      await shot("s6-02-menu");
      // 1) 找老板分数显示是否修复
      await clickSel('#arcade-body button[data-game="findboss"]');
      await sleep(350);
      await safeEv(`(()=>{window.__ab=setInterval(()=>{const b=document.querySelector('#play-grid .face.boss'); if(b)b.click();},90);return 1;})()`);
      await sleep(1800);
      R.findbossScoreDisplay = {
        score: await safeEv(`document.getElementById('play-score')?.textContent`),
        hint: await safeEv(`document.querySelector('#arcade-body .arcade-hint')?.textContent`),
        timer: await safeEv(`document.getElementById('play-timer')?.textContent`),
      };
      await shot("s6-03-findboss-score");
      // 2) 小游戏进行中触发老板 choice：应被推迟（anyModalOpen 含 arcade？）
      const beforeBoss = await snap();
      await safeEv(`__MOYU__.forceBoss("choice")`);
      const appeared = await waitFor(`!document.getElementById('boss-choice').classList.contains('hidden')`, 6000);
      R.bossDeferred = {
        appearedWithin6s: !!appeared,
        bossOpen: (await snap()).bossOpen,
        arcadeOpen: (await snap()).open,
        timer: await safeEv(`document.getElementById('play-timer')?.textContent`),
      };
      await shot("s6-04-boss-during-game");
      // 3) 局内退出仍会结算并扣次数？
      const playedBefore = beforeBoss.arcade.played;
      await clickSel("#arcade-close");
      await sleep(400);
      const afterQuit = await snap();
      R.quitMidGame = {
        playedBefore, playedAfter: afterQuit.arcade.played, closed: !afterQuit.open,
        toast: afterQuit.toast, resultShown: afterQuit.resultShown, left: afterQuit.leftText,
      };
      await shot("s6-05-after-quit");
      // 4) 再开一次：结算过一局后菜单/锁态文案
      await safeEv(`clearInterval(window.__ab)`);
      await clickSel("#btn-arcade");
      await sleep(900);
      R.reopen = {
        left: await safeEv(`document.getElementById('arcade-left').textContent`),
        body: (await snap()).body,
        played: (await snap()).arcade.played,
      };
      await shot("s6-06-reopen");
      // 5) 打完一局看结算（找老板 30s 太久 → 用咖啡 30s？改用找老板但快速点击 30s 不划算）
      //    改为：确认"新纪录"逻辑（用咖啡快速打完 30s 太慢，跳过；由 s3b 已覆盖）
      await clickSel("#arcade-close");
      c.close();
    },
    { timeoutMs: 120_000 },
  );
} catch (e) {
  R.crash = String(e?.stack || e).slice(0, 1200);
  log("CRASH", R.crash.slice(0, 300));
}
write();
console.log("DONE");