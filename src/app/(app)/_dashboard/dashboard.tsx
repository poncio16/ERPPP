import Link from "next/link";
import type { ReactNode } from "react";
import { Alert, Card, cx } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { DashboardData, PartySide } from "@/modules/reports/dashboard";
import { BalanceEvolutionChart, CashFlowChart } from "./charts";

/** Dashboard (sección 33). Cada indicador enlaza al reporte o pantalla que lo detalla. */

function Kpi({ label, value, href, tone, hint }: { label: string; value: string; href: string; tone?: "red" | "green"; hint?: string }) {
  return (
    <Link href={href as never} className="group block rounded-lg border border-slate-200 p-3 transition hover:border-brand-600 hover:shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cx("mt-1 text-lg font-semibold tabular-nums wrap-anywhere", tone === "red" ? "text-red-700" : tone === "green" ? "text-emerald-700" : "text-slate-900")}>{value}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </Link>
  );
}

function Section({ title, href, linkLabel, children }: { title: string; href?: string; linkLabel?: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        {href && (
          <Link href={href as never} className="text-sm text-brand-700 hover:underline">
            {linkLabel ?? "Ver detalle"}
          </Link>
        )}
      </div>
      {children}
    </Card>
  );
}

function PartySection({ side, data }: { side: "AR" | "AP"; data: PartySide }) {
  const ar = side === "AR";
  const slug = ar ? "clientes" : "proveedores";
  return (
    <Section title={ar ? "Cuentas por cobrar" : "Cuentas por pagar"} href={`/reportes/${slug}-antiguedad`} linkLabel="Antigüedad de saldos">
      {/* Desde xl la sección ocupa media pantalla: cuatro indicadores en fila no entran con importes millonarios. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-2">
        <Kpi label="Total" value={formatMoney(data.total)} href={`/reportes/${slug}-deuda`} hint={data.credit !== "0.00" ? `Neto de ${formatMoney(data.credit)} sin aplicar` : undefined} />
        <Kpi label="Vencido" value={formatMoney(data.overdue)} href={`/reportes/${slug}-vencimientos`} tone={data.overdue !== "0.00" ? "red" : undefined} />
        <Kpi label="A vencer" value={formatMoney(data.notDue)} href={`/reportes/${slug}-vencimientos`} />
        {data.settledMonth !== null && (
          <Kpi
            label={ar ? "Cobranzas del mes" : "Pagos del mes"}
            value={formatMoney(data.settledMonth)}
            href={`/reportes/${ar ? "clientes-cobranzas" : "proveedores-pagos"}`}
            hint={`${data.settledCount} ${ar ? "cobranzas" : "pagos"}`}
          />
        )}
      </div>
      {ar && data.overLimit > 0 && (
        <div className="mt-3">
          <Alert tone="warning">
            <Link href="/reportes/clientes-deuda" className="hover:underline">
              {data.overLimit === 1 ? "1 cliente supera" : `${data.overLimit} clientes superan`} su límite de crédito.
            </Link>
          </Alert>
        </div>
      )}
      <h3 className="mt-4 mb-1 text-sm font-medium text-slate-700">{ar ? "Principales deudores" : "Principales proveedores"}</h3>
      {data.top.length === 0 ? (
        <p className="text-sm text-slate-500">{ar ? "Ningún cliente tiene deuda." : "No hay deuda con proveedores."}</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {data.top.map((p) => (
            <li key={p.partyId} className="flex items-center justify-between gap-3 py-1.5">
              <Link href={`/cuentas-corrientes/${slug}/${p.partyId}`} className="truncate text-brand-700 hover:underline">
                {p.name}
              </Link>
              <span className="shrink-0 tabular-nums">
                {formatMoney(p.balance)}
                {p.overdue !== "0.00" && <span className="ml-2 text-xs text-red-700">vencido {formatMoney(p.overdue)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function Dashboard({ data }: { data: DashboardData }) {
  const { receivable, payable, treasury, flow, management, evolution, backup } = data;
  return (
    <div className="space-y-4">
      {backup && backup.length > 0 && (
        <Alert tone="warning">
          <span className="font-semibold">Backups: </span>
          {backup.join(" ")}{" "}
          <Link className="underline" href="/admin/backups">
            Ver backups
          </Link>
        </Alert>
      )}
      {(receivable || payable) && (
        <div className="grid gap-4 xl:grid-cols-2">
          {receivable && <PartySection side="AR" data={receivable} />}
          {payable && <PartySection side="AP" data={payable} />}
        </div>
      )}
      {treasury && (
        <Section title="Tesorería" href="/tesoreria" linkLabel="Posición consolidada">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
            <Kpi label="Caja" value={formatMoney(treasury.cash)} href="/caja" />
            <Kpi label="Bancos" value={formatMoney(treasury.bankBook)} href="/bancos" hint={`Disponible ${formatMoney(treasury.bankAvailable)}`} />
            <Kpi label="Cheques en cartera" value={formatMoney(treasury.portfolio)} href="/reportes/cartera-cheques" hint={`${treasury.portfolioCount} cheques`} />
            <Kpi label="Cheques emitidos pendientes" value={formatMoney(treasury.ownPending)} href="/reportes/cheques-emitidos" hint={`${treasury.ownPendingCount} cheques`} />
            <Kpi label="Ingresos del mes" value={formatMoney(treasury.incomeMonth)} href="/reportes/ingresos-egresos" tone="green" />
            <Kpi label="Egresos del mes" value={formatMoney(treasury.expenseMonth)} href="/reportes/ingresos-egresos" tone="red" />
          </div>
        </Section>
      )}
      {management && (
        <Section title={`Gestión del mes (desde el ${formatDate(data.month.from)})`}>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Kpi label="Comprobantes emitidos registrados" value={formatMoney(management.issued.total)} href="/reportes/clientes-comprobantes" hint={`${management.issued.count} comprobantes (NC restan)`} />
            <Kpi label="Comprobantes recibidos registrados" value={formatMoney(management.received.total)} href="/reportes/proveedores-comprobantes" hint={`${management.received.count} comprobantes (NC restan)`} />
            {receivable?.settledMonth != null && <Kpi label="Cobranzas" value={formatMoney(receivable.settledMonth)} href="/reportes/clientes-cobranzas" hint={`${receivable.settledCount} operaciones`} />}
            {payable?.settledMonth != null && <Kpi label="Pagos" value={formatMoney(payable.settledMonth)} href="/reportes/proveedores-pagos" hint={`${payable.settledCount} operaciones`} />}
          </div>
        </Section>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {evolution && (
          <Section title="Evolución de cuentas por cobrar y por pagar" href="/reportes/clientes-deuda" linkLabel="Deuda a una fecha">
            <BalanceEvolutionChart points={evolution} />
            <p className="mt-2 text-xs text-slate-500">Saldo de cuentas corrientes al cierre de cada mes y hoy.</p>
          </Section>
        )}
        {flow && (
          <Section title="Flujo de fondos proyectado (8 semanas)" href="/reportes/flujo-de-fondos" linkLabel="Ver flujo de fondos">
            <CashFlowChart points={flow.points} />
            <p className="mt-2 text-xs text-slate-500">
              Proyectado desde hoy sobre un saldo real de {formatMoney(flow.opening)}
              {flow.late !== "0.00" ? `; atrasado neto ${formatMoney(flow.late)} (incluido en el saldo)` : ""}.
            </p>
          </Section>
        )}
      </div>
    </div>
  );
}
