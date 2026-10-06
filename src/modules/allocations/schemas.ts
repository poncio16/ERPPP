import { z } from "zod";
import { jsonField, positiveAmount, positiveId, requiredText } from "@/lib/schema-helpers";

export const AllocationItemSchema = z.object({
  documentId: positiveId("Comprobante inválido."),
  amount: positiveAmount("El importe imputado"),
});

/** Grilla de imputaciones enviada como JSON: [{ documentId, amount }]. */
export const allocationItemsField = jsonField(z.array(AllocationItemSchema).max(500, { error: "Demasiados comprobantes en una imputación." }), "Imputaciones inválidas.");

export const AllocateSchema = z.object({
  sourceKind: z.enum(["COLLECTION", "PAYMENT", "CREDIT_DOCUMENT"], { error: "Elija el crédito a imputar." }),
  sourceId: positiveId("Elija el crédito a imputar."),
  allocations: allocationItemsField.refine((v) => v.length > 0, { error: "Indique al menos un comprobante e importe." }),
});

export const ReverseAllocationSchema = z.object({
  id: positiveId("Imputación inválida."),
  reason: requiredText(5, 300, "Indique el motivo (al menos 5 caracteres)."),
});
