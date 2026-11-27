import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["playtest/dbg-b3-decor.test.ts"] } });
