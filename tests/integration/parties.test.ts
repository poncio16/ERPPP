/**
 * Clientes y proveedores (criterios §46: CLI-xx y PRV-xx). Todas las operaciones pasan por
 * executeAction, igual que desde la interfaz: sesión → permiso → validación → servicio.
 */
import { afterAll, describe, expect, it } from "vitest";
import { cuitCheckDigit } from "@/lib/cuit";
import {
  createClientDef,
  createSupplierDef,
  deactivateClientDef,
  deactivateSupplierDef,
  reactivateClientDef,
  updateClientDef,
  updateSupplierDef,
} from "@/modules/parties/action-defs";
import { getParty, listParties, partyHistory } from "@/modules/parties/service";
import { executeAction, type ActionDef } from "@/server/action";
import type { ServiceContext } from "@/server/context";
import { appPool, idType, invoiceA, makeBankAccount, q1, vatCond } from "../db/helpers";
import { ctxWithRoles, db, lastAudit, meta, ownerPool, pool } from "./helpers";

afterAll(async () => {
  await pool.end();
  await ownerPool.end();
  await appPool.end();
});

let cuitSeq = 0;
/** CUIT válida y única para cada prueba. */
function newCuit(prefix = "30") {
  for (;;) {
    const base = `${prefix}${String(Date.now() % 1e6).padStart(6, "0")}${String(++cuitSeq % 100).padStart(2, "0")}`;
    const dv = cuitCheckDigit(base);
    if (dv !== 9) return base + dv; // evita el caso "resto 10", que reasigna prefijo en la práctica
  }
}

async function run<R>(ctx: ServiceContext, def: ActionDef<never, R> | ActionDef, input: Record<string, unknown>) {
  return executeAction(db, { ctx, mustChangePassword: false }, meta(), def as ActionDef, input);
}

async function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    legalName: "Distribuidora Andina S.A.",
    idTypeId: String(await idType("CUIT")),
    taxId: newCuit(),
    vatConditionId: String(await vatCond("RI")),
    address: "Av. Siempre Viva 742",
    city: "Rosario",
    phone: "341 555-0000",
    email: "compras@andina.com.ar",
    creditDays: "30",
    creditLimit: "1.500.000,00",
    ...overrides,
  };
}

const ok = <T>(r: { ok: boolean }) => {
  if (!r.ok) throw new Error(`Se esperaba éxito: ${JSON.stringify(r)}`);
  return (r as { ok: true; data: T }).data;
};

describe("Clientes", () => {
  it("CLI-01 crear cliente: código automático, datos guardados y auditoría", async () => {
    const { ctx } = await ctxWithRoles(["ADMINISTRACION"]);
    const input = await baseInput({ taxId: "" });
    input.taxId = newCuit();
    const formatted = `${input.taxId.slice(0, 2)}-${input.taxId.slice(2, 10)}-${input.taxId.slice(10)}`;
    const data = ok<{ id: number; code: string }>(await run(ctx, createClientDef, { ...input, taxId: formatted }));
    expect(data.code).toMatch(/^C\d{5}$/);
    const c = await getParty(db, ctx, "client", data.id);
    expect(c).toMatchObject({ legalName: input.legalName, taxId: input.taxId, creditLimit: "1500000.00", creditDays: 30, status: "ACTIVE" });
    const a = await lastAudit("entity_type = 'client' AND entity_id = $1", [String(data.id)]);
    expect(a).toMatchObject({ action: "create", result: "SUCCESS", user_id: String(ctx.userId) });
  });

  it("CLI-01b rechaza CUIT inválida y datos obligatorios faltantes", async () => {
    const { ctx } = await ctxWithRoles(["ADMINISTRACION"]);
    const r = await run(ctx, createClientDef, await baseInput({ taxId: "20-12345678-5" }));
    expect(r).toMatchObject({ ok: false, fieldErrors: { taxId: [expect.stringMatching(/inválida/)] } });
    const r2 = await run(ctx, createClientDef, await baseInput({ legalName: "", vatConditionId: "" }));
    expect(r2).toMatchObject({ ok: false, fieldErrors: { legalName: expect.any(Array), vatConditionId: expect.any(Array) } });
  });

  it("CLI-01c Consumidor Final con DNI o sin identificar", async () => {
    const { ctx } = await ctxWithRoles(["ADMINISTRACION"]);
    const cf = String(await vatCond("CF"));
    ok(await run(ctx, createClientDef, await baseInput({ idTypeId: String(await idType("DNI")), taxId: "28.033.514", vatConditionId: cf })));
    ok(await run(ctx, createClientDef, await baseInput({ idTypeId: String(await idType("SIN")), taxId: "", vatConditionId: cf })));
    const bad = await run(ctx, createClientDef, await baseInput({ idTypeId: String(await idType("DNI")), taxId: "123", vatConditionId: cf }));
    expect(bad).toMatchObject({ ok: false, fieldErrors: { taxId: [expect.stringMatching(/7 u 8/)] } });
  });

  it("CLI-02 modificar cliente: registra valores anteriores y nuevos; control de edición concurrente", async () => {
    const { ctx } = await ctxWithRoles(["ADMINISTRACION"]);
    const input = await baseInput();
    const { id } = ok<{ id: number }>(await run(ctx, createClientDef, input));
    const r = await run(ctx, updateClientDef, { ...input, id: String(id), version: "1", city: "Córdoba", creditLimit: "" });
    expect(ok<{ changed: boolean }>(r).changed).toBe(true);
    const c = await getParty(db, ctx, "client", id);
    expect(c).toMatchObject({ city: "Córdoba", creditLimit: null, version: 2 });
    const a = await lastAudit("entity_type = 'client' AND entity_id = $1 AND action = 'update'", [String(id)]);
    expect(a?.before).toEqual({ city: "Rosario", creditLimit: "1500000.00" });
    expect(a?.after).toEqual({ city: "Córdoba", creditLimit: null });
    // Un segundo usuario que editó la versión 1 no pisa los cambios.
    const stale = await run(ctx, updateClientDef, { ...input, id: String(id), version: "1", city: "Mendoza" });
    expect(stale).toMatchObject({ ok: false, error: expect.stringMatching(/Otro usuario/) });
  });

  it("CLI-03 detectar CUIT duplicado; segundo registro solo con motivo y permiso", async () => {
    const admin = (await ctxWithRoles(["ADMIN"])).ctx;
    const adm = (await ctxWithRoles(["ADMINISTRACION"])).ctx;
    const input = await baseInput();
    const first = ok<{ id: number; code: string }>(await run(adm, createClientDef, input));

    const dup = await run(adm, createClientDef, { ...input, legalName: "Otra razón social" });
    expect(dup).toMatchObject({ ok: false, fieldErrors: { taxId: [expect.stringContaining(first.code)] } });

    // Administración no tiene clients.duplicate_tax_id: se rechaza y queda auditado.
    const denied = await run(adm, createClientDef, { ...input, duplicateTaxIdReason: "Sucursal Córdoba con cuenta separada" });
    expect(denied).toEqual({ ok: false, error: "No tiene permiso para realizar esta operación." });

    const allowed = await run(admin, createClientDef, { ...input, legalName: "Andina - Sucursal Córdoba", duplicateTaxIdReason: "Sucursal Córdoba con cuenta separada" });
    const second = ok<{ id: number }>(allowed);
    expect((await getParty(db, admin, "client", second.id)).duplicateTaxIdReason).toMatch(/Sucursal/);

    // También se detecta al modificar otro cliente hacia ese CUIT.
    const other = ok<{ id: number }>(await run(adm, createClientDef, await baseInput()));
    const moved = await run(adm, updateClientDef, { ...input, id: String(other.id), version: "1" });
    expect(moved).toMatchObject({ ok: false, fieldErrors: { taxId: [expect.stringContaining(first.code)] } });
  });

  it("CLI-03b la base impide el duplicado aunque se saltee el servicio", async () => {
    const { ctx } = await ctxWithRoles(["ADMINISTRACION"]);
    const input = await baseInput();
    const { id } = ok<{ id: number }>(await run(ctx, createClientDef, input));
    const c = await q1<{ tax_id: string }>("SELECT tax_id FROM clients WHERE id = $1", [id]);
    await expect(
      appPool.query(
        `INSERT INTO clients (code, legal_name, id_type_id, tax_id, vat_condition_id) VALUES ('X' || $1, 'Copia', $2, $3, $4)`,
        [id, await idType("CUIT"), c.tax_id, await vatCond("RI")],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("CLI-04 baja lógica: queda inactivo, no se borra, se puede reactivar; con saldo no se permite", async () => {
    const { ctx } = await ctxWithRoles(["ADMINISTRACION"]);
    const { id } = ok<{ id: number }>(await run(ctx, createClientDef, await baseInput()));

    const noReason = await run(ctx, deactivateClientDef, { id: String(id), version: "1", reason: "" });
    expect(noReason).toMatchObject({ ok: false, fieldErrors: { reason: expect.any(Array) } });

    ok(await run(ctx, deactivateClientDef, { id: String(id), version: "1", reason: "Cerró el local" }));
    const c = await getParty(db, ctx, "client", id);
    expect(c).toMatchObject({ status: "INACTIVE", deactivationReason: "Cerró el local", deactivatedBy: ctx.userId });
    expect(c.deactivatedAt).toBeInstanceOf(Date);
    const listed = await listParties(db, ctx, "client", { q: c.code, status: "ACTIVE", page: 1, vatConditionId: null, provinceId: null });
    // La búsqueda por código también busca dígitos en la CUIT: se controla este cliente, no el total.
    expect(listed.rows.map((r) => r.id)).not.toContain(id);
    const all = await listParties(db, ctx, "client", { q: c.code, status: "ALL", page: 1, vatConditionId: null, provinceId: null });
    expect(all.rows.map((r) => r.id)).toContain(id);

    ok(await run(ctx, reactivateClientDef, { id: String(id), version: "2" }));
    expect((await getParty(db, ctx, "client", id)).status).toBe("ACTIVE");

    // Con saldo pendiente en cuenta corriente no se puede dar de baja.
    const docId = await invoiceA(id, "1000.00");
    await appPool.query(
      `INSERT INTO customer_account_entries (client_id, entry_date, entry_type, document_id, debit, description)
       VALUES ($1, DATE '2026-10-01', 'DOCUMENT', $2, 1210.00, 'Factura')`,
      [id, docId],
    );
    const blocked = await run(ctx, deactivateClientDef, { id: String(id), version: "3", reason: "Prueba con saldo" });
    expect(blocked).toMatchObject({ ok: false, error: expect.stringMatching(/saldo pendiente.*1210\.00/) });
  });

  it("CLI-05 mantener historial: alta, modificación, baja y reactivación quedan registradas", async () => {
    const { ctx } = await ctxWithRoles(["ADMINISTRACION"]);
    const input = await baseInput();
    const { id } = ok<{ id: number }>(await run(ctx, createClientDef, input));
    ok(await run(ctx, updateClientDef, { ...input, id: String(id), version: "1", phone: "0800-111" }));
    ok(await run(ctx, deactivateClientDef, { id: String(id), version: "2", reason: "Sin operaciones" }));
    ok(await run(ctx, reactivateClientDef, { id: String(id), version: "3" }));
    const h = await partyHistory(db, ctx, "client", id);
    expect(h.map((e) => e.action)).toEqual(["reactivate", "deactivate", "update", "create"]);
    // El registro no se puede borrar físicamente (ni con el rol de la aplicación).
    await expect(appPool.query("DELETE FROM clients WHERE id = $1", [id])).rejects.toMatchObject({ code: expect.stringMatching(/42501|P0001/) });
  });

  it("CLI-06 Consulta solo lee; Tesorería no modifica clientes", async () => {
    const consulta = (await ctxWithRoles(["CONSULTA"])).ctx;
    const teso = (await ctxWithRoles(["TESORERIA"])).ctx;
    const input = await baseInput();
    expect(await run(consulta, createClientDef, input)).toEqual({ ok: false, error: "No tiene permiso para realizar esta operación." });
    expect(await run(teso, createClientDef, input)).toEqual({ ok: false, error: "No tiene permiso para realizar esta operación." });
    const list = await listParties(db, consulta, "client", { q: "", status: "ALL", page: 1, vatConditionId: null, provinceId: null });
    expect(list.total).toBeGreaterThan(0);
  });
});

describe("Proveedores", () => {
  const supplierInput = async (overrides: Record<string, unknown> = {}) =>
    baseInput({
      legalName: "Insumos del Litoral SRL",
      activity: "Insumos de oficina",
      cbu: "2850590940090418135201",
      cbuAlias: "insumos.litoral",
      ...overrides,
    });

  it("PRV-01 crear proveedor con datos bancarios", async () => {
    const { ctx } = await ctxWithRoles(["ADMINISTRACION"]);
    const data = ok<{ id: number; code: string }>(await run(ctx, createSupplierDef, await supplierInput()));
    expect(data.code).toMatch(/^P\d{5}$/);
    expect(await getParty(db, ctx, "supplier", data.id)).toMatchObject({
      activity: "Insumos de oficina",
      cbu: "2850590940090418135201",
      cbuAlias: "insumos.litoral",
    });
    const bad = await run(ctx, createSupplierDef, await supplierInput({ cbu: "2850590940090418135202", cbuAlias: "x" }));
    expect(bad).toMatchObject({ ok: false, fieldErrors: { cbu: expect.any(Array), cbuAlias: expect.any(Array) } });
  });

  it("PRV-02 modificar proveedor", async () => {
    const { ctx } = await ctxWithRoles(["ADMINISTRACION"]);
    const input = await supplierInput();
    const { id } = ok<{ id: number }>(await run(ctx, createSupplierDef, input));
    ok(await run(ctx, updateSupplierDef, { ...input, id: String(id), version: "1", activity: "Papelería", cbu: "" }));
    expect(await getParty(db, ctx, "supplier", id)).toMatchObject({ activity: "Papelería", cbu: null, version: 2 });
    const a = await lastAudit("entity_type = 'supplier' AND entity_id = $1 AND action = 'update'", [String(id)]);
    expect(a?.after).toMatchObject({ activity: "Papelería", cbu: null });
  });

  it("PRV-03 detectar CUIT duplicado (evitar proveedores duplicados)", async () => {
    const { ctx } = await ctxWithRoles(["ADMINISTRACION"]);
    const input = await supplierInput();
    const first = ok<{ code: string }>(await run(ctx, createSupplierDef, input));
    const dup = await run(ctx, createSupplierDef, { ...input, legalName: "Insumos Litoral (otra carga)" });
    expect(dup).toMatchObject({ ok: false, fieldErrors: { taxId: [expect.stringContaining(first.code)] } });
    // Clientes y proveedores son registros independientes: el mismo CUIT puede ser ambas cosas.
    ok(await run(ctx, createClientDef, await baseInput({ taxId: input.taxId })));
  });

  it("PRV-04 impedir eliminación incorrecta: sin borrado físico; baja bloqueada con cheques en circulación", async () => {
    const { ctx } = await ctxWithRoles(["ADMINISTRACION"]);
    const { id } = ok<{ id: number }>(await run(ctx, createSupplierDef, await supplierInput()));
    await expect(appPool.query("DELETE FROM suppliers WHERE id = $1", [id])).rejects.toMatchObject({ code: expect.stringMatching(/42501|P0001/) });

    await appPool.query(
      `INSERT INTO issued_checks (bank_account_id, format, check_type, number, amount, issue_date, payment_date, supplier_id)
       VALUES ($1, 'PHYSICAL', 'DEFERRED', $2, 1000.00, DATE '2026-10-01', DATE '2026-11-01', $3)`,
      [await makeBankAccount(), `9${id}`, id],
    );
    const blocked = await run(ctx, deactivateSupplierDef, { id: String(id), version: "1", reason: "Ya no trabajamos" });
    expect(blocked).toMatchObject({ ok: false, error: expect.stringMatching(/cheque\(s\) todavía en circulación/) });
    expect((await getParty(db, ctx, "supplier", id)).status).toBe("ACTIVE");
  });
});
