import Decimal from "decimal.js";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { applyAllocationsInTx, reverseAllocationInTx, type CreditSource } from "@/modules/allocations/service";
import { recordAudit } from "@/modules/audit/service";
import { lockedUntil } from "@/modules/config/service";
import { annulInternalDebitInTx, registerInternalDebitInTx } from "@/modules/documents/service";
import { lastClosureDate, lockAccounts, recordMovement, reverseMovementInTx } from "@/modules/treasury/service";
import type { AccountRef } from "@/modules/treasury/schemas";
import { DomainError, ValidationError } from "@/lib/errors";
import { todayIso } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { pgError } from "@/lib/pg-error";
import { assertPermission } from "@/server/authorization";
import type { ServiceContext } from "@/server/context";
import type { Db, DbOrTx, Tx } from "@/server/db/drizzle";
import { allocations, collections, documents, documentTypes, refunds, supplierPayments, treasuryMovements, type Direction } from "@/server/db/schema";
import type { RegisterRefundInput } from "./schemas";

/**
 * Devoluciones de saldo a favor (D14). Clientes (AR): la empresa devuelve dinero, egreso de caja o
 * banco. Proveedores (AP): el proveedor reintegra un anticipo, ingreso. En ambos casos se registra un
 * débito interno no fiscal (INT_DEVOLUCION) en la cuenta corriente y el crédito elegido se imputa
 * contra él, así el saldo a favor se consume y la cuenta corriente queda explicada.
 */

const dmy = (iso: string) => iso.split("-").reverse().join("/");

const SOURCE_LABEL = { COLLECTION: "la cobranza", PAYMENT: "el pago", CREDIT_DOCUMENT: "el comprobante" } as const;

/** Crédito de origen con su tercero y disponible, bloqueado para la operación. */
async function lockCredit(tx: Tx, source: CreditSource): Promise<{ direction: Direction; partyId: number; available: Decimal }> {
  if (source.kind === "COLLECTION") {
    const [c] = await tx.select().from(collections).where(eq(collections.id, source.id)).for("update");
    if (!c || c.status !== "ACTIVE") throw new DomainError("La cobranza no existe o está anulada.");
    return { direction: "ISSUED", partyId: c.clientId, available: new Decimal(c.unappliedAmount) };
  }
  if (source.kind === "PAYMENT") {
    const [p] = await tx.select().from(supplierPayments).where(eq(supplierPayments.id, source.id)).for("update");
    if (!p || p.status !== "ACTIVE") throw new DomainError("El pago no existe o está anulado.");
    return { direction: "RECEIVED", partyId: p.supplierId, available: new Decimal(p.unappliedAmount) };
  }
  const [d] = await tx
    .select({ doc: documents, cls: documentTypes.class })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .where(eq(documents.id, source.id))
    .for("update", { of: documents });
  if (!d || d.doc.status === "ANNULLED") throw new DomainError("El comprobante no existe o está anulado.");
  if (d.cls !== "CREDIT_NOTE" && d.cls !== "OPENING_CREDIT") throw new DomainError("Solo se devuelven notas de crédito o saldos iniciales acreedores.");
  return { direction: d.doc.direction as Direction, partyId: (d.doc.direction === "ISSUED" ? d.doc.clientId : d.doc.supplierId)!, available: new Decimal(d.doc.balance) };
}

export async function registerRefund(db: Db, ctx: ServiceContext, input: RegisterRefundInput) {
  assertPermission(ctx, "refunds.create");
  const existing = async () => {
    const [row] = await db.select({ id: refunds.id }).from(refunds).where(eq(refunds.idempotencyKey, input.idempotencyKey));
    return row ? { id: row.id, existing: true } : null;
  };
  const before = await existing();
  if (before) return before;
  try {
    return await db.transaction((tx) => registerInTx(tx, ctx, input));
  } catch (e) {
    const { code, constraint } = pgError(e);
    if (code === "23505" && constraint === "ux_refunds_idempotency_key") {
      const again = await existing();
      if (again) return again;
    }
    throw e;
  }
}

async function registerInTx(tx: Tx, ctx: ServiceContext, input: RegisterRefundInput) {
  if (input.date > todayIso()) throw new ValidationError({ date: ["La fecha no puede ser posterior a hoy."] });
  const locked = await lockedUntil(tx);
  if (locked && input.date <= locked) throw new ValidationError({ date: [`El período está cerrado hasta el ${dmy(locked)}.`] });

  const account: AccountRef = input.method === "CASH" ? { kind: "CASH", id: input.cashBoxId! } : { kind: "BANK", id: input.bankAccountId! };
  await lockAccounts(tx, [account]);

  const source: CreditSource = { kind: input.sourceKind, id: input.sourceId };
  const credit = await lockCredit(tx, source);
  if (new Decimal(input.amount).gt(credit.available)) {
    throw new ValidationError({ amount: [`El importe supera el saldo a favor disponible de ${SOURCE_LABEL[source.kind]} (${formatMoney(credit.available)}).`] });
  }
  const ar = credit.direction === "ISSUED";

  const debit = await registerInternalDebitInTx(tx, ctx, {
    direction: credit.direction,
    partyId: credit.partyId,
    typeCode: "INT_DEVOLUCION",
    date: input.date,
    amount: input.amount,
    reason: input.reason,
  });
  const [refund] = await tx
    .insert(refunds)
    .values({
      ledger: ar ? "AR" : "AP",
      clientId: ar ? credit.partyId : null,
      supplierId: ar ? null : credit.partyId,
      refundDate: input.date,
      amount: input.amount,
      method: input.method,
      cashBoxId: input.method === "CASH" ? input.cashBoxId! : null,
      bankAccountId: input.method === "TRANSFER" ? input.bankAccountId! : null,
      reference: input.reference,
      documentId: debit.id,
      idempotencyKey: input.idempotencyKey,
      createdBy: ctx.userId,
    })
    .returning({ id: refunds.id });
  const [allocationId] = await applyAllocationsInTx(tx, ctx, source, [{ documentId: debit.id, amount: input.amount }], input.date);
  const movementId = await recordMovement(
    tx,
    ctx,
    {
      account,
      date: input.date,
      direction: ar ? "OUT" : "IN",
      amount: input.amount,
      conceptCode: "DEVOLUCION",
      description: `${ar ? "Devolución de saldo a favor al cliente" : "Reintegro de anticipo del proveedor"}: ${input.reason}`,
      reference: input.reference,
      originType: "REFUND",
      refundId: refund!.id,
    },
    { confirmed: input.confirmWarnings },
  );
  await recordAudit(tx, ctx, {
    module: "refunds",
    action: "create",
    entityType: "refund",
    entityId: refund!.id,
    after: { ledger: ar ? "AR" : "AP", partyId: credit.partyId, source, amount: input.amount, method: input.method, account, debitDocumentId: debit.id, allocationId, movementId },
  });
  return { id: refund!.id, documentId: debit.id };
}

export async function annulRefund(db: Db, ctx: ServiceContext, input: { id: number; reason: string }) {
  assertPermission(ctx, "refunds.annul");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, input.id)).for("update");
    if (!r) throw new DomainError("La devolución no existe.", "NOT_FOUND");
    if (r.status === "ANNULLED") throw new DomainError("La devolución ya está anulada.");
    const locked = await lockedUntil(tx);
    if (locked && r.refundDate <= locked) throw new DomainError(`La devolución pertenece a un período cerrado (hasta el ${dmy(locked)}).`);
    if (r.method === "CASH") {
      const closed = await lastClosureDate(tx, r.cashBoxId!);
      if (closed && r.refundDate <= closed) throw new DomainError(`No se puede anular: la caja está cerrada hasta el ${dmy(closed)}, que incluye la fecha de la devolución.`);
    }
    await lockAccounts(tx, [r.method === "CASH" ? { kind: "CASH", id: r.cashBoxId! } : { kind: "BANK", id: r.bankAccountId! }]);

    const why = `Anulación de la devolución: ${input.reason}`;
    const active = await tx
      .select({ id: allocations.id })
      .from(allocations)
      .where(and(eq(allocations.targetDocumentId, r.documentId), eq(allocations.status, "ACTIVE")))
      .orderBy(asc(allocations.id));
    for (const a of active) await reverseAllocationInTx(tx, ctx, a.id, why);
    const [movement] = await tx.select({ id: treasuryMovements.id }).from(treasuryMovements).where(eq(treasuryMovements.refundId, r.id));
    if (!movement) throw new DomainError("No se encontró el movimiento de tesorería de la devolución.", "INCONSISTENT");
    const reversalId = await reverseMovementInTx(tx, ctx, movement.id, why);
    await annulInternalDebitInTx(tx, ctx, r.documentId, why);
    await tx.update(refunds).set({ status: "ANNULLED", annulledAt: new Date(), annulledBy: ctx.userId, annulReason: input.reason, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(refunds.id, r.id));
    await recordAudit(tx, ctx, {
      module: "refunds",
      action: "annul",
      entityType: "refund",
      entityId: r.id,
      before: { status: r.status },
      after: { status: "ANNULLED", reason: input.reason, reversedAllocations: active.map((a) => a.id), reversalMovement: reversalId },
    });
    return { id: r.id };
  });
}

/** ¿El débito interno pertenece a una devolución vigente? (su imputación solo se deshace anulándola). */
export async function activeRefundForDocument(db: DbOrTx, documentId: number) {
  const [row] = await db.select({ id: refunds.id }).from(refunds).where(and(eq(refunds.documentId, documentId), eq(refunds.status, "ACTIVE")));
  return row?.id ?? null;
}

export const REFUND_PAGE_SIZE = 50;

export interface RefundRow {
  id: number;
  ledger: "AR" | "AP";
  date: string;
  partyId: number;
  partyName: string;
  amount: string;
  method: "CASH" | "TRANSFER";
  accountName: string;
  reference: string | null;
  documentId: number;
  sourceLabel: string | null;
  status: "ACTIVE" | "ANNULLED";
  annulReason: string | null;
  username: string | null;
}

export async function listRefunds(db: DbOrTx, ctx: ServiceContext, query: { ledger?: "AR" | "AP"; page?: number }) {
  assertPermission(ctx, "treasury.read");
  const page = query.page ?? 1;
  const where = query.ledger ? sql`r.ledger = ${query.ledger}` : sql`true`;
  const { rows } = await db.execute<{
    id: number;
    ledger: "AR" | "AP";
    refund_date: string;
    party_id: number;
    party_name: string;
    amount: string;
    method: "CASH" | "TRANSFER";
    account_name: string;
    reference: string | null;
    document_id: number;
    source_label: string | null;
    status: "ACTIVE" | "ANNULLED";
    annul_reason: string | null;
    username: string | null;
  }>(sql`
    SELECT r.id, r.ledger, r.refund_date::text, coalesce(r.client_id, r.supplier_id) AS party_id,
           coalesce(c.legal_name, s.legal_name) AS party_name, r.amount::text, r.method,
           coalesce(cb.name, ba.display_name) AS account_name, r.reference, r.document_id,
           (SELECT CASE a.source_kind
                     WHEN 'COLLECTION' THEN 'Cobranza ' || coalesce((SELECT number FROM receipts x WHERE x.collection_id = a.source_collection_id), '#' || a.source_collection_id)
                     WHEN 'PAYMENT' THEN 'Pago ' || coalesce((SELECT number FROM payment_orders x WHERE x.payment_id = a.source_payment_id), '#' || a.source_payment_id)
                     ELSE (SELECT t.name || ' ' || lpad(d.point_of_sale::text, 5, '0') || '-' || lpad(d.number::text, 8, '0')
                             FROM documents d JOIN document_types t ON t.id = d.document_type_id WHERE d.id = a.source_document_id)
                   END
              FROM allocations a WHERE a.target_document_id = r.document_id ORDER BY a.id LIMIT 1) AS source_label,
           r.status, r.annul_reason, u.username
      FROM refunds r
      LEFT JOIN clients c ON c.id = r.client_id
      LEFT JOIN suppliers s ON s.id = r.supplier_id
      LEFT JOIN cash_boxes cb ON cb.id = r.cash_box_id
      LEFT JOIN bank_accounts ba ON ba.id = r.bank_account_id
      LEFT JOIN users u ON u.id = r.created_by
     WHERE ${where}
     ORDER BY r.refund_date DESC, r.id DESC
     LIMIT ${REFUND_PAGE_SIZE} OFFSET ${(page - 1) * REFUND_PAGE_SIZE}`);
  const [totals] = await db
    .select({ count: count() })
    .from(refunds)
    .where(query.ledger ? eq(refunds.ledger, query.ledger) : undefined);
  const items: RefundRow[] = rows.map((r) => ({
    id: Number(r.id),
    ledger: r.ledger,
    date: r.refund_date,
    partyId: Number(r.party_id),
    partyName: r.party_name,
    amount: r.amount,
    method: r.method,
    accountName: r.account_name,
    reference: r.reference,
    documentId: Number(r.document_id),
    sourceLabel: r.source_label,
    status: r.status,
    annulReason: r.annul_reason,
    username: r.username,
  }));
  return { rows: items, page, total: totals?.count ?? 0 };
}

