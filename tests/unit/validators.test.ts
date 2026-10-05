import { describe, expect, it } from "vitest";
import { isValidCbu, isValidCbuAlias } from "@/lib/cbu";
import { cuitCheckDigit, formatCuit, isValidCuit, normalizeCuit } from "@/lib/cuit";
import { formatMoney, parseAmount, toMoneyString } from "@/lib/money";

describe("CUIT", () => {
  it("acepta CUIT válidas con o sin guiones", () => {
    expect(isValidCuit("20-12345678-6")).toBe(true);
    expect(isValidCuit("30500010912")).toBe(true); // CUIT conocida (formato persona jurídica)
    expect(isValidCuit("27 28033514 8")).toBe(true);
  });
  it("rechaza dígito verificador incorrecto, largo inválido o prefijo inexistente", () => {
    expect(isValidCuit("20-12345678-5")).toBe(false);
    expect(isValidCuit("2012345678")).toBe(false);
    expect(isValidCuit("201234567861")).toBe(false);
    expect(isValidCuit("99123456780")).toBe(false);
    expect(isValidCuit("20-1234567A-6")).toBe(false);
  });
  it("calcula el dígito verificador (resto 11 → 0, resto 10 → 9)", () => {
    expect(cuitCheckDigit("2012345678")).toBe(6);
    for (let i = 0; i < 200; i++) {
      const base = `30${String(10000000 + i * 7919).slice(0, 8)}`;
      expect(isValidCuit(base + cuitCheckDigit(base))).toBe(true);
    }
  });
  it("normaliza y formatea", () => {
    expect(normalizeCuit("20-12345678-6")).toBe("20123456786");
    expect(formatCuit("20123456786")).toBe("20-12345678-6");
    expect(formatCuit("ABC")).toBe("ABC");
  });
});

describe("CBU", () => {
  it("valida los dos dígitos verificadores", () => {
    expect(isValidCbu("2850590940090418135201")).toBe(true);
    expect(isValidCbu("2850590940090418135202")).toBe(false);
    expect(isValidCbu("2850590840090418135201")).toBe(false);
    expect(isValidCbu("285059094009041813520")).toBe(false);
  });
  it("valida el formato del alias", () => {
    expect(isValidCbuAlias("mi.alias.pago")).toBe(true);
    expect(isValidCbuAlias("corto")).toBe(false);
    expect(isValidCbuAlias("con espacio")).toBe(false);
  });
});

describe("Importes", () => {
  it.each([
    ["1.500.000,50", "1500000.50"],
    ["1500000,5", "1500000.50"],
    ["1500000.50", "1500000.50"],
    ["1.500", "1500.00"],
    ["1.5", "1.50"],
    ["$ 250", "250.00"],
    ["0", "0.00"],
  ])("interpreta %s como %s", (input, expected) => {
    const d = parseAmount(input);
    expect(d && toMoneyString(d)).toBe(expected);
  });
  it("rechaza textos inválidos y más de 2 decimales", () => {
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("1,2,3")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(toMoneyString(parseAmount("10,555")!)).toBeNull();
  });
  it("formatea en es-AR sin pasar por float", () => {
    expect(formatMoney("1500000.5")).toMatch(/^\$\s1\.500\.000,50$/);
    expect(formatMoney("12345678901234.55", false)).toBe("12.345.678.901.234,55");
    expect(formatMoney(null)).toBe("—");
  });
});
