/// <reference types="vitest/config" />
import { defineConfig } from "vite";

/**
 * R8 竞品流失玩家（24h/72h 曲线）探针专用配置：
 * `npx vitest run --config playtest/vitest.r8-comp.config.ts`
 * 只读 src/，探针本身不改任何游戏文件。
 */
export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["playtest/probe-r8-comp.test.ts"],
  },
});
