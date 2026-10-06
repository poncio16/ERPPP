/**
 * Pruebas de propiedades (K.1): para cualquier secuencia aleatoria de comprobantes, NC y ND,
 * cobranzas, pagos, imputaciones, desimputaciones y anulaciones, ningún saldo queda negativo,
 * lo imputado nunca supera el crédito ni el comprobante, y los invariantes de G.14 dan $0.
 * Las operaciones que el sistema rechaza son válidas (un rechazo es una respuesta correcta),
 * pero nunca puede aparecer un error inesperado ni uno que solo frene la base de datos.
 */
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import fc from "fast-check";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIso } from "@/lib/format";
import { allocateDef, reverseAllocationDef } from "@/modules/allocations/action-defs";
import { loadPermissions } from "@/modules/auth/service";
import { annulCollectionDef, registerCollectionDef } from "@/modules/collections/action-defs";
import { evaluateInvariants } from "@/modules/consistency/service";
import { annulDocumentDef, registerIssuedDocumentDef, registerReceivedDocumentDef } from "@/modules/documents/action-defs";
import { annulPaymentDef, registerPaymentDef } from "@/modules/payments/action-defs";
import { executeAction, type ActionDef } from "@/server/action";
import { hashPassword } from "@/server/auth/password";
import type { ServiceContext } from "@/server/context";
import { createDb, type Db } from "@/server/db/drizzle";
import { Scenario } from "../../database/seeds/scenario";
import { createFreshDatabase, dropDatabase } from "../setup/fresh-db";

const DB_NAME = "erp_test_properties";
const today = todayIso();
let pool: Pool;
let db: Db;
let ctx: ServiceContext;
const parties: Record<Side, number[]> = { ISSUED: [], RECEIVED: [] };
let cashBoxId = 0;
const types: Record<string, number> = {};
let docNumber = 0;

type Side = "ISSUED" | "RECEIVED";
const sides = ["ISSUED", "RECEIVED"] as const;

beforeAll(async () => {
  const { appUrl } = await createFreshDatabase(DB_NAME);
  pool = new Pool({ connectionString: appUrl, max: 4 });
  db = createDb(pool);
  const { rows } = await pool.query("INSERT INTO users (username, full_name, password_hash, must_change_password) VALUES ('prop', 'Propiedades', $1, false) RETURNING id", [
    await hashPassword("Clave-de-prueba-123"),
  ]);
  const userId = Number(rows[0].id);
  await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'ADMIN'", [userId]);
  ctx = { userId, username: "prop", permissions: await loadPermissions(db, userId), requestId: randomUUID(), ip: null, userAgent: "vitest" };
  const s = new Scenario(db, ctx, { today, keyPrefix: "prop" });
  for (let i = 0; i < 3; i++) {
    parties.ISSUED.push(await s.client({ name: `Cliente propiedad ${i}`, seed: 7000 + i, vat: "RI", city: "Rosario" }));
    parties.RECEIVED.push(await s.supplier({ name: `Proveedor propiedad ${i}`, seed: 8000 + i, vat: "RI", city: "Rosario" }));
  }
  const box = await s.cashBox("Caja propiedades");
  await s.opening("caja", box, "1000000000", -30);
  cashBoxId = box.id;
  for (const r of (await pool.query<{ id: string; code: string }>("SELECT id, code FROM document_types WHERE code IN ('FA','NCA','NDA')")).rows) types[r.code] = Number(r.id);
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await dropDatabase(DB_NAME);
});

// ---------------------------------------------------------------- operaciones

const amount = fc.integer({ min: 1, max: 30_000_000 }).map((c) => new Decimal(c).div(100).toFixed(2));
const pick = fc.nat({ max: 1000 });
const fraction = fc.constantFrom(0.25, 0.5, 1, 1.5);
const Op = fc.oneof(
  { weight: 4, arbitrary: fc.record({ k: fc.constant("doc" as const), side: fc.constantFrom(...sides), party: fc.nat({ max: 2 }), cls: fc.constantFrom("FA", "FA", "NCA", "NDA"), amount, pick }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant("settle" as const), side: fc.constantFrom(...sides), party: fc.nat({ max: 2 }), amount, picks: fc.array(fc.tuple(pick, fraction), { maxLength: 3 }) }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant("allocate" as const), side: fc.constantFrom(...sides), source: pick, doc: pick, fraction }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("reverse" as const), pick }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("annulOp" as const), side: fc.constantFrom(...sides), pick }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("annulDoc" as const), side: fc.constantFrom(...sides), pick }) },
);
type Op = typeof Op extends fc.Arbitrary<infer T> ? T : never;

const unexpected: string[] = [];
async function act(def: ActionDef<never, unknown> | ActionDef, input: Record<string, unknown>) {
  const r = await executeAction(db, { ctx, mustChangePassword: false }, { requestId: randomUUID() }, def as ActionDef, input);
  if (!r.ok && /inesperado|La base de datos rechazó/.test(r.error)) unexpected.push(`${(def as ActionDef).name}: ${r.error}`);
  return r;
}

const rows = async <T>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];
const choose = <T>(xs: T[], i: number) => (xs.length ? xs[i % xs.length] : undefined);

async function openDebits(side: Side, partyId?: number) {
  const col = side === "ISSUED" ? "client_id" : "supplier_id";
  return rows<{ id: string; balance: string; party: string }>(
    `SELECT d.id, d.balance, d.${col} AS party FROM documents d JOIN document_types t ON t.id = d.document_type_id
      WHERE d.direction = $1 AND d.status IN ('OPEN','PARTIAL') AND t.class IN ('INVOICE','DEBIT_NOTE') ${partyId ? `AND d.${col} = ${partyId}` : ""} ORDER BY d.id`,
    [side],
  );
}

async function apply(op: Op) {
  if (op.k === "doc") {
    const party = parties[op.side][op.party]!;
    const input: Record<string, unknown> = {
      idempotencyKey: randomUUID(),
      documentTypeId: String(types[op.cls]),
      pointOfSale: "8",
      number: String(++docNumber),
      partyId: String(party),
      issueDate: today,
      dueDate: today,
      netUntaxed: op.amount,
      confirmWarnings: "1",
    };
    if (op.side === "RECEIVED") input.vatPeriod = today.slice(0, 7);
    if (op.cls !== "FA") {
      input.reason = "Ajuste aleatorio";
      const target = choose(await openDebits(op.side, party), op.pick);
      if (target) input.relatedDocumentIds = [target.id];
      else if (op.cls === "NCA") input.unlinkedCreditNote = "1";
    }
    await act(op.side === "ISSUED" ? registerIssuedDocumentDef : registerReceivedDocumentDef, input);
  } else if (op.k === "settle") {
    const party = parties[op.side][op.party]!;
    const open = await openDebits(op.side, party);
    let left = new Decimal(op.amount);
    const allocations: { documentId: number; amount: string }[] = [];
    for (const [p, f] of op.picks) {
      const d = choose(open, p);
      if (!d || allocations.some((a) => a.documentId === Number(d.id))) continue;
      const a = Decimal.min(d.balance, left).mul(f).toDecimalPlaces(2, Decimal.ROUND_DOWN);
      if (a.lte(0)) continue;
      allocations.push({ documentId: Number(d.id), amount: a.toFixed(2) });
      left = left.minus(Decimal.min(a, left));
    }
    const base = { idempotencyKey: randomUUID(), date: today, lines: JSON.stringify([{ method: "CASH", amount: op.amount, cashBoxId }]), allocations: JSON.stringify(allocations), confirmWarnings: "1" };
    await act(op.side === "ISSUED" ? registerCollectionDef : registerPaymentDef, op.side === "ISSUED" ? { ...base, clientId: String(party) } : { ...base, supplierId: String(party) });
  } else if (op.k === "allocate") {
    const table = op.side === "ISSUED" ? "collections" : "supplier_payments";
    const partyCol = op.side === "ISSUED" ? "client_id" : "supplier_id";
    const sources = [
      ...(await rows<{ kind: string; id: string; party: string; avail: string }>(`SELECT 'OP' AS kind, id, ${partyCol} AS party, unapplied_amount AS avail FROM ${table} WHERE status = 'ACTIVE' AND unapplied_amount > 0 ORDER BY id`)),
      ...(await rows<{ kind: string; id: string; party: string; avail: string }>(
        `SELECT 'DOC' AS kind, d.id, d.${partyCol} AS party, d.balance AS avail FROM documents d JOIN document_types t ON t.id = d.document_type_id
          WHERE d.direction = $1 AND t.class = 'CREDIT_NOTE' AND d.balance > 0 ORDER BY d.id`,
        [op.side],
      )),
    ];
    const src = choose(sources, op.source);
    if (!src) return;
    const target = choose(await openDebits(op.side, Number(src.party)), op.doc);
    if (!target) return;
    const a = Decimal.min(src.avail, target.balance).mul(op.fraction).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    if (a.lte(0)) return;
    await act(allocateDef, {
      sourceKind: src.kind === "DOC" ? "CREDIT_DOCUMENT" : op.side === "ISSUED" ? "COLLECTION" : "PAYMENT",
      sourceId: src.id,
      allocations: JSON.stringify([{ documentId: Number(target.id), amount: a.toFixed(2) }]),
    });
  } else if (op.k === "reverse") {
    const a = choose(await rows<{ id: string }>("SELECT id FROM allocations WHERE status = 'ACTIVE' ORDER BY id"), op.pick);
    if (a) await act(reverseAllocationDef, { id: a.id, reason: "Desimputación aleatoria" });
  } else if (op.k === "annulOp") {
    const table = op.side === "ISSUED" ? "collections" : "supplier_payments";
    const o = choose(await rows<{ id: string }>(`SELECT id FROM ${table} WHERE status = 'ACTIVE' ORDER BY id`), op.pick);
    if (o) await act(op.side === "ISSUED" ? annulCollectionDef : annulPaymentDef, { id: o.id, reason: "Anulación aleatoria" });
  } else {
    const d = choose(await rows<{ id: string; version: number }>("SELECT id, version FROM documents WHERE direction = $1 AND status <> 'ANNULLED' ORDER BY id", [op.side]), op.pick);
    if (d) await act(annulDocumentDef, { id: d.id, version: String(d.version), reason: "Anulación aleatoria" });
  }
}

async function assertProperties() {
  expect(unexpected).toEqual([]);
  expect(await rows("SELECT id, balance FROM documents WHERE balance < 0 OR balance > total")).toEqual([]);
  // Lo imputado nunca supera el crédito de origen ni el comprobante imputado.
  expect(
    await rows(`
      SELECT 'cobranza' AS what, c.id FROM collections c WHERE c.total_amount < coalesce((SELECT sum(amount) FROM allocations a WHERE a.source_collection_id = c.id AND a.status = 'ACTIVE'), 0)
      UNION ALL SELECT 'pago', p.id FROM supplier_payments p WHERE p.total_amount < coalesce((SELECT sum(amount) FROM allocations a WHERE a.source_payment_id = p.id AND a.status = 'ACTIVE'), 0)
      UNION ALL SELECT 'nota de crédito', d.id FROM documents d WHERE d.total < coalesce((SELECT sum(amount) FROM allocations a WHERE a.source_document_id = d.id AND a.status = 'ACTIVE'), 0)
      UNION ALL SELECT 'comprobante', d.id FROM documents d WHERE d.total < coalesce((SELECT sum(amount) FROM allocations a WHERE a.target_document_id = d.id AND a.status = 'ACTIVE'), 0)`),
  ).toEqual([]);
  expect((await evaluateInvariants(db, ctx)).filter((r) => !r.ok)).toEqual([]);
}

describe("PROP Propiedades con secuencias aleatorias (K.1)", () => {
  it("PROP-01 ninguna secuencia deja saldos negativos, sobreimputaciones ni invariantes de G.14 distintos de $0", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(Op, { minLength: 5, maxLength: 40 }), async (ops) => {
        for (const op of ops) await apply(op);
        await assertProperties();
      }),
      { numRuns: 20, seed: Number(process.env.PROP_SEED ?? 20261006), endOnFailure: true },
    );
    // Las secuencias ejercitaron de verdad cada tipo de operación (y no solo rechazos).
    const done = await rows<{ op: string }>("SELECT DISTINCT module || '.' || action AS op FROM audit_log WHERE result = 'SUCCESS'");
    const ops = done.map((r) => r.op);
    for (const op of ["documents.create", "documents.annul", "collections.create", "collections.annul", "payments.create", "payments.annul", "allocations.create", "allocations.reverse"]) {
      expect(ops, op).toContain(op);
    }
  }, 300_000);
});
