/// <reference types="vitest/config" />
import { defineConfig } from "vite";

/** R9 数据探针专用配置（不污染主 vite.config.ts 的 test.include 白名单） */
export default defineConfig({
  test: {
    environment: "node",
    root: ".",
    include: ["playtest/probe-r9-data-*.test.ts"],
  },
});
