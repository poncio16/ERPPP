import { rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { Client, Pool } from "pg";
import { recordAudit, type AuditActor } from "@/modules/audit/service";
import { createDb, type Db } from "@/server/db/drizzle";
import { backupRuns } from "@/server/db/schema";
import { bootstrapDatabase } from "../../../scripts/db/bootstrap-lib";
import { backupConfig, type BackupConfig } from "./config";
import { compareControlTotals, computeControlTotals, type ControlTotals } from "./control-totals";
import { localStamp, readManifest, sha256File, type BackupManifest } from "./files";
import { pgBin, pgEnv, run, withDatabase } from "./pg-tools";
import { APP_VERSION, createBackup, type BackupResult } from "./service";

/**
 * Verificación y restauración de backups (J.2, pasos 3 a 5). Se ejecutan por consola en el servidor:
 * necesitan una conexión de superusuario (DATABASE_ADMIN_URL) para crear bases, y la restauración
 * reemplaza toda la información, por eso no se ofrece en la web.
 */

export interface CheckStep {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VerifyReport {
  ok: boolean;
  fileName: string;
  steps: CheckStep[];
  /** Diferencias entre los totales de control guardados y los de la base restaurada. */
  differences: string[];
  restored: ControlTotals | null;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 1000);
const SAFE_DB = /^[a-z_][a-z0-9_]{0,62}$/;

function ident(name: string) {
  if (!SAFE_DB.test(name)) throw new Error(`Nombre de base inválido: ${name}`);
  return name;
}

/** Comprueba archivo de control, SHA-256 y que pg_restore pueda leer el índice del archivo. */
async function checkFile(file: string, cfg: BackupConfig, appDb: Db | null): Promise<{ manifest: BackupManifest | null; steps: CheckStep[] }> {
  const steps: CheckStep[] = [];
  let manifest = await readManifest(file);
  if (!manifest && appDb) {
    // Sin el .json, se usan los datos registrados en backup_runs.
    const [r] = await appDb.select().from(backupRuns).where(and(eq(backupRuns.fileName, path.basename(file)), eq(backupRuns.status, "OK")));
    if (r?.controlTotals && r.sha256)
      manifest = {
        format: "erp-backup/1",
        runId: r.id,
        fileName: r.fileName!,
        sha256: r.sha256,
        sizeBytes: r.sizeBytes ?? 0,
        kind: r.kind as BackupManifest["kind"],
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? "",
        appVersion: r.appVersion ?? "",
        schemaVersion: r.schemaVersion ?? "",
        pgVersion: r.pgVersion ?? "",
        database: (r.controlTotals as ControlTotals).database,
        controlTotals: r.controlTotals as ControlTotals,
      };
  }
  steps.push({ name: "Archivo de control", ok: !!manifest, detail: manifest ? `${manifest.kind}, app ${manifest.appVersion}, esquema ${manifest.schemaVersion}, PostgreSQL ${manifest.pgVersion}` : "No se encontró el .json del backup ni su registro" });
  if (!manifest) return { manifest, steps };
  try {
    const [sha, { size }] = await Promise.all([sha256File(file), stat(file)]);
    steps.push({ name: "SHA-256", ok: sha === manifest.sha256 && size === manifest.sizeBytes, detail: sha === manifest.sha256 ? `${sha} (${size} bytes)` : `esperado ${manifest.sha256}, archivo ${sha}` });
  } catch (e) {
    steps.push({ name: "SHA-256", ok: false, detail: errorText(e) });
    return { manifest, steps };
  }
  try {
    const { stdout } = await run(pgBin(cfg, "pg_restore"), ["--list", file]);
    steps.push({ name: "pg_restore --list", ok: true, detail: `${stdout.split("\n").filter((l) => l && !l.startsWith(";")).length} objetos` });
  } catch (e) {
    steps.push({ name: "pg_restore --list", ok: false, detail: errorText(e) });
  }
  return { manifest, steps };
}

/** Crea una base vacía con los mismos ajustes que bootstrap y restaura el archivo en ella. */
async function restoreInto(adminUrl: string, dbName: string, file: string, cfg: BackupConfig): Promise<void> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${ident(dbName)} WITH (FORCE)`);
    await bootstrapDatabase(admin, dbName, { ownerPassword: "", appPassword: "" });
  } finally {
    await admin.end();
  }
  await run(pgBin(cfg, "pg_restore"), ["--exit-on-error", "--dbname", dbName, file], { ...pgEnv(adminUrl), PGDATABASE: dbName });
}

async function totalsOf(url: string): Promise<ControlTotals> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const totals = await computeControlTotals(client);
    await client.query("COMMIT");
    return totals;
  } finally {
    await client.end();
  }
}

async function dropDatabase(adminUrl: string, dbName: string) {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${ident(dbName)} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

/**
 * Verificación (J.2-3): SHA-256, índice del archivo, restauración en una base temporal (erp_verify),
 * recálculo de totales de control e invariantes de G.14 y comparación con los guardados.
 * Si se pasa `appDb`, el resultado queda en backup_runs.verify_status y en la auditoría.
 */
export async function verifyBackup(opts: {
  file: string;
  adminUrl: string;
  appDb?: Db | null;
  actor: AuditActor;
  config?: BackupConfig;
  verifyDb?: string;
  keep?: boolean;
}): Promise<VerifyReport> {
  const cfg = opts.config ?? backupConfig();
  const verifyDb = ident(opts.verifyDb ?? "erp_verify");
  const { manifest, steps } = await checkFile(opts.file, cfg, opts.appDb ?? null);
  let differences: string[] = [];
  let restored: ControlTotals | null = null;
  if (manifest && steps.every((s) => s.ok)) {
    try {
      await restoreInto(opts.adminUrl, verifyDb, opts.file, cfg);
      steps.push({ name: `Restauración en ${verifyDb}`, ok: true, detail: "pg_restore sin errores" });
      restored = await totalsOf(withDatabase(opts.adminUrl, verifyDb));
      differences = compareControlTotals(manifest.controlTotals, restored);
      steps.push({
        name: "Totales de control e invariantes",
        ok: differences.length === 0,
        detail: differences.length
          ? `${differences.length} diferencia(s)`
          : `${Object.keys(restored.tables).length} tablas, ${Object.keys(restored.invariants).length} invariantes y cadena de auditoría idénticos`,
      });
    } catch (e) {
      steps.push({ name: `Restauración en ${verifyDb}`, ok: false, detail: errorText(e) });
    } finally {
      if (!opts.keep) await dropDatabase(opts.adminUrl, verifyDb).catch(() => undefined);
    }
  }
  const report: VerifyReport = { ok: steps.every((s) => s.ok) && steps.length >= 5, fileName: manifest?.fileName ?? path.basename(opts.file), steps, differences, restored };

  if (opts.appDb && manifest) {
    const appDb = opts.appDb;
    await appDb.transaction(async (tx) => {
      const updated = await tx
        .update(backupRuns)
        .set({ verifiedAt: new Date(), verifyStatus: report.ok ? "PASS" : "FAIL", verifyDetail: { steps, differences: differences.slice(0, 200) } })
        .where(and(eq(backupRuns.fileName, manifest.fileName), eq(backupRuns.sha256, manifest.sha256), eq(backupRuns.status, "OK")))
        .returning({ id: backupRuns.id });
      await recordAudit(tx, opts.actor, {
        module: "backup",
        action: "verify",
        entityType: "backup_run",
        entityId: updated[0]?.id ?? null,
        result: "SUCCESS",
        message: `Verificación ${report.ok ? "PASS" : "FAIL"} de ${manifest.fileName}`,
        after: { ok: report.ok, steps: steps.map((s) => ({ name: s.name, ok: s.ok })), differences: differences.length },
      });
    });
  }
  return report;
}

export interface RestoreResult {
  targetDb: string;
  previousDb: string | null;
  preRestore: BackupResult | null;
  report: VerifyReport;
}

/**
 * Restauración (J.2-4): modo mantenimiento → backup PRE_RESTORE de la base actual → restauración en una
 * base nueva → verificación contra los totales de control → intercambio de bases (la anterior se conserva
 * renombrada) → registro en auditoría → fin del modo mantenimiento. Si la verificación falla, la base
 * actual queda intacta.
 *
 * `appUrl` y `backupUrl` son las conexiones de la aplicación y de backup a la base `targetDb`.
 */
export async function restoreBackup(opts: {
  file: string;
  adminUrl: string;
  targetDb: string;
  appUrl: string;
  backupUrl: string;
  actor: AuditActor;
  config?: BackupConfig;
  now?: Date;
}): Promise<RestoreResult> {
  const cfg = { ...(opts.config ?? backupConfig()), backupUrl: opts.backupUrl };
  const target = ident(opts.targetDb);
  const stamp = localStamp(opts.now ?? new Date());
  const { manifest, steps } = await checkFile(opts.file, cfg, null);
  if (!manifest || !steps.every((s) => s.ok)) {
    throw new Error(`El archivo no pasó la verificación: ${steps.filter((s) => !s.ok).map((s) => `${s.name}: ${s.detail}`).join("; ") || "sin archivo de control"}`);
  }

  await writeFile(cfg.maintenanceFile, JSON.stringify({ since: new Date().toISOString(), reason: "restore", file: manifest.fileName }), { mode: 0o644 });
  try {
    const admin = new Client({ connectionString: opts.adminUrl });
    await admin.connect();
    let targetExists: boolean;
    try {
      targetExists = (await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [target])).rowCount === 1;
    } finally {
      await admin.end();
    }

    // 1. Backup del estado actual (no se restaura sin poder volver atrás).
    let preRestore: BackupResult | null = null;
    if (targetExists) {
      const pool = new Pool({ connectionString: opts.appUrl, max: 2 });
      try {
        preRestore = await createBackup(createDb(pool), opts.actor, { kind: "PRE_RESTORE", config: cfg });
      } finally {
        await pool.end();
      }
    }

    // 2. Restauración en una base nueva y verificación.
    const newDb = ident(`${target}_restore_${stamp}`.slice(0, 63));
    let restored: ControlTotals;
    try {
      await restoreInto(opts.adminUrl, newDb, opts.file, cfg);
      restored = await totalsOf(withDatabase(opts.adminUrl, newDb));
    } catch (e) {
      await dropDatabase(opts.adminUrl, newDb).catch(() => undefined);
      throw new Error(`La restauración falló y la base actual no se modificó: ${errorText(e)}`);
    }
    const differences = compareControlTotals(manifest.controlTotals, restored);
    steps.push({ name: `Restauración en ${newDb}`, ok: true, detail: "pg_restore sin errores" });
    steps.push({ name: "Totales de control e invariantes", ok: differences.length === 0, detail: differences.length ? `${differences.length} diferencia(s)` : "idénticos a los del backup" });
    if (differences.length) {
      await dropDatabase(opts.adminUrl, newDb).catch(() => undefined);
      throw new Error(`La base restaurada no coincide con los totales de control (la base actual no se modificó): ${differences.slice(0, 5).join("; ")}`);
    }

    // 3. Intercambio: la base actual se conserva renombrada.
    const previousDb = targetExists ? ident(`${target}_prev_${stamp}`.slice(0, 63)) : null;
    const swap = new Client({ connectionString: opts.adminUrl });
    await swap.connect();
    try {
      if (previousDb) {
        await swap.query(`ALTER DATABASE ${target} WITH ALLOW_CONNECTIONS false`);
        await swap.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [target]);
        await swap.query(`ALTER DATABASE ${target} RENAME TO ${previousDb}`);
        await swap.query(`ALTER DATABASE ${previousDb} WITH ALLOW_CONNECTIONS true`);
      }
      await swap.query(`ALTER DATABASE ${newDb} RENAME TO ${target}`);
    } finally {
      await swap.end();
    }

    // 4. Registro en la base restaurada: el backup previo (su registro quedó en la base anterior) y la restauración.
    const pool = new Pool({ connectionString: opts.appUrl, max: 1 });
    try {
      const db = createDb(pool);
      await db.transaction(async (tx) => {
        // El archivo se tomó mientras su propio registro estaba "en curso": se completa con los datos del backup.
        await tx
          .update(backupRuns)
          .set({
            status: "OK",
            finishedAt: new Date(manifest.finishedAt),
            fileName: manifest.fileName,
            sizeBytes: manifest.sizeBytes,
            sha256: manifest.sha256,
            schemaVersion: manifest.schemaVersion,
            pgVersion: manifest.pgVersion,
            controlTotals: manifest.controlTotals,
          })
          .where(and(eq(backupRuns.id, manifest.runId), eq(backupRuns.status, "RUNNING")));
        let preRestoreId: number | null = null;
        if (preRestore) {
          const [row] = await tx
            .insert(backupRuns)
            .values({
              kind: "PRE_RESTORE",
              status: "OK",
              startedAt: preRestore.startedAt,
              finishedAt: preRestore.finishedAt,
              fileName: preRestore.fileName,
              sizeBytes: preRestore.sizeBytes,
              sha256: preRestore.sha256,
              appVersion: APP_VERSION,
              schemaVersion: preRestore.controlTotals.schemaVersion,
              pgVersion: preRestore.pgVersion,
              controlTotals: preRestore.controlTotals,
              offsiteStatus: preRestore.offsiteStatus,
              offsiteError: preRestore.offsiteError,
              createdBy: opts.actor.userId ?? null,
            })
            .returning({ id: backupRuns.id });
          preRestoreId = row!.id;
        }
        await recordAudit(tx, opts.actor, {
          module: "backup",
          action: "restore",
          entityType: "backup_run",
          entityId: preRestoreId,
          result: "SUCCESS",
          message: `Restaurado ${manifest.fileName}${previousDb ? `; la base anterior quedó como ${previousDb}` : ""}`,
          after: { file: manifest.fileName, sha256: manifest.sha256, previousDb, preRestoreBackup: preRestore?.fileName ?? null },
        });
      });
    } finally {
      await pool.end();
    }
    return { targetDb: target, previousDb, preRestore, report: { ok: true, fileName: manifest.fileName, steps, differences: [], restored } };
  } finally {
    await rm(cfg.maintenanceFile, { force: true });
  }
}
