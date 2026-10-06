import path from "node:path";

/** Configuración de backups (sección J), tomada de variables de entorno. Ver docs/runbooks/backup-y-restauracion.md. */
export interface BackupConfig {
  /** Carpeta local de backups en el servidor. */
  dir: string;
  /** Carpeta de la copia fuera del servidor (NAS montado o almacenamiento S3 montado con rclone/s3fs). */
  offsiteDir: string | null;
  /** Clave pública de age con la que se cifra la copia externa; la privada se guarda fuera del servidor. */
  ageRecipient: string | null;
  /** Conexión de solo lectura para pg_dump (rol erp_backup). */
  backupUrl: string | null;
  /** Carpeta de los binarios de PostgreSQL (pg_dump, pg_restore), si no están en el PATH. */
  pgBinDir: string | null;
  retention: RetentionPolicy;
  /** Archivo que pone la aplicación en modo mantenimiento mientras se restaura. */
  maintenanceFile: string;
}

export interface RetentionPolicy {
  daily: number;
  weekly: number;
  monthly: number;
}

const int = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};
const opt = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export function backupConfig(env: Record<string, string | undefined> = process.env): BackupConfig {
  return {
    dir: opt(env.BACKUP_DIR) ?? "/var/backups/erp",
    offsiteDir: opt(env.BACKUP_OFFSITE_DIR),
    ageRecipient: opt(env.BACKUP_AGE_RECIPIENT),
    backupUrl: opt(env.DATABASE_BACKUP_URL),
    pgBinDir: opt(env.PG_BIN_DIR),
    retention: { daily: int(env.BACKUP_KEEP_DAILY, 7), weekly: int(env.BACKUP_KEEP_WEEKLY, 4), monthly: int(env.BACKUP_KEEP_MONTHLY, 12) },
    maintenanceFile: maintenanceFilePath(env),
  };
}

export function maintenanceFilePath(env: Record<string, string | undefined> = process.env): string {
  return opt(env.MAINTENANCE_FILE) ?? path.join(process.cwd(), ".maintenance");
}
