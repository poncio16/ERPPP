import { z } from "zod";
import { isValidCbu, isValidCbuAlias, normalizeCbu } from "@/lib/cbu";
import { parseAmount, toMoneyString } from "@/lib/money";

export const ACCOUNT_KINDS = ["CASH", "BANK"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

const isoDate = (message = "Fecha inválida.") => z.string({ error: message }).regex(/^\d{4}-\d{2}-\d{2}$/, { error: message });
const id = (message: string) => z.coerce.number({ error: message }).int({ error: message }).positive({ error: message });
const idempotencyKey = z.uuid({ error: "Falta la clave de la operación; recargue la página." });
const flag = z
  .string()
  .optional()
  .transform((v) => v === "1");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Máximo ${max} caracteres.` })
    .optional()
    .transform((v) => (v ? v : null));

/** Importe positivo con hasta 2 decimales ("1.500,50"). Se devuelve como texto exacto. */
const positiveAmount = (label = "Importe") =>
  z.string({ error: `Ingrese ${label.toLowerCase()}.` }).transform((v, ctx) => {
    const d = parseAmount(v);
    const s = d && d.isPositive() && !d.isZero() ? toMoneyString(d) : null;
    if (s === null) {
      ctx.addIssue({ code: "custom", message: `${label} inválido: mayor que cero y con hasta 2 decimales.` });
      return z.NEVER;
    }
    return s;
  });

/** Importe ≥ 0 (arqueo: el efectivo contado puede ser cero). */
const nonNegativeAmount = (label: string) =>
  z.string({ error: `Ingrese ${label.toLowerCase()}.` }).transform((v, ctx) => {
    const d = parseAmount(v);
    const s = d && !d.isNegative() ? toMoneyString(d) : null;
    if (s === null) {
      ctx.addIssue({ code: "custom", message: `${label} inválido (sin signo, hasta 2 decimales).` });
      return z.NEVER;
    }
    return s;
  });

/** Cuenta de tesorería elegida en un formulario: "CASH:3" o "BANK:5". */
export const accountRef = (message = "Elija la caja o cuenta bancaria.") =>
  z.string({ error: message }).transform((v, ctx) => {
    const m = /^(CASH|BANK):(\d+)$/.exec(v);
    if (!m) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return { kind: m[1] as AccountKind, id: Number(m[2]) };
  });
export type AccountRef = { kind: AccountKind; id: number };

export const CashBoxSchema = z.object({
  name: z.string().trim().min(2, { error: "Ingrese el nombre de la caja." }).max(80),
});

export const UpdateCashBoxSchema = CashBoxSchema.extend({
  id: id("Caja inválida."),
  active: flag,
});

export const BankAccountSchema = z
  .object({
    bankId: id("Elija el banco."),
    accountType: z.enum(["CC", "CA"], { error: "Elija el tipo de cuenta." }),
    accountNumber: z.string().trim().min(1, { error: "Ingrese el número de cuenta." }).max(40),
    cbu: z
      .string()
      .optional()
      .transform((v) => (v ? normalizeCbu(v) : null)),
    alias: optionalText(20),
    displayName: z.string().trim().min(2, { error: "Ingrese un nombre para identificar la cuenta." }).max(80),
  })
  .superRefine((v, ctx) => {
    if (v.cbu && !isValidCbu(v.cbu)) ctx.addIssue({ code: "custom", path: ["cbu"], message: "CBU inválido (22 dígitos con dígitos verificadores)." });
    if (v.alias && !isValidCbuAlias(v.alias)) ctx.addIssue({ code: "custom", path: ["alias"], message: "Alias inválido (6 a 20 caracteres: letras, números, punto o guion)." });
  });

export const UpdateBankAccountSchema = z.object({
  id: id("Cuenta inválida."),
  displayName: z.string().trim().min(2, { error: "Ingrese un nombre para identificar la cuenta." }).max(80),
  alias: optionalText(20),
  active: flag,
});

/** Saldo inicial (uno por caja o cuenta, D.8). En bancos puede ser deudor (descubierto). */
export const OpeningSchema = z.object({
  idempotencyKey,
  account: accountRef(),
  date: isoDate("Ingrese la fecha del saldo inicial."),
  amount: positiveAmount("El saldo inicial"),
  overdraft: flag,
});

export const ManualMovementSchema = z.object({
  idempotencyKey,
  account: accountRef(),
  date: isoDate("Ingrese la fecha."),
  valueDate: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(isoDate().nullable()),
  direction: z.enum(["IN", "OUT"], { error: "Elija ingreso o egreso." }),
  conceptId: id("Elija el concepto."),
  amount: positiveAmount(),
  description: z.string().trim().min(3, { error: "Describa el movimiento." }).max(300),
  reference: optionalText(100),
  confirmWarnings: flag,
});

export const ReverseMovementSchema = z.object({
  id: id("Movimiento inválido."),
  reason: z.string().trim().min(5, { error: "Indique el motivo (al menos 5 caracteres)." }).max(300),
});

export const TransferSchema = z
  .object({
    idempotencyKey,
    from: accountRef("Elija la cuenta de origen."),
    to: accountRef("Elija la cuenta de destino."),
    date: isoDate("Ingrese la fecha."),
    amount: positiveAmount(),
    description: optionalText(300),
    confirmWarnings: flag,
  })
  .superRefine((v, ctx) => {
    if (v.from.kind === v.to.kind && v.from.id === v.to.id) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "El origen y el destino deben ser distintos." });
    }
  });

export const AnnulTransferSchema = z.object({
  id: id("Transferencia inválida."),
  reason: z.string().trim().min(5, { error: "Indique el motivo (al menos 5 caracteres)." }).max(300),
});

/** Detalle opcional del arqueo: cantidad por denominación. */
const countDetail = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    try {
      const parsed = z.record(z.string().regex(/^\d+(\.\d{1,2})?$/), z.number().int().min(0).max(1_000_000)).parse(JSON.parse(v));
      return Object.keys(parsed).length ? parsed : null;
    } catch {
      ctx.addIssue({ code: "custom", message: "Detalle de billetes inválido." });
      return z.NEVER;
    }
  });

export const CashClosureSchema = z.object({
  cashBoxId: id("Caja inválida."),
  closureDate: isoDate("Ingrese la fecha del cierre."),
  countedAmount: nonNegativeAmount("El efectivo contado"),
  countDetail,
  notes: optionalText(500),
});

export const LedgerQuerySchema = z
  .object({
    from: isoDate().optional().catch(undefined),
    to: isoDate().optional().catch(undefined),
  })
  .transform((v) => (v.from && v.to && v.from > v.to ? { from: v.to, to: v.from } : v));
export type LedgerQuery = z.output<typeof LedgerQuerySchema>;
