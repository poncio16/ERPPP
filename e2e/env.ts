import { withDatabase } from "../src/modules/backup/pg-tools";

/** Base, usuario y puerto exclusivos de las pruebas en el navegador. */
export const E2E_DB = "erp_e2e";
export const E2E_USER = "admin_e2e";
export const E2E_PASSWORD = "Clave-E2E-Segura-2026";
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3200);

export function e2eDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL (ver .env.example)");
  return withDatabase(url, E2E_DB);
}
