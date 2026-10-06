/**
 * Datos de prueba de §45 (`npm run db:seed:demo`): se cargan en una base nueva con el mismo
 * código que usa el script y se usan para verificar cuentas corrientes, cuentas por cobrar y por
 * pagar, caja, bancos, cheques, tesorería y reportes (§45: "Utilizarlos para verificar").
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listAccounts } from "@/modules/accounts/service";
import { loadPermissions } from "@/modules/auth/service";
import { evaluateInvariants } from "@/modules/consistency/service";
import { reportReconciliation } from "@/modules/reports/reconciliation";
import { hashPassword } from "@/server/auth/password";
import { createDb, type Db } from "@/server/db/drizzle";
import { DEMO_COUNTS } from "../../database/seeds/demo";
import { demoSeedBlockedReason, DemoSeedError, runDemoSeed } from "../../scripts/db/seed-demo";
import { createFreshDatabase, dropDatabase } from "../setup/fresh-db";

const DB_NAME = "erp_test_demo";
let pool: Pool;
let db: Db;
let today: string;

async function addUser(username: string, role: string) {
  const { rows } = await pool.query("INSERT INTO users (username, full_name, password_hash, must_change_password) VALUES ($1, $1, $2, false) RETURNING id", [
    username,
    await hashPassword("Clave-de-prueba-123"),
  ]);
  await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2", [rows[0].id, role]);
  return Number(rows[0].id);
}

const count = async (text: string) => Number((await pool.query<{ n: string }>(text)).rows[0]!.n);

beforeAll(async () => {
  const { appUrl } = await createFreshDatabase(DB_NAME);
  pool = new Pool({ connectionString: appUrl, max: 4 });
  db = createDb(pool);
  await addUser("admin", "ADMIN");
  await addUser("tesoreria", "TESORERIA");
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await dropDatabase(DB_NAME);
});

describe("DAT Datos de prueba de §45", () => {
  it("DAT-01 bloqueado en producción y sin ALLOW_DEMO_SEED=true", () => {
    expect(demoSeedBlockedReason({ ALLOW_DEMO_SEED: "true", NODE_ENV: "production" })).toMatch(/producción/);
    expect(demoSeedBlockedReason({})).toMatch(/ALLOW_DEMO_SEED=true/);
    expect(demoSeedBlockedReason({ ALLOW_DEMO_SEED: "1" })).toMatch(/ALLOW_DEMO_SEED=true/);
    expect(demoSeedBlockedReason({ ALLOW_DEMO_SEED: "true", NODE_ENV: "development" })).toBeNull();
  });

  it("DAT-02 solo a nombre de un administrador existente", async () => {
    await expect(runDemoSeed(pool, { username: "nadie" })).rejects.toBeInstanceOf(DemoSeedError);
    await expect(runDemoSeed(pool, { username: "tesoreria" })).rejects.toThrow(/no es administrador/);
    expect(await count("SELECT count(*) AS n FROM clients")).toBe(0);
  });

  it("DAT-03 carga 10 clientes, 10 proveedores y 20 + 20 comprobantes con todos los casos de §45", async () => {
    const r = await runDemoSeed(pool, { username: "admin" });
    today = r.today;
    expect(DEMO_COUNTS).toEqual({ clients: 10, suppliers: 10, issued: 20, received: 20 });
    expect(await count("SELECT count(*) AS n FROM clients")).toBe(10);
    expect(await count("SELECT count(*) AS n FROM suppliers")).toBe(10);
    const fiscal = (dir: string) => `SELECT count(*) AS n FROM documents d JOIN document_types t ON t.id = d.document_type_id WHERE d.direction = '${dir}' AND t.is_fiscal`;
    expect(await count(fiscal("ISSUED"))).toBe(20);
    expect(await count(fiscal("RECEIVED"))).toBe(20);

    const cls = (dir: string, c: string) => `SELECT count(*) AS n FROM documents d JOIN document_types t ON t.id = d.document_type_id WHERE d.direction = '${dir}' AND t.class = '${c}'`;
    for (const dir of ["ISSUED", "RECEIVED"]) {
      expect(await count(cls(dir, "CREDIT_NOTE")), `NC ${dir}`).toBeGreaterThan(0);
      expect(await count(cls(dir, "DEBIT_NOTE")), `ND ${dir}`).toBeGreaterThan(0);
      // Vencidos y a vencer con saldo; cancelados del todo y en parte.
      expect(await count(`SELECT count(*) AS n FROM documents WHERE direction = '${dir}' AND balance > 0 AND due_date < '${today}'`), `vencidos ${dir}`).toBeGreaterThan(0);
      expect(await count(`SELECT count(*) AS n FROM documents WHERE direction = '${dir}' AND balance > 0 AND due_date >= '${today}'`), `a vencer ${dir}`).toBeGreaterThan(0);
      expect(await count(`SELECT count(*) AS n FROM documents WHERE direction = '${dir}' AND status = 'SETTLED'`), `cancelados ${dir}`).toBeGreaterThan(0);
      expect(await count(`SELECT count(*) AS n FROM documents WHERE direction = '${dir}' AND status = 'PARTIAL'`), `parciales ${dir}`).toBeGreaterThan(0);
    }
    // Medios: efectivo, transferencia y cheque en cobranzas; efectivo, transferencia, cheque propio y endoso en pagos.
    expect((await pool.query("SELECT DISTINCT method FROM collection_lines ORDER BY 1")).rows.map((x) => x.method)).toEqual(["CASH", "CHECK", "TRANSFER"]);
    expect((await pool.query("SELECT DISTINCT method FROM payment_lines ORDER BY 1")).rows.map((x) => x.method)).toEqual(["CASH", "OWN_CHECK", "THIRD_PARTY_CHECK", "TRANSFER"]);
    expect((await pool.query("SELECT DISTINCT status FROM received_checks ORDER BY 1")).rows.map((x) => x.status)).toEqual(["CREDITED", "DEPOSITED", "ENDORSED", "IN_PORTFOLIO", "REJECTED"]);
    expect((await pool.query("SELECT DISTINCT status FROM issued_checks ORDER BY 1")).rows.map((x) => x.status)).toEqual(["DEBITED", "DELIVERED"]);
    // Saldos a favor de ambos lados.
    expect(await count("SELECT count(*) AS n FROM collections WHERE unapplied_amount > 0")).toBeGreaterThan(0);
    expect(await count("SELECT count(*) AS n FROM supplier_payments WHERE unapplied_amount > 0")).toBeGreaterThan(0);
    expect(await count("SELECT count(*) AS n FROM documents d JOIN document_types t ON t.id = d.document_type_id WHERE t.class = 'CREDIT_NOTE' AND d.balance > 0")).toBeGreaterThan(0);
  }, 120_000);

  it("DAT-04 con los datos cargados cierran cuentas corrientes, caja, bancos, cheques, tesorería y reportes", async () => {
    const userId = Number((await pool.query("SELECT id FROM users WHERE username = 'admin'")).rows[0].id);
    const ctx = { userId, username: "admin", permissions: await loadPermissions(db, userId), requestId: "dat-04", ip: null, userAgent: "vitest" };
    expect((await evaluateInvariants(db, ctx)).filter((x) => !x.ok)).toEqual([]);
    expect(await reportReconciliation(db, ctx, today)).toEqual([]);
    // Cuentas por cobrar y por pagar: el listado suma lo mismo que los asientos de cuenta corriente.
    const ar = await listAccounts(db, ctx, "ISSUED", { q: "", filter: "ALL", page: 1 });
    expect(ar.totals.balance).toBe((await pool.query("SELECT sum(debit - credit)::numeric(18,2)::text AS v FROM customer_account_entries")).rows[0].v);
    const ap = await listAccounts(db, ctx, "RECEIVED", { q: "", filter: "ALL", page: 1 });
    expect(ap.totals.balance).toBe((await pool.query("SELECT sum(debit - credit)::numeric(18,2)::text AS v FROM supplier_account_entries")).rows[0].v);
    expect(Number(ar.totals.overdue)).toBeGreaterThan(0);
    expect(Number(ap.totals.credit)).toBeGreaterThan(0);
    // Todo quedó auditado a nombre del administrador.
    expect(await count("SELECT count(*) AS n FROM audit_log WHERE username = 'admin' AND module = 'documents' AND result = 'SUCCESS'")).toBeGreaterThanOrEqual(40);
  });

  it("DAT-05 no se carga dos veces", async () => {
    await expect(runDemoSeed(pool, { username: "admin" })).rejects.toThrow(/base vacía/);
    expect(await count("SELECT count(*) AS n FROM clients")).toBe(10);
  });
});
