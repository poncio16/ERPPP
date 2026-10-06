import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { formatMoney } from "@/lib/money";
import { listAccounts } from "@/modules/accounts/service";
import { consolidatedPosition, incomeExpenseByConcept } from "@/modules/treasury/consolidated";
import type { ServiceContext } from "@/server/context";
import type { DbOrTx } from "@/server/db/drizzle";
import { SIDE_INFO } from "./common";
import { cashFlow } from "./cash-flow";
import { agingByParty, ledgerBalancesAt, openItemsAt } from "./open-items";
import { issuedChecksReport, receivedChecksReport } from "./treasury-reports";
import { vatBookReport } from "./vat-book";

const ALL_DATES = "9999-12-31";

/**
 * Invariante G.14-8: los totales de los reportes coinciden con los de los módulos de origen.
 * Devuelve una fila por comparación que no cierra (vacío = todo en $0,00).
 */
export async function reportReconciliation(db: DbOrTx, ctx: ServiceContext, today: string): Promise<{ label: string; diff: string }[]> {
  const out: { label: string; diff: string }[] = [];
  const compare = (label: string, report: Decimal | string | number, source: Decimal | string | number) => {
    const diff = new Decimal(report).minus(source);
    if (!diff.isZero()) out.push({ label: `${label}: reporte ${formatMoney(new Decimal(report))}, módulo de origen ${formatMoney(new Decimal(source))}`, diff: diff.toFixed(2) });
  };

  // Antigüedad / deuda contra cuentas corrientes: totales y saldo de cada tercero. Las partidas se
  // toman sin fecha de corte (los comprobantes pueden tener fecha futura) y se clasifican respecto de hoy,
  // igual que en el listado de cuentas corrientes.
  for (const direction of ["ISSUED", "RECEIVED"] as const) {
    const parties = SIDE_INFO[direction].parties;
    const { rows, total } = agingByParty(await openItemsAt(db, direction, ALL_DATES), today);
    const accounts = await listAccounts(db, ctx, direction, { q: "", filter: "ALL", page: 1 });
    compare(`${parties} – saldo total`, total.balance, accounts.totals.balance);
    compare(`${parties} – vencido`, total.overdueTotal, accounts.totals.overdue);
    compare(`${parties} – a vencer`, total.notDueTotal, accounts.totals.notDue);
    compare(`${parties} – créditos sin aplicar`, total.credit, accounts.totals.credit);
    const ledger = await ledgerBalancesAt(db, direction, ALL_DATES);
    const seen = new Set<number>();
    for (const p of rows) {
      seen.add(p.partyId);
      compare(`${parties} – ${p.partyName}`, p.aging.balance, ledger.get(p.partyId) ?? 0);
    }
    for (const [id, balance] of ledger) if (!seen.has(id) && !balance.isZero()) compare(`${parties} – tercero #${id}`, 0, balance);
  }

  // Tesorería: cartera, cheques propios pendientes y flujo de fondos contra la posición consolidada.
  const position = (await consolidatedPosition(db, ctx)).totals;
  const portfolio = await receivedChecksReport(db, { status: "IN_PORTFOLIO" }, today);
  compare("Cartera de cheques", String(portfolio.tables[0]!.totals!.amount), position.portfolio);
  const own = await issuedChecksReport(db, { status: "PENDING" }, today);
  compare("Cheques propios pendientes de débito", String(own.tables[0]!.totals!.amount), position.ownPending);
  const flow = await cashFlow(db, { start: today, view: "WEEK", periods: 1 }, today);
  const realToday = new Decimal(flow.realIn.p0!).minus(flow.realOut.p0!);
  const { rows: later } = await db.execute<{ v: string }>(sql`
    SELECT coalesce(sum(CASE WHEN m.direction = 'IN' THEN m.amount ELSE -m.amount END), 0)::text AS v
      FROM treasury_movements m LEFT JOIN treasury_movements o ON o.id = m.reversal_of_id
     WHERE m.movement_date > ${flow.periods[0]!.to} OR (m.movement_date >= ${today} AND coalesce(o.origin_type, m.origin_type) = 'ACCOUNT_TRANSFER')`);
  compare("Flujo de fondos – saldo real (caja + bancos)", new Decimal(flow.opening).plus(realToday).plus(later[0]?.v ?? 0), position.liquid);

  // Ingresos y egresos por concepto (histórico) + saldos iniciales = caja + bancos.
  const { rows: span } = await db.execute<{ first: string | null; last: string | null; opening: string; transfers: string }>(sql`
    SELECT min(movement_date)::text AS first, max(movement_date)::text AS last,
           coalesce(sum(CASE WHEN direction = 'IN' THEN amount ELSE -amount END) FILTER (WHERE origin_type = 'OPENING'
             OR reversal_of_id IN (SELECT id FROM treasury_movements WHERE origin_type = 'OPENING')), 0)::text AS opening,
           coalesce(sum(CASE WHEN direction = 'IN' THEN amount ELSE -amount END) FILTER (WHERE origin_type = 'ACCOUNT_TRANSFER'
             OR reversal_of_id IN (SELECT id FROM treasury_movements WHERE origin_type = 'ACCOUNT_TRANSFER')), 0)::text AS transfers
      FROM treasury_movements`);
  const s = span[0]!;
  if (s.first && s.last) {
    const concepts = await incomeExpenseByConcept(db, ctx, s.first, s.last);
    compare("Ingresos y egresos por concepto + saldos iniciales + transferencias", new Decimal(concepts.net).plus(s.opening).plus(s.transfers), position.liquid);
  }

  // Subdiario de IVA: los componentes por línea cierran con los del comprobante, y el total con el de comprobantes.
  const { rows: lines } = await db.execute<{ label: string; diff: string }>(sql`
    WITH x AS (
      SELECT d.id, t.name || ' ' || lpad(d.point_of_sale::text, 5, '0') || '-' || lpad(d.number::text, 8, '0') AS doc,
             d.net_taxed, d.vat_total, d.perceptions_total, d.other_taxes_total,
             coalesce(sum(l.base_amount) FILTER (WHERE l.kind = 'VAT'), 0) AS l_net,
             coalesce(sum(l.amount) FILTER (WHERE l.kind = 'VAT'), 0) AS l_vat,
             coalesce(sum(l.amount) FILTER (WHERE l.kind = 'PERCEPTION'), 0) AS l_perc,
             coalesce(sum(l.amount) FILTER (WHERE l.kind = 'OTHER_TAX'), 0) AS l_other
        FROM documents d JOIN document_types t ON t.id = d.document_type_id LEFT JOIN document_tax_lines l ON l.document_id = d.id
       WHERE d.status <> 'ANNULLED'
       GROUP BY d.id, t.name)
    SELECT 'Subdiario de IVA – ' || doc || ': las líneas de impuestos no cierran con el comprobante' AS label,
           (abs(net_taxed - l_net) + abs(vat_total - l_vat) + abs(perceptions_total - l_perc) + abs(other_taxes_total - l_other))::text AS diff
      FROM x WHERE net_taxed <> l_net OR vat_total <> l_vat OR perceptions_total <> l_perc OR other_taxes_total <> l_other
     ORDER BY id`);
  out.push(...lines);
  const { rows: periods } = await db.execute<{ direction: "ISSUED" | "RECEIVED"; first: string; last: string; total: string }>(sql`
    SELECT d.direction, to_char(min(d.vat_period), 'YYYY-MM') AS first, to_char(max(d.vat_period), 'YYYY-MM') AS last,
           sum(CASE WHEN t.class IN ('CREDIT_NOTE','OPENING_CREDIT') THEN -d.total ELSE d.total END)::numeric(18,2)::text AS total
      FROM documents d JOIN document_types t ON t.id = d.document_type_id
     WHERE d.status <> 'ANNULLED' AND t.is_fiscal
     GROUP BY d.direction`);
  for (const p of periods) {
    const book = await vatBookReport(db, p.direction, { from: p.first, to: p.last });
    compare(p.direction === "ISSUED" ? "Subdiario de IVA ventas (todos los períodos)" : "Subdiario de IVA compras (todos los períodos)", String(book.tables[0]!.totals!.total), p.total);
  }
  return out;
}
