/** Migraciones sobre una base nueva: el script de migración tiene que funcionar desde cero. */
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import journal from "../../database/migrations/meta/_journal.json";
import { bootstrapDatabase } from "../../scripts/db/bootstrap-lib";
import { appliedMigrations, runMigrations } from "../../scripts/db/migrate-lib";
import { withDatabase } from "@/modules/backup/pg-tools";
import { testUrls } from "../setup/test-env";

const DB_NAME = "erp_test_migrations";

afterAll(async () => {
  const admin = new Client({ connectionString: testUrls().admin });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`).finally(() => admin.end());
});

describe("MIG Migraciones", () => {
  it("MIG-01 una base recién creada informa 0 migraciones aplicadas y se migra completa", async () => {
    const urls = testUrls();
    const admin = new Client({ connectionString: urls.admin });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
      await bootstrapDatabase(admin, DB_NAME, {
        ownerPassword: decodeURIComponent(new URL(urls.owner).password),
        appPassword: decodeURIComponent(new URL(urls.app).password),
        backupPassword: decodeURIComponent(new URL(urls.backup).password),
      });
    } finally {
      await admin.end();
    }
    const ownerUrl = withDatabase(urls.owner, DB_NAME);
    expect(await appliedMigrations(ownerUrl)).toBe(0);
    await runMigrations(ownerUrl);
    expect(await appliedMigrations(ownerUrl)).toBe(journal.entries.length);
  });
});
