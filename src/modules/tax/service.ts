import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import Decimal from "decimal.js";
import { getConfig } from "@/modules/config/service";
import type { DbOrTx } from "@/server/db/drizzle";
import { documentTypes, provinces, taxCatalog, vatConditions } from "@/server/db/schema";

/**
 * Lógica fiscal centralizada (G.2-7): catálogo de impuestos con vigencia, tipos de comprobante,
 * matriz letra / condición IVA y tolerancia. Ninguna alícuota está escrita en el código.
 */

export type TaxCatalogRow = typeof taxCatalog.$inferSelect;

/** Impuestos vigentes a una fecha (AAAA-MM-DD), opcionalmente de un tipo. */
export async function taxesValidAt(db: DbOrTx, date: string) {
  return db
    .select()
    .from(taxCatalog)
    .where(
      and(
        eq(taxCatalog.active, true),
        lte(taxCatalog.validFrom, date),
        or(isNull(taxCatalog.validTo), gte(taxCatalog.validTo, date)),
      ),
    )
    .orderBy(asc(taxCatalog.sortOrder), asc(taxCatalog.id));
}

export async function allTaxes(db: DbOrTx) {
  return db.select().from(taxCatalog).orderBy(asc(taxCatalog.kind), asc(taxCatalog.sortOrder), asc(taxCatalog.id));
}

export async function documentTypesFor(db: DbOrTx, direction: "ISSUED" | "RECEIVED") {
  const rows = await db
    .select()
    .from(documentTypes)
    .where(and(eq(documentTypes.active, true), eq(documentTypes.isFiscal, true)))
    .orderBy(asc(documentTypes.arcaCode));
  return rows.filter((t) => (direction === "ISSUED" ? t.allowedIssued : t.allowedReceived));
}

export async function vatTolerance(db: DbOrTx): Promise<Decimal> {
  const v = await getConfig(db, "vat_tolerance_per_rate");
  return new Decimal(String(v ?? "0.10"));
}

interface LetterMatrix {
  mode?: "WARN" | "BLOCK";
  issued?: Record<string, string[]>;
  received?: Record<string, string[]>;
}

/**
 * Coherencia letra del comprobante / condición IVA del tercero según la matriz configurable
 * (G.1-4, D11). Devuelve null si es coherente o si la matriz no define esa letra.
 */
export async function checkLetterVatCondition(
  db: DbOrTx,
  direction: "ISSUED" | "RECEIVED",
  letter: string | null,
  vatConditionId: number,
): Promise<{ mode: "WARN" | "BLOCK"; message: string } | null> {
  if (!letter) return null;
  const matrix: LetterMatrix | null = await getConfig(db, "letter_vat_matrix");
  const allowed = matrix?.[direction === "ISSUED" ? "issued" : "received"]?.[letter];
  if (!allowed) return null;
  const [cond] = await db.select({ code: vatConditions.code, name: vatConditions.name }).from(vatConditions).where(eq(vatConditions.id, vatConditionId));
  if (!cond || allowed.includes(cond.code)) return null;
  return {
    mode: matrix?.mode === "BLOCK" ? "BLOCK" : "WARN",
    message: `Un comprobante con letra ${letter} no es el habitual para un tercero "${cond.name}".`,
  };
}

export async function jurisdictions(db: DbOrTx) {
  return db.select({ id: provinces.id, name: provinces.name }).from(provinces).where(eq(provinces.active, true)).orderBy(asc(provinces.name));
}

/** Percepciones de IIBB: requieren jurisdicción. */
export const requiresJurisdiction = (tax: Pick<TaxCatalogRow, "code" | "kind">) => tax.kind === "PERCEPTION" && tax.code.startsWith("PERC_IIBB");

/** Impuestos de retención activos (retenciones sufridas en cobranzas y practicadas en pagos, D8). */
export async function retentionTaxes(db: DbOrTx) {
  return db
    .select({ id: taxCatalog.id, name: taxCatalog.name })
    .from(taxCatalog)
    .where(and(eq(taxCatalog.kind, "RETENTION"), eq(taxCatalog.active, true)))
    .orderBy(asc(taxCatalog.name));
}
