// R15 审计党实机探针 v3：摸鱼站（快照 HEAD 14057dc）
// 运行：node playtest/probe-r15-browser.mjs
// 铁律：只用 playtest/lib/chrome.mjs（runChrome 必杀进程）
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const URL = "http://127.0.0.1:5173/";
const DIR = "/Users/p/Desktop/workspace/code/moyu/playtest/";
const REPORT = DIR + "r15-audit-report.json";
const SNAPSHOT = "HEAD 14057dc / arcade b8ad5a0 / minigames fd365b1";
const report = { url: URL, snapshot: SNAPSHOT, startedAt: new Date().toISOString(), steps: [], checks: [], consoleErrors: [] };

function log(step, data) {
  report.steps.push({ step, at: Date.now(), data });
  console.error(`[step] ${step}`);
}
function check(name, pass, detail) {
  report.checks.push({ name, pass, detail });
  if (!pass) console.error(`  ✗ ${name} :: ${detail}`);
}

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
          /* 导航/刷新中 */
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
    // 注意：CDP 原生 Escape 在本 headless 环境会冻结 rAF（环境问题），用 document 级 KeyboardEvent 走同一监听路径
    const esc = () => ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true})); 1");
    const dismissOverlays = () =>
      ev(`(()=>{ const w=document.getElementById('welcome'); if(w && !w.classList.contains('hidden')) document.getElementById('welcome-ok')?.click();
        const cc=document.getElementById('cards'); if(cc && !cc.classList.contains('hidden')) document.getElementById('cards-skip')?.click(); return 1; })()`);
    const boot = async () => {
      await waitFor("!!window.__MOYU__ && window.__MOYU__.frames > 15", 25000);
      await dismissOverlays();
      await sleep(120);
    };
    const reloadAndBoot = async () => {
      // 非 reload 竞态：先打标记，等新文档（标记消失）且主循环跑起来
      await ev("window.__navNonce = 'n' + Date.now() + Math.random(); 1");
      await send("Page.reload", { ignoreCache: true });
      await waitFor("(typeof window.__navNonce === 'undefined') && !!window.__MOYU__ && window.__MOYU__.frames > 20", 25000, 80);
      await dismissOverlays();
      await sleep(250);
    };
    const silentSet = () =>
      ev(`(()=>{ if(!window.__origSet){ window.__origSet = Storage.prototype.setItem; Storage.prototype.setItem = function(){}; } return 1; })()`);
    const freshReload = async () => {
      await silentSet();
      await ev("localStorage.clear(); sessionStorage.clear(); 1");
      await reloadAndBoot();
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
    const installInstrument = () =>
      ev(`(()=>{
        if (window.__R15) return 'already';
        window.__R15 = { rafMeta:new Map(), rafPending:new Set(), rafExec:0, clearCalls:0, longMeta:new Map(), longPending:new Set() };
        const o=window.requestAnimationFrame.bind(window), cx=window.cancelAnimationFrame.bind(window);
        window.requestAnimationFrame=(cb)=>{ const stack=(new Error().stack||'').slice(0,300); let id; id=o((t)=>{ window.__R15.rafPending.delete(id); window.__R15.rafExec++; cb(t); }); window.__R15.rafPending.add(id); window.__R15.rafMeta.set(id, stack); return id; };
        window.cancelAnimationFrame=(id)=>{ window.__R15.rafPending.delete(id); window.__R15.clearCalls++; cx(id); };
        const so=window.setTimeout.bind(window), co=window.clearTimeout.bind(window);
        window.setTimeout=(fn,ms,...a)=>{ const stack=(new Error().stack||'').slice(0,300); const id=so(fn,ms,...a); if(typeof ms==='number' && ms>=5000){ window.__R15.longPending.add(id); window.__R15.longMeta.set(id, stack+'|'+ms);} return id; };
        window.clearTimeout=(id)=>{ window.__R15.longPending.delete(id); co(id); };
        return 'installed';
      })()`);
    const rafInfo = () =>
      ev(`(()=>{ const r=window.__R15; if(!r) return {noInstrument:true}; const arc=[...r.rafPending].filter(id=>(r.rafMeta.get(id)||'').includes('/src/ui/arcade.ts'));
        const longs=[...r.longPending].filter(id=>(r.longMeta.get(id)||'').includes('/src/ui/arcade.ts'));
        return { rafTotal:r.rafPending.size, rafArcade:arc.length, longArcade:longs.length, clearCalls:r.clearCalls }; })()`);
    const idleOfSave = () =>
      ev(`(async()=>{ const s=await import('/src/engine/save.ts'); const u=await import('/src/engine/upgrades.ts');
        const adapter={getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v),removeItem:k=>localStorage.removeItem(k)};
        const st=s.restore(adapter, Date.now()).state; return u.stationIdleScaled(st); })()`);
    const arcadeState = () => ev("window.__MOYU__.state.arcade");
    const openArcade = async () => {
      await ev("document.getElementById('btn-arcade').click(); 1");
      await waitFor("!document.getElementById('arcade').classList.contains('hidden')", 3000);
      await sleep(140);
    };
    const menu = () =>
      ev(`(()=>{ const cards=[...document.querySelectorAll('.arcade-card')].map(c=>{ const b=c.querySelector('button[data-game]'); const r=b?b.getBoundingClientRect():null; return { name:c.querySelector('.arcade-name')?.textContent?.trim(), desc:c.querySelector('.arcade-desc')?.textContent, game:b?.dataset.game, btnText:b?.textContent, disabled:b?.disabled, btnSize:r?[Math.round(r.width),Math.round(r.height)]:null }; });
        const close=document.getElementById('arcade-close').getBoundingClientRect();
        return { left:document.getElementById('arcade-left').textContent, title:document.getElementById('arcade-title').textContent, cards, closeSize:[Math.round(close.width),Math.round(close.height)], role:document.getElementById('arcade').getAttribute('role'), ariaModal:document.getElementById('arcade').getAttribute('aria-modal'), state:window.__MOYU__.state.arcade, toast:document.getElementById('dom-toast')?.textContent || '' }; })()`);
    const startGame = async (game) => {
      await ev(`document.querySelector('button[data-game="${game}"]').click(); 1`);
      await waitFor("document.getElementById('play-area') || document.getElementById('play-grid') || document.querySelector('.arcade-play')", 3000);
      await sleep(100);
    };
    const resultInfo = () =>
      ev(`(()=>({ score:document.querySelector('.arcade-play .arcade-score')?.textContent, hint:document.querySelector('.arcade-play .arcade-hint')?.textContent,
        record:document.querySelectorAll('.arcade-record').length, rewardRow:document.querySelector('.arcade-reward')?.textContent,
        hasBack:!!document.getElementById('arcade-back'), left:document.getElementById('arcade-left').textContent, toast:document.getElementById('dom-toast')?.textContent || '' }))()`);
    const backToMenu = async () => {
      await ev("document.getElementById('arcade-back').click(); 1");
      await sleep(220);
    };

    try {
      await send("Page.enable", {});
      await send("Runtime.enable", {});
      await send("Page.navigate", { url: URL });
      await boot();
      await freshReload();
      await installInstrument();
      const today = await ev("new Date().toLocaleDateString('sv-SE')");
      log("fresh", { today, head: SNAPSHOT, arcade: await arcadeState() });

      /* ---------- 1. 菜单 ---------- */
      await openArcade();
      const m0 = await menu();
      log("menu-initial", m0);
      check("初始 3/3 次", m0.left.includes("3/3"), m0.left);
      check("3 张卡、按钮可用、最高 0", m0.cards.length === 3 && m0.cards.every((x) => x.disabled === false) && m0.cards.every((x) => /最高 0/.test(x.name)), JSON.stringify(m0.cards.map((x) => [x.game, x.disabled, x.name])));
      check("按钮文案：3 个 30 秒（找老板标注 30 秒内无限轮）", m0.cards.find((x) => x.game === "coffee")?.btnText.includes("30 秒") && m0.cards.find((x) => x.game === "rhythm")?.btnText.includes("30 秒") && m0.cards.find((x) => x.game === "findboss")?.btnText.includes("30 秒内无限轮"), JSON.stringify(m0.cards.map((x) => x.btnText)));
      check("role=dialog + aria-modal", m0.role === "dialog" && m0.ariaModal === "true", JSON.stringify([m0.role, m0.ariaModal]));
      check("关闭按钮 44×44、开始按钮高 ≥44", m0.closeSize[0] === 44 && m0.closeSize[1] === 44 && m0.cards.every((x) => x.btnSize && x.btnSize[1] >= 44), JSON.stringify([m0.closeSize, m0.cards.map((x) => x.btnSize)]));
      await esc();
      await sleep(150);
      check("Esc 关闭摸鱼站", await ev("document.getElementById('arcade').classList.contains('hidden')"), "hidden");
      await openArcade();

      /* ---------- 2. 第 1 次：接咖啡 0 分立即退出（0 分消耗） ---------- */
      await startGame("coffee");
      await esc();
      await sleep(400);
      const p1 = await arcadeState();
      const p1toast = await ev("document.getElementById('dom-toast')?.textContent || ''");
      const p1raf = await rafInfo();
      log("play1-zero-close", { p1, p1toast, p1raf });
      check("0 分中途退出：消耗 1 次、奖励 0、不写 best", p1.played === 1 && p1.best.coffee === undefined && /没拿到奖励/.test(p1toast), JSON.stringify([p1, p1toast]));
      check("咖啡中途退出后 arcade rAF 清理", p1raf.rafArcade === 0, JSON.stringify(p1raf));
      check("中途退出不显示结算屏（直接关面板）", await ev("document.getElementById('arcade').classList.contains('hidden')"), "");

      /* ---------- 3. 第 2 次：接咖啡 下落动画 + 真点击接住 ---------- */
      await openArcade();
      await startGame("coffee");
      await ev("window.__R15.t0 = performance.now(); window.__R15.d0 = document.querySelector('.drop'); 1");
      const animSamples = [];
      for (let i = 0; i < 8; i++) {
        await sleep(200);
        animSamples.push(
          await ev(`(()=>{ const d=window.__R15.d0; return { t:Math.round(performance.now()-window.__R15.t0), top:d && d.isConnected ? d.style.top : null, landed:d?d.classList.contains('landed'):null, caught:d?d.classList.contains('caught'):null, drops:document.querySelectorAll('.drop').length }; })()`),
        );
      }
      const anim = animSamples.filter((s) => s.top !== null).map((s) => parseFloat(s.top));
      await shot("r15-coffee-fall.png");
      // 找接近杯口的掉落并点击
      let caught = 0;
      let clickRounds = 0;
      for (let i = 0; i < 60 && caught === 0; i++) {
        const target = await ev(`(()=>{ const a=document.getElementById('play-area'); const r=a.getBoundingClientRect();
          const ds=[...document.querySelectorAll('.drop')].filter(d=>!d.classList.contains('caught'));
          const pick=ds.map(d=>({d, top:parseFloat(d.style.top)||0})).filter(x=>x.top>=80).sort((a,b)=>b.top-a.top)[0];
          if(!pick) return null; const dr=pick.d.getBoundingClientRect();
          return { x:dr.left+dr.width/2, y:dr.top+dr.height/2, top:pick.top, left:pick.d.style.left }; })()`);
        clickRounds++;
        if (!target) { await sleep(30); continue; }
        await mouseClick(target.x, target.y);
        await sleep(120);
        const sc = await ev("Number(document.getElementById('play-score')?.textContent||0)");
        const caughtEls = await ev("document.querySelectorAll('.drop.caught').length");
        const landed = await ev("({caught:document.querySelectorAll('.drop.caught').length, score:Number(document.getElementById('play-score')?.textContent||0)})");
        caught = caughtEls + (sc > 0 ? 1 : 0);
        log("coffee-catch-attempt", { target, score: sc, landed: landed, clickRounds });
        void sc;
      }
      const coffeePlayScore = await ev("Number(document.getElementById('play-score')?.textContent||0)");
      await esc();
      await sleep(400);
      const p2 = await arcadeState();
      const p2toast = await ev("document.getElementById('dom-toast')?.textContent || ''");
      log("play2-coffee-catch", { animSamples, anim, coffeePlayScore, p2, p2toast });
      const animMonotonic = anim.every((v, i) => i === 0 || v >= anim[i - 1] - 0.01);
      check("咖啡掉落有下落动画（首个掉落 top 持续下移至杯口 88%）", anim.length >= 3 && animMonotonic && anim[0] < 80 && anim[anim.length - 1] >= 87.5, JSON.stringify(anim));
      check("咖啡落地后加 .landed class", animSamples.some((x) => x.landed === true), JSON.stringify(animSamples.map((x) => x.landed)));
      check("咖啡可被真实点击接住（得分 > 0）", coffeePlayScore > 0, `score=${coffeePlayScore} clicks=${clickRounds}`);
      check("接住后结算：次数 2、best.coffee=本局分", p2.played === 2 && p2.best.coffee === coffeePlayScore, JSON.stringify([p2, coffeePlayScore]));
      check("早期保底奖励：idle≈0.2、score≈10 → toast 奖励 = max(0, ceil(30*score/600)) = 1", /\+1（得分/.test(p2toast), p2toast);

      /* ---------- 4. 第 3 次：节奏（perfect 20 vs 规格 25、乱点 -5、中途退出结算） ---------- */
      await openArcade();
      await startGame("rhythm");
      const rect = await ev("(()=>{ const r=document.getElementById('play-area').getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}; })()");
      const rhythms = [];
      for (let i = 0; i < 40 && rhythms.length < 2; i++) {
        if (await ev("!!document.querySelector('.beat.on')")) {
          await sleep(30);
          await mouseClick(rect.x, rect.y);
          await sleep(100);
          rhythms.push(await ev("Number(document.getElementById('play-score')?.textContent||0)"));
          if (rhythms.length < 2) await sleep(430);
        } else await sleep(15);
      }
      // 刚命中后 100ms 内再点：最近未用节拍在 0.4s 外 → 应为 miss（-5），连按两次验证 -10
      await mouseClick(rect.x, rect.y);
      await sleep(40);
      await mouseClick(rect.x, rect.y);
      await sleep(150);
      const rhythmAfter = await ev(`(()=>({ score:Number(document.getElementById('play-score')?.textContent||0), perfect:document.querySelectorAll('.beat.perfect').length, good:document.querySelectorAll('.beat.good').length }))()`);
      await esc();
      await sleep(400);
      const p3 = await arcadeState();
      const p3toast = await ev("document.getElementById('dom-toast')?.textContent || ''");
      log("play3-rhythm", { rhythms, rhythmAfter, p3, p3toast });
      check("节奏 perfect 单次 +20（规格为 20+额外5=25，偏小）", rhythms[0] === 20 || rhythms[0] === 10, `首次得分=${rhythms[0]}`);
      const beforePenalty = rhythms.at(-1) ?? 0;
      check("节奏无节拍乱点 -5/次（连按两次 -10）", rhythmAfter.score === Math.max(0, beforePenalty - 10), `before=${beforePenalty} after=${rhythmAfter.score}`);
      check("节奏中途退出结算：次数 3、best.rhythm=当前分", p3.played === 3 && p3.best.rhythm === rhythmAfter.score, JSON.stringify([p3, rhythmAfter.score]));

      /* ---------- 5. 封顶：0/3、按钮禁用、强点无效 ---------- */
      await openArcade();
      const m1 = await menu();
      log("menu-0-of-3", m1);
      check("3 次用完后 0/3 且提示明天再来", m1.left.includes("0/3") || m1.left.includes("明天"), m1.left);
      check("3 张卡全部禁用、按钮文案「明天再来」", m1.cards.every((x) => x.disabled === true && x.btnText === "明天再来"), JSON.stringify(m1.cards.map((x) => [x.disabled, x.btnText])));
      await ev("document.querySelector('button[data-game=\"coffee\"]').click(); 1");
      await sleep(350);
      const noStart = await ev("({ playArea: !!document.getElementById('play-area'), played: window.__MOYU__.state.arcade.played })");
      check("禁用按钮点击不启动游戏、不消耗次数", !noStart.playArea && noStart.played === 3, JSON.stringify(noStart));

      /* ---------- 6. 刷新持久化 ---------- */
      await reloadAndBoot();
      await installInstrument();
      await openArcade();
      const m2 = await menu();
      const persisted = await arcadeState();
      log("after-reload", { m2, persisted });
      check("刷新后 0/3、best 保留（coffee/rhythm/findboss）", persisted.played === 3 && persisted.best.coffee === coffeePlayScore && persisted.best.rhythm === rhythmAfter.score && m2.left.includes("0/3"), JSON.stringify(persisted));
      check("刷新后菜单显示最高分", m2.cards.find((x) => x.game === "coffee")?.name.includes(String(coffeePlayScore)) && m2.cards.find((x) => x.game === "rhythm")?.name.includes(String(rhythmAfter.score)), JSON.stringify(m2.cards.map((x) => x.name)));

      /* ---------- 7. 存档净化实机 ---------- */
      await setSaveAndReload(`raw.arcade = { date: new Date().toLocaleDateString('sv-SE'), played: 99, best: { ghost: 1e9, coffee: 1e9, findboss: -5 } };`);
      const sanA = await arcadeState();
      await openArcade();
      const mA = await menu();
      log("sanitize-a", { sanA, mA });
      check("净化A：played 99→3（0/3）", sanA.played === 3 && (mA.left.includes("0/3") || mA.left.includes("明天")), JSON.stringify([sanA.played, mA.left]));
      check("净化A：合法 date 保留、ghost 丢弃、coffee 1e9→9999", sanA.date === today && JSON.stringify(sanA.best) === JSON.stringify({ coffee: 9999 }), JSON.stringify(sanA));
      check("净化A：菜单显示最高 9999", mA.cards.find((x) => x.game === "coffee")?.name.includes("9999"), JSON.stringify(mA.cards.map((x) => x.name)));
      await setSaveAndReload(`raw.arcade = { date: '2026-13-40', played: 2, best: { ghost: 1e9 } };`);
      const sanB = await arcadeState();
      await openArcade();
      const mB = await menu();
      log("sanitize-b", { sanB, mB });
      check("净化B：非法 date → 今日、played 归 0、ghost 丢弃", sanB.date === today && sanB.played === 0 && JSON.stringify(sanB.best) === "{}" && mB.left.includes("3/3"), JSON.stringify([sanB, mB.left]));

      /* ---------- 8. 找老板自然 30s 结束：时长、结算差、新纪录横幅、奖励行 ---------- */
      await setSaveAndReload(`raw.levels = {}; raw.arcade = { date: new Date().toLocaleDateString('sv-SE'), played: 0, best: {} }; raw.moyu = 0; raw.totalEarned = 0; raw.lifetimeEarned = 0; raw.savedAt = Date.now(); raw.createdAt = Date.now();`);
      await openArcade();
      const idleLow = await idleOfSave();
      await startGame("findboss");
      const tStart = Date.now();
      for (let i = 0; i < 5; i++) {
        await ev("document.querySelector('.face.boss')?.click(); 1");
        await sleep(90);
      }
      // 每次点击后 renderRound 重建面板，比分显示会被重置为 0 —— 读到的显示值就是 0
      const displayed = await ev("Number(document.getElementById('play-score')?.textContent||0)");
      const tDisplayed = Date.now();
      // 等自然结束（30s）
      await waitFor("!!document.getElementById('arcade-back')", 40000, 150);
      const naturalMs = Date.now() - tStart;
      const fbNatural = await resultInfo();
      const fbNaturalState = await arcadeState();
      log("findboss-natural", { idleLow, displayed, tDisplayed, naturalMs, fbNatural, fbNaturalState });
      const finalScore = parseInt(String(fbNatural.score), 10);
      check("找老板单局时长 ≈30s（规格 30s）", naturalMs > 28000 && naturalMs < 34000, `naturalMs=${naturalMs}`);
      check("找老板比分显示每轮被重置为 0（renderRound 硬编码 0，实测读到 0）", displayed === 0, `displayed=${displayed}`);
      check("找老板 final 分 = 5 正确×50 = 250（剩余时间奖励≈290 未结算，findScore(...0)）", finalScore === 250, `final=${finalScore} displayed=${displayed}`);
      check("新纪录横幅永不出现（best 已先被 onFinish 刷新 → record 恒 false）", fbNatural.record === 0 && String(fbNatural.hint).includes("历史最高 250"), JSON.stringify({ record: fbNatural.record, hint: fbNatural.hint }));
      const expectedRow = Math.max(Math.floor(idleLow * 25 * (finalScore / 600)), Math.ceil(30 * (finalScore / 600)));
      check("结算屏奖励行 = max(idle*25*ratio, ceil(30*ratio))", String(fbNatural.rewardRow).includes(`+${expectedRow}`), `row=${fbNatural.rewardRow} expected=+${expectedRow}`);
      check("找老板 best=250", fbNaturalState.best.findboss === 250, JSON.stringify(fbNaturalState));
      await shot("r15-findboss-record-missing.png");
      // 结算屏后再按 Esc：不应重复消耗
      await esc();
      await sleep(300);
      const afterResultEsc = await arcadeState();
      check("结算屏后 Esc 不再扣次数（无重复结算）", afterResultEsc.played === 1, JSON.stringify(afterResultEsc));

      /* ---------- 9. 高挂机 + 快速点击 → MAX_SCORE 封顶 / 中途结算快刷 ---------- */
      await setSaveAndReload(`raw.levels = { ...(raw.levels||{}), phone: 5 }; raw.arcade = { date: new Date().toLocaleDateString('sv-SE'), played: 0, best: {} }; raw.moyu = 10000; raw.totalEarned = 10000; raw.lifetimeEarned = 10000; raw.savedAt = Date.now(); raw.createdAt = Date.now();`);
      const idleHi = await idleOfSave();
      await openArcade();
      await startGame("findboss");
      const tRapid = Date.now();
      let clicks = 0;
      for (let i = 0; i < 45; i++) {
        const ok = await ev("(()=>{ const b=document.querySelector('.face.boss'); if(!b) return false; b.click(); return true; })()");
        if (ok) clicks++;
        await sleep(8);
      }
      const rapidMs = Date.now() - tRapid;
      const rapidDisplay = await ev("Number(document.getElementById('play-score')?.textContent||0)");
      await esc();
      await sleep(400);
      const pRapid = await arcadeState();
      const pRapidToast = await ev("document.getElementById('dom-toast')?.textContent || ''");
      const expRapid = Math.max(Math.floor(idleHi * 25 * 1), Math.ceil(30 * 1));
      log("rapid-findboss", { idleHi, clicks, rapidMs, rapidDisplay, pRapid, pRapidToast, expRapid });
      check("找老板快速点击 45 次 <3s 即拿到封顶分 2000", rapidMs < 3000 && pRapid.best.findboss === 2000, JSON.stringify({ rapidMs, best: pRapid.best.findboss }));
      check("MAX_SCORE=2000 生效（40+ 次正确点击结算被截断到 2000，显示仍被重置为 0）", pRapid.best.findboss === 2000, `display=${rapidDisplay} best=${pRapid.best.findboss}`);
      check("中途退出结算奖励 = max(idle*25, 30)（idle≈10.2 → 255；规格公式应 156）", pRapidToast.includes(`+${expRapid}`), `toast=${pRapidToast} expected=+${expRapid}`);
      check("中途退出也消耗次数", pRapid.played === 1, JSON.stringify(pRapid));

      /* ---------- 10. 规格偏差：与 spec-batch4 对照（实机侧） ---------- */
      const specCompare = {
        rewardSpec: "floor((idle*0.6+20)*score/100)",
        rewardImpl: "max(floor(idle*25*min(1,min(score,2000)/600)), ceil(30*ratio))",
        observedEarly: p2toast,
        observedRapid: pRapidToast,
        findbossSpec: "5 轮、正确+50/错误-20/剩余时间每 0.1s+1",
        findbossImpl: "30 秒无限轮；结束时剩余时间=0，时间奖励恒 0",
        rhythmSpec: "perfect ±80ms +20 且额外 +5（共 25）",
        rhythmImpl: `单次 perfect = 20（实测 ${rhythms[0]}）`,
        coffeeSpec: "接住+10、连击×2、漏接-2",
        coffeeImpl: "coffeeScore 下限 0（漏接扣分最多扣到 0）",
        closeSettlement: "规格未定义：中途退出按当前分结算并消耗次数（实测）",
        saveCap: "规格 best ≤9999；引擎 MAX_SCORE=2000（低分入口，save 未同步）",
      };
      report.specCompare = specCompare;
      log("spec-compare", specCompare);

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
  { timeoutMs: 300_000 },
);

console.log("done, report=" + REPORT);