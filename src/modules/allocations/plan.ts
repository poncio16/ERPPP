import Decimal from "decimal.js";

/** Funciones puras del servicio de imputaciones (sin base de datos). */

export type DocumentStatus = "OPEN" | "PARTIAL" | "SETTLED";

/** Estado de un comprobante según su saldo (coherente con ck_documents_status_balance). */
export function statusForBalance(balance: Decimal.Value, total: Decimal.Value): DocumentStatus {
  const b = new Decimal(balance);
  if (b.isZero()) return "SETTLED";
  return b.equals(total) ? "OPEN" : "PARTIAL";
}

export interface OpenDebit {
  id: number;
  dueDate: string;
  issueDate: string;
  balance: string;
}

/**
 * Propuesta automática (G.7): reparte el crédito disponible entre los comprobantes abiertos por
 * vencimiento más antiguo (luego fecha y id). Es solo una sugerencia que el usuario revisa.
 */
export function proposeFifo(debits: readonly OpenDebit[], available: Decimal.Value): { documentId: number; amount: string }[] {
  let rest = new Decimal(available);
  const sorted = [...debits].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.issueDate.localeCompare(b.issueDate) || a.id - b.id);
  const out: { documentId: number; amount: string }[] = [];
  for (const d of sorted) {
    if (rest.lte(0)) break;
    const amount = Decimal.min(rest, d.balance);
    if (amount.lte(0)) continue;
    out.push({ documentId: d.id, amount: amount.toFixed(2) });
    rest = rest.minus(amount);
  }
  return out;
}

/** Suma exacta de importes en texto. */
export const sumAmounts = (items: readonly { amount: Decimal.Value }[]) => items.reduce((a, i) => a.plus(i.amount), new Decimal(0));
