import { recordAudit } from "@/modules/audit/service";
import { exportReport } from "@/modules/reports/export";
import { findReport } from "@/modules/reports/registry";
import { ForbiddenError } from "@/lib/errors";
import { getRequestMeta, getSession, toContext } from "@/server/auth/session";
import { db } from "@/server/db/client";

const FORMATS = { excel: "excel", pdf: "pdf" } as const;

/** Exportación de un reporte a Excel o PDF con los filtros de la URL. Sesión aquí; permisos en el servicio. */
export async function GET(request: Request, { params }: RouteContext<"/api/reportes/[report]/[format]">) {
  const { report, format: rawFormat } = await params;
  const format = FORMATS[rawFormat as keyof typeof FORMATS];
  if (!format || !findReport(report)) return new Response("No encontrado", { status: 404 });

  const session = await getSession();
  if (!session) return new Response("Sesión vencida. Vuelva a ingresar.", { status: 401 });
  if (session.mustChangePassword) return new Response("Debe cambiar su contraseña antes de continuar.", { status: 403 });
  const ctx = toContext(session, await getRequestMeta());

  const query = Object.fromEntries(new URL(request.url).searchParams.entries());
  try {
    const { buffer, filename, contentType } = await exportReport(db, ctx, report, query, format);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${format === "pdf" ? "inline" : "attachment"}; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) {
      await recordAudit(db, ctx, { module: "reports", action: "export", entityType: "report", result: "DENIED", message: `Sin permiso ${e.permission} (${report})` });
      return new Response("No tiene permiso para exportar este reporte.", { status: 403 });
    }
    throw e;
  }
}
