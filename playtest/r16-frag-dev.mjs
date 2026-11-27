// r16 终验玩家 · dev 中局：第 3 次打开（一天首开，四系统全开，最大负担）→ 第 4 次打开（40 分钟后回访，清单已清空）
// 运行：node playtest/r16-frag-dev.mjs （须 node22）
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const BASE = "http://127.0.0.1:5173/";
const OUT = "playtest/r16-shots";
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const R = { startedAt: new Date().toISOString(), url: BASE, opens: [], errors: [] };
const write = () => writeFileSync("playtest/r16-frag-dev.json", JSON.stringify(R, null, 2));
const now = () => Date.now();
const sec = (ms) => +(ms / 1000).toFixed(1);

await runChrome(
  async ({ port }) => {
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
      } catch (e) { log("shot FAIL", n, String(e).slice(0, 60)); }
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
      await sleep(35);
      await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    const tapSel = async (sel) => {
      const r = await rect(sel);
      if (!r) return false;
      await tap(r.x + r.w / 2, r.y + r.h / 2);
      return true;
    };
    const clickJs = (sel) => ev(`(()=>{const e=document.querySelector(${J(sel)});if(!e)return 'no-el';if(e.disabled)return 'disabled';e.click();return 'ok'})()`);
    const readSave = () => ev(`(()=>{try{const b=JSON.parse(localStorage.getItem('moyu-save')||'null');if(!b)return null;return {v:b.v,moyu:Math.round(b.moyu),totalEarned:Math.round(b.totalEarned||0),savedAt:b.savedAt,levels:b.levels,totalClicks:b.totalClicks,daily:b.daily,team:b.team,talents:b.talents,decor:b.decor,energy:b.energy,arcade:b.arcade,cards:b.cards,patrolSurvives:b.patrolSurvives}}catch(e){return {err:String(e)}}})()`);

    let OPEN = null;
    const openStart = (id, label) => {
      OPEN = { id, label, startedAt: new Date().toISOString(), actions: [], events: [], metrics: {}, shots: [] };
      R.opens.push(OPEN);
      log("== OPEN", id, label);
    };
    const pollState = { boss: false, cards: false, welcome: false, toast: "", sr: "", energy: "", arcadeLeft: "" };
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
          sr:$('sr-live')?.textContent||null,
          energyBadge:document.querySelector('.energy-badge')?.textContent||null,
          arcadeLeft:$('arcade-left')?.textContent||null};
      })()`);
      if (!s || s.__err) return;
      const push = (type, text) => OPEN.events.push({ t: +((now() - OPEN.t0) / 1000).toFixed(1), type, text });
      if (s.boss && !pollState.boss) push("boss-show", `${s.bossText} || timer:${s.bossTimer}`);
      if (!s.boss && pollState.boss) push("boss-hide");
      if (s.cards && !pollState.cards) push("cards-show", s.cardText);
      if (!s.cards && pollState.cards) push("cards-hide");
      if (s.welcome && !pollState.welcome) push("welcome-show", s.welcomeText);
      if (!s.welcome && pollState.welcome) push("welcome-hide");
      if (s.toast && s.toast !== pollState.toast) push("toast", s.toast);
      if (s.sr && s.sr !== pollState.sr) push("sr-live", s.sr);
      if (s.energyBadge && s.energyBadge !== pollState.energy) push("energy-badge", s.energyBadge);
      if (s.arcadeLeft && s.arcadeLeft !== pollState.arcadeLeft) push("arcade-left", s.arcadeLeft);
      pollState.boss = s.boss; pollState.cards = s.cards; pollState.welcome = s.welcome; pollState.toast = s.toast || ""; pollState.sr = s.sr || ""; pollState.energy = s.energyBadge || ""; pollState.arcadeLeft = s.arcadeLeft || "";
    };
    const playerPause = async (ms, label = "看") => {
      const end = now() + ms;
      while (now() < end) { await pollEvents(); await sleep(Math.min(240, end - now())); }
      OPEN.actions.push({ t: +((now() - OPEN.t0) / 1000).toFixed(1), label, ms });
    };
    const act = async (label, fn, { pauseAfter = 0 } = {}) => {
      const s = now();
      const out = await fn();
      const ms = now() - s;
      OPEN.actions.push({ t: +((s - OPEN.t0) / 1000).toFixed(1), label, ms, out });
      log("  act", label, `${ms}ms`, JSON.stringify(out)?.slice(0, 200) || "");
      if (pauseAfter) await playerPause(pauseAfter, `想一下(${label})`);
      return out;
    };
    const snap = async (name) => {
      const s = await ev(`(()=>{
        const $=(id)=>document.getElementById(id);
        const vis=(e)=>!!e&&!e.classList.contains('hidden')&&e.getBoundingClientRect().width>0;
        const btn=[...document.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width>0).map(b=>({id:b.id||undefined,aria:b.getAttribute('aria-label')||undefined,text:(b.textContent||'').replace(/\\s+/g,' ').trim().slice(0,44),dis:!!b.disabled,badge:(b.querySelector('.badge,.arcade-badge,.energy-badge')?.textContent||undefined)}));
        return {
          t:Math.round(performance.now()),
          hud:{moyu:$('hud-moyu')?.textContent,sub:document.querySelector('#hud .hud-sub')?.innerText,rank:$('hud-rank')?.textContent,card:$('hud-card')?.textContent},
          quest:vis($('quest'))?$('quest-text')?.textContent:null,
          panels:{journal:vis($('journal')),team:vis($('team')),arcade:vis($('arcade')),cards:vis($('cards')),boss:vis($('boss-choice')),welcome:vis($('welcome'))},
          buttons:btn,
          shopCount:document.querySelectorAll('#shop-cards .shop-card').length,
          shopEnabled:[...document.querySelectorAll('#shop-cards .shop-card')].filter(e=>!e.disabled).length,
          texts:{journal:vis($('journal'))?($('journal').innerText||'').replace(/\\n{2,}/g,'\\n').slice(0,1200):null,team:vis($('team'))?($('team').innerText||'').replace(/\\n{2,}/g,'\\n').slice(0,1200):null,arcade:vis($('arcade'))?($('arcade').innerText||'').replace(/\\n{2,}/g,'\\n').slice(0,800):null,cards:vis($('cards'))?($('cards').innerText||'').replace(/\\n+/g,' | ').slice(0,600):null,boss:vis($('boss-choice'))?($('boss-choice').innerText||'').replace(/\\n+/g,' | ').slice(0,400):null,welcome:vis($('welcome'))?($('welcome').innerText||'').replace(/\\n{2,}/g,'\\n').slice(0,400):null},
        };
      })()`);
      if (!s || s.__err) { log("snap FAIL", name, JSON.stringify(s).slice(0,160)); return { texts:{}, buttons:[], hud:{}, panels:{} }; }
      s.save = await readSave();
      OPEN.shots.push(name);
      OPEN[`snap_${name}`] = s;
      return s;
    };
    const reloadWithGap = async (secondsBack, patchMissions = false) => {
      const missionPatch = patchMissions
        ? `if(b&&b.team&&b.team.colleagues){for(const id in b.team.colleagues){const c=b.team.colleagues[id];if(c&&c.missionId){c.startedAt-=${secondsBack}*1000;c.endsAt-=${secondsBack}*1000;}}}`
        : "";
      const scriptId = (await c.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `try{const k='moyu-save';const b=JSON.parse(localStorage.getItem(k)||'null');if(b&&typeof b.savedAt==='number'){b.savedAt-=${secondsBack}*1000;}${missionPatch}localStorage.setItem(k,JSON.stringify(b));}catch(e){}`,
      })).identifier;
      try {
        await c.send("Page.reload", { ignoreCache: false });
        await waitFor("document.readyState==='complete' && !!document.getElementById('btn-arcade')", 30000);
      } finally {
        await c.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId });
      }
      await sleep(800);
    };
    // 静音后台自动：dev 页面 __MOYU__
    const hook = (code) => ev(`(()=>{try{return window.__MOYU__.${code}}catch(e){return 'ERR:'+e}})()`);

    // ===== 小游戏（结算后立刻停手，避免误点"再来一局"）=====
    const settled = () => vis("#arcade-back");
    const resultText = () => ev(`(()=>{const b=document.getElementById('arcade-back');if(!b)return null;return (document.getElementById('arcade-body')?.innerText||'').replace(/\\n+/g,' | ').slice(0,420)})()`);
    const playCoffee = async (maxMs = 36000) => {
      const st = now();
      const before = await readSave();
      await tapSel('button[data-game="coffee"]');
      await sleep(220);
      const area = await rect("#play-area");
      while (now() - st < maxMs) {
        if (await settled()) break;
        const drops = await ev(`[...document.querySelectorAll('#play-drops .drop')].filter(e=>!e.classList.contains('landed')&&!e.classList.contains('caught')).map(e=>({x:parseFloat(e.style.left)||0,top:parseFloat(e.style.top)||-1}))`);
        if (Array.isArray(drops)) {
          for (const d of drops) {
            if (d.top >= 80 && d.top <= 90 && area) { await tap(area.x + Math.min(0.97, Math.max(0.03, d.x / 100)) * area.w, area.y + area.h * 0.72); break; }
          }
        }
        await sleep(45);
      }
      const wall = now() - st;
      const after = await readSave();
      return { wallMs: wall, result: await resultText(), moyuGain: (after?.moyu ?? 0) - (before?.moyu ?? 0) };
    };
    const playFindBoss = async (maxMs = 36000) => {
      const st = now();
      const before = await readSave();
      await tapSel('button[data-game="findboss"]');
      await sleep(220);
      while (now() - st < maxMs) {
        if (await settled()) break;
        await ev(`(()=>{const b=document.querySelector('#play-grid button.face.boss');if(b)b.click()})()`);
        await sleep(360 + Math.floor(Math.random() * 240));
      }
      const wall = now() - st;
      const after = await readSave();
      return { wallMs: wall, result: await resultText(), moyuGain: (after?.moyu ?? 0) - (before?.moyu ?? 0) };
    };
    const playRhythm = async (maxMs = 38000) => {
      const st = now();
      const before = await readSave();
      await tapSel('button[data-game="rhythm"]');
      const clickAnchor = now();
      await sleep(200);
      const area = await rect("#play-area");
      let k = 0;
      while (now() - st < maxMs) {
        if (await settled()) break;
        const target = clickAnchor + 600 + 500 * k - 10;
        const wait = target - now();
        if (wait > 0) await sleep(Math.min(wait, 120));
        else {
          if (await settled()) break;
          if (area) await tap(area.x + area.w * 0.5, area.y + area.h * 0.55);
          k++;
          await sleep(Math.max(0, 500 - (now() - target)));
        }
      }
      const wall = now() - st;
      const after = await readSave();
      return { wallMs: wall, taps: k, result: await resultText(), moyuGain: (after?.moyu ?? 0) - (before?.moyu ?? 0) };
    };
    const backToMenu = async () => { await tapSel("#arcade-back"); await sleep(350); };

    // ============== 设备 ==============
    await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });

    // ============== Open 3：中局首开（四系统全开）==============
    openStart("O3", "dev·中局（一天首开，四系统全开，最大负担）");
    OPEN.t0 = now();
    await c.send("Page.navigate", { url: BASE });
    await waitFor("document.readyState==='complete' && !!window.__MOYU__ && !!document.getElementById('btn-arcade')", 30000);
    await sleep(1000);
    OPEN.metrics.bootMs = now() - OPEN.t0;
    await hook("reset()");
    await sleep(300);
    await hook("grant(1000000)");
    await sleep(2500);
    await c.send("Page.reload", { ignoreCache: false });
    await waitFor("document.readyState==='complete' && !!window.__MOYU__ && !!document.getElementById('btn-arcade')", 30000);
    await sleep(1200);
    OPEN.metrics.setupReloadMs = now() - OPEN.t0;
    await act("首屏：读 HUD / 角标 / 目标链", async () => {
      await playerPause(2500, "读首屏");
      const s = await snap("O3-01-first-screen");
      await shot("O3-01-first-screen");
      return { hud: s.hud, quest: s.quest, badges: s.buttons.filter((b) => b.badge).map((b) => `${b.aria}:${b.badge}`), shopCount: s.shopCount, shopEnabled: s.shopEnabled };
    });
    await act("戳 8 下触发今日卡", async () => {
      const cv = await rect("#stage");
      for (let i = 0; i < 8; i++) { await tap(cv.x + cv.w * (0.3 + 0.4 * Math.random()), cv.y + cv.h * (0.35 + 0.3 * Math.random())); await sleep(240); }
      await sleep(600);
      return true;
    });
    await act("今日卡：读 3 张再选（记录耗时）", async () => {
      const shown = await waitFor("!document.getElementById('cards').classList.contains('hidden')", 6000);
      const s = await snap("O3-02-cards");
      await shot("O3-02-cards");
      await playerPause(4000, "读 3 张卡");
      const chosen = await ev(`(()=>{const c=document.querySelector('#cards .card');if(!c)return 'no-card';c.click();return c.dataset.id})()`);
      await sleep(700);
      return { shown, cards: s.texts.cards, chosen };
    });
    await act("清一波升级（把攒的钱变挂机）", async () => {
      const plan = [["phone", 8], ["toilet", 5], ["group", 3], ["meeting", 1]];
      let clicks = 0;
      for (const [id, n] of plan) {
        for (let i = 0; i < n; i++) {
          const r = await clickJs(`#shop-cards button[data-upgrade="${id}"]`);
          if (r !== "ok") break;
          clicks++;
          await sleep(130);
        }
      }
      await sleep(600);
      const s = await snap("O3-03-after-upgrades");
      return { clicks, hudIdle: s.hud.sub, moyu: s.save?.moyu };
    });
    await act("等第一次巡逻（20-35 秒窗口：盯着屏幕等老板）", async () => {
      const cv = await rect("#stage");
      const st = now();
      let seen = false;
      while (now() - st < 40000) {
        await pollEvents();
        if (pollState.boss) { seen = true; break; }
        await tap(cv.x + cv.w * (0.4 + 0.2 * Math.random()), cv.y + cv.h * (0.45 + 0.2 * Math.random()));
        await sleep(300);
      }
      const s = await snap("O3-04-boss");
      await shot("O3-04-boss");
      return { seen, sinceBoot: +((now() - OPEN.t0) / 1000).toFixed(1), text: s.texts.boss };
    });
    await act("回合制老板：读线索 → 答（记录 5 秒窗口的压迫感）", async () => {
      const s = await snap("O3-05-boss-read");
      await shot("O3-05-boss-read");
      const tell = s.texts.boss || "";
      await playerPause(1200, "读线索");
      const choice = /脚步声又快又重/.test(tell) ? "act-busy" : /盯着别人的屏幕/.test(tell) ? "switch-screen" : /边走边看手机/.test(tell) ? "keep-slacking" : "act-busy";
      const timerBefore = await ev(`document.getElementById('boss-timer')?.textContent`);
      const r = await clickJs(`button[data-choice="${choice}"]`);
      await sleep(900);
      const after = await readSave();
      const s2 = await snap("O3-06-boss-result");
      await shot("O3-06-boss-result");
      return { tell, choice, timerBefore, r, moyuAfter: after?.moyu, events: OPEN.events.filter((e) => e.type.startsWith("boss")) };
    });
    await act("打开 👥 小队：招募老周+小美、派 3 分钟任务、自动重复", async () => {
      await tapSel("#btn-team");
      await sleep(500);
      const s0 = await snap("O3-07-team-empty");
      await shot("O3-07-team-empty");
      const r1 = await clickJs('button[data-act="recruit"][data-id="zhou"]');
      await sleep(400);
      const r2 = await clickJs('button[data-act="recruit"][data-id="mei"]');
      await sleep(400);
      const s1 = await snap("O3-08-team-recruited");
      await shot("O3-08-team-recruited");
      // 派老周 3 分钟（碎片闭环），开自动重复
      const d1 = await clickJs('button[data-act="dispatch"][data-id="zhou"][data-mission="stroll"]');
      await sleep(400);
      const auto = await clickJs('button[data-act="auto"][data-id="zhou"]');
      // 派小美 30 分钟
      const d2 = await clickJs('button[data-act="dispatch"][data-id="mei"][data-mission="chat"]');
      await sleep(400);
      const s2 = await snap("O3-09-team-dispatched");
      await shot("O3-09-team-dispatched");
      return { r1, r2, d1, d2, auto, teamText: (s1.texts.team || "").slice(0, 600), afterText: (s2.texts.team || "").slice(0, 500) };
    }, { pauseAfter: 500 });
    await act("天赋 tab：盘点天赋点并点 3-4 个（读 18 个天赋的负担）", async () => {
      await tapSel("#tab-talents");
      await sleep(500);
      const s0 = await snap("O3-10-talents");
      await shot("O3-10-talents");
      const pointsBefore = s0.save?.talents?.points;
      await playerPause(2500, "读天赋树");
      const unlocked = [];
      for (const id of ["click_1", "click_2", "idle_1", "idle_2"]) {
        const r = await clickJs(`button[data-act="talent"][data-id="${id}"]`);
        if (r === "ok") unlocked.push(id);
        await sleep(250);
      }
      const s1 = await snap("O3-11-talents-done");
      return { pointsBefore, unlocked, talents: s1.save?.talents };
    });
    await act("工位 tab：买 3 件家具 + 用今日精力（省心组合）", async () => {
      await tapSel("#tab-decor");
      await sleep(500);
      const s0 = await snap("O3-12-decor");
      await shot("O3-12-decor");
      const bought = [];
      for (const id of ["plant", "lamp", "rug"]) {
        const r = await clickJs(`button[data-act="decor"][data-id="${id}"]`);
        if (r === "ok") bought.push(id);
        await sleep(300);
      }
      const energy = await clickJs('button[data-act="energy-all"]');
      await sleep(500);
      const s1 = await snap("O3-13-decor-energy");
      await shot("O3-13-decor-energy");
      await tapSel("#team-close");
      await sleep(400);
      return { bought, energyResult: energy, decor: s1.save?.decor, energyState: s1.save?.energy, text: (s0.texts.team || "").slice(0, 700) };
    }, { pauseAfter: 600 });
    await act("📔 日报：看今日 3 目标 / 能不能领", async () => {
      await tapSel("#btn-journal");
      await sleep(500);
      const s = await snap("O3-14-journal");
      await shot("O3-14-journal");
      const claimable = await ev(`(()=>{const b=document.getElementById('journal-claim');return {text:b?.textContent,dis:!!b?.disabled}})()`);
      let claimed = false;
      if (!claimable?.dis) { await tapSel("#journal-claim"); await sleep(800); claimed = true; }
      const s2 = await snap("O3-15-journal-after");
      await tapSel("#journal-close");
      await sleep(300);
      return { goals: s.save?.daily?.goals, claimedToday: s.save?.daily?.claimed, claimable, claimed, rewardHint: claimable?.text, after: s2.save?.daily?.goals };
    }, { pauseAfter: 400 });
    await act("🎮 摸鱼站：连玩 3 局（90 秒的「当日任务」实体）", async () => {
      const openAt = now();
      await tapSel("#btn-arcade");
      await sleep(500);
      const s0 = await snap("O3-16-arcade-menu");
      await shot("O3-16-arcade-menu");
      await playerPause(1500, "读 3 个游戏");
      const g1 = await playCoffee();
      await shot("O3-17-coffee-result");
      await backToMenu();
      const g2 = await playFindBoss();
      await shot("O3-18-findboss-result");
      await backToMenu();
      const g3 = await playRhythm();
      await shot("O3-19-rhythm-result");
      const left = await ev(`document.getElementById('arcade-left')?.textContent`);
      await backToMenu();
      await tapSel("#arcade-close");
      await sleep(500);
      const s1 = await snap("O3-20-after-arcade");
      return { menu: s0.texts.arcade, games: [g1, g2, g3], leftAfter: left, arcadeChunkMs: now() - openAt, arcadeSave: s1.save?.arcade, moyu: s1.save?.moyu };
    });
    await act("本次打开收尾：清点「还剩什么 / 还必须做什么」", async () => {
      const s = await snap("O3-21-end");
      await shot("O3-21-end");
      return {
        moyu: s.save?.moyu, hudIdle: s.hud?.sub,
        daily: s.save?.daily?.goals?.map((g) => `${g.id}:${g.progress}/${g.target}${g.done ? "✓" : ""}`),
        dailyClaimed: s.save?.daily?.claimed,
        arcade: s.save?.arcade,
        teamMission: Object.entries(s.save?.team?.colleagues || {}).map(([id, v]) => `${id}:${v.missionId || "idle"}${v.autoRepeat ? "/auto" : ""}`),
        badges: s.buttons.filter((b) => b.badge).map((b) => `${b.aria}:${b.badge}`),
        energy: s.save?.energy?.left,
        shopEnabled: s.shopEnabled,
      };
    });
    OPEN.metrics.totalMs = now() - OPEN.t0;
    write();

    // ============== Open 4：40 分钟后回访（清单已清空）==============
    openStart("O4", "dev·同日 40 分钟后第 4 次打开（清单已清，空窗测试）");
    OPEN.t0 = now();
    await hook("saveNow()");
    await sleep(300);
    await reloadWithGap(40 * 60, true);
    OPEN.metrics.reloadReadyMs = now() - OPEN.t0;
    await act("回访首屏：欢迎面板 + 自动重复是否自动续班", async () => {
      const s = await snap("O4-01-welcome");
      await shot("O4-01-welcome");
      await playerPause(2500, "看离线");
      const welcome = s.texts.welcome;
      if (await vis("#welcome-ok")) { await tapSel("#welcome-ok"); await sleep(600); }
      await playerPause(1200, "看自动领取");
      const s1 = await snap("O4-02-after-welcome");
      return { welcome, badges: s1.buttons.filter((b) => b.badge).map((b) => `${b.aria}:${b.badge}`), autoEvents: OPEN.events.filter((e) => /自动|回来了|领取/.test(e.text || "")), team: Object.entries(s1.save?.team?.colleagues || {}).map(([id, v]) => `${id}:${v.missionId || "idle"}${v.autoRepeat ? "/auto" : ""}`) };
    });
    await act("打开 👥 领小美的任务奖励（唯一「有事做」）", async () => {
      await tapSel("#btn-team");
      await sleep(500);
      const s0 = await snap("O4-03-team");
      await shot("O4-03-team");
      const claimAll = await clickJs('button[data-act="claim-all"]');
      await sleep(600);
      const s1 = await snap("O4-04-team-claimed");
      await shot("O4-04-team-claimed");
      await tapSel("#team-close");
      await sleep(300);
      return { claimAll, before: (s0.texts.team || "").slice(0, 500), after: (s1.texts.team || "").slice(0, 400), moyu: s1.save?.moyu };
    }, { pauseAfter: 400 });
    await act("清点：现在还剩哪些「红点/角标/可领」", async () => {
      const s = await snap("O4-05-pending");
      const pending = {
        badges: s.buttons.filter((b) => b.badge).map((b) => `${b.aria}:${b.badge}`),
        arcade: s.save?.arcade,
        energy: s.save?.energy,
        daily: s.save?.daily?.goals?.map((g) => `${g.id}:${g.progress}/${g.target}${g.done ? "✓" : ""}`),
        dailyClaimed: s.save?.daily?.claimed,
        talents: s.save?.talents,
        cardsChosen: s.save?.cards?.chosen,
        team: Object.entries(s.save?.team?.colleagues || {}).map(([id, v]) => `${id}:${v.missionId || "idle"}${v.autoRepeat ? "/auto" : ""}`),
        claimable: s.buttons.filter((b) => /领取|一键领取/.test(b.text) && !b.dis).map((b) => b.text),
      };
      return pending;
    });
    await act("摸鱼站 0 次：尝试打开看是否还有事做", async () => {
      await tapSel("#btn-arcade");
      await sleep(600);
      const s = await snap("O4-06-arcade-empty");
      await shot("O4-06-arcade-empty");
      const playable = s.buttons.filter((b) => /data-game|开始|明天再来/.test(b.text) === false && !b.dis).length;
      await tapSel("#arcade-close");
      await sleep(300);
      return { left: s.texts.arcade?.slice(0, 160), disabledAll: s.buttons.filter((b) => b.dis).map((b) => b.text) };
    });
    await act("fragment 专项：老板 5 秒窗口「没来得及选」是否惩罚（模拟被叫走）", async () => {
      await hook("forceBoss('choice')");
      const seen = await waitFor("!document.getElementById('boss-choice').classList.contains('hidden')", 6000);
      const s = await snap("O4-07-boss-timeout");
      await shot("O4-07-boss-timeout");
      const timer0 = await ev(`document.getElementById('boss-timer')?.textContent`);
      const before = await readSave();
      await playerPause(6000, "被叫走，没作答");
      const after = await readSave();
      const s2 = await snap("O4-08-boss-timeout-result");
      return { seen, timer0, bossText: s.texts.boss, moyuDelta: (after?.moyu ?? 0) - (before?.moyu ?? 0), events: OPEN.events.filter((e) => e.type.startsWith("boss") || e.type === "toast") };
    });
    await act("空窗 60 秒：学生只有「戳 + 买」，还会不会继续玩", async () => {
      const cv = await rect("#stage");
      const st = now();
      let taps = 0;
      while (now() - st < 20000) {
        await tap(cv.x + cv.w * (0.4 + 0.2 * Math.random()), cv.y + cv.h * (0.45 + 0.2 * Math.random()));
        taps++;
        await sleep(500);
      }
      const s = await snap("O4-09-after-20s");
      const upgrades = await ev(`(()=>{let n=0;const cards=[...document.querySelectorAll('#shop-cards .shop-card')];for(const c of cards){if(!c.disabled){c.click();n++;if(n>=6)break;}}return n})()`);
      await sleep(700);
      const s2 = await snap("O4-10-end");
      await shot("O4-10-end");
      return { taps, moyu: s2.save?.moyu, hudIdle: s2.hud?.sub, upgradesClicked: upgrades, badges: s2.buttons.filter((b) => b.badge).map((b) => `${b.aria}:${b.badge}`), daily: s2.save?.daily?.goals?.map((g) => `${g.id}:${g.progress}/${g.target}${g.done ? "✓" : ""}`), arcade: s2.save?.arcade };
    });
    OPEN.metrics.totalMs = now() - OPEN.t0;
    R.errors = c.errors.slice(0, 10);
    write();
    log("dev done");
  },
  { timeoutMs: 520_000 },
);
log("DONE");