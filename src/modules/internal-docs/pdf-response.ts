import { recordAudit } from "@/modules/audit/service";
import { ForbiddenError } from "@/lib/errors";
import type { ServiceContext } from "@/server/context";
import { getRequestMeta, getSession, toContext } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { internalDocFilename, renderInternalDocPdf } from "./pdf";
import { companyHeader } from "./service";
import type { InternalDocData } from "./types";

/**
 * Respuesta HTTP con el PDF de un recibo interno o una orden de pago interna. Verifica sesión y
 * delega el permiso en el servicio que arma los datos; un rechazo queda auditado.
 */
export async function internalDocPdfResponse(
  rawId: string,
  module: "collections" | "payments",
  load: (ctx: ServiceContext, id: number) => Promise<InternalDocData | null>,
): Promise<Response> {
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) return new Response("No encontrado", { status: 404 });

  const session = await getSession();
  if (!session) return new Response("Sesión vencida. Vuelva a ingresar.", { status: 401 });
  if (session.mustChangePassword) return new Response("Debe cambiar su contraseña antes de continuar.", { status: 403 });
  const ctx = toContext(session, await getRequestMeta());

  try {
    const data = await load(ctx, id);
    if (!data) return new Response("No encontrado", { status: 404 });
    const buffer = await renderInternalDocPdf(data, await companyHeader(db));
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${internalDocFilename(data)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) {
      await recordAudit(db, ctx, { module, action: "pdf", result: "DENIED", message: `Sin permiso ${e.permission}` });
      return new Response("No tiene permiso para ver este documento.", { status: 403 });
    }
    throw e;
  }
}
