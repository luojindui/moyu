/// <reference types="vitest/config" />
import { defineConfig } from "vite";

/** R12 复验（round2）探针专用配置 */
export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["playtest/probe-r12b-bld-*.test.ts"],
    testTimeout: 600_000,
  },
});
