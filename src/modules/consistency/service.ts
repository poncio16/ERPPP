import Decimal from "decimal.js";
import { sql, type SQL } from "drizzle-orm";
import { todayIso } from "@/lib/format";
import { recordAudit } from "@/modules/audit/service";
import { reportReconciliation } from "@/modules/reports/reconciliation";
import { assertPermission } from "@/server/authorization";
import type { ServiceContext } from "@/server/context";
import type { Db, DbOrTx } from "@/server/db/drizzle";

/**
 * Verificación de consistencia (G.14). Cada invariante se recalcula desde las tablas de origen y
 * debe dar diferencia $0,00. Las consultas son de solo lectura; el resultado queda auditado.
 */

export interface InvariantResult {
  code: string;
  title: string;
  description: string;
  ok: boolean;
  /** Registros que no cumplen. */
  failures: number;
  /** Suma de las diferencias en valor absoluto, cuando el invariante es monetario. */
  difference: string | null;
  /** Hasta 20 casos, para ubicarlos. */
  samples: string[];
}

const SAMPLE_LIMIT = 20;

type Row = { label: string; diff: string | null };

async function check(db: DbOrTx, def: { code: string; title: string; description: string; monetary: boolean; query: SQL }): Promise<InvariantResult> {
  const { rows } = await db.execute<Row>(def.query);
  const difference = def.monetary ? rows.reduce((a, r) => a.plus(new Decimal(r.diff ?? 0).abs()), new Decimal(0)) : null;
  return {
    code: def.code,
    title: def.title,
    description: def.description,
    ok: rows.length === 0,
    failures: rows.length,
    difference: difference ? difference.toFixed(2) : null,
    samples: rows.slice(0, SAMPLE_LIMIT).map((r) => r.label),
  };
}

/** Importe con formato argentino (1.234,56) armado en SQL, con independencia del locale del servidor. */
const money = (col: string) => sql.raw(`translate(to_char(${col}, 'FM999999999999990.00'), '.', ',')`);
const docLabel = sql.raw(`t.name || ' ' || lpad(d.point_of_sale::text, 5, '0') || '-' || lpad(d.number::text, 8, '0')`);

function partyInvariant(side: "AR" | "AP") {
  const ar = side === "AR";
  const party = sql.raw(ar ? "clients" : "suppliers");
  const partyCol = sql.raw(ar ? "client_id" : "supplier_id");
  const ledger = sql.raw(ar ? "customer_accounts" : "supplier_accounts");
  const ops = sql.raw(ar ? "collections" : "supplier_payments");
  return sql`
    WITH x AS (
      SELECT p.id, p.legal_name,
             coalesce(l.balance, 0)::numeric(18,2) AS ledger,
             (coalesce((SELECT sum(CASE WHEN t.class IN ('CREDIT_NOTE','OPENING_CREDIT') THEN -d.balance ELSE d.balance END)
                          FROM documents d JOIN document_types t ON t.id = d.document_type_id
                         WHERE d.${partyCol} = p.id AND d.status <> 'ANNULLED'), 0)
              - coalesce((SELECT sum(o.unapplied_amount) FROM ${ops} o WHERE o.${partyCol} = p.id AND o.status = 'ACTIVE'), 0))::numeric(18,2) AS comp
        FROM ${party} p LEFT JOIN ${ledger} l ON l.${partyCol} = p.id
    )
    SELECT legal_name || ': cuenta corriente ' || ${money("ledger")} || ' y composición ' || ${money("comp")} AS label, (ledger - comp)::text AS diff
      FROM x WHERE ledger <> comp ORDER BY id`;
}

export async function runConsistencyCheck(db: Db, ctx: ServiceContext): Promise<{ results: InvariantResult[]; ranAt: Date; ok: boolean }> {
  assertPermission(ctx, "consistency.run");
  const results = await db.transaction(
    async (tx) => {
      const out: InvariantResult[] = [];
      for (const side of ["AR", "AP"] as const) {
        out.push(
          await check(tx, {
            code: `G14-1 ${side === "AR" ? "clientes" : "proveedores"}`,
            title: `Saldo de cuenta corriente de ${side === "AR" ? "clientes" : "proveedores"}`,
            description: "Saldo del libro = Σ saldos de comprobantes deudores − Σ créditos sin aplicar (NC y operaciones con saldo).",
            monetary: true,
            query: partyInvariant(side),
          }),
        );
      }
      out.push(
        await check(tx, {
          code: "G14-2",
          title: "Saldo y estado de cada comprobante",
          description: "Saldo = total − Σ imputaciones activas; el estado corresponde al saldo; un anulado tiene saldo cero.",
          monetary: true,
          query: sql`
            WITH x AS (
              SELECT d.id, ${docLabel} AS label, d.total, d.balance, d.status,
                     t.class IN ('CREDIT_NOTE','OPENING_CREDIT') AS is_credit,
                     coalesce((SELECT sum(a.amount) FROM allocations a WHERE a.status = 'ACTIVE' AND a.target_document_id = d.id), 0) AS as_target,
                     coalesce((SELECT sum(a.amount) FROM allocations a WHERE a.status = 'ACTIVE' AND a.source_document_id = d.id), 0) AS as_source
                FROM documents d JOIN document_types t ON t.id = d.document_type_id
            ), y AS (
              SELECT *, CASE WHEN status = 'ANNULLED' THEN 0 WHEN is_credit THEN total - as_source ELSE total - as_target END AS expected
                FROM x
            )
            SELECT label || ': saldo ' || ${money("balance")} || ', esperado ' || ${money("expected")} || ' (' || status || ')' AS label,
                   (balance - expected)::text AS diff
              FROM y
             WHERE balance <> expected
                OR (status <> 'ANNULLED' AND status <> CASE WHEN balance = 0 THEN 'SETTLED' WHEN balance = total THEN 'OPEN' ELSE 'PARTIAL' END)
                OR (is_credit AND as_target > 0) OR (NOT is_credit AND as_source > 0)
                OR (status = 'ANNULLED' AND (as_target > 0 OR as_source > 0))
             ORDER BY id`,
        }),
      );
      for (const side of ["AR", "AP"] as const) {
        const ar = side === "AR";
        const ops = sql.raw(ar ? "collections" : "supplier_payments");
        const lines = sql.raw(ar ? "collection_lines" : "payment_lines");
        const fk = sql.raw(ar ? "collection_id" : "payment_id");
        const src = sql.raw(ar ? "source_collection_id" : "source_payment_id");
        const name = ar ? "Cobranza" : "Pago";
        out.push(
          await check(tx, {
            code: `G14-3 ${ar ? "cobranzas" : "pagos"}`,
            title: `Saldo sin imputar y total de ${ar ? "cobranzas" : "pagos"}`,
            description: "Sin imputar = total − Σ imputaciones activas (cero si está anulada); total = Σ medios.",
            monetary: true,
            query: sql`
              WITH x AS (
                SELECT o.id, o.status, o.total_amount AS total, o.unapplied_amount AS unapplied,
                       coalesce((SELECT sum(l.amount) FROM ${lines} l WHERE l.${fk} = o.id), 0) AS lines,
                       coalesce((SELECT sum(a.amount) FROM allocations a WHERE a.status = 'ACTIVE' AND a.${src} = o.id), 0) AS allocated
                  FROM ${ops} o
              ), y AS (SELECT *, CASE WHEN status = 'ACTIVE' THEN total - allocated ELSE 0 END AS expected FROM x)
              SELECT ${name} || ' #' || id || ': sin imputar ' || ${money("unapplied")} || ', esperado ' || ${money("expected")} || '; total ' || ${money("total")} || ', medios ' || ${money("lines")} AS label,
                     (abs(unapplied - expected) + abs(total - lines))::text AS diff
                FROM y WHERE unapplied <> expected OR total <> lines OR (status <> 'ACTIVE' AND allocated > 0)
               ORDER BY id`,
          }),
        );
        out.push(
          await check(tx, {
            code: `G14-4 ${ar ? "cobranzas" : "pagos"}`,
            title: `Movimientos de tesorería de ${ar ? "cobranzas" : "pagos"}`,
            description: "Cada medio en efectivo o transferencia tiene exactamente un movimiento; revertido solo si la operación está anulada.",
            monetary: false,
            query: sql`
              WITH x AS (
                SELECT l.id, l.${fk} AS op_id, o.status,
                       (SELECT count(*) FROM treasury_movements m WHERE m.${sql.raw(ar ? "collection_line_id" : "payment_line_id")} = l.id) AS movements,
                       (SELECT count(*) FROM treasury_movements r JOIN treasury_movements m ON r.reversal_of_id = m.id
                         WHERE m.${sql.raw(ar ? "collection_line_id" : "payment_line_id")} = l.id) AS reversals
                  FROM ${lines} l JOIN ${ops} o ON o.id = l.${fk}
                 WHERE l.method IN ('CASH','TRANSFER')
              )
              SELECT ${name} || ' #' || op_id || ', medio #' || id || ': ' || movements || ' movimiento(s), ' || reversals || ' reversión(es) con la operación ' ||
                     CASE WHEN status = 'ACTIVE' THEN 'vigente' ELSE 'anulada' END AS label, NULL::text AS diff
                FROM x WHERE movements <> 1 OR reversals <> CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END
               ORDER BY id`,
          }),
        );
      }
      out.push(
        await check(tx, {
          code: "G14-5",
          title: "Cheques recibidos y su impacto en tesorería",
          description: "Un cheque acreditado o cobrado tiene un ingreso neto igual a su importe; en cualquier otro estado, neto cero.",
          monetary: true,
          query: sql`
            WITH x AS (
              SELECT c.id, c.number, c.status, c.amount,
                     coalesce((SELECT sum(CASE WHEN m.direction = 'IN' THEN m.amount ELSE -m.amount END)
                                 FROM treasury_movements m JOIN check_events e ON e.id = m.check_event_id
                                WHERE e.received_check_id = c.id), 0) AS net
                FROM received_checks c
            ), y AS (SELECT *, CASE WHEN status = 'CREDITED' THEN amount ELSE 0 END AS expected FROM x)
            SELECT 'Cheque recibido N° ' || number || ' (' || status || '): neto ' || ${money("net")} || ', esperado ' || ${money("expected")} AS label, (net - expected)::text AS diff
              FROM y WHERE net <> expected ORDER BY id`,
        }),
      );
      out.push(
        await check(tx, {
          code: "G14-6",
          title: "Cheques propios y débitos bancarios",
          description: "Un cheque propio debitado tiene exactamente un egreso por su importe; ningún otro estado tiene movimientos.",
          monetary: true,
          query: sql`
            WITH x AS (
              SELECT c.id, c.number, c.status, c.amount,
                     (SELECT count(*) FROM treasury_movements m JOIN check_events e ON e.id = m.check_event_id WHERE e.issued_check_id = c.id) AS movements,
                     coalesce((SELECT sum(CASE WHEN m.direction = 'OUT' THEN m.amount ELSE -m.amount END)
                                 FROM treasury_movements m JOIN check_events e ON e.id = m.check_event_id WHERE e.issued_check_id = c.id), 0) AS net
                FROM issued_checks c
            ), y AS (SELECT *, CASE WHEN status = 'DEBITED' THEN amount ELSE 0 END AS expected, CASE WHEN status = 'DEBITED' THEN 1 ELSE 0 END AS expected_count FROM x)
            SELECT 'Cheque propio N° ' || number || ' (' || status || '): ' || movements || ' movimiento(s), neto ' || ${money("net")} AS label, (net - expected)::text AS diff
              FROM y WHERE net <> expected OR movements <> expected_count ORDER BY id`,
        }),
      );
      out.push(
        await check(tx, {
          code: "G14-7",
          title: "Saldos de caja y cierres",
          description: "Cada cierre guardó el saldo que surge de los movimientos y el arqueo = saldo + diferencia; ninguna caja en negativo si no está permitido.",
          monetary: true,
          query: sql`
            WITH closures AS (
              SELECT k.id, b.name, k.closure_date, k.system_balance, k.counted_amount, k.difference,
                     coalesce((SELECT sum(CASE WHEN m.direction = 'IN' THEN m.amount ELSE -m.amount END)
                                 FROM treasury_movements m
                                WHERE m.cash_box_id = k.cash_box_id AND m.movement_date <= k.closure_date
                                  AND NOT (m.origin_type = 'CASH_COUNT_DIFF' AND m.cash_closure_id = k.id)), 0) AS computed
                FROM cash_closures k JOIN cash_boxes b ON b.id = k.cash_box_id
            ), negative AS (
              SELECT tb.account_name, tb.balance FROM treasury_balances tb
               WHERE tb.account_kind = 'CASH' AND tb.balance < 0
                 AND NOT coalesce((SELECT (value)::text::boolean FROM configuration WHERE key = 'cash_allow_negative'), false)
            )
            SELECT 'Cierre de ' || name || ' del ' || to_char(closure_date, 'DD/MM/YYYY') || ': guardado ' || ${money("system_balance")} || ', movimientos ' || ${money("computed")} AS label,
                   (abs(system_balance - computed) + abs(counted_amount - system_balance - difference))::text AS diff
              FROM closures WHERE system_balance <> computed OR counted_amount <> system_balance + difference
            UNION ALL
            SELECT 'Caja ' || account_name || ' en negativo: ' || ${money("balance")}, balance::text FROM negative`,
        }),
      );
      const g8 = await reportReconciliation(tx, ctx, todayIso());
      out.push({
        code: "G14-8",
        title: "Totales de reportes y módulos de origen",
        description:
          "Antigüedad y deuda = cuentas corrientes (total, vencido, a vencer, créditos y cada tercero); cartera y cheques propios, flujo de fondos e ingresos/egresos = posición de tesorería; subdiario de IVA = comprobantes.",
        ok: g8.length === 0,
        failures: g8.length,
        difference: g8.reduce((a, r) => a.plus(new Decimal(r.diff).abs()), new Decimal(0)).toFixed(2),
        samples: g8.slice(0, SAMPLE_LIMIT).map((r) => r.label),
      });
      out.push(
        await check(tx, {
          code: "G14-9",
          title: "Cadena de hashes de auditoría",
          description: "Cada registro de auditoría encadena el hash del anterior; un registro alterado rompe la cadena.",
          monetary: false,
          query: sql`SELECT 'La cadena se rompe en el registro de auditoría #' || broken AS label, NULL::text AS diff
                       FROM (SELECT erp_verify_audit_chain() AS broken) v WHERE broken IS NOT NULL`,
        }),
      );
      return out;
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  const ok = results.every((r) => r.ok);
  await recordAudit(db, ctx, {
    module: "consistency",
    action: "run",
    result: "SUCCESS",
    message: ok ? "Todos los invariantes en $0,00" : `Con diferencias: ${results.filter((r) => !r.ok).map((r) => r.code).join(", ")}`,
    after: Object.fromEntries(results.map((r) => [r.code, { ok: r.ok, failures: r.failures, difference: r.difference }])),
  });
  return { results, ranAt: new Date(), ok };
}

