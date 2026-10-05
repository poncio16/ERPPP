import { afterAll, describe, expect, it } from "vitest";
import {
  INVALID_CREDENTIALS_MESSAGE,
  changeOwnPassword,
  login,
  logout,
  validateSessionToken,
} from "@/modules/auth/service";
import { ROLE_PERMISSIONS } from "@/modules/auth/permissions";
import { createInitialAdmin, createUser, setRolePermissions, updateUser } from "@/modules/users/service";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { contextFor, ctxWithRoles, db, insertUser, lastAudit, meta, ownerPool, pool, uniqueName } from "./helpers";

afterAll(async () => {
  await pool.end();
  await ownerPool.end();
});

const okLogin = async (username: string, password: string) => {
  const r = await login(db, { username, password }, meta());
  if (!r.ok) throw new Error(r.message);
  return r;
};

describe("AUTH-01 Inicio de sesión", () => {
  it("con credenciales correctas crea una sesión que carga los permisos del rol", async () => {
    const u = await insertUser(["TESORERIA"]);
    const r = await okLogin(u.username.toUpperCase(), u.password);
    const s = await validateSessionToken(db, r.token);
    expect(s?.userId).toBe(u.id);
    expect([...s!.permissions].sort()).toEqual([...ROLE_PERMISSIONS.TESORERIA].sort());
    const a = await lastAudit("module='auth' AND action='login' AND user_id=$1", [u.id]);
    expect(a?.result).toBe("SUCCESS");
  });

  it("guarda solo el hash del token y la contraseña con Argon2id", async () => {
    const u = await insertUser(["CONSULTA"]);
    const r = await okLogin(u.username, u.password);
    const { rows } = await pool.query(
      "SELECT s.token_hash, u.password_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1",
      [r.sessionId],
    );
    expect(rows[0].token_hash).not.toBe(r.token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
  });

  it("usuario inexistente y contraseña incorrecta devuelven el mismo mensaje genérico", async () => {
    const u = await insertUser(["CONSULTA"]);
    const a = await login(db, { username: "no-existe-" + u.username, password: "x" }, meta());
    const b = await login(db, { username: u.username, password: "incorrecta" }, meta());
    expect(a).toEqual({ ok: false, message: INVALID_CREDENTIALS_MESSAGE });
    expect(b).toEqual({ ok: false, message: INVALID_CREDENTIALS_MESSAGE });
    expect((await lastAudit("module='auth' AND action='login' AND user_id=$1", [u.id]))?.result).toBe("DENIED");
  });

  it("bloquea al usuario tras 5 intentos fallidos, aun con la contraseña correcta", async () => {
    const u = await insertUser(["CONSULTA"]);
    for (let i = 0; i < 5; i++) await login(db, { username: u.username, password: "mala" }, meta());
    const r = await login(db, { username: u.username, password: u.password }, meta());
    expect(r.ok).toBe(false);
    expect((await lastAudit("module='auth' AND action='lock' AND entity_id=$1", [String(u.id)]))?.result).toBe("SUCCESS");
    await pool.query("UPDATE users SET locked_until = now() - interval '1 second' WHERE id = $1", [u.id]);
    expect((await login(db, { username: u.username, password: u.password }, meta())).ok).toBe(true);
  });

  it("un usuario inactivo no puede ingresar", async () => {
    const u = await insertUser(["CONSULTA"]);
    await pool.query("UPDATE users SET status = 'INACTIVE' WHERE id = $1", [u.id]);
    expect((await login(db, { username: u.username, password: u.password }, meta())).ok).toBe(false);
  });
});

describe("AUTH-02 Control de sesiones", () => {
  it("expira por inactividad", async () => {
    const u = await insertUser(["CONSULTA"]);
    const r = await okLogin(u.username, u.password);
    await pool.query("UPDATE sessions SET last_seen_at = now() - interval '31 minutes' WHERE id = $1", [r.sessionId]);
    expect(await validateSessionToken(db, r.token)).toBeNull();
  });

  it("expira al cumplirse la duración máxima", async () => {
    const u = await insertUser(["CONSULTA"]);
    const r = await okLogin(u.username, u.password);
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id = $1", [r.sessionId]);
    expect(await validateSessionToken(db, r.token)).toBeNull();
  });

  it("el cierre de sesión la invalida", async () => {
    const u = await insertUser(["CONSULTA"]);
    const r = await okLogin(u.username, u.password);
    await logout(db, r.token, meta());
    expect(await validateSessionToken(db, r.token)).toBeNull();
  });

  it("un token inventado no es válido", async () => {
    expect(await validateSessionToken(db, "token-inventado")).toBeNull();
  });

  it("cambiar los roles de un usuario revoca sus sesiones", async () => {
    const { ctx: admin } = await ctxWithRoles(["ADMIN"]);
    const u = await insertUser(["CONSULTA"]);
    const r = await okLogin(u.username, u.password);
    await updateUser(db, admin, {
      userId: u.id,
      fullName: "Usuario Modificado",
      email: null,
      roles: ["TESORERIA"],
      status: "ACTIVE",
    });
    expect(await validateSessionToken(db, r.token)).toBeNull();
    const a = await lastAudit("module='users' AND entity_id=$1", [String(u.id)]);
    expect(a?.action).toBe("update_roles");
    expect(a?.before).toMatchObject({ roles: ["CONSULTA"] });
    expect(a?.after).toMatchObject({ roles: ["TESORERIA"] });
  });

  it("cambiar los permisos de un rol revoca las sesiones de sus usuarios", async () => {
    const { ctx: admin } = await ctxWithRoles(["ADMIN"]);
    const u = await insertUser(["CONSULTA"]);
    const r = await okLogin(u.username, u.password);
    await setRolePermissions(db, admin, "CONSULTA", ROLE_PERMISSIONS.CONSULTA);
    expect(await validateSessionToken(db, r.token)).toBeNull();
  });
});

describe("AUTH-03 Cambio de contraseña", () => {
  it("aplica la política, revoca las sesiones anteriores y abre una nueva", async () => {
    const u = await insertUser(["CONSULTA"], "Clave-de-prueba-123", true);
    const r = await okLogin(u.username, u.password);
    expect(r.mustChangePassword).toBe(true);
    const ctx = await contextFor(u.id, u.username);
    await expect(changeOwnPassword(db, ctx, { currentPassword: u.password, newPassword: "corta" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      changeOwnPassword(db, ctx, { currentPassword: "otra", newPassword: "Nueva-clave-segura-2026" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const fresh = await changeOwnPassword(db, ctx, { currentPassword: u.password, newPassword: "Nueva-clave-segura-2026" });
    expect(await validateSessionToken(db, r.token)).toBeNull();
    const s = await validateSessionToken(db, fresh.token);
    expect(s?.mustChangePassword).toBe(false);
    expect((await login(db, { username: u.username, password: "Nueva-clave-segura-2026" }, meta())).ok).toBe(true);
  });
});

describe("AUTH-04 Administración de usuarios", () => {
  it("crea usuarios con contraseña temporal y cambio obligatorio", async () => {
    const { ctx: admin } = await ctxWithRoles(["ADMIN"]);
    const username = uniqueName("nuevo");
    const { userId, temporaryPassword } = await createUser(db, admin, {
      username,
      fullName: "Nueva Persona",
      email: null,
      roles: ["ADMINISTRACION"],
    });
    const r = await okLogin(username, temporaryPassword);
    expect(r.mustChangePassword).toBe(true);
    const a = await lastAudit("module='users' AND action='create' AND entity_id=$1", [String(userId)]);
    expect(a?.after).toMatchObject({ username, roles: ["ADMINISTRACION"] });
    expect(a?.user_id).toBe(String(admin.userId));
  });

  it("rechaza nombres de usuario duplicados", async () => {
    const { ctx: admin } = await ctxWithRoles(["ADMIN"]);
    const u = await insertUser(["CONSULTA"]);
    await expect(
      createUser(db, admin, { username: u.username, fullName: "Otra Persona", email: null, roles: ["CONSULTA"] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("un usuario sin permiso no puede usar el servicio aunque lo invoque directamente", async () => {
    const { ctx } = await ctxWithRoles(["ADMINISTRACION"]);
    await expect(
      createUser(db, ctx, { username: uniqueName("x"), fullName: "Intruso Prueba", email: null, roles: ["ADMIN"] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("no permite quitar el rol al último administrador activo", async () => {
    // Deja inactivos a los administradores creados por otras pruebas.
    await pool.query(
      "UPDATE users SET status = 'INACTIVE' WHERE id IN (SELECT user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.code = 'ADMIN')",
    );
    const { user, ctx } = await ctxWithRoles(["ADMIN"]);
    const other = await ctxWithRoles(["ADMIN"]);
    await pool.query("UPDATE users SET status = 'INACTIVE' WHERE id = $1", [other.user.id]);
    await expect(
      updateUser(db, other.ctx, { userId: user.id, fullName: "Admin Único", email: null, roles: ["CONSULTA"], status: "ACTIVE" }),
    ).rejects.toMatchObject({ fieldErrors: { roles: [expect.stringMatching(/al menos un administrador/)] } });
    await expect(
      updateUser(db, ctx, { userId: user.id, fullName: "Admin Único", email: null, roles: ["ADMIN"], status: "INACTIVE" }),
    ).rejects.toMatchObject({ fieldErrors: { status: [expect.stringMatching(/propio usuario/)] } });
  });

  it("el administrador inicial solo se crea si no hay otro activo", async () => {
    await insertUser(["ADMIN"]);
    await expect(createInitialAdmin(db, { username: uniqueName("adm"), fullName: "Admin", requestId: "t" })).rejects.toThrow(
      /Ya existe un administrador/,
    );
  });
});
