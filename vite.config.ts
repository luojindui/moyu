/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { target: "es2022" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "playtest/simulate.test.ts", "playtest/probe-r5-balance.test.ts", "playtest/probe-r6-redlines.test.ts"],
  },
});
