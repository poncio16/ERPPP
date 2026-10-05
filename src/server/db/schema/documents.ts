import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns, fxRate, id, money, rate, ref, tstz, version } from "./_common";
import { documentTypes, expenseCategories, provinces, taxCatalog, vatConditions } from "./config";
import { clients, suppliers } from "./parties";

export const DOCUMENT_STATUSES = ["OPEN", "PARTIAL", "SETTLED", "ANNULLED"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export type Direction = "ISSUED" | "RECEIVED";

/**
 * Comprobantes registrados (emitidos y recibidos). El ERP no emite comprobantes fiscales:
 * registra comprobantes ya emitidos por sistemas externos o recibidos de proveedores.
 */
export const documents = pgTable(
  "documents",
  {
    id: id(),
    direction: text().$type<Direction>().notNull(),
    documentTypeId: ref()
      .notNull()
      .references(() => documentTypes.id),
    pointOfSale: integer().notNull(),
    number: bigint({ mode: "number" }).notNull(),
    clientId: ref().references(() => clients.id),
    supplierId: ref().references(() => suppliers.id),
    partyName: text().notNull(),
    partyTaxId: text(),
    partyVatConditionId: ref()
      .notNull()
      .references(() => vatConditions.id),
    issueDate: date().notNull(),
    dueDate: date().notNull(),
    vatPeriod: date().notNull(),
    concept: text(),
    description: text(),
    currency: char({ length: 3 }).notNull().default("ARS"),
    exchangeRate: fxRate().notNull().default("1"),
    netTaxed: money().notNull().default("0"),
    netUntaxed: money().notNull().default("0"),
    netExempt: money().notNull().default("0"),
    vatTotal: money().notNull().default("0"),
    perceptionsTotal: money().notNull().default("0"),
    otherTaxesTotal: money().notNull().default("0"),
    discountTotal: money().notNull().default("0"),
    total: money().notNull(),
    /** Saldo pendiente (débitos) o crédito disponible (NC). Caché verificada de total − imputaciones. */
    balance: money().notNull(),
    status: text().$type<DocumentStatus>().notNull().default("OPEN"),
    annulledAt: tstz(),
    annulledBy: ref(),
    annulReason: text(),
    /** Motivo de NC / ND / débito interno. */
    reason: text(),
    origin: text().notNull().default("MANUAL"),
    externalRef: text(),
    idempotencyKey: uuid().unique("ux_documents_idempotency_key"),
    version: version(),
    ...auditColumns(),
  },
  (t) => [
    // Control de duplicados (secciones 5, 17 y 18). Los registros anulados no cuentan.
    uniqueIndex("ux_documents_issued")
      .on(t.documentTypeId, t.pointOfSale, t.number)
      .where(sql`${t.direction} = 'ISSUED' AND ${t.status} <> 'ANNULLED'`),
    uniqueIndex("ux_documents_received")
      .on(t.supplierId, t.documentTypeId, t.pointOfSale, t.number)
      .where(sql`${t.direction} = 'RECEIVED' AND ${t.status} <> 'ANNULLED'`),
    index("ix_documents_client_date").on(t.clientId, t.issueDate),
    index("ix_documents_supplier_date").on(t.supplierId, t.issueDate),
    index("ix_documents_open_due")
      .on(t.direction, t.dueDate)
      .where(sql`${t.balance} > 0 AND ${t.status} <> 'ANNULLED'`),
    index("ix_documents_vat_period").on(t.direction, t.vatPeriod),
    check("ck_documents_direction", sql`${t.direction} IN ('ISSUED','RECEIVED')`),
    check(
      "ck_documents_party",
      sql`(${t.direction} = 'ISSUED' AND ${t.clientId} IS NOT NULL AND ${t.supplierId} IS NULL)
       OR (${t.direction} = 'RECEIVED' AND ${t.supplierId} IS NOT NULL AND ${t.clientId} IS NULL)`,
    ),
    check("ck_documents_pos", sql`${t.pointOfSale} BETWEEN 0 AND 99999`),
    check("ck_documents_number", sql`${t.number} BETWEEN 1 AND 99999999`),
    check("ck_documents_due", sql`${t.dueDate} >= ${t.issueDate}`),
    check("ck_documents_vat_period", sql`${t.vatPeriod} = date_trunc('month', ${t.vatPeriod})::date`),
    check("ck_documents_concept", sql`${t.concept} IS NULL OR ${t.concept} IN ('PRODUCTS','SERVICES','BOTH')`),
    check("ck_documents_fx", sql`${t.exchangeRate} > 0 AND (${t.currency} <> 'ARS' OR ${t.exchangeRate} = 1)`),
    check(
      "ck_documents_components",
      sql`${t.netTaxed} >= 0 AND ${t.netUntaxed} >= 0 AND ${t.netExempt} >= 0 AND ${t.vatTotal} >= 0
      AND ${t.perceptionsTotal} >= 0 AND ${t.otherTaxesTotal} >= 0 AND ${t.discountTotal} >= 0`,
    ),
    check(
      "ck_documents_total_formula",
      sql`${t.total} = ${t.netTaxed} + ${t.netUntaxed} + ${t.netExempt} + ${t.vatTotal}
        + ${t.perceptionsTotal} + ${t.otherTaxesTotal} - ${t.discountTotal}`,
    ),
    check("ck_documents_total_positive", sql`${t.total} > 0`),
    check("ck_documents_balance", sql`${t.balance} >= 0 AND ${t.balance} <= ${t.total}`),
    check("ck_documents_status", sql`${t.status} IN ('OPEN','PARTIAL','SETTLED','ANNULLED')`),
    check(
      "ck_documents_status_balance",
      sql`(${t.status} = 'OPEN' AND ${t.balance} = ${t.total})
       OR (${t.status} = 'PARTIAL' AND ${t.balance} > 0 AND ${t.balance} < ${t.total})
       OR (${t.status} = 'SETTLED' AND ${t.balance} = 0)
       OR (${t.status} = 'ANNULLED' AND ${t.balance} = 0)`,
    ),
    check(
      "ck_documents_annulment",
      sql`${t.status} <> 'ANNULLED' OR (${t.annulledAt} IS NOT NULL AND ${t.annulReason} IS NOT NULL)`,
    ),
    check("ck_documents_origin", sql`${t.origin} IN ('MANUAL','IMPORT')`),
  ],
);

/** Detalle tributario por línea: IVA por alícuota, percepciones y otros impuestos (document_taxes). */
export const documentTaxLines = pgTable(
  "document_tax_lines",
  {
    id: id(),
    documentId: ref()
      .notNull()
      .references(() => documents.id),
    taxId: ref()
      .notNull()
      .references(() => taxCatalog.id),
    kind: text().notNull(),
    baseAmount: money(),
    rate: rate(),
    amount: money().notNull(),
    jurisdictionId: ref().references(() => provinces.id),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_document_tax_lines").on(
      t.documentId,
      t.taxId,
      sql`coalesce(${t.jurisdictionId}, 0)`,
    ),
    check("ck_document_tax_lines_kind", sql`${t.kind} IN ('VAT','PERCEPTION','OTHER_TAX')`),
    check(
      "ck_document_tax_lines_vat",
      sql`${t.kind} <> 'VAT' OR (${t.baseAmount} IS NOT NULL AND ${t.rate} IS NOT NULL)`,
    ),
    check("ck_document_tax_lines_amounts", sql`${t.amount} >= 0 AND (${t.baseAmount} IS NULL OR ${t.baseAmount} >= 0)`),
  ],
);

/** Líneas descriptivas opcionales para clasificar el comprobante. */
export const documentItems = pgTable(
  "document_items",
  {
    id: id(),
    documentId: ref()
      .notNull()
      .references(() => documents.id),
    lineNo: integer().notNull(),
    description: text().notNull(),
    expenseCategoryId: ref().references(() => expenseCategories.id),
    amount: money().notNull(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_document_items_line").on(t.documentId, t.lineNo),
    check("ck_document_items_amount", sql`${t.amount} >= 0`),
  ],
);

/** Vínculo de NC / ND / débito interno con su comprobante original. */
export const documentRelations = pgTable(
  "document_relations",
  {
    id: id(),
    documentId: ref()
      .notNull()
      .references(() => documents.id),
    relatedDocumentId: ref()
      .notNull()
      .references(() => documents.id),
    relationType: text().notNull(),
    createdAt: tstz().notNull().defaultNow(),
    createdBy: ref(),
  },
  (t) => [
    uniqueIndex("ux_document_relations").on(t.documentId, t.relatedDocumentId),
    index("ix_document_relations_related").on(t.relatedDocumentId),
    check("ck_document_relations_self", sql`${t.documentId} <> ${t.relatedDocumentId}`),
    check(
      "ck_document_relations_type",
      sql`${t.relationType} IN ('CREDIT_NOTE_OF','DEBIT_NOTE_OF','REJECTED_CHECK_DEBIT','REFUND_OF')`,
    ),
  ],
);
