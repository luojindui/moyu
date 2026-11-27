import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 终验③ 手机端实测（无头 Chrome，390×844 竖屏）
 * 1) 按任务给的方式 dump-dom：检查渲染后 DOM 的 HUD 数值 / 段位文案 / #journal-total / 商店卡数量 / canvas 尺寸。
 * 2) 同一次 dump 打开 --enable-logging=stderr，过滤页面级 ERROR（Uncaught/TypeError/Failed to load resource…）。
 * 备注：dump-dom 的窗口在 macOS headless 下会被钳到 500px 宽（实测 canvas=500×406，仍是有效渲染），
 *       真正的 390×844 布局与触点/离线实测见 playtest/final-casual-cdp.mjs（CDP 设备模拟，报告 final-casual-mobile-report.json）。
 */

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://127.0.0.1:5173/";

const serverUp = await fetch(URL)
  .then((r) => r.ok)
  .catch(() => false);

interface Dump {
  dom: string;
  html: string[];
  errLines: string[];
  infoLines: string[];
}

function dumpDom(): Dump {
  const dir = mkdtempSync(join(tmpdir(), "moyu-final-mobile-"));
  const r = spawnSync(
    CHROME,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--enable-logging=stderr",
      "--v=0",
      `--user-data-dir=${dir}`,
      "--window-size=390,844",
      "--virtual-time-budget=6000",
      "--dump-dom",
      URL,
    ],
    { encoding: "utf8", timeout: 60_000, maxBuffer: 32 * 1024 * 1024 },
  );
  const dom = r.stdout ?? "";
  const err = r.stderr ?? "";
  const pageErrors = err
    .split("\n")
    // Chrome 日志格式：[:ERROR:CONSOLE(行号)] "脚本错误"；headless 环境自身日志（crashpad/Keychain 等）不算页面错误
    .filter((l) => /:(ERROR|FATAL):CONSOLE|Uncaught|Failed to load resource|net::ERR_|boot failed/i.test(l))
    .filter((l) => !/crashpad|Keychain|password_manager|os_crypt|GoogleUpdater|trust_store/i.test(l));
  // INFO 级 console（vite 连接、Canvas2D 优化提示）不计为错误，仅记录
  const infoLines = err.split("\n").filter((l) => /:INFO:CONSOLE/i.test(l)).map((l) => l.trim());
  rmSync(dir, { recursive: true, force: true });
  return { dom, html: dom.split("\n"), errLines: pageErrors, infoLines };
}

const grab = (dom: string, id: string): string | null => {
  const m = new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(dom);
  return m ? m[1]!.trim() : null;
};

describe("终验③：手机端（无头 Chrome 390×844）", () => {
  it.skipIf(!serverUp)("DOM 渲染：HUD/场景/商店 9 卡/📔/图鉴分母 都在", () => {
    const { dom, errLines, infoLines } = dumpDom();
    expect(dom.length).toBeGreaterThan(2000);

    // ---- HUD ----
    const moyu = grab(dom, "hud-moyu");
    const click = grab(dom, "hud-click");
    const idle = grab(dom, "hud-idle");
    const rank = grab(dom, "hud-rank");
    console.log(`HUD：摸鱼值="${moyu}" 点击="${click}" 挂机="${idle}" 段位="${rank}"`);
    expect(moyu).toBeTruthy();
    expect(Number(moyu)).not.toBeNaN();
    expect(click).toMatch(/^\d+$/);
    expect(idle).toMatch(/^[\d.]+$/);
    expect(rank).toContain("摸鱼实习生");
    expect(rank).toMatch(/升 .+ \d+%/);

    // ---- 场景 canvas ----
    const canvas = /<canvas id="stage"[^>]*width="(\d+)" height="(\d+)"[^>]*>/.exec(dom);
    expect(canvas).not.toBeNull();
    console.log(`canvas：${canvas![1]}×${canvas![2]}（attr，DPR 放大后）`);
    expect(Number(canvas![1])).toBeGreaterThan(0);
    expect(Number(canvas![2])).toBeGreaterThan(0);

    // ---- 商店 9 张卡 ----
    const cards = (dom.match(/class="shop-card/g) ?? []).length;
    console.log(`商店卡：${cards} 张（期望 9）`);
    expect(cards).toBe(9);
    // 每张卡都有价格文案
    expect((dom.match(/class="shop-cost"/g) ?? []).length).toBe(9);

    // ---- 📔 日报 / 图鉴 ----
    expect(dom).toContain('id="btn-journal"');
    const total = grab(dom, "journal-total");
    console.log(`📔 图鉴分母：${total}`);
    expect(total).toBe("0/55");

    // ---- 无加载失败横幅、无页面级 console 错误 ----
    expect(dom).not.toContain('class="boot-error"');
    console.log(`页面级 stderr ERROR：${errLines.length ? errLines.join(" | ") : "无"}`);
    console.log(`INFO 级 console：${infoLines.length ? infoLines.map((l) => l.slice(0, 120)).join(" | ") : "无"}`);
    expect(errLines).toEqual([]);
  });

  it.skipIf(!serverUp)("PWA 基础：manifest / viewport / theme-color 存在", () => {
    const { dom } = dumpDom();
    expect(dom).toContain('rel="manifest"');
    expect(dom).toContain("viewport-fit=cover");
    expect(dom).toContain('name="theme-color"');
    expect(dom).toContain("<title>摸鱼工位</title>");
  });

  it.skipIf(serverUp)("dev server 未启动：跳过（先 npm run dev）", () => {
    expect(true).toBe(true);
  });
});
