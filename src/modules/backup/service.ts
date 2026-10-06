import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { Client } from "pg";
import { DomainError } from "@/lib/errors";
import { recordAudit, type AuditActor } from "@/modules/audit/service";
import { assertPermission } from "@/server/authorization";
import type { ServiceContext } from "@/server/context";
import type { Db, DbOrTx } from "@/server/db/drizzle";
import { backupRuns } from "@/server/db/schema";
import pkg from "../../../package.json";
import { backupConfig, type BackupConfig } from "./config";
import { computeControlTotals, type ControlTotals } from "./control-totals";
import { backupFileName, manifestPathOf, sha256File, writeManifest, type BackupKind, type BackupManifest } from "./files";
import { pgBin, pgEnv, run, toolMajorVersion } from "./pg-tools";
import { selectRetained } from "./retention";

/**
 * Backups (sección J): pg_dump en formato custom tomado de la misma instantánea que los totales de control,
 * registro en backup_runs, archivo de control .json, copia cifrada fuera del servidor y retención.
 * Este módulo no depende de Next: lo usan la pantalla de Backup, los scripts de consola y el cron.
 */

export const APP_VERSION: string = pkg.version;
export type BackupRun = typeof backupRuns.$inferSelect;

/** Un backup que quedó "en curso" más de este tiempo se considera interrumpido. */
const STALE_RUNNING_MS = 6 * 60 * 60 * 1000;

export interface BackupResult {
  id: number;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  sha256: string;
  startedAt: Date;
  finishedAt: Date;
  pgVersion: string;
  offsiteStatus: "OK" | "FAILED" | "SKIPPED";
  offsiteError: string | null;
  controlTotals: ControlTotals;
  pruned: string[];
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 1000);

export async function createBackup(appDb: Db, actor: AuditActor, opts: { kind: BackupKind; config?: BackupConfig }): Promise<BackupResult> {
  const cfg = opts.config ?? backupConfig();
  if (!cfg.backupUrl) throw new DomainError("Falta configurar DATABASE_BACKUP_URL (conexión de solo lectura del rol erp_backup) en el servidor.");
  try {
    await mkdir(cfg.dir, { recursive: true, mode: 0o700 });
  } catch (e) {
    throw new DomainError(`No se puede usar la carpeta de backups ${cfg.dir}: ${errorText(e)}`);
  }

  // Un solo backup a la vez; uno "en curso" desde hace horas quedó interrumpido.
  const started = await appDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('erp_backup_start'))`);
    await tx
      .update(backupRuns)
      .set({ status: "FAILED", finishedAt: new Date(), errorMessage: "Interrumpido: el proceso terminó sin registrar el resultado" })
      .where(and(eq(backupRuns.status, "RUNNING"), lt(backupRuns.startedAt, new Date(Date.now() - STALE_RUNNING_MS))));
    const [running] = await tx.select({ id: backupRuns.id }).from(backupRuns).where(eq(backupRuns.status, "RUNNING")).limit(1);
    if (running) throw new DomainError("Ya hay un backup en curso. Espere a que termine.");
    const [row] = await tx
      .insert(backupRuns)
      .values({ kind: opts.kind, status: "RUNNING", appVersion: APP_VERSION, createdBy: actor.userId ?? null })
      .returning({ id: backupRuns.id, startedAt: backupRuns.startedAt });
    return row!;
  });

  const client = new Client({ connectionString: cfg.backupUrl });
  let partial: string | null = null;
  try {
    await client.connect();
    // Instantánea compartida: los totales de control y pg_dump ven exactamente los mismos datos.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows } = await client.query<{ snapshot: string; version: string; num: number; db: string }>(
      "SELECT pg_export_snapshot() AS snapshot, current_setting('server_version') AS version, current_setting('server_version_num')::int AS num, current_database() AS db",
    );
    const info = rows[0]!;
    const serverMajor = Math.floor(info.num / 10000);
    const toolMajor = await toolMajorVersion(cfg, "pg_dump");
    if (toolMajor !== serverMajor) throw new Error(`pg_dump es versión ${toolMajor} y el servidor ${serverMajor}: deben tener la misma versión mayor`);
    const controlTotals = await computeControlTotals(client);
    // Nunca se pisa un backup existente (dos backups en el mismo segundo llevan un sufijo -2, -3…).
    const baseName = backupFileName(opts.kind, started.startedAt, APP_VERSION, controlTotals.schemaVersion);
    let fileName = baseName;
    for (let n = 2; existsSync(path.join(cfg.dir, fileName)); n++) fileName = baseName.replace(/\.dump$/, `-${n}.dump`);
    const filePath = path.join(cfg.dir, fileName);
    partial = `${filePath}.partial`;
    await run(pgBin(cfg, "pg_dump"), ["--format=custom", `--snapshot=${info.snapshot}`, `--file=${partial}`], pgEnv(cfg.backupUrl));
    await client.query("COMMIT");
    await rename(partial, filePath);
    partial = null;
    await chmod(filePath, 0o600);

    const [sha256, { size }] = await Promise.all([sha256File(filePath), stat(filePath)]);
    const finishedAt = new Date();
    const manifest: BackupManifest = {
      format: "erp-backup/1",
      runId: started.id,
      fileName,
      sha256,
      sizeBytes: size,
      kind: opts.kind,
      startedAt: started.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      appVersion: APP_VERSION,
      schemaVersion: controlTotals.schemaVersion,
      pgVersion: info.version,
      database: info.db,
      controlTotals,
    };
    await writeManifest(filePath, manifest);
    const offsite = await copyOffsite(cfg, filePath);

    await appDb.transaction(async (tx) => {
      await tx
        .update(backupRuns)
        .set({
          status: "OK",
          finishedAt,
          fileName,
          sizeBytes: size,
          sha256,
          schemaVersion: controlTotals.schemaVersion,
          pgVersion: info.version,
          controlTotals,
          offsiteFile: offsite.file,
          offsiteStatus: offsite.status,
          offsiteError: offsite.error,
        })
        .where(eq(backupRuns.id, started.id));
      await recordAudit(tx, actor, {
        module: "backup",
        action: "create",
        entityType: "backup_run",
        entityId: started.id,
        message: `Backup ${opts.kind} ${fileName}${offsite.status === "OK" ? " con copia externa cifrada" : offsite.status === "FAILED" ? ` (copia externa falló: ${offsite.error})` : ""}`,
        after: { kind: opts.kind, fileName, sizeBytes: size, sha256, schemaVersion: controlTotals.schemaVersion, offsite: offsite.status, auditLastId: controlTotals.audit.lastId },
      });
    });

    const pruned = opts.kind === "AUTO" ? await pruneBackups(appDb, actor, cfg) : [];
    return { id: started.id, fileName, filePath, sizeBytes: size, sha256, startedAt: started.startedAt, finishedAt, pgVersion: info.version, offsiteStatus: offsite.status, offsiteError: offsite.error, controlTotals, pruned };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (partial) await rm(partial, { force: true }).catch(() => undefined);
    const message = errorText(e);
    await appDb
      .transaction(async (tx) => {
        await tx.update(backupRuns).set({ status: "FAILED", finishedAt: new Date(), errorMessage: message }).where(eq(backupRuns.id, started.id));
        await recordAudit(tx, actor, { module: "backup", action: "create", entityType: "backup_run", entityId: started.id, result: "ERROR", message: `Backup ${opts.kind} fallido: ${message}` });
      })
      .catch((err) => console.error("[backup] no se pudo registrar el fallo", err));
    throw e instanceof DomainError ? e : new DomainError(`El backup falló: ${message}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Copia fuera del servidor: siempre cifrada con age (clave pública en el servidor, privada fuera). */
async function copyOffsite(cfg: BackupConfig, filePath: string): Promise<{ status: "OK" | "FAILED" | "SKIPPED"; file: string | null; error: string | null }> {
  if (!cfg.offsiteDir) return { status: "SKIPPED", file: null, error: null };
  if (!cfg.ageRecipient) return { status: "FAILED", file: null, error: "Falta BACKUP_AGE_RECIPIENT: la copia externa no se hace sin cifrar" };
  const target = path.join(cfg.offsiteDir, `${path.basename(filePath)}.age`);
  try {
    await mkdir(cfg.offsiteDir, { recursive: true, mode: 0o700 });
    await run("age", ["--encrypt", "--recipient", cfg.ageRecipient, "--output", `${target}.partial`, filePath]);
    await rename(`${target}.partial`, target);
    // El archivo de control no tiene credenciales; viaja sin cifrar para poder identificar la copia.
    await copyFile(manifestPathOf(filePath), `${target}.json`);
    return { status: "OK", file: path.basename(target), error: null };
  } catch (e) {
    await rm(`${target}.partial`, { force: true }).catch(() => undefined);
    return { status: "FAILED", file: null, error: errorText(e) };
  }
}

/** Aplica la retención: borra los archivos (local y externo) de los backups que no conserva; el registro queda. */
export async function pruneBackups(appDb: Db, actor: AuditActor, cfg: BackupConfig = backupConfig(), now: Date = new Date()): Promise<string[]> {
  const runs = await appDb
    .select({ id: backupRuns.id, kind: backupRuns.kind, finishedAt: backupRuns.finishedAt, fileName: backupRuns.fileName, offsiteFile: backupRuns.offsiteFile })
    .from(backupRuns)
    .where(and(eq(backupRuns.status, "OK"), isNull(backupRuns.prunedAt), isNotNull(backupRuns.finishedAt), lt(backupRuns.finishedAt, now)))
    .orderBy(asc(backupRuns.id));
  const keep = selectRetained(
    runs.map((r) => ({ id: r.id, kind: r.kind, finishedAt: r.finishedAt! })),
    cfg.retention,
  );
  const pruned: string[] = [];
  for (const r of runs) {
    if (keep.has(r.id) || !r.fileName) continue;
    const files = [path.join(cfg.dir, r.fileName), manifestPathOf(path.join(cfg.dir, r.fileName))];
    if (cfg.offsiteDir && r.offsiteFile) files.push(path.join(cfg.offsiteDir, r.offsiteFile), `${path.join(cfg.offsiteDir, r.offsiteFile)}.json`);
    for (const f of files) await rm(f, { force: true });
    await appDb.update(backupRuns).set({ prunedAt: now }).where(eq(backupRuns.id, r.id));
    pruned.push(r.fileName);
  }
  if (pruned.length) {
    await recordAudit(appDb, actor, {
      module: "backup",
      action: "prune",
      message: `Retención ${cfg.retention.daily}/${cfg.retention.weekly}/${cfg.retention.monthly}: ${pruned.length} backup(s) borrados`,
      after: { files: pruned },
    });
  }
  return pruned;
}

export interface BackupListing {
  runs: (BackupRun & { localExists: boolean; offsiteExists: boolean | null })[];
  config: { dir: string; offsiteDir: string | null; encrypted: boolean; configured: boolean; retention: BackupConfig["retention"] };
  /** Archivos presentes en las carpetas que no figuran en esta base (por ejemplo, de antes de una restauración). */
  unregistered: { local: string[]; offsite: string[] };
  dirErrors: string[];
}

export async function listBackups(appDb: Db, ctx: ServiceContext, cfg: BackupConfig = backupConfig()): Promise<BackupListing> {
  assertPermission(ctx, "backup.run");
  const runs = await appDb.select().from(backupRuns).orderBy(desc(backupRuns.id)).limit(200);
  const dirErrors: string[] = [];
  const list = async (dir: string | null, suffix: string) => {
    if (!dir) return [];
    try {
      return (await readdir(dir)).filter((f) => f.endsWith(suffix)).sort().reverse();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") dirErrors.push(`${dir}: ${errorText(e)}`);
      return [];
    }
  };
  const [local, offsite] = await Promise.all([list(cfg.dir, ".dump"), list(cfg.offsiteDir, ".dump.age")]);
  const registered = new Set(runs.map((r) => r.fileName));
  const registeredOffsite = new Set(runs.map((r) => r.offsiteFile));
  return {
    runs: runs.map((r) => ({
      ...r,
      localExists: !!r.fileName && existsSync(path.join(cfg.dir, r.fileName)),
      offsiteExists: cfg.offsiteDir && r.offsiteFile ? existsSync(path.join(cfg.offsiteDir, r.offsiteFile)) : null,
    })),
    config: { dir: cfg.dir, offsiteDir: cfg.offsiteDir, encrypted: !!cfg.ageRecipient, configured: !!cfg.backupUrl, retention: cfg.retention },
    unregistered: { local: local.filter((f) => !registered.has(f)), offsite: offsite.filter((f) => !registeredOffsite.has(f)) },
    dirErrors,
  };
}

/** Alertas de backup para el dashboard del administrador. */
export async function backupAlerts(appDb: DbOrTx, ctx: ServiceContext, now: Date = new Date()): Promise<string[]> {
  assertPermission(ctx, "backup.run");
  const at = now.toISOString();
  const { rows } = await appDb.execute<{ ok_hours: number | null; last_status: string | null; last_error: string | null; last_verify: string | null; last_verify_file: string | null; pass_hours: number | null }>(sql`
    SELECT (SELECT extract(epoch FROM ${at}::timestamptz - max(finished_at)) / 3600 FROM backup_runs WHERE status = 'OK')::float8 AS ok_hours,
           l.status AS last_status, l.error_message AS last_error,
           v.verify_status AS last_verify, v.file_name AS last_verify_file,
           (SELECT extract(epoch FROM ${at}::timestamptz - max(verified_at)) / 3600 FROM backup_runs WHERE verify_status = 'PASS')::float8 AS pass_hours
      FROM (SELECT 1) one
      LEFT JOIN LATERAL (SELECT status, error_message FROM backup_runs WHERE status <> 'RUNNING' ORDER BY id DESC LIMIT 1) l ON true
      LEFT JOIN LATERAL (SELECT verify_status, file_name FROM backup_runs WHERE verified_at IS NOT NULL ORDER BY verified_at DESC LIMIT 1) v ON true`);
  const r = rows[0]!;
  const alerts: string[] = [];
  if (r.ok_hours == null) alerts.push("Todavía no hay ningún backup correcto.");
  else if (r.ok_hours > 36) alerts.push(`El último backup correcto es de hace ${Math.floor(r.ok_hours / 24)} día(s).`);
  if (r.last_status === "FAILED") alerts.push(`El último backup falló: ${r.last_error ?? "sin detalle"}.`);
  if (r.last_verify === "FAIL") alerts.push(`La última verificación de backup dio FAIL (${r.last_verify_file}).`);
  if (r.pass_hours == null || r.pass_hours > 8 * 24) alerts.push("No hay una verificación de backup en PASS en los últimos 8 días.");
  return alerts;
}
