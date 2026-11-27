/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["playtest/r10-min-daily.test.ts"] },
});
