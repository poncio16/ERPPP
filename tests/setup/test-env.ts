import "dotenv/config";

/** Nombre de la base exclusiva de pruebas (se recrea en cada corrida). */
export const TEST_DB = process.env.TEST_DATABASE_NAME ?? "erp_test";

function withDb(url: string | undefined, name: string): string {
  if (!url) throw new Error("Faltan variables de entorno de base de datos (ver .env.example)");
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

export const testUrls = () => ({
  admin: process.env.TEST_ADMIN_URL ?? process.env.DATABASE_ADMIN_URL ?? "",
  owner: withDb(process.env.DATABASE_OWNER_URL, TEST_DB),
  app: withDb(process.env.DATABASE_URL, TEST_DB),
});
