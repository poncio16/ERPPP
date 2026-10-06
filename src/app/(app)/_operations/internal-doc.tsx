import { formatCuit } from "@/lib/cuit";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { CompanyHeader } from "@/modules/internal-docs/service";
import type { InternalDocData } from "@/modules/internal-docs/types";

/**
 * Recibo interno u orden de pago interna en pantalla, con estilos para imprimir en A4 (G.13).
 * Lleva siempre la leyenda de documento no fiscal; si la operación fue anulada, la marca ANULADO.
 */

export const INTERNAL_DOC_TITLE = {
  RECEIPT: "Recibo interno de registración de cobranza",
  PAYMENT_ORDER: "Orden de pago interna",
} as const;
export const NON_FISCAL_LEGEND = "Documento interno – no válido como comprobante fiscal";

const METHOD: Record<string, string> = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia",
  CHECK: "Cheque",
  OWN_CHECK: "Cheque propio",
  THIRD_PARTY_CHECK: "Cheque de terceros (endoso)",
  RETENTION: "Retención",
};

export function InternalDocument({ data, company }: { data: InternalDocData; company: CompanyHeader | null }) {
  const annulled = data.status === "ANNULLED";
  const retentions = data.lines.filter((l) => l.method === "RETENTION");
  return (
    <article className="relative mx-auto max-w-3xl overflow-hidden rounded-lg border border-slate-300 bg-white p-8 text-sm text-slate-900 print:max-w-none print:border-0 print:p-0">
      {annulled && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-30 text-8xl font-black tracking-widest text-red-600/20">ANULADO</span>
        </div>
      )}
      <header className="flex flex-wrap justify-between gap-4 border-b border-slate-300 pb-4">
        <div>
          <p className="text-lg font-bold">{company?.legalName ?? "Empresa (configurar datos)"}</p>
          {company?.tradeName && <p>{company.tradeName}</p>}
          {company && (
            <>
              <p>CUIT {formatCuit(company.taxId)} · {company.vatCondition}</p>
              {(company.address || company.city) && <p>{[company.address, company.city, company.province, company.postalCode].filter(Boolean).join(", ")}</p>}
              {company.grossIncomeNumber && <p>IIBB {company.grossIncomeNumber}</p>}
            </>
          )}
        </div>
        <div className="text-right">
          <p className="text-base font-bold uppercase">{INTERNAL_DOC_TITLE[data.kind]}</p>
          <p className="text-lg font-semibold">N° {data.number}</p>
          <p>Fecha: {formatDate(data.issueDate)}</p>
          <p className="mt-1 rounded border border-slate-400 px-2 py-0.5 text-xs font-semibold uppercase">{NON_FISCAL_LEGEND}</p>
          {annulled && <p className="mt-1 font-bold text-red-700">ANULADO</p>}
        </div>
      </header>

      <section className="grid gap-1 border-b border-slate-300 py-4 sm:grid-cols-2">
        <p>
          <span className="font-semibold">{data.partyLabel}:</span> {data.partyName}
        </p>
        <p>
          <span className="font-semibold">CUIT:</span> {data.partyTaxId ? formatCuit(data.partyTaxId) : "—"}
        </p>
        <p className="sm:col-span-2">
          <span className="font-semibold">{data.kind === "RECEIPT" ? "Recibimos la suma de" : "Se paga la suma de"}:</span> {formatMoney(data.amount)}
        </p>
        <p className="italic sm:col-span-2">{data.amountInWords}</p>
      </section>

      <section className="py-4">
        <h2 className="mb-2 font-semibold uppercase">{data.kind === "RECEIPT" ? "Medios de cobro" : "Medios de pago"}</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left">
              <th className="py-1 pr-2">Medio</th>
              <th className="py-1 pr-2">Detalle</th>
              <th className="py-1 text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.id} className="border-b border-slate-100 align-top">
                <td className="py-1 pr-2">{METHOD[l.method] ?? l.method}</td>
                <td className="py-1 pr-2">{l.detail}</td>
                <td className="py-1 text-right tabular-nums">{formatMoney(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td colSpan={2} className="py-1 pr-2 text-right">
                Total
              </td>
              <td className="py-1 text-right tabular-nums">{formatMoney(data.amount)}</td>
            </tr>
          </tfoot>
        </table>
        {data.kind === "PAYMENT_ORDER" && retentions.length > 0 && (
          <p className="mt-2 text-xs">
            Retenciones practicadas: {retentions.map((r) => `${r.detail} (${formatMoney(r.amount)})`).join("; ")}.
          </p>
        )}
      </section>

      <section className="border-t border-slate-300 py-4">
        <h2 className="mb-2 font-semibold uppercase">Comprobantes imputados</h2>
        {data.allocations.length === 0 ? (
          <p>Sin imputación al registrar.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <tbody>
              {data.allocations.map((a, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1 pr-2">{a.label}</td>
                  <td className="py-1 text-right tabular-nums">{formatMoney(a.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {Number(data.unapplied) > 0 && (
          <p className="mt-2">
            {data.kind === "RECEIPT" ? "Saldo a favor del cliente" : "Anticipo / saldo a favor ante el proveedor"}: <strong className="tabular-nums">{formatMoney(data.unapplied)}</strong>
          </p>
        )}
      </section>

      {data.notes && (
        <section className="border-t border-slate-300 py-4">
          <h2 className="mb-1 font-semibold uppercase">Observaciones</h2>
          <p className="whitespace-pre-line">{data.notes}</p>
        </section>
      )}

      <footer className="mt-8 grid gap-8 border-t border-slate-300 pt-4 text-xs sm:grid-cols-2">
        <p>
          Registrado por {data.createdBy ?? "—"} el {formatDateTime(data.createdAt)}.
        </p>
        <p className="text-center">
          <span className="block border-t border-slate-500 pt-1">Firma y aclaración</span>
        </p>
      </footer>
    </article>
  );
}
