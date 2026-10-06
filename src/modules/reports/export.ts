import { recordAudit } from "@/modules/audit/service";
import { companyHeader } from "@/modules/internal-docs/service";
import { assertPermission } from "@/server/authorization";
import type { ServiceContext } from "@/server/context";
import type { Db } from "@/server/db/drizzle";
import { reportToXlsx } from "./excel";
import { reportToPdf } from "./pdf";
import { runReport } from "./registry";

export type ExportFormat = "excel" | "pdf";

/** Exporta un reporte a Excel o PDF. Exige reports.export además de los permisos del reporte; queda auditado. */
export async function exportReport(db: Db, ctx: ServiceContext, key: string, params: Record<string, string | undefined>, format: ExportFormat) {
  assertPermission(ctx, "reports.export");
  const report = await runReport(db, ctx, key, params);
  const company = await companyHeader(db);
  const buffer = format === "excel" ? await reportToXlsx(report, company, ctx.username) : await reportToPdf(report, company, ctx.username);
  await recordAudit(db, ctx, {
    module: "reports",
    action: "export",
    entityType: "report",
    after: { report: key, format, filters: report.filters, rows: report.tables.reduce((a, t) => a + t.rows.length, 0) },
  });
  return {
    buffer,
    filename: `${report.filename}.${format === "excel" ? "xlsx" : "pdf"}`,
    contentType: format === "excel" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf",
  };
}
