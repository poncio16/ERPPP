"use client";

import { Alert } from "@/components/ui";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { resetPasswordAction, unlockUserAction } from "@/modules/users/actions";
import { TemporaryPassword } from "../temporary-password";

export function ResetPasswordForm({ userId, username }: { userId: number; username: string }) {
  const { state, pending, onSubmit } = useActionForm(resetPasswordAction);
  if (state?.ok) return <TemporaryPassword username={username} password={state.data.temporaryPassword} />;
  return (
    <ActionForm
      pending={pending}
      onSubmit={onSubmit}
      className="space-y-2"
      confirmMessage={`¿Blanquear la contraseña de ${username}? Se cerrarán sus sesiones abiertas.`}
    >
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      <input type="hidden" name="userId" value={userId} />
      <SubmitButton variant="secondary" pendingText="Generando…">
        Blanquear contraseña
      </SubmitButton>
      <p className="text-xs text-slate-500">Genera una contraseña temporal y cierra las sesiones del usuario.</p>
    </ActionForm>
  );
}

export function UnlockUserForm({ userId }: { userId: number }) {
  const { state, pending, onSubmit } = useActionForm(unlockUserAction);
  if (state?.ok) return <Alert tone="success">El usuario fue desbloqueado.</Alert>;
  return (
    <ActionForm pending={pending} onSubmit={onSubmit} className="space-y-2">
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      <input type="hidden" name="userId" value={userId} />
      <SubmitButton variant="secondary" pendingText="Desbloqueando…">
        Desbloquear ahora
      </SubmitButton>
    </ActionForm>
  );
}
