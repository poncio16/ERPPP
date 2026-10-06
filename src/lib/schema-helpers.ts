import { z } from "zod";
import { normalizeCuit, isValidCuit } from "./cuit";
import { parseAmount, toMoneyString } from "./money";

/** Piezas Zod comunes a los formularios de operaciones (cobranzas, pagos, cheques, imputaciones). */

export const isoDate = (message = "Fecha inválida.") => z.string({ error: message }).regex(/^\d{4}-\d{2}-\d{2}$/, { error: message });

export const positiveId = (message: string) => z.coerce.number({ error: message }).int({ error: message }).positive({ error: message });

export const idempotencyKey = z.uuid({ error: "Falta la clave de la operación; recargue la página." });

/** Casilla de verificación: "1" marcada, ausente desmarcada. */
export const checkboxFlag = z
  .string()
  .optional()
  .transform((v) => v === "1");

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Máximo ${max} caracteres.` })
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const requiredText = (min: number, max: number, message: string) =>
  z.string({ error: message }).trim().min(min, { error: message }).max(max, { error: `Máximo ${max} caracteres.` });

/** Importe positivo con hasta 2 decimales ("1.500,50"). Se devuelve como texto exacto "1500.50". */
export const positiveAmount = (label = "Importe") =>
  z.union([z.string(), z.number()], { error: `Ingrese ${label.toLowerCase()}.` }).transform((v, ctx) => {
    const d = parseAmount(String(v));
    const s = d && d.isPositive() && !d.isZero() ? toMoneyString(d) : null;
    if (s === null) {
      ctx.addIssue({ code: "custom", message: `${label} inválido: mayor que cero y con hasta 2 decimales.` });
      return z.NEVER;
    }
    return s;
  });

export const cuitField = (message = "CUIT inválido.") =>
  z.string({ error: message }).transform((v, ctx) => {
    const n = normalizeCuit(v);
    if (!isValidCuit(n)) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return n;
  });

/**
 * Campo de formulario con un JSON (grillas dinámicas: medios de pago, imputaciones). El contenido
 * se valida con `schema` y los errores se informan bajo `name.<índice>.<campo>`.
 */
export const jsonField = <S extends z.ZodType>(schema: S, message = "Datos inválidos.") =>
  z
    .string({ error: message })
    .transform((v, ctx) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
    })
    .pipe(schema);
