/**
 * Crea el primer usuario administrador. Solo funciona si no hay ningún administrador activo.
 * Uso: npm run admin:create -- <usuario> "<Nombre y apellido>"
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createInitialAdmin } from "../src/modules/users/service";
import { createDb } from "../src/server/db/drizzle";

async function main() {
  const [username, fullName] = process.argv.slice(2);
  if (!username || !fullName) throw new Error('Uso: npm run admin:create -- <usuario> "<Nombre y apellido>"');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { temporaryPassword } = await createInitialAdmin(createDb(pool), { username, fullName, requestId: randomUUID() });
    console.log(`Administrador "${username}" creado.`);
    console.log(`Contraseña temporal (se pide cambiarla al ingresar): ${temporaryPassword}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
