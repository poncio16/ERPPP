/** Código y restricción de un error de PostgreSQL (Drizzle lo envuelve en `cause`). */
export const pgError = (e: unknown) => {
  const err = ((e as { cause?: unknown }).cause ?? e) as { code?: string; constraint?: string };
  return { code: err.code, constraint: err.constraint };
};
