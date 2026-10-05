"use client";

import Decimal from "decimal.js";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Alert, FieldErrors, Input, Label, LinkButton, Select, buttonClass, cx, inputClass } from "@/components/ui";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatCuit } from "@/lib/cuit";
import { formatMoney, parseAmount } from "@/lib/money";
import {
  checkDocumentDuplicateAction,
  linkableDocumentsAction,
  registerIssuedDocumentAction,
  registerReceivedDocumentAction,
} from "@/modules/documents/actions";
import { computeDocumentTotals, expectedVat, formatDocumentNumber } from "@/modules/tax/calc";
import type { Direction } from "@/server/db/schema";

export interface FormDocType {
  id: number;
  name: string;
  letter: string | null;
  class: string;
  vatCreditable: boolean;
}
export interface FormParty {
  id: number;
  code: string;
  legalName: string;
  taxId: string | null;
  creditDays: number;
}
export interface FormTax {
  id: number;
  name: string;
  code: string;
  kind: string;
  rate: string | null;
  validFrom: string;
  validTo: string | null;
}
export interface DocumentFormInitial {
  documentTypeId: string;
  pointOfSale: string;
  number: string;
  partyId: string;
  issueDate: string;
  dueDate: string;
  vatPeriod: string;
  concept: string;
  description: string;
  externalRef: string;
  currency: string;
  exchangeRate: string;
  netUntaxed: string;
  netExempt: string;
  discount: string;
  vat: { taxId: string; base: string; amount: string }[];
  other: { taxId: string; amount: string; jurisdictionId: string }[];
  reason: string;
}

interface Linkable {
  id: number;
  typeName: string;
  pointOfSale: number;
  number: number;
  issueDate: string;
  total: string;
  balance: string;
}

const amountOrZero = (v: string) => parseAmount(v || "0") ?? null;
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function DocumentForm({
  direction,
  basePath,
  partyLabel,
  types,
  parties,
  taxes,
  jurisdictions,
  initial,
  idempotencyKey,
}: {
  direction: Direction;
  basePath: string;
  partyLabel: string;
  types: FormDocType[];
  parties: FormParty[];
  taxes: FormTax[];
  jurisdictions: { id: number; name: string }[];
  initial: DocumentFormInitial;
  idempotencyKey: string;
}) {
  const action = direction === "ISSUED" ? registerIssuedDocumentAction : registerReceivedDocumentAction;
  const { state, pending, onSubmit } = useActionForm(action);
  const router = useRouter();
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const warnings = fe?._warnings;

  const [typeId, setTypeId] = useState(initial.documentTypeId);
  const [partyId, setPartyId] = useState(initial.partyId);
  const [pos, setPos] = useState(initial.pointOfSale);
  const [number, setNumber] = useState(initial.number);
  const [issueDate, setIssueDate] = useState(initial.issueDate);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [dueTouched, setDueTouched] = useState(Boolean(initial.dueDate));
  const [currency, setCurrency] = useState(initial.currency || "ARS");
  const [exchangeRate, setExchangeRate] = useState(initial.exchangeRate || "1");
  const [amounts, setAmounts] = useState({ netUntaxed: initial.netUntaxed, netExempt: initial.netExempt, discount: initial.discount });
  const [vat, setVat] = useState(initial.vat.length ? initial.vat : [{ taxId: "", base: "", amount: "" }]);
  const [other, setOther] = useState(initial.other);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [linkableFor, setLinkableFor] = useState<{ partyId: string; rows: Linkable[] }>({ partyId: "", rows: [] });

  const type = types.find((t) => String(t.id) === typeId);
  const party = parties.find((p) => String(p.id) === partyId);
  const isNote = type?.class === "CREDIT_NOTE" || type?.class === "DEBIT_NOTE";
  const noVat = (direction === "RECEIVED" && type && !type.vatCreditable) || type?.letter === "E";
  const validTaxes = taxes.filter((t) => t.validFrom <= issueDate && (!t.validTo || t.validTo >= issueDate));
  const vatTaxes = validTaxes.filter((t) => t.kind === "VAT");
  const otherTaxes = validTaxes.filter((t) => t.kind === "PERCEPTION" || t.kind === "OTHER_TAX");

  // Vencimiento sugerido: fecha + días de plazo del tercero (editable, G.1-5).
  const effectiveDue = !dueTouched && issueDate && party ? addDays(issueDate, party.creditDays) : dueDate;

  // Comprobantes vinculables para NC / ND.
  useEffect(() => {
    let cancelled = false;
    if (isNote && partyId) {
      linkableDocumentsAction({ direction, partyId: Number(partyId) }).then((r) => {
        if (!cancelled) setLinkableFor({ partyId, rows: r.ok ? (r.data as Linkable[]) : [] });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [isNote, partyId, direction]);

  const linkable = isNote && linkableFor.partyId === partyId ? linkableFor.rows : [];

  useEffect(() => {
    if (state?.ok) router.push(`${basePath}/${(state.data as { id: number }).id}?registrado=1`);
  }, [state, router, basePath]);

  // Aviso de duplicado al completar tipo, punto de venta y número (G.1-3).
  const checkDuplicate = async () => {
    setDuplicate(null);
    if (!typeId || !pos || !number || (direction === "RECEIVED" && !partyId)) return;
    const r = await checkDocumentDuplicateAction({ direction, documentTypeId: typeId, pointOfSale: pos, number, partyId: partyId || undefined });
    if (r.ok && (r.data as { duplicate: boolean }).duplicate) setDuplicate((r.data as { message: string }).message);
  };

  // Vista previa del total con el mismo cálculo que hace el servidor.
  const preview = useMemo(() => {
    const fx = currency === "ARS" ? new Decimal(1) : parseAmount(exchangeRate);
    const parsedVat = vat
      .filter((l) => l.taxId)
      .map((l) => ({ taxId: Number(l.taxId), rate: vatTaxes.find((t) => String(t.id) === l.taxId)?.rate ?? "0", base: amountOrZero(l.base), amount: amountOrZero(l.amount) }));
    const parsedOther = other
      .filter((l) => l.taxId)
      .map((l) => ({ taxId: Number(l.taxId), kind: (otherTaxes.find((t) => String(t.id) === l.taxId)?.kind ?? "OTHER_TAX") as "PERCEPTION" | "OTHER_TAX", amount: amountOrZero(l.amount), jurisdictionId: l.jurisdictionId ? Number(l.jurisdictionId) : null }));
    const nu = amountOrZero(amounts.netUntaxed);
    const ne = amountOrZero(amounts.netExempt);
    const di = amountOrZero(amounts.discount);
    if (!fx || !nu || !ne || !di || parsedVat.some((l) => !l.base || !l.amount) || parsedOther.some((l) => !l.amount)) return null;
    const r = computeDocumentTotals({
      vatLines: parsedVat.map((l) => ({ ...l, base: l.base!, amount: l.amount! })),
      otherLines: parsedOther.map((l) => ({ ...l, amount: l.amount! })),
      netUntaxed: nu,
      netExempt: ne,
      discount: di,
      exchangeRate: fx,
      vatTolerance: new Decimal("1e9"),
    });
    return "totals" in r ? r.totals : null;
  }, [vat, other, amounts, currency, exchangeRate, vatTaxes, otherTaxes]);

  const updateVat = (i: number, patch: Partial<(typeof vat)[number]>) =>
    setVat((rows) => rows.map((r, j) => {
      if (j !== i) return r;
      const next = { ...r, ...patch };
      // Al cargar la base, se propone el IVA de la alícuota (el usuario lo ajusta si el comprobante dice otra cosa).
      if (patch.base !== undefined && !r.amount && next.taxId) {
        const rate = vatTaxes.find((t) => String(t.id) === next.taxId)?.rate;
        const b = parseAmount(patch.base);
        if (rate && b) next.amount = expectedVat(b, rate).toFixed(2).replace(".", ",");
      }
      return next;
    }));
  const updateOther = (i: number, patch: Partial<(typeof other)[number]>) => setOther((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <ActionForm pending={pending} onSubmit={onSubmit} className="space-y-8">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {state && !state.ok && !warnings && <Alert tone="error">{state.error}</Alert>}
      {warnings && (
        <Alert tone="warning">
          <p className="font-medium">Revise antes de registrar:</p>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <label className="mt-3 flex items-center gap-2 font-medium">
            <input type="checkbox" name="confirmWarnings" value="1" className="h-4 w-4" required />
            Confirmo que el comprobante es así y quiero registrarlo igual
          </label>
        </Alert>
      )}

      <section className="grid gap-4 md:grid-cols-4">
        <h2 className="text-sm font-semibold text-slate-900 md:col-span-4">Comprobante</h2>
        <div className="md:col-span-2">
          <Label htmlFor="f-documentTypeId">Tipo</Label>
          <Select id="f-documentTypeId" name="documentTypeId" value={typeId} onChange={(e) => setTypeId(e.target.value)} onBlur={checkDuplicate} className="mt-1" required>
            <option value="">Elegir…</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <FieldErrors errors={fe?.documentTypeId} />
        </div>
        <div>
          <Label htmlFor="f-pointOfSale">Punto de venta</Label>
          <Input id="f-pointOfSale" name="pointOfSale" inputMode="numeric" value={pos} onChange={(e) => setPos(e.target.value.replace(/\D/g, "").slice(0, 5))} onBlur={checkDuplicate} className="mt-1" required />
          <FieldErrors errors={fe?.pointOfSale} />
        </div>
        <div>
          <Label htmlFor="f-number">Número</Label>
          <Input id="f-number" name="number" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 8))} onBlur={checkDuplicate} className="mt-1" required />
          <FieldErrors errors={fe?.number} />
        </div>
        {pos && number && (
          <p className="text-xs text-slate-500 md:col-span-4">
            Se registra como {formatDocumentNumber(Number(pos), Number(number))}. El ERP no genera ni modifica la numeración fiscal.
          </p>
        )}
        {duplicate && (
          <div className="md:col-span-4">
            <Alert tone="error">{duplicate}</Alert>
          </div>
        )}
        <div className="md:col-span-2">
          <Label htmlFor="f-partyId">{partyLabel}</Label>
          <Select id="f-partyId" name="partyId" value={partyId} onChange={(e) => setPartyId(e.target.value)} onBlur={checkDuplicate} className="mt-1" required>
            <option value="">Elegir…</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.legalName} {p.taxId ? `· ${formatCuit(p.taxId)}` : ""}
              </option>
            ))}
          </Select>
          <FieldErrors errors={fe?.partyId} />
        </div>
        <div>
          <Label htmlFor="f-issueDate">Fecha</Label>
          <Input id="f-issueDate" name="issueDate" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="mt-1" required />
          <FieldErrors errors={fe?.issueDate} />
        </div>
        <div>
          <Label htmlFor="f-dueDate">Vencimiento</Label>
          <Input
            id="f-dueDate"
            name="dueDate"
            type="date"
            value={effectiveDue}
            min={issueDate}
            onChange={(e) => {
              setDueTouched(true);
              setDueDate(e.target.value);
            }}
            className="mt-1"
            required
          />
          <FieldErrors errors={fe?.dueDate} />
        </div>
        {direction === "RECEIVED" && (
          <div>
            <Label htmlFor="f-vatPeriod">Período de IVA</Label>
            <Input id="f-vatPeriod" name="vatPeriod" type="month" defaultValue={initial.vatPeriod} min={issueDate.slice(0, 7)} className="mt-1" />
            <p className="mt-1 text-xs text-slate-500">Vacío = mes del comprobante.</p>
            <FieldErrors errors={fe?.vatPeriod} />
          </div>
        )}
        <div>
          <Label htmlFor="f-concept">Concepto</Label>
          <Select id="f-concept" name="concept" defaultValue={initial.concept} className="mt-1">
            <option value="">—</option>
            <option value="PRODUCTS">Productos</option>
            <option value="SERVICES">Servicios</option>
            <option value="BOTH">Productos y servicios</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="f-currency">Moneda</Label>
          <Select
            id="f-currency"
            name="currency"
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value);
              if (e.target.value === "ARS") setExchangeRate("1");
            }}
            className="mt-1"
          >
            <option value="ARS">Pesos (ARS)</option>
            <option value="USD">Dólares (USD)</option>
            <option value="EUR">Euros (EUR)</option>
          </Select>
        </div>
        {currency !== "ARS" && (
          <div>
            <Label htmlFor="f-exchangeRate">Cotización</Label>
            <Input id="f-exchangeRate" name="exchangeRate" inputMode="decimal" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} className="mt-1" required />
            <p className="mt-1 text-xs text-slate-500">Importes en {currency}; se registran en pesos a esta cotización.</p>
            <FieldErrors errors={fe?.exchangeRate} />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">IVA por alícuota</h2>
        {noVat ? (
          <p className="text-sm text-slate-600">
            {type?.letter === "E" ? "Los comprobantes de exportación no llevan IVA." : `${type?.name} no discrimina IVA: cargue el importe total en "No gravado / IVA no discriminado".`}
          </p>
        ) : (
          <>
            {vat.map((l, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-start">
                <Select name="vatTaxId[]" value={l.taxId} onChange={(e) => updateVat(i, { taxId: e.target.value })} aria-label="Alícuota">
                  <option value="">Alícuota…</option>
                  {vatTaxes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
                <Input name="vatBase[]" inputMode="decimal" placeholder="Neto gravado" value={l.base} onChange={(e) => updateVat(i, { base: e.target.value })} aria-label="Neto gravado" />
                <Input name="vatAmount[]" inputMode="decimal" placeholder="IVA" value={l.amount} onChange={(e) => updateVat(i, { amount: e.target.value })} aria-label="IVA" />
                <button type="button" className={buttonClass("ghost")} onClick={() => setVat((rows) => rows.filter((_, j) => j !== i))} aria-label="Quitar línea">
                  Quitar
                </button>
                <div className="sm:col-span-4">
                  <FieldErrors errors={fe?.[`vat.${i}`]} />
                </div>
              </div>
            ))}
            <button type="button" className={buttonClass("secondary")} onClick={() => setVat((rows) => [...rows, { taxId: "", base: "", amount: "" }])}>
              Agregar alícuota
            </button>
          </>
        )}
        <FieldErrors errors={fe?.vat} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Percepciones y otros impuestos</h2>
        {other.map((l, i) => {
          const t = otherTaxes.find((x) => String(x.id) === l.taxId);
          return (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-start">
              <Select name="otherTaxId[]" value={l.taxId} onChange={(e) => updateOther(i, { taxId: e.target.value })} aria-label="Concepto">
                <option value="">Concepto…</option>
                {otherTaxes.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
              <Select name="otherJurisdictionId[]" value={l.jurisdictionId} onChange={(e) => updateOther(i, { jurisdictionId: e.target.value })} aria-label="Jurisdicción" disabled={!t || t.kind !== "PERCEPTION"}>
                <option value="">{t?.code.startsWith("PERC_IIBB") ? "Jurisdicción…" : "Sin jurisdicción"}</option>
                {jurisdictions.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </Select>
              <Input name="otherAmount[]" inputMode="decimal" placeholder="Importe" value={l.amount} onChange={(e) => updateOther(i, { amount: e.target.value })} aria-label="Importe" />
              <button type="button" className={buttonClass("ghost")} onClick={() => setOther((rows) => rows.filter((_, j) => j !== i))}>
                Quitar
              </button>
              <div className="sm:col-span-4">
                <FieldErrors errors={fe?.[`other.${i}`]} />
              </div>
            </div>
          );
        })}
        <button type="button" className={buttonClass("secondary")} onClick={() => setOther((rows) => [...rows, { taxId: "", amount: "", jurisdictionId: "" }])}>
          Agregar percepción u otro impuesto
        </button>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <h2 className="text-sm font-semibold text-slate-900 md:col-span-4">Otros importes</h2>
        {(
          [
            ["netUntaxed", noVat && type?.letter !== "E" ? "No gravado / IVA no discriminado" : "No gravado"],
            ["netExempt", "Exento"],
            ["discount", "Descuentos / deducciones"],
          ] as const
        ).map(([k, label]) => (
          <div key={k}>
            <Label htmlFor={`f-${k}`}>{label}</Label>
            <Input id={`f-${k}`} name={k} inputMode="decimal" value={amounts[k]} onChange={(e) => setAmounts((a) => ({ ...a, [k]: e.target.value }))} className="mt-1" />
            <FieldErrors errors={fe?.[k]} />
          </div>
        ))}
        <div>
          <Label htmlFor="f-controlTotal">Total según comprobante (control)</Label>
          <Input id="f-controlTotal" name="controlTotal" inputMode="decimal" className="mt-1" />
          <FieldErrors errors={fe?.controlTotal} />
        </div>
      </section>

      <div className="rounded-md bg-slate-50 p-4 text-sm">
        {preview ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
            <dt className="text-slate-500">Neto gravado</dt>
            <dd className="text-right tabular-nums">{formatMoney(preview.netTaxed)}</dd>
            <dt className="text-slate-500">IVA</dt>
            <dd className="text-right tabular-nums">{formatMoney(preview.vatTotal)}</dd>
            <dt className="text-slate-500">Percepciones</dt>
            <dd className="text-right tabular-nums">{formatMoney(preview.perceptionsTotal)}</dd>
            <dt className="text-slate-500">Otros impuestos</dt>
            <dd className="text-right tabular-nums">{formatMoney(preview.otherTaxesTotal)}</dd>
            <dt className="font-semibold text-slate-900">Total{currency !== "ARS" ? " en pesos" : ""}</dt>
            <dd className="text-right text-base font-semibold tabular-nums">{formatMoney(preview.total)}</dd>
          </dl>
        ) : (
          <p className="text-slate-500">Complete los importes para ver el total. El total no se escribe: se calcula de sus componentes.</p>
        )}
        <FieldErrors errors={fe?.total} />
      </div>

      {isNote && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">{type?.class === "CREDIT_NOTE" ? "Nota de crédito" : "Nota de débito"}</h2>
          <div>
            <Label htmlFor="f-reason">Motivo</Label>
            <Input id="f-reason" name="reason" defaultValue={initial.reason} maxLength={300} className="mt-1" required />
            <FieldErrors errors={fe?.reason} />
          </div>
          <fieldset>
            <legend className="text-sm font-medium text-slate-700">Comprobante original</legend>
            {!partyId && <p className="mt-1 text-sm text-slate-500">Elija primero el {partyLabel.toLowerCase()}.</p>}
            {partyId && linkable.length === 0 && <p className="mt-1 text-sm text-slate-500">No hay facturas ni notas de débito vigentes de este {partyLabel.toLowerCase()}.</p>}
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {linkable.map((d) => (
                <li key={d.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="relatedDocumentIds[]" value={d.id} className="h-4 w-4" />
                    {d.typeName} {formatDocumentNumber(d.pointOfSale, d.number)} · {d.issueDate.split("-").reverse().join("/")} · total {formatMoney(d.total)} · saldo {formatMoney(d.balance)}
                  </label>
                </li>
              ))}
            </ul>
            <FieldErrors errors={fe?.relatedDocumentIds} />
            {type?.class === "CREDIT_NOTE" && (
              <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="unlinkedCreditNote" value="1" className="h-4 w-4" />
                Nota de crédito sin comprobante asociado (por ejemplo, bonificación global)
              </label>
            )}
          </fieldset>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="f-description">Descripción</Label>
          <textarea id="f-description" name="description" defaultValue={initial.description} maxLength={500} rows={2} className={cx(inputClass, "mt-1")} />
        </div>
        <div>
          <Label htmlFor="f-externalRef">Referencia en el sistema de facturación</Label>
          <Input id="f-externalRef" name="externalRef" defaultValue={initial.externalRef} maxLength={100} className="mt-1" />
        </div>
      </section>

      <div className="flex gap-3">
        <SubmitButton pendingText="Registrando…">Registrar comprobante</SubmitButton>
        <LinkButton variant="secondary" href={basePath}>
          Cancelar
        </LinkButton>
      </div>
    </ActionForm>
  );
}
