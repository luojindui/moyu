/** R10 排行榜/竞技型画像探针：真机（CDP mobile）只读核对。
 *  1) 现有可比较数据是否已在 UI 暴露、是否有任何排行榜/好友/分享入口；
 *  2) 本地改档能否直接伪造段位；
 *  3) 存档码（好友对比载体）加校验和能否防篡改；
 *  4) 合成 pointerdown 是否可绕过 80ms 节流自动点击。
 *  只读 src/，只写 playtest/。dev server: http://127.0.0.1:5173/
 */
import { openBrowser, setupMobilePage, sleep } from "./r9-cdp-lib.mjs";
import { readFileSync, writeFileSync } from "node:fs";

const URL = "http://127.0.0.1:5173/";
const PORT = 9601;
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
  throw new Error("timeout waiting: " + expr);
}

const b = await openBrowser({ port: PORT, tag: "r10-ranked" });
try {
  await setupMobilePage(b, { url: URL });
  const readyMs = await waitFor(b, "!!window.__MOYU__ && !!document.getElementById('stage') && window.__MOYU__.frames>10");
  evidence.steps.boot = { readyMs, hook: await b.ev("!!window.__MOYU__") };

  // 1) 现有 UI 的可比较信息 + 是否存在任何榜单/好友/分享入口
  const ui = await b.evj(`(() => {
    const text = document.body.innerText;
    const kw = ["排行", "榜", "好友", "分享", "最高纪录", "最佳", "竞技"];
    document.getElementById("btn-journal").click();
    return JSON.stringify({
      hudRank: document.getElementById("hud-rank").textContent,
      hudRankTitle: document.getElementById("hud-rank").title,
      keywordHits: kw.filter(k => text.includes(k)),
      stats: document.getElementById("stats-list").innerText,
      statsRank: document.getElementById("stats-rank").textContent,
      collectionTotal: document.getElementById("journal-total").textContent,
      buttons: [...document.querySelectorAll("button")].map(b => b.textContent.trim()).filter(Boolean),
    });
  })()`);
  evidence.steps.ui = ui;

  // 2) 合成 pointerdown：绕过只防"多指"的 80ms 节流做自动点击
  const clickResult = await b.ev(`(async () => {
    const st = window.__MOYU__.state;
    const before = { clicks: st.totalClicks, lifetime: st.lifetimeEarned };
    const canvas = document.getElementById("stage");
    const r = canvas.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    for (let i = 0; i < 30; i++) {
      canvas.dispatchEvent(new PointerEvent("pointerdown", { clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true }));
      await new Promise(res => setTimeout(res, 85));
    }
    await new Promise(res => setTimeout(res, 60));
    const after = window.__MOYU__.state;
    return JSON.stringify({ before, after: { clicks: after.totalClicks, lifetime: after.lifetimeEarned }, gainedClicks: after.totalClicks - before.totalClicks, syntheticCps: 1/0.085 });
  })()`);
  evidence.steps.syntheticClicks = JSON.parse(clickResult);

  // 3) 存档码（好友对比/静态榜单的自报数据载体）：生成 → 篡改 lifetime 并重算校验和 → 导入
  const code = await b.ev(`(() => {
    const ta = document.getElementById("savecode");
    document.getElementById("savecode-copy").click();
    return ta.value;
  })()`);
  evidence.steps.saveCode = {
    length: code.length,
    bodyBytes: Math.round((code.split(".")[0].length * 3) / 4),
    bodyKeys: Object.keys(JSON.parse(fromB64url(code.split(".")[0]))),
  };
  const raw = JSON.parse(fromB64url(code.split(".")[0]));
  // 3a) 只改内容、保留旧校验和 → 应被拦
  const badJson = JSON.stringify({ ...raw, lifetimeEarned: 9e15, totalEarned: 9e15, moyu: 1e12 });
  const badCode = `${b64url(badJson)}.${code.split(".")[1]}`;
  // 3b) 改内容 + 重算 FNV 校验和 → 现状会被接受（校验和不是签名）
  const forgedJson = JSON.stringify({ ...raw, lifetimeEarned: 9e15, totalEarned: 9e15, moyu: 1e12, prestige: 9999 });
  const forgedCode = encodeCode(forgedJson);
  evidence.steps.tamper = {
    badCodeRejected: false,
    forgedCodeLen: forgedCode.length,
    forgedJsonBytes: forgedJson.length,
  };

  await b.ev(`(() => {
    const ta = document.getElementById("savecode");
    ta.value = ${JSON.stringify(badCode)};
    document.getElementById("savecode-import").click();
    return document.getElementById("savecode-msg").textContent;
  })()`).then((msg) => (evidence.steps.tamper.badCodeMsg = msg));

  await b.ev(`(() => {
    const ta = document.getElementById("savecode");
    ta.value = ${JSON.stringify(forgedCode)};
    document.getElementById("savecode-import").click();
    return true;
  })()`);
  await sleep(1200);
  await waitFor(b, "!!window.__MOYU__ && !!document.getElementById('stage')", 20000);
  await sleep(600);
  const after = await b.evj(`(() => {
    const st = window.__MOYU__.state;
    return JSON.stringify({
      lifetime: st.lifetimeEarned, total: st.totalEarned, moyu: st.moyu, prestige: st.prestige,
      rankFromEngine: null,
      hudRank: document.getElementById("hud-rank").textContent,
      hudRankTitle: document.getElementById("hud-rank").title,
      statsRank: (document.getElementById("stats-rank") || {}).textContent,
    });
  })()`);
  evidence.steps.forgedImportApplied = after;
  await b.shot("playtest/r10-ranked-forged-rank.png");

  // 4) 正常存档码对比的展示成本：解码后可直接拿到的可比字段
  evidence.steps.comparableFromCode = {
    fields: ["lifetimeEarned", "totalClicks", "collected(quotes/flavors)", "prestige", "visits", "daily.streak", "surviveStreak"],
    decodeOnly: true,
    note: "decodeSaveCode + restore 即可算 computeStats，无需导入覆盖",
  };

  writeFileSync("playtest/r10-ranked-evidence.json", JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  b.close();
}
