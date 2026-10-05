import type { Metadata } from "next";
import { LinkButton } from "@/components/ui";

export const metadata: Metadata = { title: "Sin permiso" };

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-red-700">Acceso denegado</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">No tiene permiso para ver esta sección</h1>
        <p className="mt-2 text-sm text-slate-600">
          Si necesita acceder, pídale al administrador que revise los permisos de su usuario.
        </p>
        <LinkButton href="/" className="mt-6">
          Ir al inicio
        </LinkButton>
      </div>
    </main>
  );
}
