import { Client, Pool } from "pg";
import { bootstrapDatabase } from "../../scripts/db/bootstrap-lib";
import { runMigrations } from "../../scripts/db/migrate-lib";
import { seedBase } from "../../database/seeds/seed-base";
import { createDb } from "../../src/server/db/drizzle";
import { TEST_DB, testUrls } from "./test-env";

/** Recrea la base de pruebas: roles, migraciones reales y catálogos base. */
export default async function setup() {
  const urls = testUrls();
  const admin = new Client({ connectionString: urls.admin });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await bootstrapDatabase(admin, TEST_DB, {
      ownerPassword: decodeURIComponent(new URL(urls.owner).password),
      appPassword: decodeURIComponent(new URL(urls.app).password),
      backupPassword: decodeURIComponent(new URL(urls.backup).password),
    });
  } finally {
    await admin.end();
  }
  await runMigrations(urls.owner);
  const pool = new Pool({ connectionString: urls.owner });
  try {
    await seedBase(createDb(pool));
  } finally {
    await pool.end();
  }
}
