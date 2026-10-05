import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/** Aplica las migraciones pendientes con el rol dueño del esquema (erp_owner). */
export async function runMigrations(ownerUrl: string) {
  if (!ownerUrl) throw new Error("Falta DATABASE_OWNER_URL");
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./database/migrations" });
  } finally {
    await pool.end();
  }
}
