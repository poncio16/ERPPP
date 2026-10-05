/**
 * Registración de comprobantes (criterios §46 "Comprobantes", §17–19). Las operaciones pasan
 * por executeAction como desde la interfaz.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  annulDocumentDef,
  checkDocumentDuplicateDef,
  registerIssuedDocumentDef,
  registerReceivedDocumentDef,
  updateDocumentInfoDef,
} from "@/modules/documents/action-defs";
import { getDocument, listDocuments } from "@/modules/documents/service";
import { executeAction, type ActionDef } from "@/server/action";
import type { ServiceContext } from "@/server/context";
import { appPool, docType, makeClient, makeSupplier, nextSeq, ownerPool as dbOwnerPool, q, q1, tax, vatCond } from "../db/helpers";
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

let adm: ServiceContext;
const admin = async () => (adm ??= (await ctxWithRoles(["ADMINISTRACION"])).ctx);

/** Factura A 21%: neto 100.000, IVA 21.000 (criterio de aceptación de §46). */
async function invoiceInput(partyId: number, overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: randomUUID(),
    documentTypeId: String(await docType("FA")),
    pointOfSale: "3",
    number: String(nextSeq()),
    partyId: String(partyId),
    issueDate: "2026-10-01",
    dueDate: "2026-10-31",
    concept: "PRODUCTS",
    vatTaxId: [String(await tax("IVA_21"))],
    vatBase: ["100.000,00"],
    vatAmount: ["21.000,00"],
    ...overrides,
  };
}

const ccBalance = async (table: "customer_accounts" | "supplier_accounts", col: string, id: number) =>
  (await q1<{ balance: string }>(`SELECT balance FROM ${table} WHERE ${col} = $1`, [id])).balance;

describe("Comprobantes emitidos", () => {
  it("CMP-01 registrar neto 100.000 + IVA 21% 21.000 = 121.000: saldo 121.000 y débito en cuenta corriente", async () => {
    const ctx = await admin();
    const client = await makeClient();
    const { id } = ok<{ id: number }>(await run(ctx, registerIssuedDocumentDef, await invoiceInput(client, { controlTotal: "121.000,00" })));
    const d = await getDocument(db, ctx, id);
    expect(d).toMatchObject({ netTaxed: "100000.00", vatTotal: "21000.00", total: "121000.00", balance: "121000.00", status: "OPEN", partyName: expect.stringMatching(/Cliente/) });
    expect(d.lines).toEqual([expect.objectContaining({ kind: "VAT", base: "100000.00", rate: "21.000", amount: "21000.00" })]);
    const entries = await q("SELECT entry_type, debit, credit FROM customer_account_entries WHERE document_id = $1", [id]);
    expect(entries).toEqual([{ entry_type: "DOCUMENT", debit: "121000.00", credit: "0.00" }]);
    expect(await ccBalance("customer_accounts", "client_id", client)).toBe("121000.00");
    expect(await lastAudit("entity_type = 'document' AND entity_id = $1", [String(id)])).toMatchObject({ action: "create", result: "SUCCESS" });
  });

  it("CMP-02 no permite duplicados (tipo + PV + número), avisa antes de guardar y la base lo impide igual", async () => {
    const ctx = await admin();
    const input = await invoiceInput(await makeClient());
    ok(await run(ctx, registerIssuedDocumentDef, input));
    const check = ok<{ duplicate: boolean }>(await run(ctx, checkDocumentDuplicateDef, { direction: "ISSUED", documentTypeId: input.documentTypeId, pointOfSale: input.pointOfSale, number: input.number }));
    expect(check.duplicate).toBe(true);
    // Para otro cliente también es duplicado: la empresa tiene una sola numeración por tipo y punto de venta.
    const dup = await run(ctx, registerIssuedDocumentDef, { ...input, idempotencyKey: randomUUID(), partyId: String(await makeClient()) });
    expect(dup).toMatchObject({ ok: false, fieldErrors: { number: [expect.stringMatching(/Ya está registrado/)] } });
    const { n } = await q1<{ n: string }>(
      "SELECT count(*) AS n FROM documents WHERE direction = 'ISSUED' AND document_type_id = $1 AND point_of_sale = $2 AND number = $3",
      [input.documentTypeId, input.pointOfSale, input.number],
    );
    expect(n).toBe("1");
  });

  it("CMP-03 rechaza totales incompatibles: total de control distinto o IVA fuera de tolerancia", async () => {
    const ctx = await admin();
    const client = await makeClient();
    const control = await run(ctx, registerIssuedDocumentDef, await invoiceInput(client, { controlTotal: "120.000,00" }));
    expect(control).toMatchObject({ ok: false, fieldErrors: { controlTotal: [expect.stringMatching(/no coincide/)] } });
    const vat = await run(ctx, registerIssuedDocumentDef, await invoiceInput(client, { vatAmount: ["21.500,00"] }));
    expect(vat).toMatchObject({ ok: false, fieldErrors: { "vat.0": [expect.stringMatching(/tolerancia/)] } });
    const empty = await run(ctx, registerIssuedDocumentDef, await invoiceInput(client, { vatTaxId: [], vatBase: [], vatAmount: [] }));
    expect(empty).toMatchObject({ ok: false, fieldErrors: { total: expect.any(Array) } });
  });

  it("CMP-04 varias alícuotas en un mismo comprobante (§15) con percepción de IIBB por jurisdicción", async () => {
    const ctx = await admin();
    const prov = (await q1<{ id: string }>("SELECT id FROM provinces WHERE code = 'BA'")).id;
    const input = await invoiceInput(await makeClient(), {
      vatTaxId: [String(await tax("IVA_21")), String(await tax("IVA_10_5"))],
      vatBase: ["100000", "50000"],
      vatAmount: ["21000", "5250"],
      otherTaxId: [String(await tax("PERC_IIBB"))],
      otherAmount: ["1500"],
      otherJurisdictionId: [prov],
    });
    const { id } = ok<{ id: number }>(await run(ctx, registerIssuedDocumentDef, input));
    expect(await getDocument(db, ctx, id)).toMatchObject({ vatTotal: "26250.00", perceptionsTotal: "1500.00", total: "177750.00" });
    const noJur = await run(ctx, registerIssuedDocumentDef, { ...input, idempotencyKey: randomUUID(), number: String(nextSeq()), otherJurisdictionId: [""] });
    expect(noJur).toMatchObject({ ok: false, fieldErrors: { "other.0": [expect.stringMatching(/jurisdicción/)] } });
  });

  it("CMP-05 nota de crédito vinculada: motivo obligatorio, crédito en cuenta corriente, queda como crédito disponible", async () => {
    const ctx = await admin();
    const client = await makeClient();
    const inv = ok<{ id: number }>(await run(ctx, registerIssuedDocumentDef, await invoiceInput(client)));
    const nc = {
      ...(await invoiceInput(client)),
      documentTypeId: String(await docType("NCA")),
      vatBase: ["10.000"],
      vatAmount: ["2.100"],
    };
    expect(await run(ctx, registerIssuedDocumentDef, nc)).toMatchObject({ ok: false, fieldErrors: { reason: expect.any(Array), relatedDocumentIds: expect.any(Array) } });
    const { id } = ok<{ id: number }>(await run(ctx, registerIssuedDocumentDef, { ...nc, reason: "Bonificación por volumen", relatedDocumentIds: [String(inv.id)] }));
    const d = await getDocument(db, ctx, id);
    expect(d).toMatchObject({ total: "12100.00", balance: "12100.00", status: "OPEN", documentClass: "CREDIT_NOTE" });
    expect(d.relatesTo).toEqual([expect.objectContaining({ id: inv.id, relationType: "CREDIT_NOTE_OF" })]);
    expect(await ccBalance("customer_accounts", "client_id", client)).toBe("108900.00");
    // NC sin comprobante asociado: solo si se marca explícitamente.
    ok(await run(ctx, registerIssuedDocumentDef, { ...nc, idempotencyKey: randomUUID(), number: String(nextSeq()), reason: "Bonificación anual", unlinkedCreditNote: "1" }));
    // No se puede vincular a un comprobante de otro cliente.
    const other = ok<{ id: number }>(await run(ctx, registerIssuedDocumentDef, await invoiceInput(await makeClient())));
    const wrong = await run(ctx, registerIssuedDocumentDef, { ...nc, idempotencyKey: randomUUID(), number: String(nextSeq()), reason: "x motivo", relatedDocumentIds: [String(other.id)] });
    expect(wrong).toMatchObject({ ok: false, fieldErrors: { relatedDocumentIds: expect.any(Array) } });
  });

  it("CMP-06 nota de débito: aumenta el saldo (débito)", async () => {
    const ctx = await admin();
    const client = await makeClient();
    const inv = ok<{ id: number }>(await run(ctx, registerIssuedDocumentDef, await invoiceInput(client)));
    ok(await run(ctx, registerIssuedDocumentDef, {
      ...(await invoiceInput(client)),
      documentTypeId: String(await docType("NDA")),
      vatBase: ["1000"],
      vatAmount: ["210"],
      reason: "Intereses por mora",
      relatedDocumentIds: [String(inv.id)],
    }));
    expect(await ccBalance("customer_accounts", "client_id", client)).toBe("122210.00");
  });

  it("CMP-07 anular el registro: saldo cero, reversión en cuenta corriente, historial intacto; libera el número (D3)", async () => {
    const ctx = await admin();
    const client = await makeClient();
    const input = await invoiceInput(client);
    const { id } = ok<{ id: number }>(await run(ctx, registerIssuedDocumentDef, input));
    expect(await run(ctx, annulDocumentDef, { id: String(id), version: "1", reason: "" })).toMatchObject({ ok: false, fieldErrors: { reason: expect.any(Array) } });
    ok(await run(ctx, annulDocumentDef, { id: String(id), version: "1", reason: "Cargado con importe equivocado" }));
    const d = await getDocument(db, ctx, id);
    expect(d).toMatchObject({ status: "ANNULLED", balance: "0.00", total: "121000.00", annulReason: "Cargado con importe equivocado" });
    const entries = await q("SELECT entry_type, debit, credit FROM customer_account_entries WHERE document_id = $1 ORDER BY id", [id]);
    expect(entries).toEqual([
      { entry_type: "DOCUMENT", debit: "121000.00", credit: "0.00" },
      { entry_type: "REVERSAL", debit: "0.00", credit: "121000.00" },
    ]);
    expect(await ccBalance("customer_accounts", "client_id", client)).toBe("0.00");
    // Un comprobante anulado no se modifica ni se vuelve a anular.
    expect(await run(ctx, annulDocumentDef, { id: String(id), version: "2", reason: "otra vez" })).toMatchObject({ ok: false });
    expect(await run(ctx, updateDocumentInfoDef, { id: String(id), version: "2", dueDate: "2026-11-30" })).toMatchObject({ ok: false });
    // Se vuelve a registrar bien con el mismo número.
    ok(await run(ctx, registerIssuedDocumentDef, { ...input, idempotencyKey: randomUUID(), vatBase: ["10.000"], vatAmount: ["2.100"] }));
  });

  it("CMP-08 idempotencia: el mismo envío dos veces registra un solo comprobante", async () => {
    const ctx = await admin();
    const input = await invoiceInput(await makeClient());
    const [a, b] = await Promise.all([run(ctx, registerIssuedDocumentDef, input), run(ctx, registerIssuedDocumentDef, input)]);
    const ida = ok<{ id: number }>(a).id;
    expect(ok<{ id: number }>(b).id).toBe(ida);
    const again = ok<{ id: number; existing: boolean }>(await run(ctx, registerIssuedDocumentDef, input));
    expect(again).toEqual({ id: ida, existing: true });
    const { n } = await q1<{ n: string }>("SELECT count(*) AS n FROM documents WHERE idempotency_key = $1", [input.idempotencyKey]);
    expect(n).toBe("1");
  });

  it("CMP-09 advertencias a confirmar: letra no habitual para la condición IVA y límite de crédito (D11)", async () => {
    const ctx = await admin();
    const client = await makeClient();
    await appPool.query("UPDATE clients SET vat_condition_id = $1, credit_limit = 50000 WHERE id = $2", [await vatCond("CF"), client]);
    const input = await invoiceInput(client);
    const r = await run(ctx, registerIssuedDocumentDef, input);
    expect(r).toMatchObject({ ok: false, fieldErrors: { _warnings: [expect.stringMatching(/letra A/), expect.stringMatching(/límite de crédito/)] } });
    const { id } = ok<{ id: number }>(await run(ctx, registerIssuedDocumentDef, { ...input, confirmWarnings: "1" }));
    const a = await lastAudit("entity_type = 'document' AND entity_id = $1", [String(id)]);
    expect(a?.message).toMatch(/advertencias confirmadas/);
  });

  it("CMP-10 período cerrado y cliente dado de baja: no se registra", async () => {
    const ctx = await admin();
    const client = await makeClient();
    await dbOwnerPool.query("UPDATE configuration SET value = '\"2026-09-30\"' WHERE key = 'locked_until_date'");
    try {
      const r = await run(ctx, registerIssuedDocumentDef, await invoiceInput(client, { issueDate: "2026-09-15", dueDate: "2026-09-30" }));
      expect(r).toMatchObject({ ok: false, fieldErrors: { issueDate: [expect.stringMatching(/período está cerrado/)] } });
    } finally {
      await dbOwnerPool.query("UPDATE configuration SET value = 'null' WHERE key = 'locked_until_date'");
    }
    await appPool.query("UPDATE clients SET status = 'INACTIVE', deactivated_at = now(), deactivation_reason = 'prueba' WHERE id = $1", [client]);
    expect(await run(ctx, registerIssuedDocumentDef, await invoiceInput(client))).toMatchObject({ ok: false, fieldErrors: { partyId: [expect.stringMatching(/baja/)] } });
  });

  it("CMP-11 corregir datos no financieros con auditoría; el vencimiento no puede ser anterior a la fecha", async () => {
    const ctx = await admin();
    const { id } = ok<{ id: number }>(await run(ctx, registerIssuedDocumentDef, await invoiceInput(await makeClient())));
    expect(await run(ctx, updateDocumentInfoDef, { id: String(id), version: "1", dueDate: "2026-09-01" })).toMatchObject({ ok: false });
    ok(await run(ctx, updateDocumentInfoDef, { id: String(id), version: "1", dueDate: "2026-11-15", description: "Entrega parcial" }));
    const a = await lastAudit("entity_type = 'document' AND entity_id = $1 AND action = 'update'", [String(id)]);
    expect(a?.before).toMatchObject({ dueDate: "2026-10-31" });
    expect(a?.after).toMatchObject({ dueDate: "2026-11-15", description: "Entrega parcial" });
  });

  it("CMP-12 listado: filtros y estado vencido derivado", async () => {
    const ctx = await admin();
    const client = await makeClient();
    ok(await run(ctx, registerIssuedDocumentDef, await invoiceInput(client, { issueDate: "2026-01-10", dueDate: "2026-02-10" })));
    const list = await listDocuments(db, ctx, "ISSUED", { q: "", partyId: client, status: "OVERDUE", page: 1 });
    expect(list.rows).toHaveLength(1);
    expect(list.sumBalance).toBe("121000.00");
  });
});

describe("Comprobantes recibidos", () => {
  it("CMP-13 duplicado por proveedor + tipo + PV + número; mismo número de otro proveedor es válido", async () => {
    const ctx = await admin();
    const s1 = await makeSupplier();
    const input = await invoiceInput(s1);
    ok(await run(ctx, registerReceivedDocumentDef, input));
    expect(await run(ctx, registerReceivedDocumentDef, { ...input, idempotencyKey: randomUUID() })).toMatchObject({ ok: false, fieldErrors: { number: expect.any(Array) } });
    ok(await run(ctx, registerReceivedDocumentDef, { ...input, idempotencyKey: randomUUID(), partyId: String(await makeSupplier()) }));
    expect(await ccBalance("supplier_accounts", "supplier_id", s1)).toBe("121000.00");
  });

  it("CMP-14 Factura B/C recibida no discrimina IVA: el importe va como no gravado", async () => {
    const ctx = await admin();
    const s = await makeSupplier();
    const withVat = await run(ctx, registerReceivedDocumentDef, await invoiceInput(s, { documentTypeId: String(await docType("FC")) }));
    expect(withVat).toMatchObject({ ok: false, fieldErrors: { vat: [expect.stringMatching(/no discrimina IVA/)] } });
    const { id } = ok<{ id: number }>(
      await run(ctx, registerReceivedDocumentDef, await invoiceInput(s, { documentTypeId: String(await docType("FC")), vatTaxId: [], vatBase: [], vatAmount: [], netUntaxed: "36.300" })),
    );
    expect(await getDocument(db, ctx, id)).toMatchObject({ netUntaxed: "36300.00", vatTotal: "0.00", total: "36300.00" });
  });

  it("CMP-15 período de IVA posterior para un recibido registrado tarde; no anterior", async () => {
    const ctx = await admin();
    const s = await makeSupplier();
    const { id } = ok<{ id: number }>(await run(ctx, registerReceivedDocumentDef, await invoiceInput(s, { vatPeriod: "2026-11" })));
    expect((await getDocument(db, ctx, id)).vatPeriod).toBe("2026-11-01");
    expect(await run(ctx, registerReceivedDocumentDef, await invoiceInput(s, { vatPeriod: "2026-09" }))).toMatchObject({ ok: false, fieldErrors: { vatPeriod: expect.any(Array) } });
    expect(await run(ctx, registerIssuedDocumentDef, await invoiceInput(await makeClient(), { vatPeriod: "2026-11" }))).toMatchObject({ ok: false, fieldErrors: { vatPeriod: expect.any(Array) } });
  });

  it("CMP-16 Tesorería y Consulta no registran ni anulan comprobantes", async () => {
    for (const role of ["TESORERIA", "CONSULTA"] as const) {
      const { ctx } = await ctxWithRoles([role]);
      expect(await run(ctx, registerReceivedDocumentDef, await invoiceInput(await makeSupplier()))).toEqual({ ok: false, error: "No tiene permiso para realizar esta operación." });
      expect(await run(ctx, annulDocumentDef, { id: "1", version: "1", reason: "intento" })).toEqual({ ok: false, error: "No tiene permiso para realizar esta operación." });
    }
  });
});
