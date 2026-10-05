import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { computeDocumentTotals, expectedVat, formatDocumentNumber } from "@/modules/tax/calc";

const D = (v: string) => new Decimal(v);
const base = { otherLines: [], netUntaxed: D("0"), netExempt: D("0"), discount: D("0"), exchangeRate: D("1"), vatTolerance: D("0.10") };

describe("Cálculo tributario", () => {
  it("CMP-IVA-01 varias alícuotas: neto 100.000 al 21% y 50.000 al 10,5% → IVA 26.250 (§15)", () => {
    const r = computeDocumentTotals({
      ...base,
      vatLines: [
        { taxId: 1, rate: "21.000", base: D("100000"), amount: D("21000") },
        { taxId: 2, rate: "10.500", base: D("50000"), amount: D("5250") },
      ],
    });
    expect("totals" in r && r.totals).toMatchObject({ netTaxed: "150000.00", vatTotal: "26250.00", total: "176250.00" });
  });

  it("CMP-IVA-02 total = netos + IVA + percepciones + otros − descuentos (§16)", () => {
    const r = computeDocumentTotals({
      ...base,
      vatLines: [{ taxId: 1, rate: "21.000", base: D("1000"), amount: D("210") }],
      otherLines: [
        { taxId: 7, kind: "PERCEPTION", amount: D("30"), jurisdictionId: 2 },
        { taxId: 11, kind: "OTHER_TAX", amount: D("12.50"), jurisdictionId: null },
      ],
      netUntaxed: D("100"),
      netExempt: D("50"),
      discount: D("2.50"),
    });
    expect("totals" in r && r.totals).toMatchObject({
      perceptionsTotal: "30.00",
      otherTaxesTotal: "12.50",
      discountTotal: "2.50",
      total: "1400.00",
    });
  });

  it("CMP-IVA-03 tolerancia por alícuota: acepta centavos de redondeo, rechaza diferencias mayores", () => {
    const ok = computeDocumentTotals({ ...base, vatLines: [{ taxId: 1, rate: "21.000", base: D("1000.33"), amount: D("210.10") }] });
    expect("totals" in ok).toBe(true);
    const bad = computeDocumentTotals({ ...base, vatLines: [{ taxId: 1, rate: "21.000", base: D("1000"), amount: D("211") }] });
    expect("errors" in bad && bad.errors["vat.0"]?.[0]).toMatch(/difiere/);
  });

  it("CMP-IVA-04 no se repite alícuota ni concepto; el total debe ser positivo", () => {
    const dup = computeDocumentTotals({
      ...base,
      vatLines: [
        { taxId: 1, rate: "21.000", base: D("10"), amount: D("2.10") },
        { taxId: 1, rate: "21.000", base: D("10"), amount: D("2.10") },
      ],
    });
    expect("errors" in dup && dup.errors["vat.1"]).toBeTruthy();
    const zero = computeDocumentTotals({ ...base, vatLines: [] });
    expect("errors" in zero && zero.errors.total).toBeTruthy();
    const neg = computeDocumentTotals({ ...base, vatLines: [], netUntaxed: D("10"), discount: D("20") });
    expect("errors" in neg && neg.errors.total).toBeTruthy();
  });

  it("CMP-IVA-05 moneda extranjera: los componentes se registran en ARS a la cotización del comprobante (D5)", () => {
    const r = computeDocumentTotals({ ...base, vatLines: [], netExempt: D("1000.50"), exchangeRate: D("1050.25") });
    expect("totals" in r && r.totals).toMatchObject({ netExempt: "1050775.13", total: "1050775.13" });
  });

  it("redondeo exacto sin float y formato de numeración", () => {
    expect(expectedVat(D("0.05"), "21.000").toFixed(2)).toBe("0.01");
    expect(expectedVat(D("33.33"), "10.500").toFixed(2)).toBe("3.50");
    expect(formatDocumentNumber(1, 123)).toBe("00001-00000123");
  });
});
