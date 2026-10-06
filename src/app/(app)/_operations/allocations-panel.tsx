import Link from "next/link";
import { Alert, Card, Label, PageHeader, Select, Table, Td, Th, buttonClass, cx } from "@/components/ui";
import { formatCuit } from "@/lib/cuit";
import { formatDate, todayIso } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { allocationParty, availableCredits, openDebits, pendingAllocationParties } from "@/modules/allocations/service";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { AllocateCreditForm } from "./forms";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const SIDES = {
  clientes: { direction: "ISSUED", party: "Cliente", parties: "Clientes", docs: "/comprobantes-emitidos", ops: "/cobranzas" },
  proveedores: { direction: "RECEIVED", party: "Proveedor", parties: "Proveedores", docs: "/comprobantes-recibidos", ops: "/pagos" },
} as const;

/**
 * Panel de imputaciones posteriores: créditos sin aplicar (cobranzas o pagos con saldo, NC, saldos
 * iniciales acreedores) contra los comprobantes pendientes del mismo tercero.
 */
export async function AllocationsPanelPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, session } = await requirePagePermission("accounts.read");
  const sideKey = first(searchParams.lado) === "proveedores" ? "proveedores" : "clientes";
  const side = SIDES[sideKey];
  const partyId = Number(first(searchParams.tercero));
  const canAllocate = session.permissions.has("allocations.create");
  const pending = await pendingAllocationParties(db, ctx, side.direction);
  const party = Number.isSafeInteger(partyId) && partyId > 0 ? await allocationParty(db, ctx, side.direction, partyId) : null;
  const [credits, debits] = party ? await Promise.all([availableCredits(db, side.direction, party.id), openDebits(db, side.direction, party.id)]) : [[], []];
  const today = todayIso();

  return (
    <>
      <PageHeader
        title="Imputaciones"
        description="Aplicá saldos a favor, anticipos y notas de crédito contra los comprobantes pendientes del mismo tercero. Cada imputación se puede desimputar con motivo desde el comprobante o la operación."
      />
      <nav className="mb-4 flex border-b border-slate-200">
        {(Object.keys(SIDES) as (keyof typeof SIDES)[]).map((k) => (
          <Link
            key={k}
            href={`/imputaciones?lado=${k}`}
            className={cx("-mb-px border-b-2 px-4 py-2 text-sm font-medium", k === sideKey ? "border-brand-600 text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900")}
          >
            {SIDES[k].parties}
          </Link>
        ))}
      </nav>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <Card className="self-start">
          <form method="get" className="space-y-2 border-b border-slate-200 p-4">
            <input type="hidden" name="lado" value={sideKey} />
            <Label htmlFor="tercero">{side.party}</Label>
            <div className="flex gap-2">
              <Select id="tercero" name="tercero" defaultValue={party?.id ?? ""} className="min-w-0 flex-1">
                <option value="">Elegir…</option>
                {pending.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <button type="submit" className={buttonClass("secondary")}>
                Ver
              </button>
            </div>
          </form>
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Con crédito sin aplicar</Th>
                <Th className="text-right">Crédito</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pending.length === 0 && (
                <tr>
                  <Td colSpan={2} className="py-6 text-center text-slate-500">
                    No hay créditos sin aplicar.
                  </Td>
                </tr>
              )}
              {pending.map((p) => (
                <tr key={p.id} className={cx(p.id === party?.id && "bg-brand-50")}>
                  <Td className="whitespace-normal">
                    <Link href={`/imputaciones?lado=${sideKey}&tercero=${p.id}`} className="font-medium text-brand-700 hover:underline">
                      {p.name}
                    </Link>
                    {Number(p.debits) > 0 && <span className="block text-xs text-slate-500">Pendiente: {formatMoney(p.debits)}</span>}
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(p.credits)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <div className="space-y-4">
          {!party && <Alert>Elegí un {side.party.toLowerCase()} para ver sus créditos y comprobantes pendientes.</Alert>}
          {party && (
            <>
              <Card className="p-4">
                <p className="text-lg font-semibold text-slate-900">{party.name}</p>
                <p className="text-sm text-slate-600">{party.taxId ? `CUIT ${formatCuit(party.taxId)}` : "Sin CUIT"}</p>
              </Card>
              {credits.length === 0 && <Alert>Este {side.party.toLowerCase()} no tiene créditos sin aplicar.</Alert>}
              {credits.map((c) => (
                <Card key={`${c.kind}-${c.id}`} className="p-4">
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={c.kind === "CREDIT_DOCUMENT" ? `${side.docs}/${c.id}` : `${side.ops}/${c.id}`} className="font-semibold text-brand-700 hover:underline">
                      {c.label}
                    </Link>
                    <span className="text-sm text-slate-600">
                      {formatDate(c.date)} · Total {formatMoney(c.total)}
                    </span>
                  </div>
                  {canAllocate ? (
                    <AllocateCreditForm source={{ kind: c.kind, id: c.id }} available={c.available} openDebits={debits} today={today} />
                  ) : (
                    <p className="text-sm text-slate-600">
                      Disponible: <strong className="tabular-nums">{formatMoney(c.available)}</strong>. No tiene permiso para imputar.
                    </p>
                  )}
                </Card>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
