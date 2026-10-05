import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** Transacción de Drizzle; los servicios la reciben y la pasan a los repositorios. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema, casing: "snake_case" });
}
