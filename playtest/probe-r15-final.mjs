// R15 审计党收尾探针：验证 playedSeconds 接线 / confirm 早退确认 / 角标 / 封顶 / 净化
// 快照：HEAD bfbfc46（src: arcade d68cbadf, minigames b95b8374, main 7aa8c2c4）
// 运行：node playtest/probe-r15-final.mjs
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const URL = "http://127.0.0.1:5173/";
const DIR = "/Users/p/Desktop/workspace/code/moyu/playtest/";
const REPORT = DIR + "r15-final-report.json";
const SNAPSHOT = "HEAD bfbfc46 / arcade d68cbadf / minigames b95b8374 / main 7aa8c2c4 / save 9b2a5452 / spec 5a517f15";
const report = { url: URL, snapshot: SNAPSHOT, startedAt: new Date().toISOString(), steps: [], checks: [], consoleErrors: [] };
const log = (step, data) => {
  report.steps.push({ step, at: Date.now(), data });
  console.error(`[step] ${step}`);
};
const check = (name, pass, detail) => {
  report.checks.push({ name, pass, detail });
  if (!pass) console.error(`  ✗ ${name} :: ${detail}`);
};

await runChrome(
  async ({ port }) => {
    const c = await connect(port);
    const send = c.send;
    const ev = async (expr) => {
      const v = await c.ev(expr);
      if (v && typeof v === "object" && "__err" in v) throw new Error(`evaluate failed: ${v.__err}`);
      return v;
    };
    const waitFor = async (expr, timeoutMs = 20000, interval = 70) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        try {
          if (await ev(expr)) return Date.now() - t0;
        } catch {
          /* navigating */
        }
        await sleep(interval);
      }
      throw new Error(`waitFor timeout: ${expr}`);
    };
    const esc = () => ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true})); 1");
    const dismissOverlays = () =>
      ev(`(()=>{ const w=document.getElementById('welcome'); if(w && !w.classList.contains('hidden')) document.getElementById('welcome-ok')?.click();
        const cc=document.getElementById('cards'); if(cc && !cc.classList.contains('hidden')) document.getElementById('cards-skip')?.click(); return 1; })()`);
    const boot = async () => {
      await waitFor("!!window.__MOYU__ && window.__MOYU__.frames > 20", 25000);
      await dismissOverlays();
      await ev("window.confirm = () => true; 1");
      await sleep(150);
    };
    const silentSet = () =>
      ev(`(()=>{ if(!window.__origSet){ window.__origSet = Storage.prototype.setItem; Storage.prototype.setItem = function(){}; } return 1; })()`);
    const reloadAndBoot = async () => {
      await ev("window.__navNonce = 'n' + Date.now() + Math.random(); 1");
      await send("Page.reload", { ignoreCache: true });
      await waitFor("(typeof window.__navNonce === 'undefined') && !!window.__MOYU__ && window.__MOYU__.frames > 20", 25000, 80);
      await dismissOverlays();
      await ev("window.confirm = () => true; 1");
      await sleep(250);
    };
    const setSaveAndReload = async (mutation) => {
      await silentSet();
      await ev(`(()=>{
        const raw = JSON.parse(localStorage.getItem('moyu-save') || 'null') || { v: 2, moyu: 0, totalEarned: 0, lifetimeEarned: 0, levels: {}, savedAt: Date.now(), createdAt: Date.now() };
        ${mutation}
        window.__origSet.call(localStorage, 'moyu-save', JSON.stringify(raw));
        return 1; })()`);
      await reloadAndBoot();
    };
    const arcadeState = () => ev("window.__MOYU__.state.arcade");
    const badge = () => ev("(()=>{ const b=document.querySelector('#btn-arcade .arcade-badge'); return b ? b.textContent : null; })()");
    const openArcade = async () => {
      await ev("document.getElementById('btn-arcade').click(); 1");
      await waitFor("!document.getElementById('arcade').classList.contains('hidden')", 3000);
      await sleep(150);
    };
    const menu = () =>
      ev(`(()=>({ left:document.getElementById('arcade-left').textContent,
        cards:[...document.querySelectorAll('.arcade-card')].map(c=>{ const b=c.querySelector('button[data-game]'); return { name:c.querySelector('.arcade-name')?.textContent?.trim(), game:b?.dataset.game, btnText:b?.textContent, disabled:b?.disabled }; }),
        state:window.__MOYU__.state.arcade }))()`);
    const startGame = async (game) => {
      await ev(`document.querySelector('button[data-game="${game}"]').click(); 1`);
      await waitFor("document.getElementById('play-area') || document.getElementById('play-grid') || document.querySelector('.arcade-play')", 3000);
      await sleep(90);
    };
    const toast = () => ev("document.getElementById('dom-toast')?.textContent || ''");

    try {
      await send("Page.enable", {});
      await send("Runtime.enable", {});
      await send("Page.navigate", { url: URL });
      await boot();
      await silentSet();
      await ev("localStorage.clear(); sessionStorage.clear(); 1");
      await reloadAndBoot();
      // 注入中后期档：idle=10.2、剩 3 次
      await setSaveAndReload(`raw.levels = { ...(raw.levels||{}), phone: 5 }; raw.arcade = { date: new Date().toLocaleDateString('sv-SE'), played: 0, best: {} }; raw.moyu = 10000; raw.totalEarned = 10000; raw.lifetimeEarned = 10000; raw.savedAt = Date.now(); raw.createdAt = Date.now();`);
      const idle = await ev(`(async()=>{ const s=await import('/src/engine/save.ts'); const u=await import('/src/engine/upgrades.ts');
        const a={getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v),removeItem:k=>localStorage.removeItem(k)};
        return u.stationIdleScaled(s.restore(a, Date.now()).state); })()`);
      log("setup", { idle, state: await arcadeState() });
      check("注入档 idle≈10.2", idle > 10 && idle < 11, `idle=${idle}`);
      check("无对局时按钮无次数角标（初始不显示）", (await badge()) === null, `badge=${await badge()}`);

      /* ---------- A. 早退折算接线验证（关键：main.ts 未把 playedSeconds 传给 finishGame） ---------- */
      await openArcade();
      await startGame("findboss");
      const aT0 = Date.now();
      let clicks = 0;
      for (let i = 0; i < 45; i++) {
        const ok = await ev("(()=>{ const b=document.querySelector('.face.boss'); if(!b) return false; b.click(); return true; })()");
        if (ok) clicks++;
        await sleep(8);
      }
      const aClickMs = Date.now() - aT0;
      await esc();
      await sleep(400);
      const aState = await arcadeState();
      const aToast = await toast();
      const aElapsed = Date.now() - aT0;
      const aReward = Number((aToast.match(/\+([\d.]+)/) || [])[1] ?? NaN);
      const wiredReward = (() => {
        const p = aElapsed / 1000;
        const t = Math.max(0, Math.min(1, p / 30));
        const ratio = 1 * (t >= 1 / 3 ? 1 : t * 3);
        return Math.max(Math.floor(idle * 25 * ratio), Math.ceil(30 * ratio));
      })();
      log("early-exit-wiring", { clicks, aClickMs, aElapsed, aToast, aState, aReward, wiredReward });
      check("≥40 次正确点击在 <2s 内完成（早退路径）", clicks >= 40 && aElapsed < 3000, `clicks=${clicks} elapsed=${aElapsed}`);
      check("早退分数满 ratio（best=45×50=2250）", aState.best.findboss === 2250, JSON.stringify(aState));
      check("BUG：早退奖励按满 30s 结算（应≈" + wiredReward + "，实测满额 254）→ playedSeconds 未接线", aReward !== wiredReward && aReward >= 250, `toast=${aToast} reward=${aReward} ifWired=${wiredReward}`);
      check("结算后按钮出现次数角标 = 剩余 2", (await badge()) === "2", `badge=${await badge()}`);

      /* ---------- B. 早退确认 confirm：拒绝则不结算不扣次数；接受则结算 ---------- */
      await openArcade();
      await startGame("findboss");
      await sleep(2500);
      await ev("window.confirm = () => false; 1");
      await esc();
      await sleep(300);
      const bReject = await ev("({ hidden: document.getElementById('arcade').classList.contains('hidden'), playArea: !!document.querySelector('.arcade-play'), played: window.__MOYU__.state.arcade.played, timer: document.getElementById('play-timer')?.textContent })");
      await sleep(400);
      const bTimerLater = await ev("document.getElementById('play-timer')?.textContent");
      await ev("window.confirm = () => true; 1");
      await esc();
      await sleep(400);
      const bAccept = await arcadeState();
      log("confirm-flow", { bReject, bTimerLater, bAccept });
      check("confirm 拒绝：面板不关、不结算、次数不变、游戏继续", bReject.hidden === false && bReject.played === 1 && bTimerLater !== bReject.timer, JSON.stringify({ bReject, bTimerLater }));
      check("confirm 接受：退出结算、次数 +1", bAccept.played === 2, JSON.stringify(bAccept));

      /* ---------- C. 0 分手滑早退仍扣次数（注释称前 2 秒豁免，仅免确认） ---------- */
      await openArcade();
      await startGame("coffee");
      await esc();
      await sleep(400);
      const cState = await arcadeState();
      const cToast = await toast();
      log("zero-early-exit", { cState, cToast });
      check("0 分 0.4s 手滑退出：仍扣 1 次（'前2秒豁免'仅免确认，注释与实现不符）", cState.played === 3 && /没拿到奖励/.test(cToast), JSON.stringify([cState, cToast]));
      check("次数用尽后角标移除", (await badge()) === null, `badge=${await badge()}`);

      /* ---------- D. 封顶 / 刷新持久化 / 净化 ---------- */
      const m0 = await menu();
      log("menu-0-of-3", m0);
      check("0/3 文案与 3 卡禁用", (m0.left.includes("0/3") || m0.left.includes("明天")) && m0.cards.every((x) => x.disabled && x.btnText === "明天再来"), JSON.stringify(m0));
      await reloadAndBoot();
      const dState = await arcadeState();
      log("after-reload", { dState });
      check("刷新后 0/3 与 best 保留", dState.played === 3 && dState.best.findboss === 2250, JSON.stringify(dState));
      await setSaveAndReload(`raw.arcade = { date: new Date().toLocaleDateString('sv-SE'), played: 99, best: { ghost: 1e9, coffee: 1e9, findboss: -5 } };`);
      const eState = await arcadeState();
      await openArcade();
      const eMenu = await menu();
      log("sanitize", { eState, eMenu: { left: eMenu.left, coffee: eMenu.cards[0].name } });
      check("净化：played 99→3、ghost 丢弃、coffee 1e9→9999、date 合法保留", eState.played === 3 && JSON.stringify(eState.best) === JSON.stringify({ coffee: 9999 }), JSON.stringify(eState));
      check("净化后菜单显示最高 9999 且禁用", eMenu.cards[0].name.includes("9999") && eMenu.cards[0].disabled, JSON.stringify(eMenu.cards[0]));
      await setSaveAndReload(`raw.arcade = { date: '2026-13-40', played: 2, best: { ghost: 1e9 } };`);
      const fState = await arcadeState();
      log("sanitize-bad-date", { fState });
      check("非法 date → 今日、played 归 0、ghost 丢弃", /^\d{4}-\d{2}-\d{2}$/.test(fState.date) && fState.played === 0 && JSON.stringify(fState.best) === "{}", JSON.stringify(fState));

      report.consoleErrors = c.errors.slice(0, 20);
      report.finishedAt = new Date().toISOString();
      report.checksPassed = report.checks.filter((x) => x.pass).length;
      report.checksFailed = report.checks.filter((x) => !x.pass).map((x) => `${x.name} :: ${x.detail}`);
      writeFileSync(REPORT, JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ checks: report.checks.length, passed: report.checksPassed, failed: report.checksFailed, consoleErrors: report.consoleErrors }, null, 2));
    } catch (e) {
      report.error = String(e && e.stack ? e.stack : e);
      report.consoleErrors = c.errors.slice(0, 20);
      writeFileSync(REPORT, JSON.stringify(report, null, 2));
      console.error("PROBE FAILED:", e);
      throw e;
    } finally {
      c.close();
    }
  },
  { timeoutMs: 180_000 },
);
console.log("done, report=" + REPORT);