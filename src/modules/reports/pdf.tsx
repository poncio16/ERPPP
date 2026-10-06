import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatCuit } from "@/lib/cuit";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { CompanyHeader } from "@/modules/internal-docs/service";
import type { CellValue, ReportColumn, ReportResult, ReportTable } from "./types";

/** PDF de un reporte con @react-pdf/renderer: mismo contenido que la pantalla y el Excel. */

const s = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 36, paddingHorizontal: 24, fontFamily: "Helvetica", color: "#0f172a" },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#94a3b8", paddingBottom: 6, marginBottom: 6 },
  title: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  company: { fontSize: 9, fontFamily: "Helvetica-Bold", textAlign: "right" },
  small: { fontSize: 7, color: "#475569" },
  tableTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 3 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0" },
  headRow: { flexDirection: "row", backgroundColor: "#e2e8f0" },
  cell: { paddingVertical: 2, paddingHorizontal: 2 },
  bold: { fontFamily: "Helvetica-Bold" },
  projected: { color: "#64748b", fontFamily: "Helvetica-Oblique" },
  section: { backgroundColor: "#f1f5f9" },
  total: { borderTopWidth: 1, borderTopColor: "#475569" },
  negative: { color: "#b91c1c" },
  notes: { marginTop: 10 },
  footer: { position: "absolute", bottom: 16, left: 24, right: 24, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#64748b" },
});

const WEIGHT: Record<ReportColumn["type"], number> = { text: 2, date: 1.1, money: 1.4, int: 0.7 };

function cellText(col: ReportColumn, v: CellValue | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  if (col.type === "money") return formatMoney(String(v), false);
  if (col.type === "date") return formatDate(String(v));
  return String(v);
}

function TableView({ table, fontSize }: { table: ReportTable; fontSize: number }) {
  const cols = table.columns;
  const total = cols.reduce((a, c) => a + WEIGHT[c.type], 0);
  const width = (c: ReportColumn) => `${((WEIGHT[c.type] / total) * 100).toFixed(3)}%`;
  const align = (c: ReportColumn) => (c.type === "money" || c.type === "int" ? "right" : "left");
  const groups: { label: string; span: number; weight: number }[] = [];
  if (cols.some((c) => c.group)) {
    for (const c of cols) {
      const last = groups.at(-1);
      if (last && last.label === (c.group ?? "") && c.group) {
        last.span++;
        last.weight += WEIGHT[c.type];
      } else groups.push({ label: c.group ?? "", span: 1, weight: WEIGHT[c.type] });
    }
  }
  return (
    <View style={{ fontSize }}>
      {table.title ? <Text style={s.tableTitle}>{table.title}</Text> : null}
      {groups.length ? (
        <View style={s.headRow} fixed>
          {groups.map((g, i) => (
            <Text key={i} style={[s.cell, s.bold, { width: `${((g.weight / total) * 100).toFixed(3)}%`, textAlign: "center" }]}>
              {g.label}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={s.headRow} fixed>
        {cols.map((c) => (
          <Text key={c.key} style={[s.cell, s.bold, { width: width(c), textAlign: align(c) }, c.projected ? s.projected : {}]}>
            {c.projected ? `${c.label} (proy.)` : c.label}
          </Text>
        ))}
      </View>
      {table.rows.length === 0 && table.emptyMessage ? <Text style={[s.cell, s.projected]}>{table.emptyMessage}</Text> : null}
      {table.rows.map((r, i) => (
        <View key={i} style={[s.row, r.style === "section" ? s.section : {}, r.style === "total" ? s.total : {}]} wrap={false}>
          {cols.map((c) => {
            const v = r.cells[c.key];
            const negative = c.type === "money" && typeof v === "string" && v.startsWith("-");
            return (
              <Text
                key={c.key}
                style={[s.cell, { width: width(c), textAlign: align(c) }, r.style ? s.bold : {}, r.projected || c.projected ? s.projected : {}, negative ? s.negative : {}]}
              >
                {cellText(c, v)}
              </Text>
            );
          })}
        </View>
      ))}
      {table.totals ? (
        <View style={[s.row, s.total]} wrap={false}>
          {cols.map((c, i) => (
            <Text key={c.key} style={[s.cell, s.bold, { width: width(c), textAlign: align(c) }]}>
              {table.totals![c.key] !== undefined ? cellText(c, table.totals![c.key]) : i === 0 && !cols.some((x) => x.type === "text" && table.totals![x.key] !== undefined) ? "Total" : ""}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ReportPdf({ report, company, generatedBy }: { report: ReportResult; company: CompanyHeader | null; generatedBy: string }) {
  const maxCols = Math.max(0, ...report.tables.map((t) => t.columns.length));
  const landscape = maxCols > 7;
  const fontSize = maxCols > 16 ? 5.5 : maxCols > 12 ? 6.5 : maxCols > 8 ? 7 : 8;
  const generated = formatDateTime(new Date());
  return (
    <Document title={report.title} author={company?.legalName ?? undefined} producer="ERP PyME">
      <Page size="A4" orientation={landscape ? "landscape" : "portrait"} style={s.page}>
        <View style={s.header}>
          <View style={{ maxWidth: "60%" }}>
            <Text style={s.title}>{report.title}</Text>
            {report.filters.map((f, i) => (
              <Text key={i} style={s.small}>
                {f}
              </Text>
            ))}
          </View>
          <View style={{ alignItems: "flex-end", maxWidth: "40%" }}>
            <Text style={s.company}>{company?.legalName ?? "Empresa (configurar datos)"}</Text>
            {company ? <Text style={[s.small, { textAlign: "right" }]}>CUIT {formatCuit(company.taxId)}</Text> : null}
            <Text style={[s.small, { textAlign: "right" }]}>Reporte interno de gestión</Text>
          </View>
        </View>
        {report.tables.map((t, i) => (
          <TableView key={i} table={t} fontSize={fontSize} />
        ))}
        {report.notes.length ? (
          <View style={s.notes} wrap={false}>
            {report.notes.map((n, i) => (
              <Text key={i} style={s.small}>
                {n}
              </Text>
            ))}
          </View>
        ) : null}
        <View style={s.footer} fixed>
          <Text>
            Generado el {generated} por {generatedBy}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function reportToPdf(report: ReportResult, company: CompanyHeader | null, generatedBy: string): Promise<Buffer> {
  return renderToBuffer(<ReportPdf report={report} company={company} generatedBy={generatedBy} />);
}
