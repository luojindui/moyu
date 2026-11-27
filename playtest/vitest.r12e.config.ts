/// <reference types="vitest/config" />
import { defineConfig } from "vite";
/** R12 第五次复验（round5）专用配置 */
export default defineConfig({
  test: { environment: "node", root: ".", include: ["playtest/probe-r12e-bld-*.test.ts"], testTimeout: 600_000 },
});
