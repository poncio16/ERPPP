import Link from "next/link";
import { Badge, Card, Input, Label, PageHeader, Table, Td, Th, buttonClass, cx } from "@/components/ui";
import { formatDate, todayIso } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { consolidatedPosition, incomeExpenseByConcept, listPlannedItems } from "@/modules/treasury/consolidated";
import { ConsolidatedQuerySchema } from "@/modules/treasury/planning-schemas";
import { defaultLedgerPeriod, manualConcepts } from "@/modules/treasury/service";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { PlannedItemActions, PlannedItemForm } from "./planning-forms";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function Money({ value, strong }: { value: string; strong?: boolean }) {
  return <span className={cx("tabular-nums", value.startsWith("-") && "text-red-700", strong && "font-semibold")}>{formatMoney(value)}</span>;
}

function Stat({ label, value, hint, href }: { label: string; value: string; hint?: string; href?: string }) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">
        <Money value={value} />
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </>
  );
  return <Card className="p-4">{href ? <Link href={href} className="block hover:opacity-80">{body}</Link> : body}</Card>;
}

/** Tesorería consolidada (G.12): posición, ingresos y egresos por concepto, y proyectados. */
export async function ConsolidatedTreasuryPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, session } = await requirePagePermission("treasury.read");
  const raw = Object.fromEntries(Object.entries(searchParams).map(([k, v]) => [k, first(v) || undefined]));
  const query = ConsolidatedQuerySchema.parse(raw);
  const period = { ...defaultLedgerPeriod(), ...Object.fromEntries(Object.entries(query).filter(([, v]) => v)) } as { from: string; to: string };
  const canPlan = session.permissions.has("treasury.plan");
  const today = todayIso();
  const [pos, flows, planned, concepts] = await Promise.all([
    consolidatedPosition(db, ctx),
    incomeExpenseByConcept(db, ctx, period.from, period.to),
    listPlannedItems(db, ctx),
    canPlan ? manualConcepts(db) : Promise.resolve([]),
  ]);
  const t = pos.totals;

  return (
    <>
      <PageHeader
        title="Tesorería"
        description="Vista consolidada de cajas, bancos y cheques. Los saldos surgen de los movimientos registrados; los proyectados no los modifican."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Cajas" value={t.cash} href="/caja" hint={`${pos.cash.filter((a) => a.active).length} caja(s) activa(s)`} />
        <Stat label="Bancos (saldo contable)" value={t.bankBook} href="/bancos" hint={`Disponible ${formatMoney(t.bankAvailable)}`} />
        <Stat label="Cheques en cartera" value={t.portfolio} href="/cheques" hint={`${t.portfolioCount} cheque(s); ${formatMoney(t.deposited)} depositados a acreditar`} />
        <Stat label="Cheques propios pendientes" value={t.ownPending} href="/cheques/emitidos" hint={`${t.ownPendingCount} cheque(s) entregados sin debitar`} />
      </div>
      <Card className="mt-4 grid gap-2 p-4 text-sm sm:grid-cols-2">
        <p>
          Caja + bancos (saldo contable): <Money value={t.liquid} strong />
        </p>
        <p>
          Posición: caja + bancos disponibles + cartera + depositados: <Money value={t.position} strong />
        </p>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="px-4 pt-4 text-base font-semibold text-slate-900">Saldos por cuenta</h2>
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Cuenta</Th>
                <Th className="text-right">Saldo</Th>
                <Th className="text-right">Disponible</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...pos.cash, ...pos.banks]
                .filter((a) => a.active || a.balance !== "0.00")
                .map((a) => (
                  <tr key={`${a.kind}-${a.id}`}>
                    <Td className="whitespace-normal">
                      <Link href={`/${a.kind === "CASH" ? "caja" : "bancos"}/${a.id}`} className="text-brand-700 hover:underline">
                        {a.kind === "CASH" ? "Caja" : "Banco"} · {a.name}
                      </Link>
                      {!a.active && <span className="ml-2 text-xs text-slate-500">(inactiva)</span>}
                    </Td>
                    <Td className="text-right">
                      <Money value={a.balance} />
                    </Td>
                    <Td className="text-right">{a.available ? <Money value={a.available} /> : "—"}</Td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </Card>

        <Card>
          <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4">
            <h2 className="text-base font-semibold text-slate-900">Ingresos y egresos por concepto</h2>
            <form method="get" className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="from">Desde</Label>
                <Input id="from" name="from" type="date" defaultValue={period.from} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="to">Hasta</Label>
                <Input id="to" name="to" type="date" defaultValue={period.to} className="mt-1" />
              </div>
              <button type="submit" className={buttonClass("secondary")}>
                Ver
              </button>
            </form>
          </div>
          <p className="px-4 pt-2 text-xs text-slate-500">Las anulaciones se descuentan del concepto original. No incluye saldos iniciales ni transferencias entre cuentas propias.</p>
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Concepto</Th>
                <Th className="text-right">Ingresos</Th>
                <Th className="text-right">Egresos</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {flows.rows.length === 0 && (
                <tr>
                  <Td colSpan={3} className="py-6 text-center text-slate-500">
                    Sin movimientos entre el {formatDate(period.from)} y el {formatDate(period.to)}.
                  </Td>
                </tr>
              )}
              {flows.rows.map((r) => (
                <tr key={r.concept}>
                  <Td className="whitespace-normal">{r.concept}</Td>
                  <Td className="text-right">{r.income !== "0.00" ? <Money value={r.income} /> : ""}</Td>
                  <Td className="text-right">{r.expense !== "0.00" ? <Money value={r.expense} /> : ""}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-medium">
              <tr>
                <Td>Total · neto {formatMoney(flows.net)}</Td>
                <Td className="text-right">
                  <Money value={flows.income} />
                </Td>
                <Td className="text-right">
                  <Money value={flows.expense} />
                </Td>
              </tr>
            </tfoot>
          </Table>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Card>
          <h2 className="px-4 pt-4 text-base font-semibold text-slate-900">Ingresos y egresos proyectados</h2>
          <p className="px-4 pt-1 text-xs text-slate-500">
            Previsiones que no surgen de comprobantes (sueldos, alquileres, impuestos). No mueven saldos: se usan en el flujo de fondos. Al ocurrir, el movimiento real se registra por su circuito y el proyectado se marca como realizado.
          </p>
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Fecha</Th>
                <Th>Descripción</Th>
                <Th className="text-right">Importe</Th>
                {canPlan && <Th />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {planned.length === 0 && (
                <tr>
                  <Td colSpan={4} className="py-6 text-center text-slate-500">
                    No hay movimientos proyectados pendientes.
                  </Td>
                </tr>
              )}
              {planned.map((p) => (
                <tr key={p.id}>
                  <Td className={cx(p.expectedDate < today && "font-medium text-red-700")}>{formatDate(p.expectedDate)}</Td>
                  <Td className="whitespace-normal">
                    {p.description}
                    <span className="block text-xs text-slate-500">
                      {p.concept ?? "Sin concepto"}
                      {p.recurrence === "MONTHLY" && " · todos los meses"}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <Badge tone={p.direction === "IN" ? "green" : "amber"}>{p.direction === "IN" ? "Ingreso" : "Egreso"}</Badge>
                    <span className="ml-2 tabular-nums">{formatMoney(p.amount)}</span>
                  </Td>
                  {canPlan && (
                    <Td>
                      <PlannedItemActions id={p.id} />
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        {canPlan && (
          <Card className="self-start p-4">
            <h2 className="mb-3 text-base font-semibold text-slate-900">Nuevo proyectado</h2>
            <PlannedItemForm concepts={concepts} today={today} />
          </Card>
        )}
      </div>
    </>
  );
}
