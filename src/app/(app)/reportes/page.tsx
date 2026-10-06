import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { canReadReport, REPORT_SECTIONS, REPORTS } from "@/modules/reports/registry";
import { requirePagePermission } from "@/server/auth/session";

export default async function ReportsPage() {
  const { session } = await requirePagePermission("reports.read");
  const visible = REPORTS.filter((r) => canReadReport(session, r));
  return (
    <>
      <PageHeader
        title="Reportes"
        description="Todos los reportes salen de los mismos registros que los módulos de origen y se pueden exportar a Excel y PDF."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {REPORT_SECTIONS.map((section) => {
          const items = visible.filter((r) => r.section === section);
          if (!items.length) return null;
          return (
            <Card key={section} className="p-5">
              <h2 className="mb-3 font-semibold text-slate-900">{section}</h2>
              <ul className="space-y-2">
                {items.map((r) => (
                  <li key={r.key}>
                    <Link href={`/reportes/${r.key}`} className="font-medium text-brand-700 hover:underline">
                      {r.title}
                    </Link>
                    <p className="text-sm text-slate-600">{r.description}</p>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </>
  );
}
