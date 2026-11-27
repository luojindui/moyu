import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
const ROOT = resolve("src");
const files = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts")) files.push(p); } })(ROOT);
const srcs = new Map(files.map(f => [f, readFileSync(f, "utf8")]));
const exports = [];
for (const [f, s] of srcs) {
  for (const m of s.matchAll(/export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+(\w+)/g)) exports.push({ f, name: m[1] });
  for (const m of s.matchAll(/export\s*\{([^}]+)\}/g)) for (const part of m[1].split(",")) { const nm = part.trim().split(/\s+as\s+/).pop().trim(); if (nm) exports.push({ f, name: nm }); }
}
const prodFiles = files.filter(f => !f.endsWith(".test.ts"));
const unused = [];
for (const { f, name } of exports) {
  if (f.endsWith(".test.ts")) continue;
  let count = 0;
  for (const [g, s] of srcs) {
    if (g === f || g.endsWith(".test.ts")) continue;
    const re = new RegExp(`\\b${name}\\b`, "g");
    count += (s.match(re) ?? []).length;
  }
  if (count === 0 && !f.endsWith("main.ts")) unused.push(`${relative(ROOT, f)} :: ${name}`);
}
console.log("UNUSED_EXPORTS", unused.length);
console.log(unused.join("\n"));
// exported but only used in tests
const onlyTests = [];
for (const { f, name } of exports) {
  if (f.endsWith(".test.ts")) continue;
  let prod = 0, tests = 0;
  for (const [g, s] of srcs) {
    if (g === f) continue;
    const n = (s.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
    if (g.endsWith(".test.ts")) tests += n; else prod += n;
  }
  if (prod === 0 && tests > 0) onlyTests.push(`${relative(ROOT, f)} :: ${name}`);
}
console.log("\nONLY_TEST_USED", onlyTests.length);
console.log(onlyTests.join("\n"));
