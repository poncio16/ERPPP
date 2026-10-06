"use client";

import { useEffect, useRef } from "react";
import { Alert } from "@/components/ui";
import type { ActionResult } from "@/server/action";

type State = ActionResult<unknown> | undefined;

/** Vacía el formulario después de una operación exitosa (la clave de idempotencia nueva llega del servidor). */
export function useResetOnSuccess(state: State) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

/** Errores por campo devueltos por la acción. */
export const fieldErrorsOf = (state: State) => (state && !state.ok ? state.fieldErrors : undefined);

export function FormError({ state }: { state: State }) {
  if (!state || state.ok) return null;
  const fe = state.fieldErrors;
  const hasFieldErrors = fe && Object.keys(fe).some((k) => k !== "_warnings");
  if (fe?._warnings) return null;
  return <Alert tone="error">{hasFieldErrors ? "Revise los datos marcados." : state.error}</Alert>;
}

/** Advertencias que el usuario debe confirmar antes de reenviar (NEEDS_CONFIRMATION). */
export function Warnings({ state, label }: { state: State; label: string }) {
  const warnings = state && !state.ok ? state.fieldErrors?._warnings : undefined;
  if (!warnings?.length) return null;
  return (
    <Alert tone="warning">
      <ul className="list-disc pl-5">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <label className="mt-2 flex items-center gap-2 font-medium">
        <input type="checkbox" name="confirmWarnings" value="1" className="h-4 w-4" required />
        {label}
      </label>
    </Alert>
  );
}
