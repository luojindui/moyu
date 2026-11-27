/// <reference types="vitest/config" />
import { defineConfig } from "vite";

/** R12 构筑党探针专用配置（不污染主 vite.config.ts）
 *  npx vitest run --config playtest/vitest.r12.config.ts
 */
export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["playtest/probe-r12-bld-*.test.ts"],
    testTimeout: 600_000,
  },
});
