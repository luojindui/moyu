/// <reference types="vitest/config" />
import { defineConfig } from "vite";
/** R14 批3 管理党探针专用配置（只读 src/） */
export default defineConfig({
  test: { environment: "node", root: ".", include: ["playtest/probe-r14-mgr-engine.test.ts"], testTimeout: 120_000 },
});