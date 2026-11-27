/** R10 排行榜/竞技型画像探针 2：本地改档伪造段位、存档码导入路径真机核对。
 *  只读 src/，只写 playtest/。
 */
import { openBrowser, setupMobilePage, sleep } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";

const URL = "http://127.0.0.1:5173/";
const evidence = { url: URL, at: new Date().toISOString(), steps: {} };

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
const b64url = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (c) => Buffer.from(c.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const encodeCode = (json) => `${b64url(json)}.${fnv1a(json)}`;

async function waitFor(b, expr, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await b.ev(expr)) return Date.now() - t0;
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  throw new Error("timeout: " + expr);
}

async function newPage(initSource) {
  const b = await openBrowser({ port: 9602 + Math.floor(Math.random() * 300), tag: "r10b" });
  await setupMobilePage(b, { injectSource: initSource, url: URL });
  await waitFor(b, "!!window.__MOYU__ && !!document.getElementById('stage') && window.__MOYU__.frames>5");
  return b;
}

// ---------- A. 本地改档 → 伪造段位（任何读本地存档的榜单都会被骗） ----------
{
  const forgedSave = JSON.stringify({
    v: 1,
    moyu: 1e12,
    totalEarned: 9e15,
    levels: { coffee: 50, phone: 50, toilet: 50 },
    savedAt: Date.now(),
    createdAt: Date.now() - 30 * 86400000,
    collected: { quotes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], flavors: Array.from({ length: 45 }, (_, i) => i) },
    daily: null,
    surviveStreak: 99,
    totalClicks: 20000,
    visits: { date: "2026-11-27", count: 3 },
    lifetimeEarned: 9e15,
    prestige: 9999,
  });
  const init = `try { localStorage.setItem("moyu-save", ${JSON.stringify(forgedSave)}); } catch (e) {}`;
  const b = await newPage(init);
  try {
    await sleep(800);
    evidence.steps.localEditForged = await b.evj(`(() => {
      const st = window.__MOYU__.state;
      return JSON.stringify({
        lifetime: st.lifetimeEarned, prestige: st.prestige, collection: st.collected.quotes.length + st.collected.flavors.length,
        hudRank: document.getElementById("hud-rank").textContent,
        hudRankTitle: document.getElementById("hud-rank").title,
        journalWasOpened: false,
        pages: 1,
      });
    })()`);
    await b.ev(`document.getElementById("btn-journal").click(); 1`);
    await sleep(700);
    evidence.steps.localEditForged.journalStats = await b.ev(`document.getElementById("stats-list").innerText + " || " + document.getElementById("stats-rank").textContent`);
    await b.shot("playtest/r10-local-edit-forged-rank.png");
  } finally {
    b.close();
  }
}

// ---------- B. 存档码导入：篡改+重算校验和 → 是否被接受？被 pagehide 存档覆盖？ ----------
{
  const b = await newPage(null);
  try {
    // 打开面板、生成存档码
    const code = await b.ev(`(() => {
      document.getElementById("btn-journal").click();
      const ta = document.getElementById("savecode");
      document.getElementById("savecode-copy").click();
      return ta.value;
    })()`);
    const raw = JSON.parse(fromB64url(code.split(".")[0]));
    evidence.steps.code = {
      length: code.length,
      rawBytes: JSON.stringify(raw).length,
      sampleState: { moyu: raw.moyu, lifetime: raw.lifetimeEarned, clicks: raw.totalClicks },
    };
    const forged = JSON.stringify({ ...raw, moyu: 1e12, totalEarned: 9e15, lifetimeEarned: 9e15, prestige: 9999 });
    const forgedCode = encodeCode(forged);

    // 页面内每 15ms 把 moyu-save 的 lifetime 记进 r10_trace（跨 reload 保留）
    await b.ev(`(() => {
      localStorage.setItem("r10_trace", JSON.stringify([]));
      window.__r10trace = setInterval(() => {
        try {
          const t = JSON.parse(localStorage.getItem("r10_trace") || "[]");
          const s = JSON.parse(localStorage.getItem("moyu-save") || "{}");
          t.push({ at: Date.now(), lifetime: s.lifetimeEarned, moyu: s.moyu, savedAt: s.savedAt });
          localStorage.setItem("r10_trace", JSON.stringify(t.slice(-120)));
        } catch (e) {}
      }, 15);
      return 1;
    })()`);

    const msg = await b.ev(`(() => {
      const ta = document.getElementById("savecode");
      ta.value = ${JSON.stringify(forgedCode)};
      document.getElementById("savecode-import").click();
      return document.getElementById("savecode-msg").textContent;
    })()`);
    evidence.steps.importMsg = msg;
    await sleep(1500);
    await waitFor(b, "!!window.__MOYU__ && !!document.getElementById('stage') && window.__MOYU__.frames>5", 20000);
    await sleep(1200);
    const trace = await b.evj(`JSON.parse(localStorage.getItem("r10_trace") || "[]")`);
    const cur = await b.evj(`(() => { const st = window.__MOYU__.state; return JSON.stringify({ lifetime: st.lifetimeEarned, prestige: st.prestige, hudRank: document.getElementById("hud-rank").textContent, savedAt: window.__MOYU__.savedAt }); })()`);
    evidence.steps.afterImport = cur;
    evidence.steps.trace = {
      samples: trace.length,
      maxLifetime: Math.max(0, ...trace.map((x) => x.lifetime || 0)),
      tail: trace.slice(-8),
    };
    evidence.steps.importOverwrittenByPagehide = (trace.some((x) => (x.lifetime || 0) >= 8e15) && cur.lifetime < 8e15) || false;
  } finally {
    b.close();
  }
}

writeFileSync("playtest/r10-ranked-evidence2.json", JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
