import { recordAudit } from "@/modules/audit/service";
import { exportStatementXlsx } from "@/modules/accounts/export";
import { StatementSchema } from "@/modules/accounts/schemas";
import { ForbiddenError } from "@/lib/errors";
import { getRequestMeta, getSession, toContext } from "@/server/auth/session";
import { db } from "@/server/db/client";

const SIDES = { clientes: "ISSUED", proveedores: "RECEIVED" } as const;

/** Exportación del resumen de cuenta corriente a Excel. Sesión y permisos se verifican aquí y en el servicio. */
export async function GET(request: Request, { params }: RouteContext<"/api/cuentas-corrientes/[side]/[id]/excel">) {
  const { side, id } = await params;
  const direction = SIDES[side as keyof typeof SIDES];
  const partyId = Number(id);
  if (!direction || !Number.isSafeInteger(partyId) || partyId <= 0) return new Response("No encontrado", { status: 404 });

  const session = await getSession();
  if (!session) return new Response("Sesión vencida. Vuelva a ingresar.", { status: 401 });
  if (session.mustChangePassword) return new Response("Debe cambiar su contraseña antes de continuar.", { status: 403 });
  const ctx = toContext(session, await getRequestMeta());

  const url = new URL(request.url);
  const query = StatementSchema.parse({ from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined });
  try {
    const { buffer, filename } = await exportStatementXlsx(db, ctx, direction, partyId, query);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) {
      await recordAudit(db, ctx, { module: "accounts", action: "export", result: "DENIED", message: `Sin permiso ${e.permission}` });
      return new Response("No tiene permiso para exportar.", { status: 403 });
    }
    if (e instanceof Error && "code" in e && e.code === "NOT_FOUND") return new Response("No encontrado", { status: 404 });
    throw e;
  }
}
