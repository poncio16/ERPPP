import { Alert } from "@/components/ui";

/** La contraseña temporal se muestra una sola vez; no queda guardada en ningún lado. */
export function TemporaryPassword({ username, password }: { username: string; password: string }) {
  return (
    <Alert tone="success">
      <p>
        Contraseña temporal para <strong>{username}</strong>:{" "}
        <code className="rounded bg-white px-2 py-0.5 font-mono text-base text-slate-900 select-all">{password}</code>
      </p>
      <p className="mt-1 text-xs">
        Cópiela ahora y entréguela por un medio seguro: no se vuelve a mostrar. El usuario deberá cambiarla al ingresar.
      </p>
    </Alert>
  );
}
