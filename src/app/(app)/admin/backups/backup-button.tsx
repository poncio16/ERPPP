"use client";

import { Alert } from "@/components/ui";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { createBackupAction } from "@/modules/backup/actions";

/** Backup manual (permiso backup.run). */
export function BackupButton({ disabled }: { disabled?: boolean }) {
  const { state, pending, onSubmit } = useActionForm(createBackupAction);
  return (
    <div className="space-y-3">
      <ActionForm pending={pending} onSubmit={onSubmit}>
        <input type="hidden" name="confirm" value="yes" />
        <SubmitButton pendingText="Haciendo el backup…" disabled={disabled}>
          Hacer backup ahora
        </SubmitButton>
      </ActionForm>
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      {state?.ok && (
        <Alert tone={state.data.offsiteStatus === "FAILED" ? "warning" : "success"}>
          Backup creado: {state.data.fileName}.
          {state.data.offsiteStatus === "OK" && " Se copió cifrado fuera del servidor."}
          {state.data.offsiteStatus === "FAILED" && ` La copia fuera del servidor falló: ${state.data.offsiteError}`}
        </Alert>
      )}
    </div>
  );
}
