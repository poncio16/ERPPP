import { eq, sql } from "drizzle-orm";
import { DomainError } from "@/lib/errors";
import type { Tx } from "@/server/db/drizzle";
import { numberingSequences } from "@/server/db/schema";

export type SequenceKey = "RECEIPT" | "PAYMENT_ORDER" | "CLIENT_CODE" | "SUPPLIER_CODE" | "INTERNAL_DOC";

/**
 * Toma el próximo número de una secuencia interna. El UPDATE bloquea la fila hasta el fin de la
 * transacción: dos operaciones concurrentes nunca obtienen el mismo número, y si la transacción
 * se revierte el número no se consume.
 */
export async function nextSequenceNumber(tx: Tx, key: SequenceKey): Promise<string> {
  const [row] = await tx
    .update(numberingSequences)
    .set({ nextValue: sql`${numberingSequences.nextValue} + 1`, updatedAt: new Date() })
    .where(eq(numberingSequences.key, key))
    .returning({
      value: sql<string>`(${numberingSequences.nextValue} - 1)::text`,
      prefix: numberingSequences.prefix,
      padding: numberingSequences.padding,
    });
  if (!row) throw new DomainError(`Falta configurar la numeración ${key}.`, "CONFIG");
  return row.prefix + row.value.padStart(row.padding, "0");
}
