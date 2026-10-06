import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { id, ref, tstz } from "./_common";

/**
 * Registro de auditoría. Append-only: el rol de la aplicación solo tiene INSERT/SELECT,
 * un trigger impide UPDATE/DELETE y cada fila se encadena con un hash SHA-256 (prev_hash → hash).
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    occurredAt: tstz().notNull().defaultNow(),
    userId: ref(),
    username: text(),
    sessionId: ref(),
    ip: text(),
    userAgent: text(),
    requestId: text(),
    module: text().notNull(),
    action: text().notNull(),
    entityType: text(),
    entityId: text(),
    before: jsonb(),
    after: jsonb(),
    result: text().notNull(),
    message: text(),
    /** Los calcula el trigger de la base; la aplicación no los envía. */
    prevHash: text(),
    hash: text(),
  },
  (t) => [
    index("ix_audit_entity").on(t.entityType, t.entityId),
    index("ix_audit_user_time").on(t.userId, t.occurredAt),
    index("ix_audit_module_time").on(t.module, t.occurredAt),
    check("ck_audit_result", sql`${t.result} IN ('SUCCESS','DENIED','ERROR')`),
  ],
);

export const backupRuns = pgTable(
  "backup_runs",
  {
    id: id(),
    kind: text().notNull(),
    startedAt: tstz().notNull().defaultNow(),
    finishedAt: tstz(),
    fileName: text(),
    sizeBytes: bigint({ mode: "number" }),
    sha256: text(),
    appVersion: text(),
    schemaVersion: text(),
    pgVersion: text(),
    controlTotals: jsonb(),
    status: text().notNull().default("RUNNING"),
    errorMessage: text(),
    verifiedAt: tstz(),
    verifyStatus: text(),
    verifyDetail: jsonb(),
    /** Copia cifrada fuera del servidor (D16). */
    offsiteFile: text(),
    offsiteStatus: text(),
    offsiteError: text(),
    /** Fecha en que la política de retención borró el archivo; el registro se conserva. */
    prunedAt: tstz(),
    createdBy: ref(),
  },
  (t) => [
    check("ck_backup_kind", sql`${t.kind} IN ('AUTO','MANUAL','PRE_RESTORE','PRE_MIGRATION')`),
    check("ck_backup_status", sql`${t.status} IN ('RUNNING','OK','FAILED')`),
    check("ck_backup_verify", sql`${t.verifyStatus} IS NULL OR ${t.verifyStatus} IN ('PASS','FAIL')`),
    check("ck_backup_offsite", sql`${t.offsiteStatus} IS NULL OR ${t.offsiteStatus} IN ('OK','FAILED','SKIPPED')`),
    index("ix_backup_runs_file").on(t.fileName),
  ],
);
