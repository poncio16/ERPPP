import Link from "next/link";
import { Badge, Card, cx } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { CellValue, ReportColumn, ReportTable } from "@/modules/reports/types";

function cellText(col: ReportColumn, v: CellValue | undefined) {
  if (v === null || v === undefined || v === "") return "";
  if (col.type === "money") return formatMoney(String(v), false);
  if (col.type === "date") return formatDate(String(v));
  return String(v);
}

const numeric = (c: ReportColumn) => c.type === "money" || c.type === "int";
const negative = (c: ReportColumn, v: CellValue | undefined) => c.type === "money" && typeof v === "string" && v.startsWith("-");

/** Tabla de un reporte en pantalla: mismas columnas, filas y totales que el Excel y el PDF. */
const KEEP_TOGETHER = new Set(["number", "taxId", "drawerTaxId", "code", "period", "certificate", "reference", "status"]);

export function ReportTableView({ table }: { table: ReportTable }) {
  const cols = table.columns;
  const linkCol = cols.find((c) => c.type === "text")?.key;
  const groups: { label: string; span: number }[] = [];
  if (cols.some((c) => c.group)) {
    for (const c of cols) {
      const last = groups.at(-1);
      if (last && c.group && last.label === c.group) last.span++;
      else groups.push({ label: c.group ?? "", span: 1 });
    }
  }
  const th = "px-3 py-2 align-bottom font-semibold text-slate-700";
  const td = "px-3 py-1.5";
  // Nombres, conceptos y descripciones pueden partirse en dos líneas; fechas, importes, números y CUIT no.
  const wrap = (c: { key: string; type: string }) => (c.type === "text" && !KEEP_TOGETHER.has(c.key) ? "min-w-28 whitespace-normal" : "whitespace-nowrap");
  return (
    <Card className="mb-4">
      {table.title && <h2 className="border-b border-slate-200 px-4 py-2.5 font-semibold text-slate-900">{table.title}</h2>}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            {groups.length > 0 && (
              <tr>
                {groups.map((g, i) => (
                  <th key={i} colSpan={g.span} scope="colgroup" className={cx(th, "text-center", g.label && "border-x border-slate-200")}>
                    {g.label}
                  </th>
                ))}
              </tr>
            )}
            <tr>
              {cols.map((c) => (
                <th key={c.key} scope="col" className={cx(th, numeric(c) ? "text-right" : "text-left", c.projected && "bg-slate-100 font-medium italic text-slate-500")}>
                  {c.label}
                  {c.projected && (
                    <span className="ml-1 align-middle">
                      <Badge>proyectado</Badge>
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {table.rows.length === 0 && (
              <tr>
                <td colSpan={cols.length} className="px-4 py-8 text-center text-slate-500">
                  {table.emptyMessage ?? "Sin datos."}
                </td>
              </tr>
            )}
            {table.rows.map((r, i) => (
              <tr
                key={i}
                className={cx(
                  r.style === "section" && "bg-slate-100",
                  r.style === "subtotal" && "bg-slate-50 font-medium",
                  r.style === "total" && "border-t-2 border-slate-400 font-semibold",
                  r.projected && !r.style && "italic text-slate-500",
                  r.projected && r.style === "section" && "italic text-slate-500",
                  !r.style && "hover:bg-slate-50",
                )}
              >
                {cols.map((c) => {
                  const v = r.cells[c.key];
                  const text = cellText(c, v);
                  return (
                    <td
                      key={c.key}
                      className={cx(
                        td,
                        wrap(c),
                        numeric(c) && "text-right tabular-nums",
                        c.projected && "bg-slate-50/70 text-slate-500",
                        negative(c, v) && "text-red-700",
                        !r.style && !r.projected && !c.projected && !negative(c, v) && "text-slate-700",
                      )}
                    >
                      {r.href && c.key === linkCol && text ? (
                        <Link href={r.href as never} className="font-medium text-brand-700 hover:underline">
                          {text}
                        </Link>
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {table.totals && table.rows.length > 0 && (
            <tfoot className="bg-slate-50 font-semibold">
              <tr className="border-t-2 border-slate-300">
                {cols.map((c, i) => {
                  const v = table.totals![c.key];
                  const fallback = i === 0 && !cols.some((x) => x.type === "text" && table.totals![x.key] !== undefined) ? "Total" : "";
                  return (
                    <td key={c.key} className={cx(td, wrap(c), numeric(c) && "text-right tabular-nums", negative(c, v) && "text-red-700")}>
                      {v !== undefined ? cellText(c, v) : fallback}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}
