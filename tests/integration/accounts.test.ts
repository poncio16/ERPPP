/**
 * Cuentas corrientes (criterio §46 "Cuentas corrientes", §21–22, G.4 e invariante G.14-1).
 * Los comprobantes se registran por executeAction, como desde la interfaz.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { exportStatementXlsx } from "@/modules/accounts/export";
import { accountDetail, accountStatement, accountSummary, balanceComposition, listAccounts } from "@/modules/accounts/service";
import { AccountListSchema } from "@/modules/accounts/schemas";
import { annulDocumentDef, registerIssuedDocumentDef, registerReceivedDocumentDef } from "@/modules/documents/action-defs";
import { todayIso } from "@/lib/format";
import { executeAction, type ActionDef } from "@/server/action";
import type { ServiceContext } from "@/server/context";
import { appPool, docType, makeCashBox, makeCashCollection, makeClient, makeSupplier, nextSeq, ownerPool as dbOwnerPool, q, tax } from "../db/helpers";
import { ctxWithRoles, db, lastAudit, meta, ownerPool, pool } from "./helpers";

afterAll(async () => {
  await pool.end();
  await ownerPool.end();
  await appPool.end();
  await dbOwnerPool.end();
});

const run = (ctx: ServiceContext, def: ActionDef<never, unknown> | ActionDef, input: Record<string, unknown>) =>
  executeAction(db, { ctx, mustChangePassword: false }, meta(), def as ActionDef, input);

const ok = <T>(r: { ok: boolean }) => {
  if (!r.ok) throw new Error(`Se esperaba éxito: ${JSON.stringify(r)}`);
  return (r as { ok: true; data: T }).data;
};

const today = todayIso();
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

let adm: ServiceContext;
const admin = async () => (adm ??= (await ctxWithRoles(["ADMINISTRACION"])).ctx);

/** Factura A 21% con neto `net` (IVA calculado), registrada como desde la interfaz. */
async function invoice(direction: "ISSUED" | "RECEIVED", partyId: number, net: number, dates: { issue: string; due: string }) {
  const def = direction === "ISSUED" ? registerIssuedDocumentDef : registerReceivedDocumentDef;
  const input: Record<string, unknown> = {
    idempotencyKey: randomUUID(),
    documentTypeId: String(await docType("FA")),
    pointOfSale: "7",
    number: String(nextSeq()),
    partyId: String(partyId),
    issueDate: dates.issue,
    dueDate: dates.due,
    concept: "PRODUCTS",
    vatTaxId: [String(await tax("IVA_21"))],
    vatBase: [String(net)],
    vatAmount: [(net * 0.21).toFixed(2)],
  };
  if (direction === "RECEIVED") input.vatPeriod = dates.issue.slice(0, 7);
  return ok<{ id: number }>(await run(await admin(), def, input)).id;
}

async function creditNote(partyId: number, net: number, relatedId: number) {
  return ok<{ id: number }>(
    await run(await admin(), registerIssuedDocumentDef, {
      idempotencyKey: randomUUID(),
      documentTypeId: String(await docType("NCA")),
      pointOfSale: "7",
      number: String(nextSeq()),
      partyId: String(partyId),
      issueDate: addDays(today, -1),
      dueDate: addDays(today, -1),
      concept: "PRODUCTS",
      vatTaxId: [String(await tax("IVA_21"))],
      vatBase: [String(net)],
      vatAmount: [(net * 0.21).toFixed(2)],
      reason: "Devolución de mercadería",
      relatedDocumentIds: [String(relatedId)],
    }),
  ).id;
}

const fullPeriod = { from: "2000-01-01", to: "2099-12-31" };

describe("Cuentas corrientes", () => {
  it("CC-01 comprobante 100.000 y cobranza 40.000: saldo 60.000 (§46), con débito y crédito en el libro", async () => {
    const ctx = await admin();
    const client = await makeClient();
    // Comprobante de $100.000 exactos (importe no gravado, para que el total sea el del criterio).
    const id = ok<{ id: number }>(
      await run(ctx, registerIssuedDocumentDef, {
        idempotencyKey: randomUUID(),
        documentTypeId: String(await docType("FA")),
        pointOfSale: "7",
        number: String(nextSeq()),
        partyId: String(client),
        issueDate: addDays(today, -5),
        dueDate: addDays(today, 25),
        concept: "PRODUCTS",
        netUntaxed: "100.000,00",
      }),
    ).id;
    // La cobranza todavía no tiene servicio (Hito 6): se registra con el mismo asiento que generará ese servicio.
    const { collectionId } = await makeCashCollection(client, "40000", await makeCashBox());
    await q(
      `INSERT INTO customer_account_entries (client_id, entry_date, entry_type, collection_id, credit, description)
       VALUES ($1, DATE '2026-10-02', 'COLLECTION', $2, 40000, 'Cobranza')`,
      [client, collectionId],
    );

    const s = await accountSummary(db, ctx, "ISSUED", client, fullPeriod);
    expect(s).toMatchObject({ balance: "60000.00", notDue: "100000.00", overdue: "0.00", credit: "40000.00", billed: "100000.00", settled: "40000.00", difference: "0.00" });
    expect(s.lastSettlementDate).toBe("2026-10-02");

    const st = await accountStatement(db, ctx, "ISSUED", client, fullPeriod);
    expect(st.rows.map((r) => [r.entryType, r.documentId, r.debit, r.credit])).toEqual(
      expect.arrayContaining([
        ["DOCUMENT", id, "100000.00", "0.00"],
        ["COLLECTION", null, "0.00", "40000.00"],
      ]),
    );
    expect(st.closing).toBe("60000.00");
  });

  it("CC-02 saldo progresivo ordenado por fecha y saldo anterior al período", async () => {
    const ctx = await admin();
    const client = await makeClient();
    await invoice("ISSUED", client, 1000, { issue: addDays(today, -60), due: addDays(today, -30) }); // 1.210
    await invoice("ISSUED", client, 2000, { issue: addDays(today, -10), due: addDays(today, 20) }); // 2.420
    await invoice("ISSUED", client, 500, { issue: addDays(today, -20), due: addDays(today, 10) }); // 605

    const all = await accountStatement(db, ctx, "ISSUED", client, fullPeriod);
    expect(all.opening).toBe("0.00");
    expect(all.rows.map((r) => r.balance)).toEqual(["1210.00", "1815.00", "4235.00"]);
    expect(all).toMatchObject({ totalDebit: "4235.00", totalCredit: "0.00", closing: "4235.00" });

    const recent = await accountStatement(db, ctx, "ISSUED", client, { from: addDays(today, -30), to: today });
    expect(recent.opening).toBe("1210.00");
    expect(recent.rows.map((r) => r.balance)).toEqual(["1815.00", "4235.00"]);
    expect(recent.closing).toBe(all.closing);
  });

  it("CC-03 vencido y a vencer según el vencimiento de cada comprobante", async () => {
    const ctx = await admin();
    const client = await makeClient();
    await invoice("ISSUED", client, 1000, { issue: addDays(today, -60), due: addDays(today, -1) });
    await invoice("ISSUED", client, 2000, { issue: addDays(today, -3), due: today });
    const s = await accountSummary(db, ctx, "ISSUED", client, fullPeriod);
    expect(s).toMatchObject({ overdue: "1210.00", notDue: "2420.00", balance: "3630.00", difference: "0.00" });
    const comp = await balanceComposition(db, ctx, "ISSUED", client);
    expect(comp.debts.map((d) => d.daysOverdue)).toEqual([1, 0]);
  });

  it("CC-04 la nota de crédito acredita la cuenta y queda como saldo a favor hasta imputarse; el invariante da 0", async () => {
    const ctx = await admin();
    const client = await makeClient();
    const fa = await invoice("ISSUED", client, 100000, { issue: addDays(today, -5), due: addDays(today, 25) });
    await creditNote(client, 10000, fa);
    const s = await accountSummary(db, ctx, "ISSUED", client, fullPeriod);
    // 121.000 − 12.100 = 108.900; la NC se ve como crédito disponible (12.100) hasta que se impute (Hito 6).
    expect(s).toMatchObject({ balance: "108900.00", notDue: "121000.00", credit: "12100.00", billed: "108900.00", difference: "0.00" });
    const comp = await balanceComposition(db, ctx, "ISSUED", client);
    expect(comp).toMatchObject({ totalDebt: "121000.00", totalCredit: "12100.00", net: "108900.00" });
    expect(comp.credits[0]).toMatchObject({ kind: "DOCUMENT", open: "12100.00", dueDate: null });
  });

  it("CC-05 anular el registro revierte la cuenta con un asiento espejo y el comprobante sale de la composición", async () => {
    const ctx = await admin();
    const client = await makeClient();
    const id = await invoice("ISSUED", client, 1000, { issue: addDays(today, -2), due: addDays(today, 28) });
    ok(await run(ctx, annulDocumentDef, { id: String(id), version: "1", reason: "Cargado por error" }));
    const st = await accountStatement(db, ctx, "ISSUED", client, fullPeriod);
    expect(st.rows.map((r) => [r.entryType, r.debit, r.credit])).toEqual([
      ["DOCUMENT", "1210.00", "0.00"],
      ["REVERSAL", "0.00", "1210.00"],
    ]);
    expect(st.closing).toBe("0.00");
    const s = await accountSummary(db, ctx, "ISSUED", client, fullPeriod);
    expect(s).toMatchObject({ balance: "0.00", notDue: "0.00", billed: "0.00", difference: "0.00" });
    expect((await balanceComposition(db, ctx, "ISSUED", client)).debts).toEqual([]);
  });

  it("CC-06 proveedores: comprobante recibido debita la cuenta del proveedor, sin tocar la de clientes", async () => {
    const ctx = await admin();
    const supplier = await makeSupplier();
    await invoice("RECEIVED", supplier, 50000, { issue: addDays(today, -40), due: addDays(today, -10) });
    const s = await accountSummary(db, ctx, "RECEIVED", supplier, fullPeriod);
    expect(s).toMatchObject({ balance: "60500.00", overdue: "60500.00", notDue: "0.00", billed: "60500.00", settled: "0.00", difference: "0.00" });
    const detail = await accountDetail(db, ctx, "RECEIVED", supplier, {});
    expect(detail.party.id).toBe(supplier);
    expect(detail.statement.rows.at(-1)?.balance).toBe("60500.00");
  });

  it("CC-07 listado: filtros y totales iguales a la suma de las cuentas", async () => {
    const ctx = await admin();
    const a = await makeClient();
    const b = await makeClient();
    await invoice("ISSUED", a, 1000, { issue: addDays(today, -40), due: addDays(today, -5) });
    const fb = await invoice("ISSUED", b, 2000, { issue: addDays(today, -1), due: addDays(today, 30) });
    await creditNote(b, 500, fb);

    const all = await listAccounts(db, ctx, "ISSUED", AccountListSchema.parse({ filter: "ALL" }));
    const rows: Awaited<ReturnType<typeof listAccounts>>["rows"] = [];
    for (let page = 1; page <= Math.ceil(all.total / all.pageSize); page++) rows.push(...(await listAccounts(db, ctx, "ISSUED", AccountListSchema.parse({ filter: "ALL", page }))).rows);
    const sum = (k: "balance" | "overdue" | "notDue" | "credit") => rows.reduce((acc, r) => acc + Math.round(Number(r[k]) * 100), 0) / 100;
    expect(Number(all.totals.balance)).toBeCloseTo(sum("balance"), 2);
    expect(Number(all.totals.overdue)).toBeCloseTo(sum("overdue"), 2);
    expect(Number(all.totals.credit)).toBeCloseTo(sum("credit"), 2);
    const ra = rows.find((r) => r.id === a)!;
    const rb = rows.find((r) => r.id === b)!;
    expect(ra).toMatchObject({ balance: "1210.00", overdue: "1210.00", notDue: "0.00", credit: "0.00" });
    expect(rb).toMatchObject({ balance: "1815.00", overdue: "0.00", notDue: "2420.00", credit: "605.00" });

    const overdue = await listAccounts(db, ctx, "ISSUED", AccountListSchema.parse({ filter: "OVERDUE", q: ra.legalName }));
    expect(overdue.rows.map((r) => r.id)).toEqual([a]);
    const credit = await listAccounts(db, ctx, "ISSUED", AccountListSchema.parse({ filter: "CREDIT", q: rb.legalName }));
    expect(credit.rows.map((r) => r.id)).toEqual([b]);
  });

  it("CC-08 sin permiso accounts.read no se puede consultar ninguna cuenta", async () => {
    const { ctx } = await ctxWithRoles([]);
    const client = await makeClient();
    await expect(accountSummary(db, ctx, "ISSUED", client, fullPeriod)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(accountStatement(db, ctx, "ISSUED", client, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listAccounts(db, ctx, "RECEIVED", AccountListSchema.parse({}))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const consulta = (await ctxWithRoles(["CONSULTA"])).ctx;
    await expect(accountSummary(db, consulta, "ISSUED", client, fullPeriod)).resolves.toMatchObject({ balance: "0.00" });
  });

  it("CC-09 exportación a Excel con importes numéricos y saldo progresivo; queda auditada y exige reports.export", async () => {
    const ctx = await admin();
    const client = await makeClient();
    await invoice("ISSUED", client, 1000, { issue: addDays(today, -10), due: addDays(today, 20) });
    await invoice("ISSUED", client, 500, { issue: addDays(today, -5), due: addDays(today, 25) });
    const { buffer, filename } = await exportStatementXlsx(db, ctx, "ISSUED", client, {});
    expect(filename).toMatch(/^cuenta-corriente-cliente-.+\.xlsx$/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Cuenta corriente")!;
    const values = (r: number) => (ws.getRow(r).values as unknown[]).slice(1);
    expect(values(6)).toEqual(["Fecha", "Tipo", "Comprobante / concepto", "Débito", "Crédito", "Saldo"]);
    expect(values(7).slice(3)).toEqual([1210, undefined, 1210]);
    expect(values(8).slice(3)).toEqual([605, undefined, 1815]);
    expect(values(9).slice(3)).toEqual([1815, 0, 1815]);
    expect(await lastAudit("module = 'accounts' AND action = 'export' AND entity_id = $1", [String(client)])).toMatchObject({ result: "SUCCESS" });

    // Consulta exporta (§37: lectura y reportes); un usuario sin el permiso, no.
    const consulta = (await ctxWithRoles(["CONSULTA"])).ctx;
    await expect(exportStatementXlsx(db, consulta, "ISSUED", client, {})).resolves.toHaveProperty("filename");
    const none = (await ctxWithRoles([])).ctx;
    await expect(exportStatementXlsx(db, none, "ISSUED", client, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
