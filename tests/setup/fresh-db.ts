import { Client, Pool } from "pg";
import { bootstrapDatabase } from "../../scripts/db/bootstrap-lib";
import { runMigrations } from "../../scripts/db/migrate-lib";
import { seedBase } from "../../database/seeds/seed-base";
import { withDatabase } from "@/modules/backup/pg-tools";
import { createDb } from "@/server/db/drizzle";
import { testUrls } from "./test-env";

/**
 * Base nueva y exclusiva (roles, migraciones reales y catálogos base) para las pruebas que
 * comparan totales globales: la base compartida de pruebas tiene datos de otros archivos y
 * algunos rotos a propósito, así que ahí no se pueden afirmar sumas de todo el sistema.
 */
export async function createFreshDatabase(name: string) {
  const urls = testUrls();
  const admin = new Client({ connectionString: urls.admin });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await bootstrapDatabase(admin, name, {
      ownerPassword: decodeURIComponent(new URL(urls.owner).password),
      appPassword: decodeURIComponent(new URL(urls.app).password),
      backupPassword: decodeURIComponent(new URL(urls.backup).password),
    });
  } finally {
    await admin.end();
  }
  const ownerUrl = withDatabase(urls.owner, name);
  await runMigrations(ownerUrl);
  const owner = new Pool({ connectionString: ownerUrl, max: 1 });
  try {
    await seedBase(createDb(owner));
  } finally {
    await owner.end();
  }
  return { appUrl: withDatabase(urls.app, name), ownerUrl };
}

export async function dropDatabase(name: string) {
  const admin = new Client({ connectionString: testUrls().admin });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
