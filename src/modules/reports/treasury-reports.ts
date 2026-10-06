import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { formatDate } from "@/lib/format";
import { RECEIVED_STATUS_LABEL, ISSUED_STATUS_LABEL, type IssuedStatus, type ReceivedStatus } from "@/modules/checks/service";
import { incomeExpenseByConcept } from "@/modules/treasury/consolidated";
import { accountLedger, treasuryOverview } from "@/modules/treasury/service";
import type { ServiceContext } from "@/server/context";
import type { DbOrTx } from "@/server/db/drizzle";
import { m, periodLabel, sumOf } from "./common";
import { daysBetween } from "./open-items";
import type { LedgerReportQuery } from "./schemas";
import type { ReportResult, ReportRow } from "./types";

/** Reportes de tesorería (G.15): libro de caja, libro de banco, cartera de cheques, cheques emitidos e ingresos y egresos por concepto. */

const ORIGIN_LABEL: Record<string, string> = {
  OPENING: "Saldo inicial",
  COLLECTION_LINE: "Cobranza",
  PAYMENT_LINE: "Pago",
  CHECK_EVENT: "Cheque",
  ACCOUNT_TRANSFER: "Transferencia interna",
  REFUND: "Devolución",
  MANUAL: "Manual",
  CASH_COUNT_DIFF: "Diferencia de arqueo",
  REVERSAL: "Reversión",
};

/** Libro de una caja o cuenta bancaria: saldo anterior, movimientos con saldo progresivo y saldo final. */
export async function ledgerReport(db: DbOrTx, ctx: ServiceContext, kind: "CASH" | "BANK", q: LedgerReportQuery): Promise<ReportResult> {
  const accounts = await treasuryOverview(db, ctx, kind);
  const account = q.account ? accounts.find((a) => a.id === q.account) : (accounts.find((a) => a.active) ?? accounts[0]);
  const noun = kind === "CASH" ? "caja" : "cuenta bancaria";
  const base = {
    title: kind === "CASH" ? "Libro de caja" : "Libro de banco",
    filename: `libro-${kind === "CASH" ? "caja" : "banco"}-${account?.id ?? "sin-cuenta"}-${q.from}-${q.to}`,
  };
  if (!account) return { ...base, filters: [periodLabel(q.from, q.to)], tables: [], notes: [`No hay ninguna ${noun} ${q.account ? "con ese número" : "dada de alta"}.`] };
  const ledger = await accountLedger(db, ctx, { kind, id: account.id }, { from: q.from, to: q.to });
  const path = kind === "CASH" ? "/caja" : "/bancos";
  const rows: ReportRow[] = [
    { style: "subtotal", cells: { description: "Saldo anterior", balance: ledger.opening } },
    ...ledger.rows.map(
      (r): ReportRow => ({
        href: `${path}/${account.id}?from=${q.from}&to=${q.to}`,
        cells: {
          date: r.date,
          origin: ORIGIN_LABEL[r.originType] ?? r.originType,
          concept: r.concept || null,
          description: r.description,
          reference: r.reference,
          in: r.direction === "IN" ? r.amount : null,
          out: r.direction === "OUT" ? r.amount : null,
          balance: r.balance,
        },
      }),
    ),
  ];
  return {
    ...base,
    filters: [`${kind === "CASH" ? "Caja" : "Cuenta"}: ${account.name}`, periodLabel(ledger.from, ledger.to)],
    tables: [
      {
        columns: [
          { key: "date", label: "Fecha", type: "date" },
          { key: "origin", label: "Origen", type: "text" },
          { key: "concept", label: "Concepto", type: "text" },
          { key: "description", label: "Descripción", type: "text" },
          { key: "reference", label: "Referencia", type: "text" },
          { key: "in", label: "Ingreso", type: "money" },
          { key: "out", label: "Egreso", type: "money" },
          { key: "balance", label: "Saldo", type: "money" },
        ],
        rows,
        totals: { description: "Totales del período / saldo final", in: ledger.totalIn, out: ledger.totalOut, balance: ledger.closing },
      },
    ],
    notes:
      kind === "BANK"
        ? ["Saldo contable (movimientos registrados). El saldo disponible descuenta además los cheques propios pendientes de débito."]
        : ["Las correcciones figuran como reversiones: los movimientos nunca se borran ni se editan."],
  };
}

const RECEIVED_FILTER = { IN_PORTFOLIO: "en cartera", DEPOSITED: "depositados a acreditar", REJECTED: "rechazados", ENDORSED: "endosados", ALL: "todos (excepto anulados)" } as const;

/** Cartera de cheques de terceros (por defecto, los que están en cartera). */
export async function receivedChecksReport(db: DbOrTx, q: { status: keyof typeof RECEIVED_FILTER }, today: string): Promise<ReportResult> {
  const { rows } = await db.execute<{ id: number; payment_date: string; issue_date: string; bank: string; number: string; drawer_name: string; drawer_tax_id: string; client: string | null; status: ReceivedStatus; amount: string }>(sql`
    SELECT c.id, c.payment_date::text, c.issue_date::text, b.name AS bank, c.number, c.drawer_name, c.drawer_tax_id, cl.legal_name AS client, c.status, c.amount::text
      FROM received_checks c JOIN banks b ON b.id = c.issuer_bank_id LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE ${q.status === "ALL" ? sql`c.status <> 'ANNULLED'` : sql`c.status = ${q.status}`}
     ORDER BY c.payment_date, c.id`);
  const out: ReportRow[] = rows.map((c) => {
    const days = daysBetween(today, c.payment_date);
    return {
      href: `/cheques/recibidos/${c.id}`,
      cells: {
        paymentDate: c.payment_date,
        days: c.status === "IN_PORTFOLIO" || c.status === "DEPOSITED" ? days : null,
        bank: c.bank,
        number: c.number,
        drawer: c.drawer_name,
        drawerTaxId: c.drawer_tax_id,
        client: c.client,
        status: RECEIVED_STATUS_LABEL[c.status] ?? c.status,
        amount: m(c.amount),
      },
    };
  });
  return {
    title: "Cartera de cheques de terceros",
    filters: [`Estado: ${RECEIVED_FILTER[q.status]}`, `Al ${formatDate(today)}`],
    tables: [
      {
        columns: [
          { key: "paymentDate", label: "Fecha de pago", type: "date" },
          { key: "days", label: "Días al cobro", type: "int" },
          { key: "bank", label: "Banco", type: "text" },
          { key: "number", label: "Número", type: "text" },
          { key: "drawer", label: "Librador", type: "text" },
          { key: "drawerTaxId", label: "CUIT librador", type: "text" },
          { key: "client", label: "Recibido de", type: "text" },
          { key: "status", label: "Estado", type: "text" },
          { key: "amount", label: "Importe", type: "money" },
        ],
        rows: out,
        totals: { bank: `Total (${out.length})`, amount: m(sumOf(rows, (c) => c.amount)) },
        emptyMessage: "No hay cheques con ese estado.",
      },
    ],
    notes: ["Días al cobro negativos: la fecha de pago ya pasó y el cheque sigue sin depositar o sin acreditar."],
    filename: `cheques-cartera-${q.status.toLowerCase()}-${today}`,
  };
}

const ISSUED_FILTER = { PENDING: "pendientes de débito", DEBITED: "debitados", REJECTED: "rechazados", ALL: "todos (excepto anulados)" } as const;

/** Cheques propios emitidos (por defecto, los pendientes de débito). */
export async function issuedChecksReport(db: DbOrTx, q: { status: keyof typeof ISSUED_FILTER }, today: string): Promise<ReportResult> {
  const where =
    q.status === "PENDING" ? sql`c.status IN ('ISSUED','DELIVERED','PRESENTED')` : q.status === "ALL" ? sql`c.status <> 'ANNULLED'` : sql`c.status = ${q.status}`;
  const { rows } = await db.execute<{ id: number; payment_date: string; issue_date: string; account: string; number: string; supplier: string | null; status: IssuedStatus; amount: string }>(sql`
    SELECT c.id, c.payment_date::text, c.issue_date::text, a.display_name AS account, c.number, s.legal_name AS supplier, c.status, c.amount::text
      FROM issued_checks c JOIN bank_accounts a ON a.id = c.bank_account_id LEFT JOIN suppliers s ON s.id = c.supplier_id
     WHERE ${where}
     ORDER BY c.payment_date, c.id`);
  const out: ReportRow[] = rows.map((c) => ({
    href: `/cheques/emitidos/${c.id}`,
    cells: {
      paymentDate: c.payment_date,
      issueDate: c.issue_date,
      account: c.account,
      number: c.number,
      supplier: c.supplier,
      status: ISSUED_STATUS_LABEL[c.status] ?? c.status,
      amount: m(c.amount),
    },
  }));
  return {
    title: "Cheques propios emitidos",
    filters: [`Estado: ${ISSUED_FILTER[q.status]}`, `Al ${formatDate(today)}`],
    tables: [
      {
        columns: [
          { key: "paymentDate", label: "Fecha de pago", type: "date" },
          { key: "issueDate", label: "Emisión", type: "date" },
          { key: "account", label: "Cuenta", type: "text" },
          { key: "number", label: "Número", type: "text" },
          { key: "supplier", label: "Proveedor", type: "text" },
          { key: "status", label: "Estado", type: "text" },
          { key: "amount", label: "Importe", type: "money" },
        ],
        rows: out,
        totals: { account: `Total (${out.length})`, amount: m(sumOf(rows, (c) => c.amount)) },
        emptyMessage: "No hay cheques con ese estado.",
      },
    ],
    notes: ["Los cheques propios impactan en el banco recién al debitarse."],
    filename: `cheques-emitidos-${q.status.toLowerCase()}-${today}`,
  };
}

/** Ingresos y egresos reales del período por concepto (sin transferencias internas ni saldos iniciales). */
export async function conceptsReport(db: DbOrTx, ctx: ServiceContext, q: { from: string; to: string }): Promise<ReportResult> {
  const data = await incomeExpenseByConcept(db, ctx, q.from, q.to);
  return {
    title: "Ingresos y egresos por concepto",
    filters: [periodLabel(q.from, q.to)],
    tables: [
      {
        columns: [
          { key: "concept", label: "Concepto", type: "text" },
          { key: "income", label: "Ingresos", type: "money" },
          { key: "expense", label: "Egresos", type: "money" },
          { key: "net", label: "Neto", type: "money" },
        ],
        rows: data.rows.map((r) => ({ cells: { concept: r.concept, income: r.income, expense: r.expense, net: new Decimal(r.income).minus(r.expense).toFixed(2) } })),
        totals: { concept: "Total", income: data.income, expense: data.expense, net: data.net },
        emptyMessage: "No hay movimientos en el período.",
      },
    ],
    notes: ["Las reversiones se restan del concepto del movimiento revertido. Las transferencias entre cuentas propias y los saldos iniciales no son ingresos ni egresos."],
    filename: `ingresos-egresos-${q.from}-${q.to}`,
  };
}
