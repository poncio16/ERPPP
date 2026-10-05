import type { Direction } from "@/server/db/schema";

export interface AccountUi {
  direction: Direction;
  title: string;
  basePath: string;
  side: "clientes" | "proveedores";
  party: string;
  partyPath: string;
  documentsPath: string;
  billed: string;
  settled: string;
  lastSettlement: string;
}

export const ACCOUNT_UI: Record<Direction, AccountUi> = {
  ISSUED: {
    direction: "ISSUED",
    title: "Cuentas corrientes de clientes",
    basePath: "/cuentas-corrientes/clientes",
    side: "clientes",
    party: "Cliente",
    partyPath: "/clientes",
    documentsPath: "/comprobantes-emitidos",
    billed: "Facturado en el período",
    settled: "Cobrado en el período",
    lastSettlement: "Última cobranza",
  },
  RECEIVED: {
    direction: "RECEIVED",
    title: "Cuentas corrientes de proveedores",
    basePath: "/cuentas-corrientes/proveedores",
    side: "proveedores",
    party: "Proveedor",
    partyPath: "/proveedores",
    documentsPath: "/comprobantes-recibidos",
    billed: "Comprado en el período",
    settled: "Pagado en el período",
    lastSettlement: "Último pago",
  },
};
