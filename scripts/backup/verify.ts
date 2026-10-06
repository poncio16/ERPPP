/**
 * Verificación de un backup (J.2-3): SHA-256, pg_restore --list, restauración en erp_verify,
 * totales de control e invariantes. Sale con código 1 si da FAIL.
 * Uso: npm run db:backup:verify -- <archivo.dump>
 *      npm run db:backup:verify -- --latest     (último backup correcto; lo usa el cron semanal)
 */
import "dotenv/config";
import path from "node:path";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Pool } from "pg";
import { backupConfig } from "../../src/modules/backup/config";
import { verifyBackup } from "../../src/modules/backup/restore";
import { createDb } from "../../src/server/db/drizzle";
import { backupRuns } from "../../src/server/db/schema";
import { consoleActor, fail, requireEnv } from "./cli-lib";

async function main() {
  const cfg = backupConfig();
  const adminUrl = requireEnv("DATABASE_ADMIN_URL");
  const pool = new Pool({ connectionString: requireEnv("DATABASE_URL"), max: 2 });
  const db = createDb(pool);
  try {
    let file = process.argv.slice(2).find((a) => !a.startsWith("--"));
    if (process.argv.includes("--latest")) {
      const [last] = await db
        .select({ fileName: backupRuns.fileName })
        .from(backupRuns)
        .where(and(eq(backupRuns.status, "OK"), isNull(backupRuns.prunedAt)))
        .orderBy(desc(backupRuns.id))
        .limit(1);
      if (!last?.fileName) throw new Error("No hay backups correctos para verificar.");
      file = path.join(cfg.dir, last.fileName);
    }
    if (!file) throw new Error("Uso: npm run db:backup:verify -- <archivo.dump> | --latest");
    const report = await verifyBackup({ file: path.resolve(file), adminUrl, appDb: db, actor: consoleActor(), config: cfg, keep: process.argv.includes("--keep") });
    for (const s of report.steps) console.log(`${s.ok ? "PASS" : "FAIL"}  ${s.name}: ${s.detail}`);
    for (const d of report.differences.slice(0, 50)) console.log(`      ${d}`);
    console.log(`\nResultado: ${report.ok ? "PASS" : "FAIL"} (${report.fileName})`);
    if (!report.ok) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch(fail);
