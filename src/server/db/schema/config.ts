import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { auditColumns, id, rate, ref, tstz } from "./_common";

/** Datos de la empresa: fila única (id = 1). */
export const company = pgTable(
  "company",
  {
    id: integer().primaryKey().default(1),
    legalName: text().notNull(),
    tradeName: text(),
    taxId: char({ length: 11 }).notNull(),
    vatConditionId: ref()
      .notNull()
      .references(() => vatConditions.id),
    address: text(),
    city: text(),
    provinceId: ref().references(() => provinces.id),
    postalCode: text(),
    grossIncomeNumber: text(),
    activityStartDate: date(),
    phone: text(),
    email: text(),
    logoPath: text(),
    ...auditColumns(),
  },
  (t) => [
    check("ck_company_single_row", sql`${t.id} = 1`),
    check("ck_company_tax_id", sql`${t.taxId} ~ '^[0-9]{11}$'`),
  ],
);

/** Parámetros configurables (clave → valor JSON). */
export const configuration = pgTable("configuration", {
  key: text().primaryKey(),
  value: jsonb(),
  description: text().notNull(),
  updatedAt: tstz().notNull().defaultNow(),
  updatedBy: ref(),
});

const catalogColumns = () => ({
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  active: boolean().notNull().default(true),
  sortOrder: integer().notNull().default(0),
});

/** Condiciones frente al IVA (con código ARCA de referencia). */
export const vatConditions = pgTable("vat_conditions", {
  ...catalogColumns(),
  arcaCode: integer(),
});

/** Tipos de identificación (CUIT, CUIL, DNI, ...). */
export const idTypes = pgTable("id_types", {
  ...catalogColumns(),
  arcaCode: integer(),
  /** true si el número debe ser una CUIT/CUIL válida de 11 dígitos. */
  requiresCuit: boolean().notNull().default(false),
});

export const provinces = pgTable("provinces", {
  ...catalogColumns(),
  arcaCode: integer(),
  /** Código de jurisdicción IIBB (Convenio Multilateral). */
  grossIncomeJurisdiction: integer(),
});

export const paymentTerms = pgTable(
  "payment_terms",
  {
    ...catalogColumns(),
    days: integer().notNull().default(0),
  },
  (t) => [check("ck_payment_terms_days", sql`${t.days} >= 0`)],
);

export const DOCUMENT_CLASSES = [
  "INVOICE",
  "DEBIT_NOTE",
  "CREDIT_NOTE",
  "INTERNAL_DEBIT",
  "OPENING_DEBIT",
  "OPENING_CREDIT",
] as const;
export type DocumentClass = (typeof DOCUMENT_CLASSES)[number];

/** Tipos de comprobante (fiscales con código ARCA e internos no fiscales). */
export const documentTypes = pgTable(
  "document_types",
  {
    ...catalogColumns(),
    arcaCode: integer(),
    letter: text(),
    class: text().$type<DocumentClass>().notNull(),
    isFce: boolean().notNull().default(false),
    isFiscal: boolean().notNull().default(true),
    allowedIssued: boolean().notNull().default(false),
    allowedReceived: boolean().notNull().default(false),
    /** false para B y C recibidas: IVA no discriminado, no computa crédito fiscal. */
    vatCreditable: boolean().notNull().default(true),
  },
  (t) => [
    uniqueIndex("ux_document_types_arca").on(t.arcaCode).where(sql`${t.arcaCode} IS NOT NULL`),
    check(
      "ck_document_types_class",
      sql`${t.class} IN ('INVOICE','DEBIT_NOTE','CREDIT_NOTE','INTERNAL_DEBIT','OPENING_DEBIT','OPENING_CREDIT')`,
    ),
    check("ck_document_types_letter", sql`${t.letter} IS NULL OR ${t.letter} IN ('A','B','C','E','M')`),
    check("ck_document_types_fiscal_code", sql`NOT ${t.isFiscal} OR ${t.arcaCode} IS NOT NULL`),
  ],
);

export const TAX_KINDS = ["VAT", "PERCEPTION", "RETENTION", "OTHER_TAX"] as const;
export type TaxKind = (typeof TAX_KINDS)[number];

/** Catálogo de impuestos: alícuotas de IVA, percepciones, retenciones y otros, con vigencia. */
export const taxCatalog = pgTable(
  "tax_catalog",
  {
    ...catalogColumns(),
    kind: text().$type<TaxKind>().notNull(),
    rate: rate(),
    /** Código ARCA de alícuota de IVA (3=0%, 4=10,5%, 5=21%, 6=27%, 8=5%, 9=2,5%). */
    arcaCode: integer(),
    jurisdictionId: ref().references(() => provinces.id),
    validFrom: date().notNull().default("2000-01-01"),
    validTo: date(),
  },
  (t) => [
    check("ck_tax_catalog_kind", sql`${t.kind} IN ('VAT','PERCEPTION','RETENTION','OTHER_TAX')`),
    check("ck_tax_catalog_vat_rate", sql`${t.kind} <> 'VAT' OR ${t.rate} IS NOT NULL`),
    check("ck_tax_catalog_rate_range", sql`${t.rate} IS NULL OR (${t.rate} >= 0 AND ${t.rate} <= 100)`),
    check("ck_tax_catalog_validity", sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`),
  ],
);

/** Conceptos de movimientos de tesorería. */
export const treasuryConcepts = pgTable(
  "treasury_concepts",
  {
    ...catalogColumns(),
    direction: text().notNull(),
    allowsManual: boolean().notNull().default(false),
  },
  (t) => [check("ck_treasury_concepts_direction", sql`${t.direction} IN ('IN','OUT','BOTH')`)],
);

/** Entidades bancarias. */
export const banks = pgTable("banks", {
  ...catalogColumns(),
});

/** Rubros para clasificar comprobantes recibidos. */
export const expenseCategories = pgTable("expense_categories", {
  ...catalogColumns(),
});

/** Secuencias de numeración interna (recibos, órdenes de pago, códigos). */
export const numberingSequences = pgTable(
  "numbering_sequences",
  {
    key: text().primaryKey(),
    prefix: text().notNull().default(""),
    nextValue: bigint({ mode: "number" }).notNull().default(1),
    padding: integer().notNull().default(8),
    ...auditColumns(),
  },
  (t) => [
    check("ck_numbering_next", sql`${t.nextValue} > 0`),
    check("ck_numbering_padding", sql`${t.padding} BETWEEN 1 AND 12`),
  ],
);
