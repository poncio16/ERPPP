/** Validación de CUIT/CUIL/CDI (11 dígitos con dígito verificador módulo 11). */

const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;
const VALID_PREFIXES = new Set(["20", "23", "24", "25", "26", "27", "30", "33", "34", "50", "51", "55"]);

/** Quita guiones, puntos y espacios. */
export function normalizeCuit(value: string): string {
  return value.replace(/[\s.-]/g, "");
}

export function cuitCheckDigit(first10: string): number {
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(first10[i]) * WEIGHTS[i]!;
  const r = 11 - (sum % 11);
  return r === 11 ? 0 : r === 10 ? 9 : r;
}

export function isValidCuit(value: string): boolean {
  const v = normalizeCuit(value);
  if (!/^\d{11}$/.test(v)) return false;
  if (!VALID_PREFIXES.has(v.slice(0, 2))) return false;
  return cuitCheckDigit(v.slice(0, 10)) === Number(v[10]);
}

/** 20123456786 → 20-12345678-6 (si no tiene 11 dígitos se devuelve tal cual). */
export function formatCuit(value: string | null | undefined): string {
  if (!value) return "";
  return /^\d{11}$/.test(value) ? `${value.slice(0, 2)}-${value.slice(2, 10)}-${value.slice(10)}` : value;
}
