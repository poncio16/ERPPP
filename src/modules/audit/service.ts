import type { DbOrTx } from "@/server/db/drizzle";
import { auditLog } from "@/server/db/schema";
import type { RequestMeta } from "@/server/context";

export type AuditResult = "SUCCESS" | "DENIED" | "ERROR";

export interface AuditEvent {
  module: string;
  action: string;
  entityType?: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  result?: AuditResult;
  message?: string;
}

export interface AuditActor extends RequestMeta {
  userId?: number | null;
  username?: string | null;
  sessionId?: number | null;
}

/**
 * Registra un evento de auditoría. Se llama con la MISMA transacción de la operación auditada:
 * si la operación se revierte, su auditoría también. El hash encadenado lo calcula la base.
 */
export async function recordAudit(db: DbOrTx, actor: AuditActor, event: AuditEvent): Promise<void> {
  await db.insert(auditLog).values({
    userId: actor.userId ?? null,
    username: actor.username ?? null,
    sessionId: actor.sessionId ?? null,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent?.slice(0, 500) ?? null,
    requestId: actor.requestId,
    module: event.module,
    action: event.action,
    entityType: event.entityType ?? null,
    entityId: event.entityId == null ? null : String(event.entityId),
    before: event.before ?? null,
    after: event.after ?? null,
    result: event.result ?? "SUCCESS",
    message: event.message ?? null,
  });
}

/** Campos que cambiaron entre dos versiones de un registro (para before/after compactos). */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  ignore: string[] = ["updatedAt", "updatedBy", "version"],
): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (ignore.includes(key as string)) continue;
    if (JSON.stringify(normalize(before[key])) !== JSON.stringify(normalize(after[key]))) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}

const normalize = (v: unknown) => (v instanceof Date ? v.toISOString() : (v ?? null));
