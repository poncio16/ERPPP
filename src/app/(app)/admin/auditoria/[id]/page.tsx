import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { actionLabel, entityLabel, moduleLabel } from "@/modules/audit/labels";
import { fieldChanges, getAuditEntry } from "@/modules/audit/query";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { ResultBadge } from "../result-badge";

function show(v: unknown): string {
  if (v === undefined) return "";
  if (v === null) return "(vacío)";
  return typeof v === "string" ? v : JSON.stringify(v, null, 2);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="col-span-2 break-all text-slate-900">{children}</dd>
    </div>
  );
}

export default async function AuditEntryPage({ params }: PageProps<"/admin/auditoria/[id]">) {
  const { ctx } = await requirePagePermission("audit.read");
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const data = await getAuditEntry(db, ctx, id);
  if (!data) notFound();
  const { entry: e } = data;
  const changes = e.before == null && e.after == null ? [] : fieldChanges(e.before, e.after);

  return (
    <>
      <PageHeader
        title={`Registro de auditoría #${e.id}`}
        description={`${moduleLabel(e.module)} · ${actionLabel(e.action)} · ${formatDateTime(e.occurredAt)}`}
        actions={
          <div className="flex gap-2">
            {data.previousId && (
              <LinkButton variant="secondary" href={`/admin/auditoria/${data.previousId}`}>
                Anterior
              </LinkButton>
            )}
            {data.nextId && (
              <LinkButton variant="secondary" href={`/admin/auditoria/${data.nextId}`}>
                Siguiente
              </LinkButton>
            )}
            <LinkButton variant="secondary" href="/admin/auditoria">
              Volver al listado
            </LinkButton>
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 font-semibold text-slate-900">Operación</h2>
          <dl className="divide-y divide-slate-100">
            <Row label="Fecha y hora">{formatDateTime(e.occurredAt)}</Row>
            <Row label="Usuario">{e.username ? `${e.username}${data.userFullName ? ` (${data.userFullName})` : ""}` : "—"}</Row>
            <Row label="Módulo">{moduleLabel(e.module)}</Row>
            <Row label="Acción">
              {actionLabel(e.action)} <span className="text-slate-400">({e.action})</span>
            </Row>
            <Row label="Registro">
              {e.entityType ? (
                <>
                  {entityLabel(e.entityType)} {e.entityId && `#${e.entityId}`}{" "}
                  <Link className="text-blue-700 hover:underline" href={`/admin/auditoria?entityType=${encodeURIComponent(e.entityType)}${e.entityId ? `&entityId=${encodeURIComponent(e.entityId)}` : ""}`}>
                    (ver su historial)
                  </Link>
                </>
              ) : (
                "—"
              )}
            </Row>
            <Row label="Resultado">
              <ResultBadge result={e.result} />
            </Row>
            <Row label="Mensaje">{e.message ?? "—"}</Row>
          </dl>
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 font-semibold text-slate-900">Origen e integridad</h2>
          <dl className="divide-y divide-slate-100">
            <Row label="IP">{e.ip ?? "—"}</Row>
            <Row label="Navegador">{e.userAgent ?? "—"}</Row>
            <Row label="Sesión">{e.sessionId ?? "—"}</Row>
            <Row label="Id de petición">{e.requestId ?? "—"}</Row>
            <Row label="Hash anterior">
              <code className="text-xs">{e.prevHash}</code>
            </Row>
            <Row label="Hash">
              <code className="text-xs">{e.hash}</code>
            </Row>
          </dl>
        </Card>
      </div>
      <Card className="mt-4">
        <h2 className="px-4 pt-4 font-semibold text-slate-900">Valores anteriores y nuevos</h2>
        {changes.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">Esta operación no registra valores.</p>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Campo</Th>
                <Th>Valor anterior</Th>
                <Th>Valor nuevo</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {changes.map((c) => (
                <tr key={c.field}>
                  <Td className="font-medium">{c.field}</Td>
                  <Td>
                    <pre className="whitespace-pre-wrap break-all font-sans text-sm text-slate-700">{show(c.before)}</pre>
                  </Td>
                  <Td>
                    <pre className="whitespace-pre-wrap break-all font-sans text-sm text-slate-900">{show(c.after)}</pre>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
