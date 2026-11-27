/**
 * R13 赌徒党试玩 CDP 公共库（只访问 dev server，不改 src/）
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

export const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port, width = 390, height = 844, url = "http://127.0.0.1:5173/" }) {
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--mute-audio",
      "--no-first-run",
      "--disable-extensions",
      `--user-data-dir=/tmp/chrome-r13-${port}-${Date.now()}`,
      `--remote-debugging-port=${port}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  async function waitJson(path, tries = 120) {
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}${path}`);
        if (r.ok) return await r.json();
      } catch {
        /* retry */
      }
      await sleep(100);
    }
    throw new Error("CDP not ready");
  }
  await waitJson("/json/version");
  const t = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") {
      errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 220) ?? m.params.exceptionDetails.text);
    }
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  };
  const send = (method, params = {}) => {
    const i = ++id;
    ws.send(JSON.stringify({ id: i, method, params }));
    return new Promise((resolve, reject) => pending.set(i, { resolve, reject }));
  };
  const ev = async (x) => {
    const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails).slice(0, 240) };
    return r.result.value;
  };
  const waitFor = async (expr, timeout = 6000, step = 40) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = await ev(expr);
      if (v) return v;
      await sleep(step);
    }
    return null;
  };
  const shot = async (path) => {
    const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(path, Buffer.from(s.data, "base64"));
    return path;
  };
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 3,
    mobile: true,
    screenWidth: width,
    screenHeight: height,
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Page.navigate", { url });
  // 等 __MOYU__ 就绪
  const ready = await waitFor("!!window.__MOYU__ && !!window.__MOYU__.state", 15000);
  return {
    send,
    ev,
    waitFor,
    shot,
    errors,
    ready,
    proc,
    close(exitProcess = true) {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      if (exitProcess) process.exit(0);
    },
  };
}

/** 读取卡片弹窗内容；未打开返回 null */
export const READ_CARDS = `(() => {
  const root = document.getElementById('cards');
  if (!root || root.classList.contains('hidden')) return null;
  const cards = [...document.querySelectorAll('#cards-body .card')].map(el => ({
    name: el.querySelector('.card-name')?.textContent?.trim(),
    rarity: el.querySelector('.card-rarity')?.textContent?.trim(),
    desc: el.querySelector('.card-desc')?.textContent?.trim(),
    flavor: el.querySelector('.card-flavor')?.textContent?.trim(),
  }));
  return { count: cards.length, cards };
})()`;

/** 重新载入、清空存档，模拟"每天首次打开"的抽卡 */
export async function freshDay(b, { waitMs = 2600 } = {}) {
  // 用游戏自带 reset()（清档 + 内存 state 归零），再刷新 → 保证抽新一天的卡
  await b.ev("window.__MOYU__.reset()");
  await b.send("Page.reload", { ignoreCache: false });
  await sleep(400); // 等旧上下文销毁，避免 waitFor 读到旧页面
  await b.waitFor("!!window.__MOYU__ && !!window.__MOYU__.state", 12000);
  // 首日不拦：把 boot-ms 拨到 20 秒前，让卡面板立即弹出（真实玩家要戳 8 下或等 12 秒）
  await b.ev("sessionStorage.setItem('moyu-boot-ms', String(Date.now() - 20000))");
  await sleep(800);
  return b.ev(READ_CARDS);
}

/** 真实触摸点画布中心（用于首日"戳 8 下"与"选择期间点屏幕"测试） */
export async function tapCanvas(b, n = 1, { x = 195, y = 300, gap = 90 } = {}) {
  for (let i = 0; i < n; i++) {
    await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await sleep(gap);
  }
}
