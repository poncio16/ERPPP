import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { formatDate } from "@/lib/format";
import type { DbOrTx } from "@/server/db/drizzle";
import type { Direction } from "@/server/db/schema";

/** Rótulos y rutas de cada lado (clientes / proveedores). */
export const SIDE_INFO = {
  ISSUED: {
    slug: "clientes",
    party: "Cliente",
    parties: "Clientes",
    partyTable: "clients",
    partyCol: "client_id",
    documents: "Comprobantes emitidos",
    documentPath: "/comprobantes-emitidos",
    settlement: "Cobranza",
    settlements: "Cobranzas",
    settlementPath: "/cobranzas",
    voucher: "Recibo",
    accountPath: "/cuentas-corrientes/clientes",
  },
  RECEIVED: {
    slug: "proveedores",
    party: "Proveedor",
    parties: "Proveedores",
    partyTable: "suppliers",
    partyCol: "supplier_id",
    documents: "Comprobantes recibidos",
    documentPath: "/comprobantes-recibidos",
    settlement: "Pago",
    settlements: "Pagos",
    settlementPath: "/pagos",
    voucher: "Orden de pago",
    accountPath: "/cuentas-corrientes/proveedores",
  },
} as const;

export const sumOf = <T>(xs: T[], f: (x: T) => string | Decimal | null | undefined) => xs.reduce((a, x) => a.plus(f(x) ?? 0), new Decimal(0));
export const m = (d: Decimal | string) => new Decimal(d).toFixed(2);

export const periodLabel = (from: string, to: string) => `Período: ${formatDate(from)} al ${formatDate(to)}`;

/** Rótulo del tercero filtrado ("Todos" si no hay filtro). */
export async function partyFilterLabel(db: DbOrTx, direction: Direction, partyId: number | undefined) {
  const info = SIDE_INFO[direction];
  if (!partyId) return `${info.party}: todos`;
  const { rows } = await db.execute<{ code: string; legal_name: string }>(
    sql`SELECT code, legal_name FROM ${sql.raw(info.partyTable)} WHERE id = ${partyId}`,
  );
  const p = rows[0];
  return `${info.party}: ${p ? `${p.legal_name} (${p.code})` : "inexistente"}`;
}

/** Signo de un comprobante en reportes: las notas de crédito y los saldos iniciales acreedores restan. */
export const CREDIT_CLASS_SQL = sql.raw(`('CREDIT_NOTE','OPENING_CREDIT')`);
