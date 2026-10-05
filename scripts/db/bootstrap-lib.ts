import type { Client } from "pg";

export interface BootstrapPasswords {
  ownerPassword: string;
  appPassword: string;
  backupPassword?: string;
}

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Identificador inválido: ${s}`);
  return s;
};
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Crea los roles erp_owner / erp_app / erp_backup y la base `dbName` (idempotente). */
export async function bootstrapDatabase(admin: Client, dbName: string, pw: BootstrapPasswords) {
  const roles: [string, string | undefined][] = [
    ["erp_owner", pw.ownerPassword],
    ["erp_app", pw.appPassword],
    ["erp_backup", pw.backupPassword],
  ];
  for (const [role, password] of roles) {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
    const pass = password ? ` PASSWORD ${literal(password)}` : "";
    if (!rowCount) {
      await admin.query(`CREATE ROLE ${ident(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE${pass}`);
    } else if (password) {
      await admin.query(`ALTER ROLE ${ident(role)}${pass}`);
    }
  }
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (!rowCount) {
    await admin.query(`CREATE DATABASE ${ident(dbName)} OWNER erp_owner ENCODING 'UTF8' TEMPLATE template0`);
  }
  await admin.query(`ALTER DATABASE ${ident(dbName)} SET timezone TO 'America/Argentina/Buenos_Aires'`);
  await admin.query(`REVOKE ALL ON DATABASE ${ident(dbName)} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${ident(dbName)} TO erp_app, erp_backup`);
}
