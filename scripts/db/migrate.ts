/**
 * Uso: npx tsx scripts/db/migrate.ts [--sin-backup]
 * Si hay migraciones pendientes sobre una base en uso, antes hace un backup PRE_MIGRATION (sección J.1).
 */
import "dotenv/config";
import { Pool } from "pg";
import journal from "../../database/migrations/meta/_journal.json";
import { createBackup } from "../../src/modules/backup/service";
import { createDb } from "../../src/server/db/drizzle";
import { consoleActor } from "../backup/cli-lib";
import { appliedMigrations, runMigrations } from "./migrate-lib";

/** Desde esta cantidad de migraciones aplicadas (0004) la base tiene lo necesario para el backup automático. */
const BACKUP_READY_AT = 5;

async function main() {
  const ownerUrl = process.env.DATABASE_OWNER_URL ?? "";
  if (!ownerUrl) throw new Error("Falta DATABASE_OWNER_URL");
  const applied = await appliedMigrations(ownerUrl);
  const pending = journal.entries.length - applied;
  if (pending > 0 && applied > 0) {
    if (process.argv.includes("--sin-backup")) {
      console.warn("Atención: se migra SIN backup previo (--sin-backup).");
    } else if (applied < BACKUP_READY_AT) {
      console.warn("Atención: la base es anterior al backup automático; haga un backup manual con pg_dump antes de migrar si tiene datos reales.");
    } else {
      if (!process.env.DATABASE_URL || !process.env.DATABASE_BACKUP_URL) throw new Error("Faltan DATABASE_URL o DATABASE_BACKUP_URL para el backup previo a la migración (o use --sin-backup).");
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
      try {
        const r = await createBackup(createDb(pool), consoleActor(), { kind: "PRE_MIGRATION" });
        console.log(`Backup previo a la migración: ${r.filePath}`);
      } finally {
        await pool.end();
      }
    }
  }
  await runMigrations(ownerUrl);
  console.log(pending > 0 ? `Migraciones aplicadas: ${pending}.` : "No hay migraciones pendientes.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
