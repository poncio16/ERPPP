/**
 * Auditoría (sección I y criterios AUD-xx): qué se registra, consulta con filtros, permisos,
 * protección contra modificaciones y verificación de la cadena de hashes.
 */
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { cuitCheckDigit } from "@/lib/cuit";
import { ForbiddenError } from "@/lib/errors";
import { todayIso } from "@/lib/format";
import { fieldChanges, getAuditEntry, listAuditLog, verifyAuditChain } from "@/modules/audit/query";
import { AuditQuerySchema } from "@/modules/audit/schemas";
import { createClientDef, updateClientDef } from "@/modules/parties/action-defs";
import { withDatabase } from "@/modules/backup/pg-tools";
import { appPool, idType, vatCond } from "../db/helpers";
import { TEST_DB, testUrls } from "../setup/test-env";
import { run } from "./operations-fixtures";
import { ctxWithRoles, db, lastAudit, ownerPool, pool } from "./helpers";

afterAll(async () => {
  await pool.end();
  await ownerPool.end();
  await appPool.end();
});

const q = (raw: Record<string, unknown> = {}) => AuditQuerySchema.parse(raw);

function newCuit() {
  for (let i = 0; ; i++) {
    const base = `30${String((Date.now() + i) % 1e8).padStart(8, "0")}`;
    if (cuitCheckDigit(base) !== 9) return base + cuitCheckDigit(base);
  }
}

async function createClient(ctx: Awaited<ReturnType<typeof ctxWithRoles>>["ctx"]) {
  const input = {
    legalName: "Auditada S.R.L.",
    idTypeId: String(await idType("CUIT")),
    taxId: newCuit(),
    vatConditionId: String(await vatCond("RI")),
    address: "San Martín 100",
    city: "Rosario",
    creditDays: "30",
    creditLimit: "",
  };
  const r = await run(ctx, createClientDef, input);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return { id: (r.data as { id: number }).id, input };
}

describe("Auditoría", () => {
  it("AUD-01 registra usuario, fecha y hora, acción, módulo, registro, valores anteriores y nuevos y resultado", async () => {
    const { ctx, user } = await ctxWithRoles(["ADMINISTRACION"]);
    const before = Date.now();
    const { id, input } = await createClient(ctx);
    const created = await lastAudit("module = 'clients' AND entity_id = $1", [String(id)]);
    expect(created).toMatchObject({ user_id: String(user.id), username: user.username, module: "clients", entity_type: "client", result: "SUCCESS", ip: "10.0.0.1" });
    expect(new Date(created!.occurred_at as string).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(created!.after).toMatchObject({ legalName: "Auditada S.R.L.", city: "Rosario" });

    const upd = await run(ctx, updateClientDef, { ...input, id: String(id), version: "1", city: "Córdoba" });
    expect(upd.ok).toBe(true);
    const updated = await lastAudit("module = 'clients' AND entity_id = $1", [String(id)]);
    expect(updated!.before).toEqual({ city: "Rosario" });
    expect(updated!.after).toEqual({ city: "Córdoba" });

    // El detalle muestra campo por campo lo que cambió.
    const { ctx: admin } = await ctxWithRoles(["ADMIN"]);
    const detail = await getAuditEntry(db, admin, Number(updated!.id));
    expect(detail?.entry).toMatchObject({ module: "clients", entityId: String(id), result: "SUCCESS" });
    expect(detail?.previousId).toBeLessThan(Number(updated!.id));
    expect(fieldChanges(detail!.entry.before, detail!.entry.after)).toEqual([{ field: "city", before: "Rosario", after: "Córdoba" }]);
  });

  it("AUD-02 consulta con filtros por usuario, módulo, resultado, registro, texto y fechas", async () => {
    const { ctx: admin } = await ctxWithRoles(["ADMIN"]);
    const { ctx, user } = await ctxWithRoles(["ADMINISTRACION"]);
    const { id } = await createClient(ctx);
    // Un intento sin permiso queda como DENIED.
    const { ctx: reader, user: readerUser } = await ctxWithRoles(["CONSULTA"]);
    const denied = await run(reader, createClientDef, {});
    expect(denied.ok).toBe(false);

    const byUser = await listAuditLog(db, admin, q({ user: String(user.id) }));
    expect(byUser.total).toBeGreaterThanOrEqual(1);
    expect(byUser.rows.every((r) => r.userId === user.id)).toBe(true);

    const byEntity = await listAuditLog(db, admin, q({ module: "clients", entityType: "client", entityId: String(id) }));
    expect(byEntity.rows.map((r) => r.action)).toContain("create");

    const byResult = await listAuditLog(db, admin, q({ result: "DENIED", user: String(readerUser.id) }));
    expect(byResult.rows).toHaveLength(1);
    expect(byResult.rows[0]).toMatchObject({ action: "clients.create", result: "DENIED" });

    // La acción se filtra por su código corto o por el nombre de la Server Action.
    expect((await listAuditLog(db, admin, q({ action: "create", user: String(readerUser.id) }))).total).toBe(1);
    expect((await listAuditLog(db, admin, q({ q: readerUser.username }))).total).toBeGreaterThanOrEqual(1);

    const today = todayIso();
    expect((await listAuditLog(db, admin, q({ from: today, to: today, user: String(user.id) }))).total).toBe(byUser.total);
    const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect((await listAuditLog(db, admin, q({ from: tomorrow, user: String(user.id) }))).total).toBe(0);

    // Orden descendente y paginación de 50.
    const all = await listAuditLog(db, admin, q());
    expect(all.rows.length).toBeLessThanOrEqual(50);
    expect(all.rows[0]!.id).toBeGreaterThan(all.rows.at(-1)!.id);
    if (all.total > 50) {
      const p2 = await listAuditLog(db, admin, q({ page: "2" }));
      expect(p2.rows[0]!.id).toBeLessThan(all.rows.at(-1)!.id);
    }
    // Filtros inválidos se ignoran en lugar de romper la consulta.
    expect(q({ from: "2026-13-45", result: "OTRO", module: "x;drop", page: "-3" })).toMatchObject({ from: undefined, result: undefined, module: undefined, page: 1 });
  });

  it("AUD-03 solo el administrador consulta la auditoría", async () => {
    for (const role of ["ADMINISTRACION", "TESORERIA", "CONSULTA"] as const) {
      const { ctx } = await ctxWithRoles([role]);
      await expect(listAuditLog(db, ctx, q())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getAuditEntry(db, ctx, 1)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(verifyAuditChain(db, ctx)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("AUD-04 los registros de auditoría no se pueden modificar ni borrar", async () => {
    const last = await lastAudit("true");
    await expect(pool.query("UPDATE audit_log SET message = 'x' WHERE id = $1", [last!.id])).rejects.toThrow(/permission denied/);
    await expect(pool.query("DELETE FROM audit_log WHERE id = $1", [last!.id])).rejects.toThrow(/permission denied/);
    await expect(ownerPool.query("UPDATE audit_log SET message = 'x' WHERE id = $1", [last!.id])).rejects.toThrow(/inmutables/);
    await expect(ownerPool.query("DELETE FROM audit_log WHERE id = $1", [last!.id])).rejects.toThrow();
  });

  it("AUD-05 'Verificar integridad' señala el primer registro alterado y queda auditada", async () => {
    const { ctx: admin } = await ctxWithRoles(["ADMIN"]);
    const ok = await verifyAuditChain(db, admin);
    expect(ok).toMatchObject({ ok: true, brokenAt: null });
    expect(ok.total).toBeGreaterThan(0);
    expect(await lastAudit("action = 'verify_chain'")).toMatchObject({ module: "audit", result: "SUCCESS", user_id: String(admin.userId) });

    // Alteración directa (solo posible para un superusuario de la base, salteando los triggers).
    const { ctx } = await ctxWithRoles(["ADMINISTRACION"]);
    const { id } = await createClient(ctx);
    const target = await lastAudit("module = 'clients' AND entity_id = $1", [String(id)]);
    const su = new Client({ connectionString: withDatabase(testUrls().admin, TEST_DB) });
    await su.connect();
    try {
      await su.query("SET session_replication_role = replica");
      await su.query("UPDATE audit_log SET message = 'texto alterado' WHERE id = $1", [target!.id]);
      const broken = await verifyAuditChain(db, admin);
      expect(broken.ok).toBe(false);
      expect(broken.brokenAt?.id).toBe(Number(target!.id));
      expect(await lastAudit("action = 'verify_chain'")).toMatchObject({ message: `La cadena se rompe en el registro #${target!.id}` });
    } finally {
      await su.query("UPDATE audit_log SET message = $2 WHERE id = $1", [target!.id, target!.message]);
      await su.end();
    }
    expect((await verifyAuditChain(db, admin)).ok).toBe(true);
  });

  it("AUD-06 valores anteriores y nuevos: altas, modificaciones y valores simples", () => {
    expect(fieldChanges(null, { a: 1, b: "x" })).toEqual([
      { field: "a", before: undefined, after: 1 },
      { field: "b", before: undefined, after: "x" },
    ]);
    expect(fieldChanges({ a: 1 }, { a: 2 })).toEqual([{ field: "a", before: 1, after: 2 }]);
    expect(fieldChanges("ACTIVE", "ANNULLED")).toEqual([{ field: "(valor)", before: "ACTIVE", after: "ANNULLED" }]);
  });
});
