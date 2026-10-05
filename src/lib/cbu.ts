/** Validación de CBU (22 dígitos en dos bloques, cada uno con su dígito verificador). */

const BLOCK1_WEIGHTS = [7, 1, 3, 9, 7, 1, 3] as const;
const BLOCK2_WEIGHTS = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3] as const;

function checkDigit(digits: string, weights: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += Number(digits[i]) * weights[i]!;
  return (10 - (sum % 10)) % 10;
}

export function normalizeCbu(value: string): string {
  return value.replace(/[\s-]/g, "");
}

export function isValidCbu(value: string): boolean {
  const v = normalizeCbu(value);
  if (!/^\d{22}$/.test(v)) return false;
  return (
    checkDigit(v.slice(0, 7), BLOCK1_WEIGHTS) === Number(v[7]) &&
    checkDigit(v.slice(8, 21), BLOCK2_WEIGHTS) === Number(v[21])
  );
}

/** Alias CBU: 6 a 20 caracteres, letras, números, punto o guion. */
export function isValidCbuAlias(value: string): boolean {
  return /^[A-Za-z0-9.-]{6,20}$/.test(value);
}
