"use client";

import { Alert, Field, SelectField } from "@/components/ui";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { FormError, fieldErrorsOf, useResetOnSuccess } from "@/components/ui/form-feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { createPlannedItemAction, setPlannedItemStatusAction } from "@/modules/treasury/actions";

/** Alta de un ingreso o egreso proyectado (no mueve saldos reales; alimenta el flujo de fondos). */
export function PlannedItemForm({ concepts, today }: { concepts: { id: number; name: string; direction: string }[]; today: string }) {
  const { state, pending, onSubmit } = useActionForm(createPlannedItemAction);
  const ref = useResetOnSuccess(state);
  const fe = fieldErrorsOf(state);
  return (
    <ActionForm ref={ref} pending={pending} onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Tipo"
          name="direction"
          required
          options={[
            { value: "IN", label: "Ingreso previsto" },
            { value: "OUT", label: "Egreso previsto" },
          ]}
          errors={fe?.direction}
        />
        <Field label="Fecha prevista" name="expectedDate" type="date" required min={today} defaultValue={today} errors={fe?.expectedDate} />
        <Field label="Importe" name="amount" inputMode="decimal" required placeholder="0,00" errors={fe?.amount} />
        <SelectField label="Concepto (opcional)" name="conceptId" options={concepts.map((c) => ({ value: c.id, label: c.name }))} placeholder="Sin concepto" errors={fe?.conceptId} />
      </div>
      <Field label="Descripción" name="description" required maxLength={200} errors={fe?.description} />
      <SelectField
        label="Repetición"
        name="recurrence"
        options={[{ value: "MONTHLY", label: "Todos los meses" }]}
        placeholder="Una sola vez"
        errors={fe?.recurrence}
      />
      <FormError state={state} />
      {state?.ok && <Alert tone="success">Movimiento proyectado registrado.</Alert>}
      <SubmitButton pendingText="Guardando…">Agregar proyectado</SubmitButton>
    </ActionForm>
  );
}

export function PlannedItemActions({ id }: { id: number }) {
  const { state, pending, onSubmit } = useActionForm(setPlannedItemStatusAction);
  return (
    <ActionForm pending={pending} onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <button type="submit" name="status" value="REALIZED" className="text-sm text-brand-700 hover:underline" disabled={pending}>
        Realizado
      </button>
      <button type="submit" name="status" value="CANCELLED" className="text-sm text-red-700 hover:underline" disabled={pending}>
        Cancelar
      </button>
      {state && !state.ok && <span className="text-xs text-red-700">{state.error}</span>}
    </ActionForm>
  );
}
