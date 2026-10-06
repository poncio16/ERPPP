import Decimal from "decimal.js";
import { and, asc, count, desc, eq, gt, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { allocationsOf, applyAllocationsInTx, reverseAllocationInTx } from "@/modules/allocations/service";
import { sumAmounts } from "@/modules/allocations/plan";
import { recordAudit } from "@/modules/audit/service";
import {
  annulIssuedCheckInTx,
  availableBankBalance,
  createIssuedCheckInTx,
  endorseReceivedCheckInTx,
  returnEndorsedCheckInTx,
} from "@/modules/checks/service";
import { lockedUntil } from "@/modules/config/service";
import type { InternalDocData, OperationLine } from "@/modules/internal-docs/types";
import { nextSequenceNumber } from "@/modules/numbering/service";
import { lastClosureDate, lockAccounts, recordMovement, reverseMovementInTx } from "@/modules/treasury/service";
import type { AccountRef } from "@/modules/treasury/schemas";
import { DomainError, ValidationError } from "@/lib/errors";
import { formatDate, todayIso } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { amountInWords } from "@/lib/number-to-words";
import { pgError } from "@/lib/pg-error";
import { assertPermission } from "@/server/authorization";
import type { ServiceContext } from "@/server/context";
import type { Db, DbOrTx, Tx } from "@/server/db/drizzle";
import {
  allocations,
  bankAccounts,
  cashBoxes,
  issuedChecks,
  paymentLines,
  paymentOrders,
  receivedChecks,
  supplierAccountEntries,
  supplierPayments,
  suppliers,
  taxCatalog,
  treasuryMovements,
  users,
} from "@/server/db/schema";
import type { OperationListQuery } from "@/modules/collections/schemas";
import type { RegisterPaymentInput } from "./schemas";

/**
 * Pagos a proveedores (G.6): espejo de las cobranzas. Efectivo y transferencia egresan de caja o
 * banco; el cheque propio queda entregado y recién mueve el banco al debitarse; el cheque de
 * terceros se endosa (sale de cartera, sin movimiento de fondos); la retención practicada cancela
 * deuda sin mover fondos. Orden de pago interna numerada.
 */

const dmy = (iso: string) => formatDate(iso);
export const PAYMENT_METHOD_LABEL = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia",
  OWN_CHECK: "Cheque propio",
  THIRD_PARTY_CHECK: "Cheque de terceros (endoso)",
  RETENTION: "Retención practicada",
} as const;

export async function registerPayment(db: Db, ctx: ServiceContext, input: RegisterPaymentInput) {
  assertPermission(ctx, "payments.create");
  const existing = async () => {
    const [row] = await db
      .select({ id: supplierPayments.id, orderId: paymentOrders.id })
      .from(supplierPayments)
      .leftJoin(paymentOrders, eq(paymentOrders.paymentId, supplierPayments.id))
      .where(eq(supplierPayments.idempotencyKey, input.idempotencyKey));
    return row ? { id: row.id, orderId: row.orderId, existing: true } : null;
  };
  const before = await existing();
  if (before) return before;
  try {
    return await db.transaction((tx) => registerInTx(tx, ctx, input));
  } catch (e) {
    const { code, constraint } = pgError(e);
    if (code === "23505" && constraint === "ux_supplier_payments_idempotency_key") {
      const again = await existing();
      if (again) return again;
    }
    if (code === "23505" && constraint === "ux_issued_checks_number") {
      throw new ValidationError({ lines: ["Ese número de cheque ya se usó en la cuenta (los números no se reutilizan, aunque el cheque esté anulado)."] });
    }
    throw e;
  }
}

const dedupeRefs = (refs: AccountRef[]) => refs.filter((r, i) => refs.findIndex((o) => o.kind === r.kind && o.id === r.id) === i);

async function registerInTx(tx: Tx, ctx: ServiceContext, input: RegisterPaymentInput) {
  const errors: Record<string, string[]> = {};
  const warnings: string[] = [];
  const today = todayIso();

  const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId));
  if (!supplier) throw new ValidationError({ supplierId: ["El proveedor no existe."] });
  if (supplier.status !== "ACTIVE") throw new ValidationError({ supplierId: ["El proveedor está dado de baja."] });
  if (input.date > today) errors.date = ["La fecha del pago no puede ser posterior a hoy."];
  const locked = await lockedUntil(tx);
  if (locked && input.date <= locked) errors.date = [`El período está cerrado hasta el ${dmy(locked)}.`];

  // Cheques de la cartera a endosar: se bloquean primero (cheques antes que cuentas, en orden de id).
  const endorsedIds = input.lines.flatMap((l) => (l.method === "THIRD_PARTY_CHECK" ? [l.receivedCheckId] : []));
  if (new Set(endorsedIds).size !== endorsedIds.length) errors.lines = ["Un cheque de la cartera figura dos veces en el pago."];
  const endorsed = endorsedIds.length
    ? await tx.select().from(receivedChecks).where(inArray(receivedChecks.id, [...new Set(endorsedIds)].sort((a, b) => a - b))).orderBy(asc(receivedChecks.id)).for("update")
    : [];
  const byId = new Map(endorsed.map((c) => [c.id, c]));

  // Importe de cada medio (el del cheque endosado es el del cheque).
  const amounts: string[] = [];
  const refs: AccountRef[] = [];
  const ownCheckTotals = new Map<number, Decimal>();
  for (const [i, line] of input.lines.entries()) {
    const at = (field: string, msg: string) => (errors[`lines.${i}.${field}`] ??= []).push(msg);
    if (line.method === "THIRD_PARTY_CHECK") {
      const c = byId.get(line.receivedCheckId);
      if (!c) at("receivedCheckId", "El cheque no existe.");
      else if (c.status !== "IN_PORTFOLIO") at("receivedCheckId", `El cheque N° ${c.number} ya no está en cartera.`);
      amounts.push(c?.amount ?? "0");
      continue;
    }
    amounts.push(line.amount);
    if (line.method === "CASH") {
      const [box] = await tx.select({ active: cashBoxes.active }).from(cashBoxes).where(eq(cashBoxes.id, line.cashBoxId));
      if (!box?.active) at("cashBoxId", "La caja no existe o está inactiva.");
      else refs.push({ kind: "CASH", id: line.cashBoxId });
    } else if (line.method === "TRANSFER") {
      const [acc] = await tx.select({ active: bankAccounts.active }).from(bankAccounts).where(eq(bankAccounts.id, line.bankAccountId));
      if (!acc?.active) at("bankAccountId", "La cuenta bancaria no existe o está inactiva.");
      else refs.push({ kind: "BANK", id: line.bankAccountId });
      if (line.transferDate > today) at("transferDate", "La fecha de la transferencia no puede ser posterior a hoy.");
    } else if (line.method === "OWN_CHECK") {
      const [acc] = await tx.select({ active: bankAccounts.active }).from(bankAccounts).where(eq(bankAccounts.id, line.check.bankAccountId));
      if (!acc?.active) at("check.bankAccountId", "La cuenta bancaria no existe o está inactiva.");
      else refs.push({ kind: "BANK", id: line.check.bankAccountId });
      const [used] = await tx
        .select({ id: issuedChecks.id })
        .from(issuedChecks)
        .where(and(eq(issuedChecks.bankAccountId, line.check.bankAccountId), eq(issuedChecks.number, line.check.number)));
      if (used) at("check.number", "Ese número de cheque ya se usó en la cuenta (los números no se reutilizan, aunque el cheque esté anulado).");
      const twin = input.lines.findIndex((l, j) => j < i && l.method === "OWN_CHECK" && l.check.bankAccountId === line.check.bankAccountId && l.check.number === line.check.number);
      if (twin >= 0) at("check.number", "El cheque figura dos veces en el pago.");
      ownCheckTotals.set(line.check.bankAccountId, (ownCheckTotals.get(line.check.bankAccountId) ?? new Decimal(0)).plus(line.amount));
    } else {
      const [t] = await tx.select({ kind: taxCatalog.kind, active: taxCatalog.active }).from(taxCatalog).where(eq(taxCatalog.id, line.retentionTaxId));
      if (!t || t.kind !== "RETENTION" || !t.active) at("retentionTaxId", "Elija un impuesto de retención vigente.");
      if (line.retentionDate > today) at("retentionDate", "La fecha de la retención no puede ser posterior a hoy.");
    }
  }
  const total = sumAmounts(amounts.map((amount) => ({ amount })));
  if (sumAmounts(input.allocations).gt(total)) errors.allocations = [`El total imputado supera el importe del pago (${formatMoney(total)}).`];
  if (Object.keys(errors).length) throw new ValidationError(errors);

  await lockAccounts(tx, dedupeRefs(refs));
  // Un cheque propio reduce el saldo disponible (G.9-3): se advierte si lo deja negativo.
  for (const [accountId, amount] of ownCheckTotals) {
    const after = (await availableBankBalance(tx, accountId)).minus(amount);
    if (after.isNegative()) {
      const [acc] = await tx.select({ name: bankAccounts.displayName }).from(bankAccounts).where(eq(bankAccounts.id, accountId));
      warnings.push(`Con los cheques de este pago, el saldo disponible de ${acc?.name ?? "la cuenta"} queda en ${formatMoney(after)}.`);
    }
  }
  if (warnings.length && !input.confirmWarnings) {
    throw new DomainError("Revise las advertencias y confirme para registrar igual.", "NEEDS_CONFIRMATION", { _warnings: warnings });
  }

  const number = await nextSequenceNumber(tx, "PAYMENT_ORDER");
  const totalText = total.toFixed(2);
  const [payment] = await tx
    .insert(supplierPayments)
    .values({
      supplierId: supplier.id,
      paymentDate: input.date,
      totalAmount: totalText,
      unappliedAmount: totalText,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      createdBy: ctx.userId,
    })
    .returning({ id: supplierPayments.id });
  const paymentId = payment!.id;
  const label = `Pago ${number} — ${supplier.legalName}`;

  const movementIds: number[] = [];
  const issuedIds: number[] = [];
  for (const [i, line] of input.lines.entries()) {
    const issuedCheckId =
      line.method === "OWN_CHECK"
        ? await createIssuedCheckInTx(tx, ctx, { ...line.check, supplierId: supplier.id, amount: line.amount, date: input.date, notes: `Entregado en el pago ${number}` })
        : null;
    if (issuedCheckId) issuedIds.push(issuedCheckId);
    if (line.method === "THIRD_PARTY_CHECK") await endorseReceivedCheckInTx(tx, ctx, byId.get(line.receivedCheckId)!, input.date, `Endosado a ${supplier.legalName} en el pago ${number}`);
    const [row] = await tx
      .insert(paymentLines)
      .values({
        paymentId,
        lineNo: i + 1,
        method: line.method,
        amount: amounts[i]!,
        cashBoxId: line.method === "CASH" ? line.cashBoxId : null,
        bankAccountId: line.method === "TRANSFER" ? line.bankAccountId : null,
        transferDate: line.method === "TRANSFER" ? line.transferDate : null,
        transferReference: line.method === "TRANSFER" ? line.transferReference : null,
        issuedCheckId,
        receivedCheckId: line.method === "THIRD_PARTY_CHECK" ? line.receivedCheckId : null,
        retentionTaxId: line.method === "RETENTION" ? line.retentionTaxId : null,
        retentionCertificate: line.method === "RETENTION" ? line.certificate : null,
        retentionDate: line.method === "RETENTION" ? line.retentionDate : null,
      })
      .returning({ id: paymentLines.id });
    if (line.method === "CASH" || line.method === "TRANSFER") {
      movementIds.push(
        await recordMovement(
          tx,
          ctx,
          {
            account: line.method === "CASH" ? { kind: "CASH", id: line.cashBoxId } : { kind: "BANK", id: line.bankAccountId },
            date: line.method === "CASH" ? input.date : line.transferDate,
            direction: "OUT",
            amount: line.amount,
            conceptCode: "PAGO",
            description: label,
            reference: line.method === "TRANSFER" ? line.transferReference : number,
            originType: "PAYMENT_LINE",
            paymentLineId: row!.id,
          },
          { confirmed: input.confirmWarnings },
        ),
      );
    }
  }

  await tx.insert(supplierAccountEntries).values({
    supplierId: supplier.id,
    entryDate: input.date,
    entryType: "PAYMENT",
    paymentId,
    credit: totalText,
    description: `Pago — orden de pago ${number}`,
    createdBy: ctx.userId,
  });

  const allocationIds = await applyAllocationsInTx(tx, ctx, { kind: "PAYMENT", id: paymentId }, input.allocations, input.date);

  const [order] = await tx
    .insert(paymentOrders)
    .values({
      number,
      paymentId,
      issueDate: input.date,
      partyName: supplier.legalName,
      partyTaxId: supplier.taxId,
      amount: totalText,
      amountInWords: amountInWords(total),
      createdBy: ctx.userId,
    })
    .returning({ id: paymentOrders.id });

  await recordAudit(tx, ctx, {
    module: "payments",
    action: "create",
    entityType: "payment",
    entityId: paymentId,
    after: {
      supplier: supplier.legalName,
      date: input.date,
      total: totalText,
      order: number,
      lines: input.lines.map((l, i) => ({ method: l.method, amount: amounts[i] })),
      movements: movementIds,
      issuedChecks: issuedIds,
      endorsedChecks: endorsedIds,
      allocations: allocationIds,
      unapplied: total.minus(sumAmounts(input.allocations)).toFixed(2),
    },
    message: warnings.length ? `Registrado con advertencias confirmadas: ${warnings.join(" | ")}` : undefined,
  });
  return { id: paymentId, orderId: order!.id, existing: false };
}

/**
 * Anulación (G.6-8): cheques propios todavía entregados (no presentados, debitados ni rechazados),
 * cheques endosados todavía endosados, período abierto y caja no cerrada a la fecha del pago.
 */
export async function annulPayment(db: Db, ctx: ServiceContext, input: { id: number; reason: string }) {
  assertPermission(ctx, "payments.annul");
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(supplierPayments).where(eq(supplierPayments.id, input.id)).for("update");
    if (!p) throw new DomainError("El pago no existe.", "NOT_FOUND");
    if (p.status === "ANNULLED") throw new DomainError("El pago ya está anulado.");
    const locked = await lockedUntil(tx);
    if (locked && p.paymentDate <= locked) throw new DomainError(`El pago pertenece a un período cerrado (hasta el ${dmy(locked)}).`);

    const lines = await tx.select().from(paymentLines).where(eq(paymentLines.paymentId, p.id)).orderBy(asc(paymentLines.lineNo));
    const receivedIds = lines.flatMap((l) => (l.receivedCheckId ? [l.receivedCheckId] : [])).sort((a, b) => a - b);
    const issuedIds = lines.flatMap((l) => (l.issuedCheckId ? [l.issuedCheckId] : [])).sort((a, b) => a - b);
    const received = receivedIds.length ? await tx.select().from(receivedChecks).where(inArray(receivedChecks.id, receivedIds)).orderBy(asc(receivedChecks.id)).for("update") : [];
    const issued = issuedIds.length ? await tx.select().from(issuedChecks).where(inArray(issuedChecks.id, issuedIds)).orderBy(asc(issuedChecks.id)).for("update") : [];
    const problems = [
      ...issued.filter((c) => c.status !== "DELIVERED").map((c) => `el cheque propio N° ${c.number} ya no está solo entregado`),
      ...received.filter((c) => c.status !== "ENDORSED").map((c) => `el cheque endosado N° ${c.number} fue rechazado`),
    ];
    if (problems.length) throw new DomainError(`No se puede anular: ${problems.join("; ")}.`);
    for (const l of lines) {
      if (l.method !== "CASH") continue;
      const closed = await lastClosureDate(tx, l.cashBoxId!);
      if (closed && p.paymentDate <= closed) {
        const [box] = await tx.select({ name: cashBoxes.name }).from(cashBoxes).where(eq(cashBoxes.id, l.cashBoxId!));
        throw new DomainError(`No se puede anular: la caja ${box?.name ?? ""} está cerrada hasta el ${dmy(closed)}, que incluye la fecha del pago.`);
      }
    }
    const refs = dedupeRefs(lines.flatMap((l): AccountRef[] => (l.method === "CASH" ? [{ kind: "CASH", id: l.cashBoxId! }] : l.method === "TRANSFER" ? [{ kind: "BANK", id: l.bankAccountId! }] : [])));
    await lockAccounts(tx, refs);

    const why = `Anulación del pago: ${input.reason}`;
    const active = await tx
      .select({ id: allocations.id })
      .from(allocations)
      .where(and(eq(allocations.sourcePaymentId, p.id), eq(allocations.status, "ACTIVE")))
      .orderBy(asc(allocations.id));
    for (const a of active) await reverseAllocationInTx(tx, ctx, a.id, why);

    const lineIds = lines.map((l) => l.id);
    const movements = lineIds.length
      ? await tx.select({ id: treasuryMovements.id }).from(treasuryMovements).where(inArray(treasuryMovements.paymentLineId, lineIds)).orderBy(asc(treasuryMovements.id))
      : [];
    const reversals: number[] = [];
    for (const m of movements) reversals.push(await reverseMovementInTx(tx, ctx, m.id, why));
    const today = todayIso();
    for (const c of issued) await annulIssuedCheckInTx(tx, ctx, c, today, why);
    for (const c of received) await returnEndorsedCheckInTx(tx, ctx, c, today, `Vuelve a cartera: ${why}`);

    const [entry] = await tx.select().from(supplierAccountEntries).where(and(eq(supplierAccountEntries.paymentId, p.id), eq(supplierAccountEntries.entryType, "PAYMENT")));
    if (!entry) throw new DomainError("No se encontró el asiento de cuenta corriente del pago.", "INCONSISTENT");
    await tx.insert(supplierAccountEntries).values({
      supplierId: p.supplierId,
      entryDate: today,
      entryType: "REVERSAL",
      paymentId: p.id,
      debit: entry.credit,
      credit: entry.debit,
      description: `Anulación: ${entry.description}`,
      reversalOfId: entry.id,
      createdBy: ctx.userId,
    });
    await tx
      .update(supplierPayments)
      .set({ status: "ANNULLED", unappliedAmount: "0", annulledAt: new Date(), annulledBy: ctx.userId, annulReason: input.reason, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(supplierPayments.id, p.id));
    await tx.update(paymentOrders).set({ status: "ANNULLED", annulledAt: new Date(), annulledBy: ctx.userId }).where(eq(paymentOrders.paymentId, p.id));

    await recordAudit(tx, ctx, {
      module: "payments",
      action: "annul",
      entityType: "payment",
      entityId: p.id,
      before: { status: p.status, unapplied: p.unappliedAmount },
      after: {
        status: "ANNULLED",
        reason: input.reason,
        reversedAllocations: active.map((a) => a.id),
        reversalMovements: reversals,
        annulledChecks: issued.map((c) => c.id),
        checksBackToPortfolio: received.map((c) => c.id),
      },
    });
    return { id: p.id };
  });
}

// ───────────────────────────── Consultas ─────────────────────────────

export const PAGE_SIZE = 50;

export async function listPayments(db: DbOrTx, ctx: ServiceContext, query: OperationListQuery) {
  assertPermission(ctx, "payments.read");
  const conds: SQL[] = [];
  if (query.partyId) conds.push(eq(supplierPayments.supplierId, query.partyId));
  if (query.from) conds.push(gte(supplierPayments.paymentDate, query.from));
  if (query.to) conds.push(lte(supplierPayments.paymentDate, query.to));
  if (query.status === "ACTIVE" || query.status === "ANNULLED") conds.push(eq(supplierPayments.status, query.status));
  if (query.status === "UNAPPLIED") conds.push(and(eq(supplierPayments.status, "ACTIVE"), gt(supplierPayments.unappliedAmount, "0"))!);
  if (query.q) {
    const like = `%${query.q}%`;
    conds.push(or(ilike(suppliers.legalName, like), ilike(paymentOrders.number, like), ilike(suppliers.taxId, like))!);
  }
  const where = conds.length ? and(...conds) : undefined;
  const page = query.page ?? 1;
  const rows = await db
    .select({
      id: supplierPayments.id,
      date: supplierPayments.paymentDate,
      supplierId: supplierPayments.supplierId,
      supplierName: suppliers.legalName,
      order: paymentOrders.number,
      total: supplierPayments.totalAmount,
      unapplied: supplierPayments.unappliedAmount,
      status: supplierPayments.status,
      methods: sql<string>`(SELECT string_agg(DISTINCT l.method, ',') FROM payment_lines l WHERE l.payment_id = "supplier_payments"."id")`,
    })
    .from(supplierPayments)
    .innerJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
    .leftJoin(paymentOrders, eq(paymentOrders.paymentId, supplierPayments.id))
    .where(where)
    .orderBy(desc(supplierPayments.paymentDate), desc(supplierPayments.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  const [totals] = await db
    .select({
      count: count(),
      total: sql<string>`coalesce(sum(${supplierPayments.totalAmount}) FILTER (WHERE ${supplierPayments.status} = 'ACTIVE'), 0)::text`,
      unapplied: sql<string>`coalesce(sum(${supplierPayments.unappliedAmount}) FILTER (WHERE ${supplierPayments.status} = 'ACTIVE'), 0)::text`,
    })
    .from(supplierPayments)
    .innerJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
    .leftJoin(paymentOrders, eq(paymentOrders.paymentId, supplierPayments.id))
    .where(where);
  return { rows, page, count: totals?.count ?? 0, total: totals?.total ?? "0", unapplied: totals?.unapplied ?? "0" };
}

export async function paymentLinesDetail(db: DbOrTx, paymentId: number): Promise<OperationLine[]> {
  const { rows } = await db.execute<{
    id: number;
    line_no: number;
    method: string;
    amount: string;
    cash_box_id: number | null;
    cash_box: string | null;
    bank_account_id: number | null;
    bank_account: string | null;
    transfer_date: string | null;
    transfer_reference: string | null;
    own_check_id: number | null;
    own_number: string | null;
    own_account: string | null;
    own_payment_date: string | null;
    own_type: string | null;
    own_format: string | null;
    own_status: string | null;
    third_check_id: number | null;
    third_number: string | null;
    third_bank: string | null;
    third_drawer: string | null;
    third_payment_date: string | null;
    third_status: string | null;
    tax: string | null;
    certificate: string | null;
    retention_date: string | null;
    movement_id: number | null;
  }>(sql`
    SELECT l.id, l.line_no, l.method, l.amount::text AS amount,
           l.cash_box_id, cb.name AS cash_box, l.bank_account_id, ba.display_name AS bank_account,
           l.transfer_date::text AS transfer_date, l.transfer_reference,
           ic.id AS own_check_id, ic.number AS own_number, iba.display_name AS own_account, ic.payment_date::text AS own_payment_date,
           ic.check_type AS own_type, ic.format AS own_format, ic.status AS own_status,
           rc.id AS third_check_id, rc.number AS third_number, b.name AS third_bank, rc.drawer_name AS third_drawer,
           rc.payment_date::text AS third_payment_date, rc.status AS third_status,
           t.name AS tax, l.retention_certificate AS certificate, l.retention_date::text AS retention_date,
           (SELECT m.id FROM treasury_movements m WHERE m.payment_line_id = l.id) AS movement_id
      FROM payment_lines l
      LEFT JOIN cash_boxes cb ON cb.id = l.cash_box_id
      LEFT JOIN bank_accounts ba ON ba.id = l.bank_account_id
      LEFT JOIN issued_checks ic ON ic.id = l.issued_check_id
      LEFT JOIN bank_accounts iba ON iba.id = ic.bank_account_id
      LEFT JOIN received_checks rc ON rc.id = l.received_check_id
      LEFT JOIN banks b ON b.id = rc.issuer_bank_id
      LEFT JOIN tax_catalog t ON t.id = l.retention_tax_id
     WHERE l.payment_id = ${paymentId}
     ORDER BY l.line_no`);
  return rows.map((r) => ({
    id: Number(r.id),
    lineNo: r.line_no,
    method: r.method,
    amount: r.amount,
    detail:
      r.method === "CASH"
        ? `Caja ${r.cash_box}`
        : r.method === "TRANSFER"
          ? `${r.bank_account} — ${dmy(r.transfer_date!)}${r.transfer_reference ? ` — ref. ${r.transfer_reference}` : ""}`
          : r.method === "OWN_CHECK"
            ? `${r.own_format === "ECHEQ" ? "ECHEQ" : "Cheque"} ${r.own_account} N° ${r.own_number} — pago ${dmy(r.own_payment_date!)}${r.own_type === "DEFERRED" ? " (diferido)" : ""}`
            : r.method === "THIRD_PARTY_CHECK"
              ? `Cheque ${r.third_bank} N° ${r.third_number} — ${r.third_drawer} — pago ${dmy(r.third_payment_date!)}`
              : `${r.tax} — certificado ${r.certificate} — ${dmy(r.retention_date!)}`,
    account: r.cash_box_id ? { kind: "CASH", id: Number(r.cash_box_id) } : r.bank_account_id ? { kind: "BANK", id: Number(r.bank_account_id) } : null,
    movementId: r.movement_id ? Number(r.movement_id) : null,
    checkId: r.own_check_id ? Number(r.own_check_id) : r.third_check_id ? Number(r.third_check_id) : null,
    checkStatus: r.own_status ?? r.third_status,
  }));
}

export async function getPayment(db: DbOrTx, ctx: ServiceContext, id: number) {
  assertPermission(ctx, "payments.read");
  const [row] = await db
    .select({
      payment: supplierPayments,
      supplierName: suppliers.legalName,
      supplierTaxId: suppliers.taxId,
      orderId: paymentOrders.id,
      orderNumber: paymentOrders.number,
      createdByName: users.username,
    })
    .from(supplierPayments)
    .innerJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
    .leftJoin(paymentOrders, eq(paymentOrders.paymentId, supplierPayments.id))
    .leftJoin(users, eq(users.id, supplierPayments.createdBy))
    .where(eq(supplierPayments.id, id));
  if (!row) return null;
  return { ...row, lines: await paymentLinesDetail(db, id), allocations: await allocationsOf(db, { paymentId: id }) };
}

/** Datos de la orden de pago interna (G.13), armados con el snapshot guardado. */
export async function paymentOrderData(db: DbOrTx, ctx: ServiceContext, paymentId: number): Promise<InternalDocData | null> {
  assertPermission(ctx, "payments.read");
  const [row] = await db
    .select({ order: paymentOrders, payment: supplierPayments, createdBy: users.username })
    .from(paymentOrders)
    .innerJoin(supplierPayments, eq(supplierPayments.id, paymentOrders.paymentId))
    .leftJoin(users, eq(users.id, paymentOrders.createdBy))
    .where(eq(paymentOrders.paymentId, paymentId));
  if (!row) return null;
  const initial = (await allocationsOf(db, { paymentId })).filter((a) => a.createdAt.getTime() === row.payment.createdAt.getTime());
  const allocated = initial.reduce((acc, a) => acc.plus(a.amount), new Decimal(0));
  return {
    kind: "PAYMENT_ORDER",
    number: row.order.number,
    issueDate: row.order.issueDate,
    status: row.order.status,
    partyLabel: "Proveedor",
    partyName: row.order.partyName,
    partyTaxId: row.order.partyTaxId,
    amount: row.order.amount,
    amountInWords: row.order.amountInWords,
    lines: await paymentLinesDetail(db, paymentId),
    allocations: initial.map((a) => ({ label: a.targetLabel, amount: a.amount })),
    unapplied: new Decimal(row.order.amount).minus(allocated).toFixed(2),
    notes: row.payment.notes,
    createdBy: row.createdBy,
    createdAt: row.order.createdAt,
    operationId: paymentId,
  };
}
