import { and, asc, count, desc, eq, gt, lt, sql, type SQL } from "drizzle-orm";
import { TIME_ZONE } from "@/lib/format";
import { assertPermission } from "@/server/authorization";
import type { ServiceContext } from "@/server/context";
import type { Db, DbOrTx } from "@/server/db/drizzle";
import { auditLog, users } from "@/server/db/schema";
import { AUDIT_PAGE_SIZE, type AuditQuery } from "./schemas";
import { recordAudit } from "./service";

/** Consulta de la auditoría (sección I): listado con filtros, detalle y verificación de la cadena de hashes. */

export type AuditEntry = typeof auditLog.$inferSelect;
export type AuditListRow = Pick<AuditEntry, "id" | "occurredAt" | "userId" | "username" | "module" | "action" | "entityType" | "entityId" | "result" | "message" | "ip">;

const likeArg = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function whereOf(q: AuditQuery): SQL | undefined {
  const conds: SQL[] = [];
  // Los días se interpretan en hora argentina; así la condición usa el índice por fecha.
  if (q.from) conds.push(sql`${auditLog.occurredAt} >= (${q.from}::date)::timestamp AT TIME ZONE ${TIME_ZONE}`);
  if (q.to) conds.push(sql`${auditLog.occurredAt} < (${q.to}::date + 1)::timestamp AT TIME ZONE ${TIME_ZONE}`);
  if (q.user) conds.push(eq(auditLog.userId, q.user));
  if (q.module) conds.push(eq(auditLog.module, q.module));
  if (q.action) conds.push(sql`(${auditLog.action} = ${q.action} OR ${auditLog.action} LIKE ${`%.${q.action}`})`);
  if (q.result) conds.push(eq(auditLog.result, q.result));
  if (q.entityType) conds.push(eq(auditLog.entityType, q.entityType));
  if (q.entityId) conds.push(eq(auditLog.entityId, q.entityId));
  if (q.q) {
    const p = likeArg(q.q);
    conds.push(
      sql`(${auditLog.username} ILIKE ${p} OR ${auditLog.message} ILIKE ${p} OR ${auditLog.action} ILIKE ${p} OR ${auditLog.entityId} = ${q.q}
           OR ${auditLog.ip} = ${q.q} OR ${auditLog.requestId} = ${q.q})`,
    );
  }
  return conds.length ? and(...conds) : undefined;
}

export async function listAuditLog(db: DbOrTx, ctx: ServiceContext, q: AuditQuery): Promise<{ rows: AuditListRow[]; total: number; page: number; pageSize: number }> {
  assertPermission(ctx, "audit.read");
  const where = whereOf(q);
  const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(auditLog).where(where);
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const page = Math.min(q.page, pages);
  const rows = await db
    .select({
      id: auditLog.id,
      occurredAt: auditLog.occurredAt,
      userId: auditLog.userId,
      username: auditLog.username,
      module: auditLog.module,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      result: auditLog.result,
      message: auditLog.message,
      ip: auditLog.ip,
    })
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.id))
    .limit(AUDIT_PAGE_SIZE)
    .offset((page - 1) * AUDIT_PAGE_SIZE);
  return { rows, total, page, pageSize: AUDIT_PAGE_SIZE };
}

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/**
 * Campos que cambiaron según before/after. En altas solo hay `after` y en bajas o anulaciones puede
 * haber solo `before`; si alguno no es un objeto, se muestra como un único valor.
 */
export function fieldChanges(before: unknown, after: unknown): FieldChange[] {
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if ((before != null && !isObj(before)) || (after != null && !isObj(after))) return [{ field: "(valor)", before: before ?? null, after: after ?? null }];
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys.map((field) => ({ field, before: field in b ? b[field] : undefined, after: field in a ? a[field] : undefined }));
}

export async function getAuditEntry(
  db: DbOrTx,
  ctx: ServiceContext,
  id: number,
): Promise<{ entry: AuditEntry; userFullName: string | null; previousId: number | null; nextId: number | null } | null> {
  assertPermission(ctx, "audit.read");
  const [entry] = await db.select().from(auditLog).where(eq(auditLog.id, id));
  if (!entry) return null;
  const [[prev], [next], [user]] = await Promise.all([
    db.select({ id: auditLog.id }).from(auditLog).where(lt(auditLog.id, id)).orderBy(desc(auditLog.id)).limit(1),
    db.select({ id: auditLog.id }).from(auditLog).where(gt(auditLog.id, id)).orderBy(asc(auditLog.id)).limit(1),
    entry.userId ? db.select({ fullName: users.fullName }).from(users).where(eq(users.id, entry.userId)) : Promise.resolve([]),
  ]);
  return { entry, userFullName: user?.fullName ?? null, previousId: prev?.id ?? null, nextId: next?.id ?? null };
}

export async function auditFilterOptions(db: DbOrTx, ctx: ServiceContext) {
  assertPermission(ctx, "audit.read");
  const [userRows, modules, entityTypes] = await Promise.all([
    db.select({ id: users.id, username: users.username, fullName: users.fullName }).from(users).orderBy(asc(users.username)),
    db.execute<{ module: string }>(sql`SELECT DISTINCT module FROM audit_log ORDER BY module`),
    db.execute<{ entity_type: string }>(sql`SELECT DISTINCT entity_type FROM audit_log WHERE entity_type IS NOT NULL ORDER BY entity_type`),
  ]);
  return { users: userRows, modules: modules.rows.map((r) => r.module), entityTypes: entityTypes.rows.map((r) => r.entity_type) };
}

export interface ChainVerification {
  ok: boolean;
  verifiedAt: Date;
  total: number;
  lastId: number | null;
  lastHash: string | null;
  /** Primer eslabón alterado (su hash o el enlace con el anterior no coinciden). */
  brokenAt: Pick<AuditEntry, "id" | "occurredAt" | "username" | "module" | "action"> | null;
  backupsChecked: number;
  /** Backups cuyo último hash de auditoría ya no coincide con el registro actual (reescritura de la cadena). */
  backupMismatches: { backupId: number; fileName: string | null; finishedAt: Date | null; auditId: number }[];
}

/**
 * "Verificar integridad": recorre la cadena de hashes y además compara el último hash guardado con cada
 * backup contra el registro actual. Esto último detecta una reescritura completa de la cadena desde ese punto,
 * que la cadena sola no puede detectar. La verificación queda auditada.
 */
export async function verifyAuditChain(db: Db, ctx: ServiceContext): Promise<ChainVerification> {
  assertPermission(ctx, "audit.read");
  const result = await db.transaction(
    async (tx) => {
      const { rows } = await tx.execute<{ total: number; last_id: string | null; last_hash: string | null; broken: string | null }>(sql`
        SELECT (SELECT count(*)::int FROM audit_log) AS total,
               last.id::text AS last_id, last.hash AS last_hash, erp_verify_audit_chain()::text AS broken
          FROM (SELECT 1) one LEFT JOIN LATERAL (SELECT id, hash FROM audit_log ORDER BY id DESC LIMIT 1) last ON true`);
      const c = rows[0]!;
      const brokenId = c.broken ? Number(c.broken) : null;
      const [brokenAt] = brokenId
        ? await tx
            .select({ id: auditLog.id, occurredAt: auditLog.occurredAt, username: auditLog.username, module: auditLog.module, action: auditLog.action })
            .from(auditLog)
            .where(eq(auditLog.id, brokenId))
        : [];
      const { rows: backups } = await tx.execute<{ id: string; file_name: string | null; finished_at: Date | string | null; audit_id: string; stored: string; current: string | null }>(sql`
        SELECT b.id::text, b.file_name, b.finished_at, (b.control_totals #>> '{audit,lastId}') AS audit_id,
               b.control_totals #>> '{audit,lastHash}' AS stored, a.hash AS current
          FROM backup_runs b
          LEFT JOIN audit_log a ON a.id = (b.control_totals #>> '{audit,lastId}')::bigint
         WHERE b.status = 'OK' AND b.control_totals #>> '{audit,lastId}' IS NOT NULL
           -- El backup previo a una restauración se tomó de la base reemplazada: su auditoría es otra historia.
           AND b.file_name NOT IN (SELECT after ->> 'preRestoreBackup' FROM audit_log
                                    WHERE module = 'backup' AND action = 'restore' AND after ->> 'preRestoreBackup' IS NOT NULL)
         ORDER BY b.id`);
      return {
        total: c.total,
        lastId: c.last_id ? Number(c.last_id) : null,
        lastHash: c.last_hash,
        brokenAt: brokenAt ?? null,
        backupsChecked: backups.length,
        backupMismatches: backups
          .filter((b) => b.current !== b.stored)
          .map((b) => ({ backupId: Number(b.id), fileName: b.file_name, finishedAt: b.finished_at ? new Date(b.finished_at) : null, auditId: Number(b.audit_id) })),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  const ok = !result.brokenAt && result.backupMismatches.length === 0;
  await recordAudit(db, ctx, {
    module: "audit",
    action: "verify_chain",
    result: "SUCCESS",
    message: ok
      ? `Cadena íntegra: ${result.total} registros, ${result.backupsChecked} backups comparados`
      : [
          result.brokenAt && `La cadena se rompe en el registro #${result.brokenAt.id}`,
          result.backupMismatches.length && `${result.backupMismatches.length} backup(s) no coinciden con el registro actual`,
        ]
          .filter(Boolean)
          .join("; "),
    after: { ok, total: result.total, brokenAt: result.brokenAt?.id ?? null, backupMismatches: result.backupMismatches.map((m) => m.backupId) },
  });
  return { ...result, ok, verifiedAt: new Date() };
}
