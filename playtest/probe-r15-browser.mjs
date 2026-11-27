// R15 审计党实机探针 v2：摸鱼站（batch4）
// 运行：node playtest/probe-r15-browser.mjs
// 铁律：只用 playtest/lib/chrome.mjs（runChrome 必杀进程）
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const URL = "http://127.0.0.1:5173/";
const DIR = "/Users/p/Desktop/workspace/code/moyu/playtest/";
const REPORT = DIR + "r15-audit-report.json";
const report = { url: URL, startedAt: new Date().toISOString(), steps: [], checks: [], consoleErrors: [] };

function log(step, data) {
  report.steps.push({ step, at: Date.now(), data });
  console.error(`[step] ${step}`);
}
function check(name, pass, detail) {
  report.checks.push({ name, pass, detail });
  if (!pass) console.error(`  ✗ ${name} :: ${detail}`);
}
const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));

await runChrome(
  async ({ port }) => {
    const c = await connect(port);
    const send = c.send;
    const ev = async (expr) => {
      const v = await c.ev(expr);
      if (v && typeof v === "object" && "__err" in v) throw new Error(`evaluate failed: ${v.__err}`);
      return v;
    };
    const waitFor = async (expr, timeoutMs = 20000, interval = 60) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        try {
          if (await ev(expr)) return Date.now() - t0;
        } catch {
          /* 页面切换中 */
        }
        await sleep(interval);
      }
      throw new Error(`waitFor timeout: ${expr}`);
    };
    const shot = async (name) => {
      const r = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(DIR + name, Buffer.from(r.data, "base64"));
    };
    const mouseClick = async (x, y) => {
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    };
    // 注意：CDP 原生 Input.dispatchKeyEvent(Escape) 在本 headless 环境会把 rAF 冻死（环境问题），
    // 改用 document 级 KeyboardEvent 派发，走同一个 keydown 监听路径验证 Esc 关闭。
    const esc = async () => {
      await ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true})); 1");
    };
    const dismissOverlays = () =>
      ev(`(()=>{ const w=document.getElementById('welcome'); if(w && !w.classList.contains('hidden')) document.getElementById('welcome-ok')?.click();
        const cc=document.getElementById('cards'); if(cc && !cc.classList.contains('hidden')) document.getElementById('cards-skip')?.click(); return 1; })()`);
    const boot = async () => {
      await waitFor("!!window.__MOYU__ && window.__MOYU__.frames > 15", 25000);
      await dismissOverlays();
      await sleep(120);
    };
    // 静默写档：旧文档禁写，防 pagehide saveNow 覆盖
    const silentSet = () =>
      ev(`(()=>{ if(!window.__origSet){ window.__origSet = Storage.prototype.setItem; Storage.prototype.setItem = function(){}; } return 1; })()`);
    const freshReload = async () => {
      await silentSet();
      await ev("localStorage.clear(); sessionStorage.clear(); 1");
      await send("Page.reload", { ignoreCache: true });
      await boot();
    };
    const setSaveAndReload = async (mutation) => {
      await silentSet();
      await ev(`(()=>{
        const raw = JSON.parse(localStorage.getItem('moyu-save') || 'null') || { v: 2, moyu: 0, totalEarned: 0, lifetimeEarned: 0, levels: {}, savedAt: Date.now(), createdAt: Date.now() };
        ${mutation}
        window.__origSet.call(localStorage, 'moyu-save', JSON.stringify(raw));
        return 1; })()`);
      await send("Page.reload", { ignoreCache: true });
      await boot();
    };
    const installInstrument = () =>
      ev(`(()=>{
        if (window.__R15) return 'already';
        window.__R15 = { rafMeta:new Map(), rafPending:new Set(), rafExec:0, clearCalls:0, longMeta:new Map(), longPending:new Set(), dropRecs:[], toastText:'' };
        const o=window.requestAnimationFrame.bind(window), cx=window.cancelAnimationFrame.bind(window);
        window.requestAnimationFrame=(cb)=>{ const stack=(new Error().stack||'').slice(0,300); let id; id=o((t)=>{ window.__R15.rafPending.delete(id); window.__R15.rafExec++; cb(t); }); window.__R15.rafPending.add(id); window.__R15.rafMeta.set(id, stack); return id; };
        window.cancelAnimationFrame=(id)=>{ window.__R15.rafPending.delete(id); window.__R15.clearCalls++; cx(id); };
        const so=window.setTimeout.bind(window), co=window.clearTimeout.bind(window);
        window.setTimeout=(fn,ms,...a)=>{ const stack=(new Error().stack||'').slice(0,300); const id=so(fn,ms,...a); if(typeof ms==='number' && ms>=5000){ window.__R15.longPending.add(id); window.__R15.longMeta.set(id, stack+'|'+ms);} return id; };
        window.clearTimeout=(id)=>{ window.__R15.longPending.delete(id); co(id); };
        const obs=new MutationObserver((muts)=>{
          for(const m of muts){
            for(const n of m.addedNodes){ if(n.nodeType===1 && n.classList && n.classList.contains('drop')){ const rec={t:performance.now(), top:n.style.top, left:n.style.left, removeT:null}; n.__r15rec=rec; window.__R15.dropRecs.push(rec); } }
            for(const n of m.removedNodes){ if(n.nodeType===1 && n.classList && n.classList.contains('drop') && n.__r15rec) n.__r15rec.removeT=performance.now(); }
          }
          const el=document.getElementById('dom-toast'); if(el) window.__R15.toastText=el.textContent||'';
        });
        obs.observe(document.body,{childList:true,subtree:true,characterData:true});
        return 'installed';
      })()`);
    const rafInfo = () =>
      ev(`(()=>{ const r=window.__R15; const arc=[...r.rafPending].filter(id=>(r.rafMeta.get(id)||'').includes('/src/ui/arcade.ts'));
        const longs=[...r.longPending].filter(id=>(r.longMeta.get(id)||'').includes('/src/ui/arcade.ts'));
        return { rafTotal:r.rafPending.size, rafArcade:arc.length, longTotal:r.longPending.size, longArcade:longs.length, clearCalls:r.clearCalls, rafExec:r.rafExec }; })()`);
    const idleOfSave = () =>
      ev(`(async()=>{ const s=await import('/src/engine/save.ts'); const u=await import('/src/engine/upgrades.ts');
        const adapter={getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v),removeItem:k=>localStorage.removeItem(k)};
        const st=s.restore(adapter, Date.now()).state; return u.stationIdleScaled(st); })()`);
    const arcadeState = () => ev("window.__MOYU__.state.arcade");
    const openArcade = async () => {
      await ev("document.getElementById('btn-arcade').click(); 1");
      await waitFor("!document.getElementById('arcade').classList.contains('hidden')", 3000);
      await sleep(130);
    };
    const menu = () =>
      ev(`(()=>{ const cards=[...document.querySelectorAll('.arcade-card')].map(c=>{ const b=c.querySelector('button[data-game]'); const r=b?b.getBoundingClientRect():null; return { name:c.querySelector('.arcade-name')?.textContent?.trim(), desc:c.querySelector('.arcade-desc')?.textContent, game:b?.dataset.game, disabled:b?.disabled, btnSize:r?[Math.round(r.width),Math.round(r.height)]:null }; });
        const close=document.getElementById('arcade-close').getBoundingClientRect();
        return { left:document.getElementById('arcade-left').textContent, title:document.getElementById('arcade-title').textContent, cards, closeSize:[Math.round(close.width),Math.round(close.height)], rootHidden:document.getElementById('arcade').classList.contains('hidden'), role:document.getElementById('arcade').getAttribute('role'), ariaModal:document.getElementById('arcade').getAttribute('aria-modal'), state:window.__MOYU__.state.arcade }; })()`);
    const startGame = async (game) => {
      await ev(`document.querySelector('button[data-game="${game}"]').click(); 1`);
      await waitFor("document.getElementById('play-area') || document.getElementById('play-grid') || document.querySelector('.arcade-play')", 3000);
      await sleep(90);
    };
    const resultInfo = () =>
      ev(`(()=>({ score:document.querySelector('.arcade-play .arcade-score')?.textContent, hint:document.querySelector('.arcade-play .arcade-hint')?.textContent, left:document.getElementById('arcade-left').textContent, toast:document.getElementById('dom-toast')?.textContent || '' }))()`);
    const backToMenu = async () => {
      await ev("document.getElementById('arcade-back').click(); 1");
      await sleep(200);
    };
    const playFindboss = async ({ roundMs = 70, order = "all-correct" } = {}) => {
      await startGame("findboss");
      if (order === "4-1") {
        await ev("(()=>{ const bs=[...document.querySelectorAll('.face')]; const i=bs.findIndex(b=>!b.classList.contains('boss')); bs[i].click(); return i; })()");
        await sleep(roundMs);
      }
      for (let i = 0; i < 5; i++) {
        const bc = await ev("document.querySelectorAll('.face.boss').length");
        if (bc === 0) break;
        await ev("document.querySelector('.face.boss').click(); 1");
        await sleep(roundMs);
      }
      await waitFor("!!document.getElementById('arcade-back')", 8000);
      const r = await resultInfo();
      const st = await arcadeState();
      return { ...r, arcade: st };
    };

    try {
      await send("Page.enable", {});
      await send("Runtime.enable", {});
      // 关掉多余的 target，保证本页可见/可跑 rAF
      try {
        const info = await send("Target.getTargetInfo");
        const myId = info.targetInfo?.targetId;
        const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
        for (const t of list) if (t.type === "page" && t.id !== myId) await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`).catch(() => {});
        await fetch(`http://127.0.0.1:${port}/json/activate/${myId}`).catch(() => {});
      } catch {
        /* ignore */
      }
      await send("Page.navigate", { url: URL });
      await boot();
      await freshReload();
      await installInstrument();
      const today = await ev("new Date().toLocaleDateString('sv-SE')");
      log("fresh", { today, arcade: await arcadeState() });

      /* ---------- 1. 菜单 ---------- */
      await openArcade();
      const m0 = await menu();
      log("menu-initial", m0);
      check("初始 3/3 次", m0.left.includes("3/3"), m0.left);
      check("3 个游戏卡、按钮均可用", m0.cards.length === 3 && m0.cards.every((x) => x.disabled === false), JSON.stringify(m0.cards.map((x) => [x.game, x.disabled])));
      check("role=dialog + aria-modal", m0.role === "dialog" && m0.ariaModal === "true", JSON.stringify([m0.role, m0.ariaModal]));
      check("关闭按钮 44×44", m0.closeSize[0] === 44 && m0.closeSize[1] === 44, JSON.stringify(m0.closeSize));
      check("开始按钮高度 ≥44", m0.cards.every((x) => x.btnSize && x.btnSize[1] >= 44), JSON.stringify(m0.cards.map((x) => x.btnSize)));
      check("初始最高分均 0", m0.cards.every((x) => /最高 0/.test(x.name)), JSON.stringify(m0.cards.map((x) => x.name)));

      /* ---------- 2. Esc 关闭 ---------- */
      await esc();
      await sleep(150);
      check("Esc 关闭摸鱼站", await ev("document.getElementById('arcade').classList.contains('hidden')"), "arcade hidden");
      await openArcade();
      check("重开面板仍 3/3", (await menu()).left.includes("3/3"), "");

      /* ---------- 3. 接咖啡：掉落可见性 / 漏接 / 中途关闭清理 ---------- */
      await ev("window.__R15.coffeeStart = performance.now(); 1");
      await startGame("coffee");
      const coffeeSamples = [];
      for (let i = 0; i < 14; i++) {
        await sleep(160);
        coffeeSamples.push(
          await ev(`(()=>{ const sc=document.getElementById('play-score'); const tm=document.getElementById('play-timer'); return { t:Math.round(performance.now()-window.__R15.coffeeStart), score:sc?sc.textContent:null, timer:tm?tm.textContent:null, dropEls:document.querySelectorAll('.drop').length, frames:window.__MOYU__.frames }; })()`),
        );
      }
      const rafDuringCoffee = await rafInfo();
      const dropRecs = await ev("window.__R15.dropRecs.slice()");
      const coffeeStart = await ev("window.__R15.coffeeStart");
      const analyzed = dropRecs.map((r) => {
        const addMs = r.t - coffeeStart;
        const topPct = parseFloat(r.top);
        const predictedArrivalMs = addMs + (isNaN(topPct) ? 0 : (topPct / 100) * 3000);
        return {
          top: r.top,
          addMs: Math.round(addMs),
          visibleMs: r.removeT === null ? null : Math.round(r.removeT - r.t),
          predictedArrivalMs: Math.round(predictedArrivalMs),
          removedBeforeArrivalMs: r.removeT === null ? null : Math.round(predictedArrivalMs - (r.removeT - coffeeStart)),
        };
      });
      log("coffee", { coffeeSamples, analyzed: analyzed.slice(0, 8), drops: dropRecs.length, rafDuringCoffee });
      check("咖啡掉落 DOM 存在（有视觉元素）", analyzed.length > 10, `drops=${analyzed.length}`);
      check("掉落方块生命周期仅 ~400ms（无下落动画）", analyzed.every((d) => d.visibleMs !== null && d.visibleMs <= 460), JSON.stringify(analyzed.slice(0, 3)));
      check("判定时刻前掉落已消失（视觉与判定脱节）", analyzed.every((d) => d.removedBeforeArrivalMs === null || d.removedBeforeArrivalMs > 250), JSON.stringify(analyzed.filter((d) => d.removedBeforeArrivalMs !== null && d.removedBeforeArrivalMs <= 250).slice(0, 3)));
      check("无点击时 2s 内分数不为负（漏接 -2 始终不触发）", coffeeSamples.every((s) => s.score === null || s.score === "0"), JSON.stringify(coffeeSamples.map((s) => s.score)));
      check("30s 计时器在走（采样首末差 >1.5s）", coffeeSamples.length > 10 && Number(coffeeSamples[0].timer.replace("s", "")) - Number(coffeeSamples[13].timer.replace("s", "")) > 1.5, `${coffeeSamples[0].timer} → ${coffeeSamples[13].timer}`);
      check("咖啡游戏中存在 arcade rAF 循环", rafDuringCoffee.rafArcade >= 1, JSON.stringify(rafDuringCoffee));
      await esc();
      await sleep(350);
      const rafAfterCoffeeEsc = await rafInfo();
      const arcadeAfterCoffeeEsc = await arcadeState();
      log("coffee-after-esc", { rafAfterCoffeeEsc, arcadeAfterCoffeeEsc });
      check("咖啡中途 Esc：arcade rAF 清理为 0", rafAfterCoffeeEsc.rafArcade === 0, JSON.stringify(rafAfterCoffeeEsc));
      check("咖啡中途 Esc 不消耗次数", arcadeAfterCoffeeEsc.played === 0, JSON.stringify(arcadeAfterCoffeeEsc));

      /* ---------- 4. 节奏：计分 + 中途关闭清理 ---------- */
      await openArcade();
      await startGame("rhythm");
      const rafDuringRhythm = await rafInfo();
      const areaRect = await ev("(()=>{ const r=document.getElementById('play-area').getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}; })()");
      let hits = 0;
      for (let i = 0; i < 50 && hits < 5; i++) {
        if (await ev("!!document.querySelector('.beat.on')")) {
          await sleep(30);
          await mouseClick(areaRect.x, areaRect.y);
          hits++;
          await sleep(380);
        } else await sleep(15);
      }
      await sleep(100);
      const rhythmAfter = await ev(`(()=>({ score:document.getElementById('play-score')?.textContent, marks:{perfect:document.querySelectorAll('.beat.perfect').length, good:document.querySelectorAll('.beat.good').length}, beats:document.querySelectorAll('.beat').length }))()`);
      log("rhythm", { hits, rhythmAfter, rafDuringRhythm });
      check("节奏点击有得分（perfect/good 生效）", Number(rhythmAfter.score) > 0, JSON.stringify(rhythmAfter));
      check("节奏标记 class 生效", rhythmAfter.marks.perfect + rhythmAfter.marks.good >= 3, JSON.stringify(rhythmAfter.marks));
      await esc();
      await sleep(350);
      const rafAfterRhythmEsc = await rafInfo();
      const stateAfterRhythmEsc = await arcadeState();
      check("节奏中途 Esc：arcade rAF 清理为 0", rafAfterRhythmEsc.rafArcade === 0, JSON.stringify(rafAfterRhythmEsc));
      check("节奏中途 Esc 不消耗次数", stateAfterRhythmEsc.played === 0, JSON.stringify(stateAfterRhythmEsc));

      /* ---------- 5. 找老板：30s 截止定时器清理 ---------- */
      await openArcade();
      await startGame("findboss");
      await sleep(250);
      const longDuring = await rafInfo();
      await esc();
      await sleep(350);
      const longAfter = await rafInfo();
      const stateAfterFbEsc = await arcadeState();
      log("findboss-cleanup", { longDuring, longAfter });
      check("找老板 30s 定时器存在", longDuring.longArcade >= 1, JSON.stringify(longDuring));
      check("找老板中途 Esc：30s 定时器被清除", longAfter.longArcade === 0, JSON.stringify(longAfter));
      check("找老板中途 Esc 不消耗次数", stateAfterFbEsc.played === 0, JSON.stringify(stateAfterFbEsc));

      /* ---------- 6. 找老板第 1 局：4 对 1 错、奖励公式（低挂机） ---------- */
      const idleLow = await idleOfSave();
      await openArcade();
      const fb1 = await playFindboss({ order: "4-1" });
      const score1 = parseInt(String(fb1.score), 10);
      const exp1 = Math.floor((idleLow * 0.6 + 20) * (score1 / 100));
      const noIdle1 = Math.floor(20 * (score1 / 100));
      const toastNum1 = Number((fb1.toast.match(/\+([\d.]+)/) || [])[1] ?? NaN);
      log("findboss-play1", { idleLow, fb1, exp1, noIdle1, toastNum1 });
      check("找老板 4 对 1 错：分数 = 180 + floor(剩余秒*10) ∈ [420,480]", score1 >= 420 && score1 <= 480, `score=${score1}`);
      check("奖励 = floor((idle*0.6+20)*score/100)", toastNum1 === exp1, `toast=${toastNum1} exp=${exp1} idle=${idleLow}`);
      check("低挂机档公式匹配（记录 idle 项影响，可分则不同）", toastNum1 === exp1, `exp=${exp1} noIdle=${noIdle1} idle=${idleLow}`);
      check("best 写入该局分数", fb1.arcade.best.findboss === score1, JSON.stringify(fb1.arcade));
      check("结算屏显示历史最高（=本局）", String(fb1.hint).includes(String(score1)), String(fb1.hint));
      await backToMenu();
      const m1 = await menu();
      log("menu-after-play1", m1);
      check("共用次数：1 局后 2/3", m1.left.includes("2/3"), m1.left);
      check("菜单最高分显示本局", m1.cards.find((x) => x.game === "findboss")?.name.includes(String(score1)), JSON.stringify(m1.cards.map((x) => x.name)));
      check("未玩游戏的最高分仍 0", m1.cards.filter((x) => x.game !== "findboss").every((x) => /最高 0/.test(x.name)), JSON.stringify(m1.cards.map((x) => x.name)));

      /* ---------- 7. 第 2 局（5 对，更高分） ---------- */
      const fb2 = await playFindboss({ roundMs: 45 });
      const score2 = parseInt(String(fb2.score), 10);
      log("findboss-play2", { fb2 });
      check("第 2 局分数 ≥ 第 1 局（更快）", score2 >= score1, `s1=${score1} s2=${score2}`);
      check("best 取最大", fb2.arcade.best.findboss === Math.max(score1, score2), JSON.stringify(fb2.arcade.best));
      await backToMenu();
      const m2 = await menu();
      check("共用次数：2 局后 1/3", m2.left.includes("1/3"), m2.left);

      /* ---------- 8. 第 3 局：封顶、禁用、强点无效 ---------- */
      const fb3 = await playFindboss({ roundMs: 45 });
      log("findboss-play3", { fb3 });
      await backToMenu();
      const m3 = await menu();
      const arcade3 = await arcadeState();
      log("after-3-plays", { m3, arcade3 });
      check("3 次用完后 0/3", m3.left.includes("0/3") && arcade3.played === 3, JSON.stringify([m3.left, arcade3.played]));
      check("3 张卡全部禁用", m3.cards.every((x) => x.disabled === true), JSON.stringify(m3.cards.map((x) => [x.game, x.disabled])));
      await ev("document.querySelector('button[data-game=\"coffee\"]').click(); 1");
      await sleep(400);
      const afterClickDisabled = await ev("({ playArea: !!document.getElementById('play-area'), played: window.__MOYU__.state.arcade.played })");
      log("click-disabled", afterClickDisabled);
      check("禁用按钮点击不启动游戏、不消耗次数", !afterClickDisabled.playArea && afterClickDisabled.played === 3, JSON.stringify(afterClickDisabled));

      /* ---------- 9. 刷新持久化 ---------- */
      await send("Page.reload", { ignoreCache: true });
      await boot();
      await installInstrument();
      await openArcade();
      const m4 = await menu();
      const arcade4 = await arcadeState();
      log("after-reload", { m4, arcade4 });
      check("刷新后次数仍 0/3", m4.left.includes("0/3") && arcade4.played === 3, JSON.stringify([m4.left, arcade4.played]));
      check("刷新后 best 保留（findboss ≥ 前三局最高）", arcade4.best.findboss >= Math.max(score1, score2), JSON.stringify(arcade4.best));
      check("刷新后菜单仍显示最高分", m4.cards.find((x) => x.game === "findboss")?.name.includes(String(arcade4.best.findboss)), JSON.stringify(m4.cards.map((x) => x.name)));

      /* ---------- 10. 存档净化实机 ---------- */
      await setSaveAndReload(`raw.arcade = { date: new Date().toLocaleDateString('sv-SE'), played: 99, best: { ghost: 1e9, coffee: 1e9, findboss: -5 } };`);
      const arcadeSanA = await arcadeState();
      await openArcade();
      const m5 = await menu();
      log("sanitize-a", { arcadeSanA, m5 });
      check("净化A：played 99→3（0/3）", arcadeSanA.played === 3 && m5.left.includes("0/3"), JSON.stringify([arcadeSanA.played, m5.left]));
      check("净化A：合法 date 保留", arcadeSanA.date === today, JSON.stringify([arcadeSanA.date, today]));
      check("净化A：ghost 丢弃、coffee 1e9→9999、负数丢弃", JSON.stringify(arcadeSanA.best) === JSON.stringify({ coffee: 9999 }), JSON.stringify(arcadeSanA.best));
      check("净化A：菜单显示最高 9999", m5.cards.find((x) => x.game === "coffee")?.name.includes("9999"), JSON.stringify(m5.cards.map((x) => x.name)));
      await setSaveAndReload(`raw.arcade = { date: '2026-13-40', played: 2, best: { ghost: 1e9 } };`);
      const arcadeSanB = await arcadeState();
      await openArcade();
      const m6 = await menu();
      log("sanitize-b", { arcadeSanB, m6 });
      check("净化B：非法 date → 今日、played 归 0、ghost 丢弃", arcadeSanB.date === today && arcadeSanB.played === 0 && JSON.stringify(arcadeSanB.best) === "{}" && m6.left.includes("3/3"), JSON.stringify([arcadeSanB, m6.left]));

      /* ---------- 11. 高挂机档奖励公式（0.6×idle 项实机验证） ---------- */
      await setSaveAndReload(`raw.levels = { ...(raw.levels||{}), phone: 5 }; raw.arcade = { date: new Date().toLocaleDateString('sv-SE'), played: 0, best: {} }; raw.moyu = Math.max(raw.moyu||0, 10000); raw.totalEarned = Math.max(raw.totalEarned||0, 10000); raw.lifetimeEarned = Math.max(raw.lifetimeEarned||0, 10000); raw.savedAt = Date.now(); raw.createdAt = Date.now();`);
      const idleHi = await idleOfSave();
      await openArcade();
      const hiMenu = await menu();
      const fbHi = await playFindboss({ roundMs: 45 });
      const scoreHi = parseInt(String(fbHi.score), 10);
      const expHi = Math.floor((idleHi * 0.6 + 20) * (scoreHi / 100));
      const noIdleHi = Math.floor(20 * (scoreHi / 100));
      const toastHi = Number((fbHi.toast.match(/\+([\d.]+)/) || [])[1] ?? NaN);
      log("high-idle", { idleHi, hiMenu, fbHi, expHi, noIdleHi, toastHi });
      check("高挂机档 idle≈10.2（phone5）", idleHi > 5, `idle=${idleHi}`);
      check("高挂机档奖励严格等于公式", toastHi === expHi && expHi > noIdleHi, `toast=${toastHi} exp=${expHi} noIdle=${noIdleHi}`);

      /* ---------- 12. 0 分也消耗次数（接咖啡 30s 不点击） ---------- */
      await freshReload();
      await installInstrument();
      await openArcade();
      await startGame("coffee");
      const timerSamples = [];
      for (let i = 0; i < 6; i++) {
        await sleep(4000);
        timerSamples.push(await ev("document.getElementById('play-timer')?.textContent"));
      }
      const midArcade = await arcadeState();
      await waitFor("!!document.getElementById('arcade-back')", 20000, 200);
      const zeroResult = await resultInfo();
      const zeroArcade = await arcadeState();
      log("coffee-30s-zero", { timerSamples, midArcade, zeroResult, zeroArcade });
      check("30s 计时器持续走（中途未冻结）", timerSamples.every((t) => typeof t === "string" && t.endsWith("s")), JSON.stringify(timerSamples));
      check("接咖啡 30s 后自动结算", zeroArcade.played === 1, JSON.stringify(zeroArcade));
      check("0 分也消耗次数（菜单 2/3）", String(zeroResult.left).includes("2/3"), String(zeroResult.left));
      check("0 分无奖励（toast）", String(zeroResult.toast).includes("没拿到奖励") || zeroResult.toast === "", `toast=${zeroResult.toast}`);
      await ev("document.getElementById('arcade-back').click(); 1");
      await sleep(200);
      const zeroMenu = await menu();
      check("0 分不写 best（菜单最高 0）", zeroMenu.cards.find((x) => x.game === "coffee")?.name.includes("最高 0"), JSON.stringify(zeroMenu.cards.map((x) => x.name)));

      /* ---------- 13. 视觉证据截图（接咖啡掉落闪现） ---------- */
      await send("Page.reload", { ignoreCache: true });
      await boot();
      await openArcade();
      await startGame("coffee");
      await sleep(300);
      const visual = await ev("({ drops: document.querySelectorAll('.drop').length, tops: [...document.querySelectorAll('.drop')].map(d=>d.style.top), timer:document.getElementById('play-timer')?.textContent })");
      await shot("r15-coffee-drops.png");
      await sleep(1200);
      const visual2 = await ev("({ drops: document.querySelectorAll('.drop').length, timer:document.getElementById('play-timer')?.textContent })");
      await shot("r15-coffee-late.png");
      log("visual", { visual, visual2 });
      check("视觉证据：t≈0.3s 有掉落块、t≈1.5s 判定窗口内无任何掉落块", visual.drops > 0 && visual2.drops === 0, JSON.stringify({ visual, visual2 }));

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
  { timeoutMs: 240_000 },
);

console.log("done, report=" + REPORT);