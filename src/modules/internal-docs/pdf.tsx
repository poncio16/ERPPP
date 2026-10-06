import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatCuit } from "@/lib/cuit";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { CompanyHeader } from "./service";
import type { InternalDocData } from "./types";

/**
 * PDF del recibo interno o la orden de pago interna (G.13), generado en el servidor con
 * @react-pdf/renderer. Mismo contenido que la versión en pantalla: snapshot guardado, leyenda de
 * documento no fiscal y marca ANULADO si corresponde.
 */

const TITLE = { RECEIPT: "RECIBO INTERNO DE REGISTRACIÓN DE COBRANZA", PAYMENT_ORDER: "ORDEN DE PAGO INTERNA" } as const;
const LEGEND = "Documento interno – no válido como comprobante fiscal";
const METHOD: Record<string, string> = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia",
  CHECK: "Cheque",
  OWN_CHECK: "Cheque propio",
  THIRD_PARTY_CHECK: "Cheque de terceros (endoso)",
  RETENTION: "Retención",
};

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#0f172a" },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#94a3b8", paddingBottom: 8 },
  company: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  title: { fontSize: 10, fontFamily: "Helvetica-Bold", textAlign: "right" },
  number: { fontSize: 12, fontFamily: "Helvetica-Bold", textAlign: "right" },
  legend: { marginTop: 4, borderWidth: 1, borderColor: "#475569", padding: 3, fontSize: 7, fontFamily: "Helvetica-Bold", textAlign: "center" },
  section: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#cbd5e1" },
  h2: { fontFamily: "Helvetica-Bold", marginBottom: 4 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0", paddingVertical: 2 },
  cMethod: { width: "22%" },
  cDetail: { width: "56%" },
  cAmount: { width: "22%", textAlign: "right" },
  cLabel: { width: "78%" },
  bold: { fontFamily: "Helvetica-Bold" },
  italic: { fontFamily: "Helvetica-Oblique" },
  annulled: { position: "absolute", top: 330, left: 90, fontSize: 80, color: "#dc2626", opacity: 0.2, transform: "rotate(-30deg)", fontFamily: "Helvetica-Bold" },
  footer: { marginTop: 30, flexDirection: "row", justifyContent: "space-between", fontSize: 8 },
  signature: { width: 180, borderTopWidth: 1, borderTopColor: "#475569", paddingTop: 2, textAlign: "center" },
});

function InternalDocPdf({ data, company }: { data: InternalDocData; company: CompanyHeader | null }) {
  const annulled = data.status === "ANNULLED";
  const retentions = data.lines.filter((l) => l.method === "RETENTION");
  return (
    <Document title={`${TITLE[data.kind]} ${data.number}`} author={company?.legalName ?? undefined} producer="ERP PyME">
      <Page size="A4" style={s.page}>
        {annulled && <Text style={s.annulled}>ANULADO</Text>}
        <View style={s.header}>
          <View>
            <Text style={s.company}>{company?.legalName ?? "Empresa (configurar datos)"}</Text>
            {company?.tradeName ? <Text>{company.tradeName}</Text> : null}
            {company ? (
              <Text>
                CUIT {formatCuit(company.taxId)} · {company.vatCondition}
              </Text>
            ) : null}
            {company && (company.address || company.city) ? <Text>{[company.address, company.city, company.province, company.postalCode].filter(Boolean).join(", ")}</Text> : null}
            {company?.grossIncomeNumber ? <Text>IIBB {company.grossIncomeNumber}</Text> : null}
          </View>
          <View style={{ alignItems: "flex-end", maxWidth: "55%" }}>
            <Text style={s.title}>{TITLE[data.kind]}</Text>
            <Text style={s.number}>N° {data.number}</Text>
            <Text style={{ textAlign: "right" }}>Fecha: {formatDate(data.issueDate)}</Text>
            <Text style={s.legend}>{LEGEND}</Text>
            {annulled ? <Text style={[s.bold, { color: "#b91c1c", textAlign: "right" }]}>ANULADO</Text> : null}
          </View>
        </View>

        <View style={s.section}>
          <Text>
            <Text style={s.bold}>{data.partyLabel}: </Text>
            {data.partyName}
          </Text>
          <Text>
            <Text style={s.bold}>CUIT: </Text>
            {data.partyTaxId ? formatCuit(data.partyTaxId) : "—"}
          </Text>
          <Text>
            <Text style={s.bold}>{data.kind === "RECEIPT" ? "Recibimos la suma de: " : "Se paga la suma de: "}</Text>
            {formatMoney(data.amount)}
          </Text>
          <Text style={s.italic}>{data.amountInWords}</Text>
        </View>

        <View style={s.section}>
          <Text style={s.h2}>{data.kind === "RECEIPT" ? "MEDIOS DE COBRO" : "MEDIOS DE PAGO"}</Text>
          {data.lines.map((l) => (
            <View key={l.id} style={s.row} wrap={false}>
              <Text style={s.cMethod}>{METHOD[l.method] ?? l.method}</Text>
              <Text style={s.cDetail}>{l.detail}</Text>
              <Text style={s.cAmount}>{formatMoney(l.amount)}</Text>
            </View>
          ))}
          <View style={s.row}>
            <Text style={[s.cLabel, s.bold, { textAlign: "right" }]}>Total</Text>
            <Text style={[s.cAmount, s.bold]}>{formatMoney(data.amount)}</Text>
          </View>
          {data.kind === "PAYMENT_ORDER" && retentions.length > 0 ? (
            <Text style={{ marginTop: 4 }}>Retenciones practicadas: {retentions.map((r) => `${r.detail} (${formatMoney(r.amount)})`).join("; ")}.</Text>
          ) : null}
        </View>

        <View style={s.section}>
          <Text style={s.h2}>COMPROBANTES IMPUTADOS</Text>
          {data.allocations.length === 0 ? <Text>Sin imputación al registrar.</Text> : null}
          {data.allocations.map((a, i) => (
            <View key={i} style={s.row} wrap={false}>
              <Text style={s.cLabel}>{a.label}</Text>
              <Text style={s.cAmount}>{formatMoney(a.amount)}</Text>
            </View>
          ))}
          {Number(data.unapplied) > 0 ? (
            <Text style={{ marginTop: 4 }}>
              {data.kind === "RECEIPT" ? "Saldo a favor del cliente: " : "Anticipo / saldo a favor ante el proveedor: "}
              <Text style={s.bold}>{formatMoney(data.unapplied)}</Text>
            </Text>
          ) : null}
        </View>

        {data.notes ? (
          <View style={s.section}>
            <Text style={s.h2}>OBSERVACIONES</Text>
            <Text>{data.notes}</Text>
          </View>
        ) : null}

        <View style={s.footer}>
          <Text>
            Registrado por {data.createdBy ?? "—"} el {formatDateTime(data.createdAt)}.
          </Text>
          <Text style={s.signature}>Firma y aclaración</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderInternalDocPdf(data: InternalDocData, company: CompanyHeader | null): Promise<Buffer> {
  return renderToBuffer(<InternalDocPdf data={data} company={company} />);
}

export const internalDocFilename = (data: InternalDocData) =>
  `${data.kind === "RECEIPT" ? "recibo" : "orden-de-pago"}-${data.number}${data.status === "ANNULLED" ? "-ANULADO" : ""}.pdf`;
