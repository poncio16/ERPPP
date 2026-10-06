import { randomUUID } from "node:crypto";
import os from "node:os";
import type { AuditActor } from "../../src/modules/audit/service";

/** Quien ejecuta desde la consola o el cron queda identificado en la auditoría con el usuario del sistema operativo. */
export function consoleActor(): AuditActor {
  return { userId: null, username: `consola:${os.userInfo().username}`, requestId: randomUUID(), ip: null, userAgent: `cli ${process.argv.slice(1, 3).join(" ")}` };
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name} (ver .env.example)`);
  return v;
}

export function fail(e: unknown): never {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
