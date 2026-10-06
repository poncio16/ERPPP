import Link from "next/link";
import { Badge, Card, PageHeader, Pagination, Table, Td, Th, cx } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { RefundListSchema } from "@/modules/refunds/schemas";
import { REFUND_PAGE_SIZE, listRefunds } from "@/modules/refunds/service";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { AnnulRefundButton } from "./refund-forms";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Devoluciones de saldo a favor a clientes y reintegros de anticipos de proveedores (D14). */
export async function RefundsPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, session } = await requirePagePermission("treasury.read");
  const query = RefundListSchema.parse(Object.fromEntries(Object.entries(searchParams).map(([k, v]) => [k, first(v) || undefined])));
  const ledger = query.lado === "proveedores" ? "AP" : query.lado === "clientes" ? "AR" : undefined;
  const list = await listRefunds(db, ctx, { ledger, page: query.page });
  const canAnnul = session.permissions.has("refunds.annul");
  const href = (page: number) => {
    const sp = new URLSearchParams();
    if (query.lado) sp.set("lado", query.lado);
    if (page > 1) sp.set("page", String(page));
    const s = sp.toString();
    return s ? `/devoluciones?${s}` : "/devoluciones";
  };
  const tab = (lado: string | undefined, label: string) => (
    <Link
      href={lado ? `/devoluciones?lado=${lado}` : "/devoluciones"}
      className={cx("-mb-px border-b-2 px-4 py-2 text-sm font-medium", query.lado === lado ? "border-brand-600 text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900")}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Devoluciones"
        description="Saldos a favor devueltos a clientes y anticipos reintegrados por proveedores. Se registran desde Imputaciones y se corrigen anulando."
      />
      <nav className="mb-4 flex border-b border-slate-200">
        {tab(undefined, "Todas")}
        {tab("clientes", "A clientes")}
        {tab("proveedores", "De proveedores")}
      </nav>
      <Card>
        <Table>
          <thead className="bg-slate-50">
            <tr>
              <Th>Fecha</Th>
              <Th>Tercero</Th>
              <Th>Crédito devuelto</Th>
              <Th>Medio</Th>
              <Th className="text-right">Importe</Th>
              <Th>Estado</Th>
              {canAnnul && <Th />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.rows.length === 0 && (
              <tr>
                <Td colSpan={7} className="py-8 text-center text-slate-500">
                  No hay devoluciones registradas.
                </Td>
              </tr>
            )}
            {list.rows.map((r) => {
              const docs = r.ledger === "AR" ? "/comprobantes-emitidos" : "/comprobantes-recibidos";
              return (
                <tr key={r.id} className={r.status === "ANNULLED" ? "text-slate-400" : undefined}>
                  <Td>{formatDate(r.date)}</Td>
                  <Td className="whitespace-normal">
                    <Link href={`/${r.ledger === "AR" ? "clientes" : "proveedores"}/${r.partyId}`} className="text-brand-700 hover:underline">
                      {r.partyName}
                    </Link>
                    <span className="block text-xs text-slate-500">{r.ledger === "AR" ? "Devolución al cliente" : "Reintegro del proveedor"}</span>
                  </Td>
                  <Td className="whitespace-normal">
                    {r.sourceLabel ?? "—"}
                    <Link href={`${docs}/${r.documentId}`} className="block text-xs text-brand-700 hover:underline">
                      Débito interno
                    </Link>
                  </Td>
                  <Td className="whitespace-normal">
                    {r.method === "CASH" ? "Efectivo" : "Transferencia"} · {r.accountName}
                    {r.reference && <span className="block text-xs text-slate-500">Ref. {r.reference}</span>}
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(r.amount)}</Td>
                  <Td className="whitespace-normal">
                    {r.status === "ACTIVE" ? <Badge tone="green">Vigente</Badge> : <Badge tone="slate">Anulada</Badge>}
                    {r.annulReason && <span className="block text-xs">{r.annulReason}</span>}
                  </Td>
                  {canAnnul && <Td className="whitespace-normal">{r.status === "ACTIVE" && <AnnulRefundButton id={r.id} />}</Td>}
                </tr>
              );
            })}
          </tbody>
        </Table>
        <Pagination page={list.page} pageSize={REFUND_PAGE_SIZE} total={list.total} href={href} />
      </Card>
    </>
  );
}
