/**
 * Caja y bancos (criterios §46 "Caja" y "Bancos", §31–32, G.8, G.9, G.12 e invariante G.14-7).
 * Las operaciones pasan por executeAction, como desde la interfaz.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { todayIso } from "@/lib/format";
import {
  annulTransferDef,
  bankMovementDef,
  cashMovementDef,
  closeCashBoxDef,
  createBankAccountDef,
  createCashBoxDef,
  registerOpeningDef,
  reverseCashMovementDef,
  transferDef,
  updateCashBoxDef,
} from "@/modules/treasury/action-defs";
import { accountBalance, accountLedger, getTreasuryAccount } from "@/modules/treasury/service";
import { executeAction, type ActionDef } from "@/server/action";
import type { ServiceContext } from "@/server/context";
import { appPool, bank, concept, expectDbError, makeBankAccount, makeCashBox, nextSeq, ownerPool as dbOwnerPool, q, q1 } from "../db/helpers";
import { ctxWithRoles, db, lastAudit, meta, ownerPool, pool } from "./helpers";

afterAll(async () => {
  await pool.end();
  await ownerPool.end();
  await appPool.end();
  await dbOwnerPool.end();
});

const run = (ctx: ServiceContext, def: ActionDef<never, unknown> | ActionDef, input: Record<string, unknown>) =>
  executeAction(db, { ctx, mustChangePassword: false }, meta(), def as ActionDef, input);

const ok = <T = { id: number }>(r: { ok: boolean }) => {
  if (!r.ok) throw new Error(`Se esperaba éxito: ${JSON.stringify(r)}`);
  return (r as { ok: true; data: T }).data;
};

const today = todayIso();
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

let tes: ServiceContext;
const treasurer = async () => (tes ??= (await ctxWithRoles(["TESORERIA"])).ctx);
let adm: ServiceContext;
const admin = async () => (adm ??= (await ctxWithRoles(["ADMIN"])).ctx);

const cash = (id: number) => ({ kind: "CASH" as const, id });
const bankRef = (id: number) => ({ kind: "BANK" as const, id });

async function opening(account: string, amount: string, date = addDays(today, -10), extra: Record<string, unknown> = {}) {
  return run(await admin(), registerOpeningDef, { idempotencyKey: randomUUID(), account, date, amount, ...extra });
}

async function movement(kind: "CASH" | "BANK", id: number, direction: "IN" | "OUT", amount: string, extra: Record<string, unknown> = {}) {
  const code = direction === "IN" ? "APORTE" : kind === "CASH" ? "GASTOS_MENORES" : "GASTOS_BANCARIOS";
  return run(await treasurer(), kind === "CASH" ? cashMovementDef : bankMovementDef, {
    idempotencyKey: randomUUID(),
    account: `${kind}:${id}`,
    date: addDays(today, -1),
    direction,
    conceptId: String(await concept(code)),
    amount,
    description: direction === "IN" ? "Aporte de socios" : "Gasto",
    ...extra,
  });
}

const balance = async (ref: { kind: "CASH" | "BANK"; id: number }) => (await accountBalance(db, ref)).toFixed(2);

describe("Caja", () => {
  it("CAJ-01 saldo inicial 500.000 + ingreso 100.000 = 600.000; egreso 150.000 = 450.000 (§46)", async () => {
    const box = await makeCashBox();
    ok(await opening(`CASH:${box}`, "500.000,00"));
    expect(await balance(cash(box))).toBe("500000.00");
    ok(await movement("CASH", box, "IN", "100.000,00"));
    expect(await balance(cash(box))).toBe("600000.00");
    const out = ok(await movement("CASH", box, "OUT", "150.000,00"));
    expect(await balance(cash(box))).toBe("450000.00");
    expect(await lastAudit("action = 'manual_movement' AND entity_id = $1", [String(out.id)])).toMatchObject({ result: "SUCCESS" });
    // El saldo no se guarda en ningún lado: surge de los movimientos (vista treasury_balances).
    expect((await q1<{ balance: string }>("SELECT balance FROM treasury_balances WHERE account_kind = 'CASH' AND account_id = $1", [box])).balance).toBe("450000.00");
  });

  it("CAJ-02 un egreso no puede dejar la caja en negativo y no se registra nada", async () => {
    const box = await makeCashBox();
    ok(await opening(`CASH:${box}`, "1000"));
    const r = await movement("CASH", box, "OUT", "1000,01");
    expect(r).toMatchObject({ ok: false, fieldErrors: { amount: [expect.stringMatching(/negativo/)] } });
    expect(await balance(cash(box))).toBe("1000.00");
    expect(await q("SELECT id FROM treasury_movements WHERE cash_box_id = $1", [box])).toHaveLength(1);
  });

  it("CAJ-03 doble envío con la misma clave: un solo movimiento (idempotencia)", async () => {
    const box = await makeCashBox();
    const key = randomUUID();
    const [a, b] = await Promise.all([movement("CASH", box, "IN", "500", { idempotencyKey: key }), movement("CASH", box, "IN", "500", { idempotencyKey: key })]);
    expect(ok(a).id).toBe(ok(b).id);
    expect(await balance(cash(box))).toBe("500.00");
  });

  it("CAJ-04 un único saldo inicial por caja, con fecha anterior a sus movimientos y nunca negativo", async () => {
    const box = await makeCashBox();
    ok(await movement("CASH", box, "IN", "10"));
    expect(await opening(`CASH:${box}`, "100", today)).toMatchObject({ ok: false, fieldErrors: { date: [expect.stringMatching(/ya tiene movimientos/)] } });
    ok(await opening(`CASH:${box}`, "100"));
    expect(await opening(`CASH:${box}`, "50")).toMatchObject({ ok: false, error: expect.stringMatching(/ya tiene saldo inicial/) });
    const other = await makeCashBox();
    expect(await opening(`CASH:${other}`, "100", undefined, { overdraft: "1" })).toMatchObject({ ok: false, fieldErrors: { overdraft: expect.any(Array) } });
  });

  it("CAJ-05 movimientos manuales solo con conceptos habilitados y en su sentido", async () => {
    const box = await makeCashBox();
    const cobranza = await movement("CASH", box, "IN", "10", { conceptId: String(await concept("COBRANZA")) });
    expect(cobranza).toMatchObject({ ok: false, fieldErrors: { conceptId: [expect.stringMatching(/no admite movimientos manuales/)] } });
    const wrongWay = await movement("CASH", box, "IN", "10", { conceptId: String(await concept("RETIRO")) });
    expect(wrongWay).toMatchObject({ ok: false, fieldErrors: { conceptId: [expect.stringMatching(/egreso/)] } });
    const future = await movement("CASH", box, "IN", "10", { date: addDays(today, 1) });
    expect(future).toMatchObject({ ok: false, fieldErrors: { date: expect.any(Array) } });
    // Una caja no se carga desde la acción de bancos ni viceversa.
    const crossed = await run(await treasurer(), bankMovementDef, { idempotencyKey: randomUUID(), account: `CASH:${box}`, date: today, direction: "IN", conceptId: String(await concept("APORTE")), amount: "1", description: "Cruce" });
    expect(crossed).toMatchObject({ ok: false, fieldErrors: { account: expect.any(Array) } });
  });

  it("CAJ-06 un movimiento manual se corrige con una reversión espejo; nada se borra ni se edita", async () => {
    const box = await makeCashBox();
    ok(await opening(`CASH:${box}`, "1000"));
    const m = ok(await movement("CASH", box, "OUT", "300"));
    const rev = ok(await run(await treasurer(), reverseCashMovementDef, { id: String(m.id), reason: "Cargado dos veces" }));
    expect(await balance(cash(box))).toBe("1000.00");
    expect(await q1("SELECT direction, amount, origin_type, reversal_of_id FROM treasury_movements WHERE id = $1", [rev.id])).toEqual({
      direction: "IN",
      amount: "300.00",
      origin_type: "REVERSAL",
      reversal_of_id: String(m.id),
    });
    expect(await run(await treasurer(), reverseCashMovementDef, { id: String(m.id), reason: "Otra vez" })).toMatchObject({ ok: false, error: expect.stringMatching(/ya fue revertido/) });
    const open = await q1<{ id: string }>("SELECT id FROM treasury_movements WHERE cash_box_id = $1 AND origin_type = 'OPENING'", [box]);
    expect(await run(await treasurer(), reverseCashMovementDef, { id: open.id, reason: "No corresponde" })).toMatchObject({ ok: false, error: expect.stringMatching(/Solo se revierten a mano/) });
    await expectDbError(q("UPDATE treasury_movements SET amount = 1 WHERE id = $1", [m.id]), /inmutables/);
    await expectDbError(q("DELETE FROM treasury_movements WHERE id = $1", [m.id]), /permission denied|no se puede eliminar/i);
  });

  it("CAJ-07 arqueo sin diferencia cierra la fecha: no se aceptan movimientos con fecha igual o anterior", async () => {
    const box = await makeCashBox();
    ok(await opening(`CASH:${box}`, "2000"));
    const closeDate = addDays(today, -2);
    const c = ok<{ id: number; difference: string }>(await run(await treasurer(), closeCashBoxDef, { cashBoxId: String(box), closureDate: closeDate, countedAmount: "2.000,00" }));
    expect(c.difference).toBe("0.00");
    expect(await movement("CASH", box, "IN", "10", { date: closeDate })).toMatchObject({ ok: false, fieldErrors: { date: [expect.stringMatching(/cerrada hasta/)] } });
    ok(await movement("CASH", box, "IN", "10", { date: addDays(today, -1) }));
    // La base rechaza igual una escritura directa en una fecha cerrada.
    await expectDbError(
      q(
        `INSERT INTO treasury_movements (account_kind, cash_box_id, movement_date, direction, amount, description, origin_type, concept_id, idempotency_key)
         VALUES ('CASH', $1, $2, 'IN', 5, 'Directo', 'MANUAL', $3, $4)`,
        [box, closeDate, await concept("APORTE"), randomUUID()],
      ),
      /cerrada/,
    );
    // Cierres en orden: no se puede cerrar una fecha anterior al último cierre.
    expect(await run(await treasurer(), closeCashBoxDef, { cashBoxId: String(box), closureDate: addDays(today, -3), countedAmount: "2000" })).toMatchObject({ ok: false, fieldErrors: { closureDate: expect.any(Array) } });
  });

  it("CAJ-08 arqueo con faltante: exige motivo, registra la diferencia y el saldo queda igual a lo contado (G.14-7)", async () => {
    const box = await makeCashBox();
    ok(await opening(`CASH:${box}`, "1500"));
    const input = { cashBoxId: String(box), closureDate: addDays(today, -1), countedAmount: "1.450,00" };
    expect(await run(await treasurer(), closeCashBoxDef, input)).toMatchObject({ ok: false, fieldErrors: { notes: [expect.stringMatching(/motivo/)] } });
    const c = ok<{ id: number; difference: string }>(await run(await treasurer(), closeCashBoxDef, { ...input, notes: "Vuelto mal dado" }));
    expect(c.difference).toBe("-50.00");
    const diff = await q1("SELECT direction, amount, origin_type, cash_closure_id FROM treasury_movements WHERE cash_closure_id = $1", [c.id]);
    expect(diff).toEqual({ direction: "OUT", amount: "50.00", origin_type: "CASH_COUNT_DIFF", cash_closure_id: String(c.id) });
    expect(await balance(cash(box))).toBe("1450.00");
    const closure = await q1<{ system_balance: string; difference: string; counted_amount: string }>("SELECT system_balance, difference, counted_amount FROM cash_closures WHERE id = $1", [c.id]);
    expect(closure).toEqual({ system_balance: "1500.00", difference: "-50.00", counted_amount: "1450.00" });
    // La base no acepta un cierre con un saldo del sistema que no surge de los movimientos.
    await expectDbError(
      q("INSERT INTO cash_closures (cash_box_id, closure_date, system_balance, counted_amount, difference) VALUES ($1, $2, 999, 999, 0)", [box, today]),
      /no coincide/,
    );
  });

  it("CAJ-09 una caja con saldo no se desactiva", async () => {
    const r = ok(await run(await admin(), createCashBoxDef, { name: `Caja chica ${nextSeq()}` }));
    ok(await opening(`CASH:${r.id}`, "10"));
    const name = (await q1<{ name: string }>("SELECT name FROM cash_boxes WHERE id = $1", [r.id])).name;
    expect(await run(await admin(), updateCashBoxDef, { id: String(r.id), name })).toMatchObject({ ok: false, fieldErrors: { active: expect.any(Array) } });
    expect(await run(await admin(), createCashBoxDef, { name })).toMatchObject({ ok: false, fieldErrors: { name: [expect.stringMatching(/Ya existe/)] } });
  });
});

describe("Bancos", () => {
  it("BCO-01 transferencia recibida +100.000 y pago por transferencia −100.000, sin doble impacto (§46)", async () => {
    const acc = await makeBankAccount();
    const key = randomUUID();
    const inMove = { conceptId: String(await concept("OTROS_INGRESOS")), description: "Transferencia recibida", reference: "TRF-1", idempotencyKey: key };
    ok(await movement("BANK", acc, "IN", "100.000,00", inMove));
    ok(await movement("BANK", acc, "IN", "100.000,00", inMove)); // reintento: misma operación
    expect(await balance(bankRef(acc))).toBe("100000.00");
    ok(await movement("BANK", acc, "OUT", "100.000,00", { conceptId: String(await concept("OTROS_EGRESOS")), description: "Pago por transferencia" }));
    expect(await balance(bankRef(acc))).toBe("0.00");
  });

  it("BCO-02 saldo bancario negativo: advertencia que se confirma (descubierto)", async () => {
    const acc = await makeBankAccount();
    ok(await opening(`BANK:${acc}`, "100"));
    const first = await movement("BANK", acc, "OUT", "250");
    expect(first).toMatchObject({ ok: false, fieldErrors: { _warnings: [expect.stringMatching(/saldo negativo/)] } });
    ok(await movement("BANK", acc, "OUT", "250", { confirmWarnings: "1" }));
    expect(await balance(bankRef(acc))).toBe("-150.00");
    // Saldo inicial deudor.
    const other = await makeBankAccount();
    ok(await opening(`BANK:${other}`, "5000", undefined, { overdraft: "1" }));
    expect(await balance(bankRef(other))).toBe("-5000.00");
  });

  it("BCO-03 saldo disponible = contable − cheques propios pendientes de débito (G.9-3)", async () => {
    const ctx = await admin();
    const acc = await makeBankAccount();
    ok(await opening(`BANK:${acc}`, "100000"));
    await q(
      `INSERT INTO issued_checks (bank_account_id, format, check_type, number, amount, issue_date, payment_date, status)
       VALUES ($1, 'PHYSICAL', 'DEFERRED', $2, 30000, $3, $3, 'DELIVERED')`,
      [acc, `CH-${nextSeq()}`, today],
    );
    const a = await getTreasuryAccount(db, ctx, bankRef(acc));
    expect(a).toMatchObject({ balance: "100000.00", pendingChecks: "30000.00", available: "70000.00" });
  });

  it("BCO-04 transferencia entre cuentas propias: egreso en origen e ingreso en destino; la anulación revierte ambos", async () => {
    const box = await makeCashBox();
    const acc = await makeBankAccount();
    ok(await opening(`CASH:${box}`, "80000"));
    const t = ok(await run(await treasurer(), transferDef, { idempotencyKey: randomUUID(), from: `CASH:${box}`, to: `BANK:${acc}`, date: today, amount: "50.000,00", description: "Depósito de efectivo" }));
    expect(await balance(cash(box))).toBe("30000.00");
    expect(await balance(bankRef(acc))).toBe("50000.00");
    expect(await q("SELECT direction, amount FROM treasury_movements WHERE account_transfer_id = $1 ORDER BY direction", [t.id])).toEqual([
      { direction: "IN", amount: "50000.00" },
      { direction: "OUT", amount: "50000.00" },
    ]);
    // Más de lo que hay en caja: rechazada.
    const tooMuch = await run(await treasurer(), transferDef, { idempotencyKey: randomUUID(), from: `CASH:${box}`, to: `BANK:${acc}`, date: today, amount: "30000,01" });
    expect(tooMuch).toMatchObject({ ok: false, fieldErrors: { amount: expect.any(Array) } });
    ok(await run(await treasurer(), annulTransferDef, { id: String(t.id), reason: "Depósito no realizado" }));
    expect(await balance(cash(box))).toBe("80000.00");
    expect(await balance(bankRef(acc))).toBe("0.00");
    expect(await run(await treasurer(), annulTransferDef, { id: String(t.id), reason: "Otra vez" })).toMatchObject({ ok: false, error: expect.stringMatching(/ya está anulada/) });
    expect((await q1<{ status: string }>("SELECT status FROM account_transfers WHERE id = $1", [t.id])).status).toBe("ANNULLED");
    // Mismo origen y destino.
    const same = await run(await treasurer(), transferDef, { idempotencyKey: randomUUID(), from: `BANK:${acc}`, to: `BANK:${acc}`, date: today, amount: "1" });
    expect(same).toMatchObject({ ok: false, fieldErrors: { to: expect.any(Array) } });
  });

  it("BCO-05 libro de la cuenta: saldo anterior al período y saldo progresivo", async () => {
    const ctx = await admin();
    const acc = await makeBankAccount();
    ok(await opening(`BANK:${acc}`, "1000", addDays(today, -40)));
    ok(await movement("BANK", acc, "IN", "500", { date: addDays(today, -20) }));
    ok(await movement("BANK", acc, "OUT", "200", { date: addDays(today, -5) }));
    const all = await accountLedger(db, ctx, bankRef(acc), { from: "2000-01-01", to: today });
    expect(all.rows.map((r) => r.balance)).toEqual(["1000.00", "1500.00", "1300.00"]);
    const recent = await accountLedger(db, ctx, bankRef(acc), { from: addDays(today, -10), to: today });
    expect(recent).toMatchObject({ opening: "1500.00", totalIn: "0.00", totalOut: "200.00", closing: "1300.00" });
  });

  it("BCO-06 alta de cuenta bancaria: valida CBU y no repite nombre ni número", async () => {
    const ctx = await admin();
    const n = nextSeq();
    const base = { bankId: String(await bank("007")), accountType: "CA", accountNumber: `CA-${n}`, displayName: `Galicia CA ${n}` };
    expect(await run(ctx, createBankAccountDef, { ...base, cbu: "0070000000000000000001" })).toMatchObject({ ok: false, fieldErrors: { cbu: expect.any(Array) } });
    ok(await run(ctx, createBankAccountDef, base));
    expect(await run(ctx, createBankAccountDef, { ...base, displayName: `Otra ${n}` })).toMatchObject({ ok: false, fieldErrors: { accountNumber: expect.any(Array) } });
    // Tesorería opera las cuentas pero no las da de alta (configuración).
    expect(await run(await treasurer(), createBankAccountDef, { ...base, accountNumber: `X-${n}`, displayName: `X ${n}` })).toEqual({ ok: false, error: "No tiene permiso para realizar esta operación." });
  });
});
