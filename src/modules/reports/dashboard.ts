import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { consolidatedPosition, incomeExpenseByConcept } from "@/modules/treasury/consolidated";
import { assertPermission } from "@/server/authorization";
import type { ServiceContext } from "@/server/context";
import type { DbOrTx } from "@/server/db/drizzle";
import type { Direction } from "@/server/db/schema";
import { balancesReport, documentsReport, settlementsReport } from "./accounts-reports";
import { cashFlow } from "./cash-flow";
import { firstOfMonth } from "./schemas";
import { backupAlerts } from "@/modules/backup/service";

/**
 * Dashboard (sección 33, G.15). Cada indicador sale de la misma función que el reporte que lo
 * detalla (deuda, cobranzas/pagos, comprobantes, tesorería consolidada, flujo de fondos), así las
 * cifras coinciden siempre con el reporte al que enlaza.
 */

export interface PartySide {
  total: string;
  overdue: string;
  notDue: string;
  credit: string;
  settledMonth: string | null;
  settledCount: number | null;
  overLimit: number;
  top: { partyId: number; name: string; balance: string; overdue: string }[];
}

async function partySide(db: DbOrTx, ctx: ServiceContext, direction: Direction, today: string): Promise<PartySide> {
  const report = await balancesReport(db, direction, { cutoff: today, party: undefined });
  const table = report.tables[0]!;
  const t = table.totals!;
  const top = table.rows
    .map((r) => ({ partyId: Number(r.href!.split("/").at(-1)), name: String(r.cells.party), balance: String(r.cells.balance), overdue: String(r.cells.overdue) }))
    .filter((r) => new Decimal(r.balance).isPositive() && !new Decimal(r.balance).isZero())
    .sort((a, b) => new Decimal(b.balance).comparedTo(a.balance) || a.name.localeCompare(b.name, "es"))
    .slice(0, 5);
  const settlementPerm = direction === "ISSUED" ? "collections.read" : "payments.read";
  let settledMonth: string | null = null;
  let settledCount: number | null = null;
  if (ctx.permissions.has(settlementPerm)) {
    const s = await settlementsReport(db, direction, { from: firstOfMonth(today), to: today, party: undefined, status: "ACTIVE" });
    settledMonth = String(s.tables[0]!.totals!.total);
    settledCount = s.tables[0]!.rows.length;
  }
  return {
    total: String(t.balance),
    overdue: String(t.overdue),
    notDue: String(t.notDue),
    credit: new Decimal(String(t.credit)).neg().toFixed(2),
    settledMonth,
    settledCount,
    overLimit: table.rows.filter((r) => r.cells.overLimit).length,
    top,
  };
}

/** Saldo total de cuentas por cobrar y por pagar al cierre de cada uno de los últimos 12 meses (y hoy). */
export async function balanceEvolution(db: DbOrTx, today: string) {
  const dates: string[] = [];
  for (let i = 11; i >= 1; i--) {
    const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - i, 0, 12));
    dates.push(d.toISOString().slice(0, 10));
  }
  dates.push(today);
  const { rows } = await db.execute<{ d: string; ar: string; ap: string }>(sql`
    SELECT v.d::text AS d,
           (SELECT coalesce(sum(debit - credit), 0) FROM customer_account_entries WHERE entry_date <= v.d)::numeric(18,2)::text AS ar,
           (SELECT coalesce(sum(debit - credit), 0) FROM supplier_account_entries WHERE entry_date <= v.d)::numeric(18,2)::text AS ap
      FROM (VALUES ${sql.join(dates.map((d) => sql`(${d}::date)`), sql`, `)}) AS v(d)
     ORDER BY v.d`);
  return rows.map((r) => ({ date: r.d, ar: r.ar, ap: r.ap }));
}

export async function dashboardData(db: DbOrTx, ctx: ServiceContext, today: string) {
  assertPermission(ctx, "dashboard.read");
  const has = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  const month = { from: firstOfMonth(today), to: today };

  const [receivable, payable, evolution] = has("accounts.read")
    ? await Promise.all([partySide(db, ctx, "ISSUED", today), partySide(db, ctx, "RECEIVED", today), balanceEvolution(db, today)])
    : [null, null, null];

  let treasury = null;
  let flow = null;
  if (has("treasury.read")) {
    const [position, concepts, f] = await Promise.all([
      consolidatedPosition(db, ctx),
      incomeExpenseByConcept(db, ctx, month.from, month.to),
      cashFlow(db, { start: today, view: "WEEK", periods: 8 }, today),
    ]);
    treasury = { ...position.totals, incomeMonth: concepts.income, expenseMonth: concepts.expense };
    flow = {
      opening: f.opening,
      late: f.net.late!,
      points: f.periods.map((p) => ({ label: p.label, net: f.net[p.key]!, balance: f.endBalance[p.key]! })),
    };
  }

  let management = null;
  if (has("documents.read")) {
    const [issued, received] = await Promise.all([
      documentsReport(db, "ISSUED", { ...month, party: undefined, type: undefined, status: "ACTIVE" }),
      documentsReport(db, "RECEIVED", { ...month, party: undefined, type: undefined, status: "ACTIVE" }),
    ]);
    const pick = (r: typeof issued) => ({ count: r.tables[0]!.rows.length, total: String(r.tables[0]!.totals!.total) });
    management = { issued: pick(issued), received: pick(received) };
  }

  // Alertas de backup, solo para quien administra los backups (J.1).
  const backup = has("backup.run") ? await backupAlerts(db, ctx) : null;

  return { today, month, receivable, payable, evolution, treasury, flow, management, backup };
}

export type DashboardData = Awaited<ReturnType<typeof dashboardData>>;
