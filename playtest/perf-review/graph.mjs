import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";

const ROOT = resolve("src");
const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) files.push(p);
  }
})(ROOT);

const layer = (f) => {
  const r = relative(ROOT, f);
  if (r.startsWith("engine/")) return "engine";
  if (r.startsWith("render/")) return "render";
  if (r.startsWith("ui/")) return "ui";
  return "main";
};
const deps = new Map();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const out = [];
  for (const m of src.matchAll(/^\s*(?:import|export)\s+(?:[^'"]*?from\s+)?["']([^"']+)["']/gm)) {
    const spec = m[1];
    if (!spec.startsWith(".")) continue;
    let t = resolve(dirname(f), spec);
    if (!t.endsWith(".ts")) {
      // try .ts / /index.ts
      try { statSync(t + ".ts"); t = t + ".ts"; } catch {
        try { statSync(join(t, "index.ts")); t = join(t, "index.ts"); } catch { t = null; }
      }
    }
    if (t) out.push(t);
  }
  deps.set(f, out);
}

// cycles via DFS
const color = new Map();
const cycles = [];
function dfs(f, stack) {
  color.set(f, 1); stack.push(f);
  for (const n of deps.get(f) ?? []) {
    if (!deps.has(n)) continue;
    if (color.get(n) === 1) cycles.push([...stack.slice(stack.indexOf(n)), n].map(x => relative(ROOT, x)));
    else if (!color.get(n)) dfs(n, stack);
  }
  stack.pop(); color.set(f, 2);
}
for (const f of files) if (!color.get(f)) dfs(f, []);

// layer violations
const violations = [];
const order = { engine: 0, render: 1, ui: 2, main: 3 };
for (const [f, ns] of deps) {
  for (const n of ns) {
    const lf = layer(f), ln = layer(n);
    if (order[ln] > order[lf]) violations.push(`${relative(ROOT, f)} (${lf}) -> ${relative(ROOT, n)} (${ln})`);
  }
}

// engine DOM/global purity
const domGlobs = ["document", "window", "localStorage", "sessionStorage", "navigator", "requestAnimationFrame", "cancelAnimationFrame", "setInterval", "addEventListener", "canvas", "getElementById", "HTMLCanvasElement", "Image(", "fetch(", "performance.", "AudioContext", "matchMedia", "visualViewport", "innerWidth", "innerHeight", "devicePixelRatio", "requestIdleCallback", "MutationObserver", "IntersectionObserver", "Date.now"];
const domHits = [];
for (const f of files.filter(x => layer(x) === "engine")) {
  const src = readFileSync(f, "utf8");
  for (const g of domGlobs) {
    const re = new RegExp(g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    const n = (src.match(re) ?? []).length;
    if (n) domHits.push({ file: relative(ROOT, f), glob: g, n });
  }
}

console.log("FILES", files.length);
console.log("EDGES", [...deps.values()].reduce((a, b) => a + b.length, 0));
console.log("CYCLES", JSON.stringify(cycles, null, 1));
console.log("LAYER_VIOLATIONS", JSON.stringify(violations, null, 1));
console.log("ENGINE_DOM_GLOBALS", JSON.stringify(domHits, null, 1));

// fan-in / fan-out
const fanIn = new Map(files.map(f => [f, 0]));
for (const ns of deps.values()) for (const n of ns) if (fanIn.has(n)) fanIn.set(n, fanIn.get(n) + 1);
console.log("TOP_FANIN", [...fanIn].sort((a,b)=>b[1]-a[1]).slice(0,12).map(([f,n])=>`${relative(ROOT,f)} ${n}`).join("\n"));
console.log("TOP_FANOUT", [...deps].sort((a,b)=>b[1].length-a[1].length).slice(0,8).map(([f,n])=>`${relative(ROOT,f)} ${n.length}`).join("\n"));
