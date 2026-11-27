import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000,
    include: ["playtest/r17-collector-engine.test.ts"],
  },
});
