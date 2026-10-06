import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db/drizzle";
import type { FilterField } from "./registry";

export type Option = { value: string; label: string };

/** Opciones de los filtros dinámicos de un reporte (terceros, tipos de comprobante, cajas y cuentas). */
export async function filterOptions(db: DbOrTx, filters: FilterField[]): Promise<Record<string, Option[]>> {
  const out: Record<string, Option[]> = {};
  for (const f of filters) {
    if (f.kind === "party") {
      const table = sql.raw(f.direction === "ISSUED" ? "clients" : "suppliers");
      const { rows } = await db.execute<{ id: number; code: string; legal_name: string; status: string }>(
        sql`SELECT id, code, legal_name, status FROM ${table} ORDER BY lower(legal_name), id`,
      );
      out.party = rows.map((r) => ({ value: String(r.id), label: `${r.legal_name} (${r.code})${r.status === "ACTIVE" ? "" : " · inactivo"}` }));
    } else if (f.kind === "documentType") {
      const allowed = sql.raw(f.direction === "ISSUED" ? "allowed_issued" : "allowed_received");
      const { rows } = await db.execute<{ id: number; name: string }>(sql`SELECT id, name FROM document_types WHERE ${allowed} OR NOT is_fiscal ORDER BY sort_order, name`);
      out.type = rows.map((r) => ({ value: String(r.id), label: r.name }));
    } else if (f.kind === "account") {
      const { rows } =
        f.accountKind === "CASH"
          ? await db.execute<{ id: number; name: string; active: boolean }>(sql`SELECT id, name, active FROM cash_boxes ORDER BY active DESC, lower(name)`)
          : await db.execute<{ id: number; name: string; active: boolean }>(sql`SELECT id, display_name AS name, active FROM bank_accounts ORDER BY active DESC, lower(display_name)`);
      out.account = rows.map((r) => ({ value: String(r.id), label: `${r.name}${r.active ? "" : " · inactiva"}` }));
    }
  }
  return out;
}
