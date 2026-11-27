/// <reference types="vitest/config" />
import { defineConfig } from "vite";

/** R12 碎片党（早期解锁节奏）探针专用配置（不污染主配置 include）
 *  npx vitest run --config playtest/vitest.r12-frag.config.ts
 */
export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["playtest/probe-r12-frag-early.test.ts"],
    testTimeout: 180_000,
  },
});
