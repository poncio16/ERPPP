"use client";

import { useFormStatus } from "react-dom";
import { useActionFormPending } from "./action-form";
import { buttonClass } from "./index";

/** Botón de envío que se deshabilita mientras el formulario se procesa (evita el doble clic). */
export function SubmitButton({
  children,
  pendingText = "Procesando…",
  variant = "primary",
  className,
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
}) {
  const { pending: nativePending } = useFormStatus();
  const pending = useActionFormPending() || nativePending;
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} className={buttonClass(variant, className)}>
      {pending ? pendingText : children}
    </button>
  );
}
