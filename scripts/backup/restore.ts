/**
 * Restauración de un backup (J.2-4). Reemplaza TODA la información de la base de DATABASE_URL.
 * Hace antes un backup PRE_RESTORE, restaura en una base nueva, la verifica y recién entonces la
 * intercambia; la base anterior queda renombrada como <base>_prev_<fecha>.
 * Uso: npm run db:restore -- <archivo.dump> [--yes]
 */
import "dotenv/config";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { restoreBackup } from "../../src/modules/backup/restore";
import { consoleActor, fail, requireEnv } from "./cli-lib";

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) throw new Error("Uso: npm run db:restore -- <archivo.dump> [--yes]");
  const appUrl = requireEnv("DATABASE_URL");
  const targetDb = decodeURIComponent(new URL(appUrl).pathname.slice(1));
  if (!process.argv.includes("--yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Se va a reemplazar TODA la información de la base "${targetDb}" con ${path.basename(file)}.\nEscriba el nombre de la base para confirmar: `);
    rl.close();
    if (answer.trim() !== targetDb) throw new Error("Restauración cancelada.");
  }
  const r = await restoreBackup({
    file: path.resolve(file),
    adminUrl: requireEnv("DATABASE_ADMIN_URL"),
    targetDb,
    appUrl,
    backupUrl: requireEnv("DATABASE_BACKUP_URL"),
    actor: consoleActor(),
  });
  for (const s of r.report.steps) console.log(`${s.ok ? "PASS" : "FAIL"}  ${s.name}: ${s.detail}`);
  if (r.preRestore) console.log(`Backup previo (PRE_RESTORE): ${r.preRestore.filePath}`);
  if (r.previousDb) console.log(`La base anterior quedó como "${r.previousDb}" (bórrela cuando ya no la necesite).`);
  console.log(`\nRestauración terminada en "${r.targetDb}". Reinicie la aplicación y haga la verificación humana del runbook.`);
}

main().catch(fail);
