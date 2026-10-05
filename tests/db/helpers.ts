import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { Pool, type PoolClient } from "pg";
import { expect } from "vitest";
import { testUrls } from "../setup/test-env";

/** Conexión con el rol de la aplicación (erp_app), el mismo que usa el sistema en producción. */
export const appPool = new Pool({ connectionString: testUrls().app, max: 20 });
/** Conexión con el rol dueño del esquema, para comprobar que ni siquiera él puede saltear los triggers. */
export const ownerPool = new Pool({ connectionString: testUrls().owner, max: 2 });

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = [], pool = appPool) {
  const r = await pool.query(text, params);
  return r.rows as T[];
}

/** Igual que `q` pero devuelve la primera fila y falla si no hay ninguna. */
export async function q1<T = Record<string, unknown>>(text: string, params: unknown[] = [], pool = appPool) {
  const [row] = await q<T>(text, params, pool);
  if (!row) throw new Error(`La consulta no devolvió filas: ${text}`);
  return row;
}

/** Ejecuta en una transacción con COMMIT (así se disparan las restricciones diferidas). */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>, pool = appPool): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

export async function expectDbError(p: Promise<unknown>, match: RegExp | string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e as { message: string; code?: string },
  );
  expect(err, `se esperaba un error de base de datos que coincida con ${match}`).not.toBeNull();
  if (typeof match === "string") expect(err!.code ?? err!.message).toBe(match);
  else expect(err!.message).toMatch(match);
}

const cache = new Map<string, number>();
async function idByCode(table: string, code: string): Promise<number> {
  const key = `${table}:${code}`;
  if (!cache.has(key)) {
    const row = await q1<{ id: string }>(`SELECT id FROM ${table} WHERE code = $1`, [code]);
    cache.set(key, Number(row.id));
  }
  return cache.get(key)!;
}
export const docType = (code: string) => idByCode("document_types", code);
export const tax = (code: string) => idByCode("tax_catalog", code);
export const vatCond = (code: string) => idByCode("vat_conditions", code);
export const idType = (code: string) => idByCode("id_types", code);
export const bank = (code: string) => idByCode("banks", code);
export const concept = (code: string) => idByCode("treasury_concepts", code);

let seq = Date.now() % 1_000_000;
export const nextSeq = () => ++seq;
const nextTaxId = () => String(20_000_000_000 + nextSeq() * 7);

export async function makeClient(overrides: { taxId?: string | null; duplicateTaxIdReason?: string } = {}) {
  const n = nextSeq();
  const r = await q1<{ id: string }>(
    `INSERT INTO clients (code, legal_name, id_type_id, tax_id, vat_condition_id, duplicate_tax_id_reason)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      `CT${n}`,
      `Cliente ${n}`,
      await idType("CUIT"),
      overrides.taxId === undefined ? nextTaxId() : overrides.taxId,
      await vatCond("RI"),
      overrides.duplicateTaxIdReason ?? null,
    ],
  );
  return Number(r.id);
}

export async function makeSupplier(overrides: { taxId?: string } = {}) {
  const n = nextSeq();
  const r = await q1<{ id: string }>(
    `INSERT INTO suppliers (code, legal_name, id_type_id, tax_id, vat_condition_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [`PT${n}`, `Proveedor ${n}`, await idType("CUIT"), overrides.taxId ?? nextTaxId(), await vatCond("RI")],
  );
  return Number(r.id);
}

export interface TaxLineInput {
  tax: string;
  kind: "VAT" | "PERCEPTION" | "OTHER_TAX";
  base?: string;
  rate?: string;
  amount: string;
}

export interface DocInput {
  direction: "ISSUED" | "RECEIVED";
  type: string;
  partyId: number;
  pos?: number;
  number?: number;
  lines?: TaxLineInput[];
  netUntaxed?: string;
  netExempt?: string;
  discount?: string;
  reason?: string;
  /** Sobrescribe columnas de cabecera para forzar inconsistencias en las pruebas. */
  header?: Record<string, string>;
}

/** Inserta un comprobante con su detalle, calculando la cabecera a partir de las líneas. */
export async function insertDocument(c: PoolClient, d: DocInput): Promise<number> {
  const lines = d.lines ?? [];
  const sum = (k: TaxLineInput["kind"], f: (l: TaxLineInput) => string | undefined) =>
    lines.filter((l) => l.kind === k).reduce((a, l) => a.plus(f(l) ?? "0"), new Decimal(0));
  const h: Record<string, string> = {
    net_taxed: sum("VAT", (l) => l.base).toFixed(2),
    net_untaxed: d.netUntaxed ?? "0",
    net_exempt: d.netExempt ?? "0",
    vat_total: sum("VAT", (l) => l.amount).toFixed(2),
    perceptions_total: sum("PERCEPTION", (l) => l.amount).toFixed(2),
    other_taxes_total: sum("OTHER_TAX", (l) => l.amount).toFixed(2),
    discount_total: d.discount ?? "0",
  };
  h.total = Object.entries(h)
    .reduce((a, [k, v]) => (k === "discount_total" ? a.minus(v) : a.plus(v)), new Decimal(0))
    .toFixed(2);
  h.balance = h.total;
  Object.assign(h, d.header);
  const party = d.direction === "ISSUED" ? "client_id" : "supplier_id";
  const cols = Object.keys(h);
  const [r] = (
    await c.query(
      `INSERT INTO documents (direction, document_type_id, point_of_sale, number, ${party}, party_name,
         party_vat_condition_id, issue_date, due_date, vat_period, reason, idempotency_key, ${cols.join(", ")})
       VALUES ($1, $2, $3, $4, $5, 'Tercero', $6, DATE '2026-10-01', DATE '2026-10-31', DATE '2026-10-01', $7, $8,
         ${cols.map((_, i) => `$${i + 9}`).join(", ")})
       RETURNING id`,
      [
        d.direction,
        await docType(d.type),
        d.pos ?? 1,
        d.number ?? nextSeq(),
        d.partyId,
        await vatCond("RI"),
        d.reason ?? null,
        randomUUID(),
        ...cols.map((k) => h[k]),
      ],
    )
  ).rows;
  for (const l of lines) {
    await c.query(
      `INSERT INTO document_tax_lines (document_id, tax_id, kind, base_amount, rate, amount) VALUES ($1,$2,$3,$4,$5,$6)`,
      [r.id, await tax(l.tax), l.kind, l.base ?? null, l.rate ?? null, l.amount],
    );
  }
  return Number(r.id);
}

export const makeDocument = (d: DocInput) => tx((c) => insertDocument(c, d));

/** Factura A emitida con IVA 21%: neto `net`, IVA = 21%. */
export const invoiceA = (clientId: number, net: string, extra: Partial<DocInput> = {}) =>
  makeDocument({
    direction: "ISSUED",
    type: "FA",
    partyId: clientId,
    lines: [{ tax: "IVA_21", kind: "VAT", base: net, rate: "21.000", amount: new Decimal(net).mul("0.21").toFixed(2) }],
    ...extra,
  });

export async function makeCashBox() {
  const r = await q1<{ id: string }>(`INSERT INTO cash_boxes (name) VALUES ($1) RETURNING id`, [`Caja ${nextSeq()}`]);
  return Number(r.id);
}

export async function makeBankAccount() {
  const n = nextSeq();
  const r = await q1<{ id: string }>(
    `INSERT INTO bank_accounts (bank_id, account_type, account_number, display_name) VALUES ($1,'CC',$2,$3) RETURNING id`,
    [await bank("011"), `CC-${n}`, `Cuenta ${n}`],
  );
  return Number(r.id);
}

/** Cobranza en efectivo (sin imputar) con su movimiento de caja. Devuelve ids. */
export async function makeCashCollection(clientId: number, amount: string, cashBoxId: number) {
  return tx(async (c) => {
    const col = (
      await c.query(
        `INSERT INTO collections (client_id, collection_date, total_amount, unapplied_amount, idempotency_key)
         VALUES ($1, DATE '2026-10-02', $2, $2, $3) RETURNING id`,
        [clientId, amount, randomUUID()],
      )
    ).rows[0];
    const line = (
      await c.query(
        `INSERT INTO collection_lines (collection_id, line_no, method, amount, cash_box_id) VALUES ($1, 1, 'CASH', $2, $3) RETURNING id`,
        [col.id, amount, cashBoxId],
      )
    ).rows[0];
    await c.query(
      `INSERT INTO treasury_movements (account_kind, cash_box_id, movement_date, direction, amount, description, origin_type, collection_line_id)
       VALUES ('CASH', $1, DATE '2026-10-02', 'IN', $2, 'Cobranza', 'COLLECTION_LINE', $3)`,
      [cashBoxId, amount, line.id],
    );
    return { collectionId: Number(col.id), lineId: Number(line.id) };
  });
}
