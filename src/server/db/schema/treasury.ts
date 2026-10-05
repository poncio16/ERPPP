import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { auditColumns, id, money, ref, tstz, version } from "./_common";
import { banks, treasuryConcepts } from "./config";
import { clients, suppliers } from "./parties";

export const cashBoxes = pgTable("cash_boxes", {
  id: id(),
  name: text().notNull().unique("ux_cash_boxes_name"),
  currency: char({ length: 3 }).notNull().default("ARS"),
  active: boolean().notNull().default(true),
  ...auditColumns(),
});

/** Cuentas bancarias propias de la empresa. */
export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: id(),
    bankId: ref()
      .notNull()
      .references(() => banks.id),
    accountType: text().notNull(),
    accountNumber: text().notNull(),
    cbu: text(),
    alias: text(),
    currency: char({ length: 3 }).notNull().default("ARS"),
    displayName: text().notNull().unique("ux_bank_accounts_display_name"),
    active: boolean().notNull().default(true),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex("ux_bank_accounts_cbu").on(t.cbu).where(sql`${t.cbu} IS NOT NULL`),
    uniqueIndex("ux_bank_accounts_number").on(t.bankId, t.accountNumber),
    check("ck_bank_accounts_type", sql`${t.accountType} IN ('CC','CA')`),
    check("ck_bank_accounts_cbu", sql`${t.cbu} IS NULL OR ${t.cbu} ~ '^[0-9]{22}$'`),
  ],
);

export const RECEIVED_CHECK_STATUSES = [
  "IN_PORTFOLIO",
  "DEPOSITED",
  "CREDITED",
  "REJECTED",
  "ENDORSED",
  "ANNULLED",
] as const;

/** Cheques recibidos (físicos o ECHEQ). Al recibirse quedan en cartera, sin impacto bancario. */
export const receivedChecks = pgTable(
  "received_checks",
  {
    id: id(),
    format: text().notNull(),
    checkType: text().notNull(),
    issuerBankId: ref()
      .notNull()
      .references(() => banks.id),
    number: text().notNull(),
    drawerTaxId: text().notNull(),
    drawerName: text().notNull(),
    clientId: ref().references(() => clients.id),
    issueDate: date().notNull(),
    paymentDate: date().notNull(),
    amount: money().notNull(),
    status: text().notNull().default("IN_PORTFOLIO"),
    depositBankAccountId: ref().references(() => bankAccounts.id),
    depositedAt: date(),
    creditedAt: date(),
    rejectedAt: date(),
    rejectionReason: text(),
    notes: text(),
    version: version(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex("ux_received_checks")
      .on(t.issuerBankId, t.number, t.drawerTaxId)
      .where(sql`${t.status} <> 'ANNULLED'`),
    index("ix_received_checks_status_date").on(t.status, t.paymentDate),
    check("ck_received_checks_format", sql`${t.format} IN ('PHYSICAL','ECHEQ')`),
    check("ck_received_checks_type", sql`${t.checkType} IN ('COMMON','DEFERRED')`),
    check("ck_received_checks_amount", sql`${t.amount} > 0`),
    check("ck_received_checks_dates", sql`${t.paymentDate} >= ${t.issueDate}`),
    check(
      "ck_received_checks_status",
      sql`${t.status} IN ('IN_PORTFOLIO','DEPOSITED','CREDITED','REJECTED','ENDORSED','ANNULLED')`,
    ),
    check(
      "ck_received_checks_deposit",
      sql`${t.status} <> 'DEPOSITED' OR (${t.depositBankAccountId} IS NOT NULL AND ${t.depositedAt} IS NOT NULL)`,
    ),
    check("ck_received_checks_rejected", sql`${t.status} <> 'REJECTED' OR ${t.rejectedAt} IS NOT NULL`),
  ],
);

/** Cheques propios emitidos. El débito bancario se registra recién al debitarse. */
export const issuedChecks = pgTable(
  "issued_checks",
  {
    id: id(),
    bankAccountId: ref()
      .notNull()
      .references(() => bankAccounts.id),
    format: text().notNull(),
    checkType: text().notNull(),
    number: text().notNull(),
    amount: money().notNull(),
    issueDate: date().notNull(),
    paymentDate: date().notNull(),
    supplierId: ref().references(() => suppliers.id),
    status: text().notNull().default("ISSUED"),
    debitedAt: date(),
    rejectedAt: date(),
    notes: text(),
    version: version(),
    ...auditColumns(),
  },
  (t) => [
    // Un número de cheque nunca se reutiliza en la misma cuenta, aunque esté anulado.
    uniqueIndex("ux_issued_checks_number").on(t.bankAccountId, t.number),
    index("ix_issued_checks_status_date").on(t.status, t.paymentDate),
    check("ck_issued_checks_format", sql`${t.format} IN ('PHYSICAL','ECHEQ')`),
    check("ck_issued_checks_type", sql`${t.checkType} IN ('COMMON','DEFERRED')`),
    check("ck_issued_checks_amount", sql`${t.amount} > 0`),
    check("ck_issued_checks_dates", sql`${t.paymentDate} >= ${t.issueDate}`),
    check(
      "ck_issued_checks_status",
      sql`${t.status} IN ('ISSUED','DELIVERED','PRESENTED','DEBITED','REJECTED','ANNULLED')`,
    ),
    check("ck_issued_checks_debited", sql`${t.status} <> 'DEBITED' OR ${t.debitedAt} IS NOT NULL`),
  ],
);

/** Historial append-only de cambios de estado de cheques. */
export const checkEvents = pgTable(
  "check_events",
  {
    id: id(),
    checkKind: text().notNull(),
    receivedCheckId: ref().references(() => receivedChecks.id),
    issuedCheckId: ref().references(() => issuedChecks.id),
    fromStatus: text(),
    toStatus: text().notNull(),
    eventDate: date().notNull(),
    notes: text(),
    createdAt: tstz().notNull().defaultNow(),
    createdBy: ref(),
  },
  (t) => [
    index("ix_check_events_received").on(t.receivedCheckId),
    index("ix_check_events_issued").on(t.issuedCheckId),
    check(
      "ck_check_events_kind",
      sql`(${t.checkKind} = 'RECEIVED' AND ${t.receivedCheckId} IS NOT NULL AND ${t.issuedCheckId} IS NULL)
       OR (${t.checkKind} = 'ISSUED' AND ${t.issuedCheckId} IS NOT NULL AND ${t.receivedCheckId} IS NULL)`,
    ),
  ],
);

/** Transferencias entre cuentas propias (incluye depósito de efectivo y extracción). */
export const accountTransfers = pgTable(
  "account_transfers",
  {
    id: id(),
    transferDate: date().notNull(),
    fromCashBoxId: ref().references(() => cashBoxes.id),
    fromBankAccountId: ref().references(() => bankAccounts.id),
    toCashBoxId: ref().references(() => cashBoxes.id),
    toBankAccountId: ref().references(() => bankAccounts.id),
    amount: money().notNull(),
    description: text(),
    status: text().notNull().default("ACTIVE"),
    annulledAt: tstz(),
    annulledBy: ref(),
    annulReason: text(),
    idempotencyKey: uuid().unique("ux_account_transfers_idempotency_key"),
    ...auditColumns(),
  },
  (t) => [
    check("ck_account_transfers_amount", sql`${t.amount} > 0`),
    check(
      "ck_account_transfers_from",
      sql`num_nonnulls(${t.fromCashBoxId}, ${t.fromBankAccountId}) = 1`,
    ),
    check("ck_account_transfers_to", sql`num_nonnulls(${t.toCashBoxId}, ${t.toBankAccountId}) = 1`),
    check(
      "ck_account_transfers_distinct",
      sql`${t.fromCashBoxId} IS DISTINCT FROM ${t.toCashBoxId} OR ${t.fromBankAccountId} IS DISTINCT FROM ${t.toBankAccountId}`,
    ),
    check("ck_account_transfers_status", sql`${t.status} IN ('ACTIVE','ANNULLED')`),
  ],
);

/** Arqueos y cierres de caja. */
export const cashClosures = pgTable(
  "cash_closures",
  {
    id: id(),
    cashBoxId: ref()
      .notNull()
      .references(() => cashBoxes.id),
    closureDate: date().notNull(),
    systemBalance: money().notNull(),
    countedAmount: money().notNull(),
    countDetail: jsonb(),
    difference: money().notNull(),
    notes: text(),
    createdAt: tstz().notNull().defaultNow(),
    createdBy: ref(),
  },
  (t) => [
    uniqueIndex("ux_cash_closures").on(t.cashBoxId, t.closureDate),
    check("ck_cash_closures_diff", sql`${t.difference} = ${t.countedAmount} - ${t.systemBalance}`),
    check("ck_cash_closures_counted", sql`${t.countedAmount} >= 0`),
  ],
);

export const TREASURY_ORIGINS = [
  "OPENING",
  "COLLECTION_LINE",
  "PAYMENT_LINE",
  "CHECK_EVENT",
  "ACCOUNT_TRANSFER",
  "REFUND",
  "MANUAL",
  "CASH_COUNT_DIFF",
  "REVERSAL",
] as const;
export type TreasuryOrigin = (typeof TREASURY_ORIGINS)[number];

/**
 * Libro único de tesorería (caja y bancos). Append-only: no se edita ni se borra;
 * las correcciones son reversiones. Las vistas cash_movements y bank_movements lo filtran.
 * Cada origen tiene su FK explícita y un índice único: una línea de cobranza, de pago,
 * un evento de cheque, etc. no pueden generar dos movimientos.
 */
export const treasuryMovements = pgTable(
  "treasury_movements",
  {
    id: id(),
    accountKind: text().notNull(),
    cashBoxId: ref().references(() => cashBoxes.id),
    bankAccountId: ref().references(() => bankAccounts.id),
    movementDate: date().notNull(),
    valueDate: date(),
    direction: text().notNull(),
    amount: money().notNull(),
    conceptId: ref().references(() => treasuryConcepts.id),
    description: text().notNull(),
    reference: text(),
    originType: text().$type<TreasuryOrigin>().notNull(),
    collectionLineId: ref(),
    paymentLineId: ref(),
    checkEventId: ref().references(() => checkEvents.id),
    accountTransferId: ref().references(() => accountTransfers.id),
    refundId: ref(),
    cashClosureId: ref().references(() => cashClosures.id),
    reversalOfId: ref().references((): AnyPgColumn => treasuryMovements.id),
    idempotencyKey: uuid().unique("ux_treasury_movements_idempotency_key"),
    createdAt: tstz().notNull().defaultNow(),
    createdBy: ref(),
  },
  (t) => [
    index("ix_treasury_cash").on(t.cashBoxId, t.movementDate, t.id),
    index("ix_treasury_bank").on(t.bankAccountId, t.movementDate, t.id),
    uniqueIndex("ux_treasury_collection_line").on(t.collectionLineId).where(sql`${t.collectionLineId} IS NOT NULL`),
    uniqueIndex("ux_treasury_payment_line").on(t.paymentLineId).where(sql`${t.paymentLineId} IS NOT NULL`),
    uniqueIndex("ux_treasury_check_event").on(t.checkEventId).where(sql`${t.checkEventId} IS NOT NULL`),
    uniqueIndex("ux_treasury_transfer")
      .on(t.accountTransferId, t.direction)
      .where(sql`${t.accountTransferId} IS NOT NULL`),
    uniqueIndex("ux_treasury_refund").on(t.refundId).where(sql`${t.refundId} IS NOT NULL`),
    uniqueIndex("ux_treasury_cash_closure").on(t.cashClosureId).where(sql`${t.cashClosureId} IS NOT NULL`),
    uniqueIndex("ux_treasury_reversal").on(t.reversalOfId).where(sql`${t.reversalOfId} IS NOT NULL`),
    uniqueIndex("ux_treasury_opening_cash")
      .on(t.cashBoxId)
      .where(sql`${t.originType} = 'OPENING' AND ${t.cashBoxId} IS NOT NULL`),
    uniqueIndex("ux_treasury_opening_bank")
      .on(t.bankAccountId)
      .where(sql`${t.originType} = 'OPENING' AND ${t.bankAccountId} IS NOT NULL`),
    check("ck_treasury_kind", sql`${t.accountKind} IN ('CASH','BANK')`),
    check(
      "ck_treasury_account",
      sql`(${t.accountKind} = 'CASH' AND ${t.cashBoxId} IS NOT NULL AND ${t.bankAccountId} IS NULL)
       OR (${t.accountKind} = 'BANK' AND ${t.bankAccountId} IS NOT NULL AND ${t.cashBoxId} IS NULL)`,
    ),
    check("ck_treasury_direction", sql`${t.direction} IN ('IN','OUT')`),
    check("ck_treasury_amount", sql`${t.amount} > 0`),
    check(
      "ck_treasury_origin_type",
      sql`${t.originType} IN ('OPENING','COLLECTION_LINE','PAYMENT_LINE','CHECK_EVENT','ACCOUNT_TRANSFER','REFUND','MANUAL','CASH_COUNT_DIFF','REVERSAL')`,
    ),
    // Exactamente la referencia de origen que corresponde a origin_type.
    check(
      "ck_treasury_origin_ref",
      sql`num_nonnulls(${t.collectionLineId}, ${t.paymentLineId}, ${t.checkEventId}, ${t.accountTransferId},
          ${t.refundId}, ${t.cashClosureId}, ${t.reversalOfId}) =
        CASE WHEN ${t.originType} IN ('OPENING','MANUAL') THEN 0 ELSE 1 END
      AND (${t.originType} <> 'COLLECTION_LINE' OR ${t.collectionLineId} IS NOT NULL)
      AND (${t.originType} <> 'PAYMENT_LINE' OR ${t.paymentLineId} IS NOT NULL)
      AND (${t.originType} <> 'CHECK_EVENT' OR ${t.checkEventId} IS NOT NULL)
      AND (${t.originType} <> 'ACCOUNT_TRANSFER' OR ${t.accountTransferId} IS NOT NULL)
      AND (${t.originType} <> 'REFUND' OR ${t.refundId} IS NOT NULL)
      AND (${t.originType} <> 'CASH_COUNT_DIFF' OR ${t.cashClosureId} IS NOT NULL)
      AND (${t.originType} <> 'REVERSAL' OR ${t.reversalOfId} IS NOT NULL)`,
    ),
    check(
      "ck_treasury_manual_idempotency",
      sql`${t.originType} <> 'MANUAL' OR (${t.idempotencyKey} IS NOT NULL AND ${t.conceptId} IS NOT NULL)`,
    ),
  ],
);

/** Ingresos y egresos proyectados que no surgen de comprobantes (no impactan saldos reales). */
export const plannedCashItems = pgTable(
  "planned_cash_items",
  {
    id: id(),
    direction: text().notNull(),
    conceptId: ref().references(() => treasuryConcepts.id),
    expectedDate: date().notNull(),
    amount: money().notNull(),
    description: text().notNull(),
    status: text().notNull().default("PLANNED"),
    recurrence: text(),
    ...auditColumns(),
  },
  (t) => [
    check("ck_planned_direction", sql`${t.direction} IN ('IN','OUT')`),
    check("ck_planned_amount", sql`${t.amount} > 0`),
    check("ck_planned_status", sql`${t.status} IN ('PLANNED','REALIZED','CANCELLED')`),
    check("ck_planned_recurrence", sql`${t.recurrence} IS NULL OR ${t.recurrence} IN ('MONTHLY')`),
  ],
);
