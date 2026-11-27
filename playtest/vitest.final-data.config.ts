import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30000,
    // 终验 v0.6.6 复验（round1 的 probe-final-data-engine.test.ts 保留为 v0.5.0 历史证据，不参与本轮）
    include: ["playtest/probe-v066-engine.test.ts"],
  },
});
