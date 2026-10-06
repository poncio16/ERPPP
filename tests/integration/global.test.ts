/**
 * Prueba global (§47, INT-GLB): un escenario completo en una base nueva y exclusiva, comparado
 * contra resultados calculados a mano (tests/acceptance/fixtures/global-expected.ts) en
 * comprobantes, cuentas corrientes, imputaciones, caja, bancos, cheques, tesorería y reportes,
 * más todos los invariantes de G.14 en $0.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIso } from "@/lib/format";
import { listAccounts } from "@/modules/accounts/service";
import { loadPermissions } from "@/modules/auth/service";
import { evaluateInvariants } from "@/modules/consistency/service";
import { dashboardData } from "@/modules/reports/dashboard";
import { reportReconciliation } from "@/modules/reports/reconciliation";
import { runReport } from "@/modules/reports/registry";
import { consolidatedPosition } from "@/modules/treasury/consolidated";
import { treasuryOverview } from "@/modules/treasury/service";
import type { ServiceContext } from "@/server/context";
import { createDb, type Db } from "@/server/db/drizzle";
import { hashPassword } from "@/server/auth/password";
import { addDays, Scenario } from "../../database/seeds/scenario";
import { buildGlobalScenario, type GlobalScenario } from "../acceptance/fixtures/global-scenario";
import { GLOBAL_EXPECTED as X } from "../acceptance/fixtures/global-expected";
import { createFreshDatabase, dropDatabase } from "../setup/fresh-db";

const DB_NAME = "erp_test_global";
const today = todayIso();
let pool: Pool;
let db: Db;
let ctx: ServiceContext;
let s: GlobalScenario;

const one = async <T>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows[0] as T;

beforeAll(async () => {
  const { appUrl } = await createFreshDatabase(DB_NAME);
  pool = new Pool({ connectionString: appUrl, max: 4 });
  db = createDb(pool);
  const { rows } = await pool.query(
    "INSERT INTO users (username, full_name, password_hash, must_change_password) VALUES ('global', 'Prueba global', $1, false) RETURNING id",
    [await hashPassword("Clave-de-prueba-123")],
  );
  const userId = Number(rows[0].id);
  await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'ADMIN'", [userId]);
  ctx = { userId, username: "global", permissions: await loadPermissions(db, userId), requestId: randomUUID(), ip: "10.0.0.9", userAgent: "vitest" };
  s = await buildGlobalScenario(new Scenario(db, ctx, { today, keyPrefix: "int-glb" }));
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await dropDatabase(DB_NAME);
});

describe("INT-GLB Prueba global (§47)", () => {
  it("INT-GLB comprobantes: saldos, estados y totales emitidos y recibidos", async () => {
    for (const [k, id] of Object.entries(s.issued)) {
      const d = await one<{ balance: string; status: string }>("SELECT balance, status FROM documents WHERE id = $1", [id]);
      expect(d.balance, `saldo de ${k}`).toBe(X.issued.balances[k as keyof typeof X.issued.balances]);
      const st = X.issued.status[k as keyof typeof X.issued.status];
      if (st) expect(d.status, `estado de ${k}`).toBe(st);
    }
    for (const [k, id] of Object.entries(s.received)) {
      const d = await one<{ balance: string; status: string }>("SELECT balance, status FROM documents WHERE id = $1", [id]);
      expect(d.balance, `saldo de ${k}`).toBe(X.received.balances[k as keyof typeof X.received.balances]);
      const st = X.received.status[k as keyof typeof X.received.status];
      if (st) expect(d.status, `estado de ${k}`).toBe(st);
    }
    const totals = await pool.query<{ direction: string; debit: string; credit: string; internal: string }>(`
      SELECT d.direction,
             coalesce(sum(d.total) FILTER (WHERE t.class IN ('INVOICE','DEBIT_NOTE')), 0)::numeric(18,2)::text AS debit,
             coalesce(sum(d.total) FILTER (WHERE t.class = 'CREDIT_NOTE'), 0)::numeric(18,2)::text AS credit,
             coalesce(sum(d.total) FILTER (WHERE t.class = 'INTERNAL_DEBIT'), 0)::numeric(18,2)::text AS internal
        FROM documents d JOIN document_types t ON t.id = d.document_type_id
       WHERE d.status <> 'ANNULLED' GROUP BY d.direction ORDER BY d.direction`);
    expect(totals.rows).toEqual([
      { direction: "ISSUED", debit: X.issued.debitTotal, credit: X.issued.creditTotal, internal: X.issued.rejectedCheckDebit },
      { direction: "RECEIVED", debit: X.received.debitTotal, credit: X.received.creditTotal, internal: "0.00" },
    ]);
  });

  it("INT-GLB cuentas corrientes: saldo, vencido, a vencer y saldo a favor por tercero y en total", async () => {
    for (const [direction, expected, ids] of [
      ["ISSUED", X.clients, s.clients],
      ["RECEIVED", X.suppliers, s.suppliers],
    ] as const) {
      const list = await listAccounts(db, ctx, direction, { q: "", filter: "ALL", page: 1 });
      for (const [k, id] of Object.entries(ids)) {
        const row = list.rows.find((r) => r.id === id)!;
        expect({ balance: row.balance, overdue: row.overdue, notDue: row.notDue, credit: row.credit }, `cuenta de ${k}`).toEqual(expected[k as keyof typeof ids]);
      }
      expect(list.totals).toEqual(expected.total);
    }
  });

  it("INT-GLB imputaciones y saldos sin imputar de cobranzas y pagos", async () => {
    const alloc = await pool.query<{ direction: string; total: string }>(`
      SELECT d.direction, sum(a.amount)::numeric(18,2)::text AS total
        FROM allocations a JOIN documents d ON d.id = a.target_document_id
       WHERE a.status = 'ACTIVE' GROUP BY d.direction ORDER BY d.direction`);
    expect(alloc.rows).toEqual([
      { direction: "ISSUED", total: X.allocations.issued },
      { direction: "RECEIVED", total: X.allocations.received },
    ]);
    for (const [k, id] of Object.entries(s.collections)) {
      expect((await one<{ u: string }>("SELECT unapplied_amount AS u FROM collections WHERE id = $1", [id])).u, k).toBe(X.collections.unapplied[k as keyof typeof X.collections.unapplied]);
    }
    for (const [k, id] of Object.entries(s.payments)) {
      expect((await one<{ u: string }>("SELECT unapplied_amount AS u FROM supplier_payments WHERE id = $1", [id])).u, k).toBe(X.payments.unapplied[k as keyof typeof X.payments.unapplied]);
    }
    expect((await one<{ t: string }>("SELECT sum(total_amount)::numeric(18,2)::text AS t FROM collections WHERE status = 'ACTIVE'")).t).toBe(X.collections.total);
    expect((await one<{ t: string }>("SELECT sum(total_amount)::numeric(18,2)::text AS t FROM supplier_payments WHERE status = 'ACTIVE'")).t).toBe(X.payments.total);
  });

  it("INT-GLB caja, bancos y cheques", async () => {
    const cash = await treasuryOverview(db, ctx, "CASH");
    const banks = await treasuryOverview(db, ctx, "BANK");
    expect(cash.find((a) => a.id === s.accounts.caja.id)!.balance).toBe(X.treasury.caja);
    expect(banks.find((a) => a.id === s.accounts.nacion.id)!.balance).toBe(X.treasury.nacion);
    const galicia = banks.find((a) => a.id === s.accounts.galicia.id)!;
    expect(galicia.balance).toBe(X.treasury.galicia);
    expect(galicia.available).toBe(X.treasury.galiciaAvailable);
    for (const [k, status] of Object.entries(X.checks.received)) {
      expect((await one<{ status: string }>("SELECT status FROM received_checks WHERE id = $1", [s.checks[k as keyof typeof s.checks]])).status, k).toBe(status);
    }
    for (const [k, status] of Object.entries(X.checks.issued)) {
      expect((await one<{ status: string }>("SELECT status FROM issued_checks WHERE id = $1", [s.checks[k as keyof typeof s.checks]])).status, k).toBe(status);
    }
    // El cheque rechazado conserva todo su historial.
    const events = await pool.query<{ to_status: string }>("SELECT to_status FROM check_events WHERE received_check_id = $1 ORDER BY id", [s.checks.checkC]);
    expect(events.rows.map((e) => e.to_status)).toEqual(["IN_PORTFOLIO", "DEPOSITED", "CREDITED", "REJECTED"]);
  });

  it("INT-GLB tesorería: posición consolidada", async () => {
    const { totals } = await consolidatedPosition(db, ctx);
    expect(totals).toMatchObject({
      cash: X.treasury.caja,
      liquid: X.treasury.liquid,
      portfolio: X.treasury.portfolio,
      ownPending: X.treasury.ownPending,
      position: X.treasury.position,
    });
  });

  it("INT-GLB reportes y dashboard con las mismas cifras", async () => {
    const totalsOf = async (key: string, params: Record<string, string> = {}) => (await runReport(db, ctx, key, params, today)).tables[0]!.totals!;
    expect(await totalsOf("clientes-deuda")).toMatchObject({ balance: X.clients.total.balance, overdue: X.clients.total.overdue });
    expect(await totalsOf("proveedores-deuda")).toMatchObject({ balance: X.suppliers.total.balance, overdue: X.suppliers.total.overdue });
    expect(await totalsOf("cartera-cheques")).toMatchObject({ amount: X.treasury.portfolio });
    expect(await totalsOf("cheques-emitidos", { status: "PENDING" })).toMatchObject({ amount: X.treasury.ownPending });
    const from = addDays(today, -90);
    expect(await totalsOf("clientes-cobranzas", { from, to: today })).toMatchObject({ total: X.collections.total });
    expect(await totalsOf("proveedores-pagos", { from, to: today })).toMatchObject({ total: X.payments.total });
    // Subdiario de IVA: las NC restan; la factura C recibida va como no gravado.
    const months = { from: from.slice(0, 7), to: today.slice(0, 7) };
    expect(await totalsOf("iva-ventas", months)).toMatchObject({ "n21.000": X.vat.sales.net, "v21.000": X.vat.sales.vat, total: X.vat.sales.total });
    expect(await totalsOf("iva-compras", months)).toMatchObject({
      "n21.000": X.vat.purchases.net,
      "v21.000": X.vat.purchases.vat,
      untaxed: X.vat.purchases.untaxed,
      total: X.vat.purchases.total,
    });

    const dash = await dashboardData(db, ctx, today);
    expect(dash.receivable).toMatchObject({ total: X.clients.total.balance, overdue: X.clients.total.overdue });
    expect(dash.payable).toMatchObject({ total: X.suppliers.total.balance });
    expect(dash.treasury).toMatchObject({ portfolio: X.treasury.portfolio });
  });

  it("INT-GLB invariantes de G.14 en $0 y reportes conciliados con los módulos de origen", async () => {
    const results = await evaluateInvariants(db, ctx);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(await reportReconciliation(db, ctx, today)).toEqual([]);
  });
});
