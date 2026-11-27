/// <reference types="vitest/config" />
import { defineConfig } from "vite";
/** R12 第六次复验（round6）专用配置 */
export default defineConfig({
  test: { environment: "node", root: ".", include: ["playtest/probe-r12f-bld-*.test.ts"], testTimeout: 600_000 },
});
