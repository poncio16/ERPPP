/**
 * Carga los datos de prueba de la sección 45 (ficticios) en una base vacía.
 * Uso: npm run db:seed:demo [-- --usuario admin]
 *
 * Solo corre con ALLOW_DEMO_SEED=true y nunca con NODE_ENV=production. Todo se registra en una
 * sola transacción con las acciones reales, a nombre del usuario indicado (debe ser administrador):
 * si algo falla no queda nada cargado.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { loadDemoData } from "../../database/seeds/demo";
import { Scenario } from "../../database/seeds/scenario";
import { todayIso } from "../../src/lib/format";
import { loadPermissions } from "../../src/modules/auth/service";
import { createDb, type Db } from "../../src/server/db/drizzle";
import { fail, requireEnv } from "../backup/cli-lib";

export function demoSeedBlockedReason(env: Record<string, string | undefined>): string | null {
  if (env.NODE_ENV === "production") return "Los datos de prueba no se cargan en producción (NODE_ENV=production).";
  if (env.ALLOW_DEMO_SEED !== "true") return "Para cargar datos de prueba defina ALLOW_DEMO_SEED=true en el .env de un entorno de desarrollo o demostración.";
  return null;
}

export class DemoSeedError extends Error {}

/** Verifica el usuario y que la base esté vacía, y carga los datos en una sola transacción. */
export async function runDemoSeed(pool: Pool, opts: { username: string; today?: string }) {
  const db = createDb(pool);
  const { rows: users } = await pool.query<{ id: string; status: string }>("SELECT id, status FROM users WHERE username = $1", [opts.username]);
  const user = users[0];
  if (!user || user.status !== "ACTIVE") throw new DemoSeedError(`No existe un usuario activo "${opts.username}". Créelo con npm run admin:create o indique otro con --usuario.`);
  const permissions = await loadPermissions(db, Number(user.id));
  if (!permissions.has("users.manage")) throw new DemoSeedError(`El usuario "${opts.username}" no es administrador: los datos de prueba recorren todos los módulos.`);
  const { rows: used } = await pool.query<{ n: string }>("SELECT (SELECT count(*) FROM clients) + (SELECT count(*) FROM suppliers) + (SELECT count(*) FROM documents) AS n");
  if (Number(used[0]!.n) > 0) throw new DemoSeedError("La base ya tiene clientes, proveedores o comprobantes: los datos de prueba solo se cargan en una base vacía (npm run db:reset-dev la recrea).");

  const today = opts.today ?? todayIso();
  const ctx = { userId: Number(user.id), username: opts.username, permissions, requestId: randomUUID(), ip: null, userAgent: "db:seed:demo" };
  const result = await db.transaction((tx) => loadDemoData(new Scenario(tx as unknown as Db, ctx, { today, keyPrefix: `demo:${today}` })));
  return { today, ...result };
}

async function main() {
  const blocked = demoSeedBlockedReason(process.env);
  if (blocked) fail(blocked);
  const i = process.argv.indexOf("--usuario");
  const username = i > 0 ? process.argv[i + 1] : "admin";
  if (!username) fail("Indique el usuario: --usuario <nombre>");
  const pool = new Pool({ connectionString: requireEnv("DATABASE_URL"), max: 2 });
  try {
    const r = await runDemoSeed(pool, { username });
    console.log(
      `Datos de prueba cargados con fecha base ${r.today}: ${r.clients.length} clientes, ${r.suppliers.length} proveedores, ` +
        `${r.issued.length} comprobantes emitidos y ${r.received.length} recibidos, con sus cobranzas, pagos, cheques y movimientos.`,
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("seed-demo.ts")) main().catch(fail);
