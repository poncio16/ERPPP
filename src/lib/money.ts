import Decimal from "decimal.js";

/**
 * Importes: siempre `Decimal` o texto con 2 decimales, nunca `number`.
 * Se aceptan los formatos habituales en Argentina: "1.500.000,50", "1500000,5", "1500000.50".
 */
export function parseAmount(input: string): Decimal | null {
  let s = input.trim().replace(/\s|\$/g, "");
  if (s === "") return null;
  if (!/^-?[0-9.,]+$/.test(s)) return null;
  if (s.includes(",")) {
    // La coma es el separador decimal; los puntos, de miles.
    if (s.indexOf(",") !== s.lastIndexOf(",")) return null;
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    const dots = s.split(".").length - 1;
    const lastGroup = s.slice(s.lastIndexOf(".") + 1);
    // "1.500" o "1.500.000" son miles; "1.5" o "1500.50" llevan punto decimal.
    if (dots > 1 || (dots === 1 && lastGroup.length === 3)) s = s.replace(/\./g, "");
  }
  try {
    const d = new Decimal(s);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** Texto para NUMERIC(18,2), o null si el importe no es válido o tiene más de 2 decimales. */
export function toMoneyString(d: Decimal): string | null {
  if (d.decimalPlaces() > 2 || d.abs().greaterThanOrEqualTo("1e16")) return null;
  return d.toFixed(2);
}

const moneyFmt = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });
const plainFmt = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1500000.5" → "$ 1.500.000,50". Formatea desde el texto exacto (sin pasar por float para el redondeo). */
export function formatMoney(value: string | Decimal | null | undefined, withSymbol = true): string {
  if (value === null || value === undefined) return "—";
  const d = new Decimal(value).toDecimalPlaces(2);
  // Intl acepta strings decimales exactos (ES2023), así que no se pierde precisión.
  const s = d.toFixed(2) as unknown as number;
  return withSymbol ? moneyFmt.format(s) : plainFmt.format(s);
}
