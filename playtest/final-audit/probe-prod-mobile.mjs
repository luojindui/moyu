// 线上生产包 · 移动端视口探针（390×844 DPR3 + 横屏 844×390）
import { runChrome, connect } from "../lib/chrome.mjs";
import { PROD, sleep, setViewport, Report } from "./lib.mjs";

const OUT = process.env.AUDIT_OUT ?? "/Users/p/Desktop/workspace/code/moyu/playtest/final-audit/out";
const rep = new Report("M 线上移动端");

await runChrome(async ({ port }) => {
  const c = await connect(port);
  const send = c.send;
  const ev = async (expr) => {
    const r = await c.ev(expr);
    if (r && typeof r === "object" && r.__err) throw new Error(r.__err);
    return r;
  };
  const wait = async (expr, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = await c.ev(expr).catch(() => false);
      if (v === true) return true;
      await sleep(100);
    }
    return false;
  };
  const click = async (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return { ok: false }; if (el.disabled) return { ok: false, disabled: true }; el.click(); return { ok: true, text: (el.textContent || "").trim().slice(0, 50) }; })()`);
  const text = async (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? (el.textContent || "").trim() : null; })()`);
  const count = async (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    const fs = await import("node:fs");
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, "base64"));
  };
  const reload = async (ms = 900) => {
    await send("Page.reload", {});
    const ok = await wait(`document.readyState === "complete" && !!document.getElementById("hud-moyu") && document.getElementById("stage").width > 0`, 25000);
    await sleep(ms);
    return ok;
  };
  const tapAt = async (x, y) => {
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await sleep(40);
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(120);
  };

  try {
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.__auditErrs = [];
        addEventListener("error", (e) => window.__auditErrs.push(String(e.message || e.error)));
        addEventListener("unhandledrejection", (e) => window.__auditErrs.push("unhandledrejection:" + String(e.reason)));`,
    });
    await setViewport(c, { width: 390, height: 844, mobile: true, dpr: 3 });
    await send("Page.navigate", { url: PROD });
    const ready = await wait(`document.readyState === "complete" && !!document.getElementById("hud-moyu") && document.getElementById("stage").width > 0`, 30000);
    await sleep(1200);

    // ---- 首屏适配 ----
    rep.expect("M1 移动端可启动", ready === true);
    const layout = await ev(`(() => {
      const de = document.documentElement;
      const btns = ["btn-arcade","btn-team","btn-mute","btn-journal"].map((id) => { const b = document.getElementById(id).getBoundingClientRect(); return { id, w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.left) }; });
      const shop = document.getElementById("shop").getBoundingClientRect();
      const stage = document.getElementById("stage").getBoundingClientRect();
      const hud = document.getElementById("hud").getBoundingClientRect();
      return { scrollW: de.scrollWidth, innerW: innerWidth, innerH: innerHeight, dpr: devicePixelRatio, btns, shop: { h: Math.round(shop.height), top: Math.round(shop.top) }, stage: { w: Math.round(stage.width), h: Math.round(stage.height), top: Math.round(stage.top), bottom: Math.round(stage.bottom) }, hudH: Math.round(hud.height) };
    })()`);
    rep.expect("M2 无横向溢出", layout.scrollW <= layout.innerW + 1, JSON.stringify({ scrollW: layout.scrollW, innerW: layout.innerW }));
    rep.expect("M3 HUD 触控热区 ≥40px", layout.btns.every((b) => b.w >= 40 && b.h >= 40), JSON.stringify(layout.btns));
    rep.expect("M4 按钮不越界", layout.btns.every((b) => b.x >= 0 && b.x + b.w <= layout.innerW + 1), JSON.stringify(layout.btns.map((b) => b.x + b.w)));
    rep.expect("M5 画布与商店同屏", layout.stage.h > 300 && layout.shop.h > 100 && layout.stage.bottom <= layout.shop.top + 2, JSON.stringify({ stage: layout.stage, shop: layout.shop }));
    rep.expect("M6 商店可横向滑动", await ev(`(() => { const s = document.getElementById("shop-cards"); return s.scrollWidth > s.clientWidth + 40; })()`) === true);
    rep.expect("M7 DPR 生效（≥2）", layout.dpr >= 2, String(layout.dpr));
    await shot("M-home");

    // ---- 触摸点击画布 ----
    const stageBox = await ev(`(() => { const b = document.getElementById("stage").getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
    const moyuBefore = parseFloat((await text("#hud-moyu")) ?? "0");
    for (let i = 0; i < 6; i++) await tapAt(stageBox.x, stageBox.y - 40 + (i % 3) * 30);
    await sleep(500);
    const moyuAfter = parseFloat((await text("#hud-moyu")) ?? "0");
    rep.expect("M8 触摸点击入账", moyuAfter > moyuBefore + 3, `${moyuBefore}→${moyuAfter}`);
    await shot("M-clicks");

    // ---- 面板：小队 ----
    await click("#btn-team");
    const teamOpen = await wait(`document.getElementById("team").classList.contains("hidden") === false`, 4000);
    rep.expect("M9 移动端小队面板可打开", teamOpen === true);
    const teamBox = await ev(`(() => { const b = document.querySelector(".team-panel").getBoundingClientRect(); const body = document.getElementById("team-body").getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), left: Math.round(b.left), top: Math.round(b.top), innerW: innerWidth, innerH: innerHeight, bodyH: Math.round(body.height) }; })()`);
    rep.expect("M10 小队面板完整在视口内", teamBox.left >= 0 && teamBox.top >= -1 && teamBox.w <= teamBox.innerW + 1 && teamBox.top + teamBox.h <= teamBox.innerH + 1, JSON.stringify(teamBox));
    // 切天赋/工位页
    await click("#tab-talents");
    await sleep(300);
    const tabTalentText = await text("#team-body");
    rep.expect("M11 天赋页可切换", /点击流|天赋点|还没有天赋点/.test(tabTalentText ?? ""), (tabTalentText ?? "").slice(0, 40));
    await shot("M-team");
    // 点遮罩关闭
    await ev(`(() => { const root = document.getElementById("team"); root.dispatchEvent(new MouseEvent("click", { bubbles: true })); return true; })()`);
    await sleep(300);
    rep.expect("M12 点遮罩可关闭小队面板", (await ev(`document.getElementById("team").classList.contains("hidden")`)) === true);

    // ---- 面板：日报（存档码/图鉴布局） ----
    await click("#btn-journal");
    const journalOpen = await wait(`document.getElementById("journal").classList.contains("hidden") === false`, 4000);
    rep.expect("M13 日报面板可打开", journalOpen === true);
    const journalBox = await ev(`(() => { const p = document.querySelector(".journal-panel").getBoundingClientRect(); const g = document.getElementById("journal-grid").getBoundingClientRect(); return { w: Math.round(p.width), h: Math.round(p.height), left: Math.round(p.left), innerW: innerWidth, innerH: innerHeight, gridW: Math.round(g.width), gridOverflowX: g.scrollWidth > g.clientWidth + 2 }; })()`);
    rep.expect("M14 日报面板不溢出", journalBox.left >= 0 && journalBox.w <= journalBox.innerW + 1, JSON.stringify(journalBox));
    rep.expect("M15 图鉴网格不横向溢出", journalBox.gridOverflowX === false, JSON.stringify({ gridW: journalBox.gridW }));
    await shot("M-journal");
    await click("#journal-close");
    await sleep(250);

    // ---- 摸鱼站：触摸玩一局 + 早退确认（用页面内 confirm 覆盖） ----
    await ev(`window.confirm = () => true; true`);
    await click("#btn-arcade");
    const arcadeOpen = await wait(`document.getElementById("arcade").classList.contains("hidden") === false`, 4000);
    rep.expect("M16 摸鱼站可打开", arcadeOpen === true);
    const arcadeCards = await count('#arcade button[data-game]');
    rep.expect("M17 三个小游戏入口", arcadeCards === 3, String(arcadeCards));
    await shot("M-arcade");
    await click('button[data-game="rhythm"]');
    const started = await wait(`document.getElementById("play-area") !== null`, 4000);
    rep.expect("M18 移动端可开始小游戏", started === true);
    const playBox = await ev(`(() => { const b = document.getElementById("play-area").getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), w: Math.round(b.width), h: Math.round(b.height) }; })()`);
    for (let i = 0; i < 4; i++) await tapAt(playBox.x, playBox.y);
    await sleep(1500);
    await click("#arcade-close");
    await sleep(1000);
    const arcadeClosed = await ev(`document.getElementById("arcade").classList.contains("hidden")`);
    rep.expect("M19 小游戏可退出并结算", arcadeClosed === true);

    // ---- 每日卡（首日 8 击后弹；用触摸选卡） ----
    const cardsPop = await wait(`document.getElementById("cards").classList.contains("hidden") === false`, 12000);
    rep.expect("M20 每日卡弹窗出现", cardsPop === true);
    if (cardsPop) {
      const cardBox = await ev(`(() => { const p = document.querySelector(".cards-panel").getBoundingClientRect(); return { w: Math.round(p.width), h: Math.round(p.height), left: Math.round(p.left), top: Math.round(p.top), innerW: innerWidth, innerH: innerHeight, n: document.querySelectorAll("#cards .card").length }; })()`);
      rep.expect("M21 桌面/移动卡片布局不溢出", cardBox.left >= 0 && cardBox.w <= cardBox.innerW + 1 && cardBox.top + cardBox.h <= cardBox.innerH + 1, JSON.stringify(cardBox));
      rep.expect("M22 三张备选卡", cardBox.n === 3, String(cardBox.n));
      await sleep(1300);
      const cardPos = await ev(`(() => { const el = document.querySelector("#cards .card"); const b = el.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), id: el.dataset.id }; })()`);
      await tapAt(cardPos.x, cardPos.y);
      await sleep(500);
      const chosen = await ev(`document.getElementById("hud-card").classList.contains("hidden")`);
      rep.expect("M23 触摸选卡生效（HUD 显示）", chosen === false, `cards hidden=${await ev(`document.getElementById("cards").classList.contains("hidden")`)}`);
      await shot("M-card");
    }

    // ---- 横屏 ----
    await setViewport(c, { width: 844, height: 390, mobile: true, dpr: 3 });
    await reload(1200);
    const land = await ev(`(() => ({
      scrollW: document.documentElement.scrollWidth, innerW: innerWidth, innerH: innerHeight,
      stageH: Math.round(document.getElementById("stage").getBoundingClientRect().height),
      shopH: Math.round(document.getElementById("shop").getBoundingClientRect().height),
      rotateHint: getComputedStyle(document.getElementById("rotate-hint")).display,
      hudVisible: document.getElementById("hud").getBoundingClientRect().height > 0,
    }))()`);
    rep.expect("M24 横屏无横向溢出", land.scrollW <= land.innerW + 1, JSON.stringify(land));
    rep.expect("M25 横屏画布仍可用（>100px）", land.stageH > 100, String(land.stageH));
    rep.expect("M26 横屏显示竖屏建议", land.rotateHint !== "none", String(land.rotateHint));
    await shot("M-landscape");
    const errs = await ev("window.__auditErrs ?? []");
    rep.expect("M27 全流程无 JS 错误", (errs ?? []).length === 0, JSON.stringify((errs ?? []).slice(0, 4)));
    rep.expect("M28 无 CDP 异常", (c.errors ?? []).length === 0, JSON.stringify((c.errors ?? []).slice(0, 3)));
  } catch (e) {
    rep.add("M:EXCEPTION", false, String(e?.message ?? e).slice(0, 300));
    console.error(e);
  } finally {
    c.close();
  }
}, { timeoutMs: 300_000 });

const summary = rep.summary();
const fs = await import("node:fs");
fs.writeFileSync(`${OUT}/mobile-report.json`, JSON.stringify(summary, null, 2));
console.log(`\n===== 移动端：${summary.pass}/${summary.total} 通过 =====`);
if (summary.failed.length) console.log("失败：", summary.failed.join(" | "));
console.log("报告：", `${OUT}/mobile-report.json`);