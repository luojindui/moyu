/// <reference types="vitest/config" />
import { defineConfig } from "vite";

/**
 * R9 多设备玩家存档探针专用配置：
 * `npx vitest run --config playtest/vitest.r9-cloudsave.config.ts`
 * 只读 src/，探针本身不改任何游戏文件。
 */
export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["playtest/probe-r9-cloudsave.test.ts"],
  },
});
