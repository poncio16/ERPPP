import type { Direction } from "@/server/db/schema";

export interface DocumentUi {
  direction: Direction;
  title: string;
  singular: string;
  basePath: string;
  party: string;
  partyPath: string;
}

/** "Comprobantes emitidos" y "Comprobantes recibidos" (§17 y §18: no se llaman Facturación ni Compras). */
export const DOCUMENT_UI: Record<Direction, DocumentUi> = {
  ISSUED: {
    direction: "ISSUED",
    title: "Comprobantes emitidos",
    singular: "comprobante emitido",
    basePath: "/comprobantes-emitidos",
    party: "Cliente",
    partyPath: "/clientes",
  },
  RECEIVED: {
    direction: "RECEIVED",
    title: "Comprobantes recibidos",
    singular: "comprobante recibido",
    basePath: "/comprobantes-recibidos",
    party: "Proveedor",
    partyPath: "/proveedores",
  },
};
