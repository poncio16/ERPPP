import Decimal from "decimal.js";
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { recordAudit } from "@/modules/audit/service";
import { lockedUntil } from "@/modules/config/service";
import { registerInternalDebitInTx } from "@/modules/documents/service";
import { accountBalance, lockAccounts, recordMovement } from "@/modules/treasury/service";
import type { AccountRef } from "@/modules/treasury/schemas";
import { DomainError, ValidationError } from "@/lib/errors";
import { formatDate, todayIso } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { assertPermission } from "@/server/authorization";
import type { ServiceContext } from "@/server/context";
import type { Db, DbOrTx, Tx } from "@/server/db/drizzle";
import {
  bankAccounts,
  banks,
  checkEvents,
  clients,
  collectionLines,
  collections,
  issuedChecks,
  paymentLines,
  receivedChecks,
  supplierPayments,
  suppliers,
  treasuryMovements,
} from "@/server/db/schema";

/**
 * Cheques recibidos y propios (G.10, G.11). Cada cambio de estado deja un evento en el historial
 * (append-only) y, cuando corresponde, un único movimiento de tesorería vinculado a ese evento.
 * La base valida las transiciones con un trigger además del servicio.
 */

export type ReceivedStatus = "IN_PORTFOLIO" | "DEPOSITED" | "CREDITED" | "REJECTED" | "ENDORSED" | "ANNULLED";
export type IssuedStatus = "ISSUED" | "DELIVERED" | "PRESENTED" | "DEBITED" | "REJECTED" | "ANNULLED";

export const RECEIVED_STATUS_LABEL: Record<ReceivedStatus, string> = {
  IN_PORTFOLIO: "En cartera",
  DEPOSITED: "Depositado",
  CREDITED: "Acreditado",
  REJECTED: "Rechazado",
  ENDORSED: "Endosado",
  ANNULLED: "Anulado",
};
export const ISSUED_STATUS_LABEL: Record<IssuedStatus, string> = {
  ISSUED: "Emitido",
  DELIVERED: "Entregado",
  PRESENTED: "Presentado",
  DEBITED: "Debitado",
  REJECTED: "Rechazado",
  ANNULLED: "Anulado",
};

const dmy = (iso: string) => formatDate(iso);

export interface CheckData {
  format: "PHYSICAL" | "ECHEQ";
  checkType: "COMMON" | "DEFERRED";
  number: string;
  issueDate: string;
  paymentDate: string;
}

// ───────────────────────────── Escritura dentro de otras operaciones ─────────────────────────────

export async function recordCheckEvent(
  tx: Tx,
  ctx: ServiceContext,
  e: {
    kind: "RECEIVED" | "ISSUED";
    checkId: number;
    from: string | null;
    to: string;
    date: string;
    notes?: string | null;
    debitDocumentId?: number | null;
    supplierDebitDocumentId?: number | null;
  },
) {
  const [row] = await tx
    .insert(checkEvents)
    .values({
      checkKind: e.kind,
      receivedCheckId: e.kind === "RECEIVED" ? e.checkId : null,
      issuedCheckId: e.kind === "ISSUED" ? e.checkId : null,
      fromStatus: e.from,
      toStatus: e.to,
      eventDate: e.date,
      notes: e.notes ?? null,
      debitDocumentId: e.debitDocumentId ?? null,
      supplierDebitDocumentId: e.supplierDebitDocumentId ?? null,
      createdBy: ctx.userId,
    })
    .returning({ id: checkEvents.id });
  return row!.id;
}

/** Cheque de terceros ya registrado y no anulado con el mismo banco, número y librador. */
export async function findReceivedCheckDuplicate(db: DbOrTx, key: { issuerBankId: number; number: string; drawerTaxId: string }) {
  const [row] = await db
    .select({ id: receivedChecks.id, status: receivedChecks.status })
    .from(receivedChecks)
    .where(
      and(
        eq(receivedChecks.issuerBankId, key.issuerBankId),
        eq(receivedChecks.number, key.number),
        eq(receivedChecks.drawerTaxId, key.drawerTaxId),
        sql`${receivedChecks.status} <> 'ANNULLED'`,
      ),
    );
  return row ?? null;
}

/** Alta de un cheque recibido en una cobranza: entra en cartera; no mueve el banco (§24). */
export async function createReceivedCheckInTx(
  tx: Tx,
  ctx: ServiceContext,
  input: CheckData & { clientId: number; issuerBankId: number; drawerTaxId: string; drawerName: string; amount: string; date: string; notes: string },
) {
  const [row] = await tx
    .insert(receivedChecks)
    .values({
      format: input.format,
      checkType: input.checkType,
      issuerBankId: input.issuerBankId,
      number: input.number,
      drawerTaxId: input.drawerTaxId,
      drawerName: input.drawerName,
      clientId: input.clientId,
      issueDate: input.issueDate,
      paymentDate: input.paymentDate,
      amount: input.amount,
      status: "IN_PORTFOLIO",
      createdBy: ctx.userId,
    })
    .returning({ id: receivedChecks.id });
  await recordCheckEvent(tx, ctx, { kind: "RECEIVED", checkId: row!.id, from: null, to: "IN_PORTFOLIO", date: input.date, notes: input.notes });
  return row!.id;
}

/** Cheque propio entregado en un pago: reduce el saldo disponible, no el contable (§26). */
export async function createIssuedCheckInTx(
  tx: Tx,
  ctx: ServiceContext,
  input: CheckData & { bankAccountId: number; supplierId: number; amount: string; date: string; notes: string },
) {
  const [row] = await tx
    .insert(issuedChecks)
    .values({
      bankAccountId: input.bankAccountId,
      format: input.format,
      checkType: input.checkType,
      number: input.number,
      amount: input.amount,
      issueDate: input.issueDate,
      paymentDate: input.paymentDate,
      supplierId: input.supplierId,
      status: "DELIVERED",
      createdBy: ctx.userId,
    })
    .returning({ id: issuedChecks.id });
  await recordCheckEvent(tx, ctx, { kind: "ISSUED", checkId: row!.id, from: null, to: "DELIVERED", date: input.date, notes: input.notes });
  return row!.id;
}

/** Cambia el estado de un cheque bloqueado y registra el evento. */
async function transitionReceived(
  tx: Tx,
  ctx: ServiceContext,
  check: { id: number; status: string },
  to: ReceivedStatus,
  date: string,
  values: Partial<typeof receivedChecks.$inferInsert> = {},
  event: { notes?: string | null; debitDocumentId?: number | null; supplierDebitDocumentId?: number | null } = {},
) {
  await tx
    .update(receivedChecks)
    .set({ ...values, status: to, updatedAt: new Date(), updatedBy: ctx.userId, version: sql`${receivedChecks.version} + 1` })
    .where(eq(receivedChecks.id, check.id));
  return recordCheckEvent(tx, ctx, { kind: "RECEIVED", checkId: check.id, from: check.status, to, date, ...event });
}

async function transitionIssued(
  tx: Tx,
  ctx: ServiceContext,
  check: { id: number; status: string },
  to: IssuedStatus,
  date: string,
  values: Partial<typeof issuedChecks.$inferInsert> = {},
  event: { notes?: string | null; debitDocumentId?: number | null } = {},
) {
  await tx
    .update(issuedChecks)
    .set({ ...values, status: to, updatedAt: new Date(), updatedBy: ctx.userId, version: sql`${issuedChecks.version} + 1` })
    .where(eq(issuedChecks.id, check.id));
  return recordCheckEvent(tx, ctx, { kind: "ISSUED", checkId: check.id, from: check.status, to, date, ...event });
}

/** Usados por la anulación de cobranzas y pagos. */
export const annulReceivedCheckInTx = (tx: Tx, ctx: ServiceContext, check: { id: number; status: string }, date: string, notes: string) =>
  transitionReceived(tx, ctx, check, "ANNULLED", date, {}, { notes });
export const endorseReceivedCheckInTx = (tx: Tx, ctx: ServiceContext, check: { id: number; status: string }, date: string, notes: string) =>
  transitionReceived(tx, ctx, check, "ENDORSED", date, {}, { notes });
export const returnEndorsedCheckInTx = (tx: Tx, ctx: ServiceContext, check: { id: number; status: string }, date: string, notes: string) =>
  transitionReceived(tx, ctx, check, "IN_PORTFOLIO", date, {}, { notes });
export const annulIssuedCheckInTx = (tx: Tx, ctx: ServiceContext, check: { id: number; status: string }, date: string, notes: string) =>
  transitionIssued(tx, ctx, check, "ANNULLED", date, {}, { notes });

// ───────────────────────────── Operaciones de cartera (checks.operate) ─────────────────────────────

async function lockReceived(tx: Tx, id: number, version: number) {
  const [c] = await tx.select().from(receivedChecks).where(eq(receivedChecks.id, id)).for("update");
  if (!c) throw new DomainError("El cheque no existe.", "NOT_FOUND");
  if (c.version !== version) throw new DomainError("Otro usuario modificó el cheque. Recargue la página.", "CONFLICT");
  return c;
}

async function lockIssued(tx: Tx, id: number, version: number) {
  const [c] = await tx.select().from(issuedChecks).where(eq(issuedChecks.id, id)).for("update");
  if (!c) throw new DomainError("El cheque no existe.", "NOT_FOUND");
  if (c.version !== version) throw new DomainError("Otro usuario modificó el cheque. Recargue la página.", "CONFLICT");
  return c;
}

/** Fecha de una operación con cheques: no futura, no anterior a la de su estado actual, período abierto. */
async function assertOperationDate(tx: Tx, date: string, notBefore: string | null, what: string) {
  if (date > todayIso()) throw new ValidationError({ date: ["La fecha no puede ser posterior a hoy."] });
  if (notBefore && date < notBefore) throw new ValidationError({ date: [`La fecha no puede ser anterior a ${what} (${dmy(notBefore)}).`] });
  const locked = await lockedUntil(tx);
  if (locked && date <= locked) throw new ValidationError({ date: [`El período está cerrado hasta el ${dmy(locked)}.`] });
}

async function lastEventDate(tx: DbOrTx, kind: "RECEIVED" | "ISSUED", id: number) {
  const [row] = await tx
    .select({ date: sql<string>`max(${checkEvents.eventDate})::text` })
    .from(checkEvents)
    .where(kind === "RECEIVED" ? eq(checkEvents.receivedCheckId, id) : eq(checkEvents.issuedCheckId, id));
  return row?.date ?? null;
}

const receivedLabel = (c: { number: string; amount: string }) => `cheque N° ${c.number} por ${formatMoney(c.amount)}`;

function needsConfirmation(warnings: string[], confirmed: boolean) {
  if (warnings.length && !confirmed) throw new DomainError("Revise las advertencias y confirme para continuar.", "NEEDS_CONFIRMATION", { _warnings: warnings });
}

/** IN_PORTFOLIO → DEPOSITED: sale de cartera; el banco no cambia hasta la acreditación. */
export async function depositReceivedCheck(db: Db, ctx: ServiceContext, input: { id: number; version: number; date: string; bankAccountId: number; confirmWarnings: boolean }) {
  assertPermission(ctx, "checks.operate");
  return db.transaction(async (tx) => {
    const c = await lockReceived(tx, input.id, input.version);
    if (c.status !== "IN_PORTFOLIO") throw new DomainError(`Solo se depositan cheques en cartera (este está ${RECEIVED_STATUS_LABEL[c.status as ReceivedStatus].toLowerCase()}).`);
    await assertOperationDate(tx, input.date, await lastEventDate(tx, "RECEIVED", c.id), "la recepción del cheque");
    const [account] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, input.bankAccountId));
    if (!account || !account.active) throw new ValidationError({ bankAccountId: ["La cuenta bancaria no existe o está inactiva."] });
    const warnings: string[] = [];
    if (c.checkType === "DEFERRED" && input.date < c.paymentDate) {
      warnings.push(`El cheque es de pago diferido con fecha ${dmy(c.paymentDate)}: el banco no lo acreditará antes de esa fecha.`);
    }
    needsConfirmation(warnings, input.confirmWarnings);
    await transitionReceived(tx, ctx, c, "DEPOSITED", input.date, { depositBankAccountId: account.id, depositedAt: input.date }, { notes: `Depositado en ${account.displayName}` });
    await recordAudit(tx, ctx, {
      module: "checks",
      action: "deposit",
      entityType: "received_check",
      entityId: c.id,
      before: { status: c.status },
      after: { status: "DEPOSITED", bankAccountId: account.id, date: input.date },
    });
    return { id: c.id };
  });
}

/** DEPOSITED → CREDITED: único ingreso bancario del cheque (origen CHECK_EVENT). */
export async function creditReceivedCheck(db: Db, ctx: ServiceContext, input: { id: number; version: number; date: string }) {
  assertPermission(ctx, "checks.operate");
  return db.transaction(async (tx) => {
    const c = await lockReceived(tx, input.id, input.version);
    if (c.status !== "DEPOSITED") throw new DomainError("Solo se acreditan cheques depositados.");
    await assertOperationDate(tx, input.date, c.depositedAt, "la fecha de depósito");
    const ref: AccountRef = { kind: "BANK", id: c.depositBankAccountId! };
    await lockAccounts(tx, [ref]);
    const eventId = await transitionReceived(tx, ctx, c, "CREDITED", input.date, { creditedAt: input.date });
    const movementId = await recordMovement(tx, ctx, {
      account: ref,
      date: input.date,
      direction: "IN",
      amount: c.amount,
      conceptCode: "CHEQUE_ACREDITADO",
      description: `Acreditación ${receivedLabel(c)} (${c.drawerName})`,
      reference: c.number,
      originType: "CHECK_EVENT",
      checkEventId: eventId,
    });
    await recordAudit(tx, ctx, {
      module: "checks",
      action: "credit",
      entityType: "received_check",
      entityId: c.id,
      before: { status: c.status },
      after: { status: "CREDITED", date: input.date, movementId },
    });
    return { id: c.id };
  });
}

/** IN_PORTFOLIO → CREDITED por ventanilla: ingresa directamente en una caja o cuenta. */
export async function cashReceivedCheck(db: Db, ctx: ServiceContext, input: { id: number; version: number; date: string; account: AccountRef; confirmWarnings: boolean }) {
  assertPermission(ctx, "checks.operate");
  return db.transaction(async (tx) => {
    const c = await lockReceived(tx, input.id, input.version);
    if (c.status !== "IN_PORTFOLIO") throw new DomainError("Solo se cobran por ventanilla cheques en cartera.");
    await assertOperationDate(tx, input.date, await lastEventDate(tx, "RECEIVED", c.id), "la recepción del cheque");
    const warnings: string[] = [];
    if (input.date < c.paymentDate) warnings.push(`La fecha de pago del cheque es ${dmy(c.paymentDate)}: verifique que el banco lo haya pagado.`);
    needsConfirmation(warnings, input.confirmWarnings);
    await lockAccounts(tx, [input.account]);
    const eventId = await transitionReceived(tx, ctx, c, "CREDITED", input.date, { creditedAt: input.date }, { notes: "Cobrado por ventanilla" });
    const movementId = await recordMovement(tx, ctx, {
      account: input.account,
      date: input.date,
      direction: "IN",
      amount: c.amount,
      conceptCode: "CHEQUE_ACREDITADO",
      description: `Cobro por ventanilla ${receivedLabel(c)} (${c.drawerName})`,
      reference: c.number,
      originType: "CHECK_EVENT",
      checkEventId: eventId,
    });
    await recordAudit(tx, ctx, {
      module: "checks",
      action: "cash",
      entityType: "received_check",
      entityId: c.id,
      before: { status: c.status },
      after: { status: "CREDITED", account: input.account, date: input.date, movementId },
    });
    return { id: c.id };
  });
}

/** Pago activo en el que se endosó el cheque (para reconstruir la deuda con ese proveedor). */
async function endorsementPayment(tx: DbOrTx, checkId: number) {
  const [row] = await tx
    .select({ paymentId: supplierPayments.id, supplierId: supplierPayments.supplierId })
    .from(paymentLines)
    .innerJoin(supplierPayments, eq(supplierPayments.id, paymentLines.paymentId))
    .where(and(eq(paymentLines.receivedCheckId, checkId), eq(supplierPayments.status, "ACTIVE")))
    .orderBy(desc(paymentLines.id))
    .limit(1);
  return row ?? null;
}

/**
 * Rechazo de un cheque recibido (G.10). Si estaba acreditado, egreso bancario que revierte la
 * acreditación. Siempre reconstruye la deuda del cliente con un débito interno (D6); si estaba
 * endosado, también la deuda con el proveedor. La cobranza original no se toca.
 */
export async function rejectReceivedCheck(db: Db, ctx: ServiceContext, input: { id: number; version: number; date: string; reason: string; confirmWarnings: boolean }) {
  assertPermission(ctx, "checks.operate");
  return db.transaction(async (tx) => {
    const c = await lockReceived(tx, input.id, input.version);
    if (!["IN_PORTFOLIO", "DEPOSITED", "CREDITED", "ENDORSED"].includes(c.status)) {
      throw new DomainError(`Un cheque ${RECEIVED_STATUS_LABEL[c.status as ReceivedStatus].toLowerCase()} no se puede rechazar.`);
    }
    if (!c.clientId) throw new DomainError("El cheque no tiene cliente asociado.", "INCONSISTENT");
    await assertOperationDate(tx, input.date, await lastEventDate(tx, "RECEIVED", c.id), "el último movimiento del cheque");

    let creditMovement: { id: number; accountKind: string; cashBoxId: number | null; bankAccountId: number | null } | undefined;
    if (c.status === "CREDITED") {
      [creditMovement] = await tx
        .select({ id: treasuryMovements.id, accountKind: treasuryMovements.accountKind, cashBoxId: treasuryMovements.cashBoxId, bankAccountId: treasuryMovements.bankAccountId })
        .from(treasuryMovements)
        .innerJoin(checkEvents, eq(checkEvents.id, treasuryMovements.checkEventId))
        .where(and(eq(checkEvents.receivedCheckId, c.id), eq(checkEvents.toStatus, "CREDITED")));
      if (!creditMovement) throw new DomainError("No se encontró el movimiento de acreditación del cheque.", "INCONSISTENT");
    }
    const endorsed = c.status === "ENDORSED" ? await endorsementPayment(tx, c.id) : null;
    if (c.status === "ENDORSED" && !endorsed) throw new DomainError("No se encontró el pago en el que se endosó el cheque.", "INCONSISTENT");

    const [bank] = await tx.select({ name: banks.name }).from(banks).where(eq(banks.id, c.issuerBankId));
    const what = `Cheque ${bank?.name ?? ""} N° ${c.number} rechazado: ${input.reason}`;
    const debit = await registerInternalDebitInTx(tx, ctx, { direction: "ISSUED", partyId: c.clientId, typeCode: "INT_CHEQUE_RECHAZADO", date: input.date, amount: c.amount, reason: what });
    const supplierDebit = endorsed
      ? await registerInternalDebitInTx(tx, ctx, { direction: "RECEIVED", partyId: endorsed.supplierId, typeCode: "INT_CHEQUE_RECHAZADO", date: input.date, amount: c.amount, reason: `${what} (endosado en pago)` })
      : null;

    const ref: AccountRef | null = creditMovement
      ? creditMovement.accountKind === "CASH"
        ? { kind: "CASH", id: creditMovement.cashBoxId! }
        : { kind: "BANK", id: creditMovement.bankAccountId! }
      : null;
    if (ref) await lockAccounts(tx, [ref]);
    const eventId = await transitionReceived(
      tx,
      ctx,
      c,
      "REJECTED",
      input.date,
      { rejectedAt: input.date, rejectionReason: input.reason },
      { notes: input.reason, debitDocumentId: debit.id, supplierDebitDocumentId: supplierDebit?.id ?? null },
    );
    const movementId = ref
      ? await recordMovement(
          tx,
          ctx,
          {
            account: ref,
            date: input.date,
            direction: "OUT",
            amount: c.amount,
            conceptCode: "CHEQUE_RECHAZADO",
            description: `Rechazo ${receivedLabel(c)} (${c.drawerName})`,
            reference: c.number,
            originType: "CHECK_EVENT",
            checkEventId: eventId,
          },
          { confirmed: input.confirmWarnings },
        )
      : null;
    await recordAudit(tx, ctx, {
      module: "checks",
      action: "reject",
      entityType: "received_check",
      entityId: c.id,
      before: { status: c.status },
      after: { status: "REJECTED", date: input.date, reason: input.reason, movementId, clientDebitDocumentId: debit.id, supplierDebitDocumentId: supplierDebit?.id ?? null },
    });
    return { id: c.id, debitDocumentId: debit.id, supplierDebitDocumentId: supplierDebit?.id ?? null };
  });
}

/** DELIVERED → PRESENTED: el proveedor lo presentó al cobro; el banco todavía no lo debitó. */
export async function presentIssuedCheck(db: Db, ctx: ServiceContext, input: { id: number; version: number; date: string }) {
  assertPermission(ctx, "checks.operate");
  return db.transaction(async (tx) => {
    const c = await lockIssued(tx, input.id, input.version);
    if (c.status !== "DELIVERED") throw new DomainError("Solo se marcan como presentados cheques entregados.");
    await assertOperationDate(tx, input.date, await lastEventDate(tx, "ISSUED", c.id), "la entrega del cheque");
    await transitionIssued(tx, ctx, c, "PRESENTED", input.date);
    await recordAudit(tx, ctx, { module: "checks", action: "present", entityType: "issued_check", entityId: c.id, before: { status: c.status }, after: { status: "PRESENTED", date: input.date } });
    return { id: c.id };
  });
}

/** → DEBITED: único egreso bancario del cheque propio (§26: el dinero sale una sola vez). */
export async function debitIssuedCheck(db: Db, ctx: ServiceContext, input: { id: number; version: number; date: string; confirmWarnings: boolean }) {
  assertPermission(ctx, "checks.operate");
  return db.transaction(async (tx) => {
    const c = await lockIssued(tx, input.id, input.version);
    if (c.status !== "DELIVERED" && c.status !== "PRESENTED") throw new DomainError("Solo se debitan cheques entregados o presentados.");
    await assertOperationDate(tx, input.date, await lastEventDate(tx, "ISSUED", c.id), "el último movimiento del cheque");
    const ref: AccountRef = { kind: "BANK", id: c.bankAccountId };
    await lockAccounts(tx, [ref]);
    const eventId = await transitionIssued(tx, ctx, c, "DEBITED", input.date, { debitedAt: input.date });
    const [supplier] = c.supplierId ? await tx.select({ name: suppliers.legalName }).from(suppliers).where(eq(suppliers.id, c.supplierId)) : [];
    const movementId = await recordMovement(
      tx,
      ctx,
      {
        account: ref,
        date: input.date,
        direction: "OUT",
        amount: c.amount,
        conceptCode: "CHEQUE_DEBITADO",
        description: `Débito cheque propio N° ${c.number}${supplier ? ` (${supplier.name})` : ""}`,
        reference: c.number,
        originType: "CHECK_EVENT",
        checkEventId: eventId,
      },
      { confirmed: input.confirmWarnings },
    );
    await recordAudit(tx, ctx, { module: "checks", action: "debit", entityType: "issued_check", entityId: c.id, before: { status: c.status }, after: { status: "DEBITED", date: input.date, movementId } });
    return { id: c.id };
  });
}

/** Rechazo de un cheque propio: nunca se debitó; se reconstruye la deuda con el proveedor (G.11). */
export async function rejectIssuedCheck(db: Db, ctx: ServiceContext, input: { id: number; version: number; date: string; reason: string }) {
  assertPermission(ctx, "checks.operate");
  return db.transaction(async (tx) => {
    const c = await lockIssued(tx, input.id, input.version);
    if (c.status !== "DELIVERED" && c.status !== "PRESENTED") throw new DomainError("Solo se rechazan cheques entregados o presentados.");
    await assertOperationDate(tx, input.date, await lastEventDate(tx, "ISSUED", c.id), "el último movimiento del cheque");
    const [account] = await tx.select({ name: bankAccounts.displayName }).from(bankAccounts).where(eq(bankAccounts.id, c.bankAccountId));
    const debit = c.supplierId
      ? await registerInternalDebitInTx(tx, ctx, {
          direction: "RECEIVED",
          partyId: c.supplierId,
          typeCode: "INT_CHEQUE_RECHAZADO",
          date: input.date,
          amount: c.amount,
          reason: `Cheque propio N° ${c.number} (${account?.name ?? ""}) rechazado: ${input.reason}`,
        })
      : null;
    await transitionIssued(tx, ctx, c, "REJECTED", input.date, { rejectedAt: input.date }, { notes: input.reason, debitDocumentId: debit?.id ?? null });
    await recordAudit(tx, ctx, {
      module: "checks",
      action: "reject",
      entityType: "issued_check",
      entityId: c.id,
      before: { status: c.status },
      after: { status: "REJECTED", date: input.date, reason: input.reason, supplierDebitDocumentId: debit?.id ?? null },
    });
    return { id: c.id, debitDocumentId: debit?.id ?? null };
  });
}

// ───────────────────────────── Consultas ─────────────────────────────

export const CHECK_PAGE_SIZE = 50;

export async function listReceivedChecks(db: DbOrTx, ctx: ServiceContext, query: { status?: string; q?: string; page?: number }) {
  assertPermission(ctx, "checks.read");
  const status = query.status ?? "IN_PORTFOLIO";
  const conds: SQL[] = [];
  if (status !== "ALL") conds.push(eq(receivedChecks.status, status));
  if (query.q) {
    const like = `%${query.q}%`;
    conds.push(or(ilike(receivedChecks.number, like), ilike(receivedChecks.drawerName, like), ilike(clients.legalName, like), ilike(receivedChecks.drawerTaxId, like))!);
  }
  const where = conds.length ? and(...conds) : undefined;
  const page = query.page ?? 1;
  const base = db
    .select({
      id: receivedChecks.id,
      number: receivedChecks.number,
      format: receivedChecks.format,
      checkType: receivedChecks.checkType,
      bankName: banks.name,
      drawerName: receivedChecks.drawerName,
      drawerTaxId: receivedChecks.drawerTaxId,
      clientId: receivedChecks.clientId,
      clientName: clients.legalName,
      issueDate: receivedChecks.issueDate,
      paymentDate: receivedChecks.paymentDate,
      amount: receivedChecks.amount,
      status: receivedChecks.status,
    })
    .from(receivedChecks)
    .innerJoin(banks, eq(banks.id, receivedChecks.issuerBankId))
    .leftJoin(clients, eq(clients.id, receivedChecks.clientId))
    .where(where);
  const rows = await base.orderBy(asc(receivedChecks.paymentDate), asc(receivedChecks.id)).limit(CHECK_PAGE_SIZE).offset((page - 1) * CHECK_PAGE_SIZE);
  const [totals] = await db
    .select({ count: count(), amount: sql<string>`coalesce(sum(${receivedChecks.amount}), 0)::text` })
    .from(receivedChecks)
    .leftJoin(clients, eq(clients.id, receivedChecks.clientId))
    .where(where);
  return { rows, status, page, total: totals?.count ?? 0, amount: totals?.amount ?? "0" };
}

export async function listIssuedChecks(db: DbOrTx, ctx: ServiceContext, query: { status?: string; q?: string; page?: number }) {
  assertPermission(ctx, "checks.read");
  const status = query.status ?? "PENDING";
  const conds: SQL[] = [];
  if (status === "PENDING") conds.push(inArray(issuedChecks.status, ["ISSUED", "DELIVERED", "PRESENTED"]));
  else if (status !== "ALL") conds.push(eq(issuedChecks.status, status));
  if (query.q) {
    const like = `%${query.q}%`;
    conds.push(or(ilike(issuedChecks.number, like), ilike(suppliers.legalName, like))!);
  }
  const where = conds.length ? and(...conds) : undefined;
  const page = query.page ?? 1;
  const rows = await db
    .select({
      id: issuedChecks.id,
      number: issuedChecks.number,
      format: issuedChecks.format,
      checkType: issuedChecks.checkType,
      bankAccountId: issuedChecks.bankAccountId,
      accountName: bankAccounts.displayName,
      supplierId: issuedChecks.supplierId,
      supplierName: suppliers.legalName,
      issueDate: issuedChecks.issueDate,
      paymentDate: issuedChecks.paymentDate,
      amount: issuedChecks.amount,
      status: issuedChecks.status,
    })
    .from(issuedChecks)
    .innerJoin(bankAccounts, eq(bankAccounts.id, issuedChecks.bankAccountId))
    .leftJoin(suppliers, eq(suppliers.id, issuedChecks.supplierId))
    .where(where)
    .orderBy(asc(issuedChecks.paymentDate), asc(issuedChecks.id))
    .limit(CHECK_PAGE_SIZE)
    .offset((page - 1) * CHECK_PAGE_SIZE);
  const [totals] = await db
    .select({ count: count(), amount: sql<string>`coalesce(sum(${issuedChecks.amount}), 0)::text` })
    .from(issuedChecks)
    .leftJoin(suppliers, eq(suppliers.id, issuedChecks.supplierId))
    .where(where);
  return { rows, status, page, total: totals?.count ?? 0, amount: totals?.amount ?? "0" };
}

/** Total de la cartera de cheques recibidos (G.14-5): Σ cheques IN_PORTFOLIO. */
export async function portfolioTotal(db: DbOrTx): Promise<Decimal> {
  const [row] = await db
    .select({ amount: sql<string>`coalesce(sum(${receivedChecks.amount}), 0)::text` })
    .from(receivedChecks)
    .where(eq(receivedChecks.status, "IN_PORTFOLIO"));
  return new Decimal(row?.amount ?? 0);
}

async function checkHistory(db: DbOrTx, where: SQL) {
  const { rows } = await db.execute<{
    id: number;
    from_status: string | null;
    to_status: string;
    event_date: string;
    notes: string | null;
    created_at: Date;
    username: string | null;
    movement_id: number | null;
    movement_kind: string | null;
    movement_account_id: number | null;
    debit_document_id: number | null;
    supplier_debit_document_id: number | null;
  }>(sql`
    SELECT e.id, e.from_status, e.to_status, e.event_date::text AS event_date, e.notes, e.created_at, u.username,
           m.id AS movement_id, m.account_kind AS movement_kind, coalesce(m.cash_box_id, m.bank_account_id) AS movement_account_id,
           e.debit_document_id, e.supplier_debit_document_id
      FROM check_events e
      LEFT JOIN users u ON u.id = e.created_by
      LEFT JOIN treasury_movements m ON m.check_event_id = e.id
     WHERE ${where}
     ORDER BY e.id`);
  return rows.map((r) => ({
    id: Number(r.id),
    from: r.from_status,
    to: r.to_status,
    date: r.event_date,
    notes: r.notes,
    createdAt: r.created_at,
    username: r.username,
    movement: r.movement_id ? { id: Number(r.movement_id), kind: r.movement_kind as "CASH" | "BANK", accountId: Number(r.movement_account_id) } : null,
    debitDocumentId: r.debit_document_id ? Number(r.debit_document_id) : null,
    supplierDebitDocumentId: r.supplier_debit_document_id ? Number(r.supplier_debit_document_id) : null,
  }));
}

export async function getReceivedCheck(db: DbOrTx, ctx: ServiceContext, id: number) {
  assertPermission(ctx, "checks.read");
  const [c] = await db
    .select({
      check: receivedChecks,
      bankName: banks.name,
      clientName: clients.legalName,
      depositAccountName: bankAccounts.displayName,
    })
    .from(receivedChecks)
    .innerJoin(banks, eq(banks.id, receivedChecks.issuerBankId))
    .leftJoin(clients, eq(clients.id, receivedChecks.clientId))
    .leftJoin(bankAccounts, eq(bankAccounts.id, receivedChecks.depositBankAccountId))
    .where(eq(receivedChecks.id, id));
  if (!c) return null;
  const [collection] = await db
    .select({ id: collections.id, date: collections.collectionDate, status: collections.status, receipt: sql<string | null>`(SELECT number FROM receipts r WHERE r.collection_id = ${collections.id})` })
    .from(collectionLines)
    .innerJoin(collections, eq(collections.id, collectionLines.collectionId))
    .where(eq(collectionLines.receivedCheckId, id));
  const endorsements = await db
    .select({ paymentId: supplierPayments.id, supplierName: suppliers.legalName, status: supplierPayments.status, order: sql<string | null>`(SELECT number FROM payment_orders o WHERE o.payment_id = ${supplierPayments.id})` })
    .from(paymentLines)
    .innerJoin(supplierPayments, eq(supplierPayments.id, paymentLines.paymentId))
    .innerJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId))
    .where(eq(paymentLines.receivedCheckId, id))
    .orderBy(asc(paymentLines.id));
  return { ...c, collection: collection ?? null, endorsements, history: await checkHistory(db, sql`e.received_check_id = ${id}`) };
}

export async function getIssuedCheck(db: DbOrTx, ctx: ServiceContext, id: number) {
  assertPermission(ctx, "checks.read");
  const [c] = await db
    .select({ check: issuedChecks, accountName: bankAccounts.displayName, supplierName: suppliers.legalName })
    .from(issuedChecks)
    .innerJoin(bankAccounts, eq(bankAccounts.id, issuedChecks.bankAccountId))
    .leftJoin(suppliers, eq(suppliers.id, issuedChecks.supplierId))
    .where(eq(issuedChecks.id, id));
  if (!c) return null;
  const [payment] = await db
    .select({ id: supplierPayments.id, status: supplierPayments.status, order: sql<string | null>`(SELECT number FROM payment_orders o WHERE o.payment_id = ${supplierPayments.id})` })
    .from(paymentLines)
    .innerJoin(supplierPayments, eq(supplierPayments.id, paymentLines.paymentId))
    .where(eq(paymentLines.issuedCheckId, id));
  return { ...c, payment: payment ?? null, history: await checkHistory(db, sql`e.issued_check_id = ${id}`) };
}

/** Cheques en cartera para endosar en un pago. */
export async function portfolioChecks(db: DbOrTx) {
  return db
    .select({
      id: receivedChecks.id,
      number: receivedChecks.number,
      bankName: banks.name,
      drawerName: receivedChecks.drawerName,
      paymentDate: receivedChecks.paymentDate,
      amount: receivedChecks.amount,
    })
    .from(receivedChecks)
    .innerJoin(banks, eq(banks.id, receivedChecks.issuerBankId))
    .where(eq(receivedChecks.status, "IN_PORTFOLIO"))
    .orderBy(asc(receivedChecks.paymentDate), asc(receivedChecks.id));
}

/** Saldo disponible de una cuenta (G.9-3) dentro de una transacción. */
export async function availableBankBalance(db: DbOrTx, bankAccountId: number): Promise<Decimal> {
  const book = await accountBalance(db, { kind: "BANK", id: bankAccountId });
  const [row] = await db
    .select({ pending: sql<string>`coalesce(sum(${issuedChecks.amount}), 0)::text` })
    .from(issuedChecks)
    .where(and(eq(issuedChecks.bankAccountId, bankAccountId), inArray(issuedChecks.status, ["ISSUED", "DELIVERED", "PRESENTED"])));
  return book.minus(row?.pending ?? 0);
}
