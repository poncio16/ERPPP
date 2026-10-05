import Decimal from "decimal.js";
import { z } from "zod";
import { parseAmount } from "@/lib/money";

export const DIRECTIONS = ["ISSUED", "RECEIVED"] as const;

/** Importe en texto ("1.500,50"); vacío = 0. Se valida con decimal.js, nunca con float. */
const amount = (label = "Importe") =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v || v.trim() === "") return new Decimal(0);
      const d = parseAmount(v);
      if (!d || d.isNegative() || d.decimalPlaces() > 2 || d.abs().greaterThanOrEqualTo("1e15")) {
        ctx.addIssue({ code: "custom", message: `${label} inválido (hasta 2 decimales, sin signo).` });
        return z.NEVER;
      }
      return d;
    });

const optionalAmount = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v || v.trim() === "") return null;
    const d = parseAmount(v);
    if (!d || d.isNegative() || d.decimalPlaces() > 2) {
      ctx.addIssue({ code: "custom", message: "Importe inválido." });
      return z.NEVER;
    }
    return d;
  });

const isoDate = (message: string) =>
  z
    .string({ error: message })
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: message })
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), {
      error: message,
    });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Máximo ${max} caracteres.` })
    .optional()
    .transform((v) => (v ? v : null));

const list = (v: unknown) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const strings = z.preprocess(list, z.array(z.string()));

const positiveInt = (message: string) => z.coerce.number({ error: message }).int({ error: message }).positive({ error: message });

/** Registro de un comprobante emitido o recibido (los importes se ingresan tal como figuran en él). */
export const RegisterDocumentSchema = z
  .object({
    idempotencyKey: z.uuid({ error: "Falta la clave de la operación; recargue la página." }),
    documentTypeId: positiveInt("Elija el tipo de comprobante."),
    pointOfSale: z.coerce
      .number({ error: "Punto de venta inválido." })
      .int({ error: "Punto de venta inválido." })
      .min(1, { error: "El punto de venta va de 1 a 99999." })
      .max(99999, { error: "El punto de venta va de 1 a 99999." }),
    number: z.coerce
      .number({ error: "Número inválido." })
      .int({ error: "Número inválido." })
      .min(1, { error: "El número va de 1 a 99999999." })
      .max(99999999, { error: "El número va de 1 a 99999999." }),
    partyId: positiveInt("Elija el tercero."),
    issueDate: isoDate("Fecha inválida."),
    dueDate: isoDate("Vencimiento inválido."),
    /** AAAA-MM; vacío = mes de la fecha del comprobante. */
    vatPeriod: z
      .string()
      .optional()
      .transform((v) => (v ? v : null))
      .pipe(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: "Período inválido (AAAA-MM)." }).nullable()),
    concept: z
      .string()
      .optional()
      .transform((v) => (v ? v : null))
      .pipe(z.enum(["PRODUCTS", "SERVICES", "BOTH"]).nullable()),
    description: optionalText(500),
    externalRef: optionalText(100),
    currency: z.enum(["ARS", "USD", "EUR"]).optional().default("ARS"),
    exchangeRate: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (!v || v.trim() === "") return new Decimal(1);
        const d = parseAmount(v);
        if (!d || !d.greaterThan(0) || d.decimalPlaces() > 6) {
          ctx.addIssue({ code: "custom", message: "Cotización inválida (hasta 6 decimales)." });
          return z.NEVER;
        }
        return d;
      }),
    netUntaxed: amount("Importe no gravado"),
    netExempt: amount("Importe exento"),
    discount: amount("Descuento"),
    vatTaxId: strings,
    vatBase: strings,
    vatAmount: strings,
    otherTaxId: strings,
    otherAmount: strings,
    otherJurisdictionId: strings,
    controlTotal: optionalAmount,
    reason: optionalText(300),
    relatedDocumentIds: z.preprocess(list, z.array(z.coerce.number().int().positive())),
    unlinkedCreditNote: z
      .string()
      .optional()
      .transform((v) => v === "1"),
    confirmWarnings: z
      .string()
      .optional()
      .transform((v) => v === "1"),
  })
  .superRefine((v, ctx) => {
    if (v.dueDate < v.issueDate) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "El vencimiento no puede ser anterior a la fecha." });
    if (v.currency === "ARS" && !v.exchangeRate.equals(1)) {
      ctx.addIssue({ code: "custom", path: ["exchangeRate"], message: "En pesos la cotización es 1." });
    }
  });
export type RegisterDocumentInput = z.output<typeof RegisterDocumentSchema>;

/** Las líneas llegan como columnas paralelas; las filas vacías se ignoran. */
export function parseTaxRows(input: RegisterDocumentInput) {
  const errors: Record<string, string[]> = {};
  const vat: { taxId: number; base: Decimal; amount: Decimal; index: number }[] = [];
  input.vatTaxId.forEach((t, i) => {
    const b = input.vatBase[i] ?? "";
    const a = input.vatAmount[i] ?? "";
    if (!t && !b.trim() && !a.trim()) return;
    const base = parseAmount(b || "0");
    const amt = parseAmount(a || "0");
    if (!t) errors[`vat.${i}`] = ["Elija la alícuota."];
    else if (!base || !amt || base.isNegative() || amt.isNegative() || base.decimalPlaces() > 2 || amt.decimalPlaces() > 2) {
      errors[`vat.${i}`] = ["Base o IVA inválidos (hasta 2 decimales, sin signo)."];
    } else vat.push({ taxId: Number(t), base, amount: amt, index: i });
  });
  const other: { taxId: number; amount: Decimal; jurisdictionId: number | null; index: number }[] = [];
  input.otherTaxId.forEach((t, i) => {
    const a = input.otherAmount[i] ?? "";
    if (!t && !a.trim()) return;
    const amt = parseAmount(a || "0");
    const j = input.otherJurisdictionId[i];
    if (!t) errors[`other.${i}`] = ["Elija el concepto."];
    else if (!amt || amt.isNegative() || amt.decimalPlaces() > 2) errors[`other.${i}`] = ["Importe inválido."];
    else other.push({ taxId: Number(t), amount: amt, jurisdictionId: j ? Number(j) : null, index: i });
  });
  return { vat, other, errors };
}

export const AnnulDocumentSchema = z.object({
  id: z.coerce.number().int().positive(),
  version: z.coerce.number().int().positive(),
  reason: z.string().trim().min(5, { error: "Indique el motivo de la anulación (mínimo 5 caracteres)." }).max(300),
});

export const UpdateDocumentInfoSchema = z.object({
  id: z.coerce.number().int().positive(),
  version: z.coerce.number().int().positive(),
  dueDate: isoDate("Vencimiento inválido."),
  concept: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.enum(["PRODUCTS", "SERVICES", "BOTH"]).nullable()),
  description: optionalText(500),
  externalRef: optionalText(100),
});

export const CheckDuplicateSchema = z.object({
  direction: z.enum(DIRECTIONS),
  documentTypeId: z.coerce.number().int().positive(),
  pointOfSale: z.coerce.number().int().min(1).max(99999),
  number: z.coerce.number().int().min(1).max(99999999),
  partyId: z.coerce.number().int().positive().optional(),
});

export const STATUS_FILTERS = ["PENDING", "OVERDUE", "PARTIAL", "SETTLED", "ANNULLED", "ACTIVE", "ALL"] as const;

export const DocumentListSchema = z.object({
  q: z.string().trim().max(60).optional().default(""),
  partyId: z.coerce.number().int().positive().optional().catch(undefined),
  documentTypeId: z.coerce.number().int().positive().optional().catch(undefined),
  status: z.enum(STATUS_FILTERS).optional().default("ACTIVE").catch("ACTIVE"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).optional().default(1).catch(1),
});
export type DocumentListQuery = z.output<typeof DocumentListSchema>;

export const LinkableSchema = z.object({
  direction: z.enum(DIRECTIONS),
  partyId: z.coerce.number().int().positive(),
});
