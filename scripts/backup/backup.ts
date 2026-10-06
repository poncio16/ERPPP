/**
 * Backup por consola o cron (J.2-1).
 * Uso: npm run db:backup                  → backup MANUAL
 *      npm run db:backup -- --auto        → backup AUTO (cron diario) y aplicación de la retención
 */
import "dotenv/config";
import { Pool } from "pg";
import { createBackup } from "../../src/modules/backup/service";
import { createDb } from "../../src/server/db/drizzle";
import { consoleActor, fail, requireEnv } from "./cli-lib";

async function main() {
  const kind = process.argv.includes("--auto") ? "AUTO" : "MANUAL";
  const pool = new Pool({ connectionString: requireEnv("DATABASE_URL"), max: 2 });
  try {
    const r = await createBackup(createDb(pool), consoleActor(), { kind });
    console.log(`Backup ${kind} OK: ${r.filePath}`);
    console.log(`  Tamaño: ${r.sizeBytes} bytes · SHA-256: ${r.sha256}`);
    console.log(`  Esquema: ${r.controlTotals.schemaVersion} · Último registro de auditoría: #${r.controlTotals.audit.lastId ?? "—"}`);
    const offsite = { OK: "copia cifrada fuera del servidor", SKIPPED: "SIN copia fuera del servidor (configure BACKUP_OFFSITE_DIR)", FAILED: `FALLÓ la copia fuera del servidor: ${r.offsiteError}` };
    console.log(`  Copia externa: ${offsite[r.offsiteStatus]}`);
    if (r.pruned.length) console.log(`  Retención: se borraron ${r.pruned.length} backup(s) viejos`);
    if (r.offsiteStatus === "FAILED") process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

main().catch(fail);
