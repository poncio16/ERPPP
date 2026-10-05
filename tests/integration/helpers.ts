import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { RoleCode } from "@/modules/auth/permissions";
import { loadPermissions } from "@/modules/auth/service";
import { createDb } from "@/server/db/drizzle";
import type { ServiceContext } from "@/server/context";
import { hashPassword } from "@/server/auth/password";
import { testUrls } from "../setup/test-env";

export const pool = new Pool({ connectionString: testUrls().app, max: 10 });
export const ownerPool = new Pool({ connectionString: testUrls().owner, max: 2 });
export const db = createDb(pool);

export const meta = () => ({ ip: "10.0.0.1", userAgent: "vitest", requestId: randomUUID() });

let n = 0;
export const uniqueName = (prefix: string) => `${prefix}${Date.now() % 100000}${++n}`;

/** Crea un usuario directamente (sin pasar por el servicio) con los roles indicados. */
export async function insertUser(roles: RoleCode[], password = "Clave-de-prueba-123", mustChangePassword = false) {
  const username = uniqueName("u");
  const { rows } = await pool.query(
    `INSERT INTO users (username, full_name, password_hash, must_change_password) VALUES ($1, $2, $3, $4) RETURNING id`,
    [username, `Usuario ${username}`, await hashPassword(password), mustChangePassword],
  );
  const id = Number(rows[0].id);
  for (const role of roles) {
    await pool.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2`, [id, role]);
  }
  return { id, username, password };
}

export async function contextFor(userId: number, username: string): Promise<ServiceContext> {
  return { userId, username, permissions: await loadPermissions(db, userId), ...meta() };
}

export async function ctxWithRoles(roles: RoleCode[]) {
  const u = await insertUser(roles);
  return { user: u, ctx: await contextFor(u.id, u.username) };
}

export async function lastAudit(where: string, params: unknown[] = []) {
  const { rows } = await pool.query(`SELECT * FROM audit_log WHERE ${where} ORDER BY id DESC LIMIT 1`, params);
  return rows[0] as Record<string, unknown> | undefined;
}
