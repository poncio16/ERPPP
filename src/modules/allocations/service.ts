import Decimal from "decimal.js";
import { and, asc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { recordAudit } from "@/modules/audit/service";
import { formatDocumentNumber } from "@/modules/tax/calc";
import { DomainError, ValidationError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { todayIso } from "@/lib/format";
import { assertPermission } from "@/server/authorization";
import type { ServiceContext } from "@/server/context";
import type { Db, DbOrTx, Tx } from "@/server/db/drizzle";
import { allocations, collections, documents, documentTypes, supplierPayments, type Direction } from "@/server/db/schema";
import { statusForBalance, sumAmounts } from "./plan";

/**
 * Servicio central de imputaciones (G.7). Aplica un crédito (cobranza, pago, NC o saldo inicial
 * acreedor) contra comprobantes deudores del mismo tercero, sin sobreimputar. Todas las
 * validaciones se hacen con las filas bloqueadas; la base vuelve a controlar los saldos.
 */

export const DEBIT_CLASSES = ["INVOICE", "DEBIT_NOTE", "INTERNAL_DEBIT", "OPENING_DEBIT"] as const;
export const CREDIT_DOCUMENT_CLASSES = ["CREDIT_NOTE", "OPENING_CREDIT"] as const;

export type CreditSourceKind = "COLLECTION" | "PAYMENT" | "CREDIT_DOCUMENT";
export interface CreditSource {
  kind: CreditSourceKind;
  id: number;
}
export interface AllocationItem {
  documentId: number;
  amount: string;
}

const docLabel = (d: { typeName: string; pointOfSale: number; number: number }) => `${d.typeName} ${formatDocumentNumber(d.pointOfSale, d.number)}`;

/** Comprobantes bloqueados (FOR UPDATE, en orden de id) con su clase y nombre de tipo. */
async function lockDocuments(tx: Tx, ids: number[]) {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  if (!sorted.length) return new Map<number, LockedDocument>();
  const rows = await tx
    .select({
      id: documents.id,
      direction: documents.direction,
      clientId: documents.clientId,
      supplierId: documents.supplierId,
      status: documents.status,
      total: documents.total,
      balance: documents.balance,
      pointOfSale: documents.pointOfSale,
      number: documents.number,
      typeName: documentTypes.name,
      cls: documentTypes.class,
    })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .where(inArray(documents.id, sorted))
    .orderBy(asc(documents.id))
    .for("update", { of: documents });
  return new Map(rows.map((r) => [r.id, r]));
}
type LockedDocument = {
  id: number;
  direction: Direction;
  clientId: number | null;
  supplierId: number | null;
  status: string;
  total: string;
  balance: string;
  pointOfSale: number;
  number: number;
  typeName: string;
  cls: string;
};

async function setDocumentBalance(tx: Tx, ctx: ServiceContext, doc: LockedDocument, balance: Decimal) {
  await tx
    .update(documents)
    .set({
      balance: balance.toFixed(2),
      status: statusForBalance(balance, doc.total),
      updatedAt: new Date(),
      updatedBy: ctx.userId,
      version: sql`${documents.version} + 1`,
    })
    .where(eq(documents.id, doc.id));
  doc.balance = balance.toFixed(2);
}

interface LockedSource {
  kind: CreditSourceKind;
  id: number;
  direction: Direction;
  partyId: number;
  available: Decimal;
  label: string;
  document?: LockedDocument;
}

/** Bloquea el crédito. Para una NC el bloqueo se hace junto con los comprobantes destino. */
async function lockSource(tx: Tx, source: CreditSource, targetIds: number[]): Promise<{ src: LockedSource; docs: Map<number, LockedDocument> }> {
  if (source.kind === "COLLECTION") {
    const [c] = await tx.select().from(collections).where(eq(collections.id, source.id)).for("update");
    if (!c) throw new DomainError("La cobranza no existe.", "NOT_FOUND");
    if (c.status !== "ACTIVE") throw new DomainError("La cobranza está anulada.");
    return {
      src: { kind: "COLLECTION", id: c.id, direction: "ISSUED", partyId: c.clientId, available: new Decimal(c.unappliedAmount), label: `la cobranza` },
      docs: await lockDocuments(tx, targetIds),
    };
  }
  if (source.kind === "PAYMENT") {
    const [p] = await tx.select().from(supplierPayments).where(eq(supplierPayments.id, source.id)).for("update");
    if (!p) throw new DomainError("El pago no existe.", "NOT_FOUND");
    if (p.status !== "ACTIVE") throw new DomainError("El pago está anulado.");
    return {
      src: { kind: "PAYMENT", id: p.id, direction: "RECEIVED", partyId: p.supplierId, available: new Decimal(p.unappliedAmount), label: `el pago` },
      docs: await lockDocuments(tx, targetIds),
    };
  }
  const docs = await lockDocuments(tx, [source.id, ...targetIds]);
  const d = docs.get(source.id);
  if (!d) throw new DomainError("La nota de crédito no existe.", "NOT_FOUND");
  if (d.status === "ANNULLED") throw new DomainError(`${docLabel(d)} está anulada.`);
  if (!(CREDIT_DOCUMENT_CLASSES as readonly string[]).includes(d.cls)) {
    throw new DomainError("Solo se imputan notas de crédito o saldos iniciales acreedores.");
  }
  return {
    src: {
      kind: "CREDIT_DOCUMENT",
      id: d.id,
      direction: d.direction,
      partyId: (d.direction === "ISSUED" ? d.clientId : d.supplierId)!,
      available: new Decimal(d.balance),
      label: docLabel(d),
      document: d,
    },
    docs,
  };
}

/**
 * Imputa un crédito contra uno o más comprobantes, dentro de la transacción de quien llama.
 * Valida mismo tercero y circuito, comprobantes deudores vigentes, importe ≤ saldo de cada
 * comprobante y Σ importes ≤ crédito disponible. Devuelve los ids de las imputaciones creadas.
 */
export async function applyAllocationsInTx(tx: Tx, ctx: ServiceContext, source: CreditSource, items: AllocationItem[], date: string): Promise<number[]> {
  if (!items.length) return [];
  const ids = items.map((i) => i.documentId);
  if (new Set(ids).size !== ids.length) throw new ValidationError({ allocations: ["Un comprobante figura dos veces en la imputación."] });
  const { src, docs } = await lockSource(tx, source, ids);

  const errors: string[] = [];
  for (const item of items) {
    const d = docs.get(item.documentId);
    const amount = new Decimal(item.amount);
    if (!d) {
      errors.push(`El comprobante ${item.documentId} no existe.`);
      continue;
    }
    const sameParty = d.direction === src.direction && (d.direction === "ISSUED" ? d.clientId : d.supplierId) === src.partyId;
    if (!sameParty) errors.push(`${docLabel(d)} no pertenece al mismo ${src.direction === "ISSUED" ? "cliente" : "proveedor"}.`);
    else if (d.status === "ANNULLED") errors.push(`${docLabel(d)} está anulado.`);
    else if (!(DEBIT_CLASSES as readonly string[]).includes(d.cls)) errors.push(`${docLabel(d)} no es un comprobante deudor.`);
    else if (amount.lte(0)) errors.push(`El importe imputado a ${docLabel(d)} debe ser mayor que cero.`);
    else if (amount.gt(d.balance)) {
      errors.push(`El importe imputado a ${docLabel(d)} (${formatMoney(amount)}) supera su saldo pendiente (${formatMoney(d.balance)}).`);
    }
  }
  const total = sumAmounts(items);
  if (total.gt(src.available)) {
    errors.push(`El total imputado (${formatMoney(total)}) supera el crédito disponible de ${src.label} (${formatMoney(src.available)}).`);
  }
  if (errors.length) throw new ValidationError({ allocations: errors });

  const created: number[] = [];
  for (const item of items) {
    const d = docs.get(item.documentId)!;
    const [row] = await tx
      .insert(allocations)
      .values({
        ledger: src.direction === "ISSUED" ? "AR" : "AP",
        targetDocumentId: d.id,
        sourceKind: src.kind,
        sourceCollectionId: src.kind === "COLLECTION" ? src.id : null,
        sourcePaymentId: src.kind === "PAYMENT" ? src.id : null,
        sourceDocumentId: src.kind === "CREDIT_DOCUMENT" ? src.id : null,
        amount: new Decimal(item.amount).toFixed(2),
        allocationDate: date,
        createdBy: ctx.userId,
      })
      .returning({ id: allocations.id });
    created.push(row!.id);
    await setDocumentBalance(tx, ctx, d, new Decimal(d.balance).minus(item.amount));
  }
  await setSourceAvailable(tx, ctx, src, src.available.minus(total));
  return created;
}

async function setSourceAvailable(tx: Tx, ctx: ServiceContext, src: LockedSource, available: Decimal) {
  const value = available.toFixed(2);
  if (src.kind === "COLLECTION") {
    await tx.update(collections).set({ unappliedAmount: value, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(collections.id, src.id));
  } else if (src.kind === "PAYMENT") {
    await tx.update(supplierPayments).set({ unappliedAmount: value, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(supplierPayments.id, src.id));
  } else {
    await setDocumentBalance(tx, ctx, src.document!, available);
  }
  src.available = available;
}

/**
 * Desimputación (G.7): marca la imputación REVERSED y restituye los saldos del comprobante y del
 * crédito. No toca la cuenta corriente ni la tesorería. Quien llama controla el permiso.
 */
export async function reverseAllocationInTx(tx: Tx, ctx: ServiceContext, allocationId: number, reason: string) {
  const [a] = await tx.select().from(allocations).where(eq(allocations.id, allocationId)).for("update");
  if (!a) throw new DomainError("La imputación no existe.", "NOT_FOUND");
  if (a.status !== "ACTIVE") throw new DomainError("La imputación ya fue desimputada.");
  const source: CreditSource =
    a.sourceKind === "COLLECTION"
      ? { kind: "COLLECTION", id: a.sourceCollectionId! }
      : a.sourceKind === "PAYMENT"
        ? { kind: "PAYMENT", id: a.sourcePaymentId! }
        : { kind: "CREDIT_DOCUMENT", id: a.sourceDocumentId! };
  // Al anular una cobranza o un pago, sus imputaciones se revierten antes de marcarla anulada:
  // por eso aquí se bloquea la fila sin exigir que siga activa.
  const { src, docs } =
    source.kind === "CREDIT_DOCUMENT" ? await lockSource(tx, source, [a.targetDocumentId]) : await lockOperationForReversal(tx, source, a.targetDocumentId);
  await tx
    .update(allocations)
    .set({ status: "REVERSED", reversedAt: new Date(), reversedBy: ctx.userId, reversalReason: reason })
    .where(eq(allocations.id, a.id));
  const target = docs.get(a.targetDocumentId)!;
  await setDocumentBalance(tx, ctx, target, new Decimal(target.balance).plus(a.amount));
  await setSourceAvailable(tx, ctx, src, src.available.plus(a.amount));
  return { ...a, targetLabel: docLabel(target) };
}

async function lockOperationForReversal(tx: Tx, source: CreditSource, targetId: number) {
  if (source.kind === "COLLECTION") {
    const [c] = await tx.select().from(collections).where(eq(collections.id, source.id)).for("update");
    if (!c) throw new DomainError("La cobranza no existe.", "NOT_FOUND");
    return {
      src: { kind: source.kind, id: c.id, direction: "ISSUED" as const, partyId: c.clientId, available: new Decimal(c.unappliedAmount), label: "la cobranza" },
      docs: await lockDocuments(tx, [targetId]),
    };
  }
  const [p] = await tx.select().from(supplierPayments).where(eq(supplierPayments.id, source.id)).for("update");
  if (!p) throw new DomainError("El pago no existe.", "NOT_FOUND");
  return {
    src: { kind: source.kind, id: p.id, direction: "RECEIVED" as const, partyId: p.supplierId, available: new Decimal(p.unappliedAmount), label: "el pago" },
    docs: await lockDocuments(tx, [targetId]),
  };
}

// ───────────────────────────── Operaciones con permiso propio ─────────────────────────────

const SOURCE_AUDIT: Record<CreditSourceKind, string> = { COLLECTION: "collection", PAYMENT: "payment", CREDIT_DOCUMENT: "document" };

/** Imputación posterior de un crédito disponible (panel de imputaciones, ficha de la cobranza o del pago). */
export async function allocateCredit(db: Db, ctx: ServiceContext, input: { source: CreditSource; items: AllocationItem[] }) {
  assertPermission(ctx, "allocations.create");
  if (!input.items.length) throw new ValidationError({ allocations: ["Indique al menos un comprobante e importe."] });
  return db.transaction(async (tx) => {
    const ids = await applyAllocationsInTx(tx, ctx, input.source, input.items, todayIso());
    await recordAudit(tx, ctx, {
      module: "allocations",
      action: "create",
      entityType: SOURCE_AUDIT[input.source.kind],
      entityId: input.source.id,
      after: { allocations: ids, items: input.items },
    });
    return { ids };
  });
}

export async function reverseAllocation(db: Db, ctx: ServiceContext, input: { id: number; reason: string }) {
  assertPermission(ctx, "allocations.reverse");
  return db.transaction(async (tx) => {
    const a = await reverseAllocationInTx(tx, ctx, input.id, input.reason);
    await recordAudit(tx, ctx, {
      module: "allocations",
      action: "reverse",
      entityType: "allocation",
      entityId: a.id,
      before: { status: "ACTIVE", target: a.targetDocumentId, amount: a.amount },
      after: { status: "REVERSED", reason: input.reason },
    });
    return { id: a.id };
  });
}

// ───────────────────────────── Lecturas ─────────────────────────────

export interface OpenDebitRow {
  id: number;
  label: string;
  issueDate: string;
  dueDate: string;
  total: string;
  balance: string;
}

/** Comprobantes deudores con saldo de un tercero, por vencimiento. */
export async function openDebits(db: DbOrTx, direction: Direction, partyId: number): Promise<OpenDebitRow[]> {
  const rows = await db
    .select({
      id: documents.id,
      typeName: documentTypes.name,
      pointOfSale: documents.pointOfSale,
      number: documents.number,
      issueDate: documents.issueDate,
      dueDate: documents.dueDate,
      total: documents.total,
      balance: documents.balance,
    })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .where(
      and(
        eq(documents.direction, direction),
        eq(direction === "ISSUED" ? documents.clientId : documents.supplierId, partyId),
        ne(documents.status, "ANNULLED"),
        gt(documents.balance, "0"),
        inArray(documentTypes.class, [...DEBIT_CLASSES]),
      ),
    )
    .orderBy(asc(documents.dueDate), asc(documents.issueDate), asc(documents.id));
  return rows.map((r) => ({ id: r.id, label: docLabel(r), issueDate: r.issueDate, dueDate: r.dueDate, total: r.total, balance: r.balance }));
}

export interface AvailableCredit {
  kind: CreditSourceKind;
  id: number;
  label: string;
  date: string;
  total: string;
  available: string;
}

/** Créditos sin aplicar de un tercero: cobranzas/pagos con saldo y NC o saldos iniciales acreedores. */
export async function availableCredits(db: DbOrTx, direction: Direction, partyId: number): Promise<AvailableCredit[]> {
  const ops =
    direction === "ISSUED"
      ? await db
          .select({ id: collections.id, date: collections.collectionDate, total: collections.totalAmount, available: collections.unappliedAmount, number: sql<string | null>`(SELECT number FROM receipts r WHERE r.collection_id = ${collections.id})` })
          .from(collections)
          .where(and(eq(collections.clientId, partyId), eq(collections.status, "ACTIVE"), gt(collections.unappliedAmount, "0")))
          .orderBy(asc(collections.collectionDate), asc(collections.id))
      : await db
          .select({ id: supplierPayments.id, date: supplierPayments.paymentDate, total: supplierPayments.totalAmount, available: supplierPayments.unappliedAmount, number: sql<string | null>`(SELECT number FROM payment_orders o WHERE o.payment_id = ${supplierPayments.id})` })
          .from(supplierPayments)
          .where(and(eq(supplierPayments.supplierId, partyId), eq(supplierPayments.status, "ACTIVE"), gt(supplierPayments.unappliedAmount, "0")))
          .orderBy(asc(supplierPayments.paymentDate), asc(supplierPayments.id));
  const notes = await db
    .select({
      id: documents.id,
      typeName: documentTypes.name,
      pointOfSale: documents.pointOfSale,
      number: documents.number,
      issueDate: documents.issueDate,
      total: documents.total,
      balance: documents.balance,
    })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .where(
      and(
        eq(documents.direction, direction),
        eq(direction === "ISSUED" ? documents.clientId : documents.supplierId, partyId),
        ne(documents.status, "ANNULLED"),
        gt(documents.balance, "0"),
        inArray(documentTypes.class, [...CREDIT_DOCUMENT_CLASSES]),
      ),
    )
    .orderBy(asc(documents.issueDate), asc(documents.id));
  const kind: CreditSourceKind = direction === "ISSUED" ? "COLLECTION" : "PAYMENT";
  const opName = direction === "ISSUED" ? "Cobranza" : "Pago";
  return [
    ...ops.map((o) => ({ kind, id: o.id, label: `${opName} ${o.number ?? `#${o.id}`}`, date: o.date, total: o.total, available: o.available })),
    ...notes.map((n) => ({ kind: "CREDIT_DOCUMENT" as const, id: n.id, label: docLabel(n), date: n.issueDate, total: n.total, available: n.balance })),
  ];
}

export interface AllocationRow {
  id: number;
  date: string;
  amount: string;
  status: string;
  reversedAt: Date | null;
  reversalReason: string | null;
  createdAt: Date;
  targetId: number;
  targetLabel: string;
  sourceKind: CreditSourceKind;
  sourceId: number;
  sourceLabel: string;
}

/** Imputaciones (activas y revertidas) de un comprobante, una cobranza o un pago. */
export async function allocationsOf(db: DbOrTx, of: { documentId: number } | { collectionId: number } | { paymentId: number }): Promise<AllocationRow[]> {
  const where =
    "documentId" in of
      ? sql`(a.target_document_id = ${of.documentId} OR a.source_document_id = ${of.documentId})`
      : "collectionId" in of
        ? sql`a.source_collection_id = ${of.collectionId}`
        : sql`a.source_payment_id = ${of.paymentId}`;
  const { rows } = await db.execute<{
    id: number;
    date: string;
    amount: string;
    status: string;
    reversed_at: Date | null;
    reversal_reason: string | null;
    created_at: Date;
    target_id: number;
    target_label: string;
    source_kind: CreditSourceKind;
    source_id: number;
    source_label: string;
  }>(sql`
    SELECT a.id, a.allocation_date::text AS date, a.amount::text AS amount, a.status, a.reversed_at, a.reversal_reason, a.created_at,
           t.id AS target_id, tt.name || ' ' || lpad(t.point_of_sale::text, 5, '0') || '-' || lpad(t.number::text, 8, '0') AS target_label,
           a.source_kind,
           coalesce(a.source_collection_id, a.source_payment_id, a.source_document_id) AS source_id,
           CASE a.source_kind
             WHEN 'COLLECTION' THEN 'Cobranza ' || coalesce((SELECT number FROM receipts r WHERE r.collection_id = a.source_collection_id), '#' || a.source_collection_id)
             WHEN 'PAYMENT' THEN 'Pago ' || coalesce((SELECT number FROM payment_orders o WHERE o.payment_id = a.source_payment_id), '#' || a.source_payment_id)
             ELSE st.name || ' ' || lpad(s.point_of_sale::text, 5, '0') || '-' || lpad(s.number::text, 8, '0')
           END AS source_label
      FROM allocations a
      JOIN documents t ON t.id = a.target_document_id
      JOIN document_types tt ON tt.id = t.document_type_id
      LEFT JOIN documents s ON s.id = a.source_document_id
      LEFT JOIN document_types st ON st.id = s.document_type_id
     WHERE ${where}
     ORDER BY a.id`);
  return rows.map((r) => ({
    id: Number(r.id),
    date: r.date,
    amount: r.amount,
    status: r.status,
    reversedAt: r.reversed_at,
    reversalReason: r.reversal_reason,
    createdAt: new Date(r.created_at),
    targetId: Number(r.target_id),
    targetLabel: r.target_label,
    sourceKind: r.source_kind,
    sourceId: Number(r.source_id),
    sourceLabel: r.source_label,
  }));
}
