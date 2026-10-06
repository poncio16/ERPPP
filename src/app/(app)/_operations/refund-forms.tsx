"use client";

import { useState } from "react";
import { Alert, Button, Field, SelectField, TextareaField } from "@/components/ui";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { FormError, Warnings, fieldErrorsOf } from "@/components/ui/form-feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/money";
import { annulRefundAction, registerRefundAction } from "@/modules/refunds/actions";

type Option = { value: string; label: string };

/** Devolución en dinero de un crédito disponible (D14): al cliente sale dinero; del proveedor entra. */
export function RefundForm({
  source,
  available,
  side,
  idempotencyKey,
  today,
  cashBoxes,
  bankAccounts,
}: {
  source: { kind: "COLLECTION" | "PAYMENT" | "CREDIT_DOCUMENT"; id: number };
  available: string;
  side: "AR" | "AP";
  idempotencyKey: string;
  today: string;
  cashBoxes: Option[];
  bankAccounts: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"CASH" | "TRANSFER">("CASH");
  const { state, pending, onSubmit } = useActionForm(registerRefundAction);
  const fe = fieldErrorsOf(state);
  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {side === "AR" ? "Devolver en dinero" : "Registrar reintegro del proveedor"}
      </Button>
    );
  }
  return (
    <ActionForm
      pending={pending}
      onSubmit={onSubmit}
      confirmMessage={side === "AR" ? "¿Registrar la devolución? Se genera un egreso de caja o banco." : "¿Registrar el reintegro? Se genera un ingreso en caja o banco."}
      className="space-y-3 rounded-md border border-slate-200 p-3"
    >
      <h3 className="font-semibold text-slate-900">{side === "AR" ? "Devolución de saldo a favor al cliente" : "Reintegro de anticipo del proveedor"}</h3>
      <p className="text-sm text-slate-600">
        Disponible: <strong className="tabular-nums">{formatMoney(available)}</strong>. Se registra un débito interno no fiscal que consume el crédito.
      </p>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="sourceKind" value={source.kind} />
      <input type="hidden" name="sourceId" value={source.id} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Fecha" name="date" type="date" required defaultValue={today} max={today} errors={fe?.date} />
        <Field label="Importe" name="amount" inputMode="decimal" required placeholder="0,00" defaultValue={available.replace(".", ",")} errors={fe?.amount} />
        <SelectField
          label="Medio"
          name="method"
          value={method}
          onChange={(e) => setMethod(e.target.value as "CASH" | "TRANSFER")}
          options={[
            { value: "CASH", label: "Efectivo" },
            { value: "TRANSFER", label: "Transferencia" },
          ]}
          errors={fe?.method}
        />
        {method === "CASH" ? (
          <SelectField label="Caja" name="cashBoxId" required options={cashBoxes} placeholder="Elegir…" errors={fe?.cashBoxId} />
        ) : (
          <SelectField label="Cuenta bancaria" name="bankAccountId" required options={bankAccounts} placeholder="Elegir…" errors={fe?.bankAccountId} />
        )}
        {method === "TRANSFER" && <Field label="Referencia" name="reference" maxLength={100} errors={fe?.reference} />}
      </div>
      <TextareaField label="Motivo" name="reason" rows={2} required minLength={3} maxLength={300} errors={fe?.reason} />
      <Warnings state={state} label="Confirmo el registro" />
      <FormError state={state} />
      {state?.ok && <Alert tone="success">Devolución registrada.</Alert>}
      <div className="flex gap-2">
        <SubmitButton pendingText="Registrando…">Registrar</SubmitButton>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </ActionForm>
  );
}

/** Anulación de una devolución con motivo: revierte imputación, tesorería y débito interno. */
export function AnnulRefundButton({ id }: { id: number }) {
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useActionForm(annulRefundAction);
  if (!open) {
    return (
      <button type="button" className="text-sm text-red-700 hover:underline" onClick={() => setOpen(true)}>
        Anular
      </button>
    );
  }
  return (
    <ActionForm pending={pending} onSubmit={onSubmit} confirmMessage="¿Anular la devolución? Se restituye el saldo a favor y se revierte el movimiento de tesorería." className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <TextareaField label="Motivo" name="reason" rows={2} required minLength={5} maxLength={300} errors={fieldErrorsOf(state)?.reason} />
      <FormError state={state} />
      <div className="flex gap-2">
        <SubmitButton variant="danger" pendingText="…">
          Confirmar anulación
        </SubmitButton>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </ActionForm>
  );
}
