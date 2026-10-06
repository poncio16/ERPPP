/**
 * Devoluciones de saldo a favor (D14): consumen el crédito con un débito interno, mueven caja o
 * banco y se anulan revirtiendo todo. DEV-01..07.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { balanceComposition } from "@/modules/accounts/service";
import { reverseAllocationDef } from "@/modules/allocations/action-defs";
import { availableCredits } from "@/modules/allocations/service";
import { annulRefundDef, registerRefundDef } from "@/modules/refunds/action-defs";
import { listRefunds } from "@/modules/refunds/service";
import { appPool, makeBankAccount, makeCashBox, makeClient, makeSupplier, ownerPool as dbOwnerPool, q, q1 } from "../db/helpers";
import { db, lastAudit, ownerPool, pool } from "./helpers";
import {
  administration,
  cashLine,
  clientBalance,
  collect,
  collectionState,
  docState,
  documentFor,
  fail,
  messages,
  ok,
  openingBalance,
  pay,
  paymentState,
  reader,
  run,
  supplierBalance,
  today,
  transferLine,
  treasury,
  treasuryBalance,
} from "./operations-fixtures";

afterAll(async () => {
  await pool.end();
  await ownerPool.end();
  await appPool.end();
  await dbOwnerPool.end();
});

type Refunded = { id: number; documentId: number };

async function refund(source: { kind: "COLLECTION" | "PAYMENT" | "CREDIT_DOCUMENT"; id: number }, amount: string, account: { cashBoxId?: number; bankAccountId?: number }, extra: Record<string, unknown> = {}) {
  return run(await treasury(), registerRefundDef, {
    idempotencyKey: randomUUID(),
    sourceKind: source.kind,
    sourceId: String(source.id),
    date: today,
    amount,
    method: account.cashBoxId ? "CASH" : "TRANSFER",
    cashBoxId: account.cashBoxId ? String(account.cashBoxId) : "",
    bankAccountId: account.bankAccountId ? String(account.bankAccountId) : "",
    reason: "Devolución pedida por el tercero",
    ...extra,
  });
}

const refundMovements = async (refundId: number) =>
  q<{ direction: string; amount: string; origin_type: string }>(
    `SELECT direction, amount::text, origin_type FROM treasury_movements
      WHERE refund_id = $1 OR reversal_of_id IN (SELECT id FROM treasury_movements WHERE refund_id = $1) ORDER BY id`,
    [refundId],
  );

async function expectConsistent(direction: "ISSUED" | "RECEIVED", partyId: number) {
  const comp = await balanceComposition(db, await reader(), direction, partyId);
  expect(comp.net).toBe(direction === "ISSUED" ? await clientBalance(partyId) : await supplierBalance(partyId));
}

describe("Devoluciones de saldo a favor (D14)", () => {
  it("DEV-01 cliente con saldo a favor 1.000: devolución de 400 en efectivo consume el crédito y egresa de la caja", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    await openingBalance(`CASH:${box}`, "5.000,00");
    const c = ok(await collect(client, [cashLine(box, "1.000,00")]));
    expect(await clientBalance(client)).toBe("-1000.00");

    const r = ok<Refunded>(await refund({ kind: "COLLECTION", id: c.id }, "400", { cashBoxId: box }));
    expect(await collectionState(c.id)).toEqual({ unapplied_amount: "600.00", status: "ACTIVE" });
    expect(await clientBalance(client)).toBe("-600.00");
    expect(await treasuryBalance("CASH", box)).toBe("5600.00");
    expect(await docState(r.documentId)).toEqual({ balance: "0.00", status: "SETTLED" });
    const doc = await q1<{ code: string; point_of_sale: number }>(
      "SELECT t.code, d.point_of_sale FROM documents d JOIN document_types t ON t.id = d.document_type_id WHERE d.id = $1",
      [r.documentId],
    );
    expect(doc).toEqual({ code: "INT_DEVOLUCION", point_of_sale: 0 });
    expect(await refundMovements(r.id)).toEqual([{ direction: "OUT", amount: "400.00", origin_type: "REFUND" }]);
    expect(await availableCredits(db, "ISSUED", client)).toEqual([expect.objectContaining({ kind: "COLLECTION", id: c.id, available: "600.00" })]);
    const audit = await lastAudit("module = 'refunds' AND action = 'create' AND entity_id = $1", [r.id]);
    expect(audit).toBeTruthy();
    await expectConsistent("ISSUED", client);
  });

  it("DEV-02 no se devuelve más que el saldo a favor ni con fecha futura; nada queda registrado", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    await openingBalance(`CASH:${box}`, "5.000,00");
    const c = ok(await collect(client, [cashLine(box, "300,00")]));
    const before = await q1<{ n: string }>("SELECT count(*)::text AS n FROM refunds");
    expect(messages(await refund({ kind: "COLLECTION", id: c.id }, "300,01", { cashBoxId: box }))).toMatch(/supera el saldo a favor/);
    expect(messages(await refund({ kind: "COLLECTION", id: c.id }, "100", { cashBoxId: box }, { date: "2999-01-01" }))).toMatch(/posterior a hoy/);
    expect(messages(await refund({ kind: "COLLECTION", id: c.id }, "100", {}, { method: "TRANSFER" }))).toMatch(/cuenta bancaria/);
    expect((await q1<{ n: string }>("SELECT count(*)::text AS n FROM refunds")).n).toBe(before.n);
    expect(await collectionState(c.id)).toEqual({ unapplied_amount: "300.00", status: "ACTIVE" });
  });

  it("DEV-03 la caja no queda en negativo por una devolución", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    const bank = await makeBankAccount();
    const c = ok(await collect(client, [transferLine(bank, "1.000,00")]));
    const r = await refund({ kind: "COLLECTION", id: c.id }, "500", { cashBoxId: box });
    expect(messages(r)).toMatch(/negativo/);
    expect(await treasuryBalance("CASH", box)).toBe("0.00");
  });

  it("DEV-04 anulación: restituye el saldo a favor, revierte la caja y anula el débito interno; Tesorería no anula", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    await openingBalance(`CASH:${box}`, "5.000,00");
    const c = ok(await collect(client, [cashLine(box, "1.000,00")]));
    const r = ok<Refunded>(await refund({ kind: "COLLECTION", id: c.id }, "1.000", { cashBoxId: box }));
    expect(await clientBalance(client)).toBe("0.00");

    expect(fail(await run(await treasury(), annulRefundDef, { id: String(r.id), reason: "Error de carga" }))).toBeTruthy();
    // La imputación de la devolución no se deshace por separado.
    const [alloc] = await q<{ id: number }>("SELECT id FROM allocations WHERE target_document_id = $1", [r.documentId]);
    expect(messages(await run(await administration(), reverseAllocationDef, { id: String(alloc!.id), reason: "Probar desimputar" }))).toMatch(/anule la devolución/);

    ok(await run(await administration(), annulRefundDef, { id: String(r.id), reason: "Error de carga" }));
    expect(await collectionState(c.id)).toEqual({ unapplied_amount: "1000.00", status: "ACTIVE" });
    expect(await clientBalance(client)).toBe("-1000.00");
    expect(await treasuryBalance("CASH", box)).toBe("6000.00");
    expect(await docState(r.documentId)).toEqual({ balance: "0.00", status: "ANNULLED" });
    expect(await refundMovements(r.id)).toEqual([
      { direction: "OUT", amount: "1000.00", origin_type: "REFUND" },
      { direction: "IN", amount: "1000.00", origin_type: "REVERSAL" },
    ]);
    expect(fail(await run(await administration(), annulRefundDef, { id: String(r.id), reason: "Otra vez" }))).toBeTruthy();
    await expectConsistent("ISSUED", client);
  });

  it("DEV-05 proveedor reintegra un anticipo por transferencia: ingresa al banco y consume el anticipo", async () => {
    const supplier = await makeSupplier();
    const bank = await makeBankAccount();
    await openingBalance(`BANK:${bank}`, "10.000,00");
    const p = ok(await pay(supplier, [transferLine(bank, "2.000,00")]));
    expect(await supplierBalance(supplier)).toBe("-2000.00");
    const r = ok<Refunded>(await refund({ kind: "PAYMENT", id: p.id }, "2.000", { bankAccountId: bank }, { reference: "TRF-99" }));
    expect(await paymentState(p.id)).toEqual({ unapplied_amount: "0.00", status: "ACTIVE" });
    expect(await supplierBalance(supplier)).toBe("0.00");
    expect(await treasuryBalance("BANK", bank)).toBe("10000.00");
    expect(await refundMovements(r.id)).toEqual([{ direction: "IN", amount: "2000.00", origin_type: "REFUND" }]);
    const list = await listRefunds(db, await reader(), { ledger: "AP" });
    expect(list.rows).toContainEqual(expect.objectContaining({ id: r.id, ledger: "AP", amount: "2000.00", method: "TRANSFER", reference: "TRF-99", status: "ACTIVE" }));
    expect(list.rows.find((x) => x.id === r.id)?.sourceLabel).toMatch(/^Pago /);
    await expectConsistent("RECEIVED", supplier);
  });

  it("DEV-06 una nota de crédito con saldo se puede devolver en dinero", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    await openingBalance(`CASH:${box}`, "5.000,00");
    const inv = await documentFor("ISSUED", client, "800,00");
    const nc = await documentFor("ISSUED", client, "800,00", { type: "NCA", related: [inv] });
    expect(await clientBalance(client)).toBe("0.00");
    ok<Refunded>(await refund({ kind: "CREDIT_DOCUMENT", id: nc }, "800", { cashBoxId: box }));
    expect(await docState(nc)).toEqual({ balance: "0.00", status: "SETTLED" });
    // La factura sigue pendiente: el crédito se devolvió en dinero en lugar de aplicarse.
    expect(await clientBalance(client)).toBe("800.00");
    expect(await docState(inv)).toEqual({ balance: "800.00", status: "OPEN" });
    await expectConsistent("ISSUED", client);
  });

  it("DEV-07 doble envío con la misma clave registra una sola devolución; Consulta no registra", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    await openingBalance(`CASH:${box}`, "5.000,00");
    const c = ok(await collect(client, [cashLine(box, "1.000,00")]));
    const key = randomUUID();
    const [a, b] = await Promise.all([
      refund({ kind: "COLLECTION", id: c.id }, "100", { cashBoxId: box }, { idempotencyKey: key }),
      refund({ kind: "COLLECTION", id: c.id }, "100", { cashBoxId: box }, { idempotencyKey: key }),
    ]);
    expect(ok<Refunded>(a).id).toBe(ok<Refunded>(b).id);
    expect(await collectionState(c.id)).toEqual({ unapplied_amount: "900.00", status: "ACTIVE" });
    expect(fail(await run(await reader(), registerRefundDef, { idempotencyKey: randomUUID(), sourceKind: "COLLECTION", sourceId: String(c.id), date: today, amount: "1", method: "CASH", cashBoxId: String(box), reason: "Prueba" }))).toBeTruthy();
  });
});
