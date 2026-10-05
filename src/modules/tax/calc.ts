import Decimal from "decimal.js";

/**
 * Cálculo tributario de un comprobante registrado (G.2). Funciones puras: sin base de datos,
 * para poder probarlas exhaustivamente. Todo en `Decimal`; nunca `number` para importes.
 */

export interface VatLineInput {
  taxId: number;
  /** Alícuota del catálogo (porcentaje, ej. "21.000"). */
  rate: string;
  base: Decimal;
  amount: Decimal;
}

export interface OtherLineInput {
  taxId: number;
  kind: "PERCEPTION" | "OTHER_TAX";
  amount: Decimal;
  jurisdictionId: number | null;
}

export interface DocumentAmountsInput {
  vatLines: VatLineInput[];
  otherLines: OtherLineInput[];
  netUntaxed: Decimal;
  netExempt: Decimal;
  discount: Decimal;
  /** Cotización: los importes se ingresan en la moneda del comprobante y se registran en ARS. */
  exchangeRate: Decimal;
  /** Tolerancia por alícuota entre el IVA ingresado y base × alícuota (D4). */
  vatTolerance: Decimal;
}

export interface ComputedLine {
  taxId: number;
  kind: "VAT" | "PERCEPTION" | "OTHER_TAX";
  base: string | null;
  rate: string | null;
  amount: string;
  jurisdictionId: number | null;
}

export interface DocumentTotals {
  netTaxed: string;
  netUntaxed: string;
  netExempt: string;
  vatTotal: string;
  perceptionsTotal: string;
  otherTaxesTotal: string;
  discountTotal: string;
  total: string;
  lines: ComputedLine[];
}

export type LineErrors = Record<string, string[]>;

const toArs = (v: Decimal, rate: Decimal) => v.mul(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** IVA esperado: base × alícuota / 100, redondeado a centavos (mitad hacia arriba). */
export function expectedVat(base: Decimal, rate: string): Decimal {
  return base.mul(rate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Valida las líneas y calcula los totales. Devuelve errores por campo (vat.0, other.1, …) o
 * los totales listos para guardar. El total siempre se deriva de sus componentes:
 * TOTAL = netos + IVA + percepciones + otros impuestos − descuentos (sección 16).
 */
export function computeDocumentTotals(input: DocumentAmountsInput): { errors: LineErrors } | { totals: DocumentTotals } {
  const errors: LineErrors = {};
  const add = (k: string, m: string) => (errors[k] ??= []).push(m);

  const seenVat = new Set<number>();
  input.vatLines.forEach((l, i) => {
    if (seenVat.has(l.taxId)) add(`vat.${i}`, "Esa alícuota ya está cargada en otra línea.");
    seenVat.add(l.taxId);
    if (l.base.isNegative() || l.amount.isNegative()) add(`vat.${i}`, "Los importes no pueden ser negativos.");
    const diff = l.amount.minus(expectedVat(l.base, l.rate)).abs();
    if (diff.greaterThan(input.vatTolerance)) {
      add(
        `vat.${i}`,
        `El IVA ingresado (${l.amount.toFixed(2)}) difiere de base × ${new Decimal(l.rate).toString()}% = ${expectedVat(l.base, l.rate).toFixed(2)} en más de la tolerancia (${input.vatTolerance.toFixed(2)}).`,
      );
    }
  });
  const seenOther = new Set<string>();
  input.otherLines.forEach((l, i) => {
    const key = `${l.taxId}:${l.jurisdictionId ?? 0}`;
    if (seenOther.has(key)) add(`other.${i}`, "Ese concepto ya está cargado en otra línea.");
    seenOther.add(key);
    if (!l.amount.greaterThan(0)) add(`other.${i}`, "El importe debe ser mayor que cero.");
  });
  for (const [field, v] of [
    ["netUntaxed", input.netUntaxed],
    ["netExempt", input.netExempt],
    ["discount", input.discount],
  ] as const) {
    if (v.isNegative()) add(field, "No puede ser negativo.");
  }
  if (!input.exchangeRate.greaterThan(0)) add("exchangeRate", "La cotización debe ser mayor que cero.");
  if (Object.keys(errors).length) return { errors };

  const fx = input.exchangeRate;
  const lines: ComputedLine[] = [
    ...input.vatLines.map((l) => ({
      taxId: l.taxId,
      kind: "VAT" as const,
      base: toArs(l.base, fx).toFixed(2),
      rate: new Decimal(l.rate).toFixed(3),
      amount: toArs(l.amount, fx).toFixed(2),
      jurisdictionId: null,
    })),
    ...input.otherLines.map((l) => ({
      taxId: l.taxId,
      kind: l.kind,
      base: null,
      rate: null,
      amount: toArs(l.amount, fx).toFixed(2),
      jurisdictionId: l.jurisdictionId,
    })),
  ];
  const sum = (pred: (l: ComputedLine) => boolean, f: (l: ComputedLine) => string | null) =>
    lines.filter(pred).reduce((a, l) => a.plus(f(l) ?? "0"), new Decimal(0));

  const netTaxed = sum((l) => l.kind === "VAT", (l) => l.base);
  const vatTotal = sum((l) => l.kind === "VAT", (l) => l.amount);
  const perceptionsTotal = sum((l) => l.kind === "PERCEPTION", (l) => l.amount);
  const otherTaxesTotal = sum((l) => l.kind === "OTHER_TAX", (l) => l.amount);
  const netUntaxed = toArs(input.netUntaxed, fx);
  const netExempt = toArs(input.netExempt, fx);
  const discountTotal = toArs(input.discount, fx);
  const total = netTaxed.plus(netUntaxed).plus(netExempt).plus(vatTotal).plus(perceptionsTotal).plus(otherTaxesTotal).minus(discountTotal);

  if (!total.greaterThan(0)) return { errors: { total: ["El total del comprobante debe ser mayor que cero."] } };

  return {
    totals: {
      netTaxed: netTaxed.toFixed(2),
      netUntaxed: netUntaxed.toFixed(2),
      netExempt: netExempt.toFixed(2),
      vatTotal: vatTotal.toFixed(2),
      perceptionsTotal: perceptionsTotal.toFixed(2),
      otherTaxesTotal: otherTaxesTotal.toFixed(2),
      discountTotal: discountTotal.toFixed(2),
      total: total.toFixed(2),
      lines,
    },
  };
}

/** Formato de numeración fiscal: 00001-00000123. */
export function formatDocumentNumber(pointOfSale: number, number: number): string {
  return `${String(pointOfSale).padStart(5, "0")}-${String(number).padStart(8, "0")}`;
}
