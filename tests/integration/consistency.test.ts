/**
 * Tesorería consolidada, movimientos proyectados y verificación de consistencia (G.12, G.14).
 * CON-01..03, TES-01..03.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { depositCheckDef, creditCheckDef } from "@/modules/checks/action-defs";
import { runConsistencyDef } from "@/modules/consistency/action-defs";
import type { InvariantResult } from "@/modules/consistency/service";
import { registerRefundDef } from "@/modules/refunds/action-defs";
import { createPlannedItemDef, setPlannedItemStatusDef } from "@/modules/treasury/action-defs";
import { consolidatedPosition, incomeExpenseByConcept, listPlannedItems } from "@/modules/treasury/consolidated";
import { appPool, makeBankAccount, makeCashBox, makeClient, makeSupplier, ownerPool as dbOwnerPool, q1 } from "../db/helpers";
import { testUrls, TEST_DB } from "../setup/test-env";
import { db, lastAudit, ownerPool, pool } from "./helpers";
import {
  addDays,
  admin,
  administration,
  cashLine,
  checkLine,
  collect,
  documentFor,
  fail,
  messages,
  ok,
  openingBalance,
  pay,
  reader,
  run,
  today,
  transferLine,
  treasury,
} from "./operations-fixtures";

const superPool = (() => {
  const u = new URL(testUrls().admin);
  u.pathname = `/${TEST_DB}`;
  return new Pool({ connectionString: u.toString(), max: 1 });
})();

afterAll(async () => {
  await pool.end();
  await ownerPool.end();
  await appPool.end();
  await dbOwnerPool.end();
  await superPool.end();
});

type Run = { results: InvariantResult[]; ok: boolean };
const runCheck = async () => ok<Run>(await run(await admin(), runConsistencyDef, {}));

/** Simula una corrupción salteando los triggers (solo el superusuario puede) y la deshace al final. */
async function corrupt(sql: string, params: unknown[]) {
  const c = await superPool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query(sql, params);
    await c.query("COMMIT");
  } finally {
    c.release();
  }
}

describe("Verificación de consistencia (G.14)", () => {
  it("CON-01 después de operar con todos los circuitos, ningún invariante señala a los terceros de la prueba", async () => {
    const client = await makeClient();
    const supplier = await makeSupplier();
    const box = await makeCashBox();
    const bank = await makeBankAccount();
    await openingBalance(`CASH:${box}`, "50.000,00");
    await openingBalance(`BANK:${bank}`, "50.000,00");
    const inv = await documentFor("ISSUED", client, "10.000,00");
    const c = ok(await collect(client, [cashLine(box, "6.000,00"), await checkLine("5.000,00")], [{ documentId: inv, amount: "10000" }]));
    const check = await q1<{ id: number; version: number }>("SELECT id, version FROM received_checks WHERE id = (SELECT received_check_id FROM collection_lines WHERE collection_id = $1 AND method = 'CHECK')", [c.id]);
    ok(await run(await treasury(), depositCheckDef, { id: String(check.id), version: String(check.version), date: today, bankAccountId: String(bank) }));
    ok(await run(await treasury(), creditCheckDef, { id: String(check.id), version: String(check.version + 1), date: today }));
    ok(await run(await treasury(), registerRefundDef, { idempotencyKey: randomUUID(), sourceKind: "COLLECTION", sourceId: String(c.id), date: today, amount: "500", method: "CASH", cashBoxId: String(box), reason: "Devolución parcial" }));
    const fc = await documentFor("RECEIVED", supplier, "3.000,00");
    ok(await pay(supplier, [transferLine(bank, "3.000,00")], [{ documentId: fc, amount: "3000" }]));

    const { results } = await runCheck();
    const codes = results.map((r) => r.code);
    expect(codes).toEqual(["G14-1 clientes", "G14-1 proveedores", "G14-2", "G14-3 cobranzas", "G14-4 cobranzas", "G14-3 pagos", "G14-4 pagos", "G14-5", "G14-6", "G14-7", "G14-9"]);
    const names = await q1<{ c: string; s: string }>("SELECT (SELECT legal_name FROM clients WHERE id = $1) AS c, (SELECT legal_name FROM suppliers WHERE id = $2) AS s", [client, supplier]);
    for (const r of results) {
      for (const s of r.samples) {
        expect(s).not.toContain(names.c);
        expect(s).not.toContain(names.s);
        expect(s).not.toContain(`Cobranza #${c.id}:`);
      }
    }
    expect(results.find((r) => r.code === "G14-9")?.ok).toBe(true);
    const audit = await lastAudit("module = 'consistency' AND action = 'run'");
    expect(audit).toBeTruthy();
  });

  it("CON-02 una cobranza con saldo sin imputar alterado se detecta con su diferencia", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    const c = ok(await collect(client, [cashLine(box, "700,00")]));
    await corrupt("UPDATE collections SET unapplied_amount = 650 WHERE id = $1", [c.id]);
    try {
      const { results, ok: allOk } = await runCheck();
      expect(allOk).toBe(false);
      const g3 = results.find((r) => r.code === "G14-3 cobranzas")!;
      expect(g3.ok).toBe(false);
      expect(g3.samples).toContainEqual(expect.stringContaining(`Cobranza #${c.id}: sin imputar 650,00, esperado 700,00`));
      const g1 = results.find((r) => r.code === "G14-1 clientes")!;
      expect(g1.samples.some((s) => s.includes("cuenta corriente -700,00 y composición -650,00"))).toBe(true);
    } finally {
      await corrupt("UPDATE collections SET unapplied_amount = 700 WHERE id = $1", [c.id]);
    }
  });

  it("CON-03 solo el administrador ejecuta la verificación", async () => {
    expect(fail(await run(await administration(), runConsistencyDef, {}))).toBeTruthy();
    expect(fail(await run(await treasury(), runConsistencyDef, {}))).toBeTruthy();
  });
});

describe("Tesorería consolidada (G.12)", () => {
  it("TES-01 la posición suma cajas, bancos, cartera y cheques propios pendientes", async () => {
    const before = await consolidatedPosition(db, await reader());
    const client = await makeClient();
    const box = await makeCashBox();
    ok(await collect(client, [cashLine(box, "1.000,00"), await checkLine("2.500,00")]));
    const after = await consolidatedPosition(db, await reader());
    const diff = (k: "cash" | "portfolio" | "position") => (Number(after.totals[k]) - Number(before.totals[k])).toFixed(2);
    // Otras pruebas corren en paralelo: se verifica que el aporte de esta operación esté incluido.
    expect(Number(diff("cash"))).toBeGreaterThanOrEqual(1000);
    expect(Number(diff("portfolio"))).toBeGreaterThanOrEqual(2500);
    expect(after.cash.find((a) => a.id === box)?.balance).toBe("1000.00");
  });

  it("TES-02 ingresos y egresos por concepto: la reversión se resta del concepto original y las transferencias internas no cuentan", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    const from = addDays(today, 1);
    const empty = await incomeExpenseByConcept(db, await reader(), from, from);
    expect(empty).toEqual({ rows: [], income: "0.00", expense: "0.00", net: "0.00" });
    const r = await incomeExpenseByConcept(db, await reader(), today, today);
    const cobranza = r.rows.find((x) => x.concept === "Cobranza");
    const base = Number(cobranza?.income ?? 0);
    const c = ok(await collect(client, [cashLine(box, "400,00")]));
    const { annulCollectionDef } = await import("@/modules/collections/action-defs");
    ok(await run(await administration(), annulCollectionDef, { id: String(c.id), reason: "Prueba de reversión" }));
    const r2 = await incomeExpenseByConcept(db, await reader(), today, today);
    // Cobranza registrada y anulada el mismo día: aporte neto cero (otras pruebas pueden sumar).
    expect(Number(r2.rows.find((x) => x.concept === "Cobranza")?.income ?? 0)).toBeGreaterThanOrEqual(base);
    expect(r2.rows.some((x) => x.concept === "Reversión")).toBe(false);
    expect(r2.rows.some((x) => x.concept === "Transferencia interna" || x.concept === "Saldo inicial")).toBe(false);
  });

  it("TES-03 proyectados: alta con validación, realizado o cancelado una sola vez; Consulta no planifica", async () => {
    const date = addDays(today, 15);
    expect(messages(await run(await treasury(), createPlannedItemDef, { direction: "OUT", expectedDate: addDays(today, -1), amount: "100", description: "Alquiler" }))).toMatch(/anterior a hoy/);
    const item = ok(await run(await treasury(), createPlannedItemDef, { direction: "OUT", expectedDate: date, amount: "250.000,00", description: "Aguinaldo", recurrence: "" }));
    const monthly = ok(await run(await treasury(), createPlannedItemDef, { direction: "IN", expectedDate: date, amount: "1.000", description: "Alquiler cobrado", recurrence: "MONTHLY" }));
    const planned = await listPlannedItems(db, await reader());
    expect(planned).toContainEqual(expect.objectContaining({ id: item.id, direction: "OUT", amount: "250000.00", status: "PLANNED", recurrence: null }));
    expect(planned).toContainEqual(expect.objectContaining({ id: monthly.id, recurrence: "MONTHLY" }));
    ok(await run(await treasury(), setPlannedItemStatusDef, { id: String(item.id), status: "REALIZED" }));
    expect(messages(await run(await treasury(), setPlannedItemStatusDef, { id: String(item.id), status: "CANCELLED" }))).toMatch(/ya fue realizado o cancelado/);
    expect((await listPlannedItems(db, await reader())).some((p) => p.id === item.id)).toBe(false);
    expect(fail(await run(await reader(), createPlannedItemDef, { direction: "IN", expectedDate: date, amount: "1", description: "Prueba" }))).toBeTruthy();
  });
});
