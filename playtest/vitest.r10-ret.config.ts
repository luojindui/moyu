/// <reference types="vitest/config" />
import { defineConfig } from "vite";

/**
 * R10 回归老玩家探针专用配置：
 * `npx vitest run --config playtest/vitest.r10-ret.config.ts`
 * 只读 src/，探针本身不改任何游戏文件。
 */
export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["playtest/probe-r10-returner.test.ts"],
    testTimeout: 120_000,
  },
});
