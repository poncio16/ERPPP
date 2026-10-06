import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { TIME_ZONE } from "@/lib/format";
import type { ControlTotals } from "./control-totals";

/** Nombre, huella e identificación de los archivos de backup. */

export type BackupKind = "AUTO" | "MANUAL" | "PRE_RESTORE" | "PRE_MIGRATION";

const safe = (s: string) => s.replace(/[^0-9A-Za-z.-]/g, "-");

/** erp_AAAAMMDD_HHMMSS_<tipo>_v<versión app>_s<versión esquema>.dump (fecha y hora de Argentina). */
/** AAAAMMDD_HHMMSS en hora argentina. */
export function localStamp(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}${parts.second}`;
}

/** erp_AAAAMMDD_HHMMSS_<tipo>_v<versión app>_s<versión esquema>.dump (fecha y hora de Argentina). */
export function backupFileName(kind: BackupKind, startedAt: Date, appVersion: string, schemaVersion: string): string {
  return `erp_${localStamp(startedAt)}_${kind}_v${safe(appVersion)}_s${safe(schemaVersion.slice(0, 4))}.dump`;
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Archivo de control que acompaña a cada backup (<archivo>.json): permite verificarlo y restaurarlo aunque la base no exista. */
export interface BackupManifest {
  format: "erp-backup/1";
  /** Id en backup_runs de la base de origen (en el archivo ese registro todavía figura "en curso"). */
  runId: number;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  kind: BackupKind;
  startedAt: string;
  finishedAt: string;
  appVersion: string;
  schemaVersion: string;
  pgVersion: string;
  database: string;
  controlTotals: ControlTotals;
}

export const manifestPathOf = (dumpPath: string) => `${dumpPath}.json`;

export async function writeManifest(dumpPath: string, manifest: BackupManifest): Promise<void> {
  const tmp = `${manifestPathOf(dumpPath)}.partial`;
  await writeFile(tmp, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  await rename(tmp, manifestPathOf(dumpPath));
}

export async function readManifest(dumpPath: string): Promise<BackupManifest | null> {
  try {
    const m = JSON.parse(await readFile(manifestPathOf(dumpPath), "utf8")) as BackupManifest;
    return m.format === "erp-backup/1" ? m : null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
