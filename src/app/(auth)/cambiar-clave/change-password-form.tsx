"use client";

import { Alert, Field } from "@/components/ui";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { changePasswordAction } from "../actions";

export function ChangePasswordForm({ minLength }: { minLength: number }) {
  const { state, pending, onSubmit } = useActionForm(changePasswordAction);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <ActionForm pending={pending} onSubmit={onSubmit} className="space-y-5">
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      <Field
        label="Contraseña actual"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        errors={errors?.currentPassword}
      />
      <Field
        label="Nueva contraseña"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        minLength={minLength}
        hint={`Al menos ${minLength} caracteres. Puede ser una frase.`}
        errors={errors?.newPassword}
      />
      <Field
        label="Repita la nueva contraseña"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        errors={errors?.confirmPassword}
      />
      <SubmitButton className="w-full" pendingText="Guardando…">
        Cambiar contraseña
      </SubmitButton>
    </ActionForm>
  );
}
