import type { DocumentStatus } from "@/server/db/schema";

export type DisplayTone = "slate" | "green" | "red" | "amber" | "blue";

/**
 * Estado para mostrar (G.1-12): "Vencido" no se almacena, se deriva de la fecha de vencimiento
 * y el saldo. Las NC muestran su crédito disponible.
 */
export function displayStatus(
  d: { status: DocumentStatus | string; dueDate: string; balance: string; direction: string; documentClass: string },
  today: string,
): { label: string; tone: DisplayTone } {
  if (d.status === "ANNULLED") return { label: "Anulado", tone: "slate" };
  const credit = d.documentClass === "CREDIT_NOTE" || d.documentClass === "OPENING_CREDIT";
  if (credit) {
    if (d.status === "SETTLED") return { label: "Aplicada", tone: "green" };
    return { label: d.status === "PARTIAL" ? "Parcialmente aplicada" : "Crédito disponible", tone: "blue" };
  }
  const issued = d.direction === "ISSUED";
  if (d.status === "SETTLED") return { label: issued ? "Cobrado" : "Pagado", tone: "green" };
  if (d.dueDate < today) return { label: "Vencido", tone: "red" };
  if (d.status === "PARTIAL") return { label: issued ? "Parcialmente cobrado" : "Parcialmente pagado", tone: "amber" };
  return { label: "Pendiente", tone: "amber" };
}

export const CLASS_LABELS: Record<string, string> = {
  INVOICE: "Factura",
  DEBIT_NOTE: "Nota de débito",
  CREDIT_NOTE: "Nota de crédito",
  INTERNAL_DEBIT: "Débito interno",
  OPENING_DEBIT: "Saldo inicial deudor",
  OPENING_CREDIT: "Saldo inicial acreedor",
};

export const CONCEPT_LABELS: Record<string, string> = { PRODUCTS: "Productos", SERVICES: "Servicios", BOTH: "Productos y servicios" };
