import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { formatPeriod } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { formatDocumentNumber } from "@/modules/tax/calc";
import type { DbOrTx } from "@/server/db/drizzle";
import type { Direction } from "@/server/db/schema";
import { CREDIT_CLASS_SQL, m, SIDE_INFO } from "./common";
import type { VatBookQuery } from "./schemas";
import type { ReportColumn, ReportResult, ReportRow } from "./types";

/**
 * Subdiario de IVA ventas / compras (G.15): un renglón por comprobante fiscal vigente del período
 * de IVA, con neto e IVA por alícuota, no gravado, exento, percepciones por impuesto y jurisdicción,
 * otros impuestos y total. Las notas de crédito restan. Es un listado de control interno armado con
 * los comprobantes registrados; no es el Libro IVA Digital ni se presenta ante ARCA.
 */

type VatDoc = {
  id: number;
  issue_date: string;
  vat_period: string;
  type_name: string;
  letter: string | null;
  is_credit: boolean;
  vat_creditable: boolean;
  point_of_sale: number;
  number: number;
  party_name: string;
  party_tax_id: string | null;
  vat_condition: string;
  net_untaxed: string;
  net_exempt: string;
  other_taxes_total: string;
  discount_total: string;
  total: string;
};

export async function vatBookReport(db: DbOrTx, direction: Direction, q: VatBookQuery): Promise<ReportResult> {
  const info = SIDE_INFO[direction];
  const sales = direction === "ISSUED";
  const from = `${q.from}-01`;
  const to = `${q.to}-01`;
  const { rows: docs } = await db.execute<VatDoc>(sql`
    SELECT d.id, d.issue_date::text, d.vat_period::text, t.name AS type_name, t.letter, t.class IN ${CREDIT_CLASS_SQL} AS is_credit, t.vat_creditable,
           d.point_of_sale, d.number, d.party_name, d.party_tax_id, vc.name AS vat_condition,
           d.net_untaxed::text, d.net_exempt::text, d.other_taxes_total::text, d.discount_total::text, d.total::text
      FROM documents d
      JOIN document_types t ON t.id = d.document_type_id
      JOIN vat_conditions vc ON vc.id = d.party_vat_condition_id
     WHERE d.direction = ${direction} AND t.is_fiscal AND d.status <> 'ANNULLED' AND d.vat_period BETWEEN ${from} AND ${to}
     ORDER BY d.vat_period, d.issue_date, d.id`);
  const { rows: lines } = await db.execute<{ document_id: number; kind: "VAT" | "PERCEPTION" | "OTHER_TAX"; rate: string | null; base: string | null; amount: string; tax_id: number; tax_name: string; jurisdiction_id: number | null; jurisdiction: string | null }>(sql`
    SELECT l.document_id, l.kind, l.rate::text, l.base_amount::text AS base, l.amount::text, l.tax_id, tc.name AS tax_name, l.jurisdiction_id, pr.name AS jurisdiction
      FROM document_tax_lines l
      JOIN documents d ON d.id = l.document_id
      JOIN document_types t ON t.id = d.document_type_id
      JOIN tax_catalog tc ON tc.id = l.tax_id
      LEFT JOIN provinces pr ON pr.id = l.jurisdiction_id
     WHERE d.direction = ${direction} AND t.is_fiscal AND d.status <> 'ANNULLED' AND d.vat_period BETWEEN ${from} AND ${to}
       AND l.kind IN ('VAT','PERCEPTION')
     ORDER BY l.id`);

  // Columnas dinámicas: una por alícuota presente y una por percepción (impuesto + jurisdicción).
  const rates = [...new Set(lines.filter((l) => l.kind === "VAT").map((l) => new Decimal(l.rate!).toFixed(3)))].sort((a, b) => new Decimal(a).comparedTo(b));
  const rateLabel = (r: string) => `${new Decimal(r).toString().replace(".", ",")}%`;
  const perceptionKey = (l: { tax_id: number; jurisdiction_id: number | null }) => `p${l.tax_id}_${l.jurisdiction_id ?? 0}`;
  const perceptions = new Map<string, string>();
  for (const l of lines) {
    if (l.kind !== "PERCEPTION") continue;
    const label = l.jurisdiction && !l.tax_name.includes(l.jurisdiction) ? `${l.tax_name} – ${l.jurisdiction}` : l.tax_name;
    perceptions.set(perceptionKey(l), label);
  }
  const perceptionCols = [...perceptions.entries()].sort(([, a], [, b]) => a.localeCompare(b, "es"));
  const byDoc = new Map<number, typeof lines>();
  for (const l of lines) {
    const id = Number(l.document_id);
    byDoc.set(id, [...(byDoc.get(id) ?? []), l]);
  }

  const amountKeys = [
    ...rates.flatMap((r) => [`n${r}`, `v${r}`]),
    "untaxed",
    "exempt",
    ...perceptionCols.map(([k]) => k),
    "other",
    "discount",
    "total",
  ];
  const mismatches: string[] = [];
  const out: ReportRow[] = docs.map((d) => {
    const sign = d.is_credit ? -1 : 1;
    const s = (v: Decimal | string) => new Decimal(v).mul(sign).toFixed(2);
    const cells: ReportRow["cells"] = {
      date: d.issue_date,
      period: formatPeriod(d.vat_period),
      type: d.type_name,
      number: formatDocumentNumber(d.point_of_sale, Number(d.number)),
      party: d.party_name,
      taxId: d.party_tax_id,
      condition: d.vat_condition,
      untaxed: s(d.net_untaxed),
      exempt: s(d.net_exempt),
      other: s(d.other_taxes_total),
      discount: d.discount_total === "0.00" ? null : new Decimal(d.discount_total).mul(-sign).toFixed(2),
      total: s(d.total),
    };
    for (const l of byDoc.get(Number(d.id)) ?? []) {
      if (l.kind === "VAT") {
        const r = new Decimal(l.rate!).toFixed(3);
        cells[`n${r}`] = s(new Decimal((cells[`n${r}`] as string | undefined) ?? 0).mul(sign).plus(l.base!));
        cells[`v${r}`] = s(new Decimal((cells[`v${r}`] as string | undefined) ?? 0).mul(sign).plus(l.amount));
      } else {
        const k = perceptionKey(l);
        cells[k] = s(new Decimal((cells[k] as string | undefined) ?? 0).mul(sign).plus(l.amount));
      }
    }
    // Control por renglón: la suma de las columnas debe dar el total del comprobante.
    const sum = amountKeys.filter((k) => k !== "total").reduce((a, k) => a.plus((cells[k] as string | null | undefined) ?? 0), new Decimal(0));
    if (!sum.equals(cells.total as string)) mismatches.push(`${d.type_name} ${cells.number}: columnas ${formatMoney(sum)} y total ${formatMoney(cells.total as string)}`);
    return { href: `${info.documentPath}/${d.id}`, cells };
  });

  const totals: Record<string, string> = { party: `Total (${out.length} comprobantes)` };
  for (const k of amountKeys) totals[k] = m(out.reduce((a, x) => a.plus((x.cells[k] as string | null | undefined) ?? 0), new Decimal(0)));

  const columns: ReportColumn[] = [
    { key: "date", label: "Fecha", type: "date" },
    { key: "period", label: "Período IVA", type: "text" },
    { key: "type", label: "Tipo", type: "text" },
    { key: "number", label: "Número", type: "text" },
    { key: "party", label: info.party, type: "text" },
    { key: "taxId", label: "CUIT", type: "text" },
    { key: "condition", label: "Condición IVA", type: "text" },
    ...rates.flatMap((r): ReportColumn[] => [
      { key: `n${r}`, label: "Neto", type: "money", group: `Alícuota ${rateLabel(r)}` },
      { key: `v${r}`, label: "IVA", type: "money", group: `Alícuota ${rateLabel(r)}` },
    ]),
    { key: "untaxed", label: "No gravado", type: "money" },
    { key: "exempt", label: "Exento", type: "money" },
    ...perceptionCols.map(([key, label]): ReportColumn => ({ key, label, type: "money", group: "Percepciones" })),
    { key: "other", label: "Otros impuestos", type: "money" },
    { key: "discount", label: "Descuentos", type: "money" },
    { key: "total", label: "Total", type: "money" },
  ];

  const summary: ReportRow[] = [
    ...rates.flatMap((r) => [
      { cells: { concept: `Neto gravado ${rateLabel(r)}`, amount: totals[`n${r}`]! } },
      { cells: { concept: `${sales ? "IVA débito fiscal" : "IVA crédito fiscal"} ${rateLabel(r)}`, amount: totals[`v${r}`]! } },
    ]),
    { cells: { concept: "No gravado", amount: totals.untaxed! } },
    { cells: { concept: "Exento", amount: totals.exempt! } },
    ...perceptionCols.map(([k, label]) => ({ cells: { concept: `Percepción ${label}`, amount: totals[k]! } })),
    { cells: { concept: "Otros impuestos", amount: totals.other! } },
    { cells: { concept: "Descuentos", amount: totals.discount! } },
  ];
  const vatTotal = rates.reduce((a, r) => a.plus(totals[`v${r}`]!), new Decimal(0));

  const notes = [
    "Listado de control interno armado con los comprobantes registrados. No reemplaza al Libro IVA Digital ni se presenta ante ARCA.",
    "Incluye solo comprobantes fiscales vigentes, por período de IVA. Las notas de crédito restan. Importes en pesos.",
    `Total de IVA del período: ${formatMoney(vatTotal)}.`,
  ];
  if (!sales && docs.some((d) => !d.vat_creditable)) notes.push("Los comprobantes B y C recibidos no discriminan IVA: su importe figura como neto y no computa crédito fiscal.");
  if (mismatches.length) notes.push(`Atención: ${mismatches.length} comprobante(s) con diferencia entre columnas y total: ${mismatches.slice(0, 5).join("; ")}.`);

  return {
    title: sales ? "Subdiario de IVA ventas" : "Subdiario de IVA compras",
    filters: [q.from === q.to ? `Período de IVA: ${formatPeriod(from)}` : `Períodos de IVA: ${formatPeriod(from)} a ${formatPeriod(to)}`],
    tables: [
      { columns, rows: out, totals, emptyMessage: "No hay comprobantes fiscales en el período." },
      {
        title: "Resumen del período",
        columns: [
          { key: "concept", label: "Concepto", type: "text" },
          { key: "amount", label: "Importe", type: "money" },
        ],
        rows: summary,
        totals: { concept: "Total", amount: totals.total! },
      },
    ],
    notes,
    filename: `subdiario-iva-${sales ? "ventas" : "compras"}-${q.from}${q.to === q.from ? "" : `-${q.to}`}`,
  };
}
