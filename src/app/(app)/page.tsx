import Link from "next/link";
import { Alert, Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth/session";
import { NAV } from "./nav";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const { session } = await requireUser();
  const params = await searchParams;
  const items = NAV.flatMap((s) => s.items).filter(
    (i) => i.href !== "/" && (!i.permission || session.permissions.has(i.permission)),
  );
  return (
    <>
      <PageHeader title={`Hola, ${session.fullName.split(" ")[0]}`} description="Elija una sección para comenzar." />
      {params.clave === "actualizada" && (
        <div className="mb-6">
          <Alert tone="success">Su contraseña se actualizó correctamente.</Alert>
        </div>
      )}
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
