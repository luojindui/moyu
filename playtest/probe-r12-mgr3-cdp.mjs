/**
 * R12 补充探针 3：派遣跨刷新持久化 + 等待期主界面提示（排除隐藏面板）+ 领奖后面板数据延迟
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.MGR3_CDP_PORT || 9363);
const URL = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const userDir = `/tmp/chrome-cdp-r12mgr3-${Date.now()}`;
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=${userDir}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* ignore */ } process.exit(2); }, 90_000).unref?.();
async function waitJson(path, tries = 160) { for (let i = 0; i < tries; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}${path}`); if (r.ok) return await r.json(); } catch { /* retry */ } await sleep(100); } throw new Error("CDP not ready"); }
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } }; }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async evaluate(expression) { const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 700)); return r.result.value; }
}
const out = {};
async function main() {
  await waitJson("/json/version");
  const t = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const cdp = new CDP(ws);
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
  await cdp.send("Page.navigate", { url: URL });
  const ev = (s) => cdp.evaluate(s);
  const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
  for (let i = 0; i < 150; i++) { await sleep(100); try { if (await ev(`!!(window.__MOYU__ && window.__MOYU__.frames > 30)`)) break; } catch { /* nav */ } }
  await sleep(500);
  await ev(`window.__MOYU__.grant(1e11)`); await sleep(200);
  for (let r = 0; r < 10; r++) { await ev(`(() => { for (const c of document.querySelectorAll('.shop-card')) c.click(); return true; })()`); await sleep(60); }
  await click("#btn-team"); await sleep(400);
  await click('[data-act="recruit"][data-id="zhou"]'); await sleep(700);
  // 派 8h
  await click('[data-act="dispatch"][data-id="zhou"][data-mission="coffee"]'); await sleep(500);
  out.dispatched = await ev(`(() => { const v = window.__MOYU__.state.team.colleagues.zhou; return { mission: v.missionId, endsAt: v.endsAt, now: Date.now(), remainMin: Math.round((v.endsAt-Date.now())/60000) }; })()`);
  // 主界面提示（排除在 #team / #journal 内的节点 + 排除隐藏节点）
  await click("#team-close"); await sleep(800);
  out.mainHint = await ev(`(() => {
    const visible = (el) => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') return false; if (el.closest('#team,#journal')) return false; return true; };
    const leaf = [...document.querySelectorAll('body *')].filter(el => el.children.length === 0 && visible(el));
    return { hits: leaf.map(el => (el.textContent||'').trim()).filter(t => /派遣|进行中|任务|外出|可领取/.test(t)),
      badge: document.querySelector('#btn-team .badge')?.textContent ?? null,
      hudIdle: document.querySelector('#hud-idle')?.textContent };
  })()`);
  // 存档后刷新页面：派遣状态是否保留
  await ev(`window.__MOYU__.saveNow()`); await sleep(400);
  await cdp.send("Page.reload", { ignoreCache: false });
  await sleep(2600);
  for (let i = 0; i < 100; i++) { await sleep(100); try { if (await ev(`!!(window.__MOYU__ && window.__MOYU__.frames > 20)`)) break; } catch { /* nav */ } }
  await sleep(600);
  out.afterReload = await ev(`(() => { const v = window.__MOYU__.state.team.colleagues.zhou; return { mission: v.missionId, endsAt: v.endsAt, favor: v.favor, now: Date.now(), remainMin: v.missionId ? Math.round((v.endsAt-Date.now())/60000) : null }; })()`);
  await click("#btn-team"); await sleep(700);
  out.afterReloadPanel = await ev(`document.querySelector('.mate')?.innerText.replace(/\\n+/g,' | ')`);
  writeFileSync("/tmp/probe-r12-mgr3.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
}
try { await main(); } catch (e) { out.error = String(e && e.stack ? e.stack : e).slice(0, 2000); writeFileSync("/tmp/probe-r12-mgr3.json", JSON.stringify(out, null, 2)); console.error("FAIL", out.error); }
try { proc.kill("SIGKILL"); } catch { /* ignore */ }
process.exit(0);
