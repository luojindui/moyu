/**
 * probe-r4v-nurture-ui.test.ts — 验收 1/3 的 UI 层：HUD 📔 打开日报/图鉴面板
 * 用最小 DOM 桩驱动 src/ui/journal.ts（node 环境无浏览器），不改 src/。
 * 对应 HEAD 版本的「面板关闭零开销 + 打开时 force 重绘 + 400ms 节流」实现。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { initialState, type GameState } from "../src/engine/state";
import { syncFlavorCollection, collectQuote } from "../src/engine/collection";
import { UPGRADES } from "../src/engine/upgrades";
import { makeDaily } from "./probe-r4v-nurture-lib";

function log(label: string, value: unknown): void {
  console.log(`[r4v-ui] ${label}`, JSON.stringify(value));
}

class FakeEl {
  id: string;
  textContent = "";
  className = "";
  disabled = false;
  children: FakeEl[] = [];
  handlers: Record<string, Array<() => void>> = {};
  /** DOM 写操作次数（验证「关闭时零开销」） */
  writes = 0;
  private hidden = false;
  private _html = "";
  classList = {
    contains: (c: string): boolean => c === "hidden" && this.hidden,
    add: (c: string): void => {
      if (c === "hidden") this.hidden = true;
    },
    remove: (c: string): void => {
      if (c === "hidden") this.hidden = false;
    },
    toggle: (c: string): boolean => {
      if (c === "hidden") this.hidden = !this.hidden;
      return this.hidden;
    },
  };
  constructor(id: string) {
    this.id = id;
  }
  get innerHTML(): string {
    return this._html;
  }
  set innerHTML(v: string) {
    this._html = v;
    if (v === "") this.children = [];
    this.writes += 1;
  }
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    this.writes += 1;
    return c;
  }
  addEventListener(ev: string, fn: () => void): void {
    (this.handlers[ev] ??= []).push(fn);
  }
  fire(ev: string): void {
    for (const fn of this.handlers[ev] ?? []) fn();
  }
  setText(v: string): void {
    this.textContent = v;
    this.writes += 1;
  }
}

const IDS = [
  "journal", "journal-date", "journal-streak", "journal-goals", "journal-claim",
  "journal-quote", "journal-flavor", "journal-latest", "journal-total", "journal-close", "btn-journal",
];
let els: Map<string, FakeEl>;

function setupDom(): void {
  els = new Map(IDS.map((id) => [id, new FakeEl(id)]));
  els.get("journal")!.classList.add("hidden"); // 复刻 index.html: <div id="journal" class="hidden">
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => els.get(id) ?? null,
    createElement: () => new FakeEl("li"),
  };
}
const el = (id: string): FakeEl => els.get(id)!;

const { Journal } = await import("../src/ui/journal");

function stateWith(ids = ["click_100", "meme_1", "buy_3"], date = "2026-11-27"): GameState {
  const s = initialState();
  return { ...s, daily: makeDaily(ids, date) };
}

/** 模拟 main.ts：面板默认关闭，靠 📔 按钮打开 */
function openJournal(onClaim: () => void = () => undefined): InstanceType<typeof Journal> {
  const j = new Journal(onClaim);
  el("btn-journal").fire("click");
  return j;
}

beforeEach(() => {
  setupDom();
});

describe("HUD 📔 → 日报/图鉴面板（运行时行为）", () => {
  it("index.html 含 📔 按钮与面板全部挂载点；样式表含隐藏态", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    for (const id of IDS) expect(html.includes(`id="${id}"`)).toBe(true);
    expect(html.includes("📔")).toBe(true);
    const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
    expect(css.includes("#journal.hidden")).toBe(true);
    expect(css.includes("display: none")).toBe(true);
  });

  it("📔 点击打开面板（关闭时零 DOM 开销）、再点关闭；✕ 关闭", () => {
    const j = new Journal(() => undefined);
    expect(j.isOpen).toBe(false);
    const s = stateWith();
    j.refresh(s); // 面板关闭：只缓存 lastState，不写 DOM
    const closedWrites = [...els.values()].reduce((a, e) => a + e.writes, 0);
    expect(closedWrites).toBe(0);
    expect(el("journal-date").textContent).toBe("");

    el("btn-journal").fire("click"); // 打开 → 立即 force 重绘
    expect(j.isOpen).toBe(true);
    expect(el("journal-date").textContent).toBe("2026-11-27");
    el("btn-journal").fire("click");
    expect(j.isOpen).toBe(false);
    el("btn-journal").fire("click");
    el("journal-close").fire("click");
    expect(j.isOpen).toBe(false);
    log("面板开关", { closedWrites, reopenedDate: el("journal-date").textContent });
  });

  it("日报渲染：3 目标行、进度、领取按钮文案与禁用态、streak 文案", () => {
    const j = openJournal();
    let s = stateWith();
    j.refresh(s, true);
    expect(el("journal-date").textContent).toBe("2026-11-27");
    expect(el("journal-goals").children).toHaveLength(3);
    expect(el("journal-claim").disabled).toBe(true);
    expect(el("journal-claim").textContent).toBe("完成 0/3");
    expect(el("journal-streak").textContent).toContain("连续 0 天");
    expect(el("journal-streak").textContent).toContain("今天未领");

    // 完成 1/3
    s = { ...s, daily: { ...s.daily!, goals: s.daily!.goals.map((g, i) => (i === 0 ? { ...g, progress: g.target, done: true } : g)) } };
    j.refresh(s, true);
    expect(el("journal-claim").disabled).toBe(true);
    expect(el("journal-claim").textContent).toBe("完成 1/3");
    expect(el("journal-goals").children[0]!.className).toBe("goal done");
    expect(el("journal-goals").children[0]!.innerHTML).toContain("goal-mark");
    expect(el("journal-goals").children[0]!.innerHTML).toContain("100/100");

    // 3/3 未领 → 可领，文案含奖励
    s = { ...s, daily: { ...s.daily!, goals: s.daily!.goals.map((g) => ({ ...g, progress: g.target, done: true })) } };
    j.refresh(s, true);
    expect(el("journal-claim").disabled).toBe(false);
    expect(el("journal-claim").textContent).toBe("领取 +500");

    // 已领
    s = { ...s, daily: { ...s.daily!, claimed: true, streak: 3 } };
    j.refresh(s, true);
    expect(el("journal-claim").disabled).toBe(true);
    expect(el("journal-claim").textContent).toBe("今日已领");
    expect(el("journal-streak").textContent).toBe("🔥 连续 3 天");
    log("日报 UI", { claim: el("journal-claim").textContent, goals: el("journal-goals").children.length });
  });

  it("打开状态下 400ms 内非 force 刷新不重绘，force 立即重绘（节流不影响领取/状态更新）", () => {
    const j = openJournal();
    j.refresh(stateWith(undefined, "2026-11-27"), true);
    expect(el("journal-date").textContent).toBe("2026-11-27");
    j.refresh(stateWith(undefined, "2026-11-28")); // 节流窗口内，忽略
    expect(el("journal-date").textContent).toBe("2026-11-27");
    j.refresh(stateWith(undefined, "2026-11-28"), true); // force
    expect(el("journal-date").textContent).toBe("2026-11-28");
  });

  it("图鉴进度渲染：0/10、0/45、0/55 → 收满后 10/10、45/45、55/55；最新彩蛋文案", () => {
    const j = openJournal();
    let s = stateWith();
    j.refresh(s, true);
    expect(el("journal-quote").textContent).toBe("0/10");
    expect(el("journal-flavor").textContent).toBe("0/45");
    expect(el("journal-total").textContent).toBe("0/55");
    expect(el("journal-latest").textContent).toContain("买升级");

    // 旧档迁移：coffee Lv22 → 4 档彩蛋
    s = syncFlavorCollection({ ...stateWith(), levels: { coffee: 22 } });
    j.refresh(s, true);
    expect(el("journal-flavor").textContent).toBe("4/45");
    expect(el("journal-total").textContent).toBe("4/55");
    expect(el("journal-latest").textContent).toContain("咖啡续命");
    expect(el("journal-latest").textContent).toContain("胃：我抗议但无效");

    // 收满
    let full = stateWith();
    for (let i = 0; i < 10; i++) full = collectQuote(full, i).state;
    const allLv50 = Object.fromEntries(UPGRADES.map((u) => [u.id, 50]));
    full = syncFlavorCollection({ ...full, levels: allLv50 });
    j.refresh(full, true);
    expect(el("journal-quote").textContent).toBe("10/10");
    expect(el("journal-flavor").textContent).toBe("45/45");
    expect(el("journal-total").textContent).toBe("55/55");
    log("图鉴 UI", { quote: el("journal-quote").textContent, flavor: el("journal-flavor").textContent, total: el("journal-total").textContent });
  });

  it("每日领取按钮点击回调 onClaim 被调用（main.ts 用它执行领取）", () => {
    let calls = 0;
    openJournal(() => {
      calls += 1;
    });
    el("journal-claim").fire("click");
    expect(calls).toBe(1);
  });

  it("daily=null（旧档刚 restore 未生成日报）打开面板不崩、不渲染", () => {
    const j = new Journal(() => undefined);
    expect(() => j.refresh(initialState())).not.toThrow();
    expect(() => el("btn-journal").fire("click")).not.toThrow();
    expect(j.isOpen).toBe(true);
    expect(el("journal-goals").children).toHaveLength(0);
    expect(el("journal-date").textContent).toBe("");
  });
});
