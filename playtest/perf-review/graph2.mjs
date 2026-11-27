import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
const ROOT = resolve("src");
const files = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) files.push(p); } })(ROOT);

// distinguish runtime (value) imports from type-only imports
const deps = new Map();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const out = [];
  for (const m of src.matchAll(/import\s+(type\s+)?([\s\S]*?)from\s+["']([^"']+)["']/g)) {
    if (m[1]) continue; // import type ...
    const clause = m[2];
    const spec = m[3];
    // all named specifiers are type-only?  import { type A, type B } -> type only
    const named = clause.match(/\{([\s\S]*?)\}/)?.[1] ?? "";
    const ids = named.split(",").map(s => s.trim()).filter(Boolean);
    const valueIds = ids.filter(s => !s.startsWith("type "));
    const def = /^\s*\w+(\s*,|\s+from)?/.test(clause) && !clause.trim().startsWith("{");
    const star = clause.includes("*");
    if (!valueIds.length && !star && !def) continue;
    if (!spec.startsWith(".")) continue;
    let t = resolve(dirname(f), spec);
    if (t.endsWith(".ts")) { /* ok */ } else {
      try { statSync(t + ".ts"); t += ".ts"; } catch { try { statSync(join(t, "index.ts")); t = join(t, "index.ts"); } catch { t = null; } }
    }
    if (t) out.push(t);
  }
  deps.set(f, out);
}
const color = new Map(); const cycles = [];
function dfs(f, stack) {
  color.set(f, 1); stack.push(f);
  for (const n of deps.get(f) ?? []) {
    if (!deps.has(n)) continue;
    if (color.get(n) === 1) cycles.push([...stack.slice(stack.indexOf(n)), n].map(x => relative(ROOT, x)).join(" -> "));
    else if (!color.get(n)) dfs(n, stack);
  }
  stack.pop(); color.set(f, 2);
}
for (const f of files) if (!color.get(f)) dfs(f, []);
console.log("VALUE_IMPORT_CYCLES", cycles.length);
cycles.forEach(c => console.log(" ", c));
// engine value imports of any node builtin/global
