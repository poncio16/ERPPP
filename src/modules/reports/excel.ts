import ExcelJS from "exceljs";
import { formatDateTime } from "@/lib/format";
import type { CompanyHeader } from "@/modules/internal-docs/service";
import type { CellValue, ReportColumn, ReportResult } from "./types";

const MONEY_FMT = "#,##0.00;[Red]-#,##0.00";
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
const PROJECTED_FONT: Partial<ExcelJS.Font> = { italic: true, color: { argb: "FF64748B" } };

/**
 * Excel de un reporte: una hoja por tabla, con importes como números reales (formato contable),
 * fechas como fechas y la fila de totales. La conversión de texto a número ocurre recién aquí,
 * a partir de importes ya redondeados a 2 decimales.
 */
export async function reportToXlsx(report: ReportResult, company: CompanyHeader | null, generatedBy: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERP";
  wb.created = new Date();
  const used = new Set<string>();
  const sheetName = (title: string) => {
    const base = title.replace(/[\\/?*[\]:]/g, " ").slice(0, 28).trim() || "Reporte";
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} ${i}`;
    used.add(name.toLowerCase());
    return name;
  };

  const tables = report.tables.length ? report.tables : [{ columns: [], rows: [] }];
  tables.forEach((table, index) => {
    const ws = wb.addWorksheet(sheetName(index === 0 ? report.title : (table.title ?? report.title)));
    const cols = table.columns;
    ws.columns = cols.map((c) => ({ width: c.type === "money" ? 16 : c.type === "date" ? 12 : c.type === "int" ? 9 : Math.min(40, Math.max(12, c.label.length + 4)) }));
    ws.addRow([report.title]).font = { bold: true, size: 13 };
    if (company) ws.addRow([company.legalName]);
    for (const f of report.filters) ws.addRow([f]);
    ws.addRow([`Generado el ${formatDateTime(new Date())} por ${generatedBy}`]).font = { italic: true, size: 9 };
    if (table.title && index > 0) ws.addRow([table.title]).font = { bold: true };
    ws.addRow([]);

    if (cols.some((c) => c.group)) {
      const g = ws.addRow(cols.map((c) => c.group ?? ""));
      g.font = { bold: true };
      // Celdas combinadas para cada grupo consecutivo.
      let start = 0;
      for (let i = 1; i <= cols.length; i++) {
        if (i === cols.length || cols[i]!.group !== cols[start]!.group) {
          if (cols[start]!.group && i - start > 1) ws.mergeCells(g.number, start + 1, g.number, i);
          start = i;
        }
      }
      g.eachCell((c) => {
        c.fill = HEADER_FILL;
        c.alignment = { horizontal: "center" };
      });
    }
    const header = ws.addRow(cols.map((c) => (c.projected ? `${c.label} (proyectado)` : c.label)));
    header.font = { bold: true };
    header.eachCell((c) => (c.fill = HEADER_FILL));
    ws.views = [{ state: "frozen", ySplit: header.number }];

    for (const r of table.rows) {
      const row = ws.addRow(cols.map((c) => toExcel(c, r.cells[c.key] ?? null)));
      formatRow(row, cols);
      if (r.style) row.font = { bold: true };
      if (r.projected) row.font = { ...PROJECTED_FONT, bold: !!r.style };
    }
    if (!table.rows.length && table.emptyMessage) ws.addRow([table.emptyMessage]).font = { italic: true };
    if (table.totals) {
      const firstText = cols.findIndex((c) => table.totals![c.key] !== undefined && c.type === "text");
      const row = ws.addRow(cols.map((c, i) => (table.totals![c.key] !== undefined ? toExcel(c, table.totals![c.key]!) : i === 0 && firstText < 0 ? "Total" : null)));
      formatRow(row, cols);
      row.font = { bold: true };
      row.eachCell((c) => (c.border = { top: { style: "thin" } }));
    }
    if (index === 0 && report.notes.length) {
      ws.addRow([]);
      for (const n of report.notes) ws.addRow([n]).font = { italic: true, size: 9 };
    }
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function toExcel(col: ReportColumn, v: CellValue): ExcelJS.CellValue {
  if (v === null || v === "") return null;
  if (col.type === "money") return typeof v === "number" ? v : Number(v);
  if (col.type === "int") return typeof v === "number" ? v : Number(v);
  if (col.type === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00Z`);
  return String(v);
}

function formatRow(row: ExcelJS.Row, cols: ReportColumn[]) {
  cols.forEach((c, i) => {
    const cell = row.getCell(i + 1);
    if (c.type === "money") cell.numFmt = MONEY_FMT;
    else if (c.type === "date" && cell.value instanceof Date) cell.numFmt = "dd/mm/yyyy";
  });
}
