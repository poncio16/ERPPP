import { z } from "zod";
import { checkboxFlag, idempotencyKey, isoDate, optionalText, positiveAmount, positiveId, requiredText } from "@/lib/schema-helpers";

/**
 * Devolución en dinero de un saldo a favor (D14). Consume un crédito disponible del tercero:
 * una cobranza o un pago con saldo sin imputar, o una NC / saldo inicial acreedor.
 */
export const RegisterRefundSchema = z
  .object({
    idempotencyKey,
    sourceKind: z.enum(["COLLECTION", "PAYMENT", "CREDIT_DOCUMENT"], { error: "Crédito inválido." }),
    sourceId: positiveId("Crédito inválido."),
    date: isoDate("Ingrese la fecha."),
    amount: positiveAmount("El importe"),
    method: z.enum(["CASH", "TRANSFER"], { error: "Elija efectivo o transferencia." }),
    cashBoxId: z.preprocess((v) => (v === "" ? undefined : v), positiveId("Elija la caja.").optional()),
    bankAccountId: z.preprocess((v) => (v === "" ? undefined : v), positiveId("Elija la cuenta bancaria.").optional()),
    reference: optionalText(100),
    reason: requiredText(3, 300, "Indique el motivo de la devolución."),
    confirmWarnings: checkboxFlag,
  })
  .superRefine((v, ctx) => {
    if (v.method === "CASH" && !v.cashBoxId) ctx.addIssue({ code: "custom", path: ["cashBoxId"], message: "Elija la caja." });
    if (v.method === "TRANSFER" && !v.bankAccountId) ctx.addIssue({ code: "custom", path: ["bankAccountId"], message: "Elija la cuenta bancaria." });
  });
export type RegisterRefundInput = z.output<typeof RegisterRefundSchema>;

export const AnnulRefundSchema = z.object({
  id: positiveId("Devolución inválida."),
  reason: requiredText(5, 300, "Indique el motivo de la anulación."),
});

export const RefundListSchema = z.object({
  lado: z.enum(["clientes", "proveedores"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).optional().catch(undefined),
});
