/**
 * Pagos y cheques (criterios §46 "Bancos" y "Cheques", §24–26, §29, prueba integral §47
 * "Proveedor", G.6, G.10, G.11 e invariantes G.14-5 y G.14-6).
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  cashCheckDef,
  creditCheckDef,
  debitIssuedCheckDef,
  depositCheckDef,
  presentIssuedCheckDef,
  rejectIssuedCheckDef,
  rejectReceivedCheckDef,
} from "@/modules/checks/action-defs";
import { availableBankBalance, getReceivedCheck, portfolioTotal } from "@/modules/checks/service";
import { annulPaymentDef } from "@/modules/payments/action-defs";
import { paymentOrderData } from "@/modules/payments/service";
import { appPool, makeBankAccount, makeCashBox, makeClient, makeSupplier, ownerPool as dbOwnerPool, q, q1, tax } from "../db/helpers";
import { db, lastAudit, ownerPool, pool } from "./helpers";
import {
  administration,
  cashLine,
  checkLine,
  clientBalance,
  collect,
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

type Paid = { id: number; orderId: number };
type Collected = { id: number; receiptId: number };

const receivedCheck = async (collectionId: number) =>
  q1<{ id: string; status: string; version: number; amount: string }>(
    `SELECT rc.id, rc.status, rc.version, rc.amount FROM collection_lines l JOIN received_checks rc ON rc.id = l.received_check_id WHERE l.collection_id = $1`,
    [collectionId],
  );
const issuedCheck = async (paymentId: number) =>
  q1<{ id: string; status: string; version: number; amount: string }>(
    `SELECT ic.id, ic.status, ic.version, ic.amount FROM payment_lines l JOIN issued_checks ic ON ic.id = l.issued_check_id WHERE l.payment_id = $1`,
    [paymentId],
  );
const ownCheck = (bankAccountId: number, amount: string, number = String(Date.now() % 100000000)) => ({
  method: "OWN_CHECK",
  amount,
  check: { bankAccountId, format: "ECHEQ", checkType: "DEFERRED", number, issueDate: today, paymentDate: today },
});

describe("Pagos", () => {
  it("PAG-01 pago por transferencia: el banco baja una sola vez; orden de pago numerada (§46 Bancos, §29)", async () => {
    const supplier = await makeSupplier();
    const account = await makeBankAccount();
    await openingBalance(`BANK:${account}`, "100.000,00");
    const inv = await documentFor("RECEIVED", supplier, "100.000,00");
    const p = ok<Paid>(await pay(supplier, [transferLine(account, "100.000,00")], [{ documentId: inv, amount: "100000" }]));
    expect(await treasuryBalance("BANK", account)).toBe("0.00");
    expect(await supplierBalance(supplier)).toBe("0.00");
    expect(await docState(inv)).toEqual({ balance: "0.00", status: "SETTLED" });
    expect((await q1<{ n: string }>("SELECT count(*) AS n FROM treasury_movements m JOIN payment_lines l ON l.id = m.payment_line_id WHERE l.payment_id = $1", [p.id])).n).toBe("1");
    const order = await paymentOrderData(db, await reader(), p.id);
    expect(order).toMatchObject({ kind: "PAYMENT_ORDER", amount: "100000.00", amountInWords: "Son pesos cien mil con 00/100", unapplied: "0.00" });
    expect(order!.number).toMatch(/^OP-\d{8}$/);
  });

  it("PAG-02 efectivo: no puede dejar la caja en negativo; retención practicada cancela deuda sin mover fondos", async () => {
    const supplier = await makeSupplier();
    const box = await makeCashBox();
    await openingBalance(`CASH:${box}`, "10.000,00");
    const inv = await documentFor("RECEIVED", supplier, "12.000,00");
    expect(messages(await pay(supplier, [cashLine(box, "12.000,00")]))).toMatch(/deja la caja .* en negativo/);
    const retention = { method: "RETENTION", amount: "2.000,00", retentionTaxId: String(await tax("RET_GAN")), certificate: "OP-RET-1", retentionDate: today };
    ok<Paid>(await pay(supplier, [cashLine(box, "10.000,00"), retention], [{ documentId: inv, amount: "12000" }]));
    expect(await treasuryBalance("CASH", box)).toBe("0.00");
    expect(await docState(inv)).toEqual({ balance: "0.00", status: "SETTLED" });
  });

  it("PAG-03 pago parcial y anticipo: lo no imputado queda como saldo a favor ante el proveedor", async () => {
    const supplier = await makeSupplier();
    const box = await makeCashBox();
    await openingBalance(`CASH:${box}`, "50.000,00");
    const inv = await documentFor("RECEIVED", supplier, "30.000,00");
    const p = ok<Paid>(await pay(supplier, [cashLine(box, "50.000,00")], [{ documentId: inv, amount: "20000" }]));
    expect(await docState(inv)).toEqual({ balance: "10000.00", status: "PARTIAL" });
    expect(await paymentState(p.id)).toEqual({ unapplied_amount: "30000.00", status: "ACTIVE" });
    expect(await supplierBalance(supplier)).toBe("-20000.00");
  });

  it("PAG-04 anulación: revierte banco e imputaciones, anula el cheque propio y devuelve a cartera el endosado", async () => {
    const supplier = await makeSupplier();
    const client = await makeClient();
    const account = await makeBankAccount();
    await openingBalance(`BANK:${account}`, "100.000,00");
    const inv = await documentFor("RECEIVED", supplier, "60.000,00");
    const col = ok<Collected>(await collect(client, [await checkLine("15.000,00")]));
    const third = await receivedCheck(col.id);
    const p = ok<Paid>(
      await pay(supplier, [transferLine(account, "25.000,00"), ownCheck(account, "20.000,00"), { method: "THIRD_PARTY_CHECK", receivedCheckId: third.id }], [
        { documentId: inv, amount: "60000" },
      ]),
    );
    expect((await receivedCheck(col.id)).status).toBe("ENDORSED");
    expect(await paymentState(p.id)).toEqual({ unapplied_amount: "0.00", status: "ACTIVE" });
    expect(fail(await run(await treasury(), annulPaymentDef, { id: String(p.id), reason: "Pago duplicado" })).error).toMatch(/permiso/);

    ok(await run(await administration(), annulPaymentDef, { id: String(p.id), reason: "Pago duplicado" }));
    expect(await paymentState(p.id)).toEqual({ unapplied_amount: "0.00", status: "ANNULLED" });
    expect(await docState(inv)).toEqual({ balance: "60000.00", status: "OPEN" });
    expect(await treasuryBalance("BANK", account)).toBe("100000.00");
    expect((await issuedCheck(p.id)).status).toBe("ANNULLED");
    expect((await receivedCheck(col.id)).status).toBe("IN_PORTFOLIO");
    expect(await supplierBalance(supplier)).toBe("60000.00");
    expect(await q1("SELECT status FROM payment_orders WHERE payment_id = $1", [p.id])).toEqual({ status: "ANNULLED" });
    // El número del cheque propio anulado no se reutiliza.
    const number = (await q1<{ number: string }>("SELECT number FROM issued_checks WHERE id = $1", [(await issuedCheck(p.id)).id])).number;
    expect(messages(await pay(supplier, [ownCheck(account, "1,00", number)]))).toMatch(/ya se usó en la cuenta/);
  });
});

describe("Cheques recibidos", () => {
  it("CHQ-01 cheque recibido: aumenta la cartera y no el banco (§24, §46)", async () => {
    const client = await makeClient();
    const before = await portfolioTotal(db);
    const col = ok<Collected>(await collect(client, [await checkLine("75.000,00")]));
    const check = await receivedCheck(col.id);
    expect(check.status).toBe("IN_PORTFOLIO");
    expect((await portfolioTotal(db)).minus(before).toFixed(2)).toBe("75000.00");
    expect(await clientBalance(client)).toBe("-75000.00");
    expect((await q1<{ n: string }>("SELECT count(*) AS n FROM treasury_movements m JOIN check_events e ON e.id = m.check_event_id WHERE e.received_check_id = $1", [check.id])).n).toBe("0");
  });

  it("CHQ-02 depósito: disminuye la cartera y cambia el estado; la acreditación sube el banco una sola vez (§24)", async () => {
    const client = await makeClient();
    const account = await makeBankAccount();
    const col = ok<Collected>(await collect(client, [await checkLine("40.000,00")]));
    let check = await receivedCheck(col.id);
    const before = await portfolioTotal(db);
    ok(await run(await treasury(), depositCheckDef, { id: check.id, version: String(check.version), date: today, bankAccountId: String(account) }));
    check = await receivedCheck(col.id);
    expect(check.status).toBe("DEPOSITED");
    expect(before.minus(await portfolioTotal(db)).toFixed(2)).toBe("40000.00");
    expect(await treasuryBalance("BANK", account)).toBe("0.00");

    ok(await run(await treasury(), creditCheckDef, { id: check.id, version: String(check.version), date: today }));
    expect(await treasuryBalance("BANK", account)).toBe("40000.00");
    check = await receivedCheck(col.id);
    // Acreditar dos veces no se puede: no hay doble impacto.
    expect(messages(await run(await treasury(), creditCheckDef, { id: check.id, version: String(check.version), date: today }))).toMatch(/Solo se acreditan cheques depositados/);
    expect(await treasuryBalance("BANK", account)).toBe("40000.00");
    // Versión vieja: otro usuario ya lo modificó.
    expect(messages(await run(await treasury(), creditCheckDef, { id: check.id, version: "1", date: today }))).toMatch(/Otro usuario/);
  });

  it("CHQ-03 rechazo de un cheque acreditado: egreso bancario, débito interno al cliente e historial completo (§24, D6)", async () => {
    const client = await makeClient();
    const account = await makeBankAccount();
    const inv = await documentFor("ISSUED", client, "40.000,00");
    const col = ok<Collected>(await collect(client, [await checkLine("40.000,00")], [{ documentId: inv, amount: "40000" }]));
    let check = await receivedCheck(col.id);
    ok(await run(await treasury(), depositCheckDef, { id: check.id, version: String(check.version), date: today, bankAccountId: String(account) }));
    check = await receivedCheck(col.id);
    ok(await run(await treasury(), creditCheckDef, { id: check.id, version: String(check.version), date: today }));
    expect(await clientBalance(client)).toBe("0.00");
    check = await receivedCheck(col.id);

    const r = ok<{ debitDocumentId: number }>(
      await run(await treasury(), rejectReceivedCheckDef, { id: check.id, version: String(check.version), date: today, reason: "Sin fondos", confirmWarnings: "1" }),
    );
    expect(await treasuryBalance("BANK", account)).toBe("0.00");
    expect(await clientBalance(client)).toBe("40000.00");
    expect(await docState(r.debitDocumentId)).toEqual({ balance: "40000.00", status: "OPEN" });
    // La cobranza original, su imputación y el recibo no se tocan.
    expect(await docState(inv)).toEqual({ balance: "0.00", status: "SETTLED" });
    expect(await q1("SELECT status FROM receipts WHERE collection_id = $1", [col.id])).toEqual({ status: "ACTIVE" });
    const detail = await getReceivedCheck(db, await reader(), Number(check.id));
    expect(detail!.history.map((h) => h.to)).toEqual(["IN_PORTFOLIO", "DEPOSITED", "CREDITED", "REJECTED"]);
    expect(detail!.history.filter((h) => h.movement).map((h) => h.to)).toEqual(["CREDITED", "REJECTED"]);
    expect(await lastAudit("module = 'checks' AND action = 'reject' AND entity_id = $1", [check.id])).toMatchObject({ result: "SUCCESS" });
    // Un cheque rechazado ya no cambia de estado.
    check = await receivedCheck(col.id);
    expect(messages(await run(await treasury(), rejectReceivedCheckDef, { id: check.id, version: String(check.version), date: today, reason: "Otra vez" }))).toMatch(/no se puede rechazar/);
  });

  it("CHQ-04 rechazo de un cheque depositado (no acreditado): sin movimiento bancario, reconstruye la deuda", async () => {
    const client = await makeClient();
    const account = await makeBankAccount();
    const col = ok<Collected>(await collect(client, [await checkLine("9.000,00")]));
    let check = await receivedCheck(col.id);
    ok(await run(await treasury(), depositCheckDef, { id: check.id, version: String(check.version), date: today, bankAccountId: String(account) }));
    check = await receivedCheck(col.id);
    ok(await run(await treasury(), rejectReceivedCheckDef, { id: check.id, version: String(check.version), date: today, reason: "Firma no coincide" }));
    expect(await treasuryBalance("BANK", account)).toBe("0.00");
    expect(await clientBalance(client)).toBe("0.00");
    expect((await q<{ id: string }>("SELECT id FROM treasury_movements WHERE bank_account_id = $1", [account])).length).toBe(0);
  });

  it("CHQ-05 cobro por ventanilla: el cheque en cartera ingresa a caja", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    const col = ok<Collected>(await collect(client, [await checkLine("3.000,00")]));
    const check = await receivedCheck(col.id);
    ok(await run(await treasury(), cashCheckDef, { id: check.id, version: String(check.version), date: today, account: `CASH:${box}` }));
    expect(await treasuryBalance("CASH", box)).toBe("3000.00");
    expect((await receivedCheck(col.id)).status).toBe("CREDITED");
  });

  it("CHQ-06 rechazo de un cheque endosado: deuda del cliente y deuda con el proveedor (G.10, D7)", async () => {
    const client = await makeClient();
    const supplier = await makeSupplier();
    const inv = await documentFor("RECEIVED", supplier, "5.000,00");
    const col = ok<Collected>(await collect(client, [await checkLine("5.000,00")]));
    const check = await receivedCheck(col.id);
    ok<Paid>(await pay(supplier, [{ method: "THIRD_PARTY_CHECK", receivedCheckId: check.id }], [{ documentId: inv, amount: "5000" }]));
    expect(await supplierBalance(supplier)).toBe("0.00");
    const endorsed = await receivedCheck(col.id);
    expect(endorsed.status).toBe("ENDORSED");
    // Un cheque endosado no se puede depositar.
    expect(messages(await run(await treasury(), depositCheckDef, { id: endorsed.id, version: String(endorsed.version), date: today, bankAccountId: String(await makeBankAccount()) }))).toMatch(
      /Solo se depositan cheques en cartera/,
    );
    const r = ok<{ debitDocumentId: number; supplierDebitDocumentId: number }>(
      await run(await treasury(), rejectReceivedCheckDef, { id: endorsed.id, version: String(endorsed.version), date: today, reason: "Rechazado al proveedor" }),
    );
    expect(await clientBalance(client)).toBe("0.00");
    expect(await supplierBalance(supplier)).toBe("5000.00");
    expect(r.supplierDebitDocumentId).toBeGreaterThan(0);
  });
});

describe("Cheques propios", () => {
  it("CHQ-07 emitido ≠ debitado: reduce el disponible, no el contable; el débito mueve el banco una sola vez (§26)", async () => {
    const supplier = await makeSupplier();
    const account = await makeBankAccount();
    await openingBalance(`BANK:${account}`, "100.000,00");
    const p = ok<Paid>(await pay(supplier, [ownCheck(account, "30.000,00")]));
    let check = await issuedCheck(p.id);
    expect(check.status).toBe("DELIVERED");
    expect(await treasuryBalance("BANK", account)).toBe("100000.00");
    expect((await availableBankBalance(db, account)).toFixed(2)).toBe("70000.00");

    ok(await run(await treasury(), presentIssuedCheckDef, { id: check.id, version: String(check.version), date: today }));
    check = await issuedCheck(p.id);
    expect(check.status).toBe("PRESENTED");
    expect(await treasuryBalance("BANK", account)).toBe("100000.00");

    ok(await run(await treasury(), debitIssuedCheckDef, { id: check.id, version: String(check.version), date: today }));
    check = await issuedCheck(p.id);
    expect(check.status).toBe("DEBITED");
    expect(await treasuryBalance("BANK", account)).toBe("70000.00");
    expect((await availableBankBalance(db, account)).toFixed(2)).toBe("70000.00");
    expect(messages(await run(await treasury(), debitIssuedCheckDef, { id: check.id, version: String(check.version), date: today }))).toMatch(/Solo se debitan/);
    expect(await treasuryBalance("BANK", account)).toBe("70000.00");
    // Un pago con un cheque debitado no se anula.
    expect(messages(await run(await administration(), annulPaymentDef, { id: String(p.id), reason: "Error" }))).toMatch(/ya no está solo entregado/);
  });

  it("CHQ-08 rechazo de un cheque propio: libera el disponible y reconstruye la deuda con el proveedor", async () => {
    const supplier = await makeSupplier();
    const account = await makeBankAccount();
    await openingBalance(`BANK:${account}`, "10.000,00");
    const inv = await documentFor("RECEIVED", supplier, "8.000,00");
    const p = ok<Paid>(await pay(supplier, [ownCheck(account, "8.000,00")], [{ documentId: inv, amount: "8000" }]));
    expect(await supplierBalance(supplier)).toBe("0.00");
    const check = await issuedCheck(p.id);
    ok(await run(await treasury(), rejectIssuedCheckDef, { id: check.id, version: String(check.version), date: today, reason: "Sin fondos" }));
    expect(await supplierBalance(supplier)).toBe("8000.00");
    expect((await availableBankBalance(db, account)).toFixed(2)).toBe("10000.00");
    expect(await treasuryBalance("BANK", account)).toBe("10000.00");
  });

  it("CHQ-09 un cheque propio que deja el disponible negativo pide confirmación", async () => {
    const supplier = await makeSupplier();
    const account = await makeBankAccount();
    const r = await pay(supplier, [ownCheck(account, "1.000,00")]);
    expect(fail(r).fieldErrors?._warnings?.[0]).toMatch(/saldo disponible/);
    ok(await pay(supplier, [ownCheck(account, "1.000,00")], [], { confirmWarnings: "1" }));
  });

  it("CHQ-10 permisos: Administración no opera cheques; Consulta no registra pagos", async () => {
    const supplier = await makeSupplier();
    const client = await makeClient();
    const col = ok<Collected>(await collect(client, [await checkLine("1.000,00")]));
    const check = await receivedCheck(col.id);
    expect(fail(await run(await administration(), depositCheckDef, { id: check.id, version: String(check.version), date: today, bankAccountId: String(await makeBankAccount()) })).error).toMatch(
      /permiso/,
    );
    expect(fail(await pay(supplier, [cashLine(await makeCashBox(), "1,00")], [], {}, await reader())).error).toMatch(/permiso/);
  });
});

describe("Prueba integral de proveedor (§47)", () => {
  it("INT-PRV comprobante 500.000, pagos 200.000 y 300.000 imputados, órdenes de pago, caja/banco y auditoría", async () => {
    const supplier = await makeSupplier();
    const box = await makeCashBox();
    const account = await makeBankAccount();
    await openingBalance(`CASH:${box}`, "200.000,00");
    await openingBalance(`BANK:${account}`, "300.000,00");
    const inv = await documentFor("RECEIVED", supplier, "500.000,00");
    expect(await supplierBalance(supplier)).toBe("500000.00");

    const first = ok<Paid>(await pay(supplier, [cashLine(box, "200.000,00")], [{ documentId: inv, amount: "200000" }]));
    expect(await supplierBalance(supplier)).toBe("300000.00");
    expect(await docState(inv)).toEqual({ balance: "300000.00", status: "PARTIAL" });

    const second = ok<Paid>(await pay(supplier, [transferLine(account, "300.000,00")], [{ documentId: inv, amount: "300000" }]));
    expect(await supplierBalance(supplier)).toBe("0.00");
    expect(await docState(inv)).toEqual({ balance: "0.00", status: "SETTLED" });

    const o1 = await paymentOrderData(db, await reader(), first.id);
    const o2 = await paymentOrderData(db, await reader(), second.id);
    expect(o1).toMatchObject({ amount: "200000.00", partyLabel: "Proveedor" });
    expect(o2).toMatchObject({ amount: "300000.00" });
    expect(o1!.number).not.toBe(o2!.number);

    expect(await treasuryBalance("CASH", box)).toBe("0.00");
    expect(await treasuryBalance("BANK", account)).toBe("0.00");
    for (const id of [first.id, second.id]) {
      expect(await lastAudit("module = 'payments' AND action = 'create' AND entity_id = $1", [String(id)])).toMatchObject({ result: "SUCCESS" });
    }
  });
});
