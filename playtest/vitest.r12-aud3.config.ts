/// <reference types="vitest/config" />
import { defineConfig } from "vite";

/** R12 第三次复验专用配置（只读 src/）
 *  npx vitest run --config playtest/vitest.r12-aud3.config.ts
 */
export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["playtest/probe-r12-aud3-*.test.ts"],
    testTimeout: 120_000,
  },
});
