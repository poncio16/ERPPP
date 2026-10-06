import { describe, expect, it } from "vitest";
import { amountInWords, integerToWords } from "@/lib/number-to-words";

describe("Importe en letras (G.13)", () => {
  it.each([
    [0, "cero"],
    [1, "uno"],
    [15, "quince"],
    [21, "veintiuno"],
    [31, "treinta y uno"],
    [100, "cien"],
    [101, "ciento uno"],
    [1000, "mil"],
    [1500, "mil quinientos"],
    [21000, "veintiún mil"],
    [31000, "treinta y un mil"],
    [100000, "cien mil"],
    [121000, "ciento veintiún mil"],
    [500000, "quinientos mil"],
    [1000000, "un millón"],
    [1200000, "un millón doscientos mil"],
    [2000001, "dos millones uno"],
    [21000000, "veintiún millones"],
    [999999999999, "novecientos noventa y nueve mil novecientos noventa y nueve millones novecientos noventa y nueve mil novecientos noventa y nueve"],
  ])("%d → %s", (n, words) => {
    expect(integerToWords(n)).toBe(words);
  });

  it("formato del recibo con centavos", () => {
    expect(amountInWords("1200000.50")).toBe("Son pesos un millón doscientos mil con 50/100");
    expect(amountInWords("700000")).toBe("Son pesos setecientos mil con 00/100");
    expect(amountInWords("0.05")).toBe("Son pesos cero con 05/100");
  });

  it("rechaza importes fuera de rango", () => {
    expect(() => integerToWords(1_000_000_000_000)).toThrow(RangeError);
    expect(() => amountInWords("-1")).toThrow(RangeError);
  });
});
