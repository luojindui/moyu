import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 600_000,
    include: ["playtest/final-mgr-analysis2.test.ts"],
    hookTimeout: 600_000,
  },
});
