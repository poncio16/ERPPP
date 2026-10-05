"use client";

import { Alert, Field } from "@/components/ui";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  deactivateClientAction,
  deactivateSupplierAction,
  reactivateClientAction,
  reactivateSupplierAction,
} from "@/modules/parties/actions";
import type { PartyKind } from "@/modules/parties/schemas";

const DEACTIVATE = { client: deactivateClientAction, supplier: deactivateSupplierAction };
const REACTIVATE = { client: reactivateClientAction, supplier: reactivateSupplierAction };

export function DeactivateForm({ kind, id, version, the }: { kind: PartyKind; id: number; version: number; the: string }) {
  const { state, pending, onSubmit } = useActionForm(DEACTIVATE[kind]);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <ActionForm pending={pending} onSubmit={onSubmit} className="space-y-3" confirmMessage={`¿Dar de baja a ${the}? No se borra nada; solo deja de estar disponible para operaciones nuevas.`}>
      {state && !state.ok && !fe && <Alert tone="error">{state.error}</Alert>}
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <Field label="Motivo de la baja" name="reason" required minLength={5} maxLength={300} errors={fe?.reason} />
      <SubmitButton variant="danger" pendingText="Procesando…">
        Dar de baja
      </SubmitButton>
      <p className="text-xs text-slate-500">Requiere saldo cero y ningún cheque en circulación.</p>
    </ActionForm>
  );
}

export function ReactivateForm({ kind, id, version }: { kind: PartyKind; id: number; version: number }) {
  const { state, pending, onSubmit } = useActionForm(REACTIVATE[kind]);
  return (
    <ActionForm pending={pending} onSubmit={onSubmit} className="space-y-3">
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <SubmitButton variant="secondary" pendingText="Procesando…">
        Reactivar
      </SubmitButton>
    </ActionForm>
  );
}
