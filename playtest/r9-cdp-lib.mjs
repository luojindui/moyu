/**
 * R9 探针共用 CDP 工具（独立于 src/，只读）。
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

export const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitJson(url, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  throw new Error("CDP not ready: " + url);
}

export async function openBrowser({ port, tag }) {
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
      `--user-data-dir=/tmp/chrome-r9-${tag}-${port}-${Date.now()}`,
      `--remote-debugging-port=${port}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  await waitJson(`http://127.0.0.1:${port}/json/version`);
  const tab = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`, {
    method: "PUT",
  }).then((r) => r.json());
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (evt) => {
    const m = JSON.parse(evt.data);
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
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error("page eval failed: " + JSON.stringify(r.exceptionDetails).slice(0, 500));
    }
    return r.result.value;
  };
  return {
    send,
    ev,
    async evj(expression) {
      const v = await ev(expression);
      return typeof v === "string" ? JSON.parse(v) : v;
    },
    async shot(path) {
      const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(path, Buffer.from(s.data, "base64"));
    },
    async touch(type, points) {
      await send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 8, radiusY: 8, force: 1 })),
      });
    },
    close() {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      proc.kill();
    },
  };
}

export async function setupMobilePage(b, { injectSource, url, width = 390, height = 844 }) {
  await b.send("Page.enable");
  await b.send("Runtime.enable");
  await b.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 3,
    mobile: true,
    screenWidth: width,
    screenHeight: height,
  });
  await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  if (injectSource) await b.send("Page.addScriptToEvaluateOnNewDocument", { source: injectSource });
  await b.send("Page.navigate", { url });
}

export async function waitForGame(b, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const ok = await b.ev("!!window.__MOYU__ && !!window.__r9 && document.getElementById('stage') ? 1 : 0");
      if (ok === 1) return Date.now() - t0;
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  throw new Error("game not ready");
}
