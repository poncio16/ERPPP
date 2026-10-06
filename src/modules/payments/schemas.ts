import { z } from "zod";
import { allocationItemsField } from "@/modules/allocations/schemas";
import { checkboxFlag, idempotencyKey, isoDate, jsonField, optionalText, positiveAmount, positiveId, requiredText } from "@/lib/schema-helpers";

/** Cheque propio (físico o ECHEQ) que se entrega en el pago. */
export const OwnCheckSchema = z
  .object({
    bankAccountId: positiveId("Elija la cuenta bancaria del cheque."),
    format: z.enum(["PHYSICAL", "ECHEQ"], { error: "Elija cheque físico o ECHEQ." }),
    checkType: z.enum(["COMMON", "DEFERRED"], { error: "Elija común o de pago diferido." }),
    number: z
      .string({ error: "Ingrese el número de cheque." })
      .trim()
      .regex(/^[0-9A-Za-z-]{1,20}$/, { error: "Número de cheque inválido." }),
    issueDate: isoDate("Ingrese la fecha de emisión."),
    paymentDate: isoDate("Ingrese la fecha de pago."),
  })
  .superRefine((v, ctx) => {
    if (v.paymentDate < v.issueDate) ctx.addIssue({ code: "custom", path: ["paymentDate"], message: "La fecha de pago no puede ser anterior a la de emisión." });
  });

export const PaymentLineSchema = z.discriminatedUnion(
  "method",
  [
    z.object({ method: z.literal("CASH"), amount: positiveAmount(), cashBoxId: positiveId("Elija la caja.") }),
    z.object({
      method: z.literal("TRANSFER"),
      amount: positiveAmount(),
      bankAccountId: positiveId("Elija la cuenta bancaria."),
      transferDate: isoDate("Ingrese la fecha de la transferencia."),
      transferReference: optionalText(100),
    }),
    z.object({ method: z.literal("OWN_CHECK"), amount: positiveAmount(), check: OwnCheckSchema }),
    /** Endoso de un cheque en cartera: el importe es el del cheque. */
    z.object({ method: z.literal("THIRD_PARTY_CHECK"), receivedCheckId: positiveId("Elija el cheque de la cartera.") }),
    z.object({
      method: z.literal("RETENTION"),
      amount: positiveAmount(),
      retentionTaxId: positiveId("Elija el impuesto retenido."),
      certificate: requiredText(1, 50, "Ingrese el número de certificado."),
      retentionDate: isoDate("Ingrese la fecha de la retención."),
    }),
  ],
  { error: "Elija el medio de pago." },
);
export type PaymentLineInput = z.output<typeof PaymentLineSchema>;

export const RegisterPaymentSchema = z.object({
  idempotencyKey,
  supplierId: positiveId("Elija el proveedor."),
  date: isoDate("Ingrese la fecha del pago."),
  notes: optionalText(500),
  lines: jsonField(
    z.array(PaymentLineSchema).min(1, { error: "Agregue al menos un medio de pago." }).max(50, { error: "Demasiados medios en un pago." }),
    "Medios de pago inválidos.",
  ),
  allocations: allocationItemsField.optional().transform((v) => v ?? []),
  confirmWarnings: checkboxFlag,
});
export type RegisterPaymentInput = z.output<typeof RegisterPaymentSchema>;
