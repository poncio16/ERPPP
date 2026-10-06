import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { recordAudit } from "@/modules/audit/service";
import { getConfig, lockedUntil } from "@/modules/config/service";
import { DomainError, ValidationError } from "@/lib/errors";
import { formatDate, todayIso } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { pgError } from "@/lib/pg-error";
import { assertPermission } from "@/server/authorization";
import type { ServiceContext } from "@/server/context";
import type { Db, DbOrTx, Tx } from "@/server/db/drizzle";
import { accountTransfers, bankAccounts, banks, cashBoxes, cashClosures, issuedChecks, treasuryConcepts, treasuryMovements, type TreasuryOrigin } from "@/server/db/schema";
import type { Permission } from "@/modules/auth/permissions";
import type { AccountKind, AccountRef, LedgerQuery } from "./schemas";

/**
 * Tesorería: caja y bancos (D.8, G.8, G.9, G.12). Un único libro de movimientos (append-only) y un
 * único punto de escritura, `recordMovement`, que usan todos los módulos. Los saldos no se guardan:
 * surgen de los movimientos. Las correcciones son reversiones.
 */

const READ_PERMISSION: Record<AccountKind, Permission> = { CASH: "cash.read", BANK: "banks.read" };
const MANUAL_PERMISSION: Record<AccountKind, Permission> = { CASH: "cash.manual_movement", BANK: "banks.manual_movement" };
const KIND_LABEL: Record<AccountKind, string> = { CASH: "caja", BANK: "cuenta bancaria" };

/** Estados de cheques propios que todavía no se debitaron (G.9-3: restan del saldo disponible). */
const PENDING_ISSUED_CHECK = ["ISSUED", "DELIVERED", "PRESENTED"] as const;

export interface TreasuryAccount {
  kind: AccountKind;
  id: number;
  name: string;
  currency: string;
  active: boolean;
}

const dmy = (iso: string) => formatDate(iso);

// ───────────────────────────── Lecturas básicas ─────────────────────────────

async function loadAccount(db: DbOrTx, ref: AccountRef, lock = false): Promise<TreasuryAccount> {
  if (ref.kind === "CASH") {
    const q = db.select({ id: cashBoxes.id, name: cashBoxes.name, currency: cashBoxes.currency, active: cashBoxes.active }).from(cashBoxes).where(eq(cashBoxes.id, ref.id));
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw new DomainError("La caja no existe.", "NOT_FOUND");
    return { kind: "CASH", ...row };
  }
  const q = db
    .select({ id: bankAccounts.id, name: bankAccounts.displayName, currency: bankAccounts.currency, active: bankAccounts.active })
    .from(bankAccounts)
    .where(eq(bankAccounts.id, ref.id));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw new DomainError("La cuenta bancaria no existe.", "NOT_FOUND");
  return { kind: "BANK", ...row };
}

const accountColumn = (ref: AccountRef) => (ref.kind === "CASH" ? treasuryMovements.cashBoxId : treasuryMovements.bankAccountId);

/** Saldo = Σ ingresos − Σ egresos, opcionalmente hasta una fecha inclusive. */
export async function accountBalance(db: DbOrTx, ref: AccountRef, upTo?: string): Promise<Decimal> {
  const [row] = await db
    .select({ balance: sql<string>`coalesce(sum(CASE WHEN ${treasuryMovements.direction} = 'IN' THEN ${treasuryMovements.amount} ELSE -${treasuryMovements.amount} END), 0)::text` })
    .from(treasuryMovements)
    .where(and(eq(accountColumn(ref), ref.id), upTo ? sql`${treasuryMovements.movementDate} <= ${upTo}` : undefined));
  return new Decimal(row?.balance ?? 0);
}

export async function lastClosureDate(db: DbOrTx, cashBoxId: number): Promise<string | null> {
  const [row] = await db
    .select({ date: cashClosures.closureDate })
    .from(cashClosures)
    .where(eq(cashClosures.cashBoxId, cashBoxId))
    .orderBy(desc(cashClosures.closureDate))
    .limit(1);
  return row?.date ?? null;
}

async function conceptByCode(db: DbOrTx, code: string) {
  const [c] = await db.select().from(treasuryConcepts).where(eq(treasuryConcepts.code, code));
  if (!c) throw new DomainError(`Falta el concepto de tesorería ${code} en el catálogo.`, "INCONSISTENT");
  return c;
}

// ───────────────────────────── Punto único de escritura ─────────────────────────────

export interface MovementInput {
  account: AccountRef;
  date: string;
  valueDate?: string | null;
  direction: "IN" | "OUT";
  amount: string;
  /** Concepto por id (movimientos manuales) o por código (movimientos automáticos). */
  conceptId?: number;
  conceptCode?: string;
  description: string;
  reference?: string | null;
  originType: TreasuryOrigin;
  accountTransferId?: number;
  cashClosureId?: number;
  collectionLineId?: number;
  paymentLineId?: number;
  checkEventId?: number;
  refundId?: number;
  reversalOfId?: number;
  idempotencyKey?: string;
}

export interface MovementOptions {
  /** El usuario ya confirmó las advertencias (saldo bancario negativo). */
  confirmed?: boolean;
  /** Solo la diferencia de arqueo: se registra con la fecha del cierre que la origina. */
  closureDifference?: boolean;
  /** Reversiones y diferencias de arqueo no se bloquean por saldo negativo de caja. */
  skipNegativeCheck?: boolean;
}

/**
 * Registra un movimiento de tesorería. Debe llamarse dentro de la transacción de la operación que
 * lo origina, con la cuenta ya bloqueada (`lockAccounts`). Valida cuenta activa, período cerrado,
 * cierre de caja y saldo negativo; la base vuelve a controlar unicidad de origen y reversiones.
 */
export async function recordMovement(tx: Tx, ctx: ServiceContext, m: MovementInput, opts: MovementOptions = {}) {
  const account = await loadAccount(tx, m.account);
  const label = KIND_LABEL[m.account.kind];
  if (!account.active && m.originType !== "REVERSAL") throw new DomainError(`La ${label} ${account.name} está inactiva.`);

  const locked = await lockedUntil(tx);
  if (locked && m.date <= locked) {
    throw new ValidationError({ date: [`El período está cerrado hasta el ${dmy(locked)}: no se registran movimientos con fecha anterior.`] });
  }
  if (m.account.kind === "CASH" && !opts.closureDifference) {
    const closed = await lastClosureDate(tx, m.account.id);
    if (closed && m.date <= closed) {
      throw new ValidationError({ date: [`La caja ${account.name} está cerrada hasta el ${dmy(closed)}. Use una fecha posterior.`] });
    }
  }

  if (m.direction === "OUT" && !opts.skipNegativeCheck) {
    const after = (await accountBalance(tx, m.account)).minus(m.amount);
    if (after.isNegative()) {
      if (m.account.kind === "CASH" && !(await getConfig(tx, "cash_allow_negative"))) {
        throw new ValidationError({ amount: [`El egreso deja la caja ${account.name} en negativo (${formatMoney(after)}). Saldo disponible: ${formatMoney(after.plus(m.amount))}.`] });
      }
      if (m.account.kind === "BANK" && !opts.confirmed) {
        throw new DomainError("Revise las advertencias antes de confirmar.", "NEEDS_CONFIRMATION", {
          _warnings: [`La cuenta ${account.name} queda con saldo negativo (${formatMoney(after)}). Confirme solo si hay un descubierto acordado.`],
        });
      }
    }
  }

  const concept = m.conceptId
    ? (await tx.select().from(treasuryConcepts).where(eq(treasuryConcepts.id, m.conceptId)))[0]
    : await conceptByCode(tx, m.conceptCode ?? "REVERSION");
  if (!concept) throw new ValidationError({ conceptId: ["El concepto no existe."] });

  const [row] = await tx
    .insert(treasuryMovements)
    .values({
      accountKind: m.account.kind,
      cashBoxId: m.account.kind === "CASH" ? m.account.id : null,
      bankAccountId: m.account.kind === "BANK" ? m.account.id : null,
      movementDate: m.date,
      valueDate: m.valueDate ?? null,
      direction: m.direction,
      amount: m.amount,
      conceptId: concept.id,
      description: m.description,
      reference: m.reference ?? null,
      originType: m.originType,
      accountTransferId: m.accountTransferId ?? null,
      cashClosureId: m.cashClosureId ?? null,
      collectionLineId: m.collectionLineId ?? null,
      paymentLineId: m.paymentLineId ?? null,
      checkEventId: m.checkEventId ?? null,
      refundId: m.refundId ?? null,
      reversalOfId: m.reversalOfId ?? null,
      idempotencyKey: m.idempotencyKey ?? null,
      createdBy: ctx.userId,
    })
    .returning({ id: treasuryMovements.id });
  return row!.id;
}

/** Bloquea las cuentas en un orden fijo (caja antes que banco, luego por id) para evitar interbloqueos. */
export async function lockAccounts(tx: Tx, refs: AccountRef[]) {
  const sorted = [...refs].sort((a, b) => (a.kind === b.kind ? a.id - b.id : a.kind === "CASH" ? -1 : 1));
  const out: TreasuryAccount[] = [];
  for (const r of sorted) out.push(await loadAccount(tx, r, true));
  return refs.map((r) => out.find((a) => a.kind === r.kind && a.id === r.id)!);
}

/** Revierte un movimiento con su espejo (misma cuenta e importe, dirección opuesta), fechado hoy. */
export async function reverseMovementInTx(tx: Tx, ctx: ServiceContext, movementId: number, reason: string) {
  const [orig] = await tx.select().from(treasuryMovements).where(eq(treasuryMovements.id, movementId));
  if (!orig) throw new DomainError("El movimiento no existe.", "NOT_FOUND");
  if (orig.originType === "REVERSAL") throw new DomainError("No se puede revertir una reversión.");
  const [already] = await tx.select({ id: treasuryMovements.id }).from(treasuryMovements).where(eq(treasuryMovements.reversalOfId, orig.id));
  if (already) throw new DomainError("El movimiento ya fue revertido.");
  const ref: AccountRef = orig.accountKind === "CASH" ? { kind: "CASH", id: orig.cashBoxId! } : { kind: "BANK", id: orig.bankAccountId! };
  return recordMovement(
    tx,
    ctx,
    {
      account: ref,
      date: todayIso(),
      direction: orig.direction === "IN" ? "OUT" : "IN",
      amount: orig.amount,
      conceptCode: "REVERSION",
      description: `Reversión: ${orig.description} — ${reason}`,
      reference: orig.reference,
      originType: "REVERSAL",
      reversalOfId: orig.id,
    },
    { skipNegativeCheck: true },
  );
}

// ───────────────────────────── Cajas y cuentas bancarias ─────────────────────────────

function uniqueViolation(e: unknown, map: Record<string, [string, string]>): never {
  const { code, constraint } = pgError(e);
  const hit = code === "23505" && constraint ? map[constraint] : undefined;
  if (hit) throw new ValidationError({ [hit[0]]: [hit[1]] });
  throw e;
}

export async function createCashBox(db: Db, ctx: ServiceContext, input: { name: string }) {
  assertPermission(ctx, "config.manage");
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(cashBoxes).values({ name: input.name, createdBy: ctx.userId }).returning();
      await recordAudit(tx, ctx, { module: "treasury", action: "create_cash_box", entityType: "cash_box", entityId: row!.id, after: { name: input.name } });
      return { id: row!.id };
    });
  } catch (e) {
    uniqueViolation(e, { ux_cash_boxes_name: ["name", "Ya existe una caja con ese nombre."] });
  }
}

/** Cambia el nombre o el estado de una caja. Solo se desactiva con saldo cero. */
export async function updateCashBox(db: Db, ctx: ServiceContext, input: { id: number; name: string; active: boolean }) {
  assertPermission(ctx, "config.manage");
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(cashBoxes).where(eq(cashBoxes.id, input.id)).for("update");
      if (!before) throw new DomainError("La caja no existe.", "NOT_FOUND");
      if (before.active && !input.active && !(await accountBalance(tx, { kind: "CASH", id: input.id })).isZero()) {
        throw new ValidationError({ active: ["Solo se puede desactivar una caja con saldo cero."] });
      }
      await tx.update(cashBoxes).set({ name: input.name, active: input.active, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(cashBoxes.id, input.id));
      await recordAudit(tx, ctx, {
        module: "treasury",
        action: "update_cash_box",
        entityType: "cash_box",
        entityId: input.id,
        before: { name: before.name, active: before.active },
        after: { name: input.name, active: input.active },
      });
      return { id: input.id };
    });
  } catch (e) {
    uniqueViolation(e, { ux_cash_boxes_name: ["name", "Ya existe una caja con ese nombre."] });
  }
}

export async function createBankAccount(
  db: Db,
  ctx: ServiceContext,
  input: { bankId: number; accountType: "CC" | "CA"; accountNumber: string; cbu: string | null; alias: string | null; displayName: string },
) {
  assertPermission(ctx, "config.manage");
  try {
    return await db.transaction(async (tx) => {
      const [bank] = await tx.select({ id: banks.id, active: banks.active }).from(banks).where(eq(banks.id, input.bankId));
      if (!bank?.active) throw new ValidationError({ bankId: ["Banco inválido."] });
      const [row] = await tx.insert(bankAccounts).values({ ...input, createdBy: ctx.userId }).returning();
      await recordAudit(tx, ctx, { module: "treasury", action: "create_bank_account", entityType: "bank_account", entityId: row!.id, after: input });
      return { id: row!.id };
    });
  } catch (e) {
    uniqueViolation(e, {
      ux_bank_accounts_display_name: ["displayName", "Ya existe una cuenta con ese nombre."],
      ux_bank_accounts_cbu: ["cbu", "Ese CBU ya está cargado en otra cuenta."],
      ux_bank_accounts_number: ["accountNumber", "Esa cuenta ya existe en ese banco."],
    });
  }
}

/** Nombre, alias y estado. Banco, número y CBU identifican la cuenta y no cambian. */
export async function updateBankAccount(db: Db, ctx: ServiceContext, input: { id: number; displayName: string; alias: string | null; active: boolean }) {
  assertPermission(ctx, "config.manage");
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, input.id)).for("update");
      if (!before) throw new DomainError("La cuenta bancaria no existe.", "NOT_FOUND");
      if (before.active && !input.active) {
        if (!(await accountBalance(tx, { kind: "BANK", id: input.id })).isZero()) {
          throw new ValidationError({ active: ["Solo se puede desactivar una cuenta con saldo cero."] });
        }
        const [pending] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(issuedChecks)
          .where(and(eq(issuedChecks.bankAccountId, input.id), inArray(issuedChecks.status, [...PENDING_ISSUED_CHECK])));
        if (pending && pending.n > 0) throw new ValidationError({ active: ["La cuenta tiene cheques propios pendientes de débito."] });
      }
      await tx
        .update(bankAccounts)
        .set({ displayName: input.displayName, alias: input.alias, active: input.active, updatedAt: new Date(), updatedBy: ctx.userId })
        .where(eq(bankAccounts.id, input.id));
      await recordAudit(tx, ctx, {
        module: "treasury",
        action: "update_bank_account",
        entityType: "bank_account",
        entityId: input.id,
        before: { displayName: before.displayName, alias: before.alias, active: before.active },
        after: { displayName: input.displayName, alias: input.alias, active: input.active },
      });
      return { id: input.id };
    });
  } catch (e) {
    uniqueViolation(e, { ux_bank_accounts_display_name: ["displayName", "Ya existe una cuenta con ese nombre."] });
  }
}

// ───────────────────────────── Operaciones ─────────────────────────────

async function byIdempotencyKey(db: DbOrTx, key: string) {
  const [row] = await db.select({ id: treasuryMovements.id }).from(treasuryMovements).where(eq(treasuryMovements.idempotencyKey, key));
  return row ?? null;
}

/** Repite la operación si un doble envío chocó con la clave de idempotencia; si no, relanza. */
async function idempotent<T>(db: Db, run: () => Promise<T>, existing: () => Promise<T | null>, constraint: string): Promise<T> {
  const before = await existing();
  if (before) return before;
  try {
    return await run();
  } catch (e) {
    const err = pgError(e);
    if (err.code === "23505" && err.constraint === constraint) {
      const again = await existing();
      if (again) return again;
    }
    throw e;
  }
}

/** Saldo inicial de una caja o cuenta (uno solo por cuenta). Un saldo bancario deudor es un egreso. */
export async function registerOpening(db: Db, ctx: ServiceContext, input: { idempotencyKey: string; account: AccountRef; date: string; amount: string; overdraft: boolean }) {
  assertPermission(ctx, "treasury.opening");
  if (input.overdraft && input.account.kind === "CASH") throw new ValidationError({ overdraft: ["Una caja no puede tener saldo inicial negativo."] });
  if (input.date > todayIso()) throw new ValidationError({ date: ["El saldo inicial no puede tener fecha futura."] });
  return idempotent(
    db,
    () =>
      db.transaction(async (tx) => {
        const [account] = await lockAccounts(tx, [input.account]);
        const [first] = await tx
          .select({ date: sql<string | null>`min(${treasuryMovements.movementDate})::text`, n: sql<number>`count(*)::int` })
          .from(treasuryMovements)
          .where(eq(accountColumn(input.account), input.account.id));
        if (first && first.n > 0) {
          const [opening] = await tx
            .select({ id: treasuryMovements.id })
            .from(treasuryMovements)
            .where(and(eq(accountColumn(input.account), input.account.id), eq(treasuryMovements.originType, "OPENING")));
          if (opening) throw new DomainError(`La ${KIND_LABEL[input.account.kind]} ya tiene saldo inicial.`, "DUPLICATE");
          if (first.date && input.date > first.date) {
            throw new ValidationError({ date: [`La ${KIND_LABEL[input.account.kind]} ya tiene movimientos desde el ${dmy(first.date)}: el saldo inicial debe tener esa fecha o una anterior.`] });
          }
        }
        const id = await recordMovement(
          tx,
          ctx,
          {
            account: input.account,
            date: input.date,
            direction: input.overdraft ? "OUT" : "IN",
            amount: input.amount,
            conceptCode: "SALDO_INICIAL",
            description: `Saldo inicial${input.overdraft ? " deudor" : ""}`,
            originType: "OPENING",
            idempotencyKey: input.idempotencyKey,
          },
          { confirmed: true, skipNegativeCheck: true },
        );
        await recordAudit(tx, ctx, {
          module: "treasury",
          action: "opening",
          entityType: input.account.kind === "CASH" ? "cash_box" : "bank_account",
          entityId: account!.id,
          after: { movementId: id, date: input.date, amount: input.overdraft ? `-${input.amount}` : input.amount },
        });
        return { id };
      }),
    () => byIdempotencyKey(db, input.idempotencyKey),
    "ux_treasury_movements_idempotency_key",
  ).catch((e: unknown) => {
    const { code, constraint } = pgError(e);
    if (code === "23505" && (constraint === "ux_treasury_opening_cash" || constraint === "ux_treasury_opening_bank")) {
      throw new DomainError(`La ${KIND_LABEL[input.account.kind]} ya tiene saldo inicial.`, "DUPLICATE");
    }
    throw e;
  });
}

/**
 * Movimiento manual (G.8-4, G.9-5): solo con conceptos habilitados y sin tercero; lo que tiene
 * contraparte se registra por su circuito (cobranza, pago o comprobante recibido).
 */
export async function registerManualMovement(
  db: Db,
  ctx: ServiceContext,
  kind: AccountKind,
  input: {
    idempotencyKey: string;
    account: AccountRef;
    date: string;
    valueDate: string | null;
    direction: "IN" | "OUT";
    conceptId: number;
    amount: string;
    description: string;
    reference: string | null;
    confirmWarnings: boolean;
  },
) {
  assertPermission(ctx, MANUAL_PERMISSION[kind]);
  if (input.account.kind !== kind) throw new ValidationError({ account: [`Elija una ${KIND_LABEL[kind]}.`] });
  if (input.date > todayIso()) throw new ValidationError({ date: ["Los movimientos reales no pueden tener fecha futura (use el flujo de fondos para lo proyectado)."] });
  if (input.valueDate && input.valueDate < input.date) throw new ValidationError({ valueDate: ["La fecha valor no puede ser anterior a la fecha del movimiento."] });
  const [concept] = await db.select().from(treasuryConcepts).where(eq(treasuryConcepts.id, input.conceptId));
  if (!concept || !concept.active || !concept.allowsManual) throw new ValidationError({ conceptId: ["Ese concepto no admite movimientos manuales."] });
  if (concept.direction !== "BOTH" && concept.direction !== input.direction) {
    throw new ValidationError({ conceptId: [`"${concept.name}" es un concepto de ${concept.direction === "IN" ? "ingreso" : "egreso"}.`] });
  }
  return idempotent(
    db,
    () =>
      db.transaction(async (tx) => {
        await lockAccounts(tx, [input.account]);
        const id = await recordMovement(
          tx,
          ctx,
          {
            account: input.account,
            date: input.date,
            valueDate: input.valueDate,
            direction: input.direction,
            amount: input.amount,
            conceptId: concept.id,
            description: input.description,
            reference: input.reference,
            originType: "MANUAL",
            idempotencyKey: input.idempotencyKey,
          },
          { confirmed: input.confirmWarnings },
        );
        await recordAudit(tx, ctx, {
          module: "treasury",
          action: "manual_movement",
          entityType: "treasury_movement",
          entityId: id,
          after: { account: input.account, date: input.date, direction: input.direction, concept: concept.code, amount: input.amount, description: input.description },
        });
        return { id };
      }),
    () => byIdempotencyKey(db, input.idempotencyKey),
    "ux_treasury_movements_idempotency_key",
  );
}

/** Revierte un movimiento manual. Los automáticos se revierten anulando su origen. */
export async function reverseManualMovement(db: Db, ctx: ServiceContext, kind: AccountKind, input: { id: number; reason: string }) {
  assertPermission(ctx, MANUAL_PERMISSION[kind]);
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(treasuryMovements).where(eq(treasuryMovements.id, input.id));
    if (!m || m.accountKind !== kind) throw new DomainError("El movimiento no existe.", "NOT_FOUND");
    if (m.originType !== "MANUAL") {
      throw new DomainError("Solo se revierten a mano los movimientos manuales. Los demás se corrigen anulando la operación que los originó.");
    }
    await lockAccounts(tx, [kind === "CASH" ? { kind, id: m.cashBoxId! } : { kind, id: m.bankAccountId! }]);
    const id = await reverseMovementInTx(tx, ctx, m.id, input.reason);
    await recordAudit(tx, ctx, { module: "treasury", action: "reverse_movement", entityType: "treasury_movement", entityId: m.id, after: { reversalId: id, reason: input.reason } });
    return { id };
  });
}

/**
 * Transferencia entre cuentas propias (depósito de efectivo, extracción, entre bancos): un egreso en
 * el origen y un ingreso en el destino, en la misma moneda y la misma transacción.
 */
export async function registerTransfer(
  db: Db,
  ctx: ServiceContext,
  input: { idempotencyKey: string; from: AccountRef; to: AccountRef; date: string; amount: string; description: string | null; confirmWarnings: boolean },
) {
  assertPermission(ctx, "banks.transfer");
  if (input.date > todayIso()) throw new ValidationError({ date: ["La transferencia no puede tener fecha futura."] });
  const existing = async () => {
    const [row] = await db.select({ id: accountTransfers.id }).from(accountTransfers).where(eq(accountTransfers.idempotencyKey, input.idempotencyKey));
    return row ?? null;
  };
  return idempotent(
    db,
    () =>
      db.transaction(async (tx) => {
        const [from, to] = await lockAccounts(tx, [input.from, input.to]);
        if (from!.currency !== to!.currency) throw new ValidationError({ to: [`Las cuentas tienen distinta moneda (${from!.currency} y ${to!.currency}).`] });
        if (!to!.active) throw new ValidationError({ to: [`${to!.name} está inactiva.`] });
        const [t] = await tx
          .insert(accountTransfers)
          .values({
            transferDate: input.date,
            fromCashBoxId: input.from.kind === "CASH" ? input.from.id : null,
            fromBankAccountId: input.from.kind === "BANK" ? input.from.id : null,
            toCashBoxId: input.to.kind === "CASH" ? input.to.id : null,
            toBankAccountId: input.to.kind === "BANK" ? input.to.id : null,
            amount: input.amount,
            description: input.description,
            idempotencyKey: input.idempotencyKey,
            createdBy: ctx.userId,
          })
          .returning({ id: accountTransfers.id });
        const label = input.description ?? `Transferencia de ${from!.name} a ${to!.name}`;
        const common = { date: input.date, amount: input.amount, conceptCode: "TRANSFERENCIA_INTERNA", originType: "ACCOUNT_TRANSFER" as const, accountTransferId: t!.id };
        await recordMovement(tx, ctx, { ...common, account: input.from, direction: "OUT", description: `${label} (a ${to!.name})` }, { confirmed: input.confirmWarnings });
        await recordMovement(tx, ctx, { ...common, account: input.to, direction: "IN", description: `${label} (de ${from!.name})` });
        await recordAudit(tx, ctx, {
          module: "treasury",
          action: "transfer",
          entityType: "account_transfer",
          entityId: t!.id,
          after: { from: input.from, to: input.to, date: input.date, amount: input.amount },
        });
        return { id: t!.id };
      }),
    existing,
    "ux_account_transfers_idempotency_key",
  );
}

/** Anula una transferencia: revierte sus dos movimientos (fechados hoy) y queda en el historial. */
export async function annulTransfer(db: Db, ctx: ServiceContext, input: { id: number; reason: string }) {
  assertPermission(ctx, "banks.transfer");
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(accountTransfers).where(eq(accountTransfers.id, input.id)).for("update");
    if (!t) throw new DomainError("La transferencia no existe.", "NOT_FOUND");
    if (t.status === "ANNULLED") throw new DomainError("La transferencia ya está anulada.");
    const from: AccountRef = t.fromCashBoxId ? { kind: "CASH", id: t.fromCashBoxId } : { kind: "BANK", id: t.fromBankAccountId! };
    const to: AccountRef = t.toCashBoxId ? { kind: "CASH", id: t.toCashBoxId } : { kind: "BANK", id: t.toBankAccountId! };
    await lockAccounts(tx, [from, to]);
    // Anular devuelve el dinero al origen: el destino no puede quedar con caja negativa.
    const [inMove] = await tx
      .select()
      .from(treasuryMovements)
      .where(and(eq(treasuryMovements.accountTransferId, t.id), eq(treasuryMovements.direction, "IN")));
    if (to.kind === "CASH" && !(await getConfig(tx, "cash_allow_negative"))) {
      const after = (await accountBalance(tx, to)).minus(t.amount);
      if (after.isNegative()) throw new DomainError(`No se puede anular: la caja de destino quedaría en negativo (${formatMoney(after)}).`);
    }
    const moves = await tx.select({ id: treasuryMovements.id }).from(treasuryMovements).where(eq(treasuryMovements.accountTransferId, t.id)).orderBy(asc(treasuryMovements.id));
    if (moves.length !== 2 || !inMove) throw new DomainError("La transferencia no tiene sus dos movimientos.", "INCONSISTENT");
    for (const mv of moves) await reverseMovementInTx(tx, ctx, mv.id, `Anulación de transferencia: ${input.reason}`);
    await tx.update(accountTransfers).set({ status: "ANNULLED", annulledAt: new Date(), annulledBy: ctx.userId, annulReason: input.reason, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(accountTransfers.id, t.id));
    await recordAudit(tx, ctx, { module: "treasury", action: "annul_transfer", entityType: "account_transfer", entityId: t.id, after: { reason: input.reason } });
    return { id: t.id };
  });
}

/**
 * Arqueo y cierre de caja (G.8-5): compara el efectivo contado con el saldo del sistema a la fecha.
 * La diferencia (sobrante o faltante) se registra como movimiento, con motivo obligatorio. Después
 * del cierre, la caja no acepta movimientos con fecha igual o anterior.
 */
export async function closeCashBox(
  db: Db,
  ctx: ServiceContext,
  input: { cashBoxId: number; closureDate: string; countedAmount: string; countDetail: Record<string, number> | null; notes: string | null },
) {
  assertPermission(ctx, "cash.close");
  if (input.closureDate > todayIso()) throw new ValidationError({ closureDate: ["No se puede cerrar una fecha futura."] });
  try {
    return await db.transaction(async (tx) => {
      const ref: AccountRef = { kind: "CASH", id: input.cashBoxId };
      const [box] = await lockAccounts(tx, [ref]);
      const last = await lastClosureDate(tx, input.cashBoxId);
      if (last && input.closureDate <= last) throw new ValidationError({ closureDate: [`La caja ya está cerrada hasta el ${dmy(last)}.`] });
      const locked = await lockedUntil(tx);
      if (locked && input.closureDate <= locked) throw new ValidationError({ closureDate: [`El período está cerrado hasta el ${dmy(locked)}.`] });
      const system = await accountBalance(tx, ref, input.closureDate);
      const difference = new Decimal(input.countedAmount).minus(system);
      if (!difference.isZero() && !input.notes) {
        throw new ValidationError({ notes: [`Hay una diferencia de ${formatMoney(difference)}: indique el motivo.`] });
      }
      const [closure] = await tx
        .insert(cashClosures)
        .values({
          cashBoxId: input.cashBoxId,
          closureDate: input.closureDate,
          systemBalance: system.toFixed(2),
          countedAmount: input.countedAmount,
          countDetail: input.countDetail,
          difference: difference.toFixed(2),
          notes: input.notes,
          createdBy: ctx.userId,
        })
        .returning({ id: cashClosures.id });
      let movementId: number | null = null;
      if (!difference.isZero()) {
        movementId = await recordMovement(
          tx,
          ctx,
          {
            account: ref,
            date: input.closureDate,
            direction: difference.isPositive() ? "IN" : "OUT",
            amount: difference.abs().toFixed(2),
            conceptCode: "DIFERENCIA_ARQUEO",
            description: `${difference.isPositive() ? "Sobrante" : "Faltante"} de arqueo del ${dmy(input.closureDate)}: ${input.notes}`,
            originType: "CASH_COUNT_DIFF",
            cashClosureId: closure!.id,
          },
          { closureDifference: true, skipNegativeCheck: true },
        );
      }
      await recordAudit(tx, ctx, {
        module: "treasury",
        action: "cash_close",
        entityType: "cash_box",
        entityId: box!.id,
        after: { closureId: closure!.id, date: input.closureDate, system: system.toFixed(2), counted: input.countedAmount, difference: difference.toFixed(2), movementId },
      });
      return { id: closure!.id, difference: difference.toFixed(2) };
    });
  } catch (e) {
    const { code, constraint } = pgError(e);
    if (code === "23505" && constraint === "ux_cash_closures") throw new ValidationError({ closureDate: ["Esa fecha ya tiene cierre."] });
    throw e;
  }
}

// ───────────────────────────── Consultas ─────────────────────────────

function assertRead(ctx: ServiceContext, kind: AccountKind) {
  assertPermission(ctx, READ_PERMISSION[kind]);
}

export interface AccountOverview extends TreasuryAccount {
  balance: string;
  /** Bancos: saldo contable − cheques propios pendientes de débito (G.9-3). */
  available: string | null;
  pendingChecks: string | null;
  bankName: string | null;
  accountType: string | null;
  accountNumber: string | null;
  cbu: string | null;
  alias: string | null;
  lastClosure: string | null;
  hasOpening: boolean;
  lastMovement: string | null;
}

/** Cajas y cuentas con sus saldos, según los permisos del usuario. */
export async function treasuryOverview(db: DbOrTx, ctx: ServiceContext, kind: AccountKind): Promise<AccountOverview[]> {
  assertRead(ctx, kind);
  if (kind === "CASH") {
    const { rows } = await db.execute<{ id: number; name: string; currency: string; active: boolean; balance: string; last_closure: string | null; has_opening: boolean; last_movement: string | null }>(sql`
      SELECT b.id, b.name, b.currency, b.active,
             coalesce(sum(CASE WHEN m.direction = 'IN' THEN m.amount ELSE -m.amount END), 0)::numeric(18,2)::text AS balance,
             (SELECT max(closure_date)::text FROM cash_closures c WHERE c.cash_box_id = b.id) AS last_closure,
             bool_or(m.origin_type = 'OPENING') IS TRUE AS has_opening,
             max(m.movement_date)::text AS last_movement
        FROM cash_boxes b LEFT JOIN treasury_movements m ON m.cash_box_id = b.id
       GROUP BY b.id ORDER BY b.active DESC, lower(b.name)`);
    return rows.map((r) => ({
      kind: "CASH",
      id: Number(r.id),
      name: r.name,
      currency: r.currency,
      active: r.active,
      balance: r.balance,
      available: null,
      pendingChecks: null,
      bankName: null,
      accountType: null,
      accountNumber: null,
      cbu: null,
      alias: null,
      lastClosure: r.last_closure,
      hasOpening: r.has_opening,
      lastMovement: r.last_movement,
    }));
  }
  const { rows } = await db.execute<{
    id: number;
    name: string;
    currency: string;
    active: boolean;
    balance: string;
    pending: string;
    bank_name: string;
    account_type: string;
    account_number: string;
    cbu: string | null;
    alias: string | null;
    has_opening: boolean;
    last_movement: string | null;
  }>(sql`
    SELECT a.id, a.display_name AS name, a.currency, a.active, k.name AS bank_name, a.account_type, a.account_number, a.cbu, a.alias,
           coalesce((SELECT sum(CASE WHEN m.direction = 'IN' THEN m.amount ELSE -m.amount END) FROM treasury_movements m WHERE m.bank_account_id = a.id), 0)::numeric(18,2)::text AS balance,
           coalesce((SELECT sum(c.amount) FROM issued_checks c WHERE c.bank_account_id = a.id AND c.status IN ('ISSUED','DELIVERED','PRESENTED')), 0)::numeric(18,2)::text AS pending,
           EXISTS (SELECT 1 FROM treasury_movements m WHERE m.bank_account_id = a.id AND m.origin_type = 'OPENING') AS has_opening,
           (SELECT max(m.movement_date)::text FROM treasury_movements m WHERE m.bank_account_id = a.id) AS last_movement
      FROM bank_accounts a JOIN banks k ON k.id = a.bank_id
     ORDER BY a.active DESC, lower(a.display_name)`);
  return rows.map((r) => ({
    kind: "BANK",
    id: Number(r.id),
    name: r.name,
    currency: r.currency,
    active: r.active,
    balance: r.balance,
    pendingChecks: r.pending,
    available: new Decimal(r.balance).minus(r.pending).toFixed(2),
    bankName: r.bank_name,
    accountType: r.account_type,
    accountNumber: r.account_number,
    cbu: r.cbu,
    alias: r.alias,
    lastClosure: null,
    hasOpening: r.has_opening,
    lastMovement: r.last_movement,
  }));
}

export async function getTreasuryAccount(db: DbOrTx, ctx: ServiceContext, ref: AccountRef) {
  assertRead(ctx, ref.kind);
  const all = await treasuryOverview(db, ctx, ref.kind);
  const account = all.find((a) => a.id === ref.id);
  if (!account) throw new DomainError(`La ${KIND_LABEL[ref.kind]} no existe.`, "NOT_FOUND");
  return account;
}

export interface LedgerRow {
  id: number;
  date: string;
  valueDate: string | null;
  direction: "IN" | "OUT";
  amount: string;
  concept: string;
  description: string;
  reference: string | null;
  originType: TreasuryOrigin;
  transferId: number | null;
  closureId: number | null;
  collectionId: number | null;
  paymentId: number | null;
  receivedCheckId: number | null;
  issuedCheckId: number | null;
  refundId: number | null;
  reversalOfId: number | null;
  reversedById: number | null;
  username: string | null;
  balance: string;
}

export function defaultLedgerPeriod(today = todayIso()) {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return { from: d.toISOString().slice(0, 10), to: today };
}

/** Libro de una caja o cuenta: saldo anterior, movimientos del período con saldo progresivo y saldo final. */
export async function accountLedger(db: DbOrTx, ctx: ServiceContext, ref: AccountRef, query: LedgerQuery) {
  assertRead(ctx, ref.kind);
  const { from, to } = { ...defaultLedgerPeriod(), ...Object.fromEntries(Object.entries(query).filter(([, v]) => v)) } as { from: string; to: string };
  const col = sql.raw(ref.kind === "CASH" ? "cash_box_id" : "bank_account_id");
  const [op] = await db
    .select({ v: sql<string>`coalesce(sum(CASE WHEN ${treasuryMovements.direction} = 'IN' THEN ${treasuryMovements.amount} ELSE -${treasuryMovements.amount} END), 0)::text` })
    .from(treasuryMovements)
    .where(and(eq(accountColumn(ref), ref.id), sql`${treasuryMovements.movementDate} < ${from}`));
  const opening = new Decimal(op?.v ?? 0);
  const { rows } = await db.execute<{
    id: number;
    movement_date: string;
    value_date: string | null;
    direction: "IN" | "OUT";
    amount: string;
    concept: string | null;
    description: string;
    reference: string | null;
    origin_type: TreasuryOrigin;
    account_transfer_id: number | null;
    cash_closure_id: number | null;
    collection_id: number | null;
    payment_id: number | null;
    received_check_id: number | null;
    issued_check_id: number | null;
    refund_id: number | null;
    reversal_of_id: number | null;
    reversed_by: number | null;
    username: string | null;
  }>(sql`
    SELECT m.id, m.movement_date::text, m.value_date::text, m.direction, m.amount::text, c.name AS concept, m.description, m.reference,
           m.origin_type, m.account_transfer_id, m.cash_closure_id, cl.collection_id, pl.payment_id, ce.received_check_id, ce.issued_check_id, m.refund_id, m.reversal_of_id,
           r.id AS reversed_by, u.username
      FROM treasury_movements m
      LEFT JOIN treasury_concepts c ON c.id = m.concept_id
      LEFT JOIN collection_lines cl ON cl.id = m.collection_line_id
      LEFT JOIN payment_lines pl ON pl.id = m.payment_line_id
      LEFT JOIN check_events ce ON ce.id = m.check_event_id
      LEFT JOIN treasury_movements r ON r.reversal_of_id = m.id
      LEFT JOIN users u ON u.id = m.created_by
     WHERE m.${col} = ${ref.id} AND m.movement_date BETWEEN ${from} AND ${to}
     ORDER BY m.movement_date, m.id`);
  let running = opening;
  let totalIn = new Decimal(0);
  let totalOut = new Decimal(0);
  const out: LedgerRow[] = rows.map((r) => {
    if (r.direction === "IN") {
      running = running.plus(r.amount);
      totalIn = totalIn.plus(r.amount);
    } else {
      running = running.minus(r.amount);
      totalOut = totalOut.plus(r.amount);
    }
    return {
      id: Number(r.id),
      date: r.movement_date,
      valueDate: r.value_date,
      direction: r.direction,
      amount: new Decimal(r.amount).toFixed(2),
      concept: r.concept ?? "",
      description: r.description,
      reference: r.reference,
      originType: r.origin_type,
      transferId: r.account_transfer_id === null ? null : Number(r.account_transfer_id),
      closureId: r.cash_closure_id === null ? null : Number(r.cash_closure_id),
      collectionId: r.collection_id === null ? null : Number(r.collection_id),
      paymentId: r.payment_id === null ? null : Number(r.payment_id),
      receivedCheckId: r.received_check_id === null ? null : Number(r.received_check_id),
      issuedCheckId: r.issued_check_id === null ? null : Number(r.issued_check_id),
      refundId: r.refund_id === null ? null : Number(r.refund_id),
      reversalOfId: r.reversal_of_id === null ? null : Number(r.reversal_of_id),
      reversedById: r.reversed_by === null ? null : Number(r.reversed_by),
      username: r.username,
      balance: running.toFixed(2),
    };
  });
  return { from, to, opening: opening.toFixed(2), rows: out, totalIn: totalIn.toFixed(2), totalOut: totalOut.toFixed(2), closing: running.toFixed(2) };
}

export async function cashClosureHistory(db: DbOrTx, ctx: ServiceContext, cashBoxId: number) {
  assertRead(ctx, "CASH");
  const { rows } = await db.execute<{ id: number; closure_date: string; system_balance: string; counted_amount: string; difference: string; notes: string | null; username: string | null; created_at: string }>(sql`
    SELECT c.id, c.closure_date::text, c.system_balance::text, c.counted_amount::text, c.difference::text, c.notes, u.username, c.created_at::text
      FROM cash_closures c LEFT JOIN users u ON u.id = c.created_by
     WHERE c.cash_box_id = ${cashBoxId}
     ORDER BY c.closure_date DESC LIMIT 60`);
  return rows.map((r) => ({
    id: Number(r.id),
    date: r.closure_date,
    system: r.system_balance,
    counted: r.counted_amount,
    difference: r.difference,
    notes: r.notes,
    username: r.username,
    createdAt: r.created_at,
  }));
}

export async function listTransfers(db: DbOrTx, ctx: ServiceContext, page = 1, pageSize = 50) {
  assertPermission(ctx, "banks.read");
  const { rows } = await db.execute<{
    id: number;
    transfer_date: string;
    from_name: string;
    to_name: string;
    amount: string;
    description: string | null;
    status: string;
    annul_reason: string | null;
    username: string | null;
  }>(sql`
    SELECT t.id, t.transfer_date::text, coalesce(fc.name, fb.display_name) AS from_name, coalesce(tc.name, tb.display_name) AS to_name,
           t.amount::text, t.description, t.status, t.annul_reason, u.username
      FROM account_transfers t
      LEFT JOIN cash_boxes fc ON fc.id = t.from_cash_box_id
      LEFT JOIN bank_accounts fb ON fb.id = t.from_bank_account_id
      LEFT JOIN cash_boxes tc ON tc.id = t.to_cash_box_id
      LEFT JOIN bank_accounts tb ON tb.id = t.to_bank_account_id
      LEFT JOIN users u ON u.id = t.created_by
     ORDER BY t.transfer_date DESC, t.id DESC
     LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
  const [{ total } = { total: 0 }] = await db.select({ total: sql<number>`count(*)::int` }).from(accountTransfers);
  return {
    rows: rows.map((r) => ({
      id: Number(r.id),
      date: r.transfer_date,
      from: r.from_name,
      to: r.to_name,
      amount: r.amount,
      description: r.description,
      status: r.status,
      annulReason: r.annul_reason,
      username: r.username,
    })),
    total,
    page,
    pageSize,
  };
}

/** Conceptos habilitados para movimientos manuales. */
export async function manualConcepts(db: DbOrTx) {
  return db
    .select({ id: treasuryConcepts.id, name: treasuryConcepts.name, direction: treasuryConcepts.direction })
    .from(treasuryConcepts)
    .where(and(eq(treasuryConcepts.allowsManual, true), eq(treasuryConcepts.active, true)))
    .orderBy(asc(treasuryConcepts.sortOrder), asc(treasuryConcepts.name));
}

/** Cajas y cuentas activas, para elegir origen y destino. */
export async function accountOptions(db: DbOrTx) {
  const [boxes, accounts] = await Promise.all([
    db.select({ id: cashBoxes.id, name: cashBoxes.name, currency: cashBoxes.currency }).from(cashBoxes).where(eq(cashBoxes.active, true)).orderBy(asc(cashBoxes.name)),
    db.select({ id: bankAccounts.id, name: bankAccounts.displayName, currency: bankAccounts.currency }).from(bankAccounts).where(eq(bankAccounts.active, true)).orderBy(asc(bankAccounts.displayName)),
  ]);
  return [...boxes.map((b) => ({ value: `CASH:${b.id}`, label: `Caja · ${b.name}`, currency: b.currency })), ...accounts.map((a) => ({ value: `BANK:${a.id}`, label: `Banco · ${a.name}`, currency: a.currency }))];
}

export async function bankOptions(db: DbOrTx) {
  return db.select({ id: banks.id, name: banks.name, code: banks.code }).from(banks).where(eq(banks.active, true)).orderBy(asc(banks.name));
}
