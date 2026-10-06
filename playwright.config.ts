import "dotenv/config";
import { defineConfig } from "@playwright/test";
import { E2E_PORT, e2eDatabaseUrl } from "./e2e/env";

/**
 * Pruebas en el navegador (K.1): las pruebas integrales de §47 de punta a punta, contra la
 * aplicación compilada (`npm run build`) y una base exclusiva que se recrea en cada corrida.
 * Uso: npm run build && npm run test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.e2e.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // outputDir propio: Playwright lo vacía al empezar y en test-results/ queda también el reporte de Vitest.
  outputDir: "test-results/playwright",
  reporter: [["list"], ["json", { outputFile: "test-results/e2e.json" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    acceptDownloads: true,
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    ...(process.env.E2E_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } } : {}),
  },
  webServer: {
    command: `npx next start -p ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: e2eDatabaseUrl(), MAINTENANCE_FILE: "test-results/.maintenance-e2e" },
  },
});
