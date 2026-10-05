import { bigint, integer, numeric, timestamp } from "drizzle-orm/pg-core";

/** Clave primaria estándar: BIGINT GENERATED ALWAYS AS IDENTITY. */
export const id = () => bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity();

/** Referencia a otra tabla por id (BIGINT). */
export const ref = () => bigint({ mode: "number" });

/** Importe monetario exacto: NUMERIC(18,2). Drizzle lo devuelve como string; se opera con Decimal. */
export const money = () => numeric({ precision: 18, scale: 2 });

/** Alícuota en porcentaje: NUMERIC(6,3), ej. 10.500. */
export const rate = () => numeric({ precision: 6, scale: 3 });

/** Cotización: NUMERIC(18,6). */
export const fxRate = () => numeric({ precision: 18, scale: 6 });

export const tstz = () => timestamp({ withTimezone: true, mode: "date" });

/** Columnas de trazabilidad de fila para tablas de negocio. */
export const auditColumns = () => ({
  createdAt: tstz().notNull().defaultNow(),
  createdBy: ref(),
  updatedAt: tstz(),
  updatedBy: ref(),
});

/** Bloqueo optimista para ediciones de maestros y comprobantes. */
export const version = () => integer().notNull().default(1);
