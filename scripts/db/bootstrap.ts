/**
 * Crea (si no existen) los roles de base de datos y la base del ERP.
 * Requiere una conexión de superusuario: DATABASE_ADMIN_URL.
 * Contraseñas: erp_owner ← DATABASE_OWNER_URL, erp_app ← DATABASE_URL, erp_backup ← DATABASE_BACKUP_URL (opcional).
 *
 * Uso: npx tsx scripts/db/bootstrap.ts [nombre_base]
 */
import "dotenv/config";
import { Client } from "pg";
import { bootstrapDatabase } from "./bootstrap-lib";

const passwordOf = (url: string | undefined) => (url ? decodeURIComponent(new URL(url).password) : "");

async function main() {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) throw new Error("Falta DATABASE_ADMIN_URL");
  const dbName = process.argv[2] ?? new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await bootstrapDatabase(admin, dbName, {
      ownerPassword: passwordOf(process.env.DATABASE_OWNER_URL),
      appPassword: passwordOf(process.env.DATABASE_URL),
      backupPassword: passwordOf(process.env.DATABASE_BACKUP_URL) || undefined,
    });
    console.log(`Base "${dbName}" y roles listos.`);
  } finally {
    await admin.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
