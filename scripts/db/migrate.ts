/** Uso: npx tsx scripts/db/migrate.ts */
import "dotenv/config";
import { runMigrations } from "./migrate-lib";

runMigrations(process.env.DATABASE_OWNER_URL ?? "")
  .then(() => console.log("Migraciones aplicadas."))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
