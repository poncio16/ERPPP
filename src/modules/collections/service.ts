import Decimal from "decimal.js";
import { and, asc, count, desc, eq, gt, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { applyAllocationsInTx, allocationsOf, reverseAllocationInTx } from "@/modules/allocations/service";
import { sumAmounts } from "@/modules/allocations/plan";
import { recordAudit } from "@/modules/audit/service";
import {
  annulReceivedCheckInTx,
  createReceivedCheckInTx,
  findReceivedCheckDuplicate,
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
  banks,
  cashBoxes,
  clients,
  collectionLines,
  collections,
  customerAccountEntries,
  receipts,
  receivedChecks,
  taxCatalog,
  treasuryMovements,
  users,
} from "@/server/db/schema";
import type { OperationListQuery, RegisterCollectionInput } from "./schemas";

/**
 * Cobranzas (G.5): cliente, fecha y uno o más medios. Todo en una transacción: medios, movimientos
 * de caja/banco, cheques en cartera, crédito en la cuenta corriente por el total, imputaciones
 * opcionales y recibo interno numerado. Lo no imputado queda como saldo a favor.
 */

const dmy = (iso: string) => formatDate(iso);
export const METHOD_LABEL = { CASH: "Efectivo", TRANSFER: "Transferencia", CHECK: "Cheque", RETENTION: "Retención sufrida" } as const;

/** Cheque vencido para el cobro: más de 30 días desde su fecha de pago (Ley de Cheques). */
const CHECK_PRESENTATION_DAYS = 30;
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export async function registerCollection(db: Db, ctx: ServiceContext, input: RegisterCollectionInput) {
  assertPermission(ctx, "collections.create");
  const existing = async () => {
    const [row] = await db
      .select({ id: collections.id, receiptId: receipts.id })
      .from(collections)
      .leftJoin(receipts, eq(receipts.collectionId, collections.id))
      .where(eq(collections.idempotencyKey, input.idempotencyKey));
    return row ? { id: row.id, receiptId: row.receiptId, existing: true } : null;
  };
  const before = await existing();
  if (before) return before;
  try {
    return await db.transaction((tx) => registerInTx(tx, ctx, input));
  } catch (e) {
    const { code, constraint } = pgError(e);
    if (code === "23505" && constraint === "ux_collections_idempotency_key") {
      const again = await existing();
      if (again) return again;
    }
    if (code === "23505" && constraint === "ux_received_checks") {
      throw new ValidationError({ lines: ["Uno de los cheques ya está registrado (mismo banco, número y librador)."] });
    }
    throw e;
  }
}

async function registerInTx(tx: Tx, ctx: ServiceContext, input: RegisterCollectionInput) {
  const errors: Record<string, string[]> = {};
  const warnings: string[] = [];
  const today = todayIso();

  const [client] = await tx.select().from(clients).where(eq(clients.id, input.clientId));
  if (!client) throw new ValidationError({ clientId: ["El cliente no existe."] });
  if (client.status !== "ACTIVE") throw new ValidationError({ clientId: ["El cliente está dado de baja."] });

  if (input.date > today) errors.date = ["La fecha de la cobranza no puede ser posterior a hoy."];
  const locked = await lockedUntil(tx);
  if (locked && input.date <= locked) errors.date = [`El período está cerrado hasta el ${dmy(locked)}.`];

  // Validación de cada medio (los errores se informan por línea).
  const refs: AccountRef[] = [];
  for (const [i, line] of input.lines.entries()) {
    const at = (field: string, msg: string) => (errors[`lines.${i}.${field}`] ??= []).push(msg);
    if (line.method === "CASH") {
      const [box] = await tx.select({ active: cashBoxes.active }).from(cashBoxes).where(eq(cashBoxes.id, line.cashBoxId));
      if (!box?.active) at("cashBoxId", "La caja no existe o está inactiva.");
      else refs.push({ kind: "CASH", id: line.cashBoxId });
    } else if (line.method === "TRANSFER") {
      const [acc] = await tx.select({ active: bankAccounts.active, name: bankAccounts.displayName }).from(bankAccounts).where(eq(bankAccounts.id, line.bankAccountId));
      if (!acc?.active) at("bankAccountId", "La cuenta bancaria no existe o está inactiva.");
      else refs.push({ kind: "BANK", id: line.bankAccountId });
      if (line.transferDate > today) at("transferDate", "La fecha de la transferencia no puede ser posterior a hoy.");
      if (acc?.active) {
        const [dup] = await tx
          .select({ id: treasuryMovements.id })
          .from(treasuryMovements)
          .where(
            and(
              eq(treasuryMovements.bankAccountId, line.bankAccountId),
              eq(treasuryMovements.movementDate, line.transferDate),
              eq(treasuryMovements.direction, "IN"),
              eq(treasuryMovements.amount, line.amount),
              line.transferReference ? eq(treasuryMovements.reference, line.transferReference) : sql`true`,
            ),
          )
          .limit(1);
        if (dup) warnings.push(`Ya hay un ingreso en ${acc.name} del ${dmy(line.transferDate)} por ${formatMoney(line.amount)}${line.transferReference ? ` con la referencia ${line.transferReference}` : ""}: verifique que no sea la misma transferencia.`);
      }
    } else if (line.method === "CHECK") {
      const [bank] = await tx.select({ active: banks.active }).from(banks).where(eq(banks.id, line.check.issuerBankId));
      if (!bank?.active) at("check.issuerBankId", "Banco inexistente o inactivo.");
      if (await findReceivedCheckDuplicate(tx, line.check)) at("check.number", "Ese cheque ya está registrado (mismo banco, número y librador).");
      const twin = input.lines.findIndex(
        (l, j) => j < i && l.method === "CHECK" && l.check.issuerBankId === line.check.issuerBankId && l.check.number === line.check.number && l.check.drawerTaxId === line.check.drawerTaxId,
      );
      if (twin >= 0) at("check.number", "El cheque figura dos veces en la cobranza.");
      if (addDays(line.check.paymentDate, CHECK_PRESENTATION_DAYS) < input.date) {
        warnings.push(`El cheque N° ${line.check.number} tiene fecha de pago ${dmy(line.check.paymentDate)}: pasaron más de ${CHECK_PRESENTATION_DAYS} días y puede no ser cobrable.`);
      }
    } else {
      const [t] = await tx.select({ kind: taxCatalog.kind, active: taxCatalog.active }).from(taxCatalog).where(eq(taxCatalog.id, line.retentionTaxId));
      if (!t || t.kind !== "RETENTION" || !t.active) at("retentionTaxId", "Elija un impuesto de retención vigente.");
      if (line.retentionDate > today) at("retentionDate", "La fecha de la retención no puede ser posterior a hoy.");
    }
  }
  const total = sumAmounts(input.lines);
  if (sumAmounts(input.allocations).gt(total)) errors.allocations = [`El total imputado supera el importe de la cobranza (${formatMoney(total)}).`];
  if (Object.keys(errors).length) throw new ValidationError(errors);
  if (warnings.length && !input.confirmWarnings) {
    throw new DomainError("Revise las advertencias y confirme para registrar igual.", "NEEDS_CONFIRMATION", { _warnings: warnings });
  }

  await lockAccounts(tx, dedupeRefs(refs));
  const number = await nextSequenceNumber(tx, "RECEIPT");
  const totalText = total.toFixed(2);
  const [collection] = await tx
    .insert(collections)
    .values({
      clientId: client.id,
      collectionDate: input.date,
      totalAmount: totalText,
      unappliedAmount: totalText,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      createdBy: ctx.userId,
    })
    .returning({ id: collections.id });
  const collectionId = collection!.id;
  const label = `Cobranza ${number} — ${client.legalName}`;

  const movementIds: number[] = [];
  const checkIds: number[] = [];
  for (const [i, line] of input.lines.entries()) {
    const receivedCheckId =
      line.method === "CHECK"
        ? await createReceivedCheckInTx(tx, ctx, {
            ...line.check,
            clientId: client.id,
            amount: line.amount,
            date: input.date,
            notes: `Recibido en la cobranza ${number}`,
          })
        : null;
    if (receivedCheckId) checkIds.push(receivedCheckId);
    const [row] = await tx
      .insert(collectionLines)
      .values({
        collectionId,
        lineNo: i + 1,
        method: line.method,
        amount: line.amount,
        cashBoxId: line.method === "CASH" ? line.cashBoxId : null,
        bankAccountId: line.method === "TRANSFER" ? line.bankAccountId : null,
        transferDate: line.method === "TRANSFER" ? line.transferDate : null,
        transferReference: line.method === "TRANSFER" ? line.transferReference : null,
        receivedCheckId,
        retentionTaxId: line.method === "RETENTION" ? line.retentionTaxId : null,
        retentionCertificate: line.method === "RETENTION" ? line.certificate : null,
        retentionDate: line.method === "RETENTION" ? line.retentionDate : null,
      })
      .returning({ id: collectionLines.id });
    if (line.method === "CASH" || line.method === "TRANSFER") {
      movementIds.push(
        await recordMovement(tx, ctx, {
          account: line.method === "CASH" ? { kind: "CASH", id: line.cashBoxId } : { kind: "BANK", id: line.bankAccountId },
          date: line.method === "CASH" ? input.date : line.transferDate,
          direction: "IN",
          amount: line.amount,
          conceptCode: "COBRANZA",
          description: label,
          reference: line.method === "TRANSFER" ? line.transferReference : number,
          originType: "COLLECTION_LINE",
          collectionLineId: row!.id,
        }),
      );
    }
  }

  // Crédito en la cuenta corriente por el total, aunque no se impute (G.4, Anexo 1-1).
  await tx.insert(customerAccountEntries).values({
    clientId: client.id,
    entryDate: input.date,
    entryType: "COLLECTION",
    collectionId,
    credit: totalText,
    description: `Cobranza — recibo ${number}`,
    createdBy: ctx.userId,
  });

  const allocationIds = await applyAllocationsInTx(tx, ctx, { kind: "COLLECTION", id: collectionId }, input.allocations, input.date);

  const [receipt] = await tx
    .insert(receipts)
    .values({
      number,
      collectionId,
      issueDate: input.date,
      partyName: client.legalName,
      partyTaxId: client.taxId,
      amount: totalText,
      amountInWords: amountInWords(total),
      createdBy: ctx.userId,
    })
    .returning({ id: receipts.id });

  await recordAudit(tx, ctx, {
    module: "collections",
    action: "create",
    entityType: "collection",
    entityId: collectionId,
    after: {
      client: client.legalName,
      date: input.date,
      total: totalText,
      receipt: number,
      lines: input.lines.map((l) => ({ method: l.method, amount: l.amount })),
      movements: movementIds,
      checks: checkIds,
      allocations: allocationIds,
      unapplied: total.minus(sumAmounts(input.allocations)).toFixed(2),
    },
    message: warnings.length ? `Registrada con advertencias confirmadas: ${warnings.join(" | ")}` : undefined,
  });
  return { id: collectionId, receiptId: receipt!.id, existing: false };
}

const dedupeRefs = (refs: AccountRef[]) => refs.filter((r, i) => refs.findIndex((o) => o.kind === r.kind && o.id === r.id) === i);

/**
 * Anulación (G.5-10): solo si los cheques recibidos siguen en cartera, el período está abierto y
 * la caja no está cerrada a la fecha de la cobranza. Revierte imputaciones, movimientos, cheques,
 * cuenta corriente y recibo en una transacción. Nada se borra.
 */
export async function annulCollection(db: Db, ctx: ServiceContext, input: { id: number; reason: string }) {
  assertPermission(ctx, "collections.annul");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(collections).where(eq(collections.id, input.id)).for("update");
    if (!c) throw new DomainError("La cobranza no existe.", "NOT_FOUND");
    if (c.status === "ANNULLED") throw new DomainError("La cobranza ya está anulada.");
    const locked = await lockedUntil(tx);
    if (locked && c.collectionDate <= locked) throw new DomainError(`La cobranza pertenece a un período cerrado (hasta el ${dmy(locked)}).`);

    const lines = await tx.select().from(collectionLines).where(eq(collectionLines.collectionId, c.id)).orderBy(asc(collectionLines.lineNo));
    const checkIds = lines.flatMap((l) => (l.receivedCheckId ? [l.receivedCheckId] : [])).sort((a, b) => a - b);
    const checks = checkIds.length ? await tx.select().from(receivedChecks).where(inArray(receivedChecks.id, checkIds)).orderBy(asc(receivedChecks.id)).for("update") : [];
    const moved = checks.filter((k) => k.status !== "IN_PORTFOLIO");
    if (moved.length) {
      throw new DomainError(
        `No se puede anular: ${moved.map((k) => `el cheque N° ${k.number} ya no está en cartera`).join("; ")}. Si fue rechazado, registre el rechazo del cheque.`,
      );
    }
    for (const l of lines) {
      if (l.method !== "CASH") continue;
      const closed = await lastClosureDate(tx, l.cashBoxId!);
      if (closed && c.collectionDate <= closed) {
        const [box] = await tx.select({ name: cashBoxes.name }).from(cashBoxes).where(eq(cashBoxes.id, l.cashBoxId!));
        throw new DomainError(`No se puede anular: la caja ${box?.name ?? ""} está cerrada hasta el ${dmy(closed)}, que incluye la fecha de la cobranza.`);
      }
    }

    const refs = dedupeRefs(lines.flatMap((l): AccountRef[] => (l.method === "CASH" ? [{ kind: "CASH", id: l.cashBoxId! }] : l.method === "TRANSFER" ? [{ kind: "BANK", id: l.bankAccountId! }] : [])));
    await lockAccounts(tx, refs);

    const why = `Anulación de la cobranza: ${input.reason}`;
    const active = await tx
      .select({ id: allocations.id })
      .from(allocations)
      .where(and(eq(allocations.sourceCollectionId, c.id), eq(allocations.status, "ACTIVE")))
      .orderBy(asc(allocations.id));
    for (const a of active) await reverseAllocationInTx(tx, ctx, a.id, why);

    const lineIds = lines.map((l) => l.id);
    const movements = lineIds.length
      ? await tx.select({ id: treasuryMovements.id }).from(treasuryMovements).where(inArray(treasuryMovements.collectionLineId, lineIds)).orderBy(asc(treasuryMovements.id))
      : [];
    const reversals: number[] = [];
    for (const m of movements) reversals.push(await reverseMovementInTx(tx, ctx, m.id, why));
    const today = todayIso();
    for (const k of checks) await annulReceivedCheckInTx(tx, ctx, k, today, why);

    const [entry] = await tx.select().from(customerAccountEntries).where(and(eq(customerAccountEntries.collectionId, c.id), eq(customerAccountEntries.entryType, "COLLECTION")));
    if (!entry) throw new DomainError("No se encontró el asiento de cuenta corriente de la cobranza.", "INCONSISTENT");
    await tx.insert(customerAccountEntries).values({
      clientId: c.clientId,
      entryDate: today,
      entryType: "REVERSAL",
      collectionId: c.id,
      debit: entry.credit,
      credit: entry.debit,
      description: `Anulación: ${entry.description}`,
      reversalOfId: entry.id,
      createdBy: ctx.userId,
    });

    await tx
      .update(collections)
      .set({ status: "ANNULLED", unappliedAmount: "0", annulledAt: new Date(), annulledBy: ctx.userId, annulReason: input.reason, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(collections.id, c.id));
    await tx.update(receipts).set({ status: "ANNULLED", annulledAt: new Date(), annulledBy: ctx.userId }).where(eq(receipts.collectionId, c.id));

    await recordAudit(tx, ctx, {
      module: "collections",
      action: "annul",
      entityType: "collection",
      entityId: c.id,
      before: { status: c.status, unapplied: c.unappliedAmount },
      after: { status: "ANNULLED", reason: input.reason, reversedAllocations: active.map((a) => a.id), reversalMovements: reversals, annulledChecks: checks.map((k) => k.id) },
    });
    return { id: c.id };
  });
}

// ───────────────────────────── Consultas ─────────────────────────────

export const PAGE_SIZE = 50;

export async function listCollections(db: DbOrTx, ctx: ServiceContext, query: OperationListQuery) {
  assertPermission(ctx, "collections.read");
  const conds: SQL[] = [];
  if (query.partyId) conds.push(eq(collections.clientId, query.partyId));
  if (query.from) conds.push(gte(collections.collectionDate, query.from));
  if (query.to) conds.push(lte(collections.collectionDate, query.to));
  if (query.status === "ACTIVE" || query.status === "ANNULLED") conds.push(eq(collections.status, query.status));
  if (query.status === "UNAPPLIED") conds.push(and(eq(collections.status, "ACTIVE"), gt(collections.unappliedAmount, "0"))!);
  if (query.q) {
    const like = `%${query.q}%`;
    conds.push(or(ilike(clients.legalName, like), ilike(receipts.number, like), ilike(clients.taxId, like))!);
  }
  const where = conds.length ? and(...conds) : undefined;
  const page = query.page ?? 1;
  const rows = await db
    .select({
      id: collections.id,
      date: collections.collectionDate,
      clientId: collections.clientId,
      clientName: clients.legalName,
      receipt: receipts.number,
      total: collections.totalAmount,
      unapplied: collections.unappliedAmount,
      status: collections.status,
      methods: sql<string>`(SELECT string_agg(DISTINCT l.method, ',') FROM collection_lines l WHERE l.collection_id = "collections"."id")`,
    })
    .from(collections)
    .innerJoin(clients, eq(clients.id, collections.clientId))
    .leftJoin(receipts, eq(receipts.collectionId, collections.id))
    .where(where)
    .orderBy(desc(collections.collectionDate), desc(collections.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  const [totals] = await db
    .select({
      count: count(),
      total: sql<string>`coalesce(sum(${collections.totalAmount}) FILTER (WHERE ${collections.status} = 'ACTIVE'), 0)::text`,
      unapplied: sql<string>`coalesce(sum(${collections.unappliedAmount}) FILTER (WHERE ${collections.status} = 'ACTIVE'), 0)::text`,
    })
    .from(collections)
    .innerJoin(clients, eq(clients.id, collections.clientId))
    .leftJoin(receipts, eq(receipts.collectionId, collections.id))
    .where(where);
  return { rows, page, count: totals?.count ?? 0, total: totals?.total ?? "0", unapplied: totals?.unapplied ?? "0" };
}

export async function collectionLinesDetail(db: DbOrTx, collectionId: number): Promise<OperationLine[]> {
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
    check_id: number | null;
    check_number: string | null;
    check_bank: string | null;
    check_drawer: string | null;
    check_payment_date: string | null;
    check_type: string | null;
    check_format: string | null;
    check_status: string | null;
    tax: string | null;
    certificate: string | null;
    retention_date: string | null;
    movement_id: number | null;
  }>(sql`
    SELECT l.id, l.line_no, l.method, l.amount::text AS amount,
           l.cash_box_id, cb.name AS cash_box, l.bank_account_id, ba.display_name AS bank_account,
           l.transfer_date::text AS transfer_date, l.transfer_reference,
           rc.id AS check_id, rc.number AS check_number, b.name AS check_bank, rc.drawer_name AS check_drawer,
           rc.payment_date::text AS check_payment_date, rc.check_type, rc.format AS check_format, rc.status AS check_status,
           t.name AS tax, l.retention_certificate AS certificate, l.retention_date::text AS retention_date,
           (SELECT m.id FROM treasury_movements m WHERE m.collection_line_id = l.id) AS movement_id
      FROM collection_lines l
      LEFT JOIN cash_boxes cb ON cb.id = l.cash_box_id
      LEFT JOIN bank_accounts ba ON ba.id = l.bank_account_id
      LEFT JOIN received_checks rc ON rc.id = l.received_check_id
      LEFT JOIN banks b ON b.id = rc.issuer_bank_id
      LEFT JOIN tax_catalog t ON t.id = l.retention_tax_id
     WHERE l.collection_id = ${collectionId}
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
          : r.method === "CHECK"
            ? `${r.check_format === "ECHEQ" ? "ECHEQ" : "Cheque"} ${r.check_bank} N° ${r.check_number} — ${r.check_drawer} — pago ${dmy(r.check_payment_date!)}${r.check_type === "DEFERRED" ? " (diferido)" : ""}`
            : `${r.tax} — certificado ${r.certificate} — ${dmy(r.retention_date!)}`,
    account: r.cash_box_id ? { kind: "CASH", id: Number(r.cash_box_id) } : r.bank_account_id ? { kind: "BANK", id: Number(r.bank_account_id) } : null,
    movementId: r.movement_id ? Number(r.movement_id) : null,
    checkId: r.check_id ? Number(r.check_id) : null,
    checkStatus: r.check_status,
  }));
}

export async function getCollection(db: DbOrTx, ctx: ServiceContext, id: number) {
  assertPermission(ctx, "collections.read");
  const [row] = await db
    .select({
      collection: collections,
      clientName: clients.legalName,
      clientTaxId: clients.taxId,
      receiptId: receipts.id,
      receiptNumber: receipts.number,
      createdByName: users.username,
    })
    .from(collections)
    .innerJoin(clients, eq(clients.id, collections.clientId))
    .leftJoin(receipts, eq(receipts.collectionId, collections.id))
    .leftJoin(users, eq(users.id, collections.createdBy))
    .where(eq(collections.id, id));
  if (!row) return null;
  return { ...row, lines: await collectionLinesDetail(db, id), allocations: await allocationsOf(db, { collectionId: id }) };
}

/**
 * Datos del recibo interno (G.13). Se arma con el snapshot guardado: tercero y medios de la
 * cobranza y las imputaciones hechas al registrarla (misma transacción), así una reimpresión es
 * idéntica al original aunque después se impute o desimpute el saldo.
 */
export async function receiptData(db: DbOrTx, ctx: ServiceContext, collectionId: number): Promise<InternalDocData | null> {
  assertPermission(ctx, "collections.read");
  const [row] = await db
    .select({ receipt: receipts, collection: collections, createdBy: users.username })
    .from(receipts)
    .innerJoin(collections, eq(collections.id, receipts.collectionId))
    .leftJoin(users, eq(users.id, receipts.createdBy))
    .where(eq(receipts.collectionId, collectionId));
  if (!row) return null;
  const initial = (await allocationsOf(db, { collectionId })).filter((a) => a.createdAt.getTime() === row.collection.createdAt.getTime());
  const allocated = initial.reduce((acc, a) => acc.plus(a.amount), new Decimal(0));
  return {
    kind: "RECEIPT",
    number: row.receipt.number,
    issueDate: row.receipt.issueDate,
    status: row.receipt.status,
    partyLabel: "Cliente",
    partyName: row.receipt.partyName,
    partyTaxId: row.receipt.partyTaxId,
    amount: row.receipt.amount,
    amountInWords: row.receipt.amountInWords,
    lines: await collectionLinesDetail(db, collectionId),
    allocations: initial.map((a) => ({ label: a.targetLabel, amount: a.amount })),
    unapplied: new Decimal(row.receipt.amount).minus(allocated).toFixed(2),
    notes: row.collection.notes,
    createdBy: row.createdBy,
    createdAt: row.receipt.createdAt,
    operationId: collectionId,
  };
}
