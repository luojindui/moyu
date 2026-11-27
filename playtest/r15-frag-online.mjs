// r15-frag 线上复验探针（生产包）：node playtest/r15-frag-online.mjs <o1|o2|o3>
// 目标：https://luojindui.github.io/moyu/ （生产包无 __MOYU__，状态读 localStorage "moyu-save"）
// Chrome 统一由 lib/chrome.mjs 管理（独立 user-data-dir = 无痕），不残留进程。
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const PHASE = process.argv[2] || "o1";
const BASE = "https://luojindui.github.io/moyu/";
const OUT = "playtest/r15-frag-online-shots";
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const R = { phase: PHASE, meta: { startedAt: new Date().toISOString(), url: BASE }, errors: [], steps: [] };
const step = (s) => {
  R.steps.push({ t: +((Date.now() - t0) / 1000).toFixed(1), s });
  log("step", s);
};
const write = () => {
  R.meta.finishedAt = new Date().toISOString();
  writeFileSync(`playtest/r15-frag-online-${PHASE}.json`, JSON.stringify(R, null, 2));
  log("evidence ->", `playtest/r15-frag-online-${PHASE}.json`);
};

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
        } catch (e) {
          log("shot FAIL", n, String(e).slice(0, 60));
        }
      };
      const safeEv = async (expr) => {
        try {
          return await c.ev(expr);
        } catch (e) {
          return { __err: String(e).slice(0, 200) };
        }
      };
      const waitFor = async (expr, ms = 10000) => {
        const st = Date.now();
        while (Date.now() - st < ms) {
          const v = await safeEv(expr);
          if (v) return v;
          await sleep(150);
        }
        return null;
      };
      const load = async (w, h, mobile) => {
        await c.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
        await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
        await c.send("Page.navigate", { url: BASE });
        await sleep(500);
        await waitFor("document.readyState==='complete' && !!document.getElementById('btn-arcade') && !!window.__MOYU__ === false", 25000);
        await sleep(1500);
        R.bundle = await safeEv(`performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/\\/assets\\/index-[^/]+\\.js$/.test(n)).map(n=>n.split('/').pop())`);
        R.hasDevHook = await safeEv(`typeof window.__MOYU__`);
        R.versionText = await safeEv(`document.getElementById('about-version')?.textContent ?? null`);
      };
      const tap = async (x, y) => {
        try {
          await c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, radiusX: 1, radiusY: 1 }] });
          await sleep(35);
          await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await sleep(120);
          return "touch";
        } catch (e) {
          return "touch-fail:" + String(e).slice(0, 50);
        }
      };
      const clickSel = (sel) => safeEv(`(()=>{const e=document.querySelector(${J(sel)}); if(!e) return 'no-el'; e.click(); return 'ok';})()`);
      const rectOf = (sel) =>
        safeEv(`(()=>{const e=document.querySelector(${J(sel)}); if(!e) return null; const b=e.getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height,vis:b.width>0&&b.height>0,text:(e.textContent||'').slice(0,120)};})()`);
      const save = () =>
        safeEv(`(()=>{try{const b=JSON.parse(localStorage.getItem('moyu-save')||'null'); return b?{moyu:b.moyu,arcade:b.arcade,savedAt:b.savedAt}:null;}catch(e){return {err:String(e)}}})()`);
      const snap = () =>
        safeEv(`(()=>{try{
          const $=(id)=>document.getElementById(id), toast=$('dom-toast');
          const b=(()=>{try{return JSON.parse(localStorage.getItem('moyu-save')||'null')}catch(e){return null}})();
          return {
            saveArcade: b?.arcade ?? null, moyu: b?.moyu ?? null,
            hudMoyu: $('hud-moyu').textContent, hudIdle: $('hud-idle').textContent,
            leftText: $('arcade-left').textContent, open: !$('arcade').classList.contains('hidden'),
            title: $('arcade-title').textContent, body: ($('arcade-body').innerText||'').slice(0,800),
            resultShown: !!$('arcade-back'),
            bossOpen: !$('boss-choice').classList.contains('hidden'),
            cardsOpen: !$('cards').classList.contains('hidden'),
            badge: (()=>{const ab=$('btn-arcade'); const bg=ab?.querySelector('.arcade-badge'); return {text:bg?bg.textContent:null, aria:ab?.getAttribute('aria-label')};})(),
            toast: {text:(toast?.textContent||'').slice(0,200), show:!!toast?.classList.contains('show')},
          };
        }catch(e){return {__err:String(e).slice(0,200)};}})()`);
      const entryMetrics = () =>
        safeEv(`(()=>{
          const b=document.getElementById('btn-arcade'); const r=b.getBoundingClientRect();
          const cx=r.x+r.width/2, cy=r.y+r.height/2; const hit=document.elementFromPoint(cx,cy);
          const stage=document.getElementById('stage').getBoundingClientRect();
          const inter=(a,b)=>Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))*Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left));
          const bt=document.body.innerText;
          return {viewport:{w:innerWidth,h:innerHeight}, btn:{label:b.getAttribute('aria-label'),rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}}, centerHitIsSelf:hit===b,
            overlapStageRatio:+(inter(r,stage)/(stage.width*stage.height||1)).toFixed(4),
            bodyHasArcadeWord:{摸鱼站:bt.includes('摸鱼站'),小游戏:bt.includes('小游戏'),游戏:bt.includes('游戏')},
            hasBadge:!!b.querySelector('.arcade-badge'), badgeText:b.querySelector('.arcade-badge')?.textContent ?? null};
        })()`);
      const openArcade = async (synthetic = true) => {
        if (synthetic) {
          await clickSel("#btn-arcade");
        } else {
          const r = await rectOf("#btn-arcade");
          if (r && !r.__err) await tap(r.x + r.w / 2, r.y + r.h / 2);
          else await clickSel("#btn-arcade");
        }
        await sleep(320);
        return snap();
      };
      const menuInfo = () =>
        safeEv(`(()=>{
          const cards=[...document.querySelectorAll('#arcade-body .arcade-card')];
          return {
            leftText:document.getElementById('arcade-left').textContent,
            cards:cards.map(c=>({name:c.querySelector('.arcade-name')?.innerText,desc:c.querySelector('.arcade-desc')?.innerText,btn:c.querySelector('button')?.innerText,disabled:!!c.querySelector('button')?.disabled,locked:c.classList.contains('locked')})),
            panelText:document.getElementById('arcade').innerText.slice(0,900),
            showsRewardHint:/奖励|获得|摸鱼值|收益/.test(document.getElementById('arcade').innerText),
          };
        })()`);
      // 中途退出 confirm 拦截（记录文案并返回指定值）
      const installConfirm = (answer) =>
        safeEv(`(()=>{window.__confirmMsgs=[]; window.__confirmAnswer=${answer}; window.confirm=(m)=>{window.__confirmMsgs.push(String(m)); return window.__confirmAnswer;}; return 1;})()`);
      const closeWithConfirm = async (answer) => {
        await installConfirm(answer);
        await clickSel("#arcade-close");
        await sleep(500);
        return { msgs: await safeEv(`window.__confirmMsgs ?? []`), snap: await snap() };
      };
      const coffeeAutoCatch = async (sec, thresholds = { on: 78, off: 88 }, extra = {}) => {
        const drops = [];
        const t = Date.now();
        await safeEv(`(()=>{
          window.__ac = setInterval(() => {
            const area=document.getElementById('play-area'); if(!area) return;
            if (!document.getElementById('cup-line') && !document.querySelector('.cup-line')) { /* 杯口线在 drops 容器外，忽略 */ }
            const r=area.getBoundingClientRect();
            const ds=[...document.querySelectorAll('#play-drops .drop')].filter(e=>!e.classList.contains('caught')&&!e.classList.contains('landed'));
            let best=null,bestTop=${thresholds.on};
            for(const d of ds){const v=parseFloat(d.style.top); if(Number.isFinite(v)&&v>bestTop){bestTop=v;best=d;}}
            if(!best) return;
            const x=r.left+(parseFloat(best.style.left)/100)*r.width;
            area.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:x,clientY:r.top+r.height*0.8,pointerType:'touch'}));
          }, 45);
          return 1;
        })()`);
        const samples = [];
        while (Date.now() - t < sec * 1000) {
          samples.push({ t: +((Date.now() - t) / 1000).toFixed(1), timer: await safeEv(`document.getElementById('play-timer')?.textContent`), score: await safeEv(`document.getElementById('play-score')?.textContent`), drops: await safeEv(`[...document.querySelectorAll('#play-drops .drop')].map(e=>e.style.top)`), boss: await safeEv(`!document.getElementById('boss-choice').classList.contains('hidden')`), cards: await safeEv(`!document.getElementById('cards').classList.contains('hidden')`) });
          await sleep(700);
        }
        await safeEv(`clearInterval(window.__ac)`);
        return samples;
      };

      /* ================= 打开 1：移动端 全新（无痕） ================= */
      if (PHASE === "o1") {
        log("o1: 线上移动端 390x844 全新档");
        await load(390, 844, true);
        await shot("o1-01-first-screen");
        R.firstScreen = await entryMetrics();
        R.version = await safeEv(`document.getElementById('about-version')?.textContent`);
        R.before = await snap();
        // 入口：真实触摸点 🎮（1 步）
        const e = await openArcade(false);
        R.entry = { steps: 1, open: e.open, left: e.leftText, body: e.body, badge: e.badge, title: e.title };
        await shot("o1-02-menu");
        R.menu = await menuInfo();
        // 菜单打开 900ms 后文案是否稳定（曾被 refresh 覆盖）
        await sleep(900);
        R.menuLeftAfter900ms = await safeEv(`document.getElementById('arcade-left').textContent`);
        await shot("o1-03-menu-900ms");
        // 接咖啡：采样下落 + 杯口线 + 全程
        step("coffee start");
        await clickSel('#arcade-body button[data-game="coffee"]');
        await sleep(400);
        R.coffeeStart = {
          title: await safeEv(`document.getElementById('arcade-title')?.textContent`),
          hint: await safeEv(`document.querySelector('#arcade-body .arcade-hint')?.textContent`),
          timer: await safeEv(`document.getElementById('play-timer')?.textContent`),
          cupLine: await rectOf(".cup-line"),
          playArea: await rectOf("#play-area"),
        };
        await shot("o1-04-coffee-start");
        const motion = [];
        for (let i = 0; i < 10; i++) {
          motion.push({
            t: i,
            timer: await safeEv(`document.getElementById('play-timer')?.textContent`),
            drops: await safeEv(`[...document.querySelectorAll('#play-drops .drop')].map(e=>e.style.top)`),
          });
          if (i === 3) await shot("o1-05-coffee-fall1");
          if (i === 6) await shot("o1-06-coffee-fall2");
          await sleep(300);
        }
        R.coffeeMotion = motion;
        const tops = motion.flatMap((m) => (m.drops || []).map((x) => parseFloat(x)).filter((n) => Number.isFinite(n)));
        R.coffeeDropTopRange = tops.length ? { min: +Math.min(...tops).toFixed(1), max: +Math.max(...tops).toFixed(1), n: tops.length } : null;
        // 自动接 + 后期采样（顺便看小游戏期间老板/卡片是否弹出）
        const samples = await coffeeAutoCatch(24);
        R.coffeeSamples = samples;
        R.coffeeBossAppeared = samples.some((s) => s.boss === true);
        R.coffeeCardsAppeared = samples.some((s) => s.cards === true);
        await shot("o1-07-coffee-autoplay");
        await waitFor("!!document.getElementById('arcade-back')", 20000);
        const end = await snap();
        await shot("o1-08-coffee-result");
        R.coffeeEnd = {
          body: end.body, resultShown: end.resultShown, toast: end.toast, left: end.leftText,
          saveArcade: end.saveArcade, badge: end.badge, bossOpen: end.bossOpen, cardsOpen: end.cardsOpen,
        };
        R.coffeeEnd.buttons = await safeEv(`[...document.querySelectorAll('#arcade-body button')].map(b=>({id:b.id,text:b.textContent.trim(),h:Math.round(b.getBoundingClientRect().height)}))`);
        // 结算面板字段解析
        R.coffeeEnd.fields = await safeEv(`(()=>{const b=document.getElementById('arcade-body'); const t=b.innerText; return {
          score:/^(\\d+) 分$/m.exec(t)?.[1] ?? null,
          reward:/本局奖励 \\+([0-9.]+)/.exec(t)?.[1] ?? null,
          zeroText:/次数已扣 1 次/.test(t),
          record:/新纪录（旧 (\\d+)）/.exec(t)?.[1] ?? null,
          best:/历史最高 (\\d+)/.exec(t)?.[1] ?? null,
          detail:/接住 (\\d+) · 漏接 (\\d+) · 最高连击 (\\d+)/.exec(t)?.slice(1) ?? null,
          hintText:/本局 0 分/.test(t),
        };})()`);
        await clickSel("#arcade-back");
        await sleep(350);
        R.afterCoffeeMenu = await menuInfo();
        await shot("o1-09-menu-after");
        await clickSel("#arcade-close");
        R.durationMs = Date.now() - Date.parse(R.meta.startedAt);
        R.saveAfter = await save();
      }

      /* ================= 打开 2：移动端 回访（找老板 30s + 节奏判定 + 中途退出确认） ================= */
      if (PHASE === "o2") {
        log("o2: 线上移动端 回访");
        await load(390, 844, true);
        await shot("o2-01-first-screen");
        R.firstScreen = await entryMetrics();
        R.before = await snap();
        const m = await openArcade();
        R.entry = { steps: 1, left: m.leftText, body: m.body, badge: m.badge };
        await shot("o2-02-menu");
        // 找老板：实时分数 + 30s 倒计时（完整一局）
        step("findboss live score + full 30s");
        await clickSel('#arcade-body button[data-game="findboss"]');
        await sleep(400);
        R.findbossStart = { timer: await safeEv(`document.getElementById('play-timer')?.textContent`), score: await safeEv(`document.getElementById('play-score')?.textContent`), body: (await snap()).body };
        await safeEv(`(()=>{window.__ab=setInterval(()=>{const b=document.querySelector('#play-grid .face.boss'); if(b)b.click();},200);return 1;})()`);
        const live = [];
        for (let i = 0; i < 8; i++) {
          await sleep(1200);
          live.push({ t: i, timer: await safeEv(`document.getElementById('play-timer')?.textContent`), score: await safeEv(`document.getElementById('play-score')?.textContent`), boss: await safeEv(`!document.getElementById('boss-choice').classList.contains('hidden')`), cards: await safeEv(`!document.getElementById('cards').classList.contains('hidden')`) });
          if (i === 4) await shot("o2-03-findboss-mid");
        }
        R.findbossLive = live;
        await waitFor("!!document.getElementById('arcade-back')", 30000);
        await safeEv(`clearInterval(window.__ab)`);
        const fbEnd = await snap();
        await shot("o2-04-findboss-result");
        R.findbossEnd = { body: fbEnd.body, toast: fbEnd.toast, left: fbEnd.leftText, saveArcade: fbEnd.saveArcade, fields: await safeEv(`(()=>{const t=document.getElementById('arcade-body').innerText;return {score:/^(\\d+) 分$/m.exec(t)?.[1], reward:/本局奖励 \\+([0-9.]+)/.exec(t)?.[1]??null, detail:/找对 (\\d+) · 找错 (\\d+)/.exec(t)?.slice(1)??null, record:/新纪录（旧 (\\d+)）/.exec(t)?.[1]??null};})()`) };
        await clickSel("#arcade-back");
        await sleep(300);
        // 节奏点击：判定文字 + 跟拍得分（打 4 秒），然后中途退出（confirm 拒绝→接受）
        step("rhythm judge text + on-beat 4s");
        await clickSel('#arcade-body button[data-game="rhythm"]');
        await sleep(400);
        await safeEv(`(()=>{
          window.__abt=setInterval(()=>{
            const area=document.getElementById('play-area'); if(!area) return;
            if(!document.querySelector('#beat-row .beat.on')) return;
            const r=area.getBoundingClientRect();
            area.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerType:'touch'}));
          },30); return 1;})()`);
        await sleep(3500);
        await safeEv(`clearInterval(window.__abt)`);
        R.rhythm = {
          judgeText: await safeEv(`document.getElementById('judge-text')?.textContent`),
          judgeClass: await safeEv(`document.getElementById('judge-text')?.className`),
          score: await safeEv(`document.getElementById('play-score')?.textContent`),
          beatsOn: await safeEv(`document.querySelectorAll('#beat-row .beat.on').length`),
          beatsPerfect: await safeEv(`document.querySelectorAll('#beat-row .beat.perfect').length`),
          beatsGood: await safeEv(`document.querySelectorAll('#beat-row .beat.good').length`),
          beatsMissed: await safeEv(`document.querySelectorAll('#beat-row .beat.missed').length`),
          timer: await safeEv(`document.getElementById('play-timer')?.textContent`),
          boss: await safeEv(`!document.getElementById('boss-choice').classList.contains('hidden')`),
        };
        await shot("o2-05-rhythm-judge");
        // 中途退出：先"取消"确认（应不退出、不扣次数），再"确定"（应退出+按比例结算）
        step("mid-game exit: confirm cancel then accept");
        const beforeQ = await snap();
        const cancelRes = await closeWithConfirm(false);
        R.exitCancel = { msgs: cancelRes.msgs, stillOpen: cancelRes.snap.open, playedBefore: beforeQ.saveArcade?.played, playedAfter: cancelRes.snap.saveArcade?.played, toast: cancelRes.snap.toast };
        await shot("o2-06-exit-cancel");
        const acceptRes = await closeWithConfirm(true);
        R.exitAccept = { msgs: acceptRes.msgs, closed: !acceptRes.snap.open, playedBefore: beforeQ.saveArcade?.played, playedAfter: acceptRes.snap.saveArcade?.played, toast: acceptRes.snap.toast, left: acceptRes.snap.leftText, badge: acceptRes.snap.badge, resultShown: acceptRes.snap.resultShown };
        await shot("o2-07-exit-accept");
        // 等 6s：不应再有幽灵结算
        await sleep(6000);
        const ghost = await snap();
        R.exitAccept.ghostAfter6s = { played: ghost.saveArcade?.played, open: ghost.open, toast: ghost.toast };
        // 0/3 锁死态
        step("third attempt → locked");
        const m2 = await openArcade();
        R.thirdMenu = { left: m2.leftText, body: m2.body, badge: m2.badge };
        await clickSel('#arcade-body button[data-game="findboss"]');
        await sleep(1200);
        await closeWithConfirm(true); // 消耗第 3 次
        await sleep(400);
        const m3 = await openArcade();
        await sleep(900); // refresh 循环会覆盖 left 文案，等 900ms 看是否稳定
        R.locked = {
          menu: await menuInfo(),
          snap: await snap(),
          leftAfter900ms: await safeEv(`document.getElementById('arcade-left').textContent`),
          disabledButtons: await safeEv(`[...document.querySelectorAll('#arcade-body .arcade-card button')].map(b=>({text:b.textContent.trim(),disabled:b.disabled}))`),
          badge: (await snap()).badge,
        };
        R.locked.afterTapDisabled = await (async () => {
          const r = await rectOf("#arcade-body .arcade-card button");
          if (r && !r.__err) await tap(r.x + r.w / 2, r.y + r.h / 2);
          await sleep(300);
          const s = await snap();
          return { title: s.title, played: s.saveArcade?.played, open: s.open };
        })();
        await shot("o2-08-locked");
        await clickSel("#arcade-close");
        R.durationMs = Date.now() - Date.parse(R.meta.startedAt);
      }

      /* ================= 打开 3：桌面 + 清档 → 确认流程 / 早退奖励折算 / 0 分结算 ================= */
      if (PHASE === "o3") {
        log("o3: 线上桌面 1280x800（清档模拟新手）");
        await load(1280, 800, true); // mobile:false 后续设置
        await c.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
        await sleep(600);
        await shot("o3-01-first-screen");
        // 清档 → 新号（模拟新手，验证 0 分结算/确认流程）
        await safeEv(`localStorage.removeItem('moyu-save')`);
        await c.send("Page.navigate", { url: BASE });
        await sleep(500);
        await waitFor("document.readyState==='complete' && !!document.getElementById('btn-arcade')", 25000);
        await sleep(1500);
        R.firstScreen = await entryMetrics();
        R.version = await safeEv(`document.getElementById('about-version')?.textContent`);
        const m = await openArcade();
        R.entry = { steps: 1, left: m.leftText, body: m.body, badge: m.badge };
        await shot("o3-02-menu");
        // (a) 早退奖励折算验证：找老板 ~7s 刷到 >600 分，退出（先取消→再确认）
        step("findboss early-exit reward scaling");
        await clickSel('#arcade-body button[data-game="findboss"]');
        await sleep(400);
        await safeEv(`(()=>{window.__ab=setInterval(()=>{const b=document.querySelector('#play-grid .face.boss'); if(b)b.click();},200);return 1;})()`);
        await sleep(7000);
        await safeEv(`clearInterval(window.__ab)`);
        const preExit = await snap();
        R.earlyExit = { scoreBeforeExit: await safeEv(`document.getElementById('play-score')?.textContent`), playedBefore: preExit.saveArcade?.played, timer: await safeEv(`document.getElementById('play-timer')?.textContent`) };
        const cancel = await closeWithConfirm(false);
        R.earlyExit.cancel = { msgs: cancel.msgs, stillOpen: cancel.snap.open, playedAfter: cancel.snap.saveArcade?.played };
        await shot("o3-03-exit-cancel");
        const accept = await closeWithConfirm(true);
        R.earlyExit.accept = { msgs: accept.msgs, closed: !accept.snap.open, playedAfter: accept.snap.saveArcade?.played, toast: accept.snap.toast, left: accept.snap.leftText, badge: accept.snap.badge };
        await shot("o3-04-exit-accept");
        // (b) 0 分结算：接咖啡全程不点，等 30s
        step("coffee 0-score settlement (30s no tap)");
        const mm = await openArcade();
        R.zeroMenu = { left: mm.leftText, body: mm.body };
        await clickSel('#arcade-body button[data-game="coffee"]');
        await sleep(400);
        await shot("o3-05-coffee-notap-start");
        const bossDuring = [];
        for (let i = 0; i < 10; i++) {
          await sleep(3000);
          bossDuring.push(await safeEv(`({boss:!document.getElementById('boss-choice').classList.contains('hidden'), cards:!document.getElementById('cards').classList.contains('hidden')})`));
        }
        await waitFor("!!document.getElementById('arcade-back')", 12000);
        const z = await snap();
        await shot("o3-06-coffee-zero-result");
        R.zeroScore = {
          body: z.body, fields: await safeEv(`(()=>{const t=document.getElementById('arcade-body').innerText;return {score:/^(\\d+) 分$/m.exec(t)?.[1], reward:/本局奖励 \\+([0-9.]+)/.exec(t)?.[1]??null, zeroText:/本局 0 分，次数已扣 1 次/.test(t), best:/历史最高 (\\d+)/.exec(t)?.[1]??null, detail:/接住 (\\d+) · 漏接 (\\d+) · 最高连击 (\\d+)/.exec(t)?.slice(1)??null};})()`),
          toast: z.toast, left: z.leftText, saveArcade: z.saveArcade, bossDuring,
          bossAppearedDuring30s: bossDuring.some((x) => x?.boss === true),
          cardsAppearedDuring30s: bossDuring.some((x) => x?.cards === true),
        };
        // 关于版本截图
        await clickSel("#arcade-back");
        await sleep(300);
        await clickSel("#arcade-close");
        await clickSel("#btn-journal");
        await sleep(500);
        await shot("o3-07-journal-version");
        R.aboutVersion = await safeEv(`document.getElementById('about-version')?.textContent`);
        R.durationMs = Date.now() - Date.parse(R.meta.startedAt);
      }

      R.errors = c.errors.slice(0, 20);
      c.close();
    },
    { timeoutMs: 190_000 },
  );
} catch (e) {
  R.crash = String(e?.stack || e).slice(0, 1500);
  log("CRASH", R.crash.slice(0, 400));
}
write();
console.log("DONE", PHASE);