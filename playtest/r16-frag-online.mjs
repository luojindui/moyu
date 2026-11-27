// r16 终验玩家 · 线上真实链路：第 1 次打开（新玩家）→ 模拟 25 分钟后第 2 次打开（回访 + 小游戏）
// 碎片学生党画像：每次 2-3 分钟，只看/只做"这一小会能做完的事"
// 运行：node playtest/r16-frag-online.mjs   （须用 node22 PATH）
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const BASE = "https://luojindui.github.io/moyu/";
const OUT = "playtest/r16-shots";
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const R = { startedAt: new Date().toISOString(), url: BASE, opens: [], notes: [], errors: [] };
const write = () => writeFileSync("playtest/r16-frag-online.json", JSON.stringify(R, null, 2));
const now = () => Date.now();
const sec = (ms) => +(ms / 1000).toFixed(1);

await runChrome(
  async ({ port }) => {
    const c = await connect(port);
    const rawSend = c.send.bind(c);
    c.send = (m, p) =>
      Promise.race([rawSend(m, p), new Promise((_, rej) => setTimeout(() => rej(new Error("CDP timeout " + m)), 12000))]);
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
        return n;
      } catch (e) { log("shot FAIL", n, String(e).slice(0, 60)); return null; }
    };
    const waitFor = async (expr, ms = 15000, step = 120) => {
      const st = now();
      while (now() - st < ms) {
        if (await ev(expr)) return true;
        await sleep(step);
      }
      return false;
    };
    const vis = (sel) => ev(`(()=>{const e=document.querySelector(${J(sel)});if(!e)return false;const b=e.getBoundingClientRect();return !e.classList.contains('hidden')&&b.width>0&&b.height>0})()`);
    const rect = (sel) => ev(`(()=>{const e=document.querySelector(${J(sel)});if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}})()`);
    const tap = async (x, y) => {
      await c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, radiusX: 1, radiusY: 1 }] });
      await sleep(40);
      await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    const tapSel = async (sel) => {
      const r = await rect(sel);
      if (!r) return false;
      await tap(r.x + r.w / 2, r.y + r.h / 2);
      return true;
    };
    const clickJs = (sel) => ev(`(()=>{const e=document.querySelector(${J(sel)});if(!e)return 'no-el';if(e.disabled)return 'disabled';e.click();return 'ok'})()`);

    let OPEN = null;
    const openStart = (id, label) => {
      OPEN = { id, label, startedAt: new Date().toISOString(), actions: [], events: [], metrics: {}, shots: [] };
      R.opens.push(OPEN);
      log("== OPEN", id, label);
    };
    const act = async (label, fn, { pauseAfter = 0 } = {}) => {
      const s = now();
      const out = await fn();
      const ms = now() - s;
      OPEN.actions.push({ t: +((s - OPEN.t0) / 1000).toFixed(1), label, ms, out });
      log("  act", label, `${ms}ms`, out === undefined ? "" : JSON.stringify(out).slice(0, 160));
      if (pauseAfter) await playerPause(pauseAfter, `想一下(${label})`);
      return out;
    };
    // 学生"读/看"的停顿：期间顺带轮询事件
    const playerPause = async (ms, label = "看") => {
      const end = now() + ms;
      while (now() < end) {
        await pollEvents();
        await sleep(Math.min(250, end - now()));
      }
      OPEN.actions.push({ t: +((now() - OPEN.t0) / 1000).toFixed(1), label, ms });
    };
    const snap = async (name) => {
      const s = await ev(`(()=>{
        const $=(id)=>document.getElementById(id);
        const vis=(e)=>!!e&&!e.classList.contains('hidden')&&e.getBoundingClientRect().width>0;
        const btn=[...document.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width>0).map(b=>({id:b.id||undefined,aria:b.getAttribute('aria-label')||undefined,text:(b.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40),dis:!!b.disabled,badge:(b.querySelector('.badge,.arcade-badge,.energy-badge')?.textContent||undefined)}));
        return {
          t:Math.round(performance.now()),
          hud:{moyu:$('hud-moyu')?.textContent,sub:document.querySelector('#hud .hud-sub')?.innerText,rank:$('hud-rank')?.textContent,card:$('hud-card')?.textContent},
          quest:vis($('quest'))?$('quest-text')?.textContent:null,
          panels:{journal:vis($('journal')),team:vis($('team')),arcade:vis($('arcade')),cards:vis($('cards')),boss:vis($('boss-choice')),welcome:vis($('welcome'))},
          buttons:btn,
          shopAffordable:([...document.querySelectorAll('#shop-cards .shop-card')].filter(e=>!e.classList.contains('locked')).length),
          shopCount:document.querySelectorAll('#shop-cards .shop-card').length,
          texts:{journal:vis($('journal'))?($('journal').innerText||'').replace(/\\n{2,}/g,'\\n').slice(0,900):null,team:vis($('team'))?($('team').innerText||'').replace(/\\n{2,}/g,'\\n').slice(0,900):null,arcade:vis($('arcade'))?($('arcade').innerText||'').replace(/\\n{2,}/g,'\\n').slice(0,700):null,cards:vis($('cards'))?($('cards').innerText||'').replace(/\\n+/g,' | ').slice(0,600):null,boss:vis($('boss-choice'))?($('boss-choice').innerText||'').replace(/\\n+/g,' | ').slice(0,400):null,welcome:vis($('welcome'))?($('welcome').innerText||'').replace(/\\n{2,}/g,'\\n').slice(0,400):null},
        };
      })()`);
      if (!s || s.__err) { log("snap FAIL", name, JSON.stringify(s).slice(0,200)); return { texts:{}, buttons:[], hud:{}, snapError: s?.__err }; }
      s.save = await readSave();
      OPEN.shots.push(name);
      OPEN[`snap_${name}`] = s;
      return s;
    };
    const readSave = () => ev(`(()=>{try{const b=JSON.parse(localStorage.getItem('moyu-save')||'null');if(!b)return null;return {v:b.v,moyu:Math.round(b.moyu),createdAt:b.createdAt,savedAt:b.savedAt,levels:b.levels,totalClicks:b.totalClicks,daily:b.daily?{date:b.daily.date,goals:b.daily.goals,claimed:b.daily.claimed,streak:b.daily.streak,window:b.daily.window,claimsToday:b.daily.claimsToday}:null,team:b.team,talents:b.talents,decor:b.decor,energy:b.energy,arcade:b.arcade,cards:b.cards?{date:b.cards.date,offers:b.cards.offers,chosen:b.cards.chosen,until:b.cards.until,dismissed:b.cards.dismissed}:null}}catch(e){return {err:String(e)}}})()`);
    const pollState = { boss: false, cards: false, welcome: false, toast: "", lastBossKey: "" };
    const pollEvents = async () => {
      if (!OPEN) return;
      const s = await ev(`(()=>{
        const $=(id)=>document.getElementById(id);
        const vis=(e)=>!!e&&!e.classList.contains('hidden')&&e.getBoundingClientRect().width>0;
        const boss=vis($('boss-choice'));
        const toastEl=$('dom-toast');
        return {boss,cards:vis($('cards')),welcome:vis($('welcome')),
          bossText:boss?($('boss-choice').innerText||'').replace(/\\n+/g,' | ').slice(0,300):null,
          bossTimer:boss?$('boss-timer')?.textContent:null,
          cardText:vis($('cards'))?($('cards').innerText||'').replace(/\\n+/g,' | ').slice(0,500):null,
          welcomeText:vis($('welcome'))?($('welcome').innerText||'').replace(/\\n+/g,' | ').slice(0,300):null,
          toast:(toastEl&&toastEl.classList.contains('show'))?(toastEl.textContent||'').slice(0,120):null,
          sr:$('sr-live')?.textContent||null};
      })()`);
      if (!s || s.__err) return;
      if (s.boss && !pollState.boss) OPEN.events.push({ t: +((now() - OPEN.t0) / 1000).toFixed(1), type: "boss-show", text: s.bossText, timer: s.bossTimer });
      if (!s.boss && pollState.boss) OPEN.events.push({ t: +((now() - OPEN.t0) / 1000).toFixed(1), type: "boss-hide" });
      if (s.cards && !pollState.cards) OPEN.events.push({ t: +((now() - OPEN.t0) / 1000).toFixed(1), type: "cards-show", text: s.cardText });
      if (!s.cards && pollState.cards) OPEN.events.push({ t: +((now() - OPEN.t0) / 1000).toFixed(1), type: "cards-hide" });
      if (s.welcome && !pollState.welcome) OPEN.events.push({ t: +((now() - OPEN.t0) / 1000).toFixed(1), type: "welcome-show", text: s.welcomeText });
      if (!s.welcome && pollState.welcome) OPEN.events.push({ t: +((now() - OPEN.t0) / 1000).toFixed(1), type: "welcome-hide" });
      if (s.toast && s.toast !== pollState.toast) OPEN.events.push({ t: +((now() - OPEN.t0) / 1000).toFixed(1), type: "toast", text: s.toast });
      if (s.sr && s.sr !== pollState.sr) OPEN.events.push({ t: +((now() - OPEN.t0) / 1000).toFixed(1), type: "sr-live", text: s.sr });
      pollState.boss = s.boss; pollState.cards = s.cards; pollState.welcome = s.welcome; pollState.toast = s.toast || ""; pollState.sr = s.sr || "";
    };

    // ---- 时间回拨注入（模拟"关掉 25 分钟后再打开"） ----
    const pageLoad = (url) =>
      ev(`(()=>{const n=performance.getEntriesByType('navigation')[0];return {dcl:Math.round(n?.domContentLoadedEventEnd||0),load:Math.round(n?.loadEventEnd||0),transfer:Math.round(performance.getEntriesByType('resource').reduce((s,e)=>s+(e.transferSize||0),0)),res:performance.getEntriesByType('resource').length}})()`);
    const reloadWithGap = async (secondsBack, tag) => {
      const scriptId = (await c.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `try{const k='moyu-save';const b=JSON.parse(localStorage.getItem(k)||'null');if(b&&typeof b.savedAt==='number'){b.savedAt-=${secondsBack}*1000;localStorage.setItem(k,JSON.stringify(b));} }catch(e){}`,
      })).identifier;
      try {
        await c.send("Page.reload", { ignoreCache: false });
        const ok = await waitFor("document.readyState==='complete' && !!document.getElementById('btn-arcade')", 30000);
        if (!ok) throw new Error("reload not ready");
      } finally {
        await c.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId });
      }
      await sleep(700);
    };

    // ---- 小游戏辅助 ----
    const playCoffee = async (maxMs = 38000) => {
      const st = now();
      await tapSel('button[data-game="coffee"]');
      await sleep(250);
      const area = await rect("#play-area");
      while (now() - st < maxMs) {
        const drops = await ev(`[...document.querySelectorAll('#play-drops .drop')].filter(e=>!e.classList.contains('landed')&&!e.classList.contains('caught')).map(e=>({x:parseFloat(e.style.left)||0,top:parseFloat(e.style.top)||-1}))`);
        if (Array.isArray(drops)) {
          for (const d of drops) {
            if (d.top >= 80 && d.top <= 90 && area) {
              // 点它
              await tap(area.x + Math.min(0.97, Math.max(0.03, d.x / 100)) * area.w, area.y + area.h * 0.72);
              break;
            }
          }
        }
        if (await vis("#arcade-back")) break;
        await sleep(45);
      }
      const wall = now() - st;
      const res = await ev(`(()=>{const b=document.getElementById('arcade-back');if(!b)return null;const body=document.getElementById('arcade-body');return {text:(body?.innerText||'').replace(/\\n+/g,' | ').slice(0,500),again:!!document.getElementById('arcade-again')};})()`);
      return { wallMs: wall, res };
    };
    const playFindBoss = async (maxMs = 38000) => {
      const st = now();
      await tapSel('button[data-game="findboss"]');
      await sleep(250);
      let rounds = 0;
      while (now() - st < maxMs) {
        const clicked = await ev(`(()=>{const b=document.querySelector('#play-grid button.face.boss');if(!b)return false;b.click();return true})()`);
        if (clicked) rounds++;
        if (await vis("#arcade-back")) break;
        await sleep(380 + Math.floor(Math.random() * 260));
      }
      const wall = now() - st;
      const res = await ev(`(()=>{const b=document.getElementById('arcade-back');if(!b)return null;return {text:(document.getElementById('arcade-body')?.innerText||'').replace(/\\n+/g,' | ').slice(0,500)}})()`);
      return { wallMs: wall, rounds, res };
    };
    const playRhythm = async (maxMs = 40000) => {
      const st = now();
      await tapSel('button[data-game="rhythm"]');
      const clickAnchor = now();
      await sleep(250);
      const area = await rect("#play-area");
      // 节拍：startAt + 0.6 + 0.5k 秒（120BPM）；clickAnchor≈startAt
      let k = 0;
      const tapAtBeat = async () => {
        if (area) await tap(area.x + area.w * 0.5, area.y + area.h * 0.55);
      };
      while (now() - st < maxMs) {
        const target = clickAnchor + 600 + 500 * k - 10; // 提前 10ms 抵消输入延迟
        const wait = target - now();
        if (wait > 0) await sleep(Math.min(wait, 120));
        else {
          await tapAtBeat();
          k++;
          if (await vis("#arcade-back")) break;
          await sleep(Math.max(0, 500 - (now() - target)));
        }
      }
      const wall = now() - st;
      const res = await ev(`(()=>{const b=document.getElementById('arcade-back');if(!b)return null;return {text:(document.getElementById('arcade-body')?.innerText||'').replace(/\\n+/g,' | ').slice(0,500)}})()`);
      return { wallMs: wall, taps: k, res };
    };
    const backToMenu = async () => {
      await tapSel("#arcade-back");
      await sleep(400);
      return ev(`document.getElementById('arcade-left')?.textContent`);
    };

    // ================= Open 1：线上新玩家首次打开 =================
    await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    openStart("O1", "线上·新玩家首次打开");
    OPEN.t0 = now();
    const navStart = now();
    await c.send("Page.navigate", { url: BASE });
    const ready = await waitFor("document.readyState==='complete' && !!document.getElementById('btn-arcade') && document.querySelectorAll('#shop-cards .shop-card').length>=9", 30000);
    OPEN.metrics.navToReadyMs = now() - navStart;
    OPEN.metrics.ready = ready;
    await sleep(900);
    OPEN.metrics.perf = await pageLoad();
    await act("首屏：看 HUD / 目标链 / 商店（学生先愣 3 秒）", async () => {
      await playerPause(3000, "读首屏");
      const s = await snap("O1-01-first-screen");
      return { hud: s.hud, quest: s.quest, shopCount: s.shopCount, affordable: s.shopAffordable, badges: s.buttons.filter((b) => b.badge).map((b) => `${b.aria}:${b.badge}`) };
    });
    await shot("O1-01-first-screen");
    // 戳 8 下触发卡片（学生自然连点）
    await act("戳屏幕 8 下（跟目标链走）", async () => {
      const cv = await rect("#stage");
      for (let i = 0; i < 8; i++) {
        await tap(cv.x + cv.w * (0.3 + 0.4 * Math.random()), cv.y + cv.h * (0.35 + 0.3 * Math.random()));
        await sleep(260);
      }
      await sleep(600);
      return { clicks: 8 };
    }, { pauseAfter: 400 });
    await act("今日摸鱼卡弹窗：读 3 张卡再选", async () => {
      const shown = await waitFor("!document.getElementById('cards').classList.contains('hidden')", 6000);
      const s = await snap("O1-02-cards");
      await shot("O1-02-cards");
      await playerPause(4500, "读 3 张卡");
      return { shown, cards: s.texts.cards };
    });
    await act("选卡（点第 1 张）", async () => {
      const before = await readSave();
      await tapSel("#cards .card");
      await sleep(800);
      const after = await readSave();
      return { chosenBefore: before?.cards?.chosen, chosenAfter: after?.cards?.chosen };
    }, { pauseAfter: 600 });
    await act("再戳 7 下（攒到 15 摸鱼值）", async () => {
      const cv = await rect("#stage");
      for (let i = 0; i < 7; i++) {
        await tap(cv.x + cv.w * (0.3 + 0.4 * Math.random()), cv.y + cv.h * (0.35 + 0.3 * Math.random()));
        await sleep(250);
      }
      const s = await snap("O1-03-more-taps");
      return { moyu: s.save?.moyu, quest: s.quest };
    });
    await act("买第一个升级（目标链：咖啡续命 15）", async () => {
      const before = await readSave();
      await tapSel("#shop-cards .shop-card");
      await sleep(700);
      const after = await readSave();
      const s = await snap("O1-04-after-buy");
      await shot("O1-04-after-buy");
      return { moyuBefore: before?.moyu, moyuAfter: after?.moyu, levels: after?.levels, quest: s.quest };
    });
    await act("看到 🎮 角标 3：打开摸鱼站，玩「接咖啡」30 秒（学生第一次尝鲜）", async () => {
      await tapSel("#btn-arcade");
      await sleep(500);
      const menu = await snap("O1-05-arcade-menu");
      const menuShot = await shot("O1-05-arcade-menu");
      await playerPause(2000, "读 3 个游戏介绍");
      const r = await playCoffee();
      await snap("O1-06-coffee-result");
      await shot("O1-06-coffee-result");
      await backToMenu();
      await tapSel("#arcade-close");
      await sleep(400);
      const after = await snap("O1-07-after-coffee");
      return { menu: menu.texts.arcade, result: r.res?.text, wallSec: sec(r.wallMs), arcade: after.save?.arcade, moyu: after.save?.moyu };
    });
    await act("打开 👥 小队（HUD 上写着 精力 100，学生以为有事做）", async () => {
      await tapSel("#btn-team");
      await sleep(500);
      const s = await snap("O1-08-team");
      await shot("O1-08-team");
      const disabled = s.buttons.filter((b) => b.dis && /招募|使用|点亮/.test(b.text)).length;
      return { text: s.texts.team, disabledButtons: disabled };
    }, { pauseAfter: 1200 });
    await act("在空面板里翻到「天赋」tab（发现天赋点 1 可以点）", async () => {
      await tapSel("#tab-talents");
      await sleep(500);
      const s = await snap("O1-09-talents");
      await shot("O1-09-talents");
      return { text: (s.texts.team || "").slice(0, 500) };
    }, { pauseAfter: 800 });
    await act("点亮第一个天赋（手速）", async () => {
      const r = await clickJs('button[data-act="talent"][data-id="click_1"]');
      await sleep(600);
      const after = await readSave();
      return { r, talents: after?.talents };
    });
    await act("关小队，打开 📔 日报（看今天要做什么）", async () => {
      await tapSel("#team-close");
      await sleep(400);
      await tapSel("#btn-journal");
      await sleep(500);
      const s = await snap("O1-10-journal");
      await shot("O1-10-journal");
      return { daily: s.save?.daily, claims: s.texts.journal?.slice(0, 400) };
    }, { pauseAfter: 1500 });
    await act("关日报", async () => {
      await tapSel("#journal-close");
      await sleep(300);
      return true;
    });
    OPEN.metrics.sessionMs = now() - OPEN.t0;
    await act("本次打开收尾：看还剩什么可做", async () => {
      const s = await snap("O1-11-end");
      await shot("O1-11-end");
      const b = s.save;
      return {
        moyu: b?.moyu,
        daily: b?.daily?.goals?.map((g) => `${g.id}:${g.progress}/${g.target}${g.done ? "✓" : ""}`),
        dailyClaimed: b?.daily?.claimed,
        arcade: b?.arcade,
        team: b ? Object.keys(b.team?.colleagues || {}).length : null,
        talentPoints: b?.talents?.points,
        energy: b?.energy?.left,
        affordable: s.shopAffordable,
      };
    });
    OPEN.metrics.totalMs = now() - OPEN.t0;
    write();

    // ================= Open 2：模拟 25 分钟后回访 =================
    openStart("O2", "线上·25 分钟后第 2 次打开（课间回来）");
    OPEN.t0 = now();
    await reloadWithGap(25 * 60, "gap25m");
    OPEN.metrics.reloadReadyMs = now() - OPEN.t0;
    OPEN.metrics.perf = await pageLoad();
    await act("回访首屏：欢迎面板（离线收益）", async () => {
      const s = await snap("O2-01-welcome");
      await shot("O2-01-welcome");
      await playerPause(2500, "看离线收益");
      const w = s.texts.welcome;
      if (await vis("#welcome-ok")) {
        await tapSel("#welcome-ok");
        await sleep(500);
      }
      return { welcome: w, offlinePanelShown: !!w };
    });
    await act("点 3 下看看钱（自然回访动作）", async () => {
      const cv = await rect("#stage");
      for (let i = 0; i < 3; i++) { await tap(cv.x + cv.w * 0.5, cv.y + cv.h * 0.5); await sleep(250); }
      const s = await snap("O2-02-back");
      return { moyu: s.save?.moyu, badges: s.buttons.filter((b) => b.badge).map((b) => `${b.aria}:${b.badge}`) };
    });
    await act("打开 📔 日报：完成「买 3 次升级」并领日报", async () => {
      await tapSel("#btn-journal");
      await sleep(400);
      const s0 = await snap("O2-03-journal");
      await shot("O2-03-journal");
      // 先买 2 个便宜升级（第 3 次已在 O1 买过）—— 用商店卡点
      await tapSel("#journal-close");
      await sleep(300);
      for (let i = 0; i < 2; i++) {
        const bought = await ev(`(()=>{const cards=[...document.querySelectorAll('#shop-cards .shop-card')];const c=cards.find(e=>!e.classList.contains('locked'));if(!c)return 'none';c.click();return 'ok'})()`);
        if (bought !== "ok") break;
        await sleep(500);
      }
      const s1 = await snap("O2-04-after-buys");
      await tapSel("#btn-journal");
      await sleep(500);
      const claimText = await ev(`document.getElementById('journal-claim')?.textContent`);
      const claimable = await ev(`(()=>{const b=document.getElementById('journal-claim');return !b.disabled})()`);
      if (claimable) { await tapSel("#journal-claim"); await sleep(800); }
      const s2 = await snap("O2-05-claimed");
      await shot("O2-05-claimed");
      await tapSel("#journal-close");
      await sleep(300);
      return { before: s0.save?.daily?.goals, after: s2.save?.daily, claimText, claimed: claimable, moyuAfter: s2.save?.moyu };
    }, { pauseAfter: 600 });
    await act("打开 🎮 摸鱼站：看 3 个游戏（今天剩 2 次）", async () => {
      await tapSel("#btn-arcade");
      await sleep(500);
      const s = await snap("O2-06-arcade-menu");
      await shot("O2-06-arcade-menu");
      return { arcadeLeft: await ev(`document.getElementById('arcade-left')?.textContent`), body: s.texts.arcade };
    }, { pauseAfter: 1800 });
    await act("玩「找老板」（30 秒，测一局实际墙钟耗时）", async () => {
      const r = await playFindBoss();
      await snap("O2-07-findboss-result");
      await shot("O2-07-findboss-result");
      return r;
    });
    await act("回菜单看次数", async () => backToMenu());
    await act("玩「节奏点击」（30 秒）", async () => {
      const r = await playRhythm();
      await snap("O2-08-rhythm-result");
      await shot("O2-08-rhythm-result");
      return r;
    });
    await act("回菜单，关掉摸鱼站", async () => {
      const left = await backToMenu();
      await tapSel("#arcade-close");
      await sleep(400);
      const s = await snap("O2-09-after-games");
      return { leftAfter: left, arcadeSave: s.save?.arcade, moyu: s.save?.moyu };
    }, { pauseAfter: 800 });
    await act("收尾：还剩什么可做（学生准备收起手机）", async () => {
      const s = await snap("O2-10-end");
      await shot("O2-10-end");
      return {
        moyu: s.save?.moyu,
        affordable: s.shopAffordable,
        daily: s.save?.daily?.goals?.map((g) => `${g.id}:${g.progress}/${g.target}${g.done ? "✓" : ""}`),
        dailyClaimed: s.save?.daily?.claimed,
        arcade: s.save?.arcade,
        teamColleagues: Object.keys(s.save?.team?.colleagues || {}).length,
        badges: s.buttons.filter((b) => b.badge).map((b) => `${b.aria}:${b.badge}`),
      };
    });
    OPEN.metrics.totalMs = now() - OPEN.t0;
    R.errors = c.errors.slice(0, 10);
    write();
    log("online done");
  },
  { timeoutMs: 420_000 },
);
log("DONE");