/// <reference types="vitest/config" />
import { defineConfig } from "vite";

/**
 * 终验（休闲画像）探针专用配置：
 * 主 vite.config.ts 的 test.include 只挂了终验/回归白名单，本文件只用于跑
 * `npx vitest run --config playtest/vitest.final-casual.config.ts`
 * （probe-final-casual-*.test.ts 与 final-casual-cdp.mjs 的证据均基于此）。
 */
export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["playtest/probe-final-casual-*.test.ts"],
  },
});
