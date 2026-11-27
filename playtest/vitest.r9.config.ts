/// <reference types="vitest/config" />
import { defineConfig } from "vite";

/**
 * R9 音游/节奏党模拟探针专用配置：
 * `npx vitest run --config playtest/vitest.r9.config.ts`
 * 只读 src/，探针本身不改任何游戏文件（不在 src/ 下写任何东西）。
 */
export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["playtest/probe-r9-rhythm-sim.test.ts"],
  },
});
