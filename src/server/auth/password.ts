import { hash, verify } from "@node-rs/argon2";

// Parámetros recomendados por OWASP para Argon2id: 19 MiB, 2 iteraciones, paralelismo 1.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Verificación contra un hash ficticio: iguala el tiempo de respuesta cuando el usuario no existe. */
let dummyHash: Promise<string> | undefined;
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword("contraseña-inexistente-para-igualar-tiempos");
  await verifyPassword(await dummyHash, password);
}

const COMMON_PASSWORDS = new Set([
  "123456789012",
  "contraseña123",
  "contrasena123",
  "password1234",
  "qwertyuiop12",
  "administrador",
  "admin1234567",
  "000000000000",
  "111111111111",
  "argentina123",
  "123456789abc",
]);

/** Devuelve los problemas de una contraseña respecto de la política (vacío = válida). */
export function passwordPolicyErrors(password: string, minLength: number, username?: string): string[] {
  const errors: string[] = [];
  if (password.length < minLength) errors.push(`Debe tener al menos ${minLength} caracteres.`);
  if (password.length > 200) errors.push("No puede superar los 200 caracteres.");
  if (COMMON_PASSWORDS.has(password.toLowerCase())) errors.push("Es una contraseña demasiado común.");
  if (username && password.toLowerCase().includes(username.toLowerCase()))
    errors.push("No puede contener el nombre de usuario.");
  if (/^(.)\1+$/.test(password)) errors.push("No puede ser un mismo carácter repetido.");
  return errors;
}

/** Genera una contraseña temporal legible (sin caracteres ambiguos como 0/O o 1/l). */
export function generateTemporaryPassword(length = 14): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
