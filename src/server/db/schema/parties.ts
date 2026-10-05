import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { auditColumns, id, money, ref, tstz, version } from "./_common";
import { banks, idTypes, paymentTerms, provinces, vatConditions } from "./config";

/** Columnas comunes a clientes y proveedores. */
const partyColumns = () => ({
  id: id(),
  code: text().notNull().unique(),
  legalName: text().notNull(),
  idTypeId: ref()
    .notNull()
    .references(() => idTypes.id),
  /** CUIT/CUIL (11 dígitos), DNI u otro identificador según id_type. */
  taxId: text(),
  vatConditionId: ref()
    .notNull()
    .references(() => vatConditions.id),
  address: text(),
  city: text(),
  provinceId: ref().references(() => provinces.id),
  postalCode: text(),
  phone: text(),
  email: text(),
  contactName: text(),
  paymentTermId: ref().references(() => paymentTerms.id),
  creditDays: integer().notNull().default(0),
  /** NULL = sin límite. */
  creditLimit: money(),
  status: text().notNull().default("ACTIVE"),
  /** Motivo explícito que habilita un segundo registro con el mismo CUIT. */
  duplicateTaxIdReason: text(),
  notes: text(),
  deactivatedAt: tstz(),
  deactivatedBy: ref(),
  deactivationReason: text(),
  version: version(),
  ...auditColumns(),
});

export const clients = pgTable(
  "clients",
  { ...partyColumns() },
  (t) => [
    uniqueIndex("ux_clients_tax_id")
      .on(t.taxId)
      .where(sql`${t.taxId} IS NOT NULL AND ${t.duplicateTaxIdReason} IS NULL`),
    index("ix_clients_name").on(sql`lower(${t.legalName})`),
    check("ck_clients_status", sql`${t.status} IN ('ACTIVE','INACTIVE')`),
    check("ck_clients_credit_days", sql`${t.creditDays} >= 0`),
    check("ck_clients_credit_limit", sql`${t.creditLimit} IS NULL OR ${t.creditLimit} >= 0`),
    check("ck_clients_tax_id_format", sql`${t.taxId} IS NULL OR ${t.taxId} ~ '^[0-9A-Za-z-]{1,20}$'`),
    check(
      "ck_clients_deactivation",
      sql`${t.status} = 'ACTIVE' OR (${t.deactivatedAt} IS NOT NULL AND ${t.deactivationReason} IS NOT NULL)`,
    ),
    check("ck_clients_email", sql`${t.email} IS NULL OR ${t.email} ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'`),
  ],
);

export const suppliers = pgTable(
  "suppliers",
  {
    ...partyColumns(),
    activity: text(),
    bankId: ref().references(() => banks.id),
    cbu: text(),
    cbuAlias: text(),
  },
  (t) => [
    uniqueIndex("ux_suppliers_tax_id")
      .on(t.taxId)
      .where(sql`${t.taxId} IS NOT NULL AND ${t.duplicateTaxIdReason} IS NULL`),
    index("ix_suppliers_name").on(sql`lower(${t.legalName})`),
    check("ck_suppliers_status", sql`${t.status} IN ('ACTIVE','INACTIVE')`),
    check("ck_suppliers_credit_days", sql`${t.creditDays} >= 0`),
    check("ck_suppliers_credit_limit", sql`${t.creditLimit} IS NULL OR ${t.creditLimit} >= 0`),
    check("ck_suppliers_tax_id_format", sql`${t.taxId} IS NULL OR ${t.taxId} ~ '^[0-9A-Za-z-]{1,20}$'`),
    check(
      "ck_suppliers_deactivation",
      sql`${t.status} = 'ACTIVE' OR (${t.deactivatedAt} IS NOT NULL AND ${t.deactivationReason} IS NOT NULL)`,
    ),
    check("ck_suppliers_email", sql`${t.email} IS NULL OR ${t.email} ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'`),
    check("ck_suppliers_cbu", sql`${t.cbu} IS NULL OR ${t.cbu} ~ '^[0-9]{22}$'`),
    check("ck_suppliers_alias", sql`${t.cbuAlias} IS NULL OR ${t.cbuAlias} ~ '^[A-Za-z0-9.-]{6,20}$'`),
  ],
);
