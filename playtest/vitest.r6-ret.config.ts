/// <reference types="vitest/config" />
import { defineConfig } from "vite";

/**
 * R6 长线留存（14 天回访）探针专用配置：
 * `npx vitest run --config playtest/vitest.r6-ret.config.ts`
 * 只读 src/，探针本身不改任何游戏文件。
 */
export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["playtest/probe-r6-ret-*.test.ts"],
  },
});
