/**
 * Reportes, antigüedad, flujo de fondos y dashboard (G.15, sección 33). REP-01..12.
 */
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { afterAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/errors";
import { depositCheckDef } from "@/modules/checks/action-defs";
import { annulCollectionDef } from "@/modules/collections/action-defs";
import { registerIssuedDocumentDef } from "@/modules/documents/action-defs";
import { cashFlow, addMonthsClamped, buildPeriods } from "@/modules/reports/cash-flow";
import { dashboardData } from "@/modules/reports/dashboard";
import { exportReport } from "@/modules/reports/export";
import { agingByParty, bucketOf, ledgerBalancesAt, openItemsAt } from "@/modules/reports/open-items";
import { runConsistencyCheck } from "@/modules/consistency/service";
import { reportReconciliation } from "@/modules/reports/reconciliation";
import { REPORTS, runReport } from "@/modules/reports/registry";
import type { ReportResult } from "@/modules/reports/types";
import { createPlannedItemDef } from "@/modules/treasury/action-defs";
import { appPool, docType, makeBankAccount, makeCashBox, makeClient, makeSupplier, nextSeq, ownerPool as dbOwnerPool, q1, tax } from "../db/helpers";
import { ctxWithRoles, db, lastAudit, ownerPool, pool } from "./helpers";
import {
  addDays,
  admin,
  administration,
  cashLine,
  checkLine,
  collect,
  documentFor,
  ok,
  openingBalance,
  pay,
  reader,
  run,
  today,
  treasury,
} from "./operations-fixtures";

afterAll(async () => {
  await pool.end();
  await ownerPool.end();
  await appPool.end();
  await dbOwnerPool.end();
});

const report = async (key: string, params: Record<string, string | undefined> = {}) => runReport(db, await reader(), key, params);
const partyName = async (table: "clients" | "suppliers", id: number) => (await q1<{ legal_name: string }>(`SELECT legal_name FROM ${table} WHERE id = $1`, [id])).legal_name;
const rowsOf = (r: ReportResult, table = 0) => r.tables[table]!.rows;

describe("Partidas abiertas y antigüedad (G.15)", () => {
  it("REP-01 tramos vencido / a vencer, créditos aparte y saldo igual a la cuenta corriente", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    // Vencida hace 45 días (31–60), vencida hace 200 (> 180), a vencer en 10 (0–30) y en 75 (61–90).
    const late45 = await documentFor("ISSUED", client, "1.000,00", { issue: addDays(today, -60), due: addDays(today, -45) });
    await documentFor("ISSUED", client, "2.000,00", { issue: addDays(today, -230), due: addDays(today, -200) });
    await documentFor("ISSUED", client, "3.000,00", { issue: addDays(today, -5), due: addDays(today, 10) });
    await documentFor("ISSUED", client, "4.000,00", { issue: addDays(today, -5), due: addDays(today, 75) });
    // Nota de crédito sin aplicar y cobranza a cuenta sin imputar: créditos.
    await documentFor("ISSUED", client, "500,00", { type: "NCA", related: [late45] });
    ok(await collect(client, [cashLine(box, "250,00")]));

    const r = await report("clientes-antiguedad", { party: String(client) });
    const [row] = rowsOf(r);
    expect(row!.cells).toMatchObject({
      o_b31: "1000.00",
      o_b181: "2000.00",
      overdue: "3000.00",
      n_b0: "3000.00",
      n_b61: "4000.00",
      notDue: "7000.00",
      credit: "-750.00",
      balance: "9250.00",
      o_b0: null,
    });
    const ledger = (await q1<{ balance: string }>("SELECT balance FROM customer_accounts WHERE client_id = $1", [client])).balance;
    expect(ledger).toBe("9250.00");
    expect(r.notes.join(" ")).toMatch(/diferencia con el reporte \$\s0,00/);
    // Con tercero elegido hay detalle por comprobante; el saldo del detalle es el mismo.
    expect(r.tables[1]!.totals).toMatchObject({ open: "9250.00" });
    expect(rowsOf(r, 1).find((x) => x.cells.situation === "Crédito sin aplicar" && x.cells.open === "-250.00")).toBeTruthy();
    expect(bucketOf(0)).toBe("b0");
    expect(bucketOf(30)).toBe("b0");
    expect(bucketOf(31)).toBe("b31");
    expect(bucketOf(181)).toBe("b181");
  });

  it("REP-02 la fecha de corte reconstruye los saldos a esa fecha, incluso después de una anulación", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    const inv = await documentFor("ISSUED", client, "10.000,00", { issue: addDays(today, -20), due: addDays(today, -10) });
    const c = ok(await collect(client, [cashLine(box, "10.000,00")], [{ documentId: inv, amount: "10000" }], { date: addDays(today, -5) }));
    const at = async (cutoff: string) => agingByParty(await openItemsAt(db, "ISSUED", cutoff, client), cutoff).total;

    expect((await at(addDays(today, -6))).balance.toFixed(2)).toBe("10000.00");
    expect((await at(addDays(today, -6))).overdue.b0.toFixed(2)).toBe("10000.00");
    expect((await at(addDays(today, -5))).balance.toFixed(2)).toBe("0.00");
    expect((await at(addDays(today, -21))).balance.toFixed(2)).toBe("0.00");

    ok(await run(await administration(), annulCollectionDef, { id: String(c.id), reason: "Cargada por error" }));
    // Hoy vuelve a deber; a la fecha de la cobranza seguía cancelado (la anulación es de hoy).
    expect((await at(today)).balance.toFixed(2)).toBe("10000.00");
    expect((await at(addDays(today, -5))).balance.toFixed(2)).toBe("0.00");
    expect((await at(addDays(today, -1))).balance.toFixed(2)).toBe("0.00");
    // Siempre igual al libro de cuenta corriente a la misma fecha.
    for (const d of [-21, -6, -5, -1, 0]) {
      const cutoff = addDays(today, d);
      const ledger = (await ledgerBalancesAt(db, "ISSUED", cutoff, client)).get(client)?.toFixed(2) ?? "0.00";
      expect((await at(cutoff)).balance.toFixed(2)).toBe(ledger);
    }
  });

  it("REP-03 deuda por tercero, vencimientos y límite de crédito", async () => {
    const client = await makeClient();
    await documentFor("ISSUED", client, "800,00", { issue: addDays(today, -40), due: addDays(today, -3) });
    await documentFor("ISSUED", client, "700,00", { issue: addDays(today, -1), due: addDays(today, 20) });
    await documentFor("ISSUED", client, "900,00", { issue: addDays(today, -1), due: addDays(today, 50) });
    await q1("UPDATE clients SET credit_limit = 1000 WHERE id = $1 RETURNING id", [client]);

    const debt = await report("clientes-deuda", { party: String(client) });
    expect(rowsOf(debt)[0]!.cells).toMatchObject({ overdue: "800.00", notDue: "1600.00", balance: "2400.00", maxDays: 3, limit: "1000.00", overLimit: "Excedido" });

    const due = await report("clientes-vencimientos", { party: String(client) });
    expect(rowsOf(due).map((x) => [x.cells.open, x.cells.situation])).toEqual([
      ["800.00", "Vencido hace 3 d"],
      ["700.00", "Vence en 20 d"],
    ]);
    const all = await report("clientes-vencimientos", { party: String(client), to: addDays(today, 60) });
    expect(all.tables[0]!.totals).toMatchObject({ open: "2400.00" });
    const window = await report("clientes-vencimientos", { party: String(client), from: today, to: addDays(today, 60) });
    expect(window.tables[0]!.totals).toMatchObject({ open: "1600.00" });
  });
});

describe("Reportes de comprobantes, operaciones y retenciones", () => {
  it("REP-04 comprobantes con NC en negativo y anulados fuera de los totales; cobranzas por medio", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    const inv = await documentFor("ISSUED", client, "1.000,00", { issue: today, due: addDays(today, 30) });
    await documentFor("ISSUED", client, "200,00", { type: "NCA", related: [inv], issue: today });
    const retention = { method: "RETENTION", amount: "50,00", retentionTaxId: String(await tax("RET_IIBB")), certificate: `R-${nextSeq()}`, retentionDate: today };
    const c1 = ok(await collect(client, [cashLine(box, "300,00"), await checkLine("400,00"), retention], [{ documentId: inv, amount: "700" }]));
    const c2 = ok(await collect(client, [cashLine(box, "100,00")]));
    ok(await run(await administration(), annulCollectionDef, { id: String(c2.id), reason: "Cargada por error" }));

    const docs = await report("clientes-comprobantes", { party: String(client) });
    expect(rowsOf(docs).map((x) => x.cells.total)).toEqual(["1000.00", "-200.00"]);
    expect(docs.tables[0]!.totals).toMatchObject({ total: "800.00", netUntaxed: "800.00" });

    const ncOnly = await report("clientes-comprobantes", { party: String(client), type: String(await docType("NCA")) });
    expect(rowsOf(ncOnly)).toHaveLength(1);

    const active = await report("clientes-cobranzas", { party: String(client) });
    expect(rowsOf(active)).toHaveLength(1);
    expect(rowsOf(active)[0]!.cells).toMatchObject({ cash: "300.00", checks: "400.00", retentions: "50.00", total: "750.00", applied: "700.00", unapplied: "50.00" });
    expect(rowsOf(active)[0]!.href).toBe(`/cobranzas/${c1.id}`);
    const withAnnulled = await report("clientes-cobranzas", { party: String(client), status: "ALL" });
    expect(rowsOf(withAnnulled)).toHaveLength(2);
    expect(withAnnulled.tables[0]!.totals).toMatchObject({ total: "750.00" });

    const ret = await report("clientes-retenciones", { party: String(client) });
    expect(rowsOf(ret)[0]!.cells).toMatchObject({ tax: "Retención de Ingresos Brutos", amount: "50.00", certificate: retention.certificate });
  });

  it("REP-05 subdiario de IVA ventas: neto e IVA por alícuota, percepciones por jurisdicción, NC restando, columnas = total", async () => {
    const client = await makeClient();
    const province = await q1<{ id: number }>("SELECT id FROM provinces ORDER BY id LIMIT 1");
    const base = {
      documentTypeId: String(await docType("FA")),
      pointOfSale: "7",
      partyId: String(client),
      issueDate: today,
      dueDate: addDays(today, 30),
      concept: "PRODUCTS",
    };
    const inv = ok(
      await run(await administration(), registerIssuedDocumentDef, {
        ...base,
        idempotencyKey: randomUUID(),
        number: String(nextSeq()),
        vatTaxId: [String(await tax("IVA_21")), String(await tax("IVA_10_5"))],
        vatBase: ["1.000,00", "2.000,00"],
        vatAmount: ["210,00", "210,00"],
        otherTaxId: [String(await tax("PERC_IIBB"))],
        otherAmount: ["30,00"],
        otherJurisdictionId: [String(province.id)],
        netExempt: "100,00",
      }),
    ).id;
    ok(
      await run(await administration(), registerIssuedDocumentDef, {
        ...base,
        idempotencyKey: randomUUID(),
        documentTypeId: String(await docType("NCA")),
        number: String(nextSeq()),
        vatTaxId: [String(await tax("IVA_21"))],
        vatBase: ["100,00"],
        vatAmount: ["21,00"],
        reason: "Devolución de mercadería",
        relatedDocumentIds: [String(inv)],
      }),
    );
    const book = await report("iva-ventas", {});
    const name = await partyName("clients", client);
    const mine = rowsOf(book).filter((x) => x.cells.party === name);
    expect(mine).toHaveLength(2);
    const [fa, nc] = mine;
    expect(fa!.cells).toMatchObject({ "n21.000": "1000.00", "v21.000": "210.00", "n10.500": "2000.00", "v10.500": "210.00", exempt: "100.00", total: "3550.00" });
    const percKey = Object.keys(fa!.cells).find((k) => k.startsWith("p") && fa!.cells[k] === "30.00");
    expect(percKey).toBeTruthy();
    expect(book.tables[0]!.columns.find((c) => c.key === percKey)?.group).toBe("Percepciones");
    expect(nc!.cells).toMatchObject({ "n21.000": "-100.00", "v21.000": "-21.00", total: "-121.00" });
    expect(book.notes.join(" ")).not.toMatch(/diferencia entre columnas/);
    expect(book.notes.join(" ")).toMatch(/no reemplaza al Libro IVA Digital/i);
    // Período sin comprobantes de este cliente.
    const empty = await report("iva-ventas", { from: "2001-01", to: "2001-01" });
    expect(rowsOf(empty)).toHaveLength(0);
  });

  it("REP-06 cuenta corriente y libro de caja reutilizan los módulos de origen", async () => {
    const client = await makeClient();
    const box = await makeCashBox();
    await openingBalance(`CASH:${box}`, "1.000,00");
    const inv = await documentFor("ISSUED", client, "600,00", { issue: today });
    ok(await collect(client, [cashLine(box, "600,00")], [{ documentId: inv, amount: "600" }]));

    const st = await report("clientes-cuenta-corriente", { party: String(client) });
    expect(st.tables[0]!.totals).toMatchObject({ debit: "600.00", credit: "600.00", balance: "0.00" });
    const none = await report("clientes-cuenta-corriente", {});
    expect(none.tables).toHaveLength(0);
    expect(none.notes[0]).toMatch(/Elija un cliente/);

    const book = await report("libro-caja", { account: String(box), from: addDays(today, -90) });
    expect(book.tables[0]!.totals).toMatchObject({ in: "1600.00", out: "0.00", balance: "1600.00" });
  });
});

describe("Flujo de fondos (G.15)", () => {
  it("REP-07 períodos semanales y mensuales, recurrencia mensual con días que no existen", () => {
    const weeks = buildPeriods("2026-10-06", "WEEK", 3, "2026-10-06");
    expect(weeks.map((p) => [p.from, p.to])).toEqual([
      ["2026-10-06", "2026-10-12"],
      ["2026-10-13", "2026-10-19"],
      ["2026-10-20", "2026-10-26"],
    ]);
    const months = buildPeriods("2026-10-06", "MONTH", 3, "2026-10-06");
    expect(months.map((p) => [p.from, p.to])).toEqual([
      ["2026-10-06", "2026-10-31"],
      ["2026-11-01", "2026-11-30"],
      ["2026-12-01", "2026-12-31"],
    ]);
    expect(buildPeriods("2026-10-01", "WEEK", 2, "2026-10-06").map((p) => p.projected)).toEqual([false, true]);
    expect(buildPeriods("2026-10-06", "WEEK", 2, "2026-10-06").map((p) => p.projected)).toEqual([false, true]);
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-01-31", 2)).toBe("2026-03-31");
  });

  it("REP-08 saldo real inicial, atrasado al comienzo, proyectado por vencimiento y fecha de pago, saldo acumulado", async () => {
    const client = await makeClient();
    const supplier = await makeSupplier();
    const box = await makeCashBox();
    await openingBalance(`CASH:${box}`, "5.000,00");
    const lateDoc = await documentFor("ISSUED", client, "1.111,00", { issue: addDays(today, -40), due: addDays(today, -10) });
    const nextWeek = await documentFor("ISSUED", client, "2.222,00", { issue: addDays(today, -1), due: addDays(today, 8) });
    const supplierDoc = await documentFor("RECEIVED", supplier, "3.333,00", { issue: addDays(today, -1), due: addDays(today, 1) });
    ok(await collect(client, [await checkLine("444,00", { paymentDate: addDays(today, 15) })]));
    // Un cheque depositado a acreditar no se proyecta: solo los que están en cartera.
    const deposited = ok(await collect(client, [await checkLine("555,00", { paymentDate: addDays(today, 15) })]));
    const dep = await q1<{ id: number; version: number }>("SELECT id, version FROM received_checks WHERE id = (SELECT received_check_id FROM collection_lines WHERE collection_id = $1)", [deposited.id]);
    ok(await run(await treasury(), depositCheckDef, { id: String(dep.id), version: String(dep.version), date: today, bankAccountId: String(await makeBankAccount()) }));
    ok(await pay(supplier, [cashLine(box, "100,00")]));
    const planned = ok(await run(await treasury(), createPlannedItemDef, { direction: "OUT", expectedDate: addDays(today, 3), amount: "77,00", description: `Alquiler ${nextSeq()}`, recurrence: "MONTHLY" }));

    const f = await cashFlow(db, { start: today, view: "WEEK", periods: 8 }, today);
    const mine = (href: string) => f.items.filter((i) => i.href === href);
    expect(mine(`/comprobantes-emitidos/${lateDoc}`)).toEqual([expect.objectContaining({ period: "late", line: "AR", amount: "1111.00" })]);
    expect(mine(`/comprobantes-emitidos/${nextWeek}`)).toEqual([expect.objectContaining({ period: "p1", amount: "2222.00" })]);
    expect(mine(`/comprobantes-recibidos/${supplierDoc}`)).toEqual([expect.objectContaining({ period: "p0", line: "AP", amount: "3333.00" })]);
    expect(f.items.filter((i) => i.line === "CHECKS_IN" && i.amount === "444.00" && i.date === addDays(today, 15))).toHaveLength(1);
    expect(f.items.filter((i) => i.href === `/cheques/recibidos/${dep.id}`)).toEqual([]);
    const plannedItem = await q1<{ description: string }>("SELECT description FROM planned_cash_items WHERE id = $1", [planned.id]);
    const occurrences = f.items.filter((i) => i.description === `${plannedItem.description} (mensual)`);
    expect(occurrences.map((i) => i.date)).toEqual([addDays(today, 3), addMonthsClamped(addDays(today, 3), 1)].filter((d) => d <= f.periods.at(-1)!.to));

    // Saldo real inicial = caja + bancos antes de hoy; el acumulado cierra con la suma de los flujos.
    const before = await q1<{ v: string }>("SELECT coalesce(sum(CASE WHEN direction = 'IN' THEN amount ELSE -amount END), 0)::numeric(18,2)::text AS v FROM treasury_movements WHERE movement_date < $1", [today]);
    expect(f.opening).toBe(before.v);
    const keys = ["late", ...f.periods.map((p) => p.key)];
    let running = Number(f.opening);
    for (const k of keys) {
      expect(f.startBalance[k]).toBe(running.toFixed(2));
      running = Math.round((running + Number(f.net[k])) * 100) / 100;
      expect(f.endBalance[k]).toBe(running.toFixed(2));
    }
    expect(Number(f.realOut.p0)).toBeGreaterThanOrEqual(100);

    const r = await report("flujo-de-fondos", { view: "MONTH", periods: "3" });
    expect(r.tables[0]!.columns.map((c) => c.key)).toEqual(["concept", "late", "p0", "p1", "p2", "total"]);
    expect(r.tables[0]!.columns.find((c) => c.key === "late")?.projected).toBe(true);
    expect(rowsOf(r).filter((x) => x.projected).length).toBeGreaterThanOrEqual(6);
  });
});

describe("Permisos, exportación, dashboard y G.14-8", () => {
  it("REP-09 sin reports.read o sin el permiso del módulo no se puede ver; exportar exige reports.export y queda auditado", async () => {
    const { ctx: nobody } = await ctxWithRoles([]);
    await expect(runReport(db, nobody, "clientes-deuda", {})).rejects.toBeInstanceOf(ForbiddenError);
    const partial = { ...(await reader()), permissions: new Set([...(await reader()).permissions].filter((p) => p !== "treasury.read")) };
    await expect(runReport(db, partial, "flujo-de-fondos", {})).rejects.toBeInstanceOf(ForbiddenError);
    const noExport = { ...(await reader()), permissions: new Set([...(await reader()).permissions].filter((p) => p !== "reports.export")) };
    await expect(exportReport(db, noExport, "clientes-deuda", {}, "excel")).rejects.toBeInstanceOf(ForbiddenError);
    expect(REPORTS.every((r) => r.permissions.length > 0)).toBe(true);
  });

  it("REP-10 Excel con números reales y PDF válido, con los mismos totales que la pantalla", async () => {
    const client = await makeClient();
    await documentFor("ISSUED", client, "1.234,56", { issue: today });
    const ctx = await reader();
    const xlsx = await exportReport(db, ctx, "clientes-comprobantes", { party: String(client) }, "excel");
    expect(xlsx.filename).toMatch(/^clientes-comprobantes-.*\.xlsx$/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const values: unknown[] = [];
    ws.eachRow((row) => row.eachCell((c) => values.push(c.value)));
    expect(values.filter((v) => v === 1234.56).length).toBeGreaterThanOrEqual(2);
    expect(await lastAudit("module = 'reports' AND action = 'export' AND user_id = $1", [ctx.userId])).toMatchObject({ result: "SUCCESS" });

    const pdf = await exportReport(db, ctx, "clientes-antiguedad", { party: String(client) }, "pdf");
    expect(pdf.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.contentType).toBe("application/pdf");
    // Todos los reportes se generan y exportan sin errores con sus filtros por defecto.
    for (const r of REPORTS) {
      const out = await exportReport(db, await admin(), r.key, {}, "pdf");
      expect(out.buffer.length).toBeGreaterThan(500);
    }
  });

  it("REP-11 el dashboard usa las mismas cifras que los reportes que enlaza", async () => {
    const ctx = await reader();
    const data = await dashboardData(db, ctx, today);
    const debt = await runReport(db, ctx, "clientes-deuda", {});
    expect(data.receivable!.total).toBe(debt.tables[0]!.totals!.balance);
    expect(data.receivable!.overdue).toBe(debt.tables[0]!.totals!.overdue);
    const payDebt = await runReport(db, ctx, "proveedores-deuda", {});
    expect(data.payable!.total).toBe(payDebt.tables[0]!.totals!.balance);
    const portfolio = await runReport(db, ctx, "cartera-cheques", {});
    expect(data.treasury!.portfolio).toBe(portfolio.tables[0]!.totals!.amount);
    const collections = await runReport(db, ctx, "clientes-cobranzas", {});
    expect(data.receivable!.settledMonth).toBe(collections.tables[0]!.totals!.total);
    expect(data.evolution).toHaveLength(12);
    expect(data.evolution!.at(-1)).toMatchObject({ date: today, ar: (await q1<{ v: string }>("SELECT coalesce(sum(debit - credit), 0)::numeric(18,2)::text AS v FROM customer_account_entries WHERE entry_date <= $1", [today])).v });
    const { ctx: nobody } = await ctxWithRoles([]);
    await expect(dashboardData(db, nobody, today)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("REP-12 G.14-8: los totales de los reportes coinciden con los módulos de origen", async () => {
    const client = await makeClient();
    const supplier = await makeSupplier();
    const box = await makeCashBox();
    const inv = await documentFor("ISSUED", client, "5.000,00", { issue: addDays(today, -40), due: addDays(today, -5) });
    await documentFor("ISSUED", client, "700,00", { type: "NCA", related: [inv] });
    ok(await collect(client, [cashLine(box, "1.000,00")], [{ documentId: inv, amount: "600" }]));
    await documentFor("RECEIVED", supplier, "2.000,00", { due: addDays(today, 20) });
    ok(await pay(supplier, [cashLine(box, "300,00")]));

    const mismatches = await reportReconciliation(db, await admin(), today);
    const names = [await partyName("clients", client), await partyName("suppliers", supplier)];
    expect(mismatches.filter((m) => names.some((n) => m.label.includes(n)))).toEqual([]);
    // La base de pruebas es compartida y tests/db inserta comprobantes sin asiento a propósito (G.14-1 roto):
    // los totales generales solo se exigen cuando el invariante 1 se cumple.
    const { results } = await runConsistencyCheck(db, await admin());
    for (const [code, prefix] of [["G14-1 clientes", "Clientes –"], ["G14-1 proveedores", "Proveedores –"]] as const) {
      if (results.find((r) => r.code === code)!.ok) expect(mismatches.filter((m) => m.label.startsWith(prefix))).toEqual([]);
    }
    expect(results.find((r) => r.code === "G14-8")!.failures).toBe(mismatches.length);
  });
});
