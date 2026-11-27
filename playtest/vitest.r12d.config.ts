/// <reference types="vitest/config" />
import { defineConfig } from "vite";
/** R12 第四次复验（round4）专用配置 */
export default defineConfig({
  test: { environment: "node", root: ".", include: ["playtest/probe-r12d-bld-*.test.ts"], testTimeout: 600_000 },
});
