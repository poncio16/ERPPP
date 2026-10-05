import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Las migraciones se ejecutan con el rol dueño del esquema (erp_owner), nunca con el de la aplicación.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./database/migrations",
  casing: "snake_case",
  dbCredentials: { url: process.env.DATABASE_OWNER_URL ?? "" },
  strict: true,
  verbose: true,
});
