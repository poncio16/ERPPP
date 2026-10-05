import { Card, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { listActiveSessions } from "@/modules/users/service";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { RevokeSessionButton } from "./revoke-session-button";

export default async function SessionsPage() {
  const { ctx } = await requirePagePermission("users.manage");
  const sessions = await listActiveSessions(db, ctx);
  return (
    <>
      <PageHeader title="Sesiones activas" description="Sesiones abiertas en este momento. Cerrar una obliga al usuario a volver a ingresar." />
      <Card>
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <Th>Usuario</Th>
              <Th>Inicio</Th>
              <Th>Última actividad</Th>
              <Th>Vence</Th>
              <Th>IP</Th>
              <Th>Navegador</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sessions.length === 0 && (
              <tr>
                <Td colSpan={7} className="text-center text-slate-500">
                  No hay sesiones activas.
                </Td>
              </tr>
            )}
            {sessions.map((s) => (
              <tr key={s.id}>
                <Td>
                  {s.fullName} <span className="text-slate-400">({s.username})</span>
                </Td>
                <Td>{formatDateTime(s.createdAt)}</Td>
                <Td>{formatDateTime(s.lastSeenAt)}</Td>
                <Td>{formatDateTime(s.expiresAt)}</Td>
                <Td>{s.ip ?? "—"}</Td>
                <Td className="max-w-xs truncate" title={s.userAgent ?? undefined}>
                  {s.userAgent ?? "—"}
                </Td>
                <Td className="text-right">
                  {s.id === ctx.sessionId ? (
                    <span className="text-xs text-slate-500">Sesión actual</span>
                  ) : (
                    <RevokeSessionButton sessionId={s.id} />
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
