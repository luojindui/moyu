/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { target: "es2022" },
  test: {
    environment: "node",
    testTimeout: 20000, // 重负载模拟用例（串行时 <3s，机器 load 高时更久）
    include: ["src/**/*.test.ts", "playtest/simulate.test.ts", "playtest/probe-r5-balance.test.ts", "playtest/probe-r6-redlines.test.ts", "playtest/probe-r7-*.test.ts", "playtest/probe-r8-*.test.ts", "playtest/probe-b1-talent-wiring.test.ts", "playtest/probe-b2-crossday.test.ts"],
  },
});
