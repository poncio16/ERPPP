import { internalDocPdfResponse } from "@/modules/internal-docs/pdf-response";
import { paymentOrderData } from "@/modules/payments/service";
import { db } from "@/server/db/client";

/** PDF de la orden de pago interna de un pago a proveedor (G.13). */
export async function GET(_request: Request, { params }: RouteContext<"/api/ordenes-de-pago/[id]/pdf">) {
  const { id } = await params;
  return internalDocPdfResponse(id, "payments", (ctx, paymentId) => paymentOrderData(db, ctx, paymentId));
}
