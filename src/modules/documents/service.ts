import Decimal from "decimal.js";
import { aliasedTable, and, asc, count, desc, eq, gte, ilike, inArray, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { diffFields, recordAudit } from "@/modules/audit/service";
import { getConfig } from "@/modules/config/service";
import { computeDocumentTotals, formatDocumentNumber } from "@/modules/tax/calc";
import { checkLetterVatCondition, requiresJurisdiction, taxesValidAt, vatTolerance } from "@/modules/tax/service";
import { DomainError, ValidationError } from "@/lib/errors";
import { todayIso } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { assertPermission } from "@/server/authorization";
import type { ServiceContext } from "@/server/context";
import type { Db, DbOrTx, Tx } from "@/server/db/drizzle";
import {
  allocations,
  clients,
  customerAccountEntries,
  documentRelations,
  documents,
  documentTaxLines,
  documentTypes,
  provinces,
  supplierAccountEntries,
  suppliers,
  taxCatalog,
  vatConditions,
  type Direction,
} from "@/server/db/schema";
import { parseTaxRows, type DocumentListQuery, type RegisterDocumentInput } from "./schemas";

/**
 * Registración de comprobantes emitidos y recibidos (G.1–G.3). El ERP no emite comprobantes:
 * la numeración, las fechas y los importes son los del comprobante ya emitido por otro sistema.
 */

const DEBIT_CLASSES = ["INVOICE", "DEBIT_NOTE"] as const;
const DIRECTION_LABEL: Record<Direction, { module: string; party: string }> = {
  ISSUED: { module: "comprobantes emitidos", party: "cliente" },
  RECEIVED: { module: "comprobantes recibidos", party: "proveedor" },
};

export const PAGE_SIZE = 50;

/** Error de duplicado con el comprobante existente en el mensaje (sección 5). */
function duplicateError(existing: { id: number; typeName: string; pointOfSale: number; number: number; partyName: string }) {
  const label = `${existing.typeName} ${formatDocumentNumber(existing.pointOfSale, existing.number)} (${existing.partyName})`;
  return new DomainError(`Ese comprobante ya está registrado: ${label}.`, "DUPLICATE_DOCUMENT", {
    number: [`Ya está registrado: ${label}. Si se cargó mal, anúlelo y vuelva a registrarlo.`],
  });
}

/** Busca un comprobante no anulado con la misma clave de duplicado (G.1-3). */
export async function findDuplicate(
  db: DbOrTx,
  key: { direction: Direction; documentTypeId: number; pointOfSale: number; number: number; partyId?: number | null },
) {
  const conds: SQL[] = [
    eq(documents.direction, key.direction),
    eq(documents.documentTypeId, key.documentTypeId),
    eq(documents.pointOfSale, key.pointOfSale),
    eq(documents.number, key.number),
    ne(documents.status, "ANNULLED"),
  ];
  if (key.direction === "RECEIVED") {
    if (!key.partyId) return null;
    conds.push(eq(documents.supplierId, key.partyId));
  }
  const [row] = await db
    .select({
      id: documents.id,
      typeName: documentTypes.name,
      pointOfSale: documents.pointOfSale,
      number: documents.number,
      partyName: documents.partyName,
    })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .where(and(...conds));
  return row ?? null;
}

/** Comprobación inmediata de duplicado al completar el número (aviso en el formulario). */
export async function checkDuplicate(
  db: Db,
  ctx: ServiceContext,
  key: { direction: Direction; documentTypeId: number; pointOfSale: number; number: number; partyId?: number },
) {
  assertPermission(ctx, "documents.create");
  const dup = await findDuplicate(db, key);
  return dup ? { duplicate: true as const, message: duplicateError(dup).message, id: dup.id } : { duplicate: false as const };
}

async function lockedUntil(db: DbOrTx): Promise<string | null> {
  const v = await getConfig(db, "locked_until_date");
  return typeof v === "string" && v ? v : null;
}

async function loadParty(tx: DbOrTx, direction: Direction, partyId: number) {
  if (direction === "ISSUED") {
    const [p] = await tx
      .select({
        id: clients.id,
        legalName: clients.legalName,
        taxId: clients.taxId,
        vatConditionId: clients.vatConditionId,
        status: clients.status,
        creditLimit: clients.creditLimit,
        creditDays: clients.creditDays,
      })
      .from(clients)
      .where(eq(clients.id, partyId));
    return p ?? null;
  }
  const [p] = await tx
    .select({
      id: suppliers.id,
      legalName: suppliers.legalName,
      taxId: suppliers.taxId,
      vatConditionId: suppliers.vatConditionId,
      status: suppliers.status,
      creditLimit: suppliers.creditLimit,
      creditDays: suppliers.creditDays,
    })
    .from(suppliers)
    .where(eq(suppliers.id, partyId));
  return p ?? null;
}

async function partyBalance(tx: DbOrTx, direction: Direction, partyId: number): Promise<Decimal> {
  const { rows } = await tx.execute<{ balance: string | null }>(
    direction === "ISSUED"
      ? sql`SELECT balance::text FROM customer_accounts WHERE client_id = ${partyId}`
      : sql`SELECT balance::text FROM supplier_accounts WHERE supplier_id = ${partyId}`,
  );
  return new Decimal(rows[0]?.balance ?? "0");
}

const pgError = (e: unknown) => {
  const err = ((e as { cause?: unknown }).cause ?? e) as { code?: string; constraint?: string };
  return { code: err.code, constraint: err.constraint };
};

export interface RegisterResult {
  id: number;
  existing: boolean;
}

export async function registerDocument(
  db: Db,
  ctx: ServiceContext,
  direction: Direction,
  input: RegisterDocumentInput,
): Promise<RegisterResult> {
  assertPermission(ctx, "documents.create");
  const [already] = await db.select({ id: documents.id }).from(documents).where(eq(documents.idempotencyKey, input.idempotencyKey));
  if (already) return { id: already.id, existing: true };

  try {
    return await db.transaction((tx) => registerInTx(tx, ctx, direction, input));
  } catch (e) {
    const { code, constraint } = pgError(e);
    if (code === "23505" && constraint === "ux_documents_idempotency_key") {
      // Doble envío simultáneo: la primera operación ya registró el comprobante.
      const [row] = await db.select({ id: documents.id }).from(documents).where(eq(documents.idempotencyKey, input.idempotencyKey));
      if (row) return { id: row.id, existing: true };
    }
    if (code === "23505" && (constraint === "ux_documents_issued" || constraint === "ux_documents_received")) {
      const dup = await findDuplicate(db, { direction, ...input });
      if (dup) throw duplicateError(dup);
    }
    throw e;
  }
}

async function registerInTx(tx: Tx, ctx: ServiceContext, direction: Direction, input: RegisterDocumentInput): Promise<RegisterResult> {
  const errors: Record<string, string[]> = {};
  const warnings: string[] = [];
  const label = DIRECTION_LABEL[direction];

  // Tipo de comprobante permitido en este circuito.
  const [type] = await tx.select().from(documentTypes).where(eq(documentTypes.id, input.documentTypeId));
  if (!type || !type.active || !type.isFiscal || !(direction === "ISSUED" ? type.allowedIssued : type.allowedReceived)) {
    throw new ValidationError({ documentTypeId: [`Tipo de comprobante no admitido en ${label.module}.`] });
  }

  // Tercero activo; se guarda una copia de sus datos fiscales (G.1-7).
  const party = await loadParty(tx, direction, input.partyId);
  if (!party) throw new ValidationError({ partyId: [`El ${label.party} no existe.`] });
  if (party.status !== "ACTIVE") throw new ValidationError({ partyId: [`El ${label.party} está dado de baja.`] });

  // Período de IVA y período bloqueado (G.1-6).
  const issueMonth = `${input.issueDate.slice(0, 7)}-01`;
  const vatPeriod = input.vatPeriod ? `${input.vatPeriod}-01` : issueMonth;
  if (direction === "ISSUED" && vatPeriod !== issueMonth) errors.vatPeriod = ["En emitidos el período de IVA es el mes de la fecha del comprobante."];
  if (direction === "RECEIVED" && vatPeriod < issueMonth) errors.vatPeriod = ["El período de IVA no puede ser anterior al mes del comprobante."];
  const locked = await lockedUntil(tx);
  if (locked && (input.issueDate <= locked || vatPeriod <= locked)) {
    errors.issueDate = [`El período está cerrado hasta el ${locked.split("-").reverse().join("/")}: no se pueden registrar comprobantes en él.`];
  }

  // Líneas tributarias: impuestos vigentes a la fecha del comprobante (G.2).
  const rows = parseTaxRows(input);
  Object.assign(errors, rows.errors);
  const valid = new Map((await taxesValidAt(tx, input.issueDate)).map((t) => [t.id, t]));
  const vatLines = rows.vat.flatMap((l) => {
    const t = valid.get(l.taxId);
    if (!t || t.kind !== "VAT") {
      errors[`vat.${l.index}`] = ["Alícuota inexistente o no vigente a la fecha del comprobante."];
      return [];
    }
    return [{ taxId: l.taxId, rate: t.rate!, base: l.base, amount: l.amount }];
  });
  const otherLines = rows.other.flatMap((l) => {
    const t = valid.get(l.taxId);
    if (!t || (t.kind !== "PERCEPTION" && t.kind !== "OTHER_TAX")) {
      errors[`other.${l.index}`] = ["Concepto inexistente o no vigente a la fecha del comprobante."];
      return [];
    }
    if (requiresJurisdiction(t) && !l.jurisdictionId) {
      errors[`other.${l.index}`] = ["Las percepciones de Ingresos Brutos requieren jurisdicción."];
      return [];
    }
    return [{ taxId: l.taxId, kind: t.kind as "PERCEPTION" | "OTHER_TAX", amount: l.amount, jurisdictionId: l.jurisdictionId }];
  });
  if (vatLines.length > 0 && direction === "RECEIVED" && !type.vatCreditable) {
    errors.vat = [`${type.name} no discrimina IVA: cargue el importe total en "No gravado / IVA no discriminado".`];
  }
  if (vatLines.length > 0 && type.letter === "E") errors.vat = ["Los comprobantes de exportación (letra E) no llevan IVA."];

  const computed = computeDocumentTotals({
    vatLines,
    otherLines,
    netUntaxed: input.netUntaxed,
    netExempt: input.netExempt,
    discount: input.discount,
    exchangeRate: input.exchangeRate,
    vatTolerance: await vatTolerance(tx),
  });
  if ("errors" in computed) Object.assign(errors, computed.errors);
  const totals = "totals" in computed ? computed.totals : null;

  // Total de control: si se tipea, debe coincidir con el calculado (G.2-3).
  if (totals && input.controlTotal) {
    const control = input.currency === "ARS" ? input.controlTotal : input.controlTotal.mul(input.exchangeRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (!control.equals(totals.total)) {
      errors.controlTotal = [`El total calculado (${formatMoney(totals.total)}) no coincide con el total del comprobante (${formatMoney(control)}). Revise los importes.`];
    }
  }

  // NC / ND: motivo y vínculo con el comprobante original (G.3).
  const isCredit = type.class === "CREDIT_NOTE";
  const isDebitNote = type.class === "DEBIT_NOTE";
  if ((isCredit || isDebitNote) && !input.reason) errors.reason = ["Indique el motivo de la nota."];
  if (!isCredit && !isDebitNote && input.relatedDocumentIds.length) errors.relatedDocumentIds = ["Solo las notas de crédito y débito se vinculan a otro comprobante."];
  if (isCredit && input.relatedDocumentIds.length === 0 && !input.unlinkedCreditNote) {
    errors.relatedDocumentIds = ['Elija el comprobante que corrige, o marque "Nota de crédito sin comprobante asociado".'];
  }
  let related: { id: number; balance: string; total: string }[] = [];
  if (input.relatedDocumentIds.length) {
    const ids = [...new Set(input.relatedDocumentIds)];
    related = await tx
      .select({ id: documents.id, balance: documents.balance, total: documents.total, cls: documentTypes.class, status: documents.status, clientId: documents.clientId, supplierId: documents.supplierId, direction: documents.direction })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(inArray(documents.id, ids))
      .then((rs) => {
        const ok = rs.filter(
          (r) =>
            r.direction === direction &&
            (direction === "ISSUED" ? r.clientId === party.id : r.supplierId === party.id) &&
            r.status !== "ANNULLED" &&
            (DEBIT_CLASSES as readonly string[]).includes(r.cls),
        );
        if (ok.length !== ids.length) errors.relatedDocumentIds = [`Los comprobantes vinculados deben ser facturas o notas de débito vigentes del mismo ${label.party}.`];
        return ok;
      });
  }

  // Duplicado (G.1-3). La base lo vuelve a impedir con el índice único.
  const dup = await findDuplicate(tx, { direction, ...input });
  if (dup) Object.assign(errors, duplicateError(dup).fieldErrors);

  if (Object.keys(errors).length || !totals) throw new ValidationError(errors);

  // Advertencias que el usuario debe confirmar (no bloquean: el comprobante ya existe).
  const letterCheck = await checkLetterVatCondition(tx, direction, type.letter, party.vatConditionId);
  if (letterCheck?.mode === "BLOCK") throw new ValidationError({ documentTypeId: [letterCheck.message] });
  if (letterCheck) warnings.push(letterCheck.message);
  if (direction === "ISSUED" && !isCredit && party.creditLimit) {
    const after = (await partyBalance(tx, direction, party.id)).plus(totals.total);
    if (after.greaterThan(party.creditLimit)) {
      warnings.push(`Con este comprobante el saldo del cliente (${formatMoney(after)}) supera su límite de crédito (${formatMoney(party.creditLimit)}).`);
    }
  }
  if (direction === "RECEIVED" && party.taxId) {
    const [twin] = await tx
      .select({ name: suppliers.legalName })
      .from(documents)
      .innerJoin(suppliers, eq(suppliers.id, documents.supplierId))
      .where(
        and(
          eq(documents.direction, "RECEIVED"),
          eq(documents.documentTypeId, input.documentTypeId),
          eq(documents.pointOfSale, input.pointOfSale),
          eq(documents.number, input.number),
          ne(documents.status, "ANNULLED"),
          eq(suppliers.taxId, party.taxId),
          ne(suppliers.id, party.id),
        ),
      );
    if (twin) warnings.push(`El mismo comprobante ya está registrado para otro proveedor con la misma CUIT (${twin.name}).`);
  }
  if (isCredit && related.length) {
    const relatedTotal = related.reduce((a, r) => a.plus(r.total), new Decimal(0));
    if (new Decimal(totals.total).greaterThan(relatedTotal)) {
      warnings.push(`La nota de crédito (${formatMoney(totals.total)}) supera el total de los comprobantes vinculados (${formatMoney(relatedTotal)}).`);
    }
  }
  if (input.issueDate > todayIso()) warnings.push("La fecha del comprobante es posterior a hoy.");
  if (warnings.length && !input.confirmWarnings) {
    throw new DomainError("Revise las advertencias y confirme para registrar igual.", "NEEDS_CONFIRMATION", { _warnings: warnings });
  }

  const [doc] = await tx
    .insert(documents)
    .values({
      direction,
      documentTypeId: type.id,
      pointOfSale: input.pointOfSale,
      number: input.number,
      clientId: direction === "ISSUED" ? party.id : null,
      supplierId: direction === "RECEIVED" ? party.id : null,
      partyName: party.legalName,
      partyTaxId: party.taxId,
      partyVatConditionId: party.vatConditionId,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      vatPeriod,
      concept: input.concept,
      description: input.description,
      currency: input.currency,
      exchangeRate: input.exchangeRate.toFixed(6),
      netTaxed: totals.netTaxed,
      netUntaxed: totals.netUntaxed,
      netExempt: totals.netExempt,
      vatTotal: totals.vatTotal,
      perceptionsTotal: totals.perceptionsTotal,
      otherTaxesTotal: totals.otherTaxesTotal,
      discountTotal: totals.discountTotal,
      total: totals.total,
      balance: totals.total,
      status: "OPEN",
      reason: input.reason,
      externalRef: input.externalRef,
      idempotencyKey: input.idempotencyKey,
      createdBy: ctx.userId,
    })
    .returning({ id: documents.id });
  const documentId = doc!.id;

  if (totals.lines.length) {
    await tx.insert(documentTaxLines).values(
      totals.lines.map((l) => ({
        documentId,
        taxId: l.taxId,
        kind: l.kind,
        baseAmount: l.base,
        rate: l.rate,
        amount: l.amount,
        jurisdictionId: l.jurisdictionId,
      })),
    );
  }
  if (related.length) {
    await tx.insert(documentRelations).values(
      related.map((r) => ({
        documentId,
        relatedDocumentId: r.id,
        relationType: isCredit ? "CREDIT_NOTE_OF" : "DEBIT_NOTE_OF",
        createdBy: ctx.userId,
      })),
    );
  }

  // Cuenta corriente: débito por facturas y ND, crédito por NC (G.4), en la misma transacción.
  const description = `${type.name} ${formatDocumentNumber(input.pointOfSale, input.number)}`;
  const entry = {
    entryDate: input.issueDate,
    entryType: "DOCUMENT",
    documentId,
    debit: isCredit ? "0" : totals.total,
    credit: isCredit ? totals.total : "0",
    description,
    createdBy: ctx.userId,
  };
  if (direction === "ISSUED") await tx.insert(customerAccountEntries).values({ ...entry, clientId: party.id });
  else await tx.insert(supplierAccountEntries).values({ ...entry, supplierId: party.id });

  await recordAudit(tx, ctx, {
    module: "documents",
    action: "create",
    entityType: "document",
    entityId: documentId,
    after: {
      direction,
      type: type.code,
      number: formatDocumentNumber(input.pointOfSale, input.number),
      party: party.legalName,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      vatPeriod,
      currency: input.currency,
      exchangeRate: input.exchangeRate.toFixed(6),
      ...Object.fromEntries(Object.entries(totals).filter(([k]) => k !== "lines")),
      lines: totals.lines,
      related: related.map((r) => r.id),
      reason: input.reason,
    },
    message: warnings.length ? `Registrado con advertencias confirmadas: ${warnings.join(" | ")}` : undefined,
  });
  return { id: documentId, existing: false };
}

/**
 * Anulación del registro (G.1-10): no es una anulación fiscal (eso se hace con una NC). Exige
 * motivo y que no tenga imputaciones activas. Saldo a cero y asiento de reversión; nada se borra.
 */
export async function annulDocument(db: Db, ctx: ServiceContext, input: { id: number; version: number; reason: string }) {
  assertPermission(ctx, "documents.annul");
  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(documents).where(eq(documents.id, input.id)).for("update");
    if (!d) throw new DomainError("El comprobante no existe.", "NOT_FOUND");
    if (d.status === "ANNULLED") throw new DomainError("El comprobante ya está anulado.");
    if (d.version !== input.version) throw new DomainError("Otro usuario modificó el comprobante. Recargue la página.", "CONFLICT");
    const [{ active } = { active: 0 }] = await tx
      .select({ active: count() })
      .from(allocations)
      .where(and(eq(allocations.status, "ACTIVE"), or(eq(allocations.targetDocumentId, d.id), eq(allocations.sourceDocumentId, d.id))));
    if (active > 0) {
      throw new DomainError("El comprobante tiene imputaciones activas. Desimpútelo antes de anularlo.", "HAS_ALLOCATIONS");
    }
    const locked = await lockedUntil(tx);
    if (locked && (d.issueDate <= locked || d.vatPeriod <= locked)) {
      throw new DomainError(`El comprobante pertenece a un período cerrado (hasta el ${locked.split("-").reverse().join("/")}); no se puede anular.`);
    }
    await tx
      .update(documents)
      .set({
        status: "ANNULLED",
        balance: "0",
        annulledAt: new Date(),
        annulledBy: ctx.userId,
        annulReason: input.reason,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
        version: sql`${documents.version} + 1`,
      })
      .where(eq(documents.id, d.id));

    // Asiento espejo del original (la base verifica que sea exactamente el opuesto).
    const ledger = d.direction === "ISSUED" ? customerAccountEntries : supplierAccountEntries;
    const [orig] = await tx
      .select()
      .from(ledger)
      .where(and(eq(ledger.documentId, d.id), eq(ledger.entryType, "DOCUMENT")));
    if (!orig) throw new DomainError("No se encontró el asiento de cuenta corriente del comprobante.", "INCONSISTENT");
    const reversal = {
      entryDate: todayIso(),
      entryType: "REVERSAL",
      documentId: d.id,
      debit: orig.credit,
      credit: orig.debit,
      description: `Anulación: ${orig.description}`,
      reversalOfId: orig.id,
      createdBy: ctx.userId,
    };
    if (d.direction === "ISSUED") await tx.insert(customerAccountEntries).values({ ...reversal, clientId: d.clientId! });
    else await tx.insert(supplierAccountEntries).values({ ...reversal, supplierId: d.supplierId! });

    await recordAudit(tx, ctx, {
      module: "documents",
      action: "annul",
      entityType: "document",
      entityId: d.id,
      before: { status: d.status, balance: d.balance },
      after: { status: "ANNULLED", balance: "0.00", reason: input.reason },
    });
  });
}

/**
 * Corrección de datos no financieros (vencimiento, concepto, descripción, referencia). Los importes,
 * el tercero, el tipo y la numeración se corrigen anulando el registro y volviéndolo a cargar
 * (D3 libera el número), porque el asiento de cuenta corriente es inmutable.
 */
export async function updateDocumentInfo(
  db: Db,
  ctx: ServiceContext,
  input: { id: number; version: number; dueDate: string; concept: string | null; description: string | null; externalRef: string | null },
) {
  assertPermission(ctx, "documents.edit");
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(documents).where(eq(documents.id, input.id)).for("update");
    if (!d) throw new DomainError("El comprobante no existe.", "NOT_FOUND");
    if (d.status === "ANNULLED") throw new DomainError("Un comprobante anulado no se puede modificar.");
    if (d.version !== input.version) throw new DomainError("Otro usuario modificó el comprobante. Recargue la página.", "CONFLICT");
    if (input.dueDate < d.issueDate) throw new ValidationError({ dueDate: ["El vencimiento no puede ser anterior a la fecha del comprobante."] });
    const values = { dueDate: input.dueDate, concept: input.concept, description: input.description, externalRef: input.externalRef };
    const diff = diffFields(d as unknown as Record<string, unknown>, values);
    if (!diff) return { changed: false };
    await tx
      .update(documents)
      .set({ ...values, updatedAt: new Date(), updatedBy: ctx.userId, version: sql`${documents.version} + 1` })
      .where(eq(documents.id, d.id));
    await recordAudit(tx, ctx, { module: "documents", action: "update", entityType: "document", entityId: d.id, ...diff });
    return { changed: true };
  });
}

// ─────────────────────────────── Consultas ───────────────────────────────

export async function getDocument(db: DbOrTx, ctx: ServiceContext, id: number) {
  assertPermission(ctx, "documents.read");
  const [d] = await db
    .select({
      doc: documents,
      typeName: documentTypes.name,
      typeCode: documentTypes.code,
      letter: documentTypes.letter,
      documentClass: documentTypes.class,
      vatCreditable: documentTypes.vatCreditable,
      vatCondition: vatConditions.name,
    })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .innerJoin(vatConditions, eq(vatConditions.id, documents.partyVatConditionId))
    .where(eq(documents.id, id));
  if (!d) throw new DomainError("El comprobante no existe.", "NOT_FOUND");
  const lines = await db
    .select({
      id: documentTaxLines.id,
      kind: documentTaxLines.kind,
      name: taxCatalog.name,
      base: documentTaxLines.baseAmount,
      rate: documentTaxLines.rate,
      amount: documentTaxLines.amount,
      jurisdiction: provinces.name,
    })
    .from(documentTaxLines)
    .innerJoin(taxCatalog, eq(taxCatalog.id, documentTaxLines.taxId))
    .leftJoin(provinces, eq(provinces.id, documentTaxLines.jurisdictionId))
    .where(eq(documentTaxLines.documentId, id))
    .orderBy(asc(documentTaxLines.id));
  const other = aliasedTable(documents, "other");
  const otherType = aliasedTable(documentTypes, "other_type");
  const relationRows = (dir: "out" | "in") =>
    db
      .select({
        id: other.id,
        typeName: otherType.name,
        pointOfSale: other.pointOfSale,
        number: other.number,
        total: other.total,
        status: other.status,
        relationType: documentRelations.relationType,
      })
      .from(documentRelations)
      .innerJoin(other, eq(other.id, dir === "out" ? documentRelations.relatedDocumentId : documentRelations.documentId))
      .innerJoin(otherType, eq(otherType.id, other.documentTypeId))
      .where(eq(dir === "out" ? documentRelations.documentId : documentRelations.relatedDocumentId, id))
      .orderBy(asc(other.id));
  const [relatesTo, relatedBy] = await Promise.all([relationRows("out"), relationRows("in")]);
  return { ...d.doc, typeName: d.typeName, typeCode: d.typeCode, letter: d.letter, documentClass: d.documentClass, vatCreditable: d.vatCreditable, vatCondition: d.vatCondition, lines, relatesTo, relatedBy };
}
export type DocumentDetail = Awaited<ReturnType<typeof getDocument>>;

export async function documentHistory(db: Db, ctx: ServiceContext, id: number) {
  assertPermission(ctx, "documents.read");
  const { rows } = await db.execute<{ id: string; occurred_at: Date; username: string | null; action: string; before: unknown; after: unknown; message: string | null }>(
    sql`SELECT id, occurred_at, username, action, before, after, message FROM audit_log
         WHERE entity_type = 'document' AND entity_id = ${String(id)} AND result = 'SUCCESS' ORDER BY id DESC LIMIT 100`,
  );
  return rows;
}

export async function listDocuments(db: Db, ctx: ServiceContext, direction: Direction, query: DocumentListQuery) {
  assertPermission(ctx, "documents.read");
  const today = todayIso();
  const conds: SQL[] = [eq(documents.direction, direction)];
  if (query.partyId) conds.push(eq(direction === "ISSUED" ? documents.clientId : documents.supplierId, query.partyId));
  if (query.documentTypeId) conds.push(eq(documents.documentTypeId, query.documentTypeId));
  if (query.from) conds.push(gte(documents.issueDate, query.from));
  if (query.to) conds.push(lte(documents.issueDate, query.to));
  const debitClass = inArray(documentTypes.class, [...DEBIT_CLASSES, "INTERNAL_DEBIT", "OPENING_DEBIT"]);
  switch (query.status) {
    case "ACTIVE":
      conds.push(ne(documents.status, "ANNULLED"));
      break;
    case "PENDING":
      conds.push(inArray(documents.status, ["OPEN", "PARTIAL"]));
      break;
    case "OVERDUE":
      conds.push(inArray(documents.status, ["OPEN", "PARTIAL"]), lt(documents.dueDate, today), debitClass);
      break;
    case "PARTIAL":
      conds.push(eq(documents.status, "PARTIAL"));
      break;
    case "SETTLED":
      conds.push(eq(documents.status, "SETTLED"));
      break;
    case "ANNULLED":
      conds.push(eq(documents.status, "ANNULLED"));
      break;
    case "ALL":
      break;
  }
  if (query.q) {
    // "1-123", "00001-00000123", "123" o parte del nombre del tercero.
    const m = query.q.match(/^(\d{1,5})\s*-\s*(\d{1,8})$/);
    if (m) conds.push(eq(documents.pointOfSale, Number(m[1])), eq(documents.number, Number(m[2])));
    else if (/^\d{1,8}$/.test(query.q)) conds.push(eq(documents.number, Number(query.q)));
    else conds.push(ilike(documents.partyName, `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`));
  }
  const where = and(...conds);
  const signed = (col: typeof documents.total | typeof documents.balance) =>
    sql<string>`coalesce(sum(CASE WHEN ${documentTypes.class} IN ('CREDIT_NOTE','OPENING_CREDIT') THEN -${col} ELSE ${col} END) FILTER (WHERE ${documents.status} <> 'ANNULLED'), 0)::text`;
  const [summary] = await db
    .select({ count: count(), total: signed(documents.total), balance: signed(documents.balance) })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .where(where);
  const rows = await db
    .select({
      id: documents.id,
      issueDate: documents.issueDate,
      dueDate: documents.dueDate,
      typeName: documentTypes.name,
      letter: documentTypes.letter,
      documentClass: documentTypes.class,
      pointOfSale: documents.pointOfSale,
      number: documents.number,
      partyId: direction === "ISSUED" ? documents.clientId : documents.supplierId,
      partyName: documents.partyName,
      partyTaxId: documents.partyTaxId,
      total: documents.total,
      balance: documents.balance,
      status: documents.status,
      direction: documents.direction,
      currency: documents.currency,
    })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .where(where)
    .orderBy(desc(documents.issueDate), desc(documents.id))
    .limit(PAGE_SIZE)
    .offset((query.page - 1) * PAGE_SIZE);
  return {
    rows,
    total: summary?.count ?? 0,
    sumTotal: summary?.total ?? "0",
    sumBalance: summary?.balance ?? "0",
    page: query.page,
    pageSize: PAGE_SIZE,
    today,
  };
}

/** Comprobantes del tercero que una NC o ND puede vincular (facturas y ND vigentes). */
export async function linkableDocuments(db: Db, ctx: ServiceContext, direction: Direction, partyId: number) {
  assertPermission(ctx, "documents.read");
  return db
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
        inArray(documentTypes.class, [...DEBIT_CLASSES]),
      ),
    )
    .orderBy(desc(documents.issueDate), desc(documents.id))
    .limit(200);
}

/** Terceros activos para elegir en el formulario. */
export async function partyOptions(db: Db, ctx: ServiceContext, direction: Direction) {
  assertPermission(ctx, "documents.read");
  const t = direction === "ISSUED" ? clients : suppliers;
  return db
    .select({ id: t.id, code: t.code, legalName: t.legalName, taxId: t.taxId, creditDays: t.creditDays, vatConditionId: t.vatConditionId })
    .from(t)
    .where(eq(t.status, "ACTIVE"))
    .orderBy(asc(sql`lower(${t.legalName})`));
}
