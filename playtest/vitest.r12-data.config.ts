/// <reference types="vitest/config" />
import { defineConfig } from "vite";

/** R12 数据党试玩探针配置（只读 src/，不改 src/）
 *  npx vitest run --config playtest/vitest.r12-data.config.ts
 */
export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["playtest/probe-r12-data-*.test.ts"],
    testTimeout: 600_000,
  },
});
