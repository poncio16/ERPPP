import Link from "next/link";
import { Alert, Card, PageHeader } from "@/components/ui";
import { formatDate, todayIso } from "@/lib/format";
import { dashboardData } from "@/modules/reports/dashboard";
import { getRequestMeta, requireUser, toContext } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { Dashboard } from "./_dashboard/dashboard";
import { NAV } from "./nav";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const { session } = await requireUser();
  const params = await searchParams;
  const greeting = `Hola, ${session.fullName.split(" ")[0]}`;
  const updated =
    params.clave === "actualizada" ? (
      <div className="mb-6">
        <Alert tone="success">Su contraseña se actualizó correctamente.</Alert>
      </div>
    ) : null;

  if (session.permissions.has("dashboard.read")) {
    const today = todayIso();
    const data = await dashboardData(db, toContext(session, await getRequestMeta()), today);
    return (
      <>
        <PageHeader title={greeting} description={`Resumen al ${formatDate(today)}. Cada indicador enlaza a su detalle.`} />
        {updated}
        <Dashboard data={data} />
      </>
    );
  }

  const items = NAV.flatMap((s) => s.items).filter((i) => i.href !== "/" && (!i.permission || session.permissions.has(i.permission)));
  return (
    <>
      <PageHeader title={greeting} description="Elija una sección para comenzar." />
      {updated}
      {items.length === 0 ? (
        <Card className="p-6 text-sm text-slate-600">Todavía no hay secciones disponibles para su usuario.</Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((i) => (
            <Link key={i.href} href={i.href}>
              <Card className="p-5 transition hover:border-brand-600 hover:shadow">
                <p className="font-medium text-slate-900">{i.label}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
