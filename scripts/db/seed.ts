/** Carga los catálogos base. Uso: npx tsx scripts/db/seed.ts */
import "dotenv/config";
import { Pool } from "pg";
import { seedBase } from "../../database/seeds/seed-base";
import { createDb } from "../../src/server/db/drizzle";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  try {
    await seedBase(createDb(pool));
    console.log("Catálogos base cargados.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
