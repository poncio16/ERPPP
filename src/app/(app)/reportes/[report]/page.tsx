import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Alert, Card, Input, Label, PageHeader, Select, buttonClass } from "@/components/ui";
import { PrintButton } from "@/components/ui/print-button";
import { todayIso } from "@/lib/format";
import { filterOptions } from "@/modules/reports/options";
import { canReadReport, findReport, runReport, type FilterField } from "@/modules/reports/registry";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { ReportTableView } from "../../_reports/report-table";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function fieldName(f: FilterField) {
  if (f.kind === "party") return "party";
  if (f.kind === "documentType") return "type";
  if (f.kind === "account") return "account";
  return f.name;
}

export default async function ReportPage({ params, searchParams }: PageProps<"/reportes/[report]">) {
  const { report: key } = await params;
  const report = findReport(key);
  if (!report) notFound();
  const { ctx, session } = await requirePagePermission("reports.read");
  if (!canReadReport(session, report)) redirect("/sin-permiso");

  const sp = await searchParams;
  const raw = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, first(v) || undefined]));
  const values = report.parse(raw);
  const [result, options] = await Promise.all([runReport(db, ctx, key, raw, todayIso()), filterOptions(db, report.filters)]);
  const query = new URLSearchParams(Object.entries(raw).filter((e): e is [string, string] => !!e[1])).toString();
  const canExport = session.permissions.has("reports.export");

  return (
    <>
      <PageHeader
        title={result.title}
        description={report.description}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Link href="/reportes" className={buttonClass("ghost")}>
              Todos los reportes
            </Link>
            {canExport && (
              <>
                <a href={`/api/reportes/${key}/excel${query ? `?${query}` : ""}`} className={buttonClass("secondary")}>
                  Exportar a Excel
                </a>
                <a href={`/api/reportes/${key}/pdf${query ? `?${query}` : ""}`} target="_blank" rel="noopener" className={buttonClass("secondary")}>
                  Exportar a PDF
                </a>
              </>
            )}
            <PrintButton />
          </div>
        }
      />
      {report.filters.length > 0 && (
        <Card className="mb-4 p-4 print:hidden">
          <form method="get" className="flex flex-wrap items-end gap-3">
            {report.filters.map((f) => {
              const name = fieldName(f);
              const value = values[name];
              const id = `f-${name}`;
              const def = value === undefined || value === null ? "" : String(value);
              if (f.kind === "party" || f.kind === "documentType" || f.kind === "account") {
                const label = f.kind === "party" ? (f.direction === "ISSUED" ? "Cliente" : "Proveedor") : f.kind === "documentType" ? "Tipo de comprobante" : f.accountKind === "CASH" ? "Caja" : "Cuenta bancaria";
                const placeholder = f.kind === "account" ? null : f.kind === "party" && f.required ? "Elegir…" : "Todos";
                return (
                  <div key={name} className="min-w-56 max-w-80 flex-1">
                    <Label htmlFor={id}>{label}</Label>
                    <Select id={id} name={name} defaultValue={def} className="mt-1">
                      {placeholder && <option value="">{placeholder}</option>}
                      {(options[name] ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                );
              }
              if (f.kind === "select") {
                return (
                  <div key={name}>
                    <Label htmlFor={id}>{f.label}</Label>
                    <Select id={id} name={name} defaultValue={def} className="mt-1">
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                );
              }
              return (
                <div key={name} className="w-44">
                  <Label htmlFor={id}>{f.label}</Label>
                  <Input
                    id={id}
                    name={name}
                    type={f.kind}
                    defaultValue={def}
                    className="mt-1"
                    {...(f.kind === "number" ? { min: f.min, max: f.max } : {})}
                  />
                  {"hint" in f && f.hint && <p className="mt-1 text-xs text-slate-500">{f.hint}</p>}
                </div>
              );
            })}
            <div className="flex gap-2">
              <button type="submit" className={buttonClass("secondary")}>
                Ver reporte
              </button>
              <Link href={`/reportes/${key}`} className={buttonClass("ghost")}>
                Limpiar
              </Link>
            </div>
          </form>
        </Card>
      )}
      <p className="mb-3 text-sm text-slate-600">{result.filters.join(" · ")}</p>
      {result.tables.map((t, i) => (
        <ReportTableView key={i} table={t} />
      ))}
      {result.notes.length > 0 && (
        <Alert tone="info">
          <ul className="list-disc space-y-1 pl-4">
            {result.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </Alert>
      )}
    </>
  );
}
