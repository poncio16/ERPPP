import Link from "next/link";
import { Card, Input, Label, LinkButton, PageHeader, Pagination, Select, Table, Td, Th, buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { actionLabel, entityLabel, moduleLabel, RESULT_LABELS } from "@/modules/audit/labels";
import { auditFilterOptions, listAuditLog } from "@/modules/audit/query";
import { AuditQuerySchema } from "@/modules/audit/schemas";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { ChainVerifier } from "./chain-verifier";
import { ResultBadge } from "./result-badge";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AuditPage({ searchParams }: PageProps<"/admin/auditoria">) {
  const { ctx } = await requirePagePermission("audit.read");
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, first(v) || undefined]));
  const query = AuditQuerySchema.parse(raw);
  const [list, options] = await Promise.all([listAuditLog(db, ctx, query), auditFilterOptions(db, ctx)]);
  const href = (page: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "" && k !== "page") sp.set(k, String(v));
    if (page > 1) sp.set("page", String(page));
    const s = sp.toString();
    return s ? `/admin/auditoria?${s}` : "/admin/auditoria";
  };

  return (
    <>
      <PageHeader
        title="Auditoría"
        description="Registro inalterable de las operaciones: quién, cuándo, qué módulo y registro, valores anteriores y nuevos, y resultado. Cada registro se encadena con el anterior mediante un hash SHA-256."
      />
      <Card className="mb-4 p-4">
        <ChainVerifier />
      </Card>
      <Card className="mb-4 p-4">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
          <div>
            <Label htmlFor="from">Desde</Label>
            <Input id="from" name="from" type="date" defaultValue={query.from} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="to">Hasta</Label>
            <Input id="to" name="to" type="date" defaultValue={query.to} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="user">Usuario</Label>
            <Select id="user" name="user" defaultValue={query.user ?? ""} className="mt-1">
              <option value="">Todos</option>
              {options.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username} ({u.fullName})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="module">Módulo</Label>
            <Select id="module" name="module" defaultValue={query.module ?? ""} className="mt-1">
              <option value="">Todos</option>
              {options.modules.map((m) => (
                <option key={m} value={m}>
                  {moduleLabel(m)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="result">Resultado</Label>
            <Select id="result" name="result" defaultValue={query.result ?? ""} className="mt-1">
              <option value="">Todos</option>
              {Object.entries(RESULT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="entityType">Tipo de registro</Label>
            <Select id="entityType" name="entityType" defaultValue={query.entityType ?? ""} className="mt-1">
              <option value="">Todos</option>
              {options.entityTypes.map((e) => (
                <option key={e} value={e}>
                  {entityLabel(e)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="entityId">N° de registro</Label>
            <Input id="entityId" name="entityId" defaultValue={query.entityId} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="action">Acción (código)</Label>
            <Input id="action" name="action" defaultValue={query.action} placeholder="p. ej. annul" className="mt-1" />
          </div>
          <div className="lg:col-span-2">
            <Label htmlFor="q">Buscar</Label>
            <Input id="q" name="q" defaultValue={query.q} placeholder="Usuario, mensaje, IP o id de petición" className="mt-1" />
          </div>
          <div className="flex gap-2 lg:col-span-2">
            <button type="submit" className={buttonClass("primary")}>
              Filtrar
            </button>
            <LinkButton variant="secondary" href="/admin/auditoria">
              Limpiar
            </LinkButton>
          </div>
        </form>
      </Card>
      <Card>
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <Th>#</Th>
              <Th>Fecha y hora</Th>
              <Th>Usuario</Th>
              <Th>Módulo</Th>
              <Th>Acción</Th>
              <Th>Registro</Th>
              <Th>Resultado</Th>
              <Th>Detalle</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.rows.length === 0 && (
              <tr>
                <Td colSpan={8} className="text-center text-slate-500">
                  No hay registros de auditoría con esos filtros.
                </Td>
              </tr>
            )}
            {list.rows.map((r) => (
              <tr key={r.id}>
                <Td className="tabular-nums">
                  <Link className="text-blue-700 hover:underline" href={`/admin/auditoria/${r.id}`}>
                    {r.id}
                  </Link>
                </Td>
                <Td className="whitespace-normal!">{formatDateTime(r.occurredAt)}</Td>
                <Td>{r.username ?? <span className="text-slate-400">—</span>}</Td>
                <Td className="whitespace-normal!">{moduleLabel(r.module)}</Td>
                <Td className="whitespace-normal!" title={r.action}>
                  {actionLabel(r.action)}
                </Td>
                <Td className="whitespace-normal!">{r.entityType ? `${entityLabel(r.entityType)}${r.entityId ? ` #${r.entityId}` : ""}` : "—"}</Td>
                <Td>
                  <ResultBadge result={r.result} />
                </Td>
                <Td className="max-w-56 truncate" title={r.message ?? undefined}>
                  {r.message ?? ""}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} href={href} />
        {list.total > 0 && list.total <= list.pageSize && <p className="border-t border-slate-200 px-4 py-3 text-sm text-slate-600">{list.total} registros</p>}
      </Card>
    </>
  );
}
