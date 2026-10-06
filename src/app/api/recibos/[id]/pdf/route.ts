import { receiptData } from "@/modules/collections/service";
import { internalDocPdfResponse } from "@/modules/internal-docs/pdf-response";
import { db } from "@/server/db/client";

/** PDF del recibo interno de una cobranza (G.13). */
export async function GET(_request: Request, { params }: RouteContext<"/api/recibos/[id]/pdf">) {
  const { id } = await params;
  return internalDocPdfResponse(id, "collections", (ctx, collectionId) => receiptData(db, ctx, collectionId));
}
