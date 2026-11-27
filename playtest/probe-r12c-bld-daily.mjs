import { openBrowser, sleep } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";
const b = await openBrowser({ port: 9531, tag: "r12cdaily" });
const out = {};
await b.send("Page.enable"); await b.send("Runtime.enable");
await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
const save = { v: 2, moyu: 1000, totalEarned: 1000, lifetimeEarned: 1000, levels: {}, savedAt: Date.now(), createdAt: Date.now() - 86400000,
  totalClicks: 0, patrolSurvives: 0, prestige: 0, talents: { unlocked: [], points: 0, rankGranted: -1, dailyGiftDate: "" },
  collected: { quotes: [], flavors: [] }, daily: null, visits: { date: "", count: 0 }, team: { colleagues: {} } };
const r = await b.send("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem('moyu-save',${JSON.stringify(JSON.stringify(save))});}catch(e){}` });
await b.send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(2000);
out.afterLoad = JSON.parse(await b.ev("JSON.stringify({points:window.__MOYU__.state.talents.points,dailyGiftDate:window.__MOYU__.state.talents.dailyGiftDate,toast:(document.getElementById('dom-toast')||{}).textContent||'',shown:(document.getElementById('dom-toast')||{}).classList?.contains('show')})"));
await b.ev("document.getElementById('btn-team').click();document.getElementById('tab-talents').click()");
await sleep(400);
out.panel = await b.ev("document.getElementById('team').innerText.slice(0,300)");
await b.shot("/tmp/r12c2-daily.png");
out.shots = ["/tmp/r12c2-daily.png"];
writeFileSync("playtest/r12c2-bld-daily.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
b.close(); process.exit(0);
