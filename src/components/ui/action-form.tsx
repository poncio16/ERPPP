"use client";

import { createContext, startTransition, useActionState, useContext, type ComponentProps, type FormEvent } from "react";

const PendingContext = createContext(false);

/** Indica si el formulario `ActionForm` que contiene al componente se está enviando. */
export const useActionFormPending = () => useContext(PendingContext);

/**
 * Estado de una Server Action para usar con `ActionForm`.
 * A diferencia de `<form action={...}>`, no vacía los campos cuando el servidor devuelve
 * un error de validación: el usuario corrige y reenvía sin volver a escribir todo.
 */
export function useActionForm<S>(action: (prev: S | undefined, formData: FormData) => Promise<S | undefined>) {
  const [state, dispatch, pending] = useActionState<S | undefined, FormData>(action, undefined);
  const onSubmit = (formData: FormData) => startTransition(() => dispatch(formData));
  return { state, pending, onSubmit };
}

export function ActionForm({
  pending,
  onSubmit,
  confirmMessage,
  children,
  ...props
}: Omit<ComponentProps<"form">, "onSubmit" | "action" | "method"> & {
  pending: boolean;
  onSubmit: (formData: FormData) => void;
  /** Si se indica, pide confirmación antes de enviar. */
  confirmMessage?: string;
}) {
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    onSubmit(new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter));
  };
  // method="post": si se envía antes de que cargue el JavaScript, los datos no viajan en la URL.
  return (
    <PendingContext value={pending}>
      <form method="post" onSubmit={handleSubmit} {...props}>
        {children}
      </form>
    </PendingContext>
  );
}
