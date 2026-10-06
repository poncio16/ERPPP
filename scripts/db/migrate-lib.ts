import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";

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

/** Cantidad de migraciones ya aplicadas (0 en una base nueva, donde todavía no existe la tabla de control). */
export async function appliedMigrations(ownerUrl: string): Promise<number> {
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    // En dos consultas: una sola con CASE igual falla al planificarse si la tabla no existe.
    const { rows } = await client.query<{ exists: boolean }>("SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists");
    if (!rows[0]?.exists) return 0;
    const { rows: count } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");
    return count[0]?.n ?? 0;
  } finally {
    await client.end();
  }
}
