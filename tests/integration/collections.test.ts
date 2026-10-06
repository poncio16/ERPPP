/**
 * Imputaciones y cobranzas (criterios §46 "Imputaciones" y "Cuentas corrientes", §23, §27, §28,
 * prueba integral §47 "Cliente", G.5, G.7, G.13 e invariantes G.14-1 a G.14-4).
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { allocateDef, reverseAllocationDef } from "@/modules/allocations/action-defs";
import { proposeFifo } from "@/modules/allocations/plan";
import { availableCredits, openDebits } from "@/modules/allocations/service";
import { balanceComposition } from "@/modules/accounts/service";
import { annulCollectionDef, registerCollectionDef } from "@/modules/collections/action-defs";
import { receiptData } from "@/modules/collections/service";
import { appPool, makeBankAccount, makeCashBox, makeClient, ownerPool as dbOwnerPool, q, q1, tax } from "../db/helpers";
import { lastAudit, ownerPool, pool, db } from "./helpers";
import {
  addDays,
  administration,
  cashLine,
  checkLine,
  clientBalance,
  collect,
  collectionState,
  docState,
  documentFor,
  fail,
  messages,
  ok,
  reader,
  run,
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

type Registered = { id: number; receiptId: number; existing: boolean };

/** G.14-1 para un cliente: saldo de cuenta corriente = deuda abierta − créditos sin aplicar. */
async function expectAccountConsistent(clientId: number) {
  const comp = await balanceComposition(db, await reader(), "ISSUED", clientId);
  expect(comp.net).toBe(await clientBalance(clientId));
}

describe("Imputaciones", () => {
  it("IMP-01 comprobantes 100.000 y 50.000, cobranza 120.000: 100.000 + 20.000 y disponible 0 (§46)", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    const c1 = await documentFor("ISSUED", client, "100.000,00");
    const c2 = await documentFor("ISSUED", client, "50.000,00");
    const r = ok<Registered>(
      await collect(client, [cashLine(box, "120.000,00")], [
        { documentId: c1, amount: "100000" },
        { documentId: c2, amount: "20000" },
      ]),
    );
    expect(await docState(c1)).toEqual({ balance: "0.00", status: "SETTLED" });
    expect(await docState(c2)).toEqual({ balance: "30000.00", status: "PARTIAL" });
    expect(await collectionState(r.id)).toEqual({ unapplied_amount: "0.00", status: "ACTIVE" });
    expect(await clientBalance(client)).toBe("30000.00");
    await expectAccountConsistent(client);
  });

  it("IMP-02 rechaza imputar más que el pago y más que el saldo del comprobante, sin registrar nada", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    const c1 = await documentFor("ISSUED", client, "100.000,00");
    const c2 = await documentFor("ISSUED", client, "50.000,00");
    const before = await q1<{ n: string }>("SELECT count(*) AS n FROM collections WHERE client_id = $1", [client]);

    // Σ imputaciones (150.000) > cobranza (120.000).
    const overPayment = await collect(client, [cashLine(box, "120.000,00")], [
      { documentId: c1, amount: "100000" },
      { documentId: c2, amount: "50000" },
    ]);
    expect(messages(overPayment)).toMatch(/supera el importe de la cobranza/);
    // 100.000,01 > saldo del comprobante.
    const overBalance = await collect(client, [cashLine(box, "200.000,00")], [{ documentId: c1, amount: "100000.01" }]);
    expect(messages(overBalance)).toMatch(/supera su saldo pendiente/);

    expect((await q1<{ n: string }>("SELECT count(*) AS n FROM collections WHERE client_id = $1", [client])).n).toBe(before.n);
    expect(await treasuryBalance("CASH", box)).toBe("0.00");
    expect(await docState(c1)).toEqual({ balance: "100000.00", status: "OPEN" });
  });

  it("IMP-03 ejemplo de la especificación: 500.000 y 300.000 con 700.000; $1 más se rechaza (§27, G.7)", async () => {
    const client = await makeClient();
    const c1 = await documentFor("ISSUED", client, "500.000,00", { due: addDays(today, 5) });
    const c2 = await documentFor("ISSUED", client, "300.000,00", { due: addDays(today, 15) });
    const r = ok<Registered>(await collect(client, [transferLine(await makeBankAccount(), "700.000,00")]));
    // Propuesta automática FIFO por vencimiento.
    const plan = proposeFifo(await openDebits(db, "ISSUED", client), "700000");
    expect(plan).toEqual([
      { documentId: c1, amount: "500000.00" },
      { documentId: c2, amount: "200000.00" },
    ]);
    ok(await run(await administration(), allocateDef, { sourceKind: "COLLECTION", sourceId: String(r.id), allocations: JSON.stringify(plan) }));
    expect(await docState(c1)).toEqual({ balance: "0.00", status: "SETTLED" });
    expect(await docState(c2)).toEqual({ balance: "100000.00", status: "PARTIAL" });
    expect(await collectionState(r.id)).toMatchObject({ unapplied_amount: "0.00" });

    const extra = await run(await administration(), allocateDef, {
      sourceKind: "COLLECTION",
      sourceId: String(r.id),
      allocations: JSON.stringify([{ documentId: c2, amount: "1" }]),
    });
    expect(messages(extra)).toMatch(/supera el crédito disponible/);
    await expectAccountConsistent(client);
  });

  it("IMP-04 desimputar restituye saldos y estados sin tocar la cuenta corriente ni la caja", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    const inv = await documentFor("ISSUED", client, "80.000,00");
    const r = ok<Registered>(await collect(client, [cashLine(box, "80.000,00")], [{ documentId: inv, amount: "80000" }]));
    const [alloc] = await q<{ id: string }>("SELECT id FROM allocations WHERE source_collection_id = $1", [r.id]);
    const balanceBefore = await clientBalance(client);

    // Tesorería no tiene permiso para desimputar (D17).
    expect(fail(await run(await treasury(), reverseAllocationDef, { id: alloc!.id, reason: "Imputación equivocada" })).error).toMatch(/permiso/);
    ok(await run(await administration(), reverseAllocationDef, { id: alloc!.id, reason: "Imputación equivocada" }));
    expect(await docState(inv)).toEqual({ balance: "80000.00", status: "OPEN" });
    expect(await collectionState(r.id)).toMatchObject({ unapplied_amount: "80000.00" });
    expect(await clientBalance(client)).toBe(balanceBefore);
    expect(await treasuryBalance("CASH", box)).toBe("80000.00");
    expect(await q1("SELECT status, reversal_reason FROM allocations WHERE id = $1", [alloc!.id])).toEqual({ status: "REVERSED", reversal_reason: "Imputación equivocada" });
    expect(await lastAudit("action = 'reverse' AND module = 'allocations' AND entity_id = $1", [alloc!.id])).toMatchObject({ result: "SUCCESS" });
    // Una imputación desimputada no se vuelve a desimputar.
    expect(messages(await run(await administration(), reverseAllocationDef, { id: alloc!.id, reason: "Otra vez" }))).toMatch(/ya fue desimputada/);
    await expectAccountConsistent(client);
  });

  it("IMP-05 una NC se imputa contra la factura y reduce su saldo (§19, G.3-4)", async () => {
    const client = await makeClient();
    const inv = await documentFor("ISSUED", client, "121.000,00");
    const nc = await documentFor("ISSUED", client, "21.000,00", { type: "NCA", related: [inv] });
    const credits = await availableCredits(db, "ISSUED", client);
    expect(credits).toEqual([expect.objectContaining({ kind: "CREDIT_DOCUMENT", id: nc, available: "21000.00" })]);
    ok(await run(await administration(), allocateDef, { sourceKind: "CREDIT_DOCUMENT", sourceId: String(nc), allocations: JSON.stringify([{ documentId: inv, amount: "21000" }]) }));
    expect(await docState(inv)).toEqual({ balance: "100000.00", status: "PARTIAL" });
    expect(await docState(nc)).toEqual({ balance: "0.00", status: "SETTLED" });
    expect(await clientBalance(client)).toBe("100000.00");
    await expectAccountConsistent(client);
  });

  it("IMP-06 no se imputa contra comprobantes de otro cliente ni contra una NC", async () => {
    const client = await makeClient();
    const other = await makeClient();
    const theirs = await documentFor("ISSUED", other, "10.000,00");
    const inv = await documentFor("ISSUED", client, "10.000,00");
    const nc = await documentFor("ISSUED", client, "1.000,00", { type: "NCA", related: [inv] });
    const r = ok<Registered>(await collect(client, [cashLine(await makeCashBox(), "5.000,00")]));
    const ctx = await administration();
    expect(messages(await run(ctx, allocateDef, { sourceKind: "COLLECTION", sourceId: String(r.id), allocations: JSON.stringify([{ documentId: theirs, amount: "100" }]) }))).toMatch(
      /no pertenece al mismo cliente/,
    );
    expect(messages(await run(ctx, allocateDef, { sourceKind: "COLLECTION", sourceId: String(r.id), allocations: JSON.stringify([{ documentId: nc, amount: "100" }]) }))).toMatch(
      /no es un comprobante deudor/,
    );
    expect(await collectionState(r.id)).toMatchObject({ unapplied_amount: "5000.00" });
  });

  it("IMP-07 dos imputaciones simultáneas al mismo comprobante: la segunda ve el saldo reducido y se rechaza", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    const inv = await documentFor("ISSUED", client, "10.000,00");
    const a = ok<Registered>(await collect(client, [cashLine(box, "10.000,00")]));
    const b = ok<Registered>(await collect(client, [cashLine(box, "10.000,00")]));
    const ctx = await administration();
    const results = await Promise.all(
      [a, b].map((r) => run(ctx, allocateDef, { sourceKind: "COLLECTION", sourceId: String(r.id), allocations: JSON.stringify([{ documentId: inv, amount: "10000" }]) })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(messages(results.find((r) => !r.ok)!)).toMatch(/supera su saldo pendiente/);
    expect(await docState(inv)).toEqual({ balance: "0.00", status: "SETTLED" });
    const applied = await q1<{ s: string }>("SELECT sum(amount)::text AS s FROM allocations WHERE target_document_id = $1 AND status = 'ACTIVE'", [inv]);
    expect(applied.s).toBe("10000.00");
  });
});

describe("Cobranzas", () => {
  it("COB-01 cobranza en efectivo: ingreso en caja, crédito en la cuenta corriente y recibo numerado (§23, §28, §31)", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    const inv = await documentFor("ISSUED", client, "1.200.000,50");
    const r = ok<Registered>(await collect(client, [cashLine(box, "1.200.000,50")], [{ documentId: inv, amount: "1200000.50" }], { notes: "Pago total" }));
    expect(await treasuryBalance("CASH", box)).toBe("1200000.50");
    expect(await clientBalance(client)).toBe("0.00");
    const receipt = await receiptData(db, await reader(), r.id);
    expect(receipt).toMatchObject({
      kind: "RECEIPT",
      amount: "1200000.50",
      amountInWords: "Son pesos un millón doscientos mil con 50/100",
      unapplied: "0.00",
      notes: "Pago total",
      status: "ACTIVE",
    });
    expect(receipt!.number).toMatch(/^R-\d{8}$/);
    expect(receipt!.allocations).toEqual([{ label: expect.stringContaining("Factura A"), amount: "1200000.50" }]);
    expect(receipt!.lines).toEqual([expect.objectContaining({ method: "CASH", amount: "1200000.50" })]);
    const audit = await lastAudit("module = 'collections' AND action = 'create' AND entity_id = $1", [String(r.id)]);
    expect(audit).toMatchObject({ result: "SUCCESS" });
    expect((audit!.after as { receipt: string }).receipt).toBe(receipt!.number);
  });

  it("COB-02 transferencia: impacta en la cuenta bancaria; una posible doble carga pide confirmación (§23, G.5-3)", async () => {
    const client = await makeClient();
    const account = await makeBankAccount();
    ok(await collect(client, [transferLine(account, "100.000,00", "TRF-77")]));
    expect(await treasuryBalance("BANK", account)).toBe("100000.00");
    const again = await collect(client, [transferLine(account, "100.000,00", "TRF-77")]);
    expect(fail(again).fieldErrors?._warnings?.[0]).toMatch(/verifique que no sea la misma transferencia/);
    expect(await treasuryBalance("BANK", account)).toBe("100000.00");
    ok(await collect(client, [transferLine(account, "100.000,00", "TRF-77")], [], { confirmWarnings: "1" }));
    expect(await treasuryBalance("BANK", account)).toBe("200000.00");
  });

  it("COB-03 cobranza mixta (efectivo + cheque + retención) con saldo a favor (§23, §27)", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    const inv = await documentFor("ISSUED", client, "100.000,00");
    const retention = { method: "RETENTION", amount: "3.000,00", retentionTaxId: String(await tax("RET_IIBB")), certificate: "C-0001", retentionDate: today };
    const r = ok<Registered>(await collect(client, [cashLine(box, "50.000,00"), await checkLine("60.000,00"), retention], [{ documentId: inv, amount: "100000" }]));
    expect(await collectionState(r.id)).toEqual({ unapplied_amount: "13000.00", status: "ACTIVE" });
    expect(await clientBalance(client)).toBe("-13000.00");
    expect(await treasuryBalance("CASH", box)).toBe("50000.00");
    // El cheque queda en cartera y no genera movimiento de tesorería; la retención tampoco.
    const lines = await q<{ method: string; movements: string }>(
      `SELECT l.method, (SELECT count(*) FROM treasury_movements m WHERE m.collection_line_id = l.id) AS movements
         FROM collection_lines l WHERE l.collection_id = $1 ORDER BY l.line_no`,
      [r.id],
    );
    expect(lines).toEqual([
      { method: "CASH", movements: "1" },
      { method: "CHECK", movements: "0" },
      { method: "RETENTION", movements: "0" },
    ]);
    // El saldo a favor es un crédito disponible que se imputa después.
    const credits = await availableCredits(db, "ISSUED", client);
    expect(credits).toEqual([expect.objectContaining({ kind: "COLLECTION", id: r.id, available: "13000.00" })]);
    await expectAccountConsistent(client);
  });

  it("COB-04 doble envío con la misma clave: una sola cobranza, un solo movimiento (§9)", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    const input = { idempotencyKey: randomUUID(), clientId: String(client), date: today, lines: JSON.stringify([cashLine(box, "1.000,00")]), allocations: "[]" };
    const ctx = await treasury();
    const results = await Promise.all([run(ctx, registerCollectionDef, input), run(ctx, registerCollectionDef, input), run(ctx, registerCollectionDef, input)]);
    const ids = new Set(results.map((r) => ok<Registered>(r).id));
    expect(ids.size).toBe(1);
    expect(await treasuryBalance("CASH", box)).toBe("1000.00");
    expect((await q1<{ n: string }>("SELECT count(*) AS n FROM collections WHERE client_id = $1", [client])).n).toBe("1");
  });

  it("COB-05 cobranzas simultáneas obtienen números de recibo distintos y consecutivos (§28)", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    const results = await Promise.all(Array.from({ length: 20 }, () => collect(client, [cashLine(box, "10,00")])));
    const ids = results.map((r) => ok<Registered>(r).id);
    const numbers = (await q<{ number: string }>("SELECT number FROM receipts WHERE collection_id = ANY($1) ORDER BY number", [ids])).map((r) => Number(r.number.slice(2)));
    expect(new Set(numbers).size).toBe(20);
    expect(numbers.at(-1)! - numbers[0]!).toBe(19);
  });

  it("COB-06 validaciones: fecha futura, cheque duplicado y cliente dado de baja", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    expect(messages(await collect(client, [cashLine(box, "1,00")], [], { date: addDays(today, 1) }))).toMatch(/posterior a hoy/);
    const check = await checkLine("500,00");
    ok(await collect(client, [check]));
    expect(messages(await collect(client, [check]))).toMatch(/ya está registrado/);
    await q("UPDATE clients SET status = 'INACTIVE', deactivated_at = now(), deactivation_reason = 'Prueba' WHERE id = $1", [client]);
    expect(messages(await collect(client, [cashLine(box, "1,00")]))).toMatch(/dado de baja/);
  });

  it("COB-07 anulación: revierte imputaciones, caja, cheques, cuenta corriente y recibo; Tesorería no puede anular", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    const inv = await documentFor("ISSUED", client, "30.000,00");
    const r = ok<Registered>(await collect(client, [cashLine(box, "20.000,00"), await checkLine("10.000,00")], [{ documentId: inv, amount: "30000" }]));
    expect(fail(await run(await treasury(), annulCollectionDef, { id: String(r.id), reason: "Cargada por error" })).error).toMatch(/permiso/);

    ok(await run(await administration(), annulCollectionDef, { id: String(r.id), reason: "Cargada por error" }));
    expect(await collectionState(r.id)).toEqual({ unapplied_amount: "0.00", status: "ANNULLED" });
    expect(await docState(inv)).toEqual({ balance: "30000.00", status: "OPEN" });
    expect(await treasuryBalance("CASH", box)).toBe("0.00");
    expect(await clientBalance(client)).toBe("30000.00");
    expect(await q1("SELECT status FROM receipts WHERE collection_id = $1", [r.id])).toEqual({ status: "ANNULLED" });
    const check = await q1<{ status: string; events: string }>(
      `SELECT rc.status, (SELECT string_agg(to_status, ',' ORDER BY id) FROM check_events e WHERE e.received_check_id = rc.id) AS events
         FROM collection_lines l JOIN received_checks rc ON rc.id = l.received_check_id WHERE l.collection_id = $1`,
      [r.id],
    );
    expect(check).toEqual({ status: "ANNULLED", events: "IN_PORTFOLIO,ANNULLED" });
    // Nada se borró: el movimiento original y su reversión siguen en el libro.
    expect((await q1<{ n: string }>("SELECT count(*) AS n FROM treasury_movements WHERE cash_box_id = $1", [box])).n).toBe("2");
    expect(messages(await run(await administration(), annulCollectionDef, { id: String(r.id), reason: "Otra vez" }))).toMatch(/ya está anulada/);
    await expectAccountConsistent(client);
  });

  it("COB-08 no se anula si un cheque ya salió de cartera ni si la caja está cerrada a esa fecha", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    const withCheck = ok<Registered>(await collect(client, [await checkLine("1.000,00")]));
    await q(
      `UPDATE received_checks SET status = 'DEPOSITED', deposit_bank_account_id = $2, deposited_at = CURRENT_DATE
        WHERE id = (SELECT received_check_id FROM collection_lines WHERE collection_id = $1)`,
      [withCheck.id, await makeBankAccount()],
    );
    expect(messages(await run(await administration(), annulCollectionDef, { id: String(withCheck.id), reason: "Error de carga" }))).toMatch(/ya no está en cartera/);

    const cash = ok<Registered>(await collect(client, [cashLine(box, "1.000,00")]));
    await q("INSERT INTO cash_closures (cash_box_id, closure_date, system_balance, counted_amount, difference) VALUES ($1, $2, 1000, 1000, 0)", [box, today]);
    expect(messages(await run(await administration(), annulCollectionDef, { id: String(cash.id), reason: "Error de carga" }))).toMatch(/está cerrada hasta/);
    expect(await collectionState(cash.id)).toMatchObject({ status: "ACTIVE" });
  });

  it("COB-09 permisos: Consulta no registra cobranzas (validación en backend)", async () => {
    const client = await makeClient();
    const r = await collect(client, [cashLine(await makeCashBox(), "1,00")], [], {}, await reader());
    expect(fail(r).error).toMatch(/permiso/);
    expect(await lastAudit("action = 'collections.create' AND result = 'DENIED'")).toBeDefined();
  });
});

describe("Prueba integral de cliente (§47)", () => {
  it("INT-CLI comprobante 500.000, cobranzas 200.000 y 300.000 imputadas, recibos, caja/banco y auditoría", async () => {
    // 1. Crear cliente. 2. Registrar comprobante por $500.000. 3. Verificar cuenta corriente.
    const client = await makeClient();
    const box = await makeCashBox();
    const account = await makeBankAccount();
    const inv = await documentFor("ISSUED", client, "500.000,00");
    expect(await clientBalance(client)).toBe("500000.00");

    // 4-6. Cobranza de $200.000 en efectivo, imputada: saldo $300.000.
    const first = ok<Registered>(await collect(client, [cashLine(box, "200.000,00")], [{ documentId: inv, amount: "200000" }]));
    expect(await clientBalance(client)).toBe("300000.00");
    expect(await docState(inv)).toEqual({ balance: "300000.00", status: "PARTIAL" });

    // 7-9. Cobranza de $300.000 por transferencia, imputada: saldo $0.
    const second = ok<Registered>(await collect(client, [transferLine(account, "300.000,00")], [{ documentId: inv, amount: "300000" }]));
    expect(await clientBalance(client)).toBe("0.00");
    expect(await docState(inv)).toEqual({ balance: "0.00", status: "SETTLED" });

    // 10. Recibos internos.
    const r1 = await receiptData(db, await reader(), first.id);
    const r2 = await receiptData(db, await reader(), second.id);
    expect(r1).toMatchObject({ amount: "200000.00", amountInWords: "Son pesos doscientos mil con 00/100" });
    expect(r2).toMatchObject({ amount: "300000.00", amountInWords: "Son pesos trescientos mil con 00/100" });
    expect(r1!.number).not.toBe(r2!.number);

    // 11. Caja y banco.
    expect(await treasuryBalance("CASH", box)).toBe("200000.00");
    expect(await treasuryBalance("BANK", account)).toBe("300000.00");

    // 12. Auditoría de cada paso.
    for (const id of [first.id, second.id]) {
      expect(await lastAudit("module = 'collections' AND action = 'create' AND entity_id = $1", [String(id)])).toMatchObject({ result: "SUCCESS" });
    }
    expect(await lastAudit("module = 'documents' AND action = 'create' AND entity_id = $1", [String(inv)])).toMatchObject({ result: "SUCCESS" });
    await expectAccountConsistent(client);
  });
});
