/// <reference types="vitest/config" />
import { defineConfig } from "vite";

/** R12 第三次复验（round3）探针专用配置 */
export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["playtest/probe-r12c-bld-*.test.ts"],
    testTimeout: 600_000,
  },
});
