/** R12 构筑党 live 探针 2：0 点天赋页（新手视角）+ 段位发点 toast 的可感知性。 */
import { openBrowser, sleep } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";

const URL_ = "http://127.0.0.1:5173/";
const b = await openBrowser({ port: 9519, tag: "r12bld2" });
const out = {};
await b.send("Page.enable");
await b.send("Runtime.enable");
await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

const save = {
  v: 2,
  moyu: 20000,
  totalEarned: 99000,
  lifetimeEarned: 99000,
  levels: { coffee: 5, phone: 10 },
  savedAt: Date.now(),
  createdAt: Date.now() - 3600_000,
  totalClicks: 120,
  prestige: 0,
  talents: { unlocked: [], points: 0, rankGranted: -1 },
  collected: { quotes: [], flavors: [] },
  daily: null,
  visits: { date: "", count: 0 },
  team: { colleagues: {} },
};
const r = await b.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `try{localStorage.setItem('moyu-save',${JSON.stringify(JSON.stringify(save))});}catch(e){}`,
});
out.scriptId = r.identifier;
await b.send("Page.navigate", { url: URL_ });
await sleep(2500);

// A) 0 点天赋页：新手第一次打开看到什么
await b.ev("document.getElementById('btn-team').click();document.getElementById('tab-talents').click()");
await sleep(400);
out.zeroPanel = JSON.parse(
  await b.ev(
    "JSON.stringify({points:document.getElementById('team-points').textContent,text:document.getElementById('team').innerText.slice(0,400),badge:!!document.querySelector('#btn-team .badge'),disabledBtns:[...document.querySelectorAll('#team-body button[data-act=talent]')].filter(x=>x.disabled).length,buttons:[...document.querySelectorAll('#team-body button[data-act=talent]')].length})",
  ),
);
await b.shot("/tmp/r12-bld-talents-0.png");
await b.ev("document.getElementById('team-close').click()");
await sleep(200);

// B) 跨过 100k（第 3 档）瞬间：点数 +1 的 toast
await b.ev("window.__MOYU__.grant(3000)");
await sleep(250);
await b.shot("/tmp/r12-bld-rank-toast.png");
out.afterCross = JSON.parse(
  await b.ev("JSON.stringify({talents:window.__MOYU__.state.talents,badge:!!document.querySelector('#btn-team .badge'),hud:document.getElementById('hud').innerText})"),
);
// 等 toast 消失后再看有没有任何残留提示
await sleep(2500);
out.afterToastGone = JSON.parse(
  await b.ev("JSON.stringify({badge:!!document.querySelector('#btn-team .badge'),hud:document.getElementById('hud').innerText,sr:document.getElementById('sr-live')?.textContent})"),
);
await b.shot("/tmp/r12-bld-rank-toast-gone.png");

writeFileSync("playtest/r12-bld-live2.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
b.close();
process.exit(0);
