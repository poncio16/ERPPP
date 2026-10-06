import { z } from "zod";
import { allocationItemsField } from "@/modules/allocations/schemas";
import {
  checkboxFlag,
  cuitField,
  idempotencyKey,
  isoDate,
  jsonField,
  optionalText,
  positiveAmount,
  positiveId,
  requiredText,
} from "@/lib/schema-helpers";

/** Datos de un cheque recibido (§23): banco, número, fechas, importe, tipo y librador. */
export const ReceivedCheckSchema = z
  .object({
    format: z.enum(["PHYSICAL", "ECHEQ"], { error: "Elija cheque físico o ECHEQ." }),
    checkType: z.enum(["COMMON", "DEFERRED"], { error: "Elija común o de pago diferido." }),
    issuerBankId: positiveId("Elija el banco emisor."),
    number: z
      .string({ error: "Ingrese el número de cheque." })
      .trim()
      .regex(/^[0-9A-Za-z-]{1,20}$/, { error: "Número de cheque inválido." }),
    drawerTaxId: cuitField("CUIT del librador inválido."),
    drawerName: requiredText(2, 150, "Ingrese el nombre del librador."),
    issueDate: isoDate("Ingrese la fecha de emisión."),
    paymentDate: isoDate("Ingrese la fecha de pago."),
  })
  .superRefine((v, ctx) => {
    if (v.paymentDate < v.issueDate) ctx.addIssue({ code: "custom", path: ["paymentDate"], message: "La fecha de pago no puede ser anterior a la de emisión." });
  });

export const CollectionLineSchema = z.discriminatedUnion(
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
    z.object({ method: z.literal("CHECK"), amount: positiveAmount(), check: ReceivedCheckSchema }),
    z.object({
      method: z.literal("RETENTION"),
      amount: positiveAmount(),
      retentionTaxId: positiveId("Elija el impuesto retenido."),
      certificate: requiredText(1, 50, "Ingrese el número de certificado."),
      retentionDate: isoDate("Ingrese la fecha de la retención."),
    }),
  ],
  { error: "Elija el medio de cobro." },
);
export type CollectionLineInput = z.output<typeof CollectionLineSchema>;

export const RegisterCollectionSchema = z.object({
  idempotencyKey,
  clientId: positiveId("Elija el cliente."),
  date: isoDate("Ingrese la fecha de la cobranza."),
  notes: optionalText(500),
  lines: jsonField(
    z.array(CollectionLineSchema).min(1, { error: "Agregue al menos un medio de cobro." }).max(50, { error: "Demasiados medios en una cobranza." }),
    "Medios de cobro inválidos.",
  ),
  allocations: allocationItemsField.optional().transform((v) => v ?? []),
  confirmWarnings: checkboxFlag,
});
export type RegisterCollectionInput = z.output<typeof RegisterCollectionSchema>;

export const AnnulOperationSchema = z.object({
  id: positiveId("Operación inválida."),
  reason: requiredText(5, 300, "Indique el motivo (al menos 5 caracteres)."),
});

export const OperationListSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  partyId: z.coerce.number().int().positive().optional().catch(undefined),
  from: isoDate().optional().catch(undefined),
  to: isoDate().optional().catch(undefined),
  status: z.enum(["ACTIVE", "ANNULLED", "UNAPPLIED"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).optional().catch(undefined),
});
export type OperationListQuery = z.output<typeof OperationListSchema>;
