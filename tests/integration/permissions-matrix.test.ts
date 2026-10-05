/**
 * Matriz de permisos: cada acción del servidor se invoca DIRECTAMENTE (como lo haría una llamada
 * manipulada al backend) con cada rol. Los roles sin permiso deben ser rechazados y auditados.
 */
import { afterAll, describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, ROLES, type RoleCode } from "@/modules/auth/permissions";
import { executeAction } from "@/server/action";
import { actionRegistry } from "@/server/action-registry";
import { ctxWithRoles, db, lastAudit, meta, ownerPool, pool } from "./helpers";

afterAll(async () => {
  await pool.end();
  await ownerPool.end();
});

const roles = Object.keys(ROLES) as RoleCode[];

describe("PERM-01 Matriz acción × rol", () => {
  const defs = actionRegistry();

  it("hay acciones registradas", () => {
    expect(defs.length).toBeGreaterThan(0);
  });

  for (const def of defs) {
    for (const role of roles) {
      const allowed = def.permission === "authenticated" || ROLE_PERMISSIONS[role].includes(def.permission);
      it(`${def.name} con rol ${role} → ${allowed ? "pasa el control de permisos" : "rechazada"}`, async () => {
        const { ctx } = await ctxWithRoles([role]);
        const r = await executeAction(db, { ctx, mustChangePassword: false }, meta(), def, {});
        if (allowed) {
          // Con entrada vacía falla la validación, pero nunca por permisos.
          expect(r.ok ? "" : r.error).not.toMatch(/No tiene permiso/);
        } else {
          expect(r).toEqual({ ok: false, error: "No tiene permiso para realizar esta operación." });
          const a = await lastAudit("action = $1 AND user_id = $2", [def.name, ctx.userId]);
          expect(a?.result).toBe("DENIED");
        }
      });
    }
  }
});

describe("PERM-02 Sesión y contraseña pendiente", () => {
  it("sin sesión ninguna acción se ejecuta", async () => {
    for (const def of actionRegistry()) {
      const r = await executeAction(db, null, meta(), def, {});
      expect(r.ok).toBe(false);
    }
  });

  it("con cambio de contraseña pendiente solo se permite cambiarla", async () => {
    const { ctx } = await ctxWithRoles(["ADMIN"]);
    for (const def of actionRegistry()) {
      const r = await executeAction(db, { ctx, mustChangePassword: true }, meta(), def, {});
      if (def.allowWhenPasswordChangeRequired) expect(r.ok ? "" : r.error).not.toMatch(/Debe cambiar su contraseña/);
      else expect(r).toEqual({ ok: false, error: "Debe cambiar su contraseña antes de continuar." });
    }
  });
});
