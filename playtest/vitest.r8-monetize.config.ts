/// <reference types="vitest/config" />
import { defineConfig } from "vite";

/**
 * R8 商业化评估探针专用配置：
 * `npx vitest run --config playtest/vitest.r8-monetize.config.ts`
 * 只读 src/，探针本身不改任何游戏文件（不在 src/ 下写任何东西）。
 */
export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["playtest/probe-r8-monetize.test.ts"],
  },
});
