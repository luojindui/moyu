// 线上生产包探针（https://luojindui.github.io/moyu/，全新无痕 profile）
// 覆盖：启动/资源/无作弊钩子 / 点击+首购 / 刷新持久化 / 存档码导出导入 / 离线结算（改 savedAt）/ SW 离线壳 / 移动端视口
import { runChrome, connect } from "../lib/chrome.mjs";
import { PROD, sleep, setViewport, waitFor, Report } from "./lib.mjs";

const OUT = process.env.AUDIT_OUT ?? "/Users/p/Desktop/workspace/code/moyu/playtest/final-audit/out";
const rep = new Report("P 线上生产包");

const sleepFn = sleep;
await runChrome(async ({ port }) => {
  const c = await connect(port);
  const send = c.send;
  const ev = c.ev;
  const evx = async (expr) => {
    const r = await ev(expr);
    if (r && typeof r === "object" && r.__err) throw new Error(r.__err);
    return r;
  };
  const wait = async (expr, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = await ev(expr).catch(() => false);
      if (v === true) return true;
      await sleepFn(100);
    }
    return false;
  };
  const click = async (sel) => evx(`(() => { const els = document.querySelectorAll(${JSON.stringify(sel)}); const el = els[0]; if (!el) return { ok: false }; if (el.disabled) return { ok: false, disabled: true }; el.click(); return { ok: true, text: (el.textContent || "").trim().slice(0, 60) }; })()`);
  const text = async (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? (el.textContent || "").trim() : null; })()`);
  const count = async (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    const fs = await import("node:fs");
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, "base64"));
  };
  const saveBlob = async () => ev(`(() => { try { return JSON.parse(localStorage.getItem("moyu-save") ?? "null"); } catch { return null; } })()`);
  /** 真实鼠标点 canvas */
  const tapCanvas = async (n, gap = 95) => {
    for (let i = 0; i < n; i++) {
      const p = await ev(`(() => { const el = document.getElementById("stage"); const b = el.getBoundingClientRect(); return { x: b.left + b.width * (0.35 + Math.random() * 0.3), y: b.top + b.height * (0.3 + Math.random() * 0.4) }; })()`);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
      await sleepFn(gap);
    }
  };
  /** reload 并等待生产页就绪（无 __MOYU__ 钩子，用 HUD+canvas 判定） */
  const reload = async (ms = 900) => {
    await send("Page.reload", {});
    const ok = await wait(`document.readyState === "complete" && !!document.getElementById("hud-moyu") && document.getElementById("hud-moyu").textContent !== "" && document.getElementById("stage").width > 0`, 25000);
    await sleepFn(ms);
    return ok;
  };
  const blockSave = async () => ev(`(() => { const real = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === "moyu-save") return; return real.call(this, k, v); }; return true; })()`);
  /** 若每日卡弹窗弹出则跳过，避免它吞掉后续画布点击（首日 12s 后会主动弹） */
  const ensureNoCards = async () => {
    for (let i = 0; i < 20; i++) {
      const vis = await ev(`document.getElementById("cards") && !document.getElementById("cards").classList.contains("hidden")`);
      if (!vis) return true;
      await click("#cards-skip");
      await sleepFn(200);
    }
    return false;
  };

  try {
    // 早期错误捕获（先于页面脚本注入）
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.__auditErrs = [];
        addEventListener("error", (e) => window.__auditErrs.push(String(e.message || e.error)));
        addEventListener("unhandledrejection", (e) => window.__auditErrs.push("unhandledrejection:" + String(e.reason)));
        (function(){ const o = console.error; console.error = function(...a){ window.__auditErrs.push("console.error:" + a.map(String).join(" ")); return o.apply(this, a); }; })();`,
    });
    await setViewport(c, { width: 1100, height: 800 });
    await send("Page.navigate", { url: PROD });
    const ready = await wait(`document.readyState === "complete" && !!document.getElementById("hud-moyu") && document.getElementById("stage").width > 0`, 30000);
    await sleepFn(1000);

    // ---- P1 启动 / 资源 / 无作弊钩子 ----
    rep.expect("P1 线上页可启动", ready === true);
    rep.expect("P2 标题正确", (await ev("document.title")) === "摸鱼工位", await ev("document.title"));
    rep.expect("P3 无作弊钩子 __MOYU__", (await ev("typeof window.__MOYU__")) === "undefined", await ev("typeof window.__MOYU__"));
    rep.expect("P4 无 boot 错误横幅", (await count(".boot-error")) === 0);
    const errs = await ev("window.__auditErrs ?? []");
    rep.expect("P5 无未捕获 JS 错误", (errs ?? []).length === 0, JSON.stringify(errs?.slice(0, 3)));
    const res = await ev(`(() => { const r = performance.getEntriesByType("resource"); const bad = r.filter((x) => x.transferSize === 0 && x.duration === 0 && !/^data:/.test(x.name)).map((x) => x.name.split("/").pop()); return { n: r.length, bad: bad.slice(0, 5) }; })()`);
    rep.expect("P6 资源全部成功加载", res.bad.length === 0, JSON.stringify(res));
    rep.expect("P7 无版本更新条", (await count("#update-bar")) === 0);
    const canvas = await ev(`(() => { const b = document.getElementById("stage").getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; })()`);
    rep.expect("P8 canvas 尺寸有效", canvas.w > 300 && canvas.h > 150, JSON.stringify(canvas));
    const h0 = await ev(`({ moyu: document.getElementById("hud-moyu").textContent, idle: document.getElementById("hud-idle").textContent, rank: document.getElementById("hud-rank").textContent })`);
    rep.expect("P9 首屏 HUD 正常", parseFloat(h0.moyu) <= 2 && h0.idle === "0.2", JSON.stringify(h0));
    // 关于面板版本号
    await click("#btn-journal");
    await wait(`document.getElementById("journal").classList.contains("hidden") === false`, 4000);
    const ver = await text("#about-version");
    rep.expect("P10 关于面板版本为 v0.6.x", /v0\.6\.\d/.test(ver ?? ""), ver ?? "null");
    rep.expect("P11 存档码框存在", (await count("#savecode")) === 1);
    rep.expect("P12 导出 JSON 按钮存在", (await count("#stats-export")) === 1);
    await click("#journal-close");
    await sleepFn(300);
    await shot("P-first-load");

    // 首日卡弹窗不应过早拦截（设计：8 击 or 12s 后）
    rep.expect("P13 首屏 3 秒内无强制弹窗", (await ev(`document.getElementById("cards").classList.contains("hidden")`)) === true, "cards should be hidden early");

    // ---- P2 点击 + 首购 ----
    await ensureNoCards();
    await tapCanvas(25, 95);
    await sleepFn(400);
    await ensureNoCards();
    let blob = await saveBlob();
    // 存档是懒写：靠 reload 的 pagehide 落盘 → reload 后再读
    await reload();
    await ensureNoCards();
    blob = await saveBlob();
    rep.expect("P14 点击入账并落盘", !!blob && blob.totalClicks >= 20, JSON.stringify({ clicks: blob?.totalClicks, moyu: blob?.moyu }));
    const buy = await click('button[data-upgrade="coffee"]');
    await sleepFn(400);
    rep.expect("P15 首次购买成功", buy.ok === true && (await ev(`document.querySelector('button[data-upgrade="coffee"] .shop-level').textContent`)) === "Lv.1", JSON.stringify(buy));
    await reload();
    blob = await saveBlob();
    rep.expect("P16 刷新后进度保留（等级/点击）", !!blob && blob.levels?.coffee === 1 && blob.totalClicks >= 20, JSON.stringify({ levels: blob?.levels, clicks: blob?.totalClicks }));
    const hudAfter = await ev(`document.getElementById("hud-click").textContent`);
    rep.expect("P17 刷新后点击力保留（Lv.1 咖啡 = 2）", hudAfter === "2", hudAfter);

    // ---- P3 存档码导出 / 非法导入 / 有效导入 ----
    await click("#btn-journal");
    await wait(`document.getElementById("journal").classList.contains("hidden") === false`, 4000);
    await click("#savecode-copy");
    await sleepFn(400);
    const code = await ev(`document.getElementById("savecode").value.trim()`);
    rep.expect("P18 存档码导出非空含校验", typeof code === "string" && /^[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(code), `len=${code?.length} tail=${String(code).slice(-10)}`);
    const clicksAtExport = (await saveBlob())?.totalClicks ?? 0;
    // 再点 15 下改变进度
    await click("#journal-close");
    await sleepFn(250);
    await tapCanvas(15, 95);
    await sleepFn(300);
    // 非法导入
    await click("#btn-journal");
    await wait(`document.getElementById("journal").classList.contains("hidden") === false`, 4000);
    await ev(`(() => { document.getElementById("savecode").value = "garbage"; return true; })()`);
    await click("#savecode-import");
    await sleepFn(400);
    const badMsg = await text("#savecode-msg");
    rep.expect("P19 非法存档码被拒", /导入失败/.test(badMsg ?? ""), badMsg ?? "null");
    // 有效导入（旧码）→ 重载
    await ev(`(() => { document.getElementById("savecode").value = ${JSON.stringify(code)}; window.__auditMark = 1; return true; })()`);
    await click("#savecode-import");
    const navigated = await wait(`typeof window.__auditMark === "undefined" && document.readyState === "complete" && !!document.getElementById("hud-moyu") && document.getElementById("hud-moyu").textContent !== "" `, 20000);
    await sleepFn(800);
    rep.expect("P20 有效导入触发重载", navigated === true);
    const afterImport = await saveBlob();
    rep.expect("P21 导入恢复旧进度", !!afterImport && afterImport.levels?.coffee === 1 && Math.abs((afterImport.totalClicks ?? 0) - clicksAtExport) <= 2, JSON.stringify({ before: clicksAtExport, after: afterImport?.totalClicks, levels: afterImport?.levels }));
    rep.expect("P22 导入备份旧档", (await ev(`localStorage.getItem("moyu-save.bak") !== null`)) === true);
    rep.expect("P23 导入后无 JS 错误", ((await ev("window.__auditErrs ?? []")) ?? []).length === 0, JSON.stringify((await ev("window.__auditErrs ?? []")).slice(0, 3)));

    // ---- P4 离线结算（改 savedAt 回拨 2 小时，拦截 pagehide 覆盖） ----
    const beforeOffline = await saveBlob();
    await ev(`(() => {
      const b = JSON.parse(localStorage.getItem("moyu-save"));
      b.savedAt = Date.now() - 7200 * 1000;
      localStorage.setItem("moyu-save", JSON.stringify(b));
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === "moyu-save") return; return real.call(this, k, v); };
      return true;
    })()`);
    await reload(600);
    const welcomeShown = await wait(`document.getElementById("welcome").classList.contains("hidden") === false`, 6000);
    rep.expect("P24 离线 2h 弹出欢迎面板", welcomeShown === true);
    const gainText = await text("#welcome-gain");
    const rule = await text("#welcome-rule");
    const hudMoyuAfter = await ev(`document.getElementById("hud-moyu").textContent`);
    rep.expect("P25 离线收益 > 0", parseFloat((gainText ?? "0").replace(/,/g, "")) > 0 || /万|亿/.test(gainText ?? ""), `面板=${gainText}`);
    rep.expect("P26 离线规则文案", /首日全额|离线效率/.test(rule ?? ""), rule ?? "null");
    rep.expect("P27 离线收益进内存状态（HUD）", parseFloat(hudMoyuAfter.match(/[\d.]+/)?.[0] ?? "0") > 20, `HUD=${hudMoyuAfter} 面板收益=${gainText}`);
    if (welcomeShown) await click("#welcome-ok");
    await sleepFn(300);
    await shot("P-offline-welcome");

    // ---- P5 Service Worker 离线壳 ----
    const swReady = await wait(`navigator.serviceWorker && navigator.serviceWorker.ready.then((r) => !!r.active)`, 20000).catch(() => false);
    // ready 返回 Promise，需要异步判定
    const swActive = await ev(`(async () => { if (!("serviceWorker" in navigator)) return "unsupported"; const reg = await navigator.serviceWorker.getRegistration(); return reg ? (reg.active ? "active" : "installing") : "none"; })()`);
    rep.expect("P28 Service Worker 已注册", swActive === "active", String(swActive));
    await reload(800);
    const controlled = await ev(`!!navigator.serviceWorker.controller`);
    rep.expect("P29 刷新后页面受 SW 控制", controlled === true, String(controlled));
    if (controlled) {
      await send("Network.enable");
      await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
      const offlineBoot = await reload(1000);
      const offErrs = await ev("window.__auditErrs ?? []");
      rep.expect("P30 断网刷新仍可启动（离线壳）", offlineBoot === true, `ready=${offlineBoot}`);
      rep.expect("P31 断网启动无 JS 错误", (offErrs ?? []).length === 0, JSON.stringify((offErrs ?? []).slice(0, 3)));
      const offTitle = await ev("document.title");
      rep.expect("P32 断网后页面标题正确", offTitle === "摸鱼工位", offTitle);
      await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await reload(600);
    }

    // 移动端检查见 probe-prod-mobile.mjs（独立进程，避免长流程后 CDP 目标不稳定）
  } catch (e) {
    rep.add("P:EXCEPTION", false, String(e?.message ?? e).slice(0, 300));
    console.error(e);
  } finally {
    c.close();
  }
}, { timeoutMs: 300_000 });

const summary = rep.summary();
const fs = await import("node:fs");
fs.writeFileSync(`${OUT}/prod-report.json`, JSON.stringify(summary, null, 2));
console.log(`\n===== 线上生产包：${summary.pass}/${summary.total} 通过 =====`);
if (summary.failed.length) console.log("失败：", summary.failed.join(" | "));
console.log("报告：", `${OUT}/prod-report.json`);