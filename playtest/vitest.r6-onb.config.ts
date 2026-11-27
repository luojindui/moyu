/// <reference types="vitest/config" />
import { defineConfig } from "vite";

/** R7 新手 onboarding 探针专用配置：npx vitest run --config playtest/vitest.r6-onb.config.ts */
export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["playtest/probe-r6-onb-*.test.ts"],
    testTimeout: 240_000,
  },
});
