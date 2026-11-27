import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", testTimeout: 900_000, include: ["playtest/final-mgr-analysis3.test.ts"], hookTimeout: 900_000 } });
