// 专项：K2 未来版本档备份 + D2 家具完成提示是否被成就 toast 覆盖
import { runChrome, connect } from "../lib/chrome.mjs";
import { DEV, sleep, setViewport, goto, ev, waitFor, Report, closeAllModals, openPanel, click } from "./lib.mjs";

const rep = new Report("专项 K2/D2");
await runChrome(async ({ port }) => {
  const c = await connect(port);
  await setViewport(c, { width: 1100, height: 800 });
  try {
    await goto(c, DEV, `typeof window.__MOYU__ === "object"`, 25000);
    await ev(c, `window.confirm = () => true; true`);
    await sleep(400);
    await closeAllModals(c);
    await ev(c, "window.__MOYU__.saveNow()");
    await sleep(150);

    // ===== K2：未来版本档应备份到 moyu-save.newer.bak =====
    const bak = await ev(c, `(() => {
      const raw = localStorage.getItem("moyu-save");
      if (!raw) return { ok: false, reason: "no-save" };
      const b = JSON.parse(raw);
      b.v = 999;
      localStorage.setItem("moyu-save", JSON.stringify(b));
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === "moyu-save") return; return real.call(this, k, v); };
      return { ok: true };
    })()`);
    await c.send("Page.reload", {});
    await waitFor(c, `typeof window.__MOYU__ === "object"`, 20000);
    await sleep(900);
    const newer = await ev(c, `({ bak: localStorage.getItem("moyu-save.newer.bak") !== null, v: (() => { try { return JSON.parse(localStorage.getItem("moyu-save")||"{}").v; } catch (e) { return "?"; } })() })`);
    rep.expect("X1 未来版本档备份存在", newer.bak === true, JSON.stringify(newer));

    // ===== D2：装修完成提示 vs 成就解锁提示（toast 竞争）=====
    await ev(c, "window.__MOYU__.grant(2300000000)");
    await sleep(300);
    await openPanel(c, "#btn-team", "#team");
    await click(c, "#tab-decor");
    await waitFor(c, `document.querySelector('button[data-act="decor"][data-id="plant"]') !== null`, 4000);
    // 先装观察器（记录所有 toast 文本变化 + 时间 + sr-live）
    await ev(c, `(() => {
      window.__toastSeq = [];
      const el = document.getElementById("dom-toast");
      const sr = document.getElementById("sr-live");
      new MutationObserver(() => { if ((el.textContent || "").length) window.__toastSeq.push({ t: Date.now(), kind: "toast", text: el.textContent }); })
        .observe(el, { childList: true, characterData: true, subtree: true });
      new MutationObserver(() => { if ((sr.textContent || "").length) window.__toastSeq.push({ t: Date.now(), kind: "sr", text: sr.textContent }); })
        .observe(sr, { childList: true, characterData: true, subtree: true });
      return true;
    })()`);
    const ids = ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"];
    for (const id of ids) {
      await ev(c, `(() => { const b = document.querySelector('button[data-act="decor"][data-id="${id}"]'); if (b) b.click(); return true; })()`);
      await sleep(300);
    }
    await sleep(1500);
    const seq = (await ev(c, `window.__toastSeq ?? []`)) ?? [];
    const completion = seq.filter((x) => /装修完成|全部 8 件/.test(x.text));
    const seqTail = seq.slice(-14).map((x) => `${x.kind}:${x.text.slice(0, 26)}`);
    rep.expect("X2 家具完成提示确实出现过", completion.length > 0, `完成提示 ${JSON.stringify(completion.map((x) => x.text))}；序列尾部=${JSON.stringify(seqTail)}`);
    const lastTexts = seq.slice(-6).map((x) => x.text);
    const trophyAfter = seq.some((x, i) => /装修完成/.test(x.text) && seq.slice(i + 1).some((y) => /成就解锁/.test(y.text)));
    rep.expect("X3 完成提示未被成就提示立即覆盖（可读性）", !trophyAfter, `末尾=${JSON.stringify(lastTexts)}；出现成就提示覆盖=${trophyAfter}`);
    rep.expect("X4 无 JS 异常", c.errors.length === 0, JSON.stringify(c.errors.slice(0, 3)));
  } catch (e) {
    rep.add("X:EXCEPTION", false, String(e?.message ?? e).slice(0, 250));
    console.error(e);
  } finally {
    c.close();
  }
}, { timeoutMs: 180_000 });

const summary = rep.summary();
const fs = await import("node:fs");
const OUT = process.env.AUDIT_OUT ?? "/Users/p/Desktop/workspace/code/moyu/playtest/final-audit/out";
fs.writeFileSync(`${OUT}/special-k2-d2-report.json`, JSON.stringify(summary, null, 2));
console.log(`\n===== 专项 K2/D2：${summary.pass}/${summary.total} =====`);
if (summary.failed.length) console.log("失败：", summary.failed.join(" | "));