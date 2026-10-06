/**
 * Prepara la base exclusiva de las pruebas en el navegador: base nueva con migraciones y
 * catálogos, un administrador y la tesorería de partida (caja y cuenta bancaria con saldo
 * inicial). Clientes, proveedores, comprobantes, cobranzas y pagos los carga cada prueba
 * desde la interfaz, como lo haría un usuario.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { Scenario } from "../database/seeds/scenario";
import { todayIso } from "../src/lib/format";
import { loadPermissions } from "../src/modules/auth/service";
import { hashPassword } from "../src/server/auth/password";
import { createDb } from "../src/server/db/drizzle";
import { createFreshDatabase } from "../tests/setup/fresh-db";
import { E2E_DB, E2E_PASSWORD, E2E_USER } from "./env";

export default async function globalSetup() {
  const { appUrl } = await createFreshDatabase(E2E_DB);
  const pool = new Pool({ connectionString: appUrl, max: 2 });
  try {
    const { rows } = await pool.query("INSERT INTO users (username, full_name, password_hash, must_change_password) VALUES ($1, 'Administración E2E', $2, false) RETURNING id", [
      E2E_USER,
      await hashPassword(E2E_PASSWORD),
    ]);
    const userId = Number(rows[0].id);
    await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'ADMIN'", [userId]);
    const db = createDb(pool);
    const ctx = { userId, username: E2E_USER, permissions: await loadPermissions(db, userId), requestId: randomUUID(), ip: null, userAgent: "e2e-setup" };
    const s = new Scenario(db, ctx, { today: todayIso(), keyPrefix: "e2e" });
    const caja = await s.cashBox("Caja E2E");
    const banco = await s.bankAccount({ bank: "011", number: "E2E-0001", name: "Banco E2E" });
    await s.opening("caja", caja, "1000000", -30);
    await s.opening("banco", banco, "2000000", -30);
  } finally {
    await pool.end();
  }
}
