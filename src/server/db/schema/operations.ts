import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { auditColumns, id, money, ref, tstz } from "./_common";
import { taxCatalog } from "./config";
import { documents } from "./documents";
import { clients, suppliers } from "./parties";
import { bankAccounts, cashBoxes, issuedChecks, receivedChecks } from "./treasury";

// ───────────────────────────── Cobranzas ─────────────────────────────

export const collections = pgTable(
  "collections",
  {
    id: id(),
    clientId: ref()
      .notNull()
      .references(() => clients.id),
    collectionDate: date().notNull(),
    totalAmount: money().notNull(),
    /** Saldo a favor disponible (total − imputaciones activas). */
    unappliedAmount: money().notNull(),
    status: text().notNull().default("ACTIVE"),
    notes: text(),
    idempotencyKey: uuid().notNull().unique("ux_collections_idempotency_key"),
    annulledAt: tstz(),
    annulledBy: ref(),
    annulReason: text(),
    ...auditColumns(),
  },
  (t) => [
    index("ix_collections_client_date").on(t.clientId, t.collectionDate),
    check("ck_collections_total", sql`${t.totalAmount} > 0`),
    check("ck_collections_unapplied", sql`${t.unappliedAmount} >= 0 AND ${t.unappliedAmount} <= ${t.totalAmount}`),
    check("ck_collections_status", sql`${t.status} IN ('ACTIVE','ANNULLED')`),
    check(
      "ck_collections_annulment",
      sql`${t.status} <> 'ANNULLED' OR (${t.annulledAt} IS NOT NULL AND ${t.annulReason} IS NOT NULL AND ${t.unappliedAmount} = 0)`,
    ),
  ],
);

/** Medios de una cobranza: efectivo, transferencia, cheque o retención sufrida. */
export const collectionLines = pgTable(
  "collection_lines",
  {
    id: id(),
    collectionId: ref()
      .notNull()
      .references(() => collections.id),
    lineNo: integer().notNull(),
    method: text().notNull(),
    amount: money().notNull(),
    cashBoxId: ref().references(() => cashBoxes.id),
    bankAccountId: ref().references(() => bankAccounts.id),
    transferDate: date(),
    transferReference: text(),
    receivedCheckId: ref()
      .unique("ux_collection_lines_received_check")
      .references(() => receivedChecks.id),
    retentionTaxId: ref().references(() => taxCatalog.id),
    retentionCertificate: text(),
    retentionDate: date(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_collection_lines_no").on(t.collectionId, t.lineNo),
    check("ck_collection_lines_amount", sql`${t.amount} > 0`),
    check(
      "ck_collection_lines_method",
      sql`(${t.method} = 'CASH' AND ${t.cashBoxId} IS NOT NULL
            AND num_nonnulls(${t.bankAccountId}, ${t.receivedCheckId}, ${t.retentionTaxId}) = 0)
       OR (${t.method} = 'TRANSFER' AND ${t.bankAccountId} IS NOT NULL AND ${t.transferDate} IS NOT NULL
            AND num_nonnulls(${t.cashBoxId}, ${t.receivedCheckId}, ${t.retentionTaxId}) = 0)
       OR (${t.method} = 'CHECK' AND ${t.receivedCheckId} IS NOT NULL
            AND num_nonnulls(${t.cashBoxId}, ${t.bankAccountId}, ${t.retentionTaxId}) = 0)
       OR (${t.method} = 'RETENTION' AND ${t.retentionTaxId} IS NOT NULL AND ${t.retentionCertificate} IS NOT NULL
            AND ${t.retentionDate} IS NOT NULL
            AND num_nonnulls(${t.cashBoxId}, ${t.bankAccountId}, ${t.receivedCheckId}) = 0)`,
    ),
  ],
);

// ───────────────────────────── Pagos ─────────────────────────────

export const supplierPayments = pgTable(
  "supplier_payments",
  {
    id: id(),
    supplierId: ref()
      .notNull()
      .references(() => suppliers.id),
    paymentDate: date().notNull(),
    totalAmount: money().notNull(),
    unappliedAmount: money().notNull(),
    status: text().notNull().default("ACTIVE"),
    notes: text(),
    idempotencyKey: uuid().notNull().unique("ux_supplier_payments_idempotency_key"),
    annulledAt: tstz(),
    annulledBy: ref(),
    annulReason: text(),
    ...auditColumns(),
  },
  (t) => [
    index("ix_supplier_payments_supplier_date").on(t.supplierId, t.paymentDate),
    check("ck_supplier_payments_total", sql`${t.totalAmount} > 0`),
    check(
      "ck_supplier_payments_unapplied",
      sql`${t.unappliedAmount} >= 0 AND ${t.unappliedAmount} <= ${t.totalAmount}`,
    ),
    check("ck_supplier_payments_status", sql`${t.status} IN ('ACTIVE','ANNULLED')`),
    check(
      "ck_supplier_payments_annulment",
      sql`${t.status} <> 'ANNULLED' OR (${t.annulledAt} IS NOT NULL AND ${t.annulReason} IS NOT NULL AND ${t.unappliedAmount} = 0)`,
    ),
  ],
);

/** Medios de un pago: efectivo, transferencia, cheque propio, cheque de terceros (endoso) o retención practicada. */
export const paymentLines = pgTable(
  "payment_lines",
  {
    id: id(),
    paymentId: ref()
      .notNull()
      .references(() => supplierPayments.id),
    lineNo: integer().notNull(),
    method: text().notNull(),
    amount: money().notNull(),
    cashBoxId: ref().references(() => cashBoxes.id),
    bankAccountId: ref().references(() => bankAccounts.id),
    transferDate: date(),
    transferReference: text(),
    issuedCheckId: ref()
      .unique("ux_payment_lines_issued_check")
      .references(() => issuedChecks.id),
    receivedCheckId: ref().references(() => receivedChecks.id),
    retentionTaxId: ref().references(() => taxCatalog.id),
    retentionCertificate: text(),
    retentionDate: date(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_payment_lines_no").on(t.paymentId, t.lineNo),
    index("ix_payment_lines_received_check").on(t.receivedCheckId),
    check("ck_payment_lines_amount", sql`${t.amount} > 0`),
    check(
      "ck_payment_lines_method",
      sql`(${t.method} = 'CASH' AND ${t.cashBoxId} IS NOT NULL
            AND num_nonnulls(${t.bankAccountId}, ${t.issuedCheckId}, ${t.receivedCheckId}, ${t.retentionTaxId}) = 0)
       OR (${t.method} = 'TRANSFER' AND ${t.bankAccountId} IS NOT NULL AND ${t.transferDate} IS NOT NULL
            AND num_nonnulls(${t.cashBoxId}, ${t.issuedCheckId}, ${t.receivedCheckId}, ${t.retentionTaxId}) = 0)
       OR (${t.method} = 'OWN_CHECK' AND ${t.issuedCheckId} IS NOT NULL
            AND num_nonnulls(${t.cashBoxId}, ${t.bankAccountId}, ${t.receivedCheckId}, ${t.retentionTaxId}) = 0)
       OR (${t.method} = 'THIRD_PARTY_CHECK' AND ${t.receivedCheckId} IS NOT NULL
            AND num_nonnulls(${t.cashBoxId}, ${t.bankAccountId}, ${t.issuedCheckId}, ${t.retentionTaxId}) = 0)
       OR (${t.method} = 'RETENTION' AND ${t.retentionTaxId} IS NOT NULL AND ${t.retentionCertificate} IS NOT NULL
            AND ${t.retentionDate} IS NOT NULL
            AND num_nonnulls(${t.cashBoxId}, ${t.bankAccountId}, ${t.issuedCheckId}, ${t.receivedCheckId}) = 0)`,
    ),
  ],
);

// ───────────────────────────── Imputaciones ─────────────────────────────

/**
 * Servicio central de imputaciones: aplica un crédito (cobranza, pago o NC / saldo inicial acreedor)
 * contra un comprobante deudor. Las vistas collection_allocations y payment_allocations la filtran.
 */
export const allocations = pgTable(
  "allocations",
  {
    id: id(),
    ledger: text().notNull(),
    targetDocumentId: ref()
      .notNull()
      .references(() => documents.id),
    sourceKind: text().notNull(),
    sourceCollectionId: ref().references(() => collections.id),
    sourcePaymentId: ref().references(() => supplierPayments.id),
    sourceDocumentId: ref().references(() => documents.id),
    amount: money().notNull(),
    allocationDate: date().notNull(),
    status: text().notNull().default("ACTIVE"),
    reversedAt: tstz(),
    reversedBy: ref(),
    reversalReason: text(),
    createdAt: tstz().notNull().defaultNow(),
    createdBy: ref(),
  },
  (t) => [
    index("ix_allocations_target").on(t.targetDocumentId),
    index("ix_allocations_collection").on(t.sourceCollectionId),
    index("ix_allocations_payment").on(t.sourcePaymentId),
    index("ix_allocations_source_doc").on(t.sourceDocumentId),
    check("ck_allocations_ledger", sql`${t.ledger} IN ('AR','AP')`),
    check("ck_allocations_amount", sql`${t.amount} > 0`),
    check("ck_allocations_status", sql`${t.status} IN ('ACTIVE','REVERSED')`),
    check(
      "ck_allocations_source",
      sql`num_nonnulls(${t.sourceCollectionId}, ${t.sourcePaymentId}, ${t.sourceDocumentId}) = 1
      AND ((${t.sourceKind} = 'COLLECTION' AND ${t.sourceCollectionId} IS NOT NULL AND ${t.ledger} = 'AR')
        OR (${t.sourceKind} = 'PAYMENT' AND ${t.sourcePaymentId} IS NOT NULL AND ${t.ledger} = 'AP')
        OR (${t.sourceKind} = 'CREDIT_DOCUMENT' AND ${t.sourceDocumentId} IS NOT NULL))`,
    ),
    check("ck_allocations_self", sql`${t.sourceDocumentId} IS DISTINCT FROM ${t.targetDocumentId}`),
    check(
      "ck_allocations_reversal",
      sql`${t.status} = 'ACTIVE' OR (${t.reversedAt} IS NOT NULL AND ${t.reversalReason} IS NOT NULL)`,
    ),
  ],
);

// ───────────────────────────── Recibos y órdenes de pago internos ─────────────────────────────

/** Recibo interno de registración de cobranza (no es un comprobante fiscal). */
export const receipts = pgTable(
  "receipts",
  {
    id: id(),
    number: text().notNull().unique("ux_receipts_number"),
    collectionId: ref()
      .notNull()
      .unique("ux_receipts_collection")
      .references(() => collections.id),
    issueDate: date().notNull(),
    partyName: text().notNull(),
    partyTaxId: text(),
    amount: money().notNull(),
    amountInWords: text().notNull(),
    status: text().notNull().default("ACTIVE"),
    annulledAt: tstz(),
    annulledBy: ref(),
    ...auditColumns(),
  },
  (t) => [
    check("ck_receipts_amount", sql`${t.amount} > 0`),
    check("ck_receipts_status", sql`${t.status} IN ('ACTIVE','ANNULLED')`),
  ],
);

/** Orden de pago interna (no es un comprobante fiscal). */
export const paymentOrders = pgTable(
  "payment_orders",
  {
    id: id(),
    number: text().notNull().unique("ux_payment_orders_number"),
    paymentId: ref()
      .notNull()
      .unique("ux_payment_orders_payment")
      .references(() => supplierPayments.id),
    issueDate: date().notNull(),
    partyName: text().notNull(),
    partyTaxId: text(),
    amount: money().notNull(),
    amountInWords: text().notNull(),
    status: text().notNull().default("ACTIVE"),
    annulledAt: tstz(),
    annulledBy: ref(),
    ...auditColumns(),
  },
  (t) => [
    check("ck_payment_orders_amount", sql`${t.amount} > 0`),
    check("ck_payment_orders_status", sql`${t.status} IN ('ACTIVE','ANNULLED')`),
  ],
);

// ───────────────────────────── Devoluciones de saldo a favor (D14) ─────────────────────────────

/**
 * Devolución en dinero de un saldo a favor. Se registra con un débito interno en la cuenta
 * corriente (document_id) contra el que se imputa el crédito, más el movimiento de tesorería.
 * AR: la empresa devuelve dinero al cliente (OUT). AP: el proveedor reintegra un anticipo (IN).
 */
export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    ledger: text().notNull(),
    clientId: ref().references(() => clients.id),
    supplierId: ref().references(() => suppliers.id),
    refundDate: date().notNull(),
    amount: money().notNull(),
    method: text().notNull(),
    cashBoxId: ref().references(() => cashBoxes.id),
    bankAccountId: ref().references(() => bankAccounts.id),
    reference: text(),
    documentId: ref()
      .notNull()
      .unique("ux_refunds_document")
      .references(() => documents.id),
    status: text().notNull().default("ACTIVE"),
    idempotencyKey: uuid().notNull().unique("ux_refunds_idempotency_key"),
    annulledAt: tstz(),
    annulledBy: ref(),
    annulReason: text(),
    ...auditColumns(),
  },
  (t) => [
    check("ck_refunds_amount", sql`${t.amount} > 0`),
    check(
      "ck_refunds_party",
      sql`(${t.ledger} = 'AR' AND ${t.clientId} IS NOT NULL AND ${t.supplierId} IS NULL)
       OR (${t.ledger} = 'AP' AND ${t.supplierId} IS NOT NULL AND ${t.clientId} IS NULL)`,
    ),
    check(
      "ck_refunds_method",
      sql`(${t.method} = 'CASH' AND ${t.cashBoxId} IS NOT NULL AND ${t.bankAccountId} IS NULL)
       OR (${t.method} = 'TRANSFER' AND ${t.bankAccountId} IS NOT NULL AND ${t.cashBoxId} IS NULL)`,
    ),
    check("ck_refunds_status", sql`${t.status} IN ('ACTIVE','ANNULLED')`),
  ],
);

// ───────────────────────────── Cuentas corrientes ─────────────────────────────

/**
 * Libros de cuenta corriente (append-only). Débito = aumenta la deuda; Crédito = la disminuye.
 * El saldo no se guarda: es Σ débitos − Σ créditos.
 */
export const customerAccountEntries = pgTable(
  "customer_account_entries",
  {
    id: id(),
    clientId: ref()
      .notNull()
      .references(() => clients.id),
    entryDate: date().notNull(),
    entryType: text().notNull(),
    documentId: ref().references(() => documents.id),
    collectionId: ref().references(() => collections.id),
    debit: money().notNull().default("0"),
    credit: money().notNull().default("0"),
    description: text().notNull(),
    reversalOfId: ref()
      .unique("ux_customer_entries_reversal")
      .references((): AnyPgColumn => customerAccountEntries.id),
    createdAt: tstz().notNull().defaultNow(),
    createdBy: ref(),
  },
  (t) => [
    index("ix_customer_entries_client").on(t.clientId, t.entryDate, t.id),
    uniqueIndex("ux_customer_entries_document")
      .on(t.documentId, t.entryType)
      .where(sql`${t.documentId} IS NOT NULL`),
    uniqueIndex("ux_customer_entries_collection")
      .on(t.collectionId, t.entryType)
      .where(sql`${t.collectionId} IS NOT NULL`),
    check("ck_customer_entries_type", sql`${t.entryType} IN ('DOCUMENT','COLLECTION','REVERSAL')`),
    check(
      "ck_customer_entries_amounts",
      sql`${t.debit} >= 0 AND ${t.credit} >= 0 AND ((${t.debit} > 0) <> (${t.credit} > 0))`,
    ),
    check(
      "ck_customer_entries_source",
      sql`num_nonnulls(${t.documentId}, ${t.collectionId}) = 1
      AND (${t.entryType} <> 'DOCUMENT' OR ${t.documentId} IS NOT NULL)
      AND (${t.entryType} <> 'COLLECTION' OR ${t.collectionId} IS NOT NULL)
      AND ((${t.entryType} = 'REVERSAL') = (${t.reversalOfId} IS NOT NULL))`,
    ),
  ],
);

export const supplierAccountEntries = pgTable(
  "supplier_account_entries",
  {
    id: id(),
    supplierId: ref()
      .notNull()
      .references(() => suppliers.id),
    entryDate: date().notNull(),
    entryType: text().notNull(),
    documentId: ref().references(() => documents.id),
    paymentId: ref().references(() => supplierPayments.id),
    debit: money().notNull().default("0"),
    credit: money().notNull().default("0"),
    description: text().notNull(),
    reversalOfId: ref()
      .unique("ux_supplier_entries_reversal")
      .references((): AnyPgColumn => supplierAccountEntries.id),
    createdAt: tstz().notNull().defaultNow(),
    createdBy: ref(),
  },
  (t) => [
    index("ix_supplier_entries_supplier").on(t.supplierId, t.entryDate, t.id),
    uniqueIndex("ux_supplier_entries_document")
      .on(t.documentId, t.entryType)
      .where(sql`${t.documentId} IS NOT NULL`),
    uniqueIndex("ux_supplier_entries_payment")
      .on(t.paymentId, t.entryType)
      .where(sql`${t.paymentId} IS NOT NULL`),
    check("ck_supplier_entries_type", sql`${t.entryType} IN ('DOCUMENT','PAYMENT','REVERSAL')`),
    check(
      "ck_supplier_entries_amounts",
      sql`${t.debit} >= 0 AND ${t.credit} >= 0 AND ((${t.debit} > 0) <> (${t.credit} > 0))`,
    ),
    check(
      "ck_supplier_entries_source",
      sql`num_nonnulls(${t.documentId}, ${t.paymentId}) = 1
      AND (${t.entryType} <> 'DOCUMENT' OR ${t.documentId} IS NOT NULL)
      AND (${t.entryType} <> 'PAYMENT' OR ${t.paymentId} IS NOT NULL)
      AND ((${t.entryType} = 'REVERSAL') = (${t.reversalOfId} IS NOT NULL))`,
    ),
  ],
);
