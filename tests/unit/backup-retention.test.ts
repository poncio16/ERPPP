import { describe, expect, it } from "vitest";
import { backupConfig } from "@/modules/backup/config";
import { backupFileName } from "@/modules/backup/files";
import { selectRetained, type RetentionCandidate } from "@/modules/backup/retention";

/** Backups AUTO diarios a las 02:00 (hora argentina = 05:00 UTC) durante `days` días hasta `last`. */
function daily(last: string, days: number, startId = 1): RetentionCandidate[] {
  const end = Date.parse(`${last}T05:00:00Z`);
  return Array.from({ length: days }, (_, i) => ({ id: startId + i, kind: "AUTO", finishedAt: new Date(end - (days - 1 - i) * 86_400_000) }));
}

describe("BKP-09 Retención 7 diarios / 4 semanales / 12 mensuales", () => {
  it("con un año de backups diarios conserva los últimos 7 días, 4 semanas y 12 meses", () => {
    const runs = daily("2026-10-06", 400);
    const keep = selectRetained(runs, { daily: 7, weekly: 4, monthly: 12 });
    const kept = runs.filter((r) => keep.has(r.id));
    // Los 7 diarios incluyen el último domingo, que también es el último de su semana: se solapan.
    expect(kept.length).toBeLessThanOrEqual(7 + 4 + 12);
    expect(kept.length).toBeGreaterThanOrEqual(12 + 4);
    // Los 7 más recientes siempre se conservan.
    for (const r of runs.slice(-7)) expect(keep.has(r.id)).toBe(true);
    // Uno por mes: el último de cada uno de los 12 meses más recientes (octubre 2026 hacia atrás).
    const months = new Set(kept.map((r) => r.finishedAt.toISOString().slice(0, 7)));
    expect(months.size).toBe(12);
    expect(keep.has(runs.find((r) => r.finishedAt.toISOString().startsWith("2026-09-30"))!.id)).toBe(true);
    expect(keep.has(runs.find((r) => r.finishedAt.toISOString().startsWith("2026-09-29"))!.id)).toBe(false);
    // Nada anterior a 12 meses.
    expect(kept.every((r) => r.finishedAt >= new Date("2025-11-01T00:00:00Z"))).toBe(true);
  });

  it("varios backups en un día: se conserva el último; los previos a restauración o migración nunca se borran", () => {
    const runs: RetentionCandidate[] = [
      { id: 1, kind: "MANUAL", finishedAt: new Date("2026-10-06T13:00:00Z") },
      { id: 2, kind: "AUTO", finishedAt: new Date("2026-10-06T05:00:00Z") },
      { id: 3, kind: "PRE_RESTORE", finishedAt: new Date("2024-01-01T05:00:00Z") },
      { id: 4, kind: "PRE_MIGRATION", finishedAt: new Date("2024-01-02T05:00:00Z") },
    ];
    expect([...selectRetained(runs, { daily: 7, weekly: 0, monthly: 0 })].sort()).toEqual([1, 3, 4]);
  });

  it("los días se cuentan en hora argentina", () => {
    // 01:30 del 7/10 UTC = 22:30 del 6/10 en Argentina: es el mismo día que el backup de las 15:00.
    const runs: RetentionCandidate[] = [
      { id: 1, kind: "AUTO", finishedAt: new Date("2026-10-07T01:30:00Z") },
      { id: 2, kind: "AUTO", finishedAt: new Date("2026-10-06T18:00:00Z") },
    ];
    expect([...selectRetained(runs, { daily: 1, weekly: 0, monthly: 0 })]).toEqual([1]);
    expect([...selectRetained(runs, { daily: 2, weekly: 0, monthly: 0 })]).toEqual([1]);
  });
});

describe("BKP-10 Identificación y configuración", () => {
  it("nombre erp_AAAAMMDD_HHMMSS_<tipo>_v<app>_s<esquema>.dump en hora argentina", () => {
    expect(backupFileName("AUTO", new Date("2026-10-06T05:00:07Z"), "0.1.0", "0004_backup_offsite")).toBe("erp_20261006_020007_AUTO_v0.1.0_s0004.dump");
    expect(backupFileName("MANUAL", new Date("2026-01-01T02:59:59Z"), "1.2.3-rc/1", "0010_x")).toBe("erp_20251231_235959_MANUAL_v1.2.3-rc-1_s0010.dump");
  });

  it("valores por defecto y variables de entorno", () => {
    const def = backupConfig({});
    expect(def).toMatchObject({ dir: "/var/backups/erp", offsiteDir: null, ageRecipient: null, backupUrl: null, retention: { daily: 7, weekly: 4, monthly: 12 } });
    const env = backupConfig({ BACKUP_DIR: "/srv/b", BACKUP_OFFSITE_DIR: "/mnt/nas", BACKUP_KEEP_DAILY: "3", BACKUP_KEEP_WEEKLY: "x", MAINTENANCE_FILE: "/run/erp.maint" });
    expect(env).toMatchObject({ dir: "/srv/b", offsiteDir: "/mnt/nas", retention: { daily: 3, weekly: 4, monthly: 12 }, maintenanceFile: "/run/erp.maint" });
  });
});
