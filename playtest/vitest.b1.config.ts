/// <reference types="vitest/config" />
import { defineConfig } from "vite";

/** 批次 1（同事派遣 + 天赋树）平衡探针专用配置（不污染主 vite.config.ts 的 include 白名单）
 *  npx vitest run --config playtest/vitest.b1.config.ts
 */
export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["playtest/probe-b1-*.test.ts"],
    testTimeout: 600_000,
  },
});
