import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Client, Pool, PoolClient } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** Transacción de Drizzle; los servicios la reciben y la pasan a los repositorios. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

/** Acepta un pool o una conexión suelta (el backup trabaja dentro de una transacción de su propia conexión). */
export function createDb(pool: Pool | PoolClient | Client): Db {
  return drizzle(pool, { schema, casing: "snake_case" });
}
