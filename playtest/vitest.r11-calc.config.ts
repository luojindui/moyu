/// <reference types="vitest/config" />
import { defineConfig } from "vite";

/** R11 计算器党/Excel 玩家探针专用配置（不污染主 vite.config.ts 的 include 白名单）
 *  npx vitest run --config playtest/vitest.r11-calc.config.ts
 */
export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["playtest/probe-r11-calc.test.ts"],
    testTimeout: 180_000,
  },
});
