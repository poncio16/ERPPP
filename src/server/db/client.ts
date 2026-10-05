import "server-only";
import { Pool } from "pg";
import { createDb, type Db } from "./drizzle";

const globalForDb = globalThis as unknown as { erpPool?: Pool };

function getPool(): Pool {
  if (!globalForDb.erpPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Falta la variable de entorno DATABASE_URL");
    globalForDb.erpPool = new Pool({ connectionString, max: 10 });
  }
  return globalForDb.erpPool;
}

/** Cliente de base de datos de la aplicación (rol erp_app). */
export const db: Db = createDb(getPool());
