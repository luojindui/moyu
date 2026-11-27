/**
 * r15 收集党 · 补充探针：日报/图鉴/纪录面板是否收录摸鱼站成绩
 * 复用 playtest/lib/chrome.mjs（无残留进程）
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect, sleep } from "../../playtest/lib/chrome.mjs";

const DIR = new URL("./", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const URL_ = "http://127.0.0.1:5173/";
const wait = (ms) => sleep(ms);
const out = {};

await runChrome(
  async ({ port }) => {
    const c = await connect(port);
    const ev = async (expression) => {
      const r = await c.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
      return r.result.value;
    };
    const shot = async (name) => {
      const s = await c.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(DIR + name + ".png", Buffer.from(s.data, "base64"));
    };
    await c.send("Runtime.enable");
    await c.send("Page.enable");
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await c.send("Page.navigate", { url: URL_ });
    for (let i = 0; i < 120; i++) {
      const ok = await ev(`!!(window.__MOYU__ && document.getElementById('btn-journal'))`).catch(() => false);
      if (ok) break;
      await wait(100);
    }
    await wait(1500);
    // 先注入一笔摸鱼站成绩（走真实存档字段），验证面板会不会显示
    await ev(`(()=>{ const raw=JSON.parse(localStorage.getItem('moyu-save')||'null'); return raw?{arcade:raw.arcade}:null})()`);
    // 打开日报/图鉴
    await ev(`document.getElementById('btn-journal').click()`);
    await wait(700);
    out.journal = await ev(`(()=>{
      const panel = document.querySelector('#journal, #stats, .journal');
      const rows = [...document.querySelectorAll('.stat-row')].map(r=>r.innerText.replace(/\\n/g,' | '));
      const rank = document.getElementById('stats-rank')?.textContent;
      const tabs = [...document.querySelectorAll('#journal .tab, #journal button, .journal-tabs button')].map(b=>b.textContent.trim());
      return { rows, rank, tabs, panelVisible: !!document.querySelector('#journal:not(.hidden)'), bodyText: (document.querySelector('#journal')?.innerText||'').slice(0,1200) };
    })()`);
    await shot("20-journal-stats");
    // 找图鉴 tab：读所有 tab 按钮
    out.buttons = await ev(`[...document.querySelectorAll('#journal button, #journal [role=tab]')].map(b=>({id:b.id,text:b.textContent.trim()}))`);
    // 若有图鉴 tab，点开并数格子 vs 55
    out.collection = await ev(`(()=>{ const btns=[...document.querySelectorAll('#journal button')]; const t=btns.find(b=>/图鉴/.test(b.textContent)); if(!t) return null; t.click(); return true; })()`);
    await wait(500);
    out.collectionGrid = await ev(`(()=>{ const cells=[...document.querySelectorAll('#journal .coll-cell, #journal .collection-cell, #journal .col-cell, #journal [class*=coll]')]; return {n:cells.length, sample:cells.slice(0,3).map(c=>c.className)}; })()`);
    out.journalAfter = await ev(`(document.querySelector('#journal')?.innerText||'').slice(0,1500)`);
    await shot("21-journal-collection");
    // 关闭，打开小队面板（家具/天赋），统计家具数量
    await ev(`document.getElementById('journal-close')?.click()`);
    await wait(300);
    await ev(`document.getElementById('btn-team').click()`);
    await wait(500);
    out.teamTabs = await ev(`[...document.querySelectorAll('#team button')].map(b=>({id:b.id,text:b.textContent.trim()})).slice(0,12)`);
    await ev(`document.getElementById('tab-decor')?.click()`);
    await wait(400);
    out.decor = await ev(`(()=>{ const cards=[...document.querySelectorAll('#team-body .decor-card, #team-body .shop-card, #team-body [class*=decor]')]; return {n:cards.length, text:(document.querySelector('#team-body')?.innerText||'').slice(0,800)}; })()`);
    await shot("22-decor-tab");
    // 直接检查存档/状态里的字段结构，说明摸鱼站成绩存在于哪
    out.stateKeys = await ev(`(()=>{const s=window.__MOYU__.state; return {arcade:s.arcade, hasRecordsKey: localStorage.getItem('moyu-records')!==null, saveKeys:Object.keys(JSON.parse(localStorage.getItem('moyu-save')||'{}'))};})()`);
    c.close();
  },
  { timeoutMs: 90_000 },
);
writeFileSync(DIR + "journal-evidence.json", JSON.stringify(out, null, 2));
console.log("DONE", JSON.stringify(out).slice(0, 300));