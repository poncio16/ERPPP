import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { DbOrTx } from "@/server/db/drizzle";
import { m, SIDE_INFO } from "./common";
import { openItemsAt } from "./open-items";
import type { CashFlowQuery } from "./schemas";
import type { ReportColumn, ReportResult, ReportRow } from "./types";

/**
 * Flujo de fondos (G.15).
 * - Saldo real inicial: caja + bancos (saldo contable) al comenzar el día de inicio.
 * - Real: ingresos y egresos registrados en tesorería desde el inicio (sin transferencias internas).
 * - Proyectado (desde hoy): saldos de comprobantes emitidos y recibidos por vencimiento, cheques de
 *   terceros en cartera (y depositados a acreditar) por fecha de pago, cheques propios pendientes
 *   de débito por fecha de pago e ingresos/egresos planificados (con recurrencia mensual).
 * - Lo vencido e impago va a la columna "Atrasado", al comienzo; no se esconde ni se da por cobrado hoy.
 */

export type FlowLine = "AR" | "CHECKS_IN" | "PLANNED_IN" | "AP" | "CHECKS_OUT" | "PLANNED_OUT";

export const FLOW_LINES: { key: FlowLine; label: string; sign: 1 | -1 }[] = [
  { key: "AR", label: "Cobranzas de comprobantes emitidos", sign: 1 },
  { key: "CHECKS_IN", label: "Cheques de terceros a cobrar", sign: 1 },
  { key: "PLANNED_IN", label: "Otros ingresos planificados", sign: 1 },
  { key: "AP", label: "Pagos de comprobantes recibidos", sign: -1 },
  { key: "CHECKS_OUT", label: "Cheques propios a debitar", sign: -1 },
  { key: "PLANNED_OUT", label: "Otros egresos planificados", sign: -1 },
];

export interface FlowPeriod {
  key: string;
  label: string;
  from: string;
  to: string;
  /** El período empieza después de hoy: todo lo que tiene es proyectado (el que contiene hoy mezcla real y proyectado). */
  projected: boolean;
}

export interface ProjectedItem {
  line: FlowLine;
  date: string;
  /** Clave del período, o "late" para atrasados. */
  period: string;
  description: string;
  party: string | null;
  amount: string;
  href: string | null;
}

export interface CashFlow {
  start: string;
  today: string;
  view: CashFlowQuery["view"];
  periods: FlowPeriod[];
  opening: string;
  realIn: Record<string, string>;
  realOut: Record<string, string>;
  projected: Record<FlowLine, Record<string, string>>;
  net: Record<string, string>;
  /** Saldo al inicio de cada columna (atrasado incluido). */
  startBalance: Record<string, string>;
  endBalance: Record<string, string>;
  items: ProjectedItem[];
  /** Proyectados posteriores al horizonte (no incluidos). */
  beyondIn: string;
  beyondOut: string;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const endOfMonth = (iso: string) => {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0, 12));
  return d.toISOString().slice(0, 10);
};

/** Suma n meses manteniendo el día original (31 → último día del mes si no existe). */
export function addMonthsClamped(iso: string, n: number) {
  const y = Number(iso.slice(0, 4));
  const mo = Number(iso.slice(5, 7)) - 1 + n;
  const day = Number(iso.slice(8, 10));
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, mo, Math.min(day, last), 12)).toISOString().slice(0, 10);
}

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export function buildPeriods(start: string, view: CashFlowQuery["view"], count: number, today: string): FlowPeriod[] {
  const out: FlowPeriod[] = [];
  let from = start;
  for (let i = 0; i < count; i++) {
    const to = view === "WEEK" ? addDays(from, 6) : endOfMonth(from);
    const label =
      view === "WEEK"
        ? `${formatDate(from).slice(0, 5)} al ${formatDate(to).slice(0, 5)}`
        : `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}${from.slice(8) === "01" ? "" : ` (desde ${from.slice(8)})`}`;
    out.push({ key: `p${i}`, label, from, to, projected: from > today });
    from = addDays(to, 1);
  }
  return out;
}

export async function cashFlow(db: DbOrTx, q: CashFlowQuery, today: string): Promise<CashFlow> {
  const periods = buildPeriods(q.start, q.view, q.periods, today);
  const horizon = periods.at(-1)!.to;
  const periodOf = (date: string) => (date < today ? "late" : (periods.find((p) => date >= p.from && date <= p.to)?.key ?? null));
  const keys = ["late", ...periods.map((p) => p.key)];
  const zero = () => Object.fromEntries(keys.map((k) => [k, new Decimal(0)])) as Record<string, Decimal>;

  // ── Real ──
  const { rows: op } = await db.execute<{ v: string }>(
    sql`SELECT coalesce(sum(CASE WHEN direction = 'IN' THEN amount ELSE -amount END), 0)::text AS v FROM treasury_movements WHERE movement_date < ${q.start}`,
  );
  const opening = new Decimal(op[0]?.v ?? 0);
  const { rows: real } = await db.execute<{ bucket: "IN" | "OUT"; d: string; amount: string }>(sql`
    SELECT coalesce(o.direction, m.direction) AS bucket, m.movement_date::text AS d,
           sum(CASE WHEN m.origin_type = 'REVERSAL' THEN -m.amount ELSE m.amount END)::text AS amount
      FROM treasury_movements m LEFT JOIN treasury_movements o ON o.id = m.reversal_of_id
     WHERE m.movement_date BETWEEN ${q.start} AND ${horizon}
       AND coalesce(o.origin_type, m.origin_type) <> 'ACCOUNT_TRANSFER'
     GROUP BY 1, 2`);
  const realIn = zero();
  const realOut = zero();
  for (const r of real) {
    const p = periods.find((x) => r.d >= x.from && r.d <= x.to);
    if (!p) continue;
    if (r.bucket === "IN") realIn[p.key] = realIn[p.key]!.plus(r.amount);
    else realOut[p.key] = realOut[p.key]!.plus(r.amount);
  }

  // ── Proyectado (situación de hoy) ──
  const items: ProjectedItem[] = [];
  let beyondIn = new Decimal(0);
  let beyondOut = new Decimal(0);
  const push = (line: FlowLine, date: string, description: string, party: string | null, amount: string, href: string | null) => {
    const period = periodOf(date);
    if (!period) {
      if (FLOW_LINES.find((l) => l.key === line)!.sign > 0) beyondIn = beyondIn.plus(amount);
      else beyondOut = beyondOut.plus(amount);
      return;
    }
    items.push({ line, date, period, description, party, amount: m(amount), href });
  };

  for (const [direction, line] of [["ISSUED", "AR"], ["RECEIVED", "AP"]] as const) {
    const info = SIDE_INFO[direction];
    for (const i of await openItemsAt(db, direction, today)) {
      if (i.kind !== "DEBT") continue;
      push(line, i.dueDate!, i.description, i.partyName, i.open, i.source === "DOCUMENT" ? `${info.documentPath}/${i.id}` : null);
    }
  }

  const { rows: received } = await db.execute<{ id: number; payment_date: string; status: string; number: string; bank: string; drawer: string; amount: string }>(sql`
    SELECT c.id, c.payment_date::text, c.status, c.number, b.name AS bank, c.drawer_name AS drawer, c.amount::text
      FROM received_checks c JOIN banks b ON b.id = c.issuer_bank_id
     WHERE c.status IN ('IN_PORTFOLIO','DEPOSITED')`);
  for (const c of received) {
    // Un cheque ya depositado se espera acreditado desde hoy aunque su fecha de pago haya pasado.
    const date = c.status === "DEPOSITED" && c.payment_date < today ? today : c.payment_date;
    push("CHECKS_IN", date, `Cheque ${c.bank} N° ${c.number}${c.status === "DEPOSITED" ? " (depositado)" : ""}`, c.drawer, c.amount, `/cheques/recibidos/${c.id}`);
  }

  const { rows: issued } = await db.execute<{ id: number; payment_date: string; number: string; account: string; supplier: string | null; amount: string }>(sql`
    SELECT c.id, c.payment_date::text, c.number, a.display_name AS account, s.legal_name AS supplier, c.amount::text
      FROM issued_checks c JOIN bank_accounts a ON a.id = c.bank_account_id LEFT JOIN suppliers s ON s.id = c.supplier_id
     WHERE c.status IN ('ISSUED','DELIVERED','PRESENTED')`);
  for (const c of issued) push("CHECKS_OUT", c.payment_date, `Cheque propio ${c.account} N° ${c.number}`, c.supplier, c.amount, `/cheques/emitidos/${c.id}`);

  const { rows: planned } = await db.execute<{ id: number; direction: "IN" | "OUT"; expected_date: string; amount: string; description: string; recurrence: string | null }>(sql`
    SELECT id, direction, expected_date::text, amount::text, description, recurrence FROM planned_cash_items WHERE status = 'PLANNED' ORDER BY expected_date, id`);
  for (const p of planned) {
    const line = p.direction === "IN" ? "PLANNED_IN" : "PLANNED_OUT";
    if (p.recurrence !== "MONTHLY") {
      push(line, p.expected_date, p.description, null, p.amount, "/tesoreria");
      continue;
    }
    // Recurrencia mensual: las ocurrencias desde hoy hasta el horizonte (las pasadas se consideran resueltas).
    for (let n = 0; ; n++) {
      const date = addMonthsClamped(p.expected_date, n);
      if (date > horizon) break;
      if (date >= today) push(line, date, `${p.description} (mensual)`, null, p.amount, "/tesoreria");
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.line.localeCompare(b.line));

  const projected = Object.fromEntries(FLOW_LINES.map((l) => [l.key, zero()])) as Record<FlowLine, Record<string, Decimal>>;
  for (const i of items) projected[i.line][i.period] = projected[i.line][i.period]!.plus(i.amount);

  const net = zero();
  const startBalance: Record<string, Decimal> = {};
  const endBalance: Record<string, Decimal> = {};
  let running = opening;
  for (const k of keys) {
    startBalance[k] = running;
    let n = realIn[k]!.minus(realOut[k]!);
    for (const l of FLOW_LINES) n = n.plus(projected[l.key][k]!.mul(l.sign));
    net[k] = n;
    running = running.plus(n);
    endBalance[k] = running;
  }
  const fix = (r: Record<string, Decimal>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, m(v)]));
  return {
    start: q.start,
    today,
    view: q.view,
    periods,
    opening: m(opening),
    realIn: fix(realIn),
    realOut: fix(realOut),
    projected: Object.fromEntries(FLOW_LINES.map((l) => [l.key, fix(projected[l.key])])) as Record<FlowLine, Record<string, string>>,
    net: fix(net),
    startBalance: fix(startBalance),
    endBalance: fix(endBalance),
    items,
    beyondIn: m(beyondIn),
    beyondOut: m(beyondOut),
  };
}

export async function cashFlowReport(db: DbOrTx, q: CashFlowQuery, today: string): Promise<ReportResult> {
  const f = await cashFlow(db, q, today);
  const keys = ["late", ...f.periods.map((p) => p.key)];
  const columns: ReportColumn[] = [
    { key: "concept", label: "Concepto", type: "text" },
    { key: "late", label: "Atrasado", type: "money", projected: true },
    ...f.periods.map((p): ReportColumn => ({ key: p.key, label: p.label, type: "money", projected: p.projected })),
    { key: "total", label: "Total", type: "money" },
  ];
  const sumRow = (r: Record<string, string>, sign = 1) => {
    const total = keys.reduce((a, k) => a.plus(r[k] ?? 0), new Decimal(0)).mul(sign);
    return { ...Object.fromEntries(keys.map((k) => [k, new Decimal(r[k] ?? 0).mul(sign).toFixed(2)])), total: total.toFixed(2) };
  };
  // Lo real no tiene columna de atrasado ni valores en períodos futuros.
  const realOnly = <T extends Record<string, string | null>>(r: T) => ({ ...r, late: null, ...Object.fromEntries(f.periods.filter((p) => p.projected).map((p) => [p.key, null])) });
  const rows: ReportRow[] = [
    { style: "subtotal", cells: { concept: "Saldo inicial (caja + bancos)", ...f.startBalance, total: f.opening } },
    { style: "section", cells: { concept: "Real: movimientos registrados" } },
    { cells: realOnly({ concept: "Ingresos", ...sumRow(f.realIn) }) },
    { cells: realOnly({ concept: "Egresos", ...sumRow(f.realOut, -1) }) },
    { style: "section", projected: true, cells: { concept: "Proyectado" } },
    ...FLOW_LINES.map((l): ReportRow => ({ projected: true, cells: { concept: l.label, ...sumRow(f.projected[l.key], l.sign) } })),
    { style: "subtotal", cells: { concept: "Flujo neto", ...sumRow(f.net) } },
    { style: "total", cells: { concept: "Saldo final proyectado", ...f.endBalance, total: f.endBalance[keys.at(-1)!]! } },
  ];
  const lineLabel = Object.fromEntries(FLOW_LINES.map((l) => [l.key, l.label]));
  const lineSign = Object.fromEntries(FLOW_LINES.map((l) => [l.key, l.sign]));
  const periodLabel = Object.fromEntries([["late", "Atrasado"], ...f.periods.map((p) => [p.key, p.label])]);
  const notes = [
    `Saldo real inicial al ${formatDate(f.start)}: ${formatMoney(f.opening)} (caja + bancos, saldo contable).`,
    "Real: ingresos y egresos ya registrados en caja y bancos (las transferencias entre cuentas propias no cuentan). Proyectado (en tono atenuado): lo que se espera cobrar y pagar desde hoy.",
    "Atrasado: comprobantes vencidos e impagos, cheques en cartera con fecha de pago vencida, cheques propios no debitados y planificados sin realizar con fecha anterior a hoy.",
    "Los cheques depositados a acreditar se proyectan en su fecha de pago o, si ya pasó, hoy. Los créditos sin aplicar (notas de crédito, anticipos) no se proyectan.",
  ];
  if (!new Decimal(f.beyondIn).plus(f.beyondOut).isZero()) {
    notes.push(`Después del horizonte quedan ingresos proyectados por ${formatMoney(f.beyondIn)} y egresos por ${formatMoney(f.beyondOut)}, no incluidos.`);
  }
  return {
    title: "Flujo de fondos",
    filters: [`Desde ${formatDate(f.start)}`, `Vista ${f.view === "WEEK" ? "semanal" : "mensual"}, ${f.periods.length} períodos (hasta ${formatDate(f.periods.at(-1)!.to)})`, `Proyección al ${formatDate(f.today)}`],
    tables: [
      { columns, rows },
      {
        title: "Detalle de lo proyectado",
        columns: [
          { key: "date", label: "Fecha", type: "date" },
          { key: "period", label: "Columna", type: "text" },
          { key: "line", label: "Rubro", type: "text" },
          { key: "description", label: "Detalle", type: "text" },
          { key: "party", label: "Tercero", type: "text" },
          { key: "amount", label: "Importe", type: "money" },
        ],
        rows: f.items.map((i) => ({
          projected: true,
          href: i.href ?? undefined,
          cells: { date: i.date, period: periodLabel[i.period]!, line: lineLabel[i.line]!, description: i.description, party: i.party, amount: new Decimal(i.amount).mul(lineSign[i.line]!).toFixed(2) },
        })),
        totals: { description: "Neto proyectado", amount: m(f.items.reduce((a, i) => a.plus(new Decimal(i.amount).mul(lineSign[i.line]!)), new Decimal(0))) },
        emptyMessage: "No hay nada proyectado en el horizonte.",
      },
    ],
    notes,
    filename: `flujo-de-fondos-${f.view === "WEEK" ? "semanal" : "mensual"}-${f.start}`,
  };
}
