"use client";

import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { revokeSessionAction } from "@/modules/users/actions";

export function RevokeSessionButton({ sessionId }: { sessionId: number }) {
  const { state, pending, onSubmit } = useActionForm(revokeSessionAction);
  return (
    <ActionForm pending={pending} onSubmit={onSubmit} confirmMessage="¿Cerrar esta sesión?" className="inline-flex items-center gap-2">
      {state && !state.ok && <span className="text-xs text-red-700">{state.error}</span>}
      <input type="hidden" name="sessionId" value={sessionId} />
      <SubmitButton variant="danger" pendingText="Cerrando…">
        Cerrar sesión
      </SubmitButton>
    </ActionForm>
  );
}
