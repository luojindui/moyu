import { runChrome, connect, sleep } from "../lib/chrome.mjs";
import { INSTRUMENT } from "./instrument.mjs";
import { writeFileSync } from "node:fs";

const URL = "http://127.0.0.1:5173/";
const out = { tamper: {}, offline: {}, rapidTabs: {}, errors: [] };
const J = (o) => JSON.stringify(o, null, 1);

await runChrome(async ({ port }) => {
  const c = await connect(port);
  const send = c.send; const rawEv = c.ev;
  const ev = (e) => Promise.race([rawEv(e), new Promise((r) => setTimeout(() => r({ __timeout: true }), 12000))]);
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
  const waitReady = async () => { for (let i = 0; i < 500; i++) { if (await ev("!!window.__MOYU__")) return true; await sleep(25); } return false; };
  await send("Page.navigate", { url: URL }); await waitReady(); await sleep(600);

  // 注入存档 + 阻止旧页面 pagehide/定时器把内存状态写回（否则篡改档会被覆盖）
  const injectAndReload = async (blobOrNull) => {
    await ev(`(() => {
      const orig = Storage.prototype.setItem;
      if (!window.__guardInstalled) {
        window.__guardInstalled = true;
        Storage.prototype.setItem = function (k, v) {
          if (k === 'moyu-save' && window.__blockAppSave) return;
          return orig.call(this, k, v);
        };
      }
      window.__blockAppSave = false;
      ${blobOrNull === null ? "localStorage.removeItem('moyu-save');" : `localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(blobOrNull))});`}
      window.__blockAppSave = true;
      return localStorage.getItem('moyu-save')?.length ?? -1;
    })()`);
    await send("Page.reload", { ignoreCache: true });
    await waitReady();
    await sleep(2400);
  };
  const inspect = () => ev(`(() => {
    const M = window.__MOYU__;
    if (!M) return { noMoyu: true, bootErr: !!document.querySelector('.boot-error'), body: document.body.innerText.slice(0,150) };
    let st = null, stateErr = null;
    try { st = M.state; } catch (e) { stateErr = String(e).slice(0,150); }
    const hud = document.getElementById('hud')?.innerText ?? '';
    const numBad = [];
    if (st) for (const [k, v] of Object.entries(st)) if (typeof v === 'number' && !Number.isFinite(v)) numBad.push(k + '=' + v);
    const canvas = document.getElementById('stage'); const ctx = canvas?.getContext('2d');
    let colored = false; try { colored = ctx.getImageData(10, 10, 1, 1).data[3] > 0; } catch {}
    return {
      stateErr, hudBad: /NaN|Infinity/i.test(hud), hudExpo: /e\+\\d/.test(hud), hud: hud.slice(0, 160).replace(/\\n/g, ' | '),
      numBad, moyu: st?.moyu, prestige: st?.prestige, levels: st ? Object.keys(st.levels).length : -1,
      decor: st?.decor?.length, talents: st?.talents?.unlocked?.length,
      frames: M.frames, firstDraw: window.__perf?.firstDrawAt, bootErr: !!document.querySelector('.boot-error'),
      canvasColored: colored, welcomeOpen: !document.getElementById('welcome').classList.contains('hidden'),
      dailyDate: st?.daily?.date ?? null, energyLeft: st?.energy?.left, arcadePlayed: st?.arcade?.played,
      saveLen: (() => { try { return localStorage.getItem('moyu-save')?.length ?? -1; } catch { return -2; } })(),
    };
  })()`);

  const today = new Date().toLocaleDateString("sv-SE");
  const yesterday = new Date(Date.now() - 86400e3).toLocaleDateString("sv-SE");
  const cases = {
    huge_numbers: { v: 2, moyu: 1e308, totalEarned: 1e308, lifetimeEarned: 1e308, savedAt: Date.now(), levels: {} },
    huge_prestige: { v: 2, moyu: 100, totalEarned: 100, lifetimeEarned: 100, savedAt: Date.now(), levels: {}, prestige: 1e308 },
    max_levels_all: { v: 2, moyu: 1e9, totalEarned: 1e9, lifetimeEarned: 1e9, savedAt: Date.now(), levels: { coffee: 1000, water: 1000, chair: 1000, phone: 1000, toilet: 1000, group: 1000, meeting: 1000, deep: 1000, retire: 1000 } },
    max_levels_prestige20: { v: 2, moyu: 1e12, totalEarned: 1e12, lifetimeEarned: 1e12, savedAt: Date.now(), levels: { coffee: 300, water: 300, chair: 300, phone: 300, toilet: 300, group: 300, meeting: 300, deep: 300, retire: 300 }, prestige: 20 },
    garbage_nested: { v: 2, moyu: 10, totalEarned: 10, lifetimeEarned: 10, savedAt: Date.now(), levels: { coffee: "x", water: 1.5, chair: 1e300 }, team: { colleagues: { zhou: { level: 1e99, missionId: { a: 1 }, startedAt: "x", endsAt: 1e300, favor: -50, autoRepeat: "yes", rewardSnapshot: 1e308 } } }, talents: { unlocked: ["click_1", "click_5b", "click_5b", "nonexistent"], points: 1e10, rankGranted: 1e10, overflow: -5 }, cards: { offers: [1, "x", "coffee"], chosen: "nonexistent", until: 1e300 }, decor: ["rug", "rug", "nope", 5], energy: { date: "x", left: 1e10, used: ["slack", "slack", "hack"] }, arcade: { date: "x", played: 1e9, best: { coffee: 1e300, nope: 5 } }, daily: { date: "x", goals: "nope", streak: 1e99 }, collected: { quotes: [1, 1, 999999], flavors: ["a"] }, visits: { date: 5, count: 1e99 } },
    proto_keys: { v: 2, moyu: 10, totalEarned: 10, lifetimeEarned: 10, savedAt: Date.now(), levels: JSON.parse('{"__proto__":5,"constructor":7,"toString":9,"coffee":3}') },
    offline_2days: { v: 2, moyu: 500, totalEarned: 500, lifetimeEarned: 500, savedAt: Date.now() - 2 * 86400e3, createdAt: Date.now() - 10 * 86400e3, levels: { coffee: 20, phone: 10 }, daily: null, energy: { date: yesterday, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } }, arcade: { date: yesterday, played: 3, best: { coffee: 100 } }, visits: { date: yesterday, count: 1 } },
    offline_month_clockrollback: { v: 2, moyu: 500, totalEarned: 500, lifetimeEarned: 500, savedAt: Date.now() + 86400e3, createdAt: Date.now() + 86400e3, levels: { coffee: 20 } },
    offline_huge_neg_savedAt: { v: 2, moyu: 500, totalEarned: 500, lifetimeEarned: 500, savedAt: -1e308, createdAt: 1e308, levels: { coffee: 20 } },
  };
  for (const [name, blob] of Object.entries(cases)) {
    await injectAndReload(blob);
    const r = await inspect();
    const errs = c.errors.slice(-3); if (errs.length) c.errors.length = 0;
    out.tamper[name] = { ...r, newErrors: errs };
  }
  writeFileSync("playtest/perf-review/out-e-tamper-offline.json", J(out));
  console.log(J(out));
  c.close();
}, { timeoutMs: 240_000 });
