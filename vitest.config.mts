import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src"), "server-only": path.resolve(import.meta.dirname, "tests/setup/server-only.ts") } },
  test: {
    environment: "node",
    globalSetup: ["tests/setup/global-db.ts"],
    // Las pruebas de integración comparten una base real: se ejecutan en serie.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: { TZ: "America/Argentina/Buenos_Aires" },
  },
});
