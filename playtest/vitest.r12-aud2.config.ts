/// <reference types="vitest/config" />
import { defineConfig } from "vite";

/** R12 复验审计探针专用配置（只读 src/，不污染主 vite.config.ts 的 include 白名单）
 *  npx vitest run --config playtest/vitest.r12-aud2.config.ts
 */
export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["playtest/probe-r12-aud2-*.test.ts"],
    testTimeout: 120_000,
  },
});
