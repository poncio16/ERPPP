import { createHash, randomBytes } from "node:crypto";

/** Token de sesión aleatorio de 256 bits (base64url). Solo viaja en la cookie. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** En la base se guarda únicamente el hash SHA-256 del token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
