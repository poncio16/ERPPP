import Decimal from "decimal.js";

/**
 * Importe en letras para recibos y órdenes de pago internas (G.13):
 * 1200000.5 → "Son pesos un millón doscientos mil con 50/100".
 */

const UNITS = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const TEENS = ["diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve"];
const TWENTIES = ["veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function belowHundred(n: number): string {
  if (n < 10) return UNITS[n]!;
  if (n < 20) return TEENS[n - 10]!;
  if (n < 30) return TWENTIES[n - 20]!;
  const u = n % 10;
  return TENS[Math.floor(n / 10)]! + (u ? ` y ${UNITS[u]}` : "");
}

function belowThousand(n: number): string {
  if (n === 100) return "cien";
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [HUNDREDS[h], rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

/** "uno" se apocopa delante de un sustantivo: "un millón", "veintiún mil", "treinta y un mil". */
function apocope(words: string): string {
  return words.replace(/veintiuno$/, "veintiún").replace(/uno$/, "un");
}

function belowMillion(n: number): string {
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (thousands === 1) parts.push("mil");
  else if (thousands > 1) parts.push(`${apocope(belowThousand(thousands))} mil`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/** Entero no negativo en letras (hasta 999.999.999.999). */
export function integerToWords(value: number | bigint): string {
  const n = BigInt(value);
  if (n < 0n || n > 999_999_999_999n) throw new RangeError("Importe fuera de rango para expresarlo en letras.");
  if (n === 0n) return "cero";
  const millions = Number(n / 1_000_000n);
  const rest = Number(n % 1_000_000n);
  const parts: string[] = [];
  if (millions === 1) parts.push("un millón");
  else if (millions > 1) parts.push(`${apocope(belowMillion(millions))} millones`);
  if (rest) parts.push(belowMillion(rest));
  return parts.join(" ");
}

/** Importe en pesos con centavos en fracción: "Son pesos mil quinientos con 00/100". */
export function amountInWords(amount: string | Decimal, currencyWord = "pesos"): string {
  const d = new Decimal(amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (d.isNegative()) throw new RangeError("El importe en letras no admite valores negativos.");
  const integer = d.floor();
  const cents = d.minus(integer).mul(100).toNumber();
  const words = integerToWords(BigInt(integer.toFixed(0)));
  return `Son ${currencyWord} ${words} con ${String(cents).padStart(2, "0")}/100`;
}
