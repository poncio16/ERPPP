import type { AccountRef } from "@/modules/treasury/schemas";

/** Medio de una cobranza o un pago, ya descripto para pantallas y documentos internos. */
export interface OperationLine {
  id: number;
  lineNo: number;
  method: string;
  amount: string;
  detail: string;
  account: AccountRef | null;
  movementId: number | null;
  checkId: number | null;
  checkStatus: string | null;
}

/** Contenido de un recibo interno o una orden de pago interna (G.13). No son comprobantes fiscales. */
export interface InternalDocData {
  kind: "RECEIPT" | "PAYMENT_ORDER";
  number: string;
  issueDate: string;
  status: string;
  partyLabel: string;
  partyName: string;
  partyTaxId: string | null;
  amount: string;
  amountInWords: string;
  lines: OperationLine[];
  allocations: { label: string; amount: string }[];
  unapplied: string;
  notes: string | null;
  createdBy: string | null;
  createdAt: Date;
  operationId: number;
}
