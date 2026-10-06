import { TIME_ZONE } from "@/lib/format";
import type { RetentionPolicy } from "./config";

/**
 * Retención 7 diarios / 4 semanales / 12 mensuales (parametrizable): se conserva el último backup de cada
 * uno de los últimos N días, semanas (ISO, de lunes a domingo) y meses que tienen backups. Los backups
 * previos a una restauración o a una migración no entran en la rotación: se conservan siempre.
 */
export interface RetentionCandidate {
  id: number;
  kind: string;
  finishedAt: Date;
}

const ROTATED_KINDS = new Set(["AUTO", "MANUAL"]);

function localDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function isoWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
  d.setUTCDate(d.getUTCDate() - dow + 3); // jueves de esa semana
  const year = d.getUTCFullYear();
  const week = 1 + Math.floor((d.getTime() - Date.UTC(year, 0, 1)) / (7 * 86_400_000));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Devuelve los ids que la política conserva; el resto de los rotables se pueden borrar. */
export function selectRetained(candidates: RetentionCandidate[], policy: RetentionPolicy): Set<number> {
  const keep = new Set<number>();
  const rotated = candidates.filter((c) => ROTATED_KINDS.has(c.kind)).sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime() || b.id - a.id);
  for (const c of candidates) if (!ROTATED_KINDS.has(c.kind)) keep.add(c.id);
  const buckets: [number, (c: RetentionCandidate) => string][] = [
    [policy.daily, (c) => localDay(c.finishedAt)],
    [policy.weekly, (c) => isoWeek(localDay(c.finishedAt))],
    [policy.monthly, (c) => localDay(c.finishedAt).slice(0, 7)],
  ];
  for (const [limit, keyOf] of buckets) {
    const seen = new Set<string>();
    for (const c of rotated) {
      const key = keyOf(c);
      if (seen.has(key)) continue;
      if (seen.size >= limit) break;
      seen.add(key);
      keep.add(c.id); // el más reciente de ese día/semana/mes
    }
  }
  return keep;
}

export const _test = { isoWeek, localDay };
