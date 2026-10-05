import Decimal from "decimal.js";
import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { diffFields, recordAudit } from "@/modules/audit/service";
import type { Permission } from "@/modules/auth/permissions";
import { getConfig } from "@/modules/config/service";
import { nextSequenceNumber, type SequenceKey } from "@/modules/numbering/service";
import { isValidCbu, isValidCbuAlias } from "@/lib/cbu";
import { isValidCuit, normalizeCuit } from "@/lib/cuit";
import { DomainError, ForbiddenError, ValidationError } from "@/lib/errors";
import { assertPermission } from "@/server/authorization";
import type { ServiceContext } from "@/server/context";
import type { Db, DbOrTx, Tx } from "@/server/db/drizzle";
import {
  auditLog,
  banks,
  clients,
  idTypes,
  issuedChecks,
  paymentTerms,
  provinces,
  receivedChecks,
  suppliers,
  vatConditions,
} from "@/server/db/schema";
import type { PartyInput, PartyKind, PartyListQuery } from "./schemas";

/**
 * Clientes y proveedores comparten estructura y reglas (D.3 del diseño); este servicio las
 * implementa una sola vez. Los proveedores agregan rubro, banco, CBU y alias.
 */
interface KindConfig {
  /** Las columnas comunes tienen el mismo nombre en ambas tablas. */
  table: typeof clients;
  module: string;
  entityType: string;
  label: string;
  labelArticle: string;
  sequence: SequenceKey;
  perm: { read: Permission; write: Permission; deactivate: Permission; duplicate: Permission };
}

const KINDS: Record<PartyKind, KindConfig> = {
  client: {
    table: clients,
    module: "clients",
    entityType: "client",
    label: "cliente",
    labelArticle: "un cliente",
    sequence: "CLIENT_CODE",
    perm: {
      read: "clients.read",
      write: "clients.write",
      deactivate: "clients.deactivate",
      duplicate: "clients.duplicate_tax_id",
    },
  },
  supplier: {
    table: suppliers as unknown as typeof clients,
    module: "suppliers",
    entityType: "supplier",
    label: "proveedor",
    labelArticle: "un proveedor",
    sequence: "SUPPLIER_CODE",
    perm: {
      read: "suppliers.read",
      write: "suppliers.write",
      deactivate: "suppliers.deactivate",
      duplicate: "suppliers.duplicate_tax_id",
    },
  },
};

export const PAGE_SIZE = 50;

// ─────────────────────────────── Consultas ───────────────────────────────

export interface PartyListRow {
  id: number;
  code: string;
  legalName: string;
  taxId: string | null;
  idTypeCode: string;
  vatCondition: string;
  city: string | null;
  province: string | null;
  phone: string | null;
  status: string;
  balance: string;
}

function balanceExpr(kind: PartyKind, partyId: SQL | number) {
  return kind === "client"
    ? sql<string>`(SELECT balance::text FROM customer_accounts WHERE client_id = ${partyId})`
    : sql<string>`(SELECT balance::text FROM supplier_accounts WHERE supplier_id = ${partyId})`;
}

export async function listParties(db: Db, ctx: ServiceContext, kind: PartyKind, query: PartyListQuery) {
  const k = KINDS[kind];
  assertPermission(ctx, k.perm.read);
  const t = k.table;
  const filters: SQL[] = [];
  if (query.status !== "ALL") filters.push(eq(t.status, query.status));
  if (query.vatConditionId) filters.push(eq(t.vatConditionId, query.vatConditionId));
  if (query.provinceId) filters.push(eq(t.provinceId, query.provinceId));
  if (query.q) {
    const term = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const digits = query.q.replace(/\D/g, "");
    const parts = [ilike(t.legalName, term), ilike(t.code, term), ilike(t.contactName, term)];
    if (digits.length >= 3) parts.push(ilike(t.taxId, `%${digits}%`));
    filters.push(or(...parts)!);
  }
  const where = filters.length ? and(...filters) : undefined;
  const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(t).where(where);
  const rows = await db
    .select({
      id: t.id,
      code: t.code,
      legalName: t.legalName,
      taxId: t.taxId,
      idTypeCode: idTypes.code,
      vatCondition: vatConditions.name,
      city: t.city,
      province: provinces.name,
      phone: t.phone,
      status: t.status,
      balance: balanceExpr(kind, t.id as unknown as SQL),
    })
    .from(t)
    .innerJoin(idTypes, eq(idTypes.id, t.idTypeId))
    .innerJoin(vatConditions, eq(vatConditions.id, t.vatConditionId))
    .leftJoin(provinces, eq(provinces.id, t.provinceId))
    .where(where)
    .orderBy(asc(sql`lower(${t.legalName})`), asc(t.id))
    .limit(PAGE_SIZE)
    .offset((query.page - 1) * PAGE_SIZE);
  return { rows: rows as PartyListRow[], total, page: query.page, pageSize: PAGE_SIZE };
}

export async function getParty(db: DbOrTx, ctx: ServiceContext, kind: PartyKind, id: number) {
  const k = KINDS[kind];
  assertPermission(ctx, k.perm.read);
  if (kind === "client") {
    const [row] = await db.select().from(clients).where(eq(clients.id, id));
    if (!row) throw new DomainError("El cliente no existe.", "NOT_FOUND");
    return { ...row, activity: null, bankId: null, cbu: null, cbuAlias: null, balance: await partyBalance(db, kind, id) };
  }
  const [row] = await db.select().from(suppliers).where(eq(suppliers.id, id));
  if (!row) throw new DomainError("El proveedor no existe.", "NOT_FOUND");
  return { ...row, balance: await partyBalance(db, kind, id) };
}
export type PartyDetail = Awaited<ReturnType<typeof getParty>>;

async function partyBalance(db: DbOrTx, kind: PartyKind, id: number): Promise<string> {
  const { rows } = await db.execute<{ balance: string | null }>(sql`SELECT ${balanceExpr(kind, id)} AS balance`);
  return rows[0]?.balance ?? "0.00";
}

/** Historial del registro (alta, modificaciones, bajas), tomado de la auditoría. */
export async function partyHistory(db: Db, ctx: ServiceContext, kind: PartyKind, id: number) {
  const k = KINDS[kind];
  assertPermission(ctx, k.perm.read);
  return db
    .select({
      id: auditLog.id,
      occurredAt: auditLog.occurredAt,
      username: auditLog.username,
      action: auditLog.action,
      before: auditLog.before,
      after: auditLog.after,
      message: auditLog.message,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityType, k.entityType),
        eq(auditLog.entityId, String(id)),
        eq(auditLog.result, "SUCCESS"),
      ),
    )
    .orderBy(desc(auditLog.id))
    .limit(200);
}

/** Catálogos para los formularios (solo valores activos). */
export async function partyFormCatalogs(db: Db) {
  const [vat, ids, provs, terms, bankList] = await Promise.all([
    db.select({ id: vatConditions.id, name: vatConditions.name }).from(vatConditions).where(eq(vatConditions.active, true)).orderBy(asc(vatConditions.sortOrder), asc(vatConditions.name)),
    db.select({ id: idTypes.id, name: idTypes.name, code: idTypes.code, requiresCuit: idTypes.requiresCuit }).from(idTypes).where(eq(idTypes.active, true)).orderBy(asc(idTypes.sortOrder), asc(idTypes.id)),
    db.select({ id: provinces.id, name: provinces.name }).from(provinces).where(eq(provinces.active, true)).orderBy(asc(provinces.name)),
    db.select({ id: paymentTerms.id, name: paymentTerms.name, days: paymentTerms.days }).from(paymentTerms).where(eq(paymentTerms.active, true)).orderBy(asc(paymentTerms.sortOrder), asc(paymentTerms.days)),
    db.select({ id: banks.id, name: banks.name }).from(banks).where(eq(banks.active, true)).orderBy(asc(banks.name)),
  ]);
  return { vatConditions: vat, idTypes: ids, provinces: provs, paymentTerms: terms, banks: bankList };
}
export type PartyFormCatalogs = Awaited<ReturnType<typeof partyFormCatalogs>>;

// ─────────────────────────────── Validaciones ───────────────────────────────

/** Normaliza y valida identificación, catálogos y datos bancarios. Devuelve el tax_id a guardar. */
async function validateParty(tx: DbOrTx, kind: PartyKind, input: PartyInput): Promise<{ taxId: string | null }> {
  const errors: Record<string, string[]> = {};
  const [idType] = await tx.select().from(idTypes).where(eq(idTypes.id, input.idTypeId));
  if (!idType || !idType.active) errors.idTypeId = ["Tipo de identificación inexistente o inactivo."];

  let taxId = input.taxId;
  if (idType) {
    if (idType.requiresCuit) {
      taxId = taxId ? normalizeCuit(taxId) : null;
      if (!taxId) errors.taxId = [`Ingrese el número de ${idType.name}.`];
      else if (!isValidCuit(taxId)) errors.taxId = [`${idType.name} inválida: revise los 11 dígitos y el dígito verificador.`];
    } else if (idType.code === "DNI") {
      taxId = taxId ? taxId.replace(/[\s.]/g, "") : null;
      if (taxId && !/^\d{7,8}$/.test(taxId)) errors.taxId = ["El DNI debe tener 7 u 8 dígitos."];
    } else if (idType.code === "SIN") {
      if (taxId) errors.taxId = ["Con «Sin identificar» no se carga número."];
      taxId = null;
    } else if (taxId) {
      taxId = taxId.toUpperCase().replace(/\s/g, "");
      if (!/^[0-9A-Z-]{1,20}$/.test(taxId)) errors.taxId = ["Solo letras, números y guiones (hasta 20)."];
    }
  }

  const checks: [string, Promise<{ active: boolean }[]>, number | null][] = [
    ["vatConditionId", tx.select({ active: vatConditions.active }).from(vatConditions).where(eq(vatConditions.id, input.vatConditionId)), input.vatConditionId],
    ["provinceId", input.provinceId ? tx.select({ active: provinces.active }).from(provinces).where(eq(provinces.id, input.provinceId)) : Promise.resolve([]), input.provinceId],
    ["paymentTermId", input.paymentTermId ? tx.select({ active: paymentTerms.active }).from(paymentTerms).where(eq(paymentTerms.id, input.paymentTermId)) : Promise.resolve([]), input.paymentTermId],
  ];
  if (kind === "supplier") {
    checks.push(["bankId", input.bankId ? tx.select({ active: banks.active }).from(banks).where(eq(banks.id, input.bankId)) : Promise.resolve([]), input.bankId ?? null]);
  }
  for (const [field, query, value] of checks) {
    if (value === null) continue;
    const [row] = await query;
    if (!row?.active) errors[field] = ["Valor inexistente o inactivo."];
  }

  if (kind === "supplier") {
    if (input.cbu && !isValidCbu(input.cbu)) errors.cbu = ["CBU inválido: deben ser 22 dígitos con sus dígitos verificadores."];
    if (input.cbuAlias && !isValidCbuAlias(input.cbuAlias)) errors.cbuAlias = ["Alias inválido: de 6 a 20 letras, números, punto o guion."];
  }

  if (Object.keys(errors).length) throw new ValidationError(errors);
  return { taxId };
}

/**
 * Regla de CUIT duplicado (D.3): un solo registro "normal" por número. Un segundo registro exige
 * motivo, que el parámetro allow_duplicate_tax_id esté habilitado y el permiso *.duplicate_tax_id.
 * Devuelve el motivo a guardar (NULL si no hay duplicado).
 */
async function resolveDuplicateTaxId(
  tx: Tx,
  ctx: ServiceContext,
  kind: PartyKind,
  taxId: string | null,
  reason: string | null,
  selfId?: number,
): Promise<string | null> {
  if (!taxId) return null;
  const k = KINDS[kind];
  const t = k.table;
  const others = await tx
    .select({ id: t.id, code: t.code, legalName: t.legalName, status: t.status })
    .from(t)
    .where(selfId ? and(eq(t.taxId, taxId), ne(t.id, selfId)) : eq(t.taxId, taxId))
    .orderBy(asc(t.id));
  if (others.length === 0) return null;
  const first = others[0]!;
  const existing = `${first.code} · ${first.legalName}${first.status === "INACTIVE" ? " (dado de baja)" : ""}`;
  if (!reason) {
    throw new DomainError(
      `Ya existe ${k.labelArticle} con ese número: ${existing}.`,
      "DUPLICATE_TAX_ID",
      {
        taxId: [
          `Ya existe ${k.labelArticle} con ese número: ${existing}. Si de verdad corresponde un segundo registro (por ejemplo, una sucursal con cuenta separada), indique el motivo.`,
        ],
      },
    );
  }
  if (!(await getConfig(tx, "allow_duplicate_tax_id"))) {
    throw new ValidationError(
      { taxId: [`Ya existe ${k.labelArticle} con ese número (${existing}) y la configuración no permite duplicados.`] },
    );
  }
  if (!ctx.permissions.has(k.perm.duplicate)) throw new ForbiddenError(k.perm.duplicate);
  return reason;
}

function commonValues(input: PartyInput, taxId: string | null, duplicateTaxIdReason: string | null) {
  return {
    legalName: input.legalName,
    idTypeId: input.idTypeId,
    taxId,
    vatConditionId: input.vatConditionId,
    address: input.address,
    city: input.city,
    provinceId: input.provinceId,
    postalCode: input.postalCode,
    phone: input.phone,
    email: input.email,
    contactName: input.contactName,
    paymentTermId: input.paymentTermId,
    creditDays: input.creditDays,
    creditLimit: input.creditLimit,
    notes: input.notes,
    duplicateTaxIdReason,
  };
}

function supplierValues(input: PartyInput) {
  return { activity: input.activity ?? null, bankId: input.bankId ?? null, cbu: input.cbu ?? null, cbuAlias: input.cbuAlias ?? null };
}

// ─────────────────────────────── Operaciones ───────────────────────────────

export async function createParty(db: Db, ctx: ServiceContext, kind: PartyKind, input: PartyInput) {
  const k = KINDS[kind];
  assertPermission(ctx, k.perm.write);
  return db.transaction(async (tx) => {
    const { taxId } = await validateParty(tx, kind, input);
    // Serializa altas con el mismo número para que el control de duplicados no tenga carreras.
    if (taxId) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${kind}:${taxId}`}))`);
    const duplicateReason = await resolveDuplicateTaxId(tx, ctx, kind, taxId, input.duplicateTaxIdReason);
    const code = await nextSequenceNumber(tx, k.sequence);
    const values = { ...commonValues(input, taxId, duplicateReason), code, createdBy: ctx.userId };
    const [row] =
      kind === "client"
        ? await tx.insert(clients).values(values).returning({ id: clients.id })
        : await tx.insert(suppliers).values({ ...values, ...supplierValues(input) }).returning({ id: suppliers.id });
    const after = kind === "client" ? values : { ...values, ...supplierValues(input) };
    await recordAudit(tx, ctx, {
      module: k.module,
      action: "create",
      entityType: k.entityType,
      entityId: row!.id,
      after,
      message: duplicateReason ? `CUIT duplicado autorizado: ${duplicateReason}` : undefined,
    });
    return { id: row!.id, code };
  });
}

export async function updateParty(
  db: Db,
  ctx: ServiceContext,
  kind: PartyKind,
  input: PartyInput & { id: number; version: number },
) {
  const k = KINDS[kind];
  assertPermission(ctx, k.perm.write);
  return db.transaction(async (tx) => {
    const current = await getParty(tx, ctx, kind, input.id);
    const { taxId } = await validateParty(tx, kind, input);
    let duplicateReason = current.duplicateTaxIdReason;
    if (taxId !== current.taxId) {
      if (taxId) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${kind}:${taxId}`}))`);
      duplicateReason = await resolveDuplicateTaxId(tx, ctx, kind, taxId, input.duplicateTaxIdReason, input.id);
    }
    const values = {
      ...commonValues(input, taxId, duplicateReason),
      ...(kind === "supplier" ? supplierValues(input) : {}),
    };
    const t = k.table;
    const set = { ...values, updatedAt: new Date(), updatedBy: ctx.userId, version: sql`${t.version} + 1` };
    const updated =
      kind === "client"
        ? await tx.update(clients).set(set).where(and(eq(clients.id, input.id), eq(clients.version, input.version))).returning({ id: clients.id })
        : await tx.update(suppliers).set(set).where(and(eq(suppliers.id, input.id), eq(suppliers.version, input.version))).returning({ id: suppliers.id });
    if (updated.length === 0) {
      throw new DomainError(`Otro usuario modificó este ${k.label} mientras lo editaba. Recargue la página y repita los cambios.`, "CONFLICT");
    }
    const diff = diffFields(current as unknown as Record<string, unknown>, values);
    if (diff) {
      await recordAudit(tx, ctx, { module: k.module, action: "update", entityType: k.entityType, entityId: input.id, ...diff });
    }
    return { id: input.id, changed: diff !== null };
  });
}

/**
 * Baja lógica: no borra nada, solo impide operaciones nuevas. No se permite con saldo distinto
 * de cero ni con cheques del tercero todavía en circulación.
 */
export async function deactivateParty(
  db: Db,
  ctx: ServiceContext,
  kind: PartyKind,
  input: { id: number; version: number; reason: string },
) {
  const k = KINDS[kind];
  assertPermission(ctx, k.perm.deactivate);
  await db.transaction(async (tx) => {
    const t = k.table;
    const [locked] = await tx.select({ id: t.id, status: t.status, version: t.version }).from(t).where(eq(t.id, input.id)).for("update");
    if (!locked) throw new DomainError(`El ${k.label} no existe.`, "NOT_FOUND");
    if (locked.status === "INACTIVE") throw new DomainError(`El ${k.label} ya está dado de baja.`);
    if (locked.version !== input.version) {
      throw new DomainError(`Otro usuario modificó este ${k.label}. Recargue la página.`, "CONFLICT");
    }
    const balance = await partyBalance(tx, kind, input.id);
    if (!new Decimal(balance).isZero()) {
      throw new DomainError(
        `No se puede dar de baja: la cuenta corriente tiene saldo ${balance.startsWith("-") ? "a favor" : "pendiente"} ($ ${balance.replace("-", "")}). Debe quedar en cero.`,
        "HAS_BALANCE",
      );
    }
    const [{ checks } = { checks: 0 }] =
      kind === "client"
        ? await tx.select({ checks: count() }).from(receivedChecks).where(and(eq(receivedChecks.clientId, input.id), inArray(receivedChecks.status, ["IN_PORTFOLIO", "DEPOSITED"])))
        : await tx.select({ checks: count() }).from(issuedChecks).where(and(eq(issuedChecks.supplierId, input.id), inArray(issuedChecks.status, ["ISSUED", "DELIVERED", "PRESENTED"])));
    if (checks > 0) {
      throw new DomainError(`No se puede dar de baja: tiene ${checks} cheque(s) todavía en circulación.`, "HAS_CHECKS");
    }
    const set = {
      status: "INACTIVE",
      deactivatedAt: new Date(),
      deactivatedBy: ctx.userId,
      deactivationReason: input.reason,
      updatedAt: new Date(),
      updatedBy: ctx.userId,
      version: sql`${t.version} + 1`,
    };
    if (kind === "client") await tx.update(clients).set(set).where(eq(clients.id, input.id));
    else await tx.update(suppliers).set(set).where(eq(suppliers.id, input.id));
    await recordAudit(tx, ctx, {
      module: k.module,
      action: "deactivate",
      entityType: k.entityType,
      entityId: input.id,
      before: { status: "ACTIVE" },
      after: { status: "INACTIVE", reason: input.reason },
    });
  });
}

export async function reactivateParty(db: Db, ctx: ServiceContext, kind: PartyKind, input: { id: number; version: number }) {
  const k = KINDS[kind];
  assertPermission(ctx, k.perm.deactivate);
  await db.transaction(async (tx) => {
    const t = k.table;
    const set = {
      status: "ACTIVE",
      deactivatedAt: null,
      deactivatedBy: null,
      deactivationReason: null,
      updatedAt: new Date(),
      updatedBy: ctx.userId,
      version: sql`${t.version} + 1`,
    };
    const where = and(eq(t.id, input.id), eq(t.version, input.version), eq(t.status, "INACTIVE"));
    const updated =
      kind === "client"
        ? await tx.update(clients).set(set).where(where).returning({ id: clients.id })
        : await tx.update(suppliers).set(set).where(where).returning({ id: suppliers.id });
    if (updated.length === 0) {
      throw new DomainError(`El ${k.label} no está dado de baja o fue modificado por otro usuario. Recargue la página.`, "CONFLICT");
    }
    await recordAudit(tx, ctx, {
      module: k.module,
      action: "reactivate",
      entityType: k.entityType,
      entityId: input.id,
      before: { status: "INACTIVE" },
      after: { status: "ACTIVE" },
    });
  });
}
