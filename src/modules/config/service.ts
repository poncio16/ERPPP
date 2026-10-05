import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/server/db/drizzle";
import { configuration } from "@/server/db/schema";

/** Valores por defecto si un parámetro todavía no fue cargado. */
const DEFAULTS = {
  vat_tolerance_per_rate: "0.10",
  locked_until_date: null as string | null,
  allow_duplicate_tax_id: true,
  cash_allow_negative: false,
  due_soon_days: 7,
  session_idle_minutes: 30,
  session_absolute_hours: 12,
  login_max_attempts: 5,
  login_lock_minutes: 15,
  password_min_length: 12,
  letter_vat_matrix: { mode: "WARN", issued: {} } as {
    mode?: "WARN" | "BLOCK";
    issued?: Record<string, string[]>;
    received?: Record<string, string[]>;
  } | null,
};
export type ConfigKey = keyof typeof DEFAULTS;
export type ConfigValue<K extends ConfigKey> = (typeof DEFAULTS)[K];

export async function getConfig<K extends ConfigKey>(db: DbOrTx, key: K): Promise<ConfigValue<K>> {
  const [row] = await db.select({ value: configuration.value }).from(configuration).where(eq(configuration.key, key));
  return (row?.value ?? DEFAULTS[key]) as ConfigValue<K>;
}

/** Fecha de cierre de período (`locked_until_date`): no se registra nada con fecha igual o anterior. */
export async function lockedUntil(db: DbOrTx): Promise<string | null> {
  const v = await getConfig(db, "locked_until_date");
  return typeof v === "string" && v ? v : null;
}
