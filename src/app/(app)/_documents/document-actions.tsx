"use client";

import { Alert, Field, Label, Select } from "@/components/ui";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { annulDocumentAction, updateDocumentInfoAction } from "@/modules/documents/actions";

export function AnnulDocumentForm({ id, version }: { id: number; version: number }) {
  const { state, pending, onSubmit } = useActionForm(annulDocumentAction);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  if (state?.ok) return <Alert tone="success">El registro quedó anulado.</Alert>;
  return (
    <ActionForm
      pending={pending}
      onSubmit={onSubmit}
      className="space-y-3"
      confirmMessage="¿Anular el registro de este comprobante? Queda en el historial con saldo cero y se revierte su efecto en la cuenta corriente."
    >
      {state && !state.ok && !fe && <Alert tone="error">{state.error}</Alert>}
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <Field label="Motivo de la anulación" name="reason" required minLength={5} maxLength={300} errors={fe?.reason} />
      <SubmitButton variant="danger" pendingText="Anulando…">
        Anular registro
      </SubmitButton>
      <p className="text-xs text-slate-500">
        Esto corrige un error de carga; no reemplaza a una nota de crédito. Después puede volver a registrarlo con el mismo número.
      </p>
    </ActionForm>
  );
}

export function DocumentInfoForm({
  id,
  version,
  dueDate,
  issueDate,
  concept,
  description,
  externalRef,
}: {
  id: number;
  version: number;
  dueDate: string;
  issueDate: string;
  concept: string | null;
  description: string | null;
  externalRef: string | null;
}) {
  const { state, pending, onSubmit } = useActionForm(updateDocumentInfoAction);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <ActionForm pending={pending} onSubmit={onSubmit} className="space-y-3">
      {state?.ok && <Alert tone="success">Datos actualizados.</Alert>}
      {state && !state.ok && !fe && <Alert tone="error">{state.error}</Alert>}
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <Field label="Vencimiento" name="dueDate" type="date" min={issueDate} defaultValue={dueDate} required errors={fe?.dueDate} />
      <div>
        <Label htmlFor="f-concept">Concepto</Label>
        <Select id="f-concept" name="concept" defaultValue={concept ?? ""} className="mt-1">
          <option value="">—</option>
          <option value="PRODUCTS">Productos</option>
          <option value="SERVICES">Servicios</option>
          <option value="BOTH">Productos y servicios</option>
        </Select>
      </div>
      <Field label="Descripción" name="description" maxLength={500} defaultValue={description ?? ""} errors={fe?.description} />
      <Field label="Referencia externa" name="externalRef" maxLength={100} defaultValue={externalRef ?? ""} errors={fe?.externalRef} />
      <SubmitButton variant="secondary" pendingText="Guardando…">
        Guardar
      </SubmitButton>
    </ActionForm>
  );
}
