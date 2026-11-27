/// <reference types="vitest/config" />
import { defineConfig } from "vite";

/**
 * R7 硬核放置老玩家探针专用配置：
 *   npx vitest run --config playtest/vitest.r7-hard.config.ts
 * 只跑 playtest/probe-r7-hard-*.test.ts（只读 src/，不改游戏文件）。
 */
export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["playtest/probe-r7-hard-*.test.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
