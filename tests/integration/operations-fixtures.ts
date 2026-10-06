import { randomUUID } from "node:crypto";
import { cuitCheckDigit } from "@/lib/cuit";
import { todayIso } from "@/lib/format";
import { registerIssuedDocumentDef, registerReceivedDocumentDef } from "@/modules/documents/action-defs";
import { registerOpeningDef } from "@/modules/treasury/action-defs";
import { registerCollectionDef } from "@/modules/collections/action-defs";
import { registerPaymentDef } from "@/modules/payments/action-defs";
import { executeAction, type ActionDef } from "@/server/action";
import type { ServiceContext } from "@/server/context";
import { docType, nextSeq, q1 } from "../db/helpers";
import { ctxWithRoles, db, meta } from "./helpers";

/** Utilidades compartidas por las pruebas de cobranzas, pagos, imputaciones y cheques (Hito 6). */

export const run = (ctx: ServiceContext, def: ActionDef<never, unknown> | ActionDef, input: Record<string, unknown>) =>
  executeAction(db, { ctx, mustChangePassword: false }, meta(), def as ActionDef, input);

export const ok = <T = { id: number }>(r: { ok: boolean }) => {
  if (!r.ok) throw new Error(`Se esperaba éxito: ${JSON.stringify(r)}`);
  return (r as { ok: true; data: T }).data;
};

export const fail = (r: { ok: boolean }) => {
  if (r.ok) throw new Error(`Se esperaba un rechazo: ${JSON.stringify(r)}`);
  return r as { ok: false; error: string; fieldErrors?: Record<string, string[]> };
};

/** Todos los mensajes de un rechazo (error general + errores por campo), para buscar texto. */
export const messages = (r: { ok: boolean }) => {
  const f = fail(r);
  return [f.error, ...Object.values(f.fieldErrors ?? {}).flat()].join(" | ");
};

export const today = todayIso();
export const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const contexts = new Map<string, Promise<ServiceContext>>();
const ctxFor = (role: "ADMIN" | "ADMINISTRACION" | "TESORERIA" | "CONSULTA") => {
  if (!contexts.has(role)) contexts.set(role, ctxWithRoles([role]).then((r) => r.ctx));
  return contexts.get(role)!;
};
export const admin = () => ctxFor("ADMIN");
export const administration = () => ctxFor("ADMINISTRACION");
export const treasury = () => ctxFor("TESORERIA");
export const reader = () => ctxFor("CONSULTA");

/** Comprobante por un total exacto (importe no gravado), registrado como desde la interfaz. */
export async function documentFor(
  direction: "ISSUED" | "RECEIVED",
  partyId: number,
  total: string,
  opts: { type?: string; issue?: string; due?: string; related?: number[] } = {},
) {
  const issue = opts.issue ?? addDays(today, -10);
  const type = opts.type ?? (direction === "ISSUED" ? "FA" : "FC");
  const input: Record<string, unknown> = {
    idempotencyKey: randomUUID(),
    documentTypeId: String(await docType(type)),
    pointOfSale: "9",
    number: String(nextSeq()),
    partyId: String(partyId),
    issueDate: issue,
    dueDate: opts.due ?? addDays(issue, 30),
    concept: "PRODUCTS",
    netUntaxed: total,
  };
  if (direction === "RECEIVED") input.vatPeriod = issue.slice(0, 7);
  if (opts.related) {
    input.reason = "Ajuste comercial";
    input.relatedDocumentIds = opts.related.map(String);
  }
  const def = direction === "ISSUED" ? registerIssuedDocumentDef : registerReceivedDocumentDef;
  return ok(await run(await administration(), def, input)).id;
}

export async function openingBalance(account: string, amount: string) {
  ok(await run(await admin(), registerOpeningDef, { idempotencyKey: randomUUID(), account, date: addDays(today, -60), amount }));
}

export type Line = Record<string, unknown>;
export const cashLine = (cashBoxId: number, amount: string): Line => ({ method: "CASH", amount, cashBoxId });
export const transferLine = (bankAccountId: number, amount: string, reference?: string): Line => ({
  method: "TRANSFER",
  amount,
  bankAccountId,
  transferDate: today,
  transferReference: reference ?? `REF-${nextSeq()}`,
});

let checkSeq = 0;
/** CUIT válida para el librador de un cheque. */
export const drawerCuit = (base = "2012345678") => `${base}${cuitCheckDigit(base)}`;
export const checkLine = async (amount: string, overrides: Record<string, unknown> = {}): Promise<Line> => ({
  method: "CHECK",
  amount,
  check: {
    format: "PHYSICAL",
    checkType: "COMMON",
    issuerBankId: (await q1<{ id: string }>("SELECT id FROM banks WHERE code = '007'")).id,
    number: `${nextSeq()}${++checkSeq}`,
    drawerTaxId: drawerCuit(),
    drawerName: "Librador S.A.",
    issueDate: addDays(today, -2),
    paymentDate: today,
    ...overrides,
  },
});

export async function collect(
  clientId: number,
  lines: Line[],
  allocations: { documentId: number; amount: string }[] = [],
  extra: Record<string, unknown> = {},
  ctx?: ServiceContext,
) {
  return run(ctx ?? (await treasury()), registerCollectionDef, {
    idempotencyKey: randomUUID(),
    clientId: String(clientId),
    date: today,
    lines: JSON.stringify(lines),
    allocations: JSON.stringify(allocations),
    ...extra,
  });
}

export async function pay(
  supplierId: number,
  lines: Line[],
  allocations: { documentId: number; amount: string }[] = [],
  extra: Record<string, unknown> = {},
  ctx?: ServiceContext,
) {
  return run(ctx ?? (await treasury()), registerPaymentDef, {
    idempotencyKey: randomUUID(),
    supplierId: String(supplierId),
    date: today,
    lines: JSON.stringify(lines),
    allocations: JSON.stringify(allocations),
    ...extra,
  });
}

export const docState = async (id: number) => q1<{ balance: string; status: string }>("SELECT balance, status FROM documents WHERE id = $1", [id]);
export const collectionState = async (id: number) => q1<{ unapplied_amount: string; status: string }>("SELECT unapplied_amount, status FROM collections WHERE id = $1", [id]);
export const paymentState = async (id: number) => q1<{ unapplied_amount: string; status: string }>("SELECT unapplied_amount, status FROM supplier_payments WHERE id = $1", [id]);
export const clientBalance = async (id: number) =>
  (await q1<{ balance: string | null }>("SELECT coalesce((SELECT balance FROM customer_accounts WHERE client_id = $1), 0)::numeric(18,2)::text AS balance", [id])).balance;
export const supplierBalance = async (id: number) =>
  (await q1<{ balance: string | null }>("SELECT coalesce((SELECT balance FROM supplier_accounts WHERE supplier_id = $1), 0)::numeric(18,2)::text AS balance", [id])).balance;
export const treasuryBalance = async (kind: "CASH" | "BANK", id: number) =>
  (await q1<{ balance: string }>("SELECT coalesce((SELECT balance FROM treasury_balances WHERE account_kind = $1 AND account_id = $2), 0)::numeric(18,2)::text AS balance", [kind, id])).balance;
