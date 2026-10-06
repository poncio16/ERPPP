import { z } from "zod";
import { isoDate, positiveAmount, positiveId, requiredText } from "@/lib/schema-helpers";

/** Ingreso o egreso proyectado que no surge de comprobantes (G.15, flujo de fondos). */
export const PlannedItemSchema = z.object({
  direction: z.enum(["IN", "OUT"], { error: "Elija ingreso o egreso." }),
  conceptId: z.preprocess((v) => (v === "" ? undefined : v), positiveId("Concepto inválido.").optional()),
  expectedDate: isoDate("Ingrese la fecha prevista."),
  amount: positiveAmount("El importe"),
  description: requiredText(3, 200, "Describa el ingreso o egreso previsto."),
  recurrence: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["MONTHLY"]).optional()),
});
export type PlannedItemInput = z.output<typeof PlannedItemSchema>;

export const PlannedStatusSchema = z.object({
  id: positiveId("Movimiento proyectado inválido."),
  status: z.enum(["REALIZED", "CANCELLED"], { error: "Estado inválido." }),
});

export const ConsolidatedQuerySchema = z
  .object({
    from: isoDate().optional().catch(undefined),
    to: isoDate().optional().catch(undefined),
  })
  .transform((v) => (v.from && v.to && v.from > v.to ? { from: v.to, to: v.from } : v));
