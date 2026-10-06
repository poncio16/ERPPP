import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { TIME_ZONE } from "@/lib/format";
import { formatDocumentNumber } from "@/modules/tax/calc";
import type { DbOrTx } from "@/server/db/drizzle";
import type { Direction } from "@/server/db/schema";

/**
 * Partidas abiertas de cuentas corrientes a una fecha de corte (G.15). Es la consulta única sobre
 * la que se arman saldos, vencimientos, antigüedad, el flujo de fondos y el dashboard.
 *
 * Cada partida (comprobante u operación) vale, a la fecha de corte:
 *   Σ asientos del libro con fecha ≤ corte  −/+  Σ imputaciones vigentes a esa fecha.
 * Una imputación está vigente si su fecha es ≤ corte y no estaba revertida al cierre de ese día.
 * Como cada imputación resta lo mismo de la deuda que del crédito, la suma de las partidas es
 * exactamente el saldo del libro a la fecha de corte (invariante G.14-1 aplicado a cualquier fecha).
 */

const SIDE = {
  ISSUED: { ledger: "AR", party: "clients", entries: "customer_account_entries", partyCol: "client_id", entryOp: "collection_id", ops: "collections", opDate: "collection_date", allocOp: "source_collection_id", voucher: "receipts", voucherOp: "collection_id", opLabel: "Cobranza" },
  RECEIVED: { ledger: "AP", party: "suppliers", entries: "supplier_account_entries", partyCol: "supplier_id", entryOp: "payment_id", ops: "supplier_payments", opDate: "payment_date", allocOp: "source_payment_id", voucher: "payment_orders", voucherOp: "payment_id", opLabel: "Pago" },
} as const;

export interface OpenItem {
  source: "DOCUMENT" | "OPERATION";
  id: number;
  partyId: number;
  partyCode: string;
  partyName: string;
  date: string;
  /** Vencimiento de las partidas deudoras; null para créditos. */
  dueDate: string | null;
  description: string;
  total: string;
  /** Importe abierto, siempre positivo. */
  open: string;
  /** DEBT: deuda del tercero (o con el proveedor); CREDIT: crédito sin aplicar. */
  kind: "DEBT" | "CREDIT";
}

export async function openItemsAt(db: DbOrTx, direction: Direction, cutoff: string, partyId?: number): Promise<OpenItem[]> {
  const s = SIDE[direction];
  const r = (v: string) => sql.raw(v);
  const entryParty = partyId ? sql`AND e.${r(s.partyCol)} = ${partyId}` : sql``;
  const allocParty = partyId ? sql`AND d.${r(s.partyCol)} = ${partyId}` : sql``;
  const { rows } = await db.execute<{
    k: "D" | "O";
    id: number;
    signed: string;
    party_id: number;
    party_code: string;
    party_name: string;
    date: string;
    due_date: string | null;
    type_name: string | null;
    point_of_sale: number | null;
    number: number | null;
    voucher: string | null;
    total: string;
  }>(sql`
    WITH g AS (
      SELECT e.document_id, e.${r(s.entryOp)} AS op_id, sum(e.debit - e.credit) AS amt
        FROM ${r(s.entries)} e
       WHERE e.entry_date <= ${cutoff} ${entryParty}
       GROUP BY e.document_id, e.${r(s.entryOp)}
    ),
    a AS (
      SELECT a.target_document_id, a.source_document_id, a.${r(s.allocOp)} AS source_op, a.amount
        FROM allocations a JOIN documents d ON d.id = a.target_document_id
       WHERE a.ledger = ${s.ledger} AND a.allocation_date <= ${cutoff} ${allocParty}
         AND (a.status = 'ACTIVE' OR (a.reversed_at AT TIME ZONE ${TIME_ZONE})::date > ${cutoff})
    ),
    items AS (
      SELECT 'D' AS k, document_id AS id, amt FROM g WHERE document_id IS NOT NULL
      UNION ALL SELECT 'O', op_id, amt FROM g WHERE op_id IS NOT NULL
      UNION ALL SELECT 'D', target_document_id, -amount FROM a
      UNION ALL SELECT 'D', source_document_id, amount FROM a WHERE source_document_id IS NOT NULL
      UNION ALL SELECT 'O', source_op, amount FROM a WHERE source_op IS NOT NULL
    ),
    net AS (SELECT k, id, sum(amt) AS signed FROM items GROUP BY k, id HAVING sum(amt) <> 0)
    SELECT n.k, n.id, n.signed::numeric(18,2)::text AS signed, p.id AS party_id, p.code AS party_code, p.legal_name AS party_name,
           d.issue_date::text AS date, d.due_date::text AS due_date, t.name AS type_name, d.point_of_sale, d.number, NULL AS voucher, d.total::text AS total
      FROM net n JOIN documents d ON d.id = n.id JOIN document_types t ON t.id = d.document_type_id JOIN ${r(s.party)} p ON p.id = d.${r(s.partyCol)}
     WHERE n.k = 'D'
    UNION ALL
    SELECT n.k, n.id, n.signed::numeric(18,2)::text, p.id, p.code, p.legal_name,
           o.${r(s.opDate)}::text, NULL, NULL, NULL, NULL, v.number, o.total_amount::text
      FROM net n JOIN ${r(s.ops)} o ON o.id = n.id JOIN ${r(s.party)} p ON p.id = o.${r(s.partyCol)}
      LEFT JOIN ${r(s.voucher)} v ON v.${r(s.voucherOp)} = o.id
     WHERE n.k = 'O'
     ORDER BY 6, 8 NULLS LAST, 7, 2`);
  return rows.map((x) => {
    const signed = new Decimal(x.signed);
    const kind = signed.isPositive() ? "DEBT" : "CREDIT";
    const isDoc = x.k === "D";
    return {
      source: isDoc ? "DOCUMENT" : "OPERATION",
      id: Number(x.id),
      partyId: Number(x.party_id),
      partyCode: x.party_code,
      partyName: x.party_name,
      date: x.date,
      dueDate: kind === "DEBT" ? (x.due_date ?? x.date) : null,
      description: isDoc
        ? `${x.type_name} ${formatDocumentNumber(Number(x.point_of_sale), Number(x.number))}`
        : x.voucher
          ? `${s.opLabel} ${x.voucher}`
          : `${s.opLabel} #${x.id}`,
      total: new Decimal(x.total).toFixed(2),
      open: signed.abs().toFixed(2),
      kind,
    };
  });
}

/** Saldo del libro de cuenta corriente a una fecha, por tercero (Σ débitos − Σ créditos). */
export async function ledgerBalancesAt(db: DbOrTx, direction: Direction, cutoff: string, partyId?: number): Promise<Map<number, Decimal>> {
  const s = SIDE[direction];
  const r = (v: string) => sql.raw(v);
  const { rows } = await db.execute<{ party_id: number; balance: string }>(sql`
    SELECT ${r(s.partyCol)} AS party_id, sum(debit - credit)::numeric(18,2)::text AS balance
      FROM ${r(s.entries)}
     WHERE entry_date <= ${cutoff} ${partyId ? sql`AND ${r(s.partyCol)} = ${partyId}` : sql``}
     GROUP BY ${r(s.partyCol)}`);
  return new Map(rows.map((x) => [Number(x.party_id), new Decimal(x.balance)]));
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export const AGING_BUCKETS = [
  { key: "b0", label: "0–30", max: 30 },
  { key: "b31", label: "31–60", max: 60 },
  { key: "b61", label: "61–90", max: 90 },
  { key: "b91", label: "91–180", max: 180 },
  { key: "b181", label: "Más de 180", max: Infinity },
] as const;
export type BucketKey = (typeof AGING_BUCKETS)[number]["key"];

/** Tramo de antigüedad para una cantidad de días (≥ 0). */
export const bucketOf = (days: number): BucketKey => AGING_BUCKETS.find((b) => days <= b.max)!.key;

export interface AgingTotals {
  overdue: Record<BucketKey, Decimal>;
  notDue: Record<BucketKey, Decimal>;
  overdueTotal: Decimal;
  notDueTotal: Decimal;
  credit: Decimal;
  /** Deuda − créditos: coincide con el saldo de cuenta corriente. */
  balance: Decimal;
  /** Mayor atraso en días entre las partidas vencidas. */
  maxDaysOverdue: number;
}

const zeroBuckets = () => Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, new Decimal(0)])) as Record<BucketKey, Decimal>;

export function emptyAging(): AgingTotals {
  return { overdue: zeroBuckets(), notDue: zeroBuckets(), overdueTotal: new Decimal(0), notDueTotal: new Decimal(0), credit: new Decimal(0), balance: new Decimal(0), maxDaysOverdue: 0 };
}

/** Clasifica una partida: vencida si su vencimiento es anterior al corte (días desde el vencimiento), si no a vencer (días hasta el vencimiento). */
export function classify(item: OpenItem, cutoff: string): { overdue: boolean; days: number; bucket: BucketKey } | null {
  if (item.kind === "CREDIT") return null;
  const days = daysBetween(item.dueDate!, cutoff);
  return days > 0 ? { overdue: true, days, bucket: bucketOf(days) } : { overdue: false, days: -days, bucket: bucketOf(-days) };
}

export function addToAging(acc: AgingTotals, item: OpenItem, cutoff: string) {
  const c = classify(item, cutoff);
  if (!c) {
    acc.credit = acc.credit.plus(item.open);
    acc.balance = acc.balance.minus(item.open);
    return;
  }
  if (c.overdue) {
    acc.overdue[c.bucket] = acc.overdue[c.bucket].plus(item.open);
    acc.overdueTotal = acc.overdueTotal.plus(item.open);
    acc.maxDaysOverdue = Math.max(acc.maxDaysOverdue, c.days);
  } else {
    acc.notDue[c.bucket] = acc.notDue[c.bucket].plus(item.open);
    acc.notDueTotal = acc.notDueTotal.plus(item.open);
  }
  acc.balance = acc.balance.plus(item.open);
}

/** Antigüedad agrupada por tercero, ordenada por razón social, más el total general. */
export function agingByParty(items: OpenItem[], cutoff: string) {
  const parties = new Map<number, { partyId: number; partyCode: string; partyName: string; aging: AgingTotals }>();
  const total = emptyAging();
  for (const i of items) {
    let p = parties.get(i.partyId);
    if (!p) parties.set(i.partyId, (p = { partyId: i.partyId, partyCode: i.partyCode, partyName: i.partyName, aging: emptyAging() }));
    addToAging(p.aging, i, cutoff);
    addToAging(total, i, cutoff);
  }
  const rows = [...parties.values()].sort((a, b) => a.partyName.localeCompare(b.partyName, "es") || a.partyId - b.partyId);
  return { rows, total };
}
