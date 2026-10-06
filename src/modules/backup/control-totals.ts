import { randomUUID } from "node:crypto";
import type { ClientBase } from "pg";
import { ALL_PERMISSIONS } from "@/modules/auth/permissions";
import { evaluateInvariants } from "@/modules/consistency/service";
import type { ServiceContext } from "@/server/context";
import { createDb } from "@/server/db/drizzle";
import journal from "../../../database/migrations/meta/_journal.json";

/**
 * Totales de control (J.1): filas por tabla, sumas clave, saldo de cada caja y cuenta, cartera de cheques,
 * último hash de auditoría y resultado de los invariantes de G.14. Se calculan en la misma instantánea que
 * el pg_dump y se recalculan sobre la base restaurada: deben coincidir exactamente.
 */
export interface ControlTotals {
  version: 1;
  database: string;
  schemaVersion: string;
  tables: Record<string, number>;
  sums: Record<string, string>;
  treasury: Record<string, string>;
  checks: Record<string, string>;
  audit: { count: number; lastId: number | null; lastHash: string | null; chainBrokenAt: number | null };
  invariants: Record<string, { ok: boolean; failures: number; difference: string | null }>;
}

/** Contexto de solo lectura para recalcular invariantes fuera de una sesión (backup y verificación). */
function systemReader(): ServiceContext {
  return { userId: 0, username: "sistema", requestId: randomUUID(), permissions: new Set(ALL_PERMISSIONS) };
}

/** Versión del esquema = última migración aplicada (p. ej. "0004_backup_offsite"). */
export async function schemaVersionOf(client: ClientBase): Promise<string> {
  const { rows } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");
  const n = rows[0]?.n ?? 0;
  return journal.entries.find((e) => e.idx === n - 1)?.tag ?? String(n - 1).padStart(4, "0");
}

/** Debe llamarse dentro de una transacción REPEATABLE READ para que todo salga de la misma instantánea. */
export async function computeControlTotals(client: ClientBase): Promise<ControlTotals> {
  const { rows: tableRows } = await client.query<{ name: string }>(`
    SELECT table_schema || '.' || table_name AS name FROM information_schema.tables
     WHERE table_schema IN ('public', 'drizzle') AND table_type = 'BASE TABLE' ORDER BY 1`);
  const tables: Record<string, number> = {};
  if (tableRows.length) {
    const { rows } = await client.query<{ name: string; n: number }>(
      tableRows.map((t) => `SELECT '${t.name}' AS name, count(*)::int AS n FROM ${t.name.split(".").map((p) => `"${p}"`).join(".")}`).join(" UNION ALL "),
    );
    for (const r of rows) tables[r.name] = r.n;
  }

  const { rows: sumRows } = await client.query<Record<string, string>>(`
    SELECT
      (SELECT coalesce(sum(CASE WHEN t.class IN ('CREDIT_NOTE','OPENING_CREDIT') THEN -d.total ELSE d.total END), 0)
         FROM documents d JOIN document_types t ON t.id = d.document_type_id WHERE d.status <> 'ANNULLED' AND d.direction = 'ISSUED')::numeric(18,2)::text AS documents_issued,
      (SELECT coalesce(sum(CASE WHEN t.class IN ('CREDIT_NOTE','OPENING_CREDIT') THEN -d.total ELSE d.total END), 0)
         FROM documents d JOIN document_types t ON t.id = d.document_type_id WHERE d.status <> 'ANNULLED' AND d.direction = 'RECEIVED')::numeric(18,2)::text AS documents_received,
      (SELECT coalesce(sum(d.balance), 0) FROM documents d WHERE d.status <> 'ANNULLED')::numeric(18,2)::text AS documents_open_balance,
      (SELECT coalesce(sum(debit - credit), 0) FROM customer_account_entries)::numeric(18,2)::text AS customer_accounts,
      (SELECT coalesce(sum(debit - credit), 0) FROM supplier_account_entries)::numeric(18,2)::text AS supplier_accounts,
      (SELECT coalesce(sum(total_amount), 0) FROM collections WHERE status = 'ACTIVE')::numeric(18,2)::text AS collections,
      (SELECT coalesce(sum(total_amount), 0) FROM supplier_payments WHERE status = 'ACTIVE')::numeric(18,2)::text AS payments,
      (SELECT coalesce(sum(amount), 0) FROM allocations WHERE status = 'ACTIVE')::numeric(18,2)::text AS allocations,
      (SELECT coalesce(sum(amount), 0) FROM refunds WHERE status = 'ACTIVE')::numeric(18,2)::text AS refunds,
      (SELECT coalesce(sum(CASE WHEN direction = 'IN' THEN amount ELSE -amount END), 0) FROM treasury_movements)::numeric(18,2)::text AS treasury_liquid`);

  const { rows: accounts } = await client.query<{ k: string; v: string }>(`
    SELECT account_kind || ':' || coalesce(cash_box_id, bank_account_id) AS k,
           sum(CASE WHEN direction = 'IN' THEN amount ELSE -amount END)::numeric(18,2)::text AS v
      FROM treasury_movements GROUP BY 1 ORDER BY 1`);
  const { rows: checks } = await client.query<{ k: string; v: string }>(`
    SELECT 'received:' || status AS k, sum(amount)::numeric(18,2)::text AS v FROM received_checks GROUP BY status
    UNION ALL
    SELECT 'issued:' || status, sum(amount)::numeric(18,2)::text FROM issued_checks GROUP BY status
    ORDER BY 1`);
  const { rows: audit } = await client.query<{ count: number; last_id: string | null; last_hash: string | null; broken: string | null }>(`
    SELECT (SELECT count(*)::int FROM audit_log) AS count, last.id::text AS last_id, last.hash AS last_hash, erp_verify_audit_chain()::text AS broken
      FROM (SELECT 1) one LEFT JOIN LATERAL (SELECT id, hash FROM audit_log ORDER BY id DESC LIMIT 1) last ON true`);
  const { rows: dbRow } = await client.query<{ name: string }>("SELECT current_database() AS name");

  const invariants = await evaluateInvariants(createDb(client as never), systemReader());
  const a = audit[0]!;
  return {
    version: 1,
    database: dbRow[0]!.name,
    schemaVersion: await schemaVersionOf(client),
    tables,
    sums: sumRows[0]!,
    treasury: Object.fromEntries(accounts.map((r) => [r.k, r.v])),
    checks: Object.fromEntries(checks.map((r) => [r.k, r.v])),
    audit: { count: a.count, lastId: a.last_id ? Number(a.last_id) : null, lastHash: a.last_hash, chainBrokenAt: a.broken ? Number(a.broken) : null },
    invariants: Object.fromEntries(invariants.map((r) => [r.code, { ok: r.ok, failures: r.failures, difference: r.difference }])),
  };
}

/** Diferencias entre los totales guardados con el backup y los recalculados (vacío = coinciden). */
export function compareControlTotals(expected: ControlTotals, actual: ControlTotals): string[] {
  const out: string[] = [];
  const section = (name: string, a: Record<string, unknown>, b: Record<string, unknown>) => {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const x = JSON.stringify(a[key] ?? null);
      const y = JSON.stringify(b[key] ?? null);
      if (x !== y) out.push(`${name} ${key}: backup ${x}, restaurado ${y}`);
    }
  };
  if (expected.schemaVersion !== actual.schemaVersion) out.push(`Versión de esquema: backup ${expected.schemaVersion}, restaurado ${actual.schemaVersion}`);
  section("Filas de", expected.tables, actual.tables);
  section("Suma", expected.sums, actual.sums);
  section("Saldo de", expected.treasury, actual.treasury);
  section("Cheques", expected.checks, actual.checks);
  section("Auditoría", expected.audit, actual.audit);
  section("Invariante", expected.invariants, actual.invariants);
  return out;
}
