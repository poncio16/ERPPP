import { z } from "zod";
import { accountRef } from "@/modules/treasury/schemas";
import { checkboxFlag, isoDate, positiveId, requiredText } from "@/lib/schema-helpers";

const base = {
  id: positiveId("Cheque inválido."),
  version: z.coerce.number({ error: "Versión inválida." }).int().min(1),
  date: isoDate("Ingrese la fecha."),
};

/** Depósito de un cheque en cartera en una cuenta bancaria propia. */
export const DepositCheckSchema = z.object({ ...base, bankAccountId: positiveId("Elija la cuenta bancaria."), confirmWarnings: checkboxFlag });

/** Acreditación de un cheque depositado. */
export const CreditCheckSchema = z.object({ ...base });

/** Cobro por ventanilla: el cheque en cartera ingresa directamente en una caja o cuenta. */
export const CashCheckSchema = z.object({ ...base, account: accountRef(), confirmWarnings: checkboxFlag });

/** Rechazo de un cheque (recibido o propio). */
export const RejectCheckSchema = z.object({
  ...base,
  reason: requiredText(3, 300, "Indique el motivo del rechazo."),
  confirmWarnings: checkboxFlag,
});

/** Presentación y débito de un cheque propio. */
export const IssuedCheckStepSchema = z.object({ ...base, confirmWarnings: checkboxFlag });

export const ReceivedCheckListSchema = z.object({
  status: z.enum(["IN_PORTFOLIO", "DEPOSITED", "CREDITED", "REJECTED", "ENDORSED", "ANNULLED", "ALL"]).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).optional().catch(undefined),
});
export type ReceivedCheckListQuery = z.output<typeof ReceivedCheckListSchema>;

export const IssuedCheckListSchema = z.object({
  status: z.enum(["PENDING", "ISSUED", "DELIVERED", "PRESENTED", "DEBITED", "REJECTED", "ANNULLED", "ALL"]).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100000).optional().catch(undefined),
});
export type IssuedCheckListQuery = z.output<typeof IssuedCheckListSchema>;
