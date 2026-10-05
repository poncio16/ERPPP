import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card } from "@/components/ui";
import { getConfig } from "@/modules/config/service";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Cambiar contraseña" };

export default async function ChangePasswordPage() {
  const { session } = await requireUser({ allowPasswordChange: true });
  const minLength = await getConfig(db, "password_min_length");
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-center text-2xl font-semibold text-slate-900">Cambiar contraseña</h1>
        {session.mustChangePassword && (
          <Alert tone="warning">Antes de continuar tiene que reemplazar su contraseña temporal.</Alert>
        )}
        <Card className="p-6">
          <ChangePasswordForm minLength={minLength} />
        </Card>
        {!session.mustChangePassword && (
          <p className="text-center text-sm">
            <Link href="/" className="text-brand-700 hover:underline">
              Volver
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
