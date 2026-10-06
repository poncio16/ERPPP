"use client";

import Decimal from "decimal.js";
import { useState } from "react";
import { Alert, Button, Input, TextareaField, cx } from "@/components/ui";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { FormError, fieldErrorsOf, useResetOnSuccess } from "@/components/ui/form-feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { allocateAction, reverseAllocationAction } from "@/modules/allocations/actions";
import { proposeFifo } from "@/modules/allocations/plan";
import { annulCollectionAction } from "@/modules/collections/actions";
import { annulPaymentAction } from "@/modules/payments/actions";
import { formatDate } from "@/lib/format";
import { formatMoney, parseAmount } from "@/lib/money";
import type { OpenDebitOption } from "./operation-form";

/** Anulación de una cobranza o un pago (motivo obligatorio; revierte todo lo que generó). */
export function AnnulOperationForm({ kind, id }: { kind: "COLLECTION" | "PAYMENT"; id: number }) {
  const { state, pending, onSubmit } = useActionForm(kind === "COLLECTION" ? annulCollectionAction : annulPaymentAction);
  const what = kind === "COLLECTION" ? "la cobranza" : "el pago";
  return (
    <ActionForm
      pending={pending}
      onSubmit={onSubmit}
      confirmMessage={`¿Anular ${what}? Se revierten sus imputaciones, movimientos de caja y bancos, cheques y el asiento de cuenta corriente.`}
      className="space-y-3"
    >
      <input type="hidden" name="id" value={id} />
      <TextareaField label="Motivo de la anulación" name="reason" rows={2} required minLength={5} maxLength={300} errors={fieldErrorsOf(state)?.reason} />
      <FormError state={state} />
      {state?.ok && <Alert tone="success">Operación anulada.</Alert>}
      <SubmitButton variant="danger" pendingText="Anulando…">
        Anular {what}
      </SubmitButton>
    </ActionForm>
  );
}

/** Desimputación de una imputación activa, con motivo. */
export function ReverseAllocationButton({ id, label }: { id: number; label: string }) {
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useActionForm(reverseAllocationAction);
  if (!open) {
    return (
      <button type="button" className="text-sm text-red-700 hover:underline" onClick={() => setOpen(true)}>
        Desimputar
      </button>
    );
  }
  return (
    <ActionForm pending={pending} onSubmit={onSubmit} confirmMessage={`¿Desimputar ${label}?`} className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="id" value={id} />
      <div>
        <Input name="reason" placeholder="Motivo" required minLength={5} maxLength={300} className="w-56" aria-label="Motivo de la desimputación" />
        {fieldErrorsOf(state)?.reason && <p className="mt-1 text-xs text-red-700">{fieldErrorsOf(state)!.reason![0]}</p>}
        {state && !state.ok && !fieldErrorsOf(state)?.reason && <p className="mt-1 text-xs text-red-700">{state.error}</p>}
      </div>
      <SubmitButton variant="danger" pendingText="…">
        Confirmar
      </SubmitButton>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancelar
      </Button>
    </ActionForm>
  );
}

const toDecimal = (v: string) => parseAmount(v) ?? new Decimal(0);

/**
 * Imputación posterior de un crédito disponible (cobranza o pago con saldo, NC o saldo inicial
 * acreedor) contra los comprobantes abiertos del mismo tercero, con propuesta por vencimiento.
 */
export function AllocateCreditForm({
  source,
  available,
  openDebits,
  today,
}: {
  source: { kind: "COLLECTION" | "PAYMENT" | "CREDIT_DOCUMENT"; id: number };
  available: string;
  openDebits: OpenDebitOption[];
  today: string;
}) {
  const { state, pending, onSubmit } = useActionForm(allocateAction);
  const ref = useResetOnSuccess(state);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [lastOk, setLastOk] = useState(state);
  if (state !== lastOk) {
    // Después de imputar, la grilla vuelve a empezar con los saldos nuevos que trae el servidor.
    setLastOk(state);
    if (state?.ok) setAmounts({});
  }
  const allocated = Object.values(amounts).reduce((a, v) => a.plus(toDecimal(v)), new Decimal(0));
  const rest = new Decimal(available).minus(allocated);
  const errors = Object.entries(fieldErrorsOf(state) ?? {})
    .filter(([k]) => k.startsWith("allocations"))
    .flatMap(([, v]) => v);
  const json = JSON.stringify(
    Object.entries(amounts)
      .filter(([, v]) => v.trim() !== "")
      .map(([documentId, amount]) => ({ documentId: Number(documentId), amount })),
  );
  if (!openDebits.length) return <p className="text-sm text-slate-600">No hay comprobantes pendientes contra los que imputar.</p>;
  return (
    <ActionForm ref={ref} pending={pending} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="sourceKind" value={source.kind} />
      <input type="hidden" name="sourceId" value={source.id} />
      <input type="hidden" name="allocations" value={json} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          Disponible para imputar: <strong className="tabular-nums">{formatMoney(available)}</strong>
        </span>
        <span className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setAmounts(Object.fromEntries(proposeFifo(openDebits, available).map((p) => [p.documentId, p.amount.replace(".", ",")])))}
          >
            Proponer por vencimiento
          </Button>
          <Button type="button" variant="ghost" onClick={() => setAmounts({})}>
            Limpiar
          </Button>
        </span>
      </div>
      {errors.length > 0 && (
        <Alert tone="error">
          <ul className="list-disc pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Comprobante</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Vencimiento</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-700">Saldo</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-700">A imputar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {openDebits.map((d) => (
              <tr key={d.id}>
                <td className="px-3 py-2">{d.label}</td>
                <td className={cx("px-3 py-2", d.dueDate < today && "font-medium text-red-700")}>{formatDate(d.dueDate)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(d.balance)}</td>
                <td className="px-3 py-2 text-right">
                  <Input
                    aria-label={`Importe a imputar a ${d.label}`}
                    className="ml-auto w-36 text-right"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={amounts[d.id] ?? ""}
                    onChange={(e) => setAmounts((a) => ({ ...a, [d.id]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={cx("text-right text-sm", rest.isNegative() && "text-red-700")}>
        Imputado: <strong className="tabular-nums">{formatMoney(allocated)}</strong> · Queda disponible: <strong className="tabular-nums">{formatMoney(rest)}</strong>
      </p>
      <FormError state={state} />
      {state?.ok && <Alert tone="success">Imputación registrada.</Alert>}
      <div className="flex justify-end">
        <SubmitButton pendingText="Imputando…" disabled={allocated.lte(0) || rest.isNegative()}>
          Imputar {formatMoney(allocated)}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
