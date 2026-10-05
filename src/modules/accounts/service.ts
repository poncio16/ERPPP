import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { DomainError } from "@/lib/errors";
import { todayIso } from "@/lib/format";
import { assertPermission } from "@/server/authorization";
import type { ServiceContext } from "@/server/context";
import type { DbOrTx } from "@/server/db/drizzle";
import type { Direction } from "@/server/db/schema";
import type { AccountListQuery, StatementQuery } from "./schemas";

/**
 * Cuentas corrientes de clientes y proveedores (D.5, G.4). El saldo no se guarda: surge del libro
 * de asientos (append-only). La composición del saldo surge de los comprobantes con saldo y de los
 * créditos sin aplicar; ambas cifras deben coincidir siempre (invariante G.14-1).
 */

export const PAGE_SIZE = 50;

/** Clases de comprobante que generan deuda del tercero y clases que generan crédito a su favor. */
const DEBT_CLASSES = sql.raw(`('INVOICE','DEBIT_NOTE','INTERNAL_DEBIT','OPENING_DEBIT')`);
const CREDIT_CLASSES = sql.raw(`('CREDIT_NOTE','OPENING_CREDIT')`);

/** Nombres de tablas y columnas según el lado (constantes, nunca datos del usuario). */
const LEDGER = {
  ISSUED: {
    party: "clients",
    entries: "customer_account_entries",
    entryParty: "client_id",
    entryOp: "collection_id",
    docParty: "client_id",
    ops: "collections",
    opParty: "client_id",
    opDate: "collection_date",
    voucher: "receipts",
    voucherOp: "collection_id",
  },
  RECEIVED: {
    party: "suppliers",
    entries: "supplier_account_entries",
    entryParty: "supplier_id",
    entryOp: "payment_id",
    docParty: "supplier_id",
    ops: "supplier_payments",
    opParty: "supplier_id",
    opDate: "payment_date",
    voucher: "payment_orders",
    voucherOp: "payment_id",
  },
} as const;

function names(direction: Direction) {
  const l = LEDGER[direction];
  return Object.fromEntries(Object.entries(l).map(([k, v]) => [k, sql.raw(v)])) as Record<keyof typeof l, ReturnType<typeof sql.raw>>;
}

export interface AccountParty {
  id: number;
  code: string;
  legalName: string;
  taxId: string | null;
  status: string;
  creditDays: number;
  creditLimit: string | null;
}

async function getParty(db: DbOrTx, direction: Direction, partyId: number): Promise<AccountParty> {
  const n = names(direction);
  const { rows } = await db.execute<{
    id: number;
    code: string;
    legal_name: string;
    tax_id: string | null;
    status: string;
    credit_days: number;
    credit_limit: string | null;
  }>(sql`SELECT id, code, legal_name, tax_id, status, credit_days, credit_limit::text FROM ${n.party} WHERE id = ${partyId}`);
  const r = rows[0];
  if (!r) throw new DomainError(direction === "ISSUED" ? "El cliente no existe." : "El proveedor no existe.", "NOT_FOUND");
  return {
    id: Number(r.id),
    code: r.code,
    legalName: r.legal_name,
    taxId: r.tax_id,
    status: r.status,
    creditDays: Number(r.credit_days),
    creditLimit: r.credit_limit,
  };
}

export interface AccountSummary {
  /** Saldo del libro: Σ débitos − Σ créditos. Negativo = saldo a favor del tercero. */
  balance: string;
  /** Saldos de comprobantes deudores con vencimiento anterior a hoy. */
  overdue: string;
  /** Saldos de comprobantes deudores que vencen hoy o después. */
  notDue: string;
  /** Créditos sin aplicar: NC con saldo y cobranzas/pagos con importe sin imputar. */
  credit: string;
  /** Facturas + ND − NC registradas en el período (no anuladas). */
  billed: string;
  /** Cobranzas / pagos activos del período. */
  settled: string;
  lastEntryDate: string | null;
  lastSettlementDate: string | null;
  /** Diferencia del invariante G.14-1 (debe ser 0,00). */
  difference: string;
}

/** Resumen de la cuenta (G.4). Los totales de facturado y cobrado se calculan sobre el período. */
export async function accountSummary(db: DbOrTx, ctx: ServiceContext, direction: Direction, partyId: number, period: { from: string; to: string }) {
  assertPermission(ctx, "accounts.read");
  const n = names(direction);
  const today = todayIso();
  const { rows } = await db.execute<{
    balance: string;
    overdue: string;
    not_due: string;
    credit_docs: string;
    credit_ops: string;
    billed: string;
    settled: string;
    last_entry: string | null;
    last_settlement: string | null;
  }>(sql`
    SELECT
      (SELECT coalesce(sum(debit - credit), 0)::text FROM ${n.entries} WHERE ${n.entryParty} = ${partyId}) AS balance,
      (SELECT coalesce(sum(d.balance) FILTER (WHERE d.due_date < ${today}), 0)::text
         FROM documents d JOIN document_types t ON t.id = d.document_type_id
        WHERE d.${n.docParty} = ${partyId} AND d.status <> 'ANNULLED' AND t.class IN ${DEBT_CLASSES}) AS overdue,
      (SELECT coalesce(sum(d.balance) FILTER (WHERE d.due_date >= ${today}), 0)::text
         FROM documents d JOIN document_types t ON t.id = d.document_type_id
        WHERE d.${n.docParty} = ${partyId} AND d.status <> 'ANNULLED' AND t.class IN ${DEBT_CLASSES}) AS not_due,
      (SELECT coalesce(sum(d.balance), 0)::text
         FROM documents d JOIN document_types t ON t.id = d.document_type_id
        WHERE d.${n.docParty} = ${partyId} AND d.status <> 'ANNULLED' AND t.class IN ${CREDIT_CLASSES}) AS credit_docs,
      (SELECT coalesce(sum(unapplied_amount), 0)::text FROM ${n.ops} WHERE ${n.opParty} = ${partyId} AND status = 'ACTIVE') AS credit_ops,
      (SELECT coalesce(sum(CASE WHEN t.class = 'CREDIT_NOTE' THEN -d.total ELSE d.total END), 0)::text
         FROM documents d JOIN document_types t ON t.id = d.document_type_id
        WHERE d.${n.docParty} = ${partyId} AND d.status <> 'ANNULLED'
          AND t.class IN ('INVOICE','DEBIT_NOTE','INTERNAL_DEBIT','CREDIT_NOTE')
          AND d.issue_date BETWEEN ${period.from} AND ${period.to}) AS billed,
      (SELECT coalesce(sum(total_amount), 0)::text FROM ${n.ops}
        WHERE ${n.opParty} = ${partyId} AND status = 'ACTIVE' AND ${n.opDate} BETWEEN ${period.from} AND ${period.to}) AS settled,
      (SELECT max(entry_date)::text FROM ${n.entries} WHERE ${n.entryParty} = ${partyId}) AS last_entry,
      (SELECT max(${n.opDate})::text FROM ${n.ops} WHERE ${n.opParty} = ${partyId} AND status = 'ACTIVE') AS last_settlement
  `);
  const r = rows[0]!;
  const credit = new Decimal(r.credit_docs).plus(r.credit_ops);
  const composition = new Decimal(r.overdue).plus(r.not_due).minus(credit);
  const summary: AccountSummary = {
    balance: new Decimal(r.balance).toFixed(2),
    overdue: new Decimal(r.overdue).toFixed(2),
    notDue: new Decimal(r.not_due).toFixed(2),
    credit: credit.toFixed(2),
    billed: new Decimal(r.billed).toFixed(2),
    settled: new Decimal(r.settled).toFixed(2),
    lastEntryDate: r.last_entry,
    lastSettlementDate: r.last_settlement,
    difference: new Decimal(r.balance).minus(composition).toFixed(2),
  };
  return summary;
}

export interface StatementRow {
  id: number;
  entryDate: string;
  entryType: "DOCUMENT" | "COLLECTION" | "PAYMENT" | "REVERSAL";
  description: string;
  documentId: number | null;
  operationId: number | null;
  voucherNumber: string | null;
  debit: string;
  credit: string;
  balance: string;
}

export interface Statement {
  from: string;
  to: string;
  opening: string;
  rows: StatementRow[];
  totalDebit: string;
  totalCredit: string;
  closing: string;
}

export function defaultPeriod(today = todayIso()) {
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}

/**
 * Resumen de cuenta: saldo anterior al período, asientos del período con saldo progresivo
 * (orden fecha + id, D.5) y saldo final.
 */
export async function accountStatement(db: DbOrTx, ctx: ServiceContext, direction: Direction, partyId: number, query: StatementQuery): Promise<Statement> {
  assertPermission(ctx, "accounts.read");
  const n = names(direction);
  const { from, to } = { ...defaultPeriod(), ...Object.fromEntries(Object.entries(query).filter(([, v]) => v)) } as { from: string; to: string };
  const { rows: op } = await db.execute<{ opening: string }>(
    sql`SELECT coalesce(sum(debit - credit), 0)::text AS opening FROM ${n.entries} WHERE ${n.entryParty} = ${partyId} AND entry_date < ${from}`,
  );
  const opening = new Decimal(op[0]?.opening ?? 0);
  const { rows } = await db.execute<{
    id: number;
    entry_date: string;
    entry_type: StatementRow["entryType"];
    description: string;
    document_id: number | null;
    operation_id: number | null;
    voucher_number: string | null;
    debit: string;
    credit: string;
  }>(sql`
    SELECT e.id, e.entry_date::text, e.entry_type, e.description, e.document_id, e.${n.entryOp} AS operation_id,
           v.number AS voucher_number, e.debit::text, e.credit::text
      FROM ${n.entries} e
      LEFT JOIN ${n.voucher} v ON v.${n.voucherOp} = e.${n.entryOp}
     WHERE e.${n.entryParty} = ${partyId} AND e.entry_date BETWEEN ${from} AND ${to}
     ORDER BY e.entry_date, e.id
  `);
  let running = opening;
  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);
  const out = rows.map((r) => {
    running = running.plus(r.debit).minus(r.credit);
    totalDebit = totalDebit.plus(r.debit);
    totalCredit = totalCredit.plus(r.credit);
    return {
      id: Number(r.id),
      entryDate: r.entry_date,
      entryType: r.entry_type,
      description: r.description,
      documentId: r.document_id === null ? null : Number(r.document_id),
      operationId: r.operation_id === null ? null : Number(r.operation_id),
      voucherNumber: r.voucher_number,
      debit: new Decimal(r.debit).toFixed(2),
      credit: new Decimal(r.credit).toFixed(2),
      balance: running.toFixed(2),
    };
  });
  return {
    from,
    to,
    opening: opening.toFixed(2),
    rows: out,
    totalDebit: totalDebit.toFixed(2),
    totalCredit: totalCredit.toFixed(2),
    closing: running.toFixed(2),
  };
}

export interface CompositionItem {
  kind: "DOCUMENT" | "OPERATION";
  id: number;
  date: string;
  dueDate: string | null;
  description: string;
  total: string;
  /** Saldo pendiente (deuda) o crédito disponible. */
  open: string;
  /** Días de atraso (> 0) o hasta el vencimiento (≤ 0); null para créditos. */
  daysOverdue: number | null;
}

/** Composición del saldo (G.4): comprobantes deudores con saldo y créditos sin aplicar. */
export async function balanceComposition(db: DbOrTx, ctx: ServiceContext, direction: Direction, partyId: number) {
  assertPermission(ctx, "accounts.read");
  const n = names(direction);
  const today = todayIso();
  const docs = await db.execute<{
    id: number;
    issue_date: string;
    due_date: string;
    type_name: string;
    point_of_sale: number;
    number: number;
    total: string;
    balance: string;
    is_credit: boolean;
    days: number;
  }>(sql`
    SELECT d.id, d.issue_date::text, d.due_date::text, t.name AS type_name, d.point_of_sale, d.number,
           d.total::text, d.balance::text, t.class IN ${CREDIT_CLASSES} AS is_credit,
           (${today}::date - d.due_date) AS days
      FROM documents d JOIN document_types t ON t.id = d.document_type_id
     WHERE d.${n.docParty} = ${partyId} AND d.status <> 'ANNULLED' AND d.balance > 0
     ORDER BY d.due_date, d.id
  `);
  const ops = await db.execute<{ id: number; op_date: string; total: string; unapplied: string; voucher_number: string | null }>(sql`
    SELECT o.id, o.${n.opDate}::text AS op_date, o.total_amount::text AS total, o.unapplied_amount::text AS unapplied, v.number AS voucher_number
      FROM ${n.ops} o LEFT JOIN ${n.voucher} v ON v.${n.voucherOp} = o.id
     WHERE o.${n.opParty} = ${partyId} AND o.status = 'ACTIVE' AND o.unapplied_amount > 0
     ORDER BY o.${n.opDate}, o.id
  `);
  const pad = (v: number, len: number) => String(v).padStart(len, "0");
  const debts: CompositionItem[] = [];
  const credits: CompositionItem[] = [];
  for (const d of docs.rows) {
    const item: CompositionItem = {
      kind: "DOCUMENT",
      id: Number(d.id),
      date: d.issue_date,
      dueDate: d.is_credit ? null : d.due_date,
      description: `${d.type_name} ${pad(d.point_of_sale, 5)}-${pad(d.number, 8)}`,
      total: new Decimal(d.total).toFixed(2),
      open: new Decimal(d.balance).toFixed(2),
      daysOverdue: d.is_credit ? null : Number(d.days),
    };
    (d.is_credit ? credits : debts).push(item);
  }
  const opLabel = direction === "ISSUED" ? "Cobranza" : "Pago";
  for (const o of ops.rows) {
    credits.push({
      kind: "OPERATION",
      id: Number(o.id),
      date: o.op_date,
      dueDate: null,
      description: o.voucher_number ? `${opLabel} ${o.voucher_number}` : `${opLabel} #${o.id}`,
      total: new Decimal(o.total).toFixed(2),
      open: new Decimal(o.unapplied).toFixed(2),
      daysOverdue: null,
    });
  }
  const sum = (xs: CompositionItem[]) => xs.reduce((a, x) => a.plus(x.open), new Decimal(0));
  const totalDebt = sum(debts);
  const totalCredit = sum(credits);
  return { debts, credits, totalDebt: totalDebt.toFixed(2), totalCredit: totalCredit.toFixed(2), net: totalDebt.minus(totalCredit).toFixed(2) };
}

export interface AccountListRow {
  id: number;
  code: string;
  legalName: string;
  taxId: string | null;
  status: string;
  balance: string;
  overdue: string;
  notDue: string;
  credit: string;
  lastEntryDate: string | null;
}

/** Listado de cuentas con saldo, vencido, a vencer y saldo a favor por tercero, con totales. */
export async function listAccounts(db: DbOrTx, ctx: ServiceContext, direction: Direction, query: AccountListQuery) {
  assertPermission(ctx, "accounts.read");
  const n = names(direction);
  const today = todayIso();
  const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const digits = query.q.replace(/\D/g, "");
  const search = query.q
    ? sql`AND (p.legal_name ILIKE ${like} OR p.code ILIKE ${like}${digits.length >= 3 ? sql` OR p.tax_id LIKE ${`%${digits}%`}` : sql``})`
    : sql``;
  const filter = {
    WITH_BALANCE: sql`AND (a.balance <> 0 OR a.overdue <> 0 OR a.not_due <> 0 OR a.credit <> 0)`,
    DEBT: sql`AND a.balance > 0`,
    CREDIT: sql`AND a.credit > 0`,
    OVERDUE: sql`AND a.overdue > 0`,
    ALL: sql``,
  }[query.filter];
  const base = sql`
    WITH a AS (
      SELECT p.id,
             coalesce((SELECT sum(e.debit - e.credit) FROM ${n.entries} e WHERE e.${n.entryParty} = p.id), 0) AS balance,
             coalesce((SELECT sum(d.balance) FILTER (WHERE d.due_date < ${today}) FROM documents d JOIN document_types t ON t.id = d.document_type_id
                        WHERE d.${n.docParty} = p.id AND d.status <> 'ANNULLED' AND t.class IN ${DEBT_CLASSES}), 0) AS overdue,
             coalesce((SELECT sum(d.balance) FILTER (WHERE d.due_date >= ${today}) FROM documents d JOIN document_types t ON t.id = d.document_type_id
                        WHERE d.${n.docParty} = p.id AND d.status <> 'ANNULLED' AND t.class IN ${DEBT_CLASSES}), 0) AS not_due,
             coalesce((SELECT sum(d.balance) FROM documents d JOIN document_types t ON t.id = d.document_type_id
                        WHERE d.${n.docParty} = p.id AND d.status <> 'ANNULLED' AND t.class IN ${CREDIT_CLASSES}), 0)
             + coalesce((SELECT sum(o.unapplied_amount) FROM ${n.ops} o WHERE o.${n.opParty} = p.id AND o.status = 'ACTIVE'), 0) AS credit,
             (SELECT max(e.entry_date) FROM ${n.entries} e WHERE e.${n.entryParty} = p.id) AS last_entry
        FROM ${n.party} p
    )
    SELECT p.id, p.code, p.legal_name, p.tax_id, p.status,
           a.balance::numeric(18,2)::text AS balance, a.overdue::numeric(18,2)::text AS overdue,
           a.not_due::numeric(18,2)::text AS not_due, a.credit::numeric(18,2)::text AS credit, a.last_entry::text AS last_entry
      FROM ${n.party} p JOIN a ON a.id = p.id
     WHERE true ${search} ${filter}
  `;
  const [{ rows }, totals] = await Promise.all([
    db.execute<{
      id: number;
      code: string;
      legal_name: string;
      tax_id: string | null;
      status: string;
      balance: string;
      overdue: string;
      not_due: string;
      credit: string;
      last_entry: string | null;
    }>(sql`${base} ORDER BY lower(p.legal_name), p.id LIMIT ${PAGE_SIZE} OFFSET ${(query.page - 1) * PAGE_SIZE}`),
    db.execute<{ count: string; balance: string; overdue: string; not_due: string; credit: string }>(sql`
      SELECT count(*)::text AS count, coalesce(sum(balance::numeric), 0)::numeric(18,2)::text AS balance,
             coalesce(sum(overdue::numeric), 0)::numeric(18,2)::text AS overdue, coalesce(sum(not_due::numeric), 0)::numeric(18,2)::text AS not_due,
             coalesce(sum(credit::numeric), 0)::numeric(18,2)::text AS credit
        FROM (${base}) x`),
  ]);
  const t = totals.rows[0]!;
  return {
    rows: rows.map(
      (r): AccountListRow => ({
        id: Number(r.id),
        code: r.code,
        legalName: r.legal_name,
        taxId: r.tax_id,
        status: r.status,
        balance: r.balance,
        overdue: r.overdue,
        notDue: r.not_due,
        credit: r.credit,
        lastEntryDate: r.last_entry,
      }),
    ),
    total: Number(t.count),
    totals: { balance: t.balance, overdue: t.overdue, notDue: t.not_due, credit: t.credit },
    page: query.page,
    pageSize: PAGE_SIZE,
  };
}

/** Datos completos de la ficha de cuenta corriente. */
export async function accountDetail(db: DbOrTx, ctx: ServiceContext, direction: Direction, partyId: number, query: StatementQuery) {
  assertPermission(ctx, "accounts.read");
  const party = await getParty(db, direction, partyId);
  const statement = await accountStatement(db, ctx, direction, partyId, query);
  const [summary, composition] = await Promise.all([
    accountSummary(db, ctx, direction, partyId, { from: statement.from, to: statement.to }),
    balanceComposition(db, ctx, direction, partyId),
  ]);
  return { party, summary, statement, composition };
}
