"use client";

import { Alert, Field } from "@/components/ui";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { loginAction } from "../actions";

export function LoginForm() {
  const { state, pending, onSubmit } = useActionForm(loginAction);
  return (
    <ActionForm pending={pending} onSubmit={onSubmit} className="space-y-5">
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      <Field label="Usuario" name="username" autoComplete="username" autoFocus required maxLength={100} />
      <Field label="Contraseña" name="password" type="password" autoComplete="current-password" required maxLength={200} />
      <SubmitButton className="w-full" pendingText="Ingresando…">
        Ingresar
      </SubmitButton>
    </ActionForm>
  );
}
