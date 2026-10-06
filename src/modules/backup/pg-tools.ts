import { spawn } from "node:child_process";
import path from "node:path";
import type { BackupConfig } from "./config";

/** Ejecución de pg_dump, pg_restore y age. Las credenciales van por variables de entorno, nunca en la línea de comandos. */

export function pgEnv(url: string): Record<string, string> {
  const u = new URL(url);
  const env: Record<string, string> = {
    PGHOST: u.hostname || "localhost",
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
  };
  const sslmode = u.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

/** Misma URL apuntando a otra base. */
export function withDatabase(url: string, dbName: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(dbName)}`;
  return u.toString();
}

export const pgBin = (cfg: Pick<BackupConfig, "pgBinDir">, name: "pg_dump" | "pg_restore") => (cfg.pgBinDir ? path.join(cfg.pgBinDir, name) : name);

export async function run(cmd: string, args: string[], env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e: NodeJS.ErrnoException) =>
      reject(new Error(e.code === "ENOENT" ? `No se encontró el programa ${cmd} (instale el cliente de PostgreSQL o configure PG_BIN_DIR)` : e.message)),
    );
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(cmd)} terminó con código ${code}: ${stderr.trim().split("\n").slice(-5).join(" | ") || "sin detalle"}`));
    });
  });
}

/** Versión mayor de pg_dump/pg_restore instalada ("pg_dump (PostgreSQL) 16.14 …" → 16). */
export async function toolMajorVersion(cfg: Pick<BackupConfig, "pgBinDir">, name: "pg_dump" | "pg_restore"): Promise<number> {
  const { stdout } = await run(pgBin(cfg, name), ["--version"]);
  const m = /\(PostgreSQL\)\s+(\d+)/.exec(stdout);
  if (!m) throw new Error(`No se pudo leer la versión de ${name}: ${stdout.trim()}`);
  return Number(m[1]);
}
