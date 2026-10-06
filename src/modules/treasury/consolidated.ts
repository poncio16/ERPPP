import Decimal from "decimal.js";
import { and, asc, eq, sql } from "drizzle-orm";
import { recordAudit } from "@/modules/audit/service";
import { DomainError, ValidationError } from "@/lib/errors";
import { todayIso } from "@/lib/format";
import { assertPermission } from "@/server/authorization";
import type { ServiceContext } from "@/server/context";
import type { Db, DbOrTx } from "@/server/db/drizzle";
import { plannedCashItems, treasuryConcepts, users } from "@/server/db/schema";
import type { PlannedItemInput } from "./planning-schemas";
import { treasuryOverview } from "./service";

/**
 * Tesorería consolidada (G.12): caja(s), bancos, cartera de cheques y cheques propios pendientes;
 * ingresos y egresos por concepto en un período; ingresos y egresos proyectados manuales.
 */

export async function consolidatedPosition(db: DbOrTx, ctx: ServiceContext) {
  assertPermission(ctx, "treasury.read");
  const [cash, banks] = await Promise.all([treasuryOverview(db, ctx, "CASH"), treasuryOverview(db, ctx, "BANK")]);
  const { rows } = await db.execute<{ portfolio: string; portfolio_count: number; deposited: string; deposited_count: number; own_pending: string; own_pending_count: number }>(sql`
    SELECT coalesce(sum(amount) FILTER (WHERE status = 'IN_PORTFOLIO'), 0)::text AS portfolio,
           count(*) FILTER (WHERE status = 'IN_PORTFOLIO')::int AS portfolio_count,
           coalesce(sum(amount) FILTER (WHERE status = 'DEPOSITED'), 0)::text AS deposited,
           count(*) FILTER (WHERE status = 'DEPOSITED')::int AS deposited_count,
           (SELECT coalesce(sum(amount), 0)::text FROM issued_checks WHERE status IN ('ISSUED','DELIVERED','PRESENTED')) AS own_pending,
           (SELECT count(*)::int FROM issued_checks WHERE status IN ('ISSUED','DELIVERED','PRESENTED')) AS own_pending_count
      FROM received_checks`);
  const c = rows[0]!;
  const sum = (xs: string[]) => xs.reduce((a, x) => a.plus(x), new Decimal(0));
  const cashTotal = sum(cash.map((a) => a.balance));
  const bankBook = sum(banks.map((a) => a.balance));
  const bankAvailable = sum(banks.map((a) => a.available ?? a.balance));
  return {
    cash,
    banks,
    totals: {
      cash: cashTotal.toFixed(2),
      bankBook: bankBook.toFixed(2),
      bankAvailable: bankAvailable.toFixed(2),
      /** Caja + bancos (saldo contable): el dinero que ya está. */
      liquid: cashTotal.plus(bankBook).toFixed(2),
      portfolio: new Decimal(c.portfolio).toFixed(2),
      portfolioCount: Number(c.portfolio_count),
      deposited: new Decimal(c.deposited).toFixed(2),
      depositedCount: Number(c.deposited_count),
      ownPending: new Decimal(c.own_pending).toFixed(2),
      ownPendingCount: Number(c.own_pending_count),
      /** Caja + bancos disponibles + cartera + depositados a acreditar. */
      position: cashTotal.plus(bankAvailable).plus(c.portfolio).plus(c.deposited).toFixed(2),
    },
  };
}

export interface ConceptRow {
  concept: string;
  income: string;
  expense: string;
}

/**
 * Ingresos y egresos del período por concepto. Las reversiones se restan del concepto del movimiento
 * revertido (no aparecen como un concepto aparte); las transferencias entre cuentas propias y los
 * saldos iniciales no son ingresos ni egresos y se excluyen.
 */
export async function incomeExpenseByConcept(db: DbOrTx, ctx: ServiceContext, from: string, to: string) {
  assertPermission(ctx, "treasury.read");
  const { rows } = await db.execute<{ concept: string; income: string; expense: string }>(sql`
    WITH eff AS (
      SELECT coalesce(o.concept_id, m.concept_id) AS concept_id,
             coalesce(o.direction, m.direction) AS bucket,
             CASE WHEN m.origin_type = 'REVERSAL' THEN -m.amount ELSE m.amount END AS amount,
             coalesce(o.origin_type, m.origin_type) AS origin
        FROM treasury_movements m
        LEFT JOIN treasury_movements o ON o.id = m.reversal_of_id
       WHERE m.movement_date BETWEEN ${from} AND ${to}
    )
    SELECT c.name AS concept,
           coalesce(sum(amount) FILTER (WHERE bucket = 'IN'), 0)::numeric(18,2)::text AS income,
           coalesce(sum(amount) FILTER (WHERE bucket = 'OUT'), 0)::numeric(18,2)::text AS expense
      FROM eff JOIN treasury_concepts c ON c.id = eff.concept_id
     WHERE eff.origin NOT IN ('ACCOUNT_TRANSFER', 'OPENING')
     GROUP BY c.id, c.name, c.sort_order
     ORDER BY c.sort_order, c.name`);
  const income = rows.reduce((a, r) => a.plus(r.income), new Decimal(0));
  const expense = rows.reduce((a, r) => a.plus(r.expense), new Decimal(0));
  return { rows: rows as ConceptRow[], income: income.toFixed(2), expense: expense.toFixed(2), net: income.minus(expense).toFixed(2) };
}

// ───────────────────────────── Proyectados ─────────────────────────────

export async function listPlannedItems(db: DbOrTx, ctx: ServiceContext, status: "PLANNED" | "ALL" = "PLANNED") {
  assertPermission(ctx, "treasury.read");
  return db
    .select({
      id: plannedCashItems.id,
      direction: plannedCashItems.direction,
      concept: treasuryConcepts.name,
      expectedDate: plannedCashItems.expectedDate,
      amount: plannedCashItems.amount,
      description: plannedCashItems.description,
      status: plannedCashItems.status,
      recurrence: plannedCashItems.recurrence,
      createdBy: users.username,
    })
    .from(plannedCashItems)
    .leftJoin(treasuryConcepts, eq(treasuryConcepts.id, plannedCashItems.conceptId))
    .leftJoin(users, eq(users.id, plannedCashItems.createdBy))
    .where(status === "PLANNED" ? eq(plannedCashItems.status, "PLANNED") : undefined)
    .orderBy(asc(plannedCashItems.expectedDate), asc(plannedCashItems.id));
}

export async function createPlannedItem(db: Db, ctx: ServiceContext, input: PlannedItemInput) {
  assertPermission(ctx, "treasury.plan");
  if (input.expectedDate < todayIso()) throw new ValidationError({ expectedDate: ["La fecha prevista no puede ser anterior a hoy."] });
  return db.transaction(async (tx) => {
    if (input.conceptId) {
      const [concept] = await tx.select().from(treasuryConcepts).where(eq(treasuryConcepts.id, input.conceptId));
      if (!concept || !concept.active) throw new ValidationError({ conceptId: ["El concepto no existe."] });
      if (concept.direction !== "BOTH" && concept.direction !== input.direction) {
        throw new ValidationError({ conceptId: [`El concepto ${concept.name} es solo de ${concept.direction === "IN" ? "ingresos" : "egresos"}.`] });
      }
    }
    const [row] = await tx
      .insert(plannedCashItems)
      .values({
        direction: input.direction,
        conceptId: input.conceptId ?? null,
        expectedDate: input.expectedDate,
        amount: input.amount,
        description: input.description,
        recurrence: input.recurrence ?? null,
        createdBy: ctx.userId,
      })
      .returning({ id: plannedCashItems.id });
    await recordAudit(tx, ctx, { module: "treasury", action: "plan_create", entityType: "planned_cash_item", entityId: row!.id, after: { ...input } });
    return { id: row!.id };
  });
}

/** Un proyectado se da por realizado (el movimiento real se registra por su circuito) o se cancela. */
export async function setPlannedItemStatus(db: Db, ctx: ServiceContext, input: { id: number; status: "REALIZED" | "CANCELLED" }) {
  assertPermission(ctx, "treasury.plan");
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(plannedCashItems).where(eq(plannedCashItems.id, input.id)).for("update");
    if (!item) throw new DomainError("El movimiento proyectado no existe.", "NOT_FOUND");
    if (item.status !== "PLANNED") throw new DomainError("El movimiento proyectado ya fue realizado o cancelado.");
    await tx
      .update(plannedCashItems)
      .set({ status: input.status, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(plannedCashItems.id, item.id), eq(plannedCashItems.status, "PLANNED")));
    await recordAudit(tx, ctx, {
      module: "treasury",
      action: input.status === "REALIZED" ? "plan_realize" : "plan_cancel",
      entityType: "planned_cash_item",
      entityId: item.id,
      before: { status: item.status },
      after: { status: input.status },
    });
    return { id: item.id };
  });
}
