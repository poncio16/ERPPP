import Link from "next/link";
import { Badge, Card, Input, Label, LinkButton, PageHeader, Pagination, Select, Table, Td, Th, buttonClass } from "@/components/ui";
import { formatCuit } from "@/lib/cuit";
import { formatMoney } from "@/lib/money";
import { PartyListSchema, type PartyKind } from "@/modules/parties/schemas";
import { listParties, partyFormCatalogs } from "@/modules/parties/service";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { PARTY_UI } from "./config";

type SearchParams = Record<string, string | string[] | undefined>;

export async function PartyListPage({ kind, searchParams }: { kind: PartyKind; searchParams: SearchParams }) {
  const ui = PARTY_UI[kind];
  const { ctx, session } = await requirePagePermission(ui.perm.read);
  const raw = Object.fromEntries(Object.entries(searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const parsed = PartyListSchema.safeParse(raw);
  const query = parsed.success ? parsed.data : PartyListSchema.parse({});
  const [{ rows, total, page, pageSize }, catalogs] = await Promise.all([
    listParties(db, ctx, kind, query),
    partyFormCatalogs(db),
  ]);
  const showBalance = session.permissions.has("accounts.read");
  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (query.q) sp.set("q", query.q);
    if (query.status !== "ACTIVE") sp.set("status", query.status);
    if (query.vatConditionId) sp.set("vatConditionId", String(query.vatConditionId));
    if (query.provinceId) sp.set("provinceId", String(query.provinceId));
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `${ui.basePath}?${s}` : ui.basePath;
  };

  return (
    <>
      <PageHeader
        title={ui.plural}
        actions={session.permissions.has(ui.perm.write) && <LinkButton href={`${ui.basePath}/nuevo`}>Nuevo {ui.singular.toLowerCase()}</LinkButton>}
      />
      <Card className="mb-4 p-4">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] lg:items-end">
          <div>
            <Label htmlFor="q">Buscar</Label>
            <Input id="q" name="q" defaultValue={query.q} placeholder="Nombre, código, contacto o CUIT" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="status">Estado</Label>
            <Select id="status" name="status" defaultValue={query.status} className="mt-1">
              <option value="ACTIVE">Activos</option>
              <option value="INACTIVE">Dados de baja</option>
              <option value="ALL">Todos</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="vatConditionId">Condición IVA</Label>
            <Select id="vatConditionId" name="vatConditionId" defaultValue={query.vatConditionId ?? ""} className="mt-1">
              <option value="">Todas</option>
              {catalogs.vatConditions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="provinceId">Provincia</Label>
            <Select id="provinceId" name="provinceId" defaultValue={query.provinceId ?? ""} className="mt-1">
              <option value="">Todas</option>
              {catalogs.provinces.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass("secondary")}>
              Filtrar
            </button>
            <Link href={ui.basePath} className={buttonClass("ghost")}>
              Limpiar
            </Link>
          </div>
        </form>
      </Card>
      <Card>
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <Th>Código</Th>
              <Th>Razón social</Th>
              <Th>CUIT / Doc.</Th>
              <Th>Condición IVA</Th>
              <Th>Localidad</Th>
              <Th>Teléfono</Th>
              {showBalance && <Th className="text-right">Saldo</Th>}
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <Td colSpan={8} className="py-8 text-center text-slate-500">
                  No hay {ui.plural.toLowerCase()} que coincidan con la búsqueda.
                </Td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td className="font-mono text-xs">{r.code}</Td>
                <Td className="whitespace-normal">
                  <Link href={`${ui.basePath}/${r.id}`} className="font-medium text-brand-700 hover:underline">
                    {r.legalName}
                  </Link>
                </Td>
                <Td className="font-mono text-xs">{r.taxId ? formatCuit(r.taxId) : "—"}</Td>
                <Td className="whitespace-normal">{r.vatCondition}</Td>
                <Td className="whitespace-normal">{[r.city, r.province].filter(Boolean).join(", ") || "—"}</Td>
                <Td>{r.phone ?? "—"}</Td>
                {showBalance && <Td className="text-right tabular-nums">{formatMoney(r.balance ?? "0")}</Td>}
                <Td>{r.status === "ACTIVE" ? <Badge tone="green">Activo</Badge> : <Badge tone="red">Baja</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} href={pageHref} />
      </Card>
    </>
  );
}
