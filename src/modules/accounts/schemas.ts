import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ACCOUNT_FILTERS = ["WITH_BALANCE", "DEBT", "CREDIT", "OVERDUE", "ALL"] as const;
export type AccountFilter = (typeof ACCOUNT_FILTERS)[number];

/** Listado de cuentas corrientes (query string; los valores inválidos vuelven al valor por defecto). */
export const AccountListSchema = z.object({
  q: z.string().trim().max(60).optional().default("").catch(""),
  filter: z.enum(ACCOUNT_FILTERS).optional().default("WITH_BALANCE").catch("WITH_BALANCE"),
  page: z.coerce.number().int().min(1).max(100000).optional().default(1).catch(1),
});
export type AccountListQuery = z.output<typeof AccountListSchema>;

/** Período del resumen de cuenta. Sin fechas: desde el 1 de enero del año en curso hasta hoy. */
export const StatementSchema = z
  .object({
    from: isoDate.optional().catch(undefined),
    to: isoDate.optional().catch(undefined),
  })
  .transform((v) => (v.from && v.to && v.from > v.to ? { from: v.to, to: v.from } : v));
export type StatementQuery = z.output<typeof StatementSchema>;
