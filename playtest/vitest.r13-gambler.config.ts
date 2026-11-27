/// <reference types="vitest/config" />
import { defineConfig } from "vite";
/** R13 赌徒党探针专用配置（只读 src/，不改 src/） */
export default defineConfig({
  test: { environment: "node", root: ".", include: ["playtest/probe-r13-gambler.test.ts"], testTimeout: 120_000 },
});
