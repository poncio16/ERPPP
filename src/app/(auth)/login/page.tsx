import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { getSession } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-sm font-medium uppercase tracking-wider text-brand-700">Gestión administrativa y financiera</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Ingresar al ERP</h1>
        </div>
        <Card className="p-6">
          <LoginForm />
        </Card>
        <p className="mt-4 text-center text-xs text-slate-500">
          Si olvidó su contraseña, pídale al administrador que la blanquee.
        </p>
      </div>
    </main>
  );
}
