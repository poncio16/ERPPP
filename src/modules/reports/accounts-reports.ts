import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { accountStatement } from "@/modules/accounts/service";
import { formatDocumentNumber } from "@/modules/tax/calc";
import type { ServiceContext } from "@/server/context";
import type { DbOrTx } from "@/server/db/drizzle";
import type { Direction } from "@/server/db/schema";
import { CREDIT_CLASS_SQL, m, partyFilterLabel, periodLabel, SIDE_INFO, sumOf } from "./common";
import { AGING_BUCKETS, agingByParty, classify, ledgerBalancesAt, openItemsAt, type OpenItem } from "./open-items";
import type { CutoffQuery, DocumentsReportQuery, DueReportQuery, PartyPeriodQuery, SettlementsReportQuery, StatementReportQuery } from "./schemas";
import type { ReportColumn, ReportResult, ReportRow } from "./types";

/** Reportes de clientes y proveedores (G.15): comprobantes, cobranzas/pagos, saldos, vencimientos, antigüedad, cuenta corriente y retenciones. */

const r = (v: string) => sql.raw(v);
const DOC_STATUS: Record<string, string> = { OPEN: "Pendiente", PARTIAL: "Parcial", SETTLED: "Cancelado", ANNULLED: "Anulado" };
const STATUS_FILTER = { ACTIVE: "vigentes", ANNULLED: "anulados", ALL: "vigentes y anulados" } as const;

// ───────────────────────────── Comprobantes ─────────────────────────────

/** Comprobantes del período por tipo y tercero, con neto, IVA, percepciones y total. NC con signo negativo. */
export async function documentsReport(db: DbOrTx, direction: Direction, q: DocumentsReportQuery): Promise<ReportResult> {
  const info = SIDE_INFO[direction];
  const { rows } = await db.execute<{
    id: number;
    issue_date: string;
    due_date: string;
    type_name: string;
    is_credit: boolean;
    point_of_sale: number;
    number: number;
    party_name: string;
    party_tax_id: string | null;
    net_taxed: string;
    net_untaxed: string;
    net_exempt: string;
    vat_total: string;
    perceptions_total: string;
    other_taxes_total: string;
    discount_total: string;
    total: string;
    balance: string;
    status: string;
    currency: string;
  }>(sql`
    SELECT d.id, d.issue_date::text, d.due_date::text, t.name AS type_name, t.class IN ${CREDIT_CLASS_SQL} AS is_credit, d.point_of_sale, d.number,
           d.party_name, d.party_tax_id, d.net_taxed::text, d.net_untaxed::text, d.net_exempt::text, d.vat_total::text, d.perceptions_total::text,
           d.other_taxes_total::text, d.discount_total::text, d.total::text, d.balance::text, d.status, d.currency
      FROM documents d JOIN document_types t ON t.id = d.document_type_id
     WHERE d.direction = ${direction} AND d.issue_date BETWEEN ${q.from} AND ${q.to}
       ${q.party ? sql`AND d.${r(info.partyCol)} = ${q.party}` : sql``}
       ${q.type ? sql`AND d.document_type_id = ${q.type}` : sql``}
       ${q.status === "ACTIVE" ? sql`AND d.status <> 'ANNULLED'` : q.status === "ANNULLED" ? sql`AND d.status = 'ANNULLED'` : sql``}
     ORDER BY d.issue_date, d.id`);
  const amountKeys = ["netTaxed", "netUntaxed", "netExempt", "vat", "perceptions", "otherTaxes", "discount", "total", "balance"] as const;
  const out: ReportRow[] = rows.map((d) => {
    const sign = d.is_credit ? -1 : 1;
    const s = (v: string) => new Decimal(v).mul(sign).toFixed(2);
    return {
      href: `${info.documentPath}/${d.id}`,
      cells: {
        date: d.issue_date,
        type: d.type_name,
        number: formatDocumentNumber(d.point_of_sale, Number(d.number)),
        party: d.party_name,
        taxId: d.party_tax_id,
        due: d.due_date,
        netTaxed: s(d.net_taxed),
        netUntaxed: s(d.net_untaxed),
        netExempt: s(d.net_exempt),
        vat: s(d.vat_total),
        perceptions: s(d.perceptions_total),
        otherTaxes: s(d.other_taxes_total),
        discount: d.discount_total === "0.00" ? null : new Decimal(d.discount_total).mul(-sign).toFixed(2),
        total: s(d.total),
        balance: s(d.balance),
        status: DOC_STATUS[d.status] ?? d.status,
      },
    };
  });
  const counted = out.filter((x) => x.cells.status !== "Anulado");
  const totals: Record<string, string> = { type: `Total (${counted.length} comprobantes)` };
  for (const k of amountKeys) totals[k] = m(sumOf(counted, (x) => x.cells[k] as string | null));

  let typeLabel = "Tipo: todos";
  if (q.type) {
    const t = await db.execute<{ name: string }>(sql`SELECT name FROM document_types WHERE id = ${q.type}`);
    typeLabel = `Tipo: ${t.rows[0]?.name ?? "inexistente"}`;
  }
  const columns: ReportColumn[] = [
    { key: "date", label: "Fecha", type: "date" },
    { key: "type", label: "Tipo", type: "text" },
    { key: "number", label: "Número", type: "text" },
    { key: "party", label: info.party, type: "text" },
    { key: "taxId", label: "CUIT", type: "text" },
    { key: "due", label: "Vencimiento", type: "date" },
    { key: "netTaxed", label: "Neto gravado", type: "money" },
    { key: "netUntaxed", label: "No gravado", type: "money" },
    { key: "netExempt", label: "Exento", type: "money" },
    { key: "vat", label: "IVA", type: "money" },
    { key: "perceptions", label: "Percepciones", type: "money" },
    { key: "otherTaxes", label: "Otros imp.", type: "money" },
    { key: "discount", label: "Descuentos", type: "money" },
    { key: "total", label: "Total", type: "money" },
    { key: "balance", label: "Saldo", type: "money" },
    { key: "status", label: "Estado", type: "text" },
  ];
  const notes = ["Las notas de crédito y los saldos iniciales acreedores se muestran con signo negativo.", "Importes en pesos (los comprobantes en moneda extranjera, a la cotización registrada)."];
  if (q.status !== "ACTIVE") notes.push("Los comprobantes anulados se listan pero no suman en los totales.");
  return {
    title: `${info.documents} registrados`,
    filters: [periodLabel(q.from, q.to), await partyFilterLabel(db, direction, q.party), typeLabel, `Estado: ${STATUS_FILTER[q.status]}`],
    tables: [{ columns, rows: out, totals, emptyMessage: "No hay comprobantes con esos filtros." }],
    notes,
    filename: `${info.slug}-comprobantes-${q.from}-${q.to}`,
  };
}

// ───────────────────────────── Cobranzas / pagos ─────────────────────────────

export async function settlementsReport(db: DbOrTx, direction: Direction, q: SettlementsReportQuery): Promise<ReportResult> {
  const info = SIDE_INFO[direction];
  const ar = direction === "ISSUED";
  const ops = r(ar ? "collections" : "supplier_payments");
  const lines = r(ar ? "collection_lines" : "payment_lines");
  const lineOp = r(ar ? "collection_id" : "payment_id");
  const opDate = r(ar ? "collection_date" : "payment_date");
  const voucher = r(ar ? "receipts" : "payment_orders");
  const { rows } = await db.execute<{
    id: number;
    date: string;
    voucher: string | null;
    party: string;
    tax_id: string | null;
    total: string;
    unapplied: string;
    status: string;
    cash: string;
    transfer: string;
    checks: string;
    retentions: string;
  }>(sql`
    SELECT o.id, o.${opDate}::text AS date, v.number AS voucher, p.legal_name AS party, p.tax_id, o.total_amount::text AS total,
           o.unapplied_amount::text AS unapplied, o.status,
           coalesce(sum(l.amount) FILTER (WHERE l.method = 'CASH'), 0)::text AS cash,
           coalesce(sum(l.amount) FILTER (WHERE l.method = 'TRANSFER'), 0)::text AS transfer,
           coalesce(sum(l.amount) FILTER (WHERE l.method IN ('CHECK','OWN_CHECK','THIRD_PARTY_CHECK')), 0)::text AS checks,
           coalesce(sum(l.amount) FILTER (WHERE l.method = 'RETENTION'), 0)::text AS retentions
      FROM ${ops} o
      JOIN ${r(info.partyTable)} p ON p.id = o.${r(info.partyCol)}
      LEFT JOIN ${voucher} v ON v.${lineOp} = o.id
      JOIN ${lines} l ON l.${lineOp} = o.id
     WHERE o.${opDate} BETWEEN ${q.from} AND ${q.to}
       ${q.party ? sql`AND o.${r(info.partyCol)} = ${q.party}` : sql``}
       ${q.status === "ACTIVE" ? sql`AND o.status = 'ACTIVE'` : q.status === "ANNULLED" ? sql`AND o.status = 'ANNULLED'` : sql``}
     GROUP BY o.id, v.number, p.legal_name, p.tax_id
     ORDER BY o.${opDate}, o.id`);
  const out: ReportRow[] = rows.map((o) => {
    const annulled = o.status === "ANNULLED";
    return {
      href: `${info.settlementPath}/${o.id}`,
      cells: {
        date: o.date,
        voucher: o.voucher ?? `#${o.id}`,
        party: o.party,
        taxId: o.tax_id,
        cash: m(o.cash),
        transfer: m(o.transfer),
        checks: m(o.checks),
        retentions: m(o.retentions),
        total: m(o.total),
        applied: annulled ? null : new Decimal(o.total).minus(o.unapplied).toFixed(2),
        unapplied: annulled ? null : m(o.unapplied),
        status: annulled ? "Anulada" : "Vigente",
      },
    };
  });
  const counted = out.filter((x) => x.cells.status === "Vigente");
  const totals: Record<string, string> = { voucher: `Total (${counted.length})` };
  for (const k of ["cash", "transfer", "checks", "retentions", "total", "applied", "unapplied"]) totals[k] = m(sumOf(counted, (x) => x.cells[k] as string | null));
  const notes = [ar ? "Cheques: cheques de terceros recibidos." : "Cheques: cheques propios emitidos y cheques de terceros entregados."];
  if (q.status !== "ACTIVE") notes.push("Las operaciones anuladas se listan pero no suman en los totales.");
  return {
    title: ar ? "Cobranzas" : "Pagos a proveedores",
    filters: [periodLabel(q.from, q.to), await partyFilterLabel(db, direction, q.party), `Estado: ${q.status === "ACTIVE" ? "vigentes" : q.status === "ANNULLED" ? "anuladas" : "vigentes y anuladas"}`],
    tables: [
      {
        columns: [
          { key: "date", label: "Fecha", type: "date" },
          { key: "voucher", label: info.voucher, type: "text" },
          { key: "party", label: info.party, type: "text" },
          { key: "taxId", label: "CUIT", type: "text" },
          { key: "cash", label: "Efectivo", type: "money" },
          { key: "transfer", label: "Transferencias", type: "money" },
          { key: "checks", label: "Cheques", type: "money" },
          { key: "retentions", label: ar ? "Retenciones sufridas" : "Retenciones practicadas", type: "money" },
          { key: "total", label: "Total", type: "money" },
          { key: "applied", label: "Imputado", type: "money" },
          { key: "unapplied", label: "Sin imputar", type: "money" },
          { key: "status", label: "Estado", type: "text" },
        ],
        rows: out,
        totals,
        emptyMessage: ar ? "No hay cobranzas con esos filtros." : "No hay pagos con esos filtros.",
      },
    ],
    notes,
    filename: `${ar ? "cobranzas" : "pagos"}-${q.from}-${q.to}`,
  };
}

// ───────────────────────────── Saldos (deuda) ─────────────────────────────

/** Saldo de cada tercero a la fecha de corte: vencido, a vencer y créditos sin aplicar. */
export async function balancesReport(db: DbOrTx, direction: Direction, q: CutoffQuery): Promise<ReportResult> {
  const info = SIDE_INFO[direction];
  const ar = direction === "ISSUED";
  const items = await openItemsAt(db, direction, q.cutoff, q.party);
  const { rows: parties, total } = agingByParty(items, q.cutoff);
  const limits = new Map<number, string | null>();
  if (ar && parties.length) {
    const { rows } = await db.execute<{ id: number; credit_limit: string | null }>(
      sql`SELECT id, credit_limit::text FROM clients WHERE id IN (${sql.join(parties.map((p) => sql`${p.partyId}`), sql`, `)})`,
    );
    for (const x of rows) limits.set(Number(x.id), x.credit_limit);
  }
  const out: ReportRow[] = parties.map((p) => {
    const limit = limits.get(p.partyId) ?? null;
    return {
      href: `${info.accountPath}/${p.partyId}`,
      cells: {
        code: p.partyCode,
        party: p.partyName,
        overdue: m(p.aging.overdueTotal),
        notDue: m(p.aging.notDueTotal),
        credit: p.aging.credit.isZero() ? null : m(p.aging.credit.neg()),
        balance: m(p.aging.balance),
        maxDays: p.aging.maxDaysOverdue || null,
        ...(ar ? { limit: limit ? m(limit) : null, overLimit: limit && p.aging.balance.greaterThan(limit) ? "Excedido" : null } : {}),
      },
    };
  });
  const ledger = await ledgerBalancesAt(db, direction, q.cutoff, q.party);
  const ledgerTotal = sumOf([...ledger.values()], (v) => v);
  const columns: ReportColumn[] = [
    { key: "code", label: "Código", type: "text" },
    { key: "party", label: info.party, type: "text" },
    { key: "overdue", label: "Vencido", type: "money" },
    { key: "notDue", label: "A vencer", type: "money" },
    { key: "credit", label: "Créditos sin aplicar", type: "money" },
    { key: "balance", label: "Saldo", type: "money" },
    { key: "maxDays", label: "Máx. días de atraso", type: "int" },
  ];
  if (ar) columns.push({ key: "limit", label: "Límite de crédito", type: "money" }, { key: "overLimit", label: "Límite", type: "text" });
  return {
    title: ar ? "Deuda de clientes" : "Deuda con proveedores",
    filters: [`Fecha de corte: ${formatDate(q.cutoff)}`, await partyFilterLabel(db, direction, q.party)],
    tables: [
      {
        columns,
        rows: out,
        totals: { party: `Total (${out.length})`, overdue: m(total.overdueTotal), notDue: m(total.notDueTotal), credit: m(total.credit.neg()), balance: m(total.balance) },
        emptyMessage: "No hay saldos a esa fecha.",
      },
    ],
    notes: [reconciliation(total.balance, ledgerTotal, q.cutoff)],
    filename: `${info.slug}-deuda-${q.cutoff}`,
  };
}

/** Control: total del reporte contra el saldo del libro de cuentas corrientes (G.14-8). */
function reconciliation(reportTotal: Decimal, ledgerTotal: Decimal, cutoff: string) {
  const diff = reportTotal.minus(ledgerTotal);
  return `Control: saldo de cuentas corrientes al ${formatDate(cutoff)} ${formatMoney(ledgerTotal)}; diferencia con el reporte ${formatMoney(diff)}${diff.isZero() ? "" : " (revisar con la verificación de consistencia)"}.`;
}

// ───────────────────────────── Vencimientos ─────────────────────────────

export async function dueReport(db: DbOrTx, direction: Direction, q: DueReportQuery, today: string): Promise<ReportResult> {
  const info = SIDE_INFO[direction];
  const items = (await openItemsAt(db, direction, today, q.party)).filter((i) => i.kind === "DEBT" && i.dueDate! <= q.to && (!q.from || i.dueDate! >= q.from));
  items.sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || a.partyName.localeCompare(b.partyName, "es") || a.id - b.id);
  let overdue = new Decimal(0);
  let notDue = new Decimal(0);
  const out: ReportRow[] = items.map((i) => {
    const c = classify(i, today)!;
    if (c.overdue) overdue = overdue.plus(i.open);
    else notDue = notDue.plus(i.open);
    return {
      href: i.source === "DOCUMENT" ? `${info.documentPath}/${i.id}` : `${info.settlementPath}/${i.id}`,
      cells: {
        due: i.dueDate,
        situation: c.overdue ? `Vencido hace ${c.days} d` : c.days === 0 ? "Vence hoy" : `Vence en ${c.days} d`,
        party: i.partyName,
        document: i.description,
        date: i.date,
        total: i.total,
        open: i.open,
      },
    };
  });
  return {
    title: direction === "ISSUED" ? "Vencimientos de clientes" : "Vencimientos con proveedores",
    filters: [q.from ? `Vencimientos del ${formatDate(q.from)} al ${formatDate(q.to)}` : `Vencidos y a vencer hasta el ${formatDate(q.to)}`, await partyFilterLabel(db, direction, q.party)],
    tables: [
      {
        columns: [
          { key: "due", label: "Vencimiento", type: "date" },
          { key: "situation", label: "Situación", type: "text" },
          { key: "party", label: info.party, type: "text" },
          { key: "document", label: "Comprobante", type: "text" },
          { key: "date", label: "Emisión", type: "date" },
          { key: "total", label: "Total", type: "money" },
          { key: "open", label: "Pendiente", type: "money" },
        ],
        rows: out,
        totals: { situation: `Total (${out.length})`, open: m(overdue.plus(notDue)) },
        emptyMessage: "No hay vencimientos pendientes con esos filtros.",
      },
    ],
    notes: [`Vencido: ${formatMoney(overdue)} · A vencer: ${formatMoney(notDue)}. Saldos pendientes al ${formatDate(today)}.`],
    filename: `${info.slug}-vencimientos-${q.to}`,
  };
}

// ───────────────────────────── Antigüedad de saldos ─────────────────────────────

function agingColumns(partyLabel: string): ReportColumn[] {
  return [
    { key: "party", label: partyLabel, type: "text" },
    ...AGING_BUCKETS.map((b) => ({ key: `o_${b.key}`, label: b.label, type: "money" as const, group: "Vencido (días desde el vencimiento)" })),
    { key: "overdue", label: "Total vencido", type: "money", group: "Vencido (días desde el vencimiento)" },
    ...AGING_BUCKETS.map((b) => ({ key: `n_${b.key}`, label: b.label, type: "money" as const, group: "A vencer (días hasta el vencimiento)" })),
    { key: "notDue", label: "Total a vencer", type: "money", group: "A vencer (días hasta el vencimiento)" },
    { key: "credit", label: "Créditos sin aplicar", type: "money" },
    { key: "balance", label: "Saldo", type: "money" },
  ];
}

export async function agingReport(db: DbOrTx, direction: Direction, q: CutoffQuery): Promise<ReportResult> {
  const info = SIDE_INFO[direction];
  const items = await openItemsAt(db, direction, q.cutoff, q.party);
  const { rows: parties, total } = agingByParty(items, q.cutoff);
  const cells = (a: (typeof total)) => {
    const c: Record<string, string | null> = {};
    for (const b of AGING_BUCKETS) {
      c[`o_${b.key}`] = a.overdue[b.key].isZero() ? null : m(a.overdue[b.key]);
      c[`n_${b.key}`] = a.notDue[b.key].isZero() ? null : m(a.notDue[b.key]);
    }
    c.overdue = m(a.overdueTotal);
    c.notDue = m(a.notDueTotal);
    c.credit = a.credit.isZero() ? null : m(a.credit.neg());
    c.balance = m(a.balance);
    return c;
  };
  const summary: ReportRow[] = parties.map((p) => ({ href: `${info.accountPath}/${p.partyId}`, cells: { party: p.partyName, ...cells(p.aging) } }));
  const totals = { party: `Total (${parties.length})`, ...cells(total) };
  for (const k of Object.keys(totals)) if (totals[k as keyof typeof totals] === null) (totals as Record<string, string | null>)[k] = "0.00";

  const tables: ReportResult["tables"] = [{ title: "Resumen por tercero", columns: agingColumns(info.party), rows: summary, totals, emptyMessage: "No hay saldos a esa fecha." }];
  const notes = [
    "Tramos: 0–30, 31–60, 61–90, 91–180 y más de 180 días. Vencido: días desde el vencimiento; a vencer: días hasta el vencimiento (vence hoy = a vencer, 0 días).",
    "Los créditos sin aplicar (notas de crédito y cobranzas o pagos sin imputar) van en columna aparte, con signo negativo, para que el saldo coincida con la cuenta corriente.",
  ];
  if (q.party) tables.push(agingDetail(items, q.cutoff, info));
  else notes.push("Elija un tercero para ver el detalle por comprobante.");
  const ledger = sumOf([...(await ledgerBalancesAt(db, direction, q.cutoff, q.party)).values()], (v) => v);
  notes.push(reconciliation(total.balance, ledger, q.cutoff));
  return {
    title: direction === "ISSUED" ? "Antigüedad de saldos – cuentas por cobrar" : "Antigüedad de saldos – cuentas por pagar",
    filters: [`Fecha de corte: ${formatDate(q.cutoff)}`, await partyFilterLabel(db, direction, q.party)],
    tables,
    notes,
    filename: `${info.slug}-antiguedad-${q.cutoff}`,
  };
}

function agingDetail(items: OpenItem[], cutoff: string, info: (typeof SIDE_INFO)[Direction]) {
  const label = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, b.label]));
  const rows: ReportRow[] = items.map((i) => {
    const c = classify(i, cutoff);
    return {
      href: i.source === "DOCUMENT" ? `${info.documentPath}/${i.id}` : `${info.settlementPath}/${i.id}`,
      cells: {
        document: i.description,
        date: i.date,
        due: i.dueDate,
        situation: c ? (c.overdue ? "Vencido" : "A vencer") : "Crédito sin aplicar",
        days: c ? c.days : null,
        bucket: c ? label[c.bucket]! : null,
        open: c ? i.open : m(new Decimal(i.open).neg()),
      },
    };
  });
  return {
    title: "Detalle por comprobante",
    columns: [
      { key: "document", label: "Comprobante / operación", type: "text" },
      { key: "date", label: "Fecha", type: "date" },
      { key: "due", label: "Vencimiento", type: "date" },
      { key: "situation", label: "Situación", type: "text" },
      { key: "days", label: "Días", type: "int" },
      { key: "bucket", label: "Tramo", type: "text" },
      { key: "open", label: "Importe", type: "money" },
    ] satisfies ReportColumn[],
    rows,
    totals: { document: "Saldo", open: m(sumOf(rows, (x) => x.cells.open as string)) },
  };
}

// ───────────────────────────── Cuenta corriente ─────────────────────────────

const ENTRY_LABELS = { DOCUMENT: "Comprobante", COLLECTION: "Cobranza", PAYMENT: "Pago", REVERSAL: "Anulación" } as const;

export async function statementReport(db: DbOrTx, ctx: ServiceContext, direction: Direction, q: StatementReportQuery): Promise<ReportResult> {
  const info = SIDE_INFO[direction];
  const base = {
    title: `Cuenta corriente de ${direction === "ISSUED" ? "cliente" : "proveedor"}`,
    filters: [periodLabel(q.from, q.to), await partyFilterLabel(db, direction, q.party)],
    filename: `${info.slug}-cuenta-corriente-${q.party ?? "sin-tercero"}-${q.to}`,
  };
  if (!q.party) return { ...base, tables: [], notes: [`Elija un ${info.party.toLowerCase()} para ver su cuenta corriente.`] };
  const st = await accountStatement(db, ctx, direction, q.party, { from: q.from, to: q.to });
  const rows: ReportRow[] = [
    { style: "subtotal", cells: { description: "Saldo anterior", balance: st.opening } },
    ...st.rows.map(
      (e): ReportRow => ({
        href: e.documentId ? `${info.documentPath}/${e.documentId}` : e.operationId ? `${info.settlementPath}/${e.operationId}` : undefined,
        cells: {
          date: e.entryDate,
          type: ENTRY_LABELS[e.entryType],
          description: e.voucherNumber ? `${e.description} (${e.voucherNumber})` : e.description,
          debit: e.debit === "0.00" ? null : e.debit,
          credit: e.credit === "0.00" ? null : e.credit,
          balance: e.balance,
        },
      }),
    ),
  ];
  return {
    ...base,
    tables: [
      {
        columns: [
          { key: "date", label: "Fecha", type: "date" },
          { key: "type", label: "Tipo", type: "text" },
          { key: "description", label: "Comprobante / concepto", type: "text" },
          { key: "debit", label: "Débito", type: "money" },
          { key: "credit", label: "Crédito", type: "money" },
          { key: "balance", label: "Saldo", type: "money" },
        ],
        rows,
        totals: { description: "Totales del período / saldo final", debit: st.totalDebit, credit: st.totalCredit, balance: st.closing },
      },
    ],
    notes: ["Débito: aumenta la deuda del tercero (o con el proveedor). Crédito: la disminuye. Saldo negativo: a favor del tercero."],
  };
}

// ───────────────────────────── Retenciones ─────────────────────────────

/** Retenciones sufridas (en cobranzas) o practicadas (en pagos) del período, por fecha de retención. */
export async function retentionsReport(db: DbOrTx, direction: Direction, q: PartyPeriodQuery): Promise<ReportResult> {
  const info = SIDE_INFO[direction];
  const ar = direction === "ISSUED";
  const ops = r(ar ? "collections" : "supplier_payments");
  const lines = r(ar ? "collection_lines" : "payment_lines");
  const lineOp = r(ar ? "collection_id" : "payment_id");
  const voucher = r(ar ? "receipts" : "payment_orders");
  const { rows } = await db.execute<{
    op_id: number;
    date: string;
    voucher: string | null;
    party: string;
    tax_id: string | null;
    tax_name: string;
    jurisdiction: string | null;
    certificate: string;
    amount: string;
  }>(sql`
    SELECT o.id AS op_id, l.retention_date::text AS date, v.number AS voucher, p.legal_name AS party, p.tax_id,
           tc.name AS tax_name, pr.name AS jurisdiction, l.retention_certificate AS certificate, l.amount::text
      FROM ${lines} l
      JOIN ${ops} o ON o.id = l.${lineOp}
      JOIN ${r(info.partyTable)} p ON p.id = o.${r(info.partyCol)}
      LEFT JOIN ${voucher} v ON v.${lineOp} = o.id
      JOIN tax_catalog tc ON tc.id = l.retention_tax_id
      LEFT JOIN provinces pr ON pr.id = tc.jurisdiction_id
     WHERE l.method = 'RETENTION' AND o.status = 'ACTIVE' AND l.retention_date BETWEEN ${q.from} AND ${q.to}
       ${q.party ? sql`AND o.${r(info.partyCol)} = ${q.party}` : sql``}
     ORDER BY l.retention_date, l.id`);
  const out: ReportRow[] = rows.map((x) => ({
    href: `${info.settlementPath}/${x.op_id}`,
    cells: { date: x.date, party: x.party, taxId: x.tax_id, tax: x.tax_name, jurisdiction: x.jurisdiction, certificate: x.certificate, voucher: x.voucher ?? `#${x.op_id}`, amount: m(x.amount) },
  }));
  const byTax = new Map<string, Decimal>();
  for (const x of rows) {
    const k = x.jurisdiction ? `${x.tax_name} – ${x.jurisdiction}` : x.tax_name;
    byTax.set(k, (byTax.get(k) ?? new Decimal(0)).plus(x.amount));
  }
  const total = sumOf(rows, (x) => x.amount);
  return {
    title: ar ? "Retenciones sufridas" : "Retenciones practicadas",
    filters: [periodLabel(q.from, q.to), await partyFilterLabel(db, direction, q.party)],
    tables: [
      {
        columns: [
          { key: "date", label: "Fecha", type: "date" },
          { key: "party", label: info.party, type: "text" },
          { key: "taxId", label: "CUIT", type: "text" },
          { key: "tax", label: "Impuesto", type: "text" },
          { key: "jurisdiction", label: "Jurisdicción", type: "text" },
          { key: "certificate", label: "Certificado", type: "text" },
          { key: "voucher", label: info.voucher, type: "text" },
          { key: "amount", label: "Importe", type: "money" },
        ],
        rows: out,
        totals: { party: `Total (${out.length})`, amount: m(total) },
        emptyMessage: "No hay retenciones en el período.",
      },
      {
        title: "Totales por impuesto",
        columns: [
          { key: "tax", label: "Impuesto", type: "text" },
          { key: "amount", label: "Importe", type: "money" },
        ],
        rows: [...byTax.entries()].sort(([a], [b]) => a.localeCompare(b, "es")).map(([tax, amount]) => ({ cells: { tax, amount: m(amount) } })),
        totals: { tax: "Total", amount: m(total) },
      },
    ],
    notes: ["Solo retenciones de operaciones vigentes (las de cobranzas o pagos anulados no se incluyen)."],
    filename: `${ar ? "retenciones-sufridas" : "retenciones-practicadas"}-${q.from}-${q.to}`,
  };
}
