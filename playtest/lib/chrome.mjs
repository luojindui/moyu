// 统一的 headless Chrome 封装：无论成功/超时/异常都保证杀掉进程，避免留下孤儿进程。
// 用法： await runChrome(async ({ port }) => { const c = await connect(port); ... });
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let seq = 0;

export async function runChrome(fn, { timeoutMs = 60_000, port } = {}) {
  const dbgPort = port ?? 9900 + (seq++ % 90);
  const userDir = `/tmp/chrome-probe-${Date.now()}-${dbgPort}`;
  const proc = spawn(
    CHROME,
    [
      "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio",
      "--no-first-run", "--disable-extensions",
      `--user-data-dir=${userDir}`,
      `--remote-debugging-port=${dbgPort}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { proc.kill("SIGKILL"); } catch { /* ignore */ }
    try { rmSync(userDir, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  const watchdog = setTimeout(() => {
    cleanup();
    process.exit(1);
  }, timeoutMs + 10_000);
  watchdog.unref?.();

  try {
    return await fn({ port: dbgPort, proc, userDir });
  } finally {
    clearTimeout(watchdog);
    cleanup();
  }
}

export async function connect(port) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) break;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails?.exception?.description?.slice(0, 200) ?? m.params.exceptionDetails?.text);
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
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails ? { __err: JSON.stringify(r.exceptionDetails).slice(0, 200) } : r.result.value;
  };
  const close = () => { try { ws.close(); } catch { /* ignore */ } };
  return { send, ev, close, errors };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
