// R15 复验探针（round 2）：早退折算是否真生效 / spec v2 一致性 / 找老板显示-结算差是否仍在
// 快照：HEAD 8d4b598（src 来自 4ffb46d：arcade 2ef4de82 / minigames 4f78ed57 / main b6fe4f3e / save 9b2a5452 / spec df82454e）
// 运行：node playtest/probe-r15-recheck.mjs
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const URL = "http://127.0.0.1:5173/";
const DIR = "/Users/p/Desktop/workspace/code/moyu/playtest/";
const REPORT = DIR + "r15-recheck-report.json";
const SNAPSHOT = "HEAD 8d4b598 / src@4ffb46d / arcade 2ef4de82 / minigames 4f78ed57 / main b6fe4f3e / save 9b2a5452 / spec df82454e";
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
    const waitFor = async (expr, timeoutMs = 20000, interval = 80) => {
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
    const boot = async () => {
      await waitFor("!!window.__MOYU__ && window.__MOYU__.frames > 20", 25000);
      await ev("window.confirm = () => true; 1");
      await ev(`(()=>{ const w=document.getElementById('welcome'); if(w&&!w.classList.contains('hidden')) document.getElementById('welcome-ok')?.click(); return 1; })()`);
      await sleep(200);
    };
    const silentSet = () =>
      ev(`(()=>{ if(!window.__origSet){ window.__origSet = Storage.prototype.setItem; Storage.prototype.setItem = function(){}; } return 1; })()`);
    const reloadAndBoot = async () => {
      await ev("window.__navNonce = 'n' + Date.now() + Math.random(); 1");
      await send("Page.reload", { ignoreCache: true });
      await waitFor("(typeof window.__navNonce === 'undefined') && !!window.__MOYU__ && window.__MOYU__.frames > 20", 25000, 80);
      await boot();
      await sleep(250);
    };
    // 确保回到菜单：面板关→打开；面板开（结算屏）→点返回
    const goMenu = async () => {
      if (await ev("document.getElementById('arcade').classList.contains('hidden')")) {
        await ev("document.getElementById('btn-arcade').click(); 1");
        await sleep(220);
      } else if (await ev("!!document.getElementById('arcade-back')")) {
        await ev("document.getElementById('arcade-back').click(); 1");
        await sleep(240);
      }
      await waitFor("!document.getElementById('arcade').classList.contains('hidden')", 3000);
      await sleep(120);
    };
    const openArcade = async () => {
      await ev("document.getElementById('btn-arcade').click(); 1");
      await waitFor("!document.getElementById('arcade').classList.contains('hidden')", 3000);
      await sleep(160);
    };
    const startGame = async (game) => {
      await ev(`document.querySelector('button[data-game="${game}"]').click(); 1`);
      await waitFor("document.getElementById('play-area') || document.getElementById('play-grid') || document.querySelector('.arcade-play')", 3000);
      return Date.now();
    };
    const clickBoss = async (n) => {
      let ok = 0;
      for (let i = 0; i < n; i++) {
        if (await ev("(()=>{ const b=document.querySelector('.face.boss'); if(!b) return false; b.click(); return true; })()")) ok++;
        await sleep(12);
      }
      return ok;
    };
    const arcadeState = () => ev("window.__MOYU__.state.arcade");
    const toast = () => ev("document.getElementById('dom-toast')?.textContent || ''");
    const badge = () => ev("(()=>{ const b=document.querySelector('#btn-arcade .arcade-badge'); return b ? b.textContent : null; })()");
    const menu = () =>
      ev(`(()=>({ left:document.getElementById('arcade-left').textContent,
        cards:[...document.querySelectorAll('.arcade-card')].map(c=>({ name:c.querySelector('.arcade-name')?.textContent?.trim(), descs:[...c.querySelectorAll('.arcade-desc')].map(d=>d.textContent), game:c.querySelector('button[data-game]')?.dataset.game, btnText:c.querySelector('button[data-game]')?.textContent, disabled:c.querySelector('button[data-game]')?.disabled })),
        state:window.__MOYU__.state.arcade }))()`);

    try {
      await send("Page.enable", {});
      await send("Runtime.enable", {});
      await send("Page.navigate", { url: URL });
      await boot();
      await silentSet();
      await ev("localStorage.clear(); sessionStorage.clear(); 1");
      await reloadAndBoot();
      // 注入中后期档：idle≈10.2、剩 3 次
      await silence();
      async function silence() {
        await silentSet();
      }
      await ev(`(()=>{ const raw=JSON.parse(localStorage.getItem('moyu-save')||'null')||{v:2,moyu:0,totalEarned:0,lifetimeEarned:0,levels:{},savedAt:Date.now(),createdAt:Date.now()};
        raw.levels={ ...(raw.levels||{}), phone:5 }; raw.arcade={ date:new Date().toLocaleDateString('sv-SE'), played:0, best:{} };
        raw.moyu=10000; raw.totalEarned=10000; raw.lifetimeEarned=10000; raw.savedAt=Date.now(); raw.createdAt=Date.now();
        window.__origSet.call(localStorage,'moyu-save',JSON.stringify(raw)); return 1; })()`);
      await reloadAndBoot();
      const idle = await ev(`(async()=>{ const s=await import('/src/engine/save.ts'); const u=await import('/src/engine/upgrades.ts');
        const a={getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v),removeItem:k=>localStorage.removeItem(k)};
        return u.stationIdleScaled(s.restore(a, Date.now()).state); })()`);
      log("setup", { idle, state: await arcadeState(), badge: await badge(), head: SNAPSHOT });
      check("注入档 idle≈10.2", idle > 10 && idle < 11, `idle=${idle}`);
      check("🎮 启动即显示剩余次数角标 = 3", (await badge()) === "3", `badge=${await badge()}`);

      await openArcade();
      const m0 = await menu();
      log("menu", m0);
      check("菜单：找老板标注 30 秒内无限轮", m0.cards.find((x) => x.game === "findboss")?.btnText.includes("30 秒内无限轮"), JSON.stringify(m0.cards.map((x) => x.btnText)));
      check("菜单：显示满分奖励说明（25 秒挂机 / 新号保底 30）", m0.cards.every((x) => x.descs.some((d) => d.includes("25 秒挂机收益") && d.includes("保底 30"))), JSON.stringify(m0.cards.map((x) => x.descs)));

      /* ---------- A. <2s 早退：退还次数（spec v2 写"消耗次数"，实现相反） ---------- */
      const aStart = await startGame("findboss");
      await sleep(500);
      await esc();
      await sleep(400);
      const a = { state: await arcadeState(), toast: await toast(), panelHidden: await ev("document.getElementById('arcade').classList.contains('hidden')"), elapsedMs: Date.now() - aStart };
      log("A-under2s-exit", a);
      check("A：<2s 退出不消耗次数（played 仍 0）、0 奖励、面板关闭", a.state.played === 0 && /没拿到奖励/.test(a.toast) && a.panelHidden && a.elapsedMs < 2000, JSON.stringify(a));
      check("A：与 spec v2「中途退出也消耗次数」不一致（spec 未写退还规则）", true, "spec mismatch → 见 P3-1");

      /* ---------- B. ~2.1s 早退（20 次点击=1000 分）：按比例缩水 ---------- */
      await goMenu();
      const bStart = await startGame("findboss");
      const bClicks = await clickBoss(20);
      // 等到 ~2.1s 再退出
      while (Date.now() - bStart < 2100) await sleep(20);
      const bElapsed = Date.now() - bStart;
      const bDisplayed = await ev("Number(document.getElementById('play-score')?.textContent||0)");
      await ev("window.confirm = () => true; 1");
      await esc();
      await sleep(450);
      const bState = await arcadeState();
      const bToast = await toast();
      const bReward = Number((bToast.match(/\+([\d.]+)/) || [])[1] ?? NaN);
      const bTf = (() => { const t = Math.min(1, bElapsed / 1000 / 30); return t >= 1 / 3 ? 1 : t * 3; })();
      const bExpected = Math.max(Math.floor(idle * 25 * Math.min(1, 1000 / 600) * bTf), Math.ceil(30 * Math.min(1, 1000 / 600) * bTf));
      log("B-early-exit-2s", { bClicks, bElapsed, bDisplayed, bToast, bReward, bState, bExpected, bTf });
      check("B：19+ 次点击在 2.1s 内完成、按比例结算、消耗 1 次", bClicks >= 19 && bState.played === 1, JSON.stringify({ bClicks, played: bState.played }));
      check("B(新发现)：早退 best 含剩余时间分（≈1278，正常结束最多 1000）→ best 被早退抬高", bState.best.findboss > 1000 && bState.best.findboss <= 1310, JSON.stringify({ bDisplayed, best: bState.best }));
      check("B：奖励 = max(idle*25*ratio, ceil(30*ratio))，ratio=分数比×时长系数", Math.abs(bReward - bExpected) <= 2, `toast=${bReward} expected=${bExpected} tf=${bTf.toFixed(3)}`);

      /* ---------- C. 打满 30s（同 20 次点击）：全额 + 找老板显示/结算差 ---------- */
      await goMenu();
      const cStart = await startGame("findboss");
      const cClicks = await clickBoss(20);
      const cDisplayed = await ev("Number(document.getElementById('play-score')?.textContent||0)");
      await waitFor("!!document.getElementById('arcade-back')", 40000, 150);
      const cElapsed = Date.now() - cStart;
      const cResult = await ev(`(()=>({ score:document.querySelector('.arcade-play .arcade-score')?.textContent, record:(document.querySelector('.arcade-record')||{}).textContent||'', hint:(document.querySelector('.arcade-hint')||{}).textContent||'', rewardRow:document.querySelector('.arcade-reward')?.textContent||'', left:document.getElementById('arcade-left').textContent }))()`);
      const cState = await arcadeState();
      const cToast = await toast();
      const cReward = Number((cToast.match(/\+([\d.]+)/) || [])[1] ?? NaN);
      log("C-full-30s", { cClicks, cElapsed, cDisplayed, cResult, cState, cToast, cReward });
      check("C：单局时长≈30s、最终分 1000（findScore(20,0,0)）、奖励全额 254", cElapsed > 28500 && cElapsed < 34000 && String(cResult.score) === "1000 分" && cReward === 254, JSON.stringify({ cElapsed, score: cResult.score, cReward }));
      check("C：找老板显示分（含剩余时间≈299）≠ 结算分 1000 —— 显示口径差仍在", cDisplayed > 1200 && cDisplayed - 1000 > 200, `displayed=${cDisplayed} final=1000`);
      const ratio = cReward / bReward;
      log("early-vs-full", { full: cReward, early2_1s: bReward, ratio });
      check("早退 vs 打满：实测差距 ≈4.8×（2.1s 退）；2.0s 理论上限恰 5.0×，「>5×」不成立", ratio > 4.2 && ratio < 5.05, `ratio=${ratio.toFixed(2)}`);
      check("C：结算屏奖励行 +254", /\+254/.test(cResult.rewardRow), cResult.rewardRow);

      /* ---------- D. confirm 取消 + 接受；0 分 ≥2s 消耗次数 → 封顶 ---------- */
      await goMenu();
      const dStart = await startGame("findboss");
      while (Date.now() - dStart < 2500) await sleep(30);
      await ev("window.confirm = () => false; 1");
      await esc();
      await sleep(300);
      const dReject = await ev("({ hidden:document.getElementById('arcade').classList.contains('hidden'), played:window.__MOYU__.state.arcade.played, timer:document.getElementById('play-timer')?.textContent })");
      await sleep(500);
      const dTimerLater = await ev("document.getElementById('play-timer')?.textContent");
      await ev("window.confirm = () => true; 1");
      await esc();
      await sleep(450);
      const dAccept = await arcadeState();
      log("D-confirm", { dReject, dTimerLater, dAccept });
      check("D：confirm 取消→面板不关/次数不变/游戏继续", dReject.hidden === false && dReject.played === 2 && dTimerLater !== dReject.timer, JSON.stringify({ dReject, dTimerLater }));
      check("D：confirm 接受→0 分但 ≥2s，消耗第 3 次（played 3）", dAccept.played === 3, JSON.stringify(dAccept));
      const m0b = await menu();
      log("menu-0-of-3", m0b);
      check("D：0/3 文案 + 3 卡禁用「明天再来」+ 角标消失", (m0b.left.includes("0/3") || m0b.left.includes("明天")) && m0b.cards.every((x) => x.disabled && x.btnText === "明天再来") && (await badge()) === null, JSON.stringify({ left: m0b.left, disabled: m0b.cards.map((x) => x.disabled), badge: await badge() }));

      /* ---------- E. 刷新持久化 ---------- */
      await reloadAndBoot();
      const eState = await arcadeState();
      log("after-reload", { eState, badge: await badge() });
      check("刷新后 0/3、best 保留（早退口径）、无角标", eState.played === 3 && eState.best.findboss === bState.best.findboss && (await badge()) === null, JSON.stringify({ eState, bBest: bState.best.findboss }));

      report.consoleErrors = c.errors.slice(0, 20);
      report.finishedAt = new Date().toISOString();
      report.checksPassed = report.checks.filter((x) => x.pass).length;
      report.checksFailed = report.checks.filter((x) => !x.pass).map((x) => `${x.name} :: ${x.detail}`);
      writeFileSync(REPORT, JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ checks: report.checks.length, passed: report.checksPassed, failed: report.checksFailed, consoleErrors: report.consoleErrors, key: { idle, bReward, bExpected, bElapsed, bDisplayed, bBest: bState.best.findboss, fullReward: cReward, ratio, cDisplayed, settlementDiff: cDisplayed - 1000 } }, null, 2));
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
  { timeoutMs: 240_000 },
);
console.log("done, report=" + REPORT);